'use strict';
/* Система суддівства RoboGames-2026. Запуск: node server.js  (Node.js 18+) */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const RG = require('./public/logic.js');
const DOCX = require('./lib/docx.js');
const DOCS = require('./lib/documents.js');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const PUBLIC = path.join(__dirname, 'public');
const DEFAULT_ADMIN_PASSWORD = 'robogames2026';

/* ---------------- База даних (JSON-файл) ---------------- */
let db;
const uid = (p) => (p || '') + crypto.randomBytes(5).toString('hex');

function hashPassword(pw, salt) {
  salt = salt || crypto.randomBytes(12).toString('hex');
  return { salt, hash: crypto.scryptSync(String(pw), salt, 32).toString('hex') };
}
function checkPassword(u, pw) {
  const h = crypto.scryptSync(String(pw), u.salt, 32).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(u.hash, 'hex'));
}

const CATEGORY_ORDER = ['delivery', 'basketball', 'football', 'sumo', 'maze', 'biathlon', 'smart'];

function initDb() {
  const seed = JSON.parse(fs.readFileSync(path.join(__dirname, 'lib', 'seed.json'), 'utf8'));
  const d = {
    version: 1,
    meta: {
      title: 'Обласні змагання з робототехніки «RoboGames-2026»',
      place: 'Полтавський університет економіки і торгівлі (ПУЕТ)',
      date: '', chairName: ''
    },
    users: [], sessions: {}, teams: seed.teams, categories: [], entries: [], matches: [], runs: [], log: [], timers: {}
  };
  CATEGORY_ORDER.forEach((type, i) => d.categories.push({ id: 'c_' + type, type, name: RG.TYPES[type].title, order: i, settings: {} }));
  seed.entries.forEach((e, i) => d.entries.push({ id: uid('e'), categoryId: 'c_' + e.category, teamId: e.teamId, group: null, order: i }));
  const pw = hashPassword(DEFAULT_ADMIN_PASSWORD);
  d.users.push({ id: 'u_admin', login: 'admin', name: 'Голова журі', role: 'admin', categories: [], salt: pw.salt, hash: pw.hash, defaultPassword: true });
  db = d;
  db.categories.forEach(c => adaptSchedule(c, { redraw: true, silent: true }));
  // порядок виступів в індивідуальних категоріях
  db.categories.forEach(c => { if (RG.TYPES[c.type].kind !== 'match') db.entries.filter(e => e.categoryId === c.id).forEach((e, i) => { e.order = i + 1; }); });
}

function load() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  if (fs.existsSync(DB_FILE)) {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    db.timers = db.timers || {};
    db.log = db.log || [];
  } else {
    initDb();
    save();
  }
}
let saveTimer = null;
function save() {
  db.version = (db.version || 0) + 1;
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DB_FILE);
}
function backup() {
  try {
    const name = 'db-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '.json';
    fs.writeFileSync(path.join(BACKUP_DIR, name), JSON.stringify(db));
    const files = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith('db-')).sort();
    while (files.length > 60) fs.unlinkSync(path.join(BACKUP_DIR, files.shift()));
  } catch (e) { console.error('backup', e.message); }
}

function logChange(user, action, details) {
  db.log.push({ ts: Date.now(), userId: user ? user.id : null, userName: user ? user.name : 'система', action, details });
  if (db.log.length > 5000) db.log.splice(0, db.log.length - 5000);
}

/* ---------------- Турнірна схема ---------------- */
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

function adaptSchedule(cat, opts) {
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
    // видаляємо всі матчі (жеребкування заново)
    db.matches = db.matches.filter(m => m.categoryId !== cat.id);
    matches = [];
    notes.push(`Проведено жеребкування: ${G} груп(и), ${N} команд.`);
  } else {
    if (groupStarted) G = Math.max(1, current.length || 1);
    const names = RG.GROUP_NAMES.slice(0, G);
    const count = g => entries.filter(e => e.group === g).length;
    // нові команди — у найменшу групу
    entries.filter(e => !e.group || names.indexOf(e.group) < 0).forEach(e => {
      const g = names.slice().sort((a, b) => count(a) - count(b))[0];
      e.group = g;
      notes.push(`Команду додано до групи ${g}.`);
    });
    // вирівнювання: переносимо команду без зіграних матчів із найбільшої групи до найменшої
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
  // матчі групового етапу: забезпечуємо всі пари в межах груп
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
  // ідеальний порядок: тури колової системи, чергуючи групи
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
  // плей-оф
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
  resolvePlayoff(cat);
  return notes;
}

