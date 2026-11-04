/* «Сервер у браузері»: зберігання даних (локально або Firebase), авторизація,
 * турнірні схеми та всі операції адміністратора і суддів. */
const Backend = (function () {
  'use strict';
  const LS_DB = 'robogames2026-db', LS_SESSION = 'robogames2026-session', LS_FB = 'robogames2026-firebase';
  const DEFAULT_ADMIN_PASSWORD = 'robogames2026';
  const CATEGORY_ORDER = ['delivery', 'basketball', 'football', 'sumo', 'maze', 'biathlon', 'smart'];
  const COLS = ['categories', 'teams', 'entries', 'matches', 'runs', 'users'];
  const FB_SDK = window.FIREBASE_SDK_URL || 'https://www.gstatic.com/firebasejs/10.12.2/';
  const EMAIL_DOMAIN = 'robogames.app';

  let mode = 'local';        // 'local' | 'firebase'
  let data = null;           // {meta, categories[], teams[], entries[], matches[], runs[], users[], timers{}, log[]}
  let meId = null;
  let version = 0;
  let offset = 0;
  const listeners = [];
  let fb = null, fbConfig = null, fbAuthUser = null, fbReady = false, fbHasUsers = null;
  let bootstrapping = false;

  const clone = o => JSON.parse(JSON.stringify(o));
  const uid = p => (p || '') + Array.from(crypto.getRandomValues(new Uint8Array(5))).map(b => b.toString(16).padStart(2, '0')).join('');
  function emit() { version++; listeners.forEach(f => { try { f(); } catch (e) { console.error(e); } }); }

  async function sha(s) {
    const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
    return Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  async function hashPassword(pw, salt) { salt = salt || uid(''); return { salt, hash: await sha(salt + ':' + pw) }; }

  /* ---------- Початкові дані ---------- */
  function seedData() {
    const seed = window.SEED || { teams: [], entries: [] };
    const d = {
      meta: { title: 'Обласні змагання з робототехніки «RoboGames-2026»', place: 'Полтавський університет економіки і торгівлі (ПУЕТ)', date: '', chairName: '' },
      categories: [], teams: clone(seed.teams), entries: [], matches: [], runs: [], users: [], timers: {}, log: []
    };
    CATEGORY_ORDER.forEach((type, i) => d.categories.push({ id: 'c_' + type, type, name: RG.TYPES[type].title, order: i, settings: {} }));
    seed.entries.forEach((e, i) => d.entries.push({ id: uid('e'), categoryId: 'c_' + e.category, teamId: e.teamId, group: null, order: i }));
    d.categories.forEach(c => adaptSchedule(d, c, { redraw: true }));
    d.categories.forEach(c => { if (RG.TYPES[c.type].kind !== 'match') d.entries.filter(e => e.categoryId === c.id).forEach((e, i) => { e.order = i + 1; }); });
    return d;
  }

  /* ---------- Турнірна схема ---------- */
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  function adaptSchedule(db, cat, opts) {
    opts = opts || {};
    if (RG.TYPES[cat.type].kind !== 'match') return [];
    const notes = [];
    const entries = db.entries.filter(e => e.categoryId === cat.id);
    let matches = db.matches.filter(m => m.categoryId === cat.id);
    const groupStarted = matches.some(m => m.stage === 'group' && m.status !== 'scheduled');
    const N = entries.length;
    let G = RG.groupCount(N);
    const current = Array.from(new Set(entries.map(e => e.group).filter(Boolean)));
    const doRedraw = opts.redraw || (N && entries.every(e => !e.group)) || (!groupStarted && current.length && current.length !== G);
    if (doRedraw) {
      const names = RG.GROUP_NAMES.slice(0, G);
      const sizes = RG.groupSizes(N, G);
      const order = shuffle(entries.slice());
      let k = 0;
      names.forEach((g, gi) => { for (let i = 0; i < sizes[gi]; i++) order[k++].group = g; });
      db.matches = db.matches.filter(m => m.categoryId !== cat.id);
      matches = [];
      if (N) notes.push(`Проведено жеребкування: ${G} груп(и), ${N} команд.`);
    } else {
      if (groupStarted) G = Math.max(1, current.length || 1);
      const names = RG.GROUP_NAMES.slice(0, G);
      const count = g => entries.filter(e => e.group === g).length;
      entries.filter(e => !e.group || names.indexOf(e.group) < 0).forEach(e => {
        const g = names.slice().sort((a, b) => count(a) - count(b))[0];
        e.group = g;
        notes.push(`Команду додано до групи ${g}.`);
      });
      for (let guard = 0; guard < 10 && !opts.keepGroups; guard++) {
        const sorted = names.slice().sort((a, b) => count(b) - count(a));
        const big = sorted[0], small = sorted[sorted.length - 1];
        if (count(big) - count(small) <= 1) break;
        const movable = entries.filter(e => e.group === big && !matches.some(m => m.stage === 'group' && m.status !== 'scheduled' && (m.teamA === e.teamId || m.teamB === e.teamId)));
        if (!movable.length) { notes.push('Групи незбалансовані: усі команди великої групи вже грали. За потреби проведіть повторне жеребкування.'); break; }
        movable[movable.length - 1].group = small;
        notes.push(`Для вирівнювання команду перенесено з групи ${big} до групи ${small}.`);
      }
    }
    const teamGroup = {};
    entries.forEach(e => { teamGroup[e.teamId] = e.group; });
    const before = db.matches.length;
    db.matches = db.matches.filter(m => {
      if (m.categoryId !== cat.id || m.stage !== 'group') return true;
      const ok = teamGroup[m.teamA] && teamGroup[m.teamA] === teamGroup[m.teamB] && teamGroup[m.teamA] === m.group;
      if (!ok && m.status === 'done') notes.push(`Анульовано результат матчу №${m.order} (команда вибула або змінила групу).`);
      return ok;
    });
    if (db.matches.length !== before && !doRedraw) notes.push(`Видалено матчів: ${before - db.matches.length}.`);
    const groups = RG.groupsOf(entries);
    let added = 0;
    const ideal = [];
    const rr = groups.map(g => {
      const ids = g.teamIds.slice().sort((a, b) => {
        const ea = entries.find(e => e.teamId === a), eb = entries.find(e => e.teamId === b);
        return (ea.order || 0) - (eb.order || 0);
      });
      return { g, ids, rounds: RG.roundRobin(ids.length) };
    });
    const maxR = Math.max(0, ...rr.map(x => x.rounds.length));
    for (let r = 0; r < maxR; r++) rr.forEach(x => (x.rounds[r] || []).forEach(([i, j]) => ideal.push({ group: x.g.name, a: x.ids[i], b: x.ids[j] })));
    ideal.forEach((p, idx) => {
      let m = db.matches.find(m => m.categoryId === cat.id && m.stage === 'group' && ((m.teamA === p.a && m.teamB === p.b) || (m.teamA === p.b && m.teamB === p.a)));
      if (!m) {
        m = { id: uid('m'), categoryId: cat.id, stage: 'group', group: p.group, teamA: p.a, teamB: p.b, status: 'scheduled', data: RG.emptyMatchData(cat.type), updatedBy: null, updatedAt: null };
        db.matches.push(m);
        added++;
      }
      m.order = idx + 1;
    });
    if (added && !doRedraw) notes.push(`Додано матчів: ${added}.`);
    const needPO = N >= 4;
    const hasPO = db.matches.filter(m => m.categoryId === cat.id && m.stage !== 'group');
    if (needPO && !hasPO.length) {
      ['sf1', 'sf2', 'third', 'final'].forEach(s => db.matches.push({ id: uid('m'), categoryId: cat.id, stage: s, group: null, teamA: null, teamB: null, status: 'scheduled', data: RG.emptyMatchData(cat.type), updatedBy: null, updatedAt: null }));
    } else if (!needPO && hasPO.length) {
      db.matches = db.matches.filter(m => !(m.categoryId === cat.id && m.stage !== 'group'));
      notes.push('Плей-оф скасовано: замало команд (потрібно щонайменше 4).');
    }
    const n = ideal.length;
    ['sf1', 'sf2', 'third', 'final'].forEach((s, i) => { const m = db.matches.find(m => m.categoryId === cat.id && m.stage === s); if (m) m.order = n + i + 1; });
    resolvePlayoff(db, cat);
    return notes;
  }

  function resolvePlayoff(db, cat) {
    const ms = db.matches.filter(m => m.categoryId === cat.id);
    const st = {}; ms.forEach(m => { if (m.stage !== 'group') st[m.stage] = m; });
    if (!st.sf1) return;
    const gm = ms.filter(m => m.stage === 'group');
    const complete = gm.length > 0 && gm.every(m => m.status === 'done');
    const entries = db.entries.filter(e => e.categoryId === cat.id);
    const valid = id => id && entries.some(e => e.teamId === id);
    const setTeams = (m, a, b) => {
      if (!m) return;
      if (m.status !== 'scheduled' && valid(m.teamA) && valid(m.teamB)) return;
      if (m.status !== 'scheduled') { m.status = 'scheduled'; m.data = RG.emptyMatchData(cat.type); }
      m.teamA = a || null; m.teamB = b || null;
    };
    if (complete) {
      const q = RG.qualifiers(cat, entries, ms);
      setTeams(st.sf1, q.sf[0][0], q.sf[0][1]);
      setTeams(st.sf2, q.sf[1][0], q.sf[1][1]);
    } else { setTeams(st.sf1, null, null); setTeams(st.sf2, null, null); }
    setTeams(st.final, RG.winnerOf(cat, st.sf1), RG.winnerOf(cat, st.sf2));
    setTeams(st.third, RG.loserOf(cat, st.sf1), RG.loserOf(cat, st.sf2));
  }

  /* ---------- Транзакції: робоча копія → різниця → запис ---------- */
  function diff(a, b) {
    const up = {};
    COLS.forEach(col => {
      const A = {}, B = {};
      (a[col] || []).forEach(x => { A[x.id] = x; });
      (b[col] || []).forEach(x => { B[x.id] = x; });
      Object.keys(B).forEach(id => { if (!A[id] || JSON.stringify(A[id]) !== JSON.stringify(B[id])) up[col + '/' + id] = B[id]; });
      Object.keys(A).forEach(id => { if (!B[id]) up[col + '/' + id] = null; });
    });
    if (JSON.stringify(a.meta) !== JSON.stringify(b.meta)) up.meta = b.meta;
    const ta = a.timers || {}, tb = b.timers || {};
    Object.keys(tb).forEach(k => { if (JSON.stringify(ta[k]) !== JSON.stringify(tb[k])) up['timers/' + k] = tb[k]; });
    return up;
  }

  async function commit(W, logs) {
    const up = diff(data, W);
    if (mode === 'local') {
      data = W;
      data.log = (data.log || []).concat(logs);
      if (data.log.length > 3000) data.log.splice(0, data.log.length - 3000);
      saveLocal();
      emit();
    } else {
      const fbUp = {};
      Object.keys(up).forEach(k => {
        const v = up[k];
        const [col, id] = k.split('/');
        if (col === 'teams') {
          if (v) {
            fbUp[k] = Object.assign({}, v, { members: (v.members || []).map(m => ({ surname: m.surname, name: m.name, patronymic: m.patronymic || '' })) });
            fbUp['pd/' + id] = (v.members || []).map(m => m.birthdate || '');
          } else { fbUp[k] = null; fbUp['pd/' + id] = null; }
        } else if (col === 'users') {
          fbUp[k] = v ? { login: v.login, name: v.name, role: v.role, categories: Object.fromEntries((v.categories || []).map(c => [c, true])) } : null;
        } else fbUp[k] = v;
      });
      logs.forEach(l => { fbUp['log/' + fb.db.ref('log').push().key] = l; });
      if (Object.keys(fbUp).length) await fb.db.ref().update(fbUp);
      data = Object.assign(W, { log: data.log });
      emit();
    }
  }

  async function tx(fn) {
    const W = clone(data);
    const logs = [];
    const me = W.users.find(u => u.id === meId);
    const log = (action, details) => logs.push({ ts: Date.now() + offset, userId: me ? me.id : null, userName: me ? me.name : 'система', action, details: details || '' });
    const res = await fn(W, me, log);
    await commit(W, logs);
    return res || { ok: true };
  }

  /* ---------- Локальне зберігання ---------- */
  function saveLocal() { try { localStorage.setItem(LS_DB, JSON.stringify(data)); } catch (e) { alert('Не вдалося зберегти дані в браузері: ' + e.message); } }
  async function initLocal() {
    mode = 'local';
    let raw = null;
    try { raw = localStorage.getItem(LS_DB); } catch (e) { /* */ }
    if (raw) data = JSON.parse(raw);
    else {
      data = seedData();
      const pw = await hashPassword(DEFAULT_ADMIN_PASSWORD);
      data.users.push({ id: 'u_admin', login: 'admin', name: 'Голова журі', role: 'admin', categories: [], salt: pw.salt, hash: pw.hash, defaultPassword: true });
      saveLocal();
    }
    data.timers = data.timers || {}; data.log = data.log || [];
    try { meId = localStorage.getItem(LS_SESSION); } catch (e) { meId = null; }
    if (meId && !data.users.find(u => u.id === meId)) meId = null;
    window.addEventListener('storage', ev => {
      if (ev.key === LS_DB && ev.newValue) { data = JSON.parse(ev.newValue); emit(); }
      if (ev.key === LS_SESSION) { meId = ev.newValue; emit(); }
    });
  }

  /* ---------- Firebase ---------- */
  function loadScript(src) {
    return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Не вдалося завантажити ' + src)); document.head.appendChild(s); });
  }
  const loginToEmail = l => (String(l).indexOf('@') >= 0 ? String(l).trim() : String(l).trim().toLowerCase() + '@' + EMAIL_DOMAIN);
  const emailToLogin = e => String(e || '').replace('@' + EMAIL_DOMAIN, '');

  function decodeFb(col, obj) {
    obj = obj || {};
    return Object.keys(obj).map(id => {
      const v = Object.assign({ id }, obj[id]);
      if (col === 'users') v.categories = Object.keys(v.categories || {});
      if (col === 'matches' || col === 'runs') v.data = v.data || {};
      if (col === 'teams') v.members = v.members || [];
      return v;
    });
  }

  async function initFirebase(cfg) {
    mode = 'firebase';
    fbConfig = cfg;
    await loadScript(FB_SDK + 'firebase-app-compat.js');
    await loadScript(FB_SDK + 'firebase-auth-compat.js');
    await loadScript(FB_SDK + 'firebase-database-compat.js');
    const app = firebase.apps.find(a => a.name === '[DEFAULT]') || firebase.initializeApp(cfg);
    fb = { app, auth: app.auth(), db: app.database(), subs: [] };
    if (cfg.emulator) { fb.auth.useEmulator(cfg.emulator.auth); fb.db.useEmulator(cfg.emulator.host, cfg.emulator.dbPort); }
    data = { meta: {}, categories: [], teams: [], entries: [], matches: [], runs: [], users: [], timers: {}, log: [] };
    fb.db.ref('.info/serverTimeOffset').on('value', s => { offset = s.val() || 0; });
    await new Promise(resolve => {
      let first = true;
      fb.auth.onAuthStateChanged(async user => {
        fbAuthUser = user;
        unsubscribeAll();
        meId = null;
        if (user && !bootstrapping) { try { await subscribeAll(user); } catch (e) { console.warn('subscribe', e.message); meId = null; } }
        else {
          try { const s = await fb.db.ref('setup/initialized').once('value'); fbHasUsers = s.exists(); } catch (e) { fbHasUsers = true; }
        }
        fbReady = true;
        if (first) { first = false; resolve(); } else emit();
      });
    });
  }
  function unsubscribeAll() { if (fb) { fb.subs.forEach(f => f()); fb.subs = []; } }
  async function subscribeAll(user) {
    const usersSnap = await fb.db.ref('users').once('value');
    fbHasUsers = usersSnap.exists();
    const profile = usersSnap.child(user.uid).val();
    if (!profile) { meId = null; return; }
    const isAdm = profile.role === 'admin';
    let pd = {};
    let pending = null;
    const schedule = () => { clearTimeout(pending); pending = setTimeout(emit, 60); };
    const loads = [];
    const on = (path, fn) => {
      const ref = fb.db.ref(path);
      let firstDone;
      loads.push(new Promise(r => { firstDone = r; }));
      const h = ref.on('value', s => { fn(s.val()); firstDone(); schedule(); }, err => { console.warn(path, err.message); firstDone(); });
      fb.subs.push(() => ref.off('value', h));
    };
    const applyPd = () => { if (isAdm) data.teams.forEach(t => { const b = pd[t.id] || []; t.members.forEach((m, i) => { m.birthdate = b[i] || ''; }); }); };
    on('meta', v => { data.meta = v || {}; });
    on('timers', v => { data.timers = v || {}; });
    on('teams', v => { data.teams = decodeFb('teams', v); applyPd(); });
    if (isAdm) on('pd', v => { pd = v || {}; applyPd(); });
    ['categories', 'entries', 'matches', 'runs', 'users'].forEach(col => on(col, v => { data[col] = decodeFb(col, v); }));
    await Promise.all(loads);
    meId = user.uid;
  }

  /* ---------- Публічний стан для інтерфейсу ---------- */
  function state() {
    if (!data || !meId) return null;
    const u = data.users.find(x => x.id === meId);
    if (!u) return null;
    const pub = x => ({ id: x.id, login: x.login, name: x.name, role: x.role, categories: x.categories || [] });
    const admin = u.role === 'admin';
    return {
      version, serverNow: Date.now() + offset, mode,
      me: Object.assign(pub(u), { defaultPassword: !!u.defaultPassword }),
      meta: data.meta || {}, categories: data.categories, entries: data.entries, matches: data.matches, runs: data.runs,
      teams: admin ? data.teams : data.teams.map(t => Object.assign({}, t, { members: (t.members || []).map(m => ({ surname: m.surname, name: m.name, patronymic: m.patronymic })) })),
      users: data.users.map(pub), timers: data.timers || {}
    };
  }
  function rawData() { return data; }

  /* ---------- Операції (колишні API-запити) ---------- */
  const fail = msg => { throw new Error(msg); };
  const canJudge = (u, catId) => u && (u.role === 'admin' || (u.categories || []).indexOf(catId) >= 0);
  const cleanStr = v => String(v === undefined || v === null ? '' : v).trim().slice(0, 300);
  function cleanTeam(b) {
    return {
      name: cleanStr(b.name), school: cleanStr(b.school), settlement: cleanStr(b.settlement),
      members: (Array.isArray(b.members) ? b.members : []).map(m => ({ surname: cleanStr(m.surname), name: cleanStr(m.name), patronymic: cleanStr(m.patronymic), birthdate: cleanStr(m.birthdate) })).filter(m => m.surname || m.name)
    };
  }
  const teamName = (db, id) => { const t = db.teams.find(t => t.id === id); return t ? t.name : '—'; };
  const catOf = (db, id) => db.categories.find(c => c.id === id);
  function matchSummary(db, cat, m) {
    return `${RG.STAGES[m.stage]}${m.group ? ' гр. ' + m.group : ''} №${m.order}: ${teamName(db, m.teamA)} — ${teamName(db, m.teamB)} ${RG.matchScore(cat.type, m.data, RG.settingsOf(cat)).text} [${m.status}]`;
  }
  const newEntry = (db, cid, teamId) => ({ id: uid('e'), categoryId: cid, teamId, group: null, order: db.entries.filter(e => e.categoryId === cid).length + 1 });

  async function login(loginName, password) {
    if (mode === 'local') {
      const u = data.users.find(x => x.login.toLowerCase() === String(loginName || '').trim().toLowerCase());
      if (!u || (await hashPassword(password || '', u.salt)).hash !== u.hash) fail('Невірний логін або пароль');
      meId = u.id;
      try { localStorage.setItem(LS_SESSION, u.id); } catch (e) { /* */ }
      emit();
      return;
    }
    try { await fb.auth.signInWithEmailAndPassword(loginToEmail(loginName), password); }
    catch (e) { fail('Невірний логін або пароль'); }
    await waitProfile();
    if (!meId) { await fb.auth.signOut(); fail('Цей обліковий запис не має доступу до системи (профіль видалено)'); }
  }
  function waitProfile() { return new Promise(r => { const t0 = Date.now(); (function chk() { if (meId || Date.now() - t0 > 8000) return r(); setTimeout(chk, 100); })(); }); }
  async function logout() {
    if (mode === 'local') { meId = null; try { localStorage.removeItem(LS_SESSION); } catch (e) { /* */ } emit(); return; }
    await fb.auth.signOut();
  }

  /* Створення першого адміністратора у порожній базі Firebase */
  async function bootstrapFirebase(name, loginName, password, useLocal) {
    if (!/^[A-Za-z0-9._-]+$/.test(loginName)) fail('Логін може містити лише латинські літери, цифри, крапку, дефіс');
    let cred;
    bootstrapping = true;
    try { cred = await fb.auth.createUserWithEmailAndPassword(loginToEmail(loginName), password); } catch (e) { bootstrapping = false; fail(fbError(e)); }
    const id = cred.user.uid;
    await fb.db.ref('users/' + id).set({ login: loginName, name, role: 'admin', categories: {} });
    await fb.db.ref('setup/initialized').set(true);
    let src = null;
    if (useLocal) { try { src = JSON.parse(localStorage.getItem(LS_DB)); } catch (e) { src = null; } }
    if (!src) src = seedData();
    const me = { id, login: loginName, name, role: 'admin', categories: [] };
    data = { meta: {}, categories: [], teams: [], entries: [], matches: [], runs: [], users: [me], timers: {}, log: [] };
    const W = { meta: src.meta || {}, categories: src.categories, teams: src.teams, entries: src.entries, matches: src.matches, runs: src.runs || [], users: [me], timers: {} };
    await commit(W, [{ ts: Date.now(), userId: id, userName: name, action: 'Ініціалізація бази', details: useLocal ? 'Перенесено дані з локального режиму' : 'Завантажено команди з Excel' }]);
    unsubscribeAll();
    await subscribeAll(cred.user);
    bootstrapping = false;
    emit();
  }
  function fbError(e) {
    const c = (e && e.code) || '';
    if (c.indexOf('email-already-in-use') >= 0) return 'Такий логін уже існує';
    if (c.indexOf('weak-password') >= 0) return 'Пароль має містити щонайменше 6 символів';
    if (c.indexOf('invalid-email') >= 0) return 'Логін може містити лише латинські літери, цифри, крапку, дефіс';
    if (c.indexOf('operation-not-allowed') >= 0) return 'У Firebase не ввімкнено вхід за Email/Password (Authentication → Sign-in method)';
    if (c.indexOf('permission') >= 0 || /permission/i.test(e && e.message)) return 'Firebase відхилив запис: перевірте правила бази даних (Rules)';
    return (e && e.message) || 'Помилка Firebase';
  }

  async function handle(method, p, body) {
    try { return await handleInner(method, p, body || {}); }
    catch (e) { if (e && e.code) throw new Error(fbError(e)); throw e; }
  }
  async function handleInner(method, p, body) {
    let m;
    if (!meId) fail('Потрібен вхід');

    if (p === '/api/me/password' && method === 'PUT') {
      if (String(body.new || '').length < 6) fail('Новий пароль має містити щонайменше 6 символів');
      if (mode === 'firebase') {
        const u = fb.auth.currentUser;
        const cred = firebase.auth.EmailAuthProvider.credential(u.email, body.old || '');
        try { await u.reauthenticateWithCredential(cred); } catch (e) { fail('Поточний пароль невірний'); }
        await u.updatePassword(body.new);
        return { ok: true };
      }
      return tx(async (W, u, log) => {
        if ((await hashPassword(body.old || '', u.salt)).hash !== u.hash) fail('Поточний пароль невірний');
        Object.assign(u, await hashPassword(body.new)); delete u.defaultPassword;
        log('Зміна пароля', u.login);
      });
    }

    if ((m = /^\/api\/matches\/([\w-]+)$/.exec(p)) && method === 'PUT') {
      return tx((W, u, log) => {
        const match = W.matches.find(x => x.id === m[1]);
        if (!match) fail('Матч не знайдено');
        const cat = catOf(W, match.categoryId);
        if (!canJudge(u, cat.id)) fail('Ви не закріплені за цією категорією');
        if (!match.teamA || !match.teamB) fail('Учасники матчу ще не визначені');
        const before = matchSummary(W, cat, match);
        if (body.data && typeof body.data === 'object') match.data = body.data;
        if (['scheduled', 'live', 'done'].indexOf(body.status) >= 0) match.status = body.status;
        if (match.stage !== 'group' && match.status === 'done') {
          const sc = RG.matchScore(cat.type, match.data, RG.settingsOf(cat));
          if (sc.winner === 'D') fail('У плей-оф потрібен переможець: проведіть додатковий тайм/раунд або вкажіть переможця за рішенням судді');
        }
        match.updatedBy = u.id; match.updatedAt = Date.now() + offset;
        if (!body.silent) log(`${cat.name}: результат матчу`, `${before} → ${matchSummary(W, cat, match)}`);
        resolvePlayoff(W, cat);
      });
    }

    if (p === '/api/runs' && method === 'PUT') {
      return tx((W, u, log) => {
        const cat = catOf(W, body.categoryId);
        if (!cat) fail('Категорію не знайдено');
        if (!canJudge(u, cat.id)) fail('Ви не закріплені за цією категорією');
        if (!W.entries.some(e => e.categoryId === cat.id && e.teamId === body.teamId)) fail('Команда не зареєстрована в категорії');
        const round = Number(body.round) || 1;
        let judgeId = null;
        if (cat.type === 'smart') {
          judgeId = u.role === 'admin' && body.judgeId ? body.judgeId : u.id;
          if (u.role !== 'admin' && judgeId !== u.id) fail('Можна редагувати лише власні оцінки');
        }
        let r = W.runs.find(x => x.categoryId === cat.id && x.teamId === body.teamId && x.round === round && (x.judgeId || null) === judgeId);
        const before = r ? JSON.stringify(r.data) : '—';
        if (!r) { r = { id: uid('r'), categoryId: cat.id, teamId: body.teamId, round, judgeId, data: {}, status: 'live' }; W.runs.push(r); }
        if (body.data && typeof body.data === 'object') r.data = body.data;
        if (['live', 'done'].indexOf(body.status) >= 0) r.status = body.status;
        r.updatedBy = u.id; r.updatedAt = Date.now() + offset;
        log(`${cat.name}: ${cat.type === 'smart' ? 'оціночний лист' : 'раунд ' + round}`, `${teamName(W, body.teamId)}${judgeId ? ' (суддя ' + ((W.users.find(x => x.id === judgeId) || {}).name || '') + ')' : ''}: ${before} → ${JSON.stringify(r.data)} [${r.status}]`);
        return { ok: true, id: r.id };
      });
    }
    if ((m = /^\/api\/runs\/([\w-]+)$/.exec(p)) && method === 'DELETE') {
      return tx((W, u, log) => {
        const r = W.runs.find(x => x.id === m[1]);
        if (!r) fail('Не знайдено');
        const cat = catOf(W, r.categoryId);
        if (!canJudge(u, cat.id) || (cat.type === 'smart' && u.role !== 'admin' && r.judgeId !== u.id)) fail('Немає доступу');
        W.runs = W.runs.filter(x => x.id !== r.id);
        log(`${cat.name}: видалено результат`, `${teamName(W, r.teamId)} раунд ${r.round}: ${JSON.stringify(r.data)}`);
      });
    }

    if ((m = /^\/api\/timer\/([\w-]+)$/.exec(p)) && method === 'POST') {
      return tx((W, u) => {
        const cat = catOf(W, m[1]);
        if (!cat) fail('Категорію не знайдено');
        if (!canJudge(u, cat.id)) fail('Немає доступу до таймера цієї категорії');
        const def = RG.TYPES[cat.type].timer;
        const set = RG.settingsOf(cat);
        W.timers = W.timers || {};
        const t = W.timers[cat.id] || { mode: def.mode, duration: (set.timerDuration || def.duration) * 1000, running: false, startedAt: 0, acc: 0, label: '' };
        const now = Date.now() + offset;
        const elapsed = () => t.acc + (t.running ? now - t.startedAt : 0);
        if (body.action === 'start' && !t.running) { t.running = true; t.startedAt = now; }
        else if (body.action === 'pause' && t.running) { t.acc = elapsed(); t.running = false; }
        else if (body.action === 'reset') { t.running = false; t.acc = 0; }
        else if (body.action === 'set') {
          t.running = false; t.acc = 0;
          if (body.mode === 'up' || body.mode === 'down') t.mode = body.mode;
          if (body.duration !== undefined) t.duration = Math.max(0, Number(body.duration) || 0) * 1000;
        }
        if (body.label !== undefined) t.label = String(body.label).slice(0, 200);
        if (body.matchId !== undefined) t.matchId = body.matchId || null;
        t.updatedBy = u.name;
        W.timers[cat.id] = t;
        return { ok: true, timer: t, serverNow: now };
      });
    }

    const me = data.users.find(u => u.id === meId);
    if (!me || me.role !== 'admin') fail('Лише для адміністратора (Голови журі)');

    if (p === '/api/log' && method === 'GET') {
      if (mode === 'local') return (data.log || []).slice(-1500).reverse();
      const s = await fb.db.ref('log').limitToLast(1500).once('value');
      const arr = []; s.forEach(c => { arr.push(c.val()); });
      return arr.reverse();
    }
    if (p === '/api/meta' && method === 'PUT') {
      return tx((W, u, log) => {
        W.meta = W.meta || {};
        ['title', 'place', 'date', 'chairName'].forEach(k => { if (body[k] !== undefined) W.meta[k] = String(body[k]).slice(0, 300); });
        log('Налаштування змагань', JSON.stringify(W.meta));
      });
    }
    if (p === '/api/restore' && method === 'POST') {
      if (!Array.isArray(body.teams) || !Array.isArray(body.categories)) fail('Файл не схожий на резервну копію системи');
      return tx((W, u, log) => {
        ['meta', 'categories', 'teams', 'entries', 'matches', 'runs'].forEach(k => { W[k] = clone(body[k] || (k === 'meta' ? {} : [])); });
        W.timers = {};
        if (mode === 'local' && Array.isArray(body.users) && body.users.some(x => x.hash)) W.users = clone(body.users);
        log('Відновлення з резервної копії', '');
      });
    }

    /* ----- Користувачі ----- */
    if (p === '/api/users' && method === 'POST') {
      const loginName = String(body.login || '').trim();
      const minPw = mode === 'firebase' ? 6 : 4;
      if (!loginName || !body.name || String(body.password || '').length < minPw) fail(`Вкажіть ПІБ, логін і пароль (від ${minPw} символів)`);
      if (data.users.some(x => x.login.toLowerCase() === loginName.toLowerCase())) fail('Такий логін уже існує');
      let id = uid('u'), pw = {};
      if (mode === 'firebase') {
        if (!/^[A-Za-z0-9._-]+$/.test(loginName)) fail('Логін може містити лише латинські літери, цифри, крапку, дефіс');
        let sec = firebase.apps.find(a => a.name === 'secondary');
        if (!sec) { sec = firebase.initializeApp(fbConfig, 'secondary'); if (fbConfig.emulator) sec.auth().useEmulator(fbConfig.emulator.auth); }
        let cred;
        try { cred = await sec.auth().createUserWithEmailAndPassword(loginToEmail(loginName), body.password); } catch (e) { fail(fbError(e)); }
        id = cred.user.uid;
        await sec.auth().signOut();
      } else pw = await hashPassword(body.password);
      return tx((W, u, log) => {
        const nu = Object.assign({ id, login: loginName, name: String(body.name).trim(), role: body.role === 'admin' ? 'admin' : 'judge', categories: (body.categories || []).filter(c => catOf(W, c)) }, pw);
        W.users.push(nu);
        log('Створено користувача', `${nu.name} (${nu.login}), ${nu.role}`);
        return { ok: true, id };
      });
    }
    if ((m = /^\/api\/users\/([\w-]+)$/.exec(p))) {
      let pw = null;
      if (method === 'PUT' && body.password) {
        if (mode === 'firebase') fail('У режимі Firebase пароль змінює сам суддя (кнопка 🔑). Щоб скинути пароль, видаліть суддю і створіть заново з іншим логіном.');
        if (String(body.password).length < 4) fail('Пароль від 4 символів');
        pw = await hashPassword(body.password);
      }
      return tx((W, u, log) => {
        const t = W.users.find(x => x.id === m[1]);
        if (!t) fail('Користувача не знайдено');
        if (method === 'PUT') {
          if (body.name) t.name = String(body.name).trim();
          if (body.login && body.login !== t.login) {
            if (mode === 'firebase') fail('У режимі Firebase логін змінити не можна');
            if (W.users.some(x => x !== t && x.login.toLowerCase() === String(body.login).toLowerCase())) fail('Такий логін уже існує');
            t.login = String(body.login).trim();
          }
          if (body.role && t.id !== u.id) t.role = body.role === 'admin' ? 'admin' : 'judge';
          if (Array.isArray(body.categories)) t.categories = body.categories.filter(c => catOf(W, c));
          if (pw) { Object.assign(t, pw); delete t.defaultPassword; }
          log('Змінено користувача', `${t.name}: категорії ${t.categories.map(id => (catOf(W, id) || {}).name).join(', ')}${pw ? '; пароль змінено' : ''}`);
        } else if (method === 'DELETE') {
          if (t.id === u.id) fail('Не можна видалити самого себе');
          W.users = W.users.filter(x => x.id !== t.id);
          log('Видалено користувача', t.name);
        }
      });
    }

    /* ----- Команди ----- */
    if (p === '/api/teams' && method === 'POST') {
      return tx((W, u, log) => {
        const t = Object.assign({ id: uid('t') }, cleanTeam(body));
        if (!t.name) fail('Вкажіть назву команди');
        W.teams.push(t);
        const notes = [];
        (body.categories || []).filter(c => catOf(W, c)).forEach(cid => { W.entries.push(newEntry(W, cid, t.id)); notes.push(...adaptSchedule(W, catOf(W, cid))); });
        log('Зареєстровано команду', `${t.name} (${t.school}); категорії: ${(body.categories || []).map(id => (catOf(W, id) || {}).name).join(', ')}. ${notes.join(' ')}`);
        return { ok: true, id: t.id, notes };
      });
    }
    if ((m = /^\/api\/teams\/([\w-]+)$/.exec(p))) {
      return tx((W, u, log) => {
        const t = W.teams.find(x => x.id === m[1]);
        if (!t) fail('Команду не знайдено');
        const notes = [];
        if (method === 'PUT') {
          const c = cleanTeam(Object.assign({}, t, body));
          if (!c.name) fail('Вкажіть назву команди');
          Object.assign(t, c);
          if (Array.isArray(body.categories)) {
            const want = new Set(body.categories.filter(c => catOf(W, c)));
            const have = W.entries.filter(e => e.teamId === t.id);
            have.filter(e => !want.has(e.categoryId)).forEach(e => { W.entries = W.entries.filter(x => x.id !== e.id); W.runs = W.runs.filter(r => !(r.categoryId === e.categoryId && r.teamId === t.id)); notes.push(`Знято з «${catOf(W, e.categoryId).name}».`); notes.push(...adaptSchedule(W, catOf(W, e.categoryId))); });
            want.forEach(cid => { if (!have.some(e => e.categoryId === cid)) { W.entries.push(newEntry(W, cid, t.id)); notes.push(`Додано до «${catOf(W, cid).name}».`); notes.push(...adaptSchedule(W, catOf(W, cid))); } });
          }
          log('Змінено команду', `${t.name}. ${notes.join(' ')}`);
        } else if (method === 'DELETE') {
          const cats = W.entries.filter(e => e.teamId === t.id).map(e => e.categoryId);
          W.entries = W.entries.filter(e => e.teamId !== t.id);
          W.runs = W.runs.filter(r => r.teamId !== t.id);
          W.teams = W.teams.filter(x => x.id !== t.id);
          cats.forEach(cid => notes.push(...adaptSchedule(W, catOf(W, cid))));
          log('Видалено команду', `${t.name}. ${notes.join(' ')}`);
        }
        return { ok: true, notes };
      });
    }

    /* ----- Реєстрації ----- */
    if (p === '/api/entries' && method === 'POST') {
      return tx((W, u, log) => {
        const cat = catOf(W, body.categoryId);
        if (!cat || !W.teams.some(t => t.id === body.teamId)) fail('Невірні дані');
        if (W.entries.some(e => e.categoryId === cat.id && e.teamId === body.teamId)) fail('Команда вже зареєстрована в цій категорії');
        W.entries.push(newEntry(W, cat.id, body.teamId));
        const notes = adaptSchedule(W, cat);
        log(`${cat.name}: додано команду`, `${teamName(W, body.teamId)}. ${notes.join(' ')}`);
        return { ok: true, notes };
      });
    }
    if ((m = /^\/api\/entries\/([\w-]+)(\/move)?$/.exec(p))) {
      return tx((W, u, log) => {
        const e = W.entries.find(x => x.id === m[1]);
        if (!e) fail('Реєстрацію не знайдено');
        const cat = catOf(W, e.categoryId);
        let notes = [];
        if (m[2] && method === 'POST') {
          const to = catOf(W, body.categoryId);
          if (!to || to.id === cat.id) fail('Оберіть іншу категорію');
          if (W.entries.some(x => x.categoryId === to.id && x.teamId === e.teamId)) fail('Команда вже зареєстрована в цій категорії');
          W.runs = W.runs.filter(r => !(r.categoryId === cat.id && r.teamId === e.teamId));
          e.categoryId = to.id; e.group = null; e.order = W.entries.filter(x => x.categoryId === to.id).length + 1;
          notes = adaptSchedule(W, cat).concat(adaptSchedule(W, to));
          log('Перенесено команду', `${teamName(W, e.teamId)}: «${cat.name}» → «${to.name}». ${notes.join(' ')}`);
        } else if (method === 'PUT') {
          if (body.group !== undefined && RG.TYPES[cat.type].kind === 'match') {
            if (RG.GROUP_NAMES.indexOf(body.group) < 0) fail('Невірна група');
            e.group = body.group;
            notes = adaptSchedule(W, cat, { keepGroups: true });
          }
          if (body.order !== undefined) e.order = Number(body.order) || 0;
          log(`${cat.name}: зміна реєстрації`, `${teamName(W, e.teamId)}${body.group ? ' → група ' + body.group : ''}. ${notes.join(' ')}`);
        } else if (method === 'DELETE') {
          W.entries = W.entries.filter(x => x.id !== e.id);
          W.runs = W.runs.filter(r => !(r.categoryId === cat.id && r.teamId === e.teamId));
          notes = adaptSchedule(W, cat);
          log(`${cat.name}: команду знято`, `${teamName(W, e.teamId)}. ${notes.join(' ')}`);
        }
        return { ok: true, notes };
      });
    }

    /* ----- Категорії ----- */
    if ((m = /^\/api\/categories\/([\w-]+)(\/redraw|\/shuffle)?$/.exec(p))) {
      return tx((W, u, log) => {
        const cat = catOf(W, m[1]);
        if (!cat) fail('Категорію не знайдено');
        if (m[2] === '/redraw') {
          const notes = adaptSchedule(W, cat, { redraw: true });
          log(`${cat.name}: повторне жеребкування`, notes.join(' '));
          return { ok: true, notes };
        }
        if (m[2] === '/shuffle') {
          const list = shuffle(W.entries.filter(e => e.categoryId === cat.id));
          list.forEach((e, i) => { e.order = i + 1; });
          log(`${cat.name}: жеребкування порядку виступів`, list.map(e => teamName(W, e.teamId)).join(', '));
          return;
        }
        if (body.name) cat.name = String(body.name).trim();
        if (body.settings && typeof body.settings === 'object') cat.settings = Object.assign({}, cat.settings, body.settings);
        log(`${cat.name}: налаштування`, JSON.stringify(cat.settings));
      });
    }
    fail('Невідома операція');
  }

  /* ---------- Резервна копія ---------- */
  function backupJson() {
    const copy = clone(data);
    copy.users = copy.users.map(u => mode === 'local' ? u : { id: u.id, login: u.login, name: u.name, role: u.role, categories: u.categories });
    copy.exportedAt = new Date().toISOString();
    copy.mode = mode;
    return JSON.stringify(copy, null, 1);
  }

  /* ---------- Старт ---------- */
  function savedConfig() {
    // 1) ?fb=<base64 JSON> у посиланні  2) window.FIREBASE_CONFIG у файлі  3) localStorage
    try {
      const q = new URLSearchParams(location.search).get('fb');
      if (q) { const c = JSON.parse(decodeURIComponent(escape(atob(q)))); localStorage.setItem(LS_FB, JSON.stringify(c)); return c; }
    } catch (e) { console.warn('fb param', e); }
    try { const s = localStorage.getItem(LS_FB); if (s) { const c = JSON.parse(s); if (c.disabled) return null; return c; } } catch (e) { /* */ }
    if (window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.apiKey) return window.FIREBASE_CONFIG;
    return null;
  }
  async function start() {
    const cfg = savedConfig();
    if (cfg) {
      try { await initFirebase(cfg); return; } catch (e) { console.error(e); alert('Не вдалося підключитися до Firebase: ' + e.message + '\nСистема відкриється в локальному режимі.'); }
    }
    await initLocal();
  }
  function setFirebaseConfig(cfg) {
    try { localStorage.setItem(LS_FB, JSON.stringify(cfg || { disabled: true })); } catch (e) { /* */ }
    location.href = location.pathname + location.hash;
  }
  function shareLink() {
    if (!fbConfig) return location.origin + location.pathname;
    const b = btoa(unescape(encodeURIComponent(JSON.stringify(fbConfig))));
    return location.origin + location.pathname + '?fb=' + encodeURIComponent(b);
  }
  function resetLocal() { localStorage.removeItem(LS_DB); localStorage.removeItem(LS_SESSION); location.reload(); }

  return {
    start, state, rawData, handle, login, logout, onChange: f => listeners.push(f), bootstrapFirebase, setFirebaseConfig, shareLink, backupJson, resetLocal,
    get mode() { return mode; }, get offset() { return offset; },
    get needsBootstrap() { return mode === 'firebase' && fbReady && !fbAuthUser && fbHasUsers === false; },
    get fbSignedInNoProfile() { return mode === 'firebase' && !!fbAuthUser && !meId; },
    get fbConfig() { return fbConfig; }, emailDomain: EMAIL_DOMAIN
  };
})();