function resolvePlayoff(cat) {
  const ms = db.matches.filter(m => m.categoryId === cat.id);
  const st = {}; ms.forEach(m => { if (m.stage !== 'group') st[m.stage] = m; });
  if (!st.sf1) return;
  const gm = ms.filter(m => m.stage === 'group');
  const complete = gm.length > 0 && gm.every(m => m.status === 'done');
  const entries = db.entries.filter(e => e.categoryId === cat.id);
  const valid = id => id && entries.some(e => e.teamId === id);
  const setTeams = (m, a, b) => {
    if (m.status !== 'scheduled' && valid(m.teamA) && valid(m.teamB)) return; // матч уже розпочато — не змінюємо
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

/* ---------------- HTTP ---------------- */
const clients = new Set();
function broadcast(obj) {
  const msg = `data: ${JSON.stringify(obj)}\n\n`;
  clients.forEach(res => { try { res.write(msg); } catch (e) { /* */ } });
}
function changed() { save(); broadcast({ type: 'state', version: db.version }); }

function send(res, code, body, headers) {
  const isBuf = Buffer.isBuffer(body);
  const data = isBuf || typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(code, Object.assign({ 'Content-Type': isBuf ? 'application/octet-stream' : typeof body === 'string' ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, headers || {}));
  res.end(data);
}
const fail = (res, code, msg) => send(res, code, { error: msg });

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > 20 * 1024 * 1024) { reject(new Error('too big')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
function cookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(p => { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}
function currentUser(req) {
  const sid = cookies(req).sid;
  const s = sid && db.sessions[sid];
  if (!s) return null;
  return db.users.find(u => u.id === s.userId) || null;
}
const canJudge = (u, catId) => u && (u.role === 'admin' || (u.categories || []).indexOf(catId) >= 0);
const publicUser = u => ({ id: u.id, login: u.login, name: u.name, role: u.role, categories: u.categories || [] });

function stateFor(u) {
  const admin = u.role === 'admin';
  return {
    version: db.version,
    serverNow: Date.now(),
    me: Object.assign(publicUser(u), { defaultPassword: !!u.defaultPassword }),
    meta: db.meta,
    categories: db.categories,
    teams: admin ? db.teams : db.teams.map(t => Object.assign({}, t, { members: (t.members || []).map(m => ({ surname: m.surname, name: m.name, patronymic: m.patronymic })) })),
    entries: db.entries,
    matches: db.matches,
    runs: db.runs,
    users: db.users.map(publicUser),
    timers: db.timers
  };
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json' };
function serveStatic(req, res, p) {
  let file = path.normalize(path.join(PUBLIC, p === '/' ? 'index.html' : p));
  if (!file.startsWith(PUBLIC)) return fail(res, 403, 'forbidden');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) file = path.join(PUBLIC, 'index.html');
    fs.readFile(file, (e, data) => {
      if (e) return fail(res, 404, 'not found');
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': path.extname(file) === '.png' ? 'max-age=86400' : 'no-cache' });
      res.end(data);
    });
  });
}

function cleanTeam(b) {
  const s = v => String(v === undefined || v === null ? '' : v).trim().slice(0, 300);
  return {
    name: s(b.name), school: s(b.school), settlement: s(b.settlement),
    members: (Array.isArray(b.members) ? b.members : []).map(m => ({ surname: s(m.surname), name: s(m.name), patronymic: s(m.patronymic), birthdate: s(m.birthdate) })).filter(m => m.surname || m.name)
  };
}

function matchSummary(cat, m) {
  return `${RG.STAGES[m.stage]}${m.group ? ' гр. ' + m.group : ''} №${m.order}: ${teamName(m.teamA)} — ${teamName(m.teamB)} ${RG.matchScore(cat.type, m.data, RG.settingsOf(cat)).text} [${m.status}]`;
}
const teamName = id => { const t = db.teams.find(t => t.id === id); return t ? t.name : '—'; };
const catById = id => db.categories.find(c => c.id === id);

async function api(req, res, url) {
  const p = url.pathname;
  const method = req.method;
  const u = currentUser(req);

  if (p === '/api/login' && method === 'POST') {
    const b = await readBody(req);
    const user = db.users.find(x => x.login.toLowerCase() === String(b.login || '').trim().toLowerCase());
    if (!user || !checkPassword(user, b.password || '')) return fail(res, 401, 'Невірний логін або пароль');
    const sid = crypto.randomBytes(24).toString('hex');
    db.sessions[sid] = { userId: user.id, created: Date.now() };
    save();
    return send(res, 200, { ok: true }, { 'Set-Cookie': `sid=${sid}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${60 * 60 * 24 * 14}` });
  }
  if (p === '/api/logout') {
    const sid = cookies(req).sid; if (sid) { delete db.sessions[sid]; save(); }
    return send(res, 200, { ok: true }, { 'Set-Cookie': 'sid=; Path=/; Max-Age=0' });
  }
  if (!u) return fail(res, 401, 'Потрібен вхід');
  const admin = u.role === 'admin';

  if (p === '/api/state' && method === 'GET') return send(res, 200, stateFor(u));

  if (p === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(`data: ${JSON.stringify({ type: 'hello', version: db.version, serverNow: Date.now() })}\n\n`);
    clients.add(res);
    const ping = setInterval(() => { try { res.write(`data: ${JSON.stringify({ type: 'ping', serverNow: Date.now() })}\n\n`); } catch (e) { /* */ } }, 20000);
    req.on('close', () => { clearInterval(ping); clients.delete(res); });
    return;
  }

  if (p === '/api/me/password' && method === 'PUT') {
    const b = await readBody(req);
    if (!checkPassword(u, b.old || '')) return fail(res, 400, 'Поточний пароль невірний');
    if (String(b.new || '').length < 6) return fail(res, 400, 'Новий пароль має містити щонайменше 6 символів');
    Object.assign(u, hashPassword(b.new)); delete u.defaultPassword;
    logChange(u, 'Зміна пароля', u.login);
    changed();
    return send(res, 200, { ok: true });
  }

  /* ----- Оцінювання матчів ----- */
  let m;
  if ((m = /^\/api\/matches\/([\w-]+)$/.exec(p)) && method === 'PUT') {
    const match = db.matches.find(x => x.id === m[1]);
    if (!match) return fail(res, 404, 'Матч не знайдено');
    const cat = catById(match.categoryId);
    if (!canJudge(u, cat.id)) return fail(res, 403, 'Ви не закріплені за цією категорією');
    if (!match.teamA || !match.teamB) return fail(res, 400, 'Учасники матчу ще не визначені');
    const b = await readBody(req);
    const before = matchSummary(cat, match);
    if (b.data && typeof b.data === 'object') match.data = b.data;
    if (['scheduled', 'live', 'done'].indexOf(b.status) >= 0) match.status = b.status;
    if (match.stage !== 'group' && match.status === 'done') {
      const sc = RG.matchScore(cat.type, match.data, RG.settingsOf(cat));
      if (sc.winner === 'D') return fail(res, 400, 'У плей-оф потрібен переможець: проведіть додатковий тайм/раунд або вкажіть переможця за рішенням судді');
    }
    match.updatedBy = u.id; match.updatedAt = Date.now();
    const after = matchSummary(cat, match);
    if (b.status || !b.silent) logChange(u, `${cat.name}: результат матчу`, `${before} → ${after}`);
    resolvePlayoff(cat);
    changed();
    return send(res, 200, { ok: true });
  }

  /* ----- Індивідуальні заїзди / оціночні листи ----- */
  if (p === '/api/runs' && method === 'PUT') {
    const b = await readBody(req);
    const cat = catById(b.categoryId);
    if (!cat) return fail(res, 404, 'Категорію не знайдено');
    if (!canJudge(u, cat.id)) return fail(res, 403, 'Ви не закріплені за цією категорією');
    if (!db.entries.some(e => e.categoryId === cat.id && e.teamId === b.teamId)) return fail(res, 400, 'Команда не зареєстрована в категорії');
    const round = Number(b.round) || 1;
    let judgeId = null;
    if (cat.type === 'smart') {
      judgeId = admin && b.judgeId ? b.judgeId : u.id;
      if (!admin && judgeId !== u.id) return fail(res, 403, 'Можна редагувати лише власні оцінки');
    }
    let r = db.runs.find(x => x.categoryId === cat.id && x.teamId === b.teamId && x.round === round && (x.judgeId || null) === judgeId);
    const before = r ? JSON.stringify(r.data) : '—';
    if (!r) { r = { id: uid('r'), categoryId: cat.id, teamId: b.teamId, round, judgeId, data: {}, status: 'live' }; db.runs.push(r); }
    if (b.data && typeof b.data === 'object') r.data = b.data;
    if (['live', 'done'].indexOf(b.status) >= 0) r.status = b.status;
    r.updatedBy = u.id; r.updatedAt = Date.now();
    logChange(u, `${cat.name}: ${cat.type === 'smart' ? 'оціночний лист' : 'раунд ' + round}`, `${teamName(b.teamId)}${judgeId ? ' (суддя ' + (db.users.find(x => x.id === judgeId) || {}).name + ')' : ''}: ${before} → ${JSON.stringify(r.data)} [${r.status}]`);
    changed();
    return send(res, 200, { ok: true, id: r.id });
  }
  if ((m = /^\/api\/runs\/([\w-]+)$/.exec(p)) && method === 'DELETE') {
    const r = db.runs.find(x => x.id === m[1]);
    if (!r) return fail(res, 404, 'Не знайдено');
    const cat = catById(r.categoryId);
    if (!canJudge(u, cat.id) || (cat.type === 'smart' && !admin && r.judgeId !== u.id)) return fail(res, 403, 'Немає доступу');
    db.runs = db.runs.filter(x => x !== r);
    logChange(u, `${cat.name}: видалено результат`, `${teamName(r.teamId)} раунд ${r.round}: ${JSON.stringify(r.data)}`);
    changed();
    return send(res, 200, { ok: true });
  }

  /* ----- Таймер ----- */
  if ((m = /^\/api\/timer\/([\w-]+)$/.exec(p)) && method === 'POST') {
    const cat = catById(m[1]);
    if (!cat) return fail(res, 404, 'Категорію не знайдено');
    if (!canJudge(u, cat.id)) return fail(res, 403, 'Немає доступу до таймера цієї категорії');
    const b = await readBody(req);
    const def = RG.TYPES[cat.type].timer;
    const set = RG.settingsOf(cat);
    let t = db.timers[cat.id] || { mode: def.mode, duration: (set.timerDuration || def.duration) * 1000, running: false, startedAt: 0, acc: 0, label: '' };
    const now = Date.now();
    const elapsed = () => t.acc + (t.running ? now - t.startedAt : 0);
    if (b.action === 'start' && !t.running) { t.running = true; t.startedAt = now; }
    else if (b.action === 'pause' && t.running) { t.acc = elapsed(); t.running = false; }
    else if (b.action === 'reset') { t.running = false; t.acc = 0; }
    else if (b.action === 'set') {
      t.running = false; t.acc = 0;
      if (b.mode === 'up' || b.mode === 'down') t.mode = b.mode;
      if (b.duration !== undefined) t.duration = Math.max(0, Number(b.duration) || 0) * 1000;
    } else if (b.action === 'adjust') { t.acc = Math.max(0, elapsed() - (Number(b.seconds) || 0) * 1000); if (t.running) t.startedAt = now; }
    if (b.label !== undefined) t.label = String(b.label).slice(0, 200);
    if (b.matchId !== undefined) t.matchId = b.matchId;
    t.updatedBy = u.name;
    db.timers[cat.id] = t;
    save();
    broadcast({ type: 'timer', categoryId: cat.id, timer: t, serverNow: now });
    return send(res, 200, { ok: true, timer: t, serverNow: now });
  }

  /* ----- Документи ----- */
  if ((m = /^\/api\/docs\/(protocol|summary|scorecards|overall|registry)$/.exec(p)) && method === 'GET') {
    const kind = m[1];
    const cat = url.searchParams.get('cat') ? catById(url.searchParams.get('cat')) : null;
    if (kind === 'registry' && !admin) return fail(res, 403, 'Лише для адміністратора');
    if (['protocol', 'summary', 'scorecards'].indexOf(kind) >= 0 && !cat) return fail(res, 400, 'Не вказано категорію');
    const doc = DOCS[kind](db, cat);
    const fname = `${doc.title}.docx`.replace(/[\\/:*?"<>|«»]/g, '');
    if (url.searchParams.get('format') === 'html') {
      const q = new URLSearchParams(url.searchParams); q.delete('format');
      return send(res, 200, DOCX.html(doc.blocks, { landscape: doc.landscape, title: doc.title, docxUrl: `${p}?${q}` }));
    }
    const buf = DOCX.build(doc.blocks, { landscape: doc.landscape, title: doc.title });
    return send(res, 200, buf, { 'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'Content-Disposition': `attachment; filename="robogames.docx"; filename*=UTF-8''${encodeURIComponent(fname)}` });
  }

  /* ===== Далі — лише адміністратор ===== */
  if (!admin) return fail(res, 403, 'Лише для адміністратора (Голови журі)');

  if (p === '/api/log' && method === 'GET') return send(res, 200, db.log.slice(-1500).reverse());
  if (p === '/api/backup' && method === 'GET') {
    const copy = Object.assign({}, db, { sessions: {} });
    return send(res, 200, Buffer.from(JSON.stringify(copy, null, 1)), { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="robogames-backup-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json"` });
  }
  if (p === '/api/restore' && method === 'POST') {
    const b = await readBody(req);
    if (!b || !Array.isArray(b.teams) || !Array.isArray(b.categories) || !Array.isArray(b.users)) return fail(res, 400, 'Файл не схожий на резервну копію системи');
    backup();
    const sessions = db.sessions;
    db = b; db.sessions = sessions; db.timers = db.timers || {}; db.log = db.log || [];
    logChange(u, 'Відновлення з резервної копії', '');
    changed();
    return send(res, 200, { ok: true });
  }
  if (p === '/api/meta' && method === 'PUT') {
    const b = await readBody(req);
    ['title', 'place', 'date', 'chairName'].forEach(k => { if (b[k] !== undefined) db.meta[k] = String(b[k]).slice(0, 300); });
    logChange(u, 'Налаштування змагань', JSON.stringify(db.meta));
    changed();
    return send(res, 200, { ok: true });
  }

  /* ----- Судді / користувачі ----- */
  if (p === '/api/users' && method === 'POST') {
    const b = await readBody(req);
    const login = String(b.login || '').trim();
    if (!login || !b.name || String(b.password || '').length < 4) return fail(res, 400, 'Вкажіть ПІБ, логін і пароль (від 4 символів)');
    if (db.users.some(x => x.login.toLowerCase() === login.toLowerCase())) return fail(res, 400, 'Такий логін уже існує');
    const pw = hashPassword(b.password);
    const nu = { id: uid('u'), login, name: String(b.name).trim(), role: b.role === 'admin' ? 'admin' : 'judge', categories: (b.categories || []).filter(catById), salt: pw.salt, hash: pw.hash };
    db.users.push(nu);
    logChange(u, 'Створено користувача', `${nu.name} (${nu.login}), ${nu.role}`);
    changed();
    return send(res, 200, { ok: true, id: nu.id });
  }
  if ((m = /^\/api\/users\/([\w-]+)$/.exec(p))) {
    const t = db.users.find(x => x.id === m[1]);
    if (!t) return fail(res, 404, 'Користувача не знайдено');
    if (method === 'PUT') {
      const b = await readBody(req);
      if (b.name) t.name = String(b.name).trim();
      if (b.login && b.login !== t.login) {
        if (db.users.some(x => x !== t && x.login.toLowerCase() === String(b.login).toLowerCase())) return fail(res, 400, 'Такий логін уже існує');
        t.login = String(b.login).trim();
      }
      if (b.role && t.id !== u.id) t.role = b.role === 'admin' ? 'admin' : 'judge';
      if (Array.isArray(b.categories)) t.categories = b.categories.filter(catById);
      if (b.password) { if (String(b.password).length < 4) return fail(res, 400, 'Пароль від 4 символів'); Object.assign(t, hashPassword(b.password)); delete t.defaultPassword; }
      logChange(u, 'Змінено користувача', `${t.name}: категорії ${t.categories.map(id => (catById(id) || {}).name).join(', ')}${b.password ? '; пароль змінено' : ''}`);
      changed();
      return send(res, 200, { ok: true });
    }
    if (method === 'DELETE') {
      if (t.id === u.id) return fail(res, 400, 'Не можна видалити самого себе');
      db.users = db.users.filter(x => x !== t);
      Object.keys(db.sessions).forEach(k => { if (db.sessions[k].userId === t.id) delete db.sessions[k]; });
      logChange(u, 'Видалено користувача', t.name);
      changed();
      return send(res, 200, { ok: true });
    }
  }

  /* ----- Команди ----- */
  if (p === '/api/teams' && method === 'POST') {
    const b = await readBody(req);
    const t = Object.assign({ id: uid('t') }, cleanTeam(b));
    if (!t.name) return fail(res, 400, 'Вкажіть назву команди');
    db.teams.push(t);
    const notes = [];
    (b.categories || []).filter(catById).forEach(cid => {
      db.entries.push({ id: uid('e'), categoryId: cid, teamId: t.id, group: null, order: db.entries.filter(e => e.categoryId === cid).length + 1 });
      notes.push(...adaptSchedule(catById(cid)));
    });
    logChange(u, 'Зареєстровано команду', `${t.name} (${t.school}); категорії: ${(b.categories || []).map(id => (catById(id) || {}).name).join(', ')}. ${notes.join(' ')}`);
    changed();
    return send(res, 200, { ok: true, id: t.id, notes });
  }
  if ((m = /^\/api\/teams\/([\w-]+)$/.exec(p))) {
    const t = db.teams.find(x => x.id === m[1]);
    if (!t) return fail(res, 404, 'Команду не знайдено');
    if (method === 'PUT') {
      const b = await readBody(req);
      const c = cleanTeam(Object.assign({}, t, b));
      if (!c.name) return fail(res, 400, 'Вкажіть назву команди');
      Object.assign(t, c);
      let notes = [];
      if (Array.isArray(b.categories)) {
        const want = new Set(b.categories.filter(catById));
        const have = db.entries.filter(e => e.teamId === t.id);
        have.filter(e => !want.has(e.categoryId)).forEach(e => { db.entries = db.entries.filter(x => x !== e); notes.push(`Знято з «${catById(e.categoryId).name}».`); notes.push(...adaptSchedule(catById(e.categoryId))); });
        want.forEach(cid => { if (!have.some(e => e.categoryId === cid)) { db.entries.push({ id: uid('e'), categoryId: cid, teamId: t.id, group: null, order: db.entries.filter(e => e.categoryId === cid).length + 1 }); notes.push(`Додано до «${catById(cid).name}».`); notes.push(...adaptSchedule(catById(cid))); } });
      }
      logChange(u, 'Змінено команду', `${t.name}. ${notes.join(' ')}`);
      changed();
      return send(res, 200, { ok: true, notes });
    }
    if (method === 'DELETE') {
      const cats = db.entries.filter(e => e.teamId === t.id).map(e => e.categoryId);
      db.entries = db.entries.filter(e => e.teamId !== t.id);
      db.runs = db.runs.filter(r => r.teamId !== t.id);
      db.teams = db.teams.filter(x => x !== t);
      const notes = [];
      cats.forEach(cid => notes.push(...adaptSchedule(catById(cid))));
      logChange(u, 'Видалено команду', `${t.name}. ${notes.join(' ')}`);
      changed();
      return send(res, 200, { ok: true, notes });
    }
  }

  /* ----- Реєстрації в категоріях ----- */
  if (p === '/api/entries' && method === 'POST') {
    const b = await readBody(req);
    const cat = catById(b.categoryId);
    if (!cat || !db.teams.some(t => t.id === b.teamId)) return fail(res, 400, 'Невірні дані');
    if (db.entries.some(e => e.categoryId === cat.id && e.teamId === b.teamId)) return fail(res, 400, 'Команда вже зареєстрована в цій категорії');
    db.entries.push({ id: uid('e'), categoryId: cat.id, teamId: b.teamId, group: null, order: db.entries.filter(e => e.categoryId === cat.id).length + 1 });
    const notes = adaptSchedule(cat);
    logChange(u, `${cat.name}: додано команду`, `${teamName(b.teamId)}. ${notes.join(' ')}`);
    changed();
    return send(res, 200, { ok: true, notes });
  }
  if ((m = /^\/api\/entries\/([\w-]+)(\/move)?$/.exec(p))) {
    const e = db.entries.find(x => x.id === m[1]);
    if (!e) return fail(res, 404, 'Реєстрацію не знайдено');
    const cat = catById(e.categoryId);
    if (m[2] && method === 'POST') {
      const b = await readBody(req);
      const to = catById(b.categoryId);
      if (!to || to.id === cat.id) return fail(res, 400, 'Оберіть іншу категорію');
      if (db.entries.some(x => x.categoryId === to.id && x.teamId === e.teamId)) return fail(res, 400, 'Команда вже зареєстрована в цій категорії');
      db.runs = db.runs.filter(r => !(r.categoryId === cat.id && r.teamId === e.teamId));
      e.categoryId = to.id; e.group = null; e.order = db.entries.filter(x => x.categoryId === to.id).length + 1;
      const notes = adaptSchedule(cat).concat(adaptSchedule(to));
      logChange(u, 'Перенесено команду', `${teamName(e.teamId)}: «${cat.name}» → «${to.name}». ${notes.join(' ')}`);
      changed();
      return send(res, 200, { ok: true, notes });
    }
    if (method === 'PUT') {
      const b = await readBody(req);
      const notes = [];
      if (b.group !== undefined && RG.TYPES[cat.type].kind === 'match') {
        if (RG.GROUP_NAMES.indexOf(b.group) < 0) return fail(res, 400, 'Невірна група');
        e.group = b.group;
        notes.push(...adaptSchedule(cat, { keepGroups: true }));
      }
      if (b.order !== undefined) e.order = Number(b.order) || 0;
      logChange(u, `${cat.name}: зміна реєстрації`, `${teamName(e.teamId)}${b.group ? ' → група ' + b.group : ''}. ${notes.join(' ')}`);
      changed();
      return send(res, 200, { ok: true, notes });
    }
    if (method === 'DELETE') {
      db.entries = db.entries.filter(x => x !== e);
      db.runs = db.runs.filter(r => !(r.categoryId === cat.id && r.teamId === e.teamId));
      const notes = adaptSchedule(cat);
      logChange(u, `${cat.name}: команду знято`, `${teamName(e.teamId)}. ${notes.join(' ')}`);
      changed();
      return send(res, 200, { ok: true, notes });
    }
  }

  /* ----- Категорії ----- */
  if ((m = /^\/api\/categories\/([\w-]+)(\/redraw|\/shuffle)?$/.exec(p))) {
    const cat = catById(m[1]);
    if (!cat) return fail(res, 404, 'Категорію не знайдено');
    if (m[2] === '/redraw' && method === 'POST') {
      const notes = adaptSchedule(cat, { redraw: true });
      logChange(u, `${cat.name}: повторне жеребкування`, notes.join(' '));
      changed();
      return send(res, 200, { ok: true, notes });
    }
    if (m[2] === '/shuffle' && method === 'POST') {
      const list = shuffle(db.entries.filter(e => e.categoryId === cat.id));
      list.forEach((e, i) => { e.order = i + 1; });
      logChange(u, `${cat.name}: жеребкування порядку виступів`, list.map(e => teamName(e.teamId)).join(', '));
      changed();
      return send(res, 200, { ok: true });
    }
    if (!m[2] && method === 'PUT') {
      const b = await readBody(req);
      if (b.name) cat.name = String(b.name).trim();
      if (b.settings && typeof b.settings === 'object') cat.settings = Object.assign({}, cat.settings, b.settings);
      logChange(u, `${cat.name}: налаштування`, JSON.stringify(cat.settings));
      changed();
      return send(res, 200, { ok: true });
    }
  }

  return fail(res, 404, 'Невідомий запит');
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    api(req, res, url).catch(e => { console.error(e); if (!res.headersSent) fail(res, 500, 'Помилка сервера: ' + e.message); });
  } else serveStatic(req, res, decodeURIComponent(url.pathname));
});

load();
setInterval(backup, 5 * 60 * 1000);
server.listen(PORT, '0.0.0.0', () => {
  const addrs = [];
  Object.values(os.networkInterfaces()).forEach(list => (list || []).forEach(a => { if (a.family === 'IPv4' && !a.internal) addrs.push(a.address); }));
  console.log('\n  Система суддівства RoboGames-2026 запущена');
  console.log(`  На цьому комп'ютері:  http://localhost:${PORT}`);
  addrs.forEach(a => console.log(`  Для суддів у мережі:  http://${a}:${PORT}`));
  if (db.users.some(x => x.defaultPassword)) console.log(`\n  Перший вхід: логін admin, пароль ${DEFAULT_ADMIN_PASSWORD} (змініть після входу!)`);
  console.log('  Дані зберігаються у файлі', DB_FILE, '\n');
});
