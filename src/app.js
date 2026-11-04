/* Система суддівства RoboGames-2026 — клієнтська частина */
'use strict';
const T = RG.TYPES;
let S = null;              // стан із сервера
let offset = 0;            // різниця годинника сервера
let pendingRender = false;
let soundOn = true;
const LOGOS = [
  { src: IMG.puet, alt: 'ПУЕТ' }, { src: IMG.pano, alt: 'ПАНО' }, { src: IMG.d2d3, alt: '2d:3d' }
];

/* ================= утиліти ================= */
const $ = s => document.querySelector(s);
const esc = s => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const team = id => (S.teams.find(t => t.id === id) || { name: '—', members: [] });
const tn = id => id ? team(id).name : null;
const cat = id => S.categories.find(c => c.id === id);
const cats = () => S.categories.slice().sort((a, b) => a.order - b.order);
const isAdmin = () => S && S.me.role === 'admin';
const canJudge = cid => isAdmin() || (S.me.categories || []).indexOf(cid) >= 0;
const judgesOf = cid => S.users.filter(u => u.role === 'judge' && (u.categories || []).indexOf(cid) >= 0);
const userName = id => (S.users.find(u => u.id === id) || {}).name || '';
const entriesOf = cid => S.entries.filter(e => e.categoryId === cid);
const matchesOf = cid => S.matches.filter(m => m.categoryId === cid).sort((a, b) => a.order - b.order);
const fmt = RG.fmtNum;
const now = () => Date.now() + offset;
const ccStyle = c => `--cc:${T[c.type].color}`;
const STATUS = { scheduled: 'заплановано', live: 'триває', done: 'завершено' };
const medal = p => p === 1 ? '🥇' : p === 2 ? '🥈' : p === 3 ? '🥉' : '';
function timeAgo(ts) { if (!ts) return ''; const d = new Date(ts); return d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' }); }

function toast(msg, err) {
  const d = document.createElement('div');
  if (err) d.className = 'err';
  d.textContent = msg;
  $('#toast').appendChild(d);
  setTimeout(() => d.remove(), err ? 6000 : 3500);
}
async function api(method, url, body) {
  try { return await Backend.handle(method, url, body); }
  catch (e) { toast(e.message || 'Помилка', true); throw e; }
}
function notes(j) { (j && j.notes || []).forEach(n => toast(n)); }

/* ================= дані та живі оновлення ================= */
function loadState() { S = Backend.state(); offset = Backend.offset; }
function updateDot() { const d = $('#dot'); if (d) { d.className = 'live-dot ok'; } }
Backend.onChange(() => {
  const prev = S;
  loadState();
  if (!S || !prev || prev.me.id !== S.me.id) { MS = null; render(); return; }
  refreshTimers(true);
  softRender();
});

function softRender() {
  // не заважаємо, коли користувач вводить дані
  const a = document.activeElement;
  if ($('.modal-bg') || (a && /INPUT|TEXTAREA|SELECT/.test(a.tagName) && a.closest('#main'))) { pendingRender = true; return; }
  render(true);
}
document.addEventListener('focusout', () => setTimeout(() => { if (pendingRender && !$('.modal-bg')) { const a = document.activeElement; if (!(a && /INPUT|TEXTAREA|SELECT/.test(a.tagName))) { pendingRender = false; render(true); } } }, 200));

/* ================= маршрутизація ================= */
function route() {
  const h = location.hash.replace(/^#\/?/, '');
  const parts = h.split('/').filter(Boolean);
  return { name: parts[0] || 'home', a: parts[1], b: parts[2] };
}
window.addEventListener('hashchange', () => { MS = null; render(); window.scrollTo(0, 0); });

function render(soft) {
  const app = $('#app');
  if (!S) { app.innerHTML = loginView(); return; }
  const r = route();
  if (r.name === 'timer') { app.innerHTML = timerFullView(r.a); refreshTimers(); return; }
  const y = window.scrollY;
  let body = '';
  try {
    if (r.name === 'home') body = homeView();
    else if (r.name === 'cat') body = catView(r.a, r.b);
    else if (r.name === 'match') body = matchView(r.a);
    else if (r.name === 'summary') body = summaryView();
    else if (r.name === 'teams' && isAdmin()) body = teamsView();
    else if (r.name === 'judges' && isAdmin()) body = judgesView();
    else if (r.name === 'settings' && isAdmin()) body = settingsView();
    else if (r.name === 'log' && isAdmin()) { body = logView(); }
    else body = homeView();
  } catch (e) { console.error(e); body = `<div class="notice">Помилка відображення: ${esc(e.message)}</div>`; }
  app.innerHTML = shell(r, body);
  if (r.name === 'log' && isAdmin()) loadLog();
  refreshTimers();
  if (soft) window.scrollTo(0, y);
}

function shell(r, body) {
  const nav = [['home', 'Огляд'], ['summary', 'Зведена таблиця']];
  if (isAdmin()) nav.push(['teams', 'Команди'], ['judges', 'Судді'], ['settings', 'Налаштування'], ['log', 'Журнал змін']);
  const curCat = r.name === 'cat' ? r.a : r.name === 'match' ? (S.matches.find(m => m.id === r.a) || {}).categoryId : null;
  return `
  <header class="topbar">
    <a class="brand" href="#/"><img src="${IMG.robogames}" alt="RoboGames-2026"><div><b>RoboGames-2026</b><span>Система суддівства</span></div></a>
    <nav class="nav">${nav.map(([k, l]) => `<a href="#/${k === 'home' ? '' : k}" class="${r.name === k ? 'on' : ''}">${l}</a>`).join('')}</nav>
    <div class="user"><span class="chip ${S.mode === 'firebase' ? 'done' : 'warn'}" title="${S.mode === 'firebase' ? 'Дані синхронізуються між усіма пристроями через Firebase' : 'Локальний режим: дані зберігаються лише в цьому браузері'}">${S.mode === 'firebase' ? '☁ онлайн' : '💾 локально'}</span>
      <div class="small" style="text-align:right"><b>${esc(S.me.name)}</b><br><span class="muted">${isAdmin() ? 'Голова журі / адміністратор' : 'Суддя'}</span></div>
      <button class="btn sm ghost" data-act="pw" title="Змінити пароль">🔑</button>
      <button class="btn sm ghost" data-act="logout">Вийти</button></div>
  </header>
  <div class="layout">
    <aside class="side"><h4>Категорії</h4>${cats().map(c => {
      const p = RG.progress(S, c);
      const pct = p.total ? Math.round(p.done / p.total * 100) : 0;
      return `<a href="#/cat/${c.id}" class="${curCat === c.id ? 'on' : ''}" style="${ccStyle(c)}"><span class="ic">${T[c.type].icon}</span><span class="nm">${esc(c.name)} ${canJudge(c.id) && !isAdmin() ? '<span class="mine">МОЯ</span>' : ''}${p.live ? ' <span class="chip live" style="padding:0 6px">LIVE</span>' : ''}<div class="pr">${p.done}/${p.total} · ${entriesOf(c.id).length} команд</div><div class="mini-bar"><i style="width:${pct}%"></i></div></span></a>`;
    }).join('')}
    <div class="partners">${LOGOS.map(l => `<div class="lg"><img src="${l.src}" alt="${l.alt}"></div>`).join('')}</div>
    </aside>
    <main class="main" id="main">
      ${S.me.defaultPassword ? `<div class="notice">⚠ Ви використовуєте стандартний пароль. <a href="#" data-act="pw">Змініть його</a> перед початком змагань.</div>` : ''}
      ${body}
    </main>
  </div>`;
}

/* ================= вхід ================= */
function loginView() {
  if (Backend.fbSignedInNoProfile) return `<div class="login card"><img class="main-logo" src="${IMG.robogames}" alt=""><h2>Немає доступу</h2><div class="muted">Цей обліковий запис не зареєстровано в системі суддівства (можливо, адміністратор його видалив).</div><button class="btn pri" style="margin-top:14px" data-act="logout">Вийти</button></div>`;
  const partners = `<div class="partners" style="border:none">${LOGOS.map(l => `<div class="lg"><img src="${l.src}" alt="${l.alt}"></div>`).join('')}</div>`;
  if (Backend.needsBootstrap) {
    return `<div class="login card">
    <img class="main-logo" src="${IMG.robogames}" alt="RoboGames-2026">
    <h2 style="margin-top:6px">Перший запуск із Firebase</h2>
    <div class="muted small">База даних Firebase порожня. Створіть обліковий запис Голови журі (адміністратора). Команди з Excel завантажаться автоматично.</div>
    <form id="bootForm">
      <label>ПІБ Голови журі</label><input name="name" required>
      <label>Логін (латиницею)</label><input name="login" required autocomplete="username">
      <label>Пароль (від 6 символів)</label><input name="password" type="password" required minlength="6" autocomplete="new-password">
      ${localHasData() ? '<label style="display:flex;gap:8px;align-items:center;color:var(--text)"><input type="checkbox" name="useLocal" style="width:18px;height:18px"> Перенести дані з локального режиму цього браузера</label>' : ''}
      <button class="btn pri lg" style="width:100%;margin-top:16px">Створити та увійти</button>
    </form>
    <div class="row" style="margin-top:10px;justify-content:center"><button class="btn sm ghost" data-act="fbSetup">⚙ Змінити підключення</button></div>${partners}</div>`;
  }
  const fbm = Backend.mode === 'firebase';
  return `<div class="login card">
    <img class="main-logo" src="${IMG.robogames}" alt="RoboGames-2026">
    <h2 style="margin-top:6px">Система суддівства</h2>
    <div class="muted small">Обласні змагання з робототехніки «RoboGames-2026»</div>
    <div style="margin-top:8px"><span class="chip ${fbm ? 'done' : 'warn'}">${fbm ? '☁ Спільний режим (Firebase): дані синхронізуються між пристроями' : '💾 Локальний режим: дані лише в цьому браузері'}</span></div>
    <form id="loginForm">
      <label>Логін</label><input name="login" autocomplete="username" autofocus>
      <label>Пароль</label><input name="password" type="password" autocomplete="current-password">
      <button class="btn pri lg" style="width:100%;margin-top:16px">Увійти</button>
    </form>
    ${!fbm ? '<div class="small muted" style="margin-top:10px">Перший вхід у локальному режимі: <b>admin</b> / <b>robogames2026</b></div>' : ''}
    <div class="row" style="margin-top:10px;justify-content:center"><button class="btn sm ghost" data-act="fbSetup">⚙ Підключення Firebase</button></div>
    ${partners}
  </div>`;
}
function localHasData() { try { return !!localStorage.getItem('robogames2026-db'); } catch (e) { return false; } }
function fbModal() {
  const cur = Backend.fbConfig;
  openModal(`<h2>☁ Підключення Firebase</h2>
  <div class="small muted">Вставте конфігурацію веб-застосунку з консолі Firebase (Project settings → Your apps → SDK setup and configuration → Config). Можна вставити весь фрагмент <code>const firebaseConfig = {...}</code>.</div>
  <form id="fbForm"><textarea name="cfg" rows="10" style="margin-top:10px;font-family:monospace;font-size:12px" placeholder='{ "apiKey": "...", "authDomain": "...", "databaseURL": "https://...firebasedatabase.app", "projectId": "...", "appId": "..." }'>${cur ? esc(JSON.stringify(cur, null, 1)) : ''}</textarea>
  <div class="row" style="margin-top:12px"><button class="btn pri">Підключити</button><button type="button" class="btn" data-act="closeModal">Скасувати</button>${cur ? '<button type="button" class="btn danger right" data-act="fbOff">Відключити на цьому пристрої</button>' : ''}</div></form>`);
}
function parseFbConfig(txt) {
  let t = String(txt || '').trim();
  const i = t.indexOf('{'), j = t.lastIndexOf('}');
  if (i < 0 || j < i) throw new Error('Не знайдено об’єкт конфігурації { ... }');
  t = t.slice(i, j + 1);
  let o;
  try { o = JSON.parse(t); } catch (e) {
    try { o = Function('"use strict";return (' + t + ')')(); } catch (e2) { throw new Error('Не вдалося прочитати конфігурацію'); }
  }
  if (!o || !o.apiKey || !o.projectId) throw new Error('У конфігурації немає apiKey або projectId');
  if (!o.databaseURL) throw new Error('У конфігурації немає databaseURL — спершу створіть Realtime Database у консолі Firebase і скопіюйте конфіг ще раз');
  return o;
}
document.addEventListener('submit', async ev => {
  if (ev.target.id === 'loginForm') {
    ev.preventDefault();
    const f = new FormData(ev.target);
    try {
      await Backend.login(f.get('login'), f.get('password'));
      loadState(); render();
    } catch (e) { toast(e.message, true); }
  }
});

/* ================= огляд ================= */
function nextMatch(cid) {
  const ms = matchesOf(cid);
  return ms.find(m => m.status === 'scheduled' && m.teamA && m.teamB);
}
function homeView() {
  const allMatches = S.matches.length, doneMatches = S.matches.filter(RG.isDone).length;
  const members = new Set(); S.entries.forEach(e => team(e.teamId).members.forEach(m => members.add(e.teamId + m.surname + m.name)));
  const live = S.matches.filter(m => m.status === 'live');
  const meta = S.meta || {};
  return `
  <div class="hero"><img src="${IMG.robogames}" alt="">
    <div><h1>${esc(meta.title || 'RoboGames-2026')}</h1><div class="muted">${esc([meta.place, meta.date && meta.date.split('-').reverse().join('.')].filter(Boolean).join(' · '))}</div>
    <div class="row" style="margin-top:10px">${LOGOS.map(l => `<span style="background:#fff;border-radius:8px;padding:4px 8px;display:inline-flex"><img src="${l.src}" style="height:30px" alt="${l.alt}"></span>`).join('')}</div></div></div>
  <div class="grid g4" style="margin-bottom:16px">
    <div class="card kpi"><b>${S.categories.length}</b><span>категорій</span></div>
    <div class="card kpi"><b>${new Set(S.entries.map(e => e.teamId)).size}</b><span>команд · ${S.entries.length} заявок</span></div>
    <div class="card kpi"><b>${members.size}</b><span>учасників</span></div>
    <div class="card kpi"><b>${doneMatches}<span class="muted" style="font-size:18px"> / ${allMatches}</span></b><span>матчів зіграно</span><div class="progress" style="margin-top:6px"><i class="d" style="width:${allMatches ? doneMatches / allMatches * 100 : 0}%"></i></div></div>
  </div>
  ${live.length ? `<div class="card" style="margin-bottom:16px;border-color:var(--red)"><h3>🔴 Зараз тривають</h3>${live.map(m => matchRow(m, cat(m.categoryId), { showCat: true })).join('')}</div>` : ''}
  <div class="grid g3">${cats().map(c => catCard(c)).join('')}</div>`;
}
function catCard(c) {
  const p = RG.progress(S, c);
  const rank = RG.ranking(S, c).filter(r => r.place).slice(0, 3);
  const nm = T[c.type].kind === 'match' ? nextMatch(c.id) : null;
  const j = judgesOf(c.id);
  return `<div class="card cat-card" style="${ccStyle(c)}" data-go="#/cat/${c.id}">
    <div class="row"><span class="big">${T[c.type].icon}</span><div class="grow"><h3 style="margin:0">${esc(c.name)}</h3><div class="small muted">${entriesOf(c.id).length} команд · судді: ${j.length ? esc(j.map(u => u.name).join(', ')) : '<i>не призначено</i>'}</div></div>${p.live ? '<span class="chip live">LIVE</span>' : ''}</div>
    <div class="row small" style="margin:10px 0 4px"><span>Проведено ${p.done} з ${p.total}</span><span class="right muted">${p.total ? Math.round(p.done / p.total * 100) : 0}%</span></div>
    <div class="progress"><i class="d" style="width:${p.total ? p.done / p.total * 100 : 0}%"></i><i class="l" style="width:${p.total ? p.live / p.total * 100 : 0}%"></i></div>
    ${nm ? `<div class="small" style="margin-top:10px"><span class="chip next">Наступний №${nm.order}</span> ${esc(tn(nm.teamA))} — ${esc(tn(nm.teamB))}</div>` : ''}
    ${rank.length ? `<div style="margin-top:10px">${rank.map(r => `<div class="small">${medal(r.place)} <b>${esc(tn(r.teamId))}</b> <span class="muted">${esc(r.resultText)}</span></div>`).join('')}</div>` : `<div class="small muted" style="margin-top:10px">Результатів ще немає</div>`}
  </div>`;
}

/* ================= категорія ================= */
function catTabs(c) {
  const k = T[c.type].kind;
  const tabs = k === 'match' ? [['matches', '📋 Матчі'], ['table', '🏆 Турнірна таблиця']]
    : k === 'scorecard' ? [['cards', '📝 Оціночні листи'], ['results', '🏆 Рейтинг']]
      : [['runs', '📝 Виступи та оцінювання'], ['results', '🏆 Рейтинг']];
  tabs.push(['timer', '⏱ Таймер'], ['docs', '📄 Протоколи'], ['teams', '👥 Учасники'], ['rules', 'ℹ Правила']);
  return tabs;
}
function catView(cid, tab) {
  const c = cat(cid);
  if (!c) return '<div class="empty">Категорію не знайдено</div>';
  const tabs = catTabs(c);
  tab = tab || tabs[0][0];
  const p = RG.progress(S, c);
  const j = judgesOf(c.id);
  let inner = '';
  if (tab === 'matches') inner = matchesTab(c);
  else if (tab === 'table') inner = tableTab(c);
  else if (tab === 'runs') inner = runsTab(c);
  else if (tab === 'cards') inner = cardsTab(c);
  else if (tab === 'results') inner = resultsTab(c);
  else if (tab === 'timer') inner = `<div style="max-width:620px">${timerHTML(c.id, { controls: canJudge(c.id), presets: true })}<div class="row" style="margin-top:10px"><a class="btn" href="#/timer/${c.id}" target="_blank">⛶ Відкрити табло на весь екран (для проєктора)</a></div></div>`;
  else if (tab === 'docs') inner = docsTab(c);
  else if (tab === 'teams') inner = teamsTab(c);
  else if (tab === 'rules') inner = `<div class="card flat" style="max-width:800px"><h3>${T[c.type].icon} ${esc(c.name)}: як рахуються бали</h3><p>${esc(T[c.type].rules)}</p>${T[c.type].kind === 'match' ? `<p class="muted small">Схема: команди розподіляються жеребкуванням на групи (до 5 команд — одна група, 6–15 — три групи, 16+ — чотири). У групах — колова система. До півфіналу виходять переможці груп і найкраща команда з других місць (Wildcard, за середнім показником очок за матч). Півфінал 1: найкращий переможець групи — Wildcard; півфінал 2: другий і третій переможці. Далі матч за 3-тє місце та фінал. При зміні кількості команд перелік матчів адаптується автоматично.</p>` : ''}</div>`;
  return `<div style="${ccStyle(c)}">
    <div class="row"><span style="font-size:40px">${T[c.type].icon}</span><div class="grow"><h1 style="margin:0">${esc(c.name)}</h1>
    <div class="muted small">${entriesOf(c.id).length} команд · проведено ${p.done} з ${p.total} · судді: ${j.length ? esc(j.map(u => u.name).join(', ')) : 'не призначено'}${canJudge(c.id) ? ' · <b style="color:var(--green)">у вас є право суддівства</b>' : ''}</div></div></div>
    <div class="progress" style="margin-top:10px"><i class="d" style="width:${p.total ? p.done / p.total * 100 : 0}%"></i><i class="l" style="width:${p.total ? p.live / p.total * 100 : 0}%"></i></div>
    <nav class="tabs">${tabs.map(([k, l]) => `<a href="#/cat/${c.id}/${k}" class="${k === tab ? 'on' : ''}">${l}</a>`).join('')}</nav>
    ${inner}</div>`;
}

/* ----- список матчів ----- */
let matchFilter = 'all';
function matchRow(m, c, o) {
  o = o || {};
  const set = RG.settingsOf(c);
  const sc = RG.matchScore(c.type, m.data, set);
  const w = RG.winnerOf(c, m);
  const stage = m.stage === 'group' ? `<span class="chip grp">Гр. ${esc(m.group)}</span>` : `<span class="chip" style="background:#3a2a10;color:#ffcf99">${RG.STAGES[m.stage]}</span>`;
  const st = o.next ? '<span class="chip next">НАСТУПНИЙ</span>' : o.missed ? '<span class="chip warn">⚠ пропущено?</span>' : `<span class="chip ${m.status === 'done' ? 'done' : m.status === 'live' ? 'live' : 'sched'}">${STATUS[m.status]}</span>`;
  const ready = m.teamA && m.teamB;
  const tA = m.teamA ? esc(tn(m.teamA)) : '<i class="muted">визначається</i>';
  const tB = m.teamB ? esc(tn(m.teamB)) : '<i class="muted">визначається</i>';
  return `<div class="match ${m.status} ${o.next ? 'next' : ''} ${o.missed ? 'missed' : ''}">
    <div class="no">${m.order}</div>
    <div class="tm r ${w && w === m.teamA ? 'win' : ''}">${tA}<small>${o.showCat ? T[c.type].icon + ' ' + esc(c.name) : ''}</small></div>
    <div class="sc">${m.status === 'scheduled' ? '<span class="muted">– : –</span>' : `${sc.a} : ${sc.b}`}</div>
    <div class="tm ${w && w === m.teamB ? 'win' : ''}">${tB}<small>${m.updatedBy && m.status !== 'scheduled' ? 'суддя: ' + esc(userName(m.updatedBy)) + ' · ' + timeAgo(m.updatedAt) : ''}</small></div>
    <div class="act">${stage} ${st} ${ready ? `<a class="btn sm ${canJudge(c.id) ? (m.status === 'done' ? '' : 'pri') : 'ghost'}" href="#/match/${m.id}">${canJudge(c.id) ? (m.status === 'done' ? '✏ Змінити' : m.status === 'live' ? '▶ Продовжити' : '▶ Судити') : '👁'}</a>` : ''}</div>
  </div>`;
}
function matchesTab(c) {
  const ms = matchesOf(c.id);
  if (!ms.length) return `<div class="empty">Матчів немає. Зареєструйте щонайменше 2 команди у вкладці «Учасники».</div>`;
  const lastPlayed = Math.max(0, ...ms.filter(m => m.status !== 'scheduled').map(m => m.order));
  const nm = nextMatch(c.id);
  const filt = ms.filter(m => matchFilter === 'all' || m.status === matchFilter || (matchFilter === 'missed' && m.status === 'scheduled' && m.order < lastPlayed));
  const cnt = s => ms.filter(m => m.status === s).length;
  const missed = ms.filter(m => m.status === 'scheduled' && m.order < lastPlayed && m.teamA).length;
  const groupMs = filt.filter(m => m.stage === 'group'), po = filt.filter(m => m.stage !== 'group');
  return `
  <div class="grid g4" style="margin-bottom:14px">
    <div class="card kpi flat"><b style="color:#4ade80">${cnt('done')}</b><span>завершено</span></div>
    <div class="card kpi flat"><b style="color:#fca5a5">${cnt('live')}</b><span>триває</span></div>
    <div class="card kpi flat"><b>${cnt('scheduled')}</b><span>заплановано</span></div>
    <div class="card kpi flat"><b style="color:${missed ? 'var(--yellow)' : 'inherit'}">${missed}</b><span>пропущено в черзі</span></div>
  </div>
  ${nm ? `<div class="notice info row"><span class="chip next">Наступний матч №${nm.order}</span> <b>${esc(tn(nm.teamA))}</b> vs <b>${esc(tn(nm.teamB))}</b> <span class="muted">${nm.stage === 'group' ? 'група ' + esc(nm.group) : RG.STAGES[nm.stage]}</span>${canJudge(c.id) ? `<a class="btn sm org right" href="#/match/${nm.id}">▶ Почати</a>` : ''}</div>` : ms.every(RG.isDone) ? '<div class="notice info">🏁 Усі матчі категорії завершено.</div>' : ''}
  <div class="filters">${[['all', 'Усі'], ['scheduled', 'Заплановані'], ['live', 'Тривають'], ['done', 'Завершені'], ['missed', '⚠ Пропущені']].map(([k, l]) => `<button class="btn sm ${matchFilter === k ? 'pri' : ''}" data-act="mfilter" data-v="${k}">${l}</button>`).join('')}</div>
  ${groupMs.length ? `<h3>Груповий етап</h3>${groupMs.map(m => matchRow(m, c, { next: nm && nm.id === m.id, missed: m.status === 'scheduled' && m.order < lastPlayed })).join('')}` : ''}
  ${po.length ? `<h3 style="margin-top:18px">Плей-оф («Фінал чотирьох»)</h3>${po.map(m => matchRow(m, c, { next: nm && nm.id === m.id })).join('')}` : ''}
  ${!filt.length ? '<div class="empty">Немає матчів за цим фільтром</div>' : ''}`;
}

/* ----- турнірна таблиця ----- */
function tableTab(c) {
  const entries = entriesOf(c.id), ms = matchesOf(c.id);
  if (!entries.length) return '<div class="empty">Немає команд</div>';
  const q = RG.qualifiers(c, entries, ms);
  const set = RG.settingsOf(c);
  const gDone = ms.filter(m => m.stage === 'group').every(RG.isDone);
  const multi = q.tables.length > 1;
  const groupsHtml = q.tables.map(g => {
    const gm = ms.filter(m => m.stage === 'group' && m.group === g.name);
    const ids = g.rows.map(r => r.teamId);
    const qual = id => q.seeds.indexOf(id) >= 0 && id !== q.wildcard;
    const cross = `<div class="tbl-wrap"><table class="cross"><tr><th></th>${ids.map((id, i) => `<th title="${esc(tn(id))}">${i + 1}</th>`).join('')}</tr>${ids.map((a, i) => `<tr><th style="text-align:left">${i + 1}. ${esc(tn(a))}</th>${ids.map(b => {
      if (a === b) return '<td class="x"></td>';
      const m = gm.find(m => (m.teamA === a && m.teamB === b) || (m.teamA === b && m.teamB === a));
      if (!m) return '<td>—</td>';
      if (m.status === 'scheduled') return `<td class="muted" data-go="#/match/${m.id}" style="cursor:pointer">№${m.order}</td>`;
      const sc = RG.matchScore(c.type, m.data, set);
      const my = m.teamA === a ? sc.a : sc.b, op = m.teamA === a ? sc.b : sc.a;
      return `<td class="${m.status === 'live' ? '' : my > op ? 'w' : my < op ? 'l' : 'd'}" data-go="#/match/${m.id}" style="cursor:pointer">${my}:${op}${m.status === 'live' ? ' 🔴' : ''}</td>`;
    }).join('')}</tr>`).join('')}</table></div>`;
    return `<div class="card flat"><h3>Група ${esc(g.name)} <span class="muted small">${gm.filter(RG.isDone).length}/${gm.length} матчів</span></h3>
    <div class="tbl-wrap"><table class="t standings"><tr><th>#</th><th>Команда</th><th class="c">І</th><th class="c">В</th><th class="c">Н</th><th class="c">П</th><th class="c" title="Ігрові очки забиті–пропущені">Ігр. очки</th><th class="c" title="Перемога 3, нічия 1">Очки</th><th class="c" title="Середні очки за матч">Сер.</th><th class="c" title="Бали за регламентом">Бали</th></tr>
    ${g.rows.map(r => `<tr class="${qual(r.teamId) ? 'q' : r.teamId === q.wildcard ? 'wc' : ''}"><td>${r.pos}</td><td><b>${esc(tn(r.teamId))}</b> ${qual(r.teamId) ? `<span class="chip done">${gDone ? 'у плей-оф' : 'зона плей-оф'}</span>` : r.teamId === q.wildcard ? '<span class="chip warn">Wildcard</span>' : ''}</td><td class="c">${r.p}</td><td class="c">${r.w}</td><td class="c">${r.d}</td><td class="c">${r.l}</td><td class="c">${r.gf}–${r.ga}</td><td class="c num">${r.pts}</td><td class="c">${fmt(r.avgPts, 2)}</td><td class="c">${r.rp}</td></tr>`).join('')}</table></div>
    <div style="margin-top:10px">${cross}</div></div>`;
  }).join('');
  const st = {}; ms.forEach(m => { if (m.stage !== 'group') st[m.stage] = m; });
  const bm = (m, lbl) => {
    if (!m) return '';
    const sc = RG.matchScore(c.type, m.data, set);
    const w = RG.winnerOf(c, m);
    const side = (id, s, ph) => `<div class="s ${id ? (w === id ? 'win' : '') : 'tbd'}"><span>${id ? esc(tn(id)) : esc(ph)}</span><span>${m.status !== 'scheduled' ? s : ''}</span></div>`;
    return `<div class="bm ${m.status}" data-go="${m.teamA && m.teamB ? '#/match/' + m.id : ''}"><div class="h"><span>${lbl}</span><span>${m.status === 'live' ? '🔴 LIVE' : m.status === 'done' ? '✔' : '№' + m.order}</span></div>${side(m.teamA, sc.a, ph(m, 'A', q))}${side(m.teamB, sc.b, ph(m, 'B', q))}</div>`;
  };
  const rank = RG.ranking(S, c);
  const finalDone = st.final && RG.isDone(st.final);
  const podium = finalDone ? podiumHTML(rank) : '';
  return `${podium}
  <div class="notice info small">🟩 — команди, що проходять до плей-оф${multi ? ' (переможці груп)' : ''}; 🟨 — Wildcard (найкраще 2-ге місце за середнім показником очок за матч). ${gDone ? 'Груповий етап завершено.' : 'Груповий етап триває — показано поточний розклад сил.'}</div>
  <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(min(420px,100%),1fr))">${groupsHtml}</div>
  ${st.sf1 ? `<h2 style="margin-top:22px">Плей-оф</h2>
  <div class="bracket"><div class="bcol">${bm(st.sf1, 'Півфінал 1')}${bm(st.sf2, 'Півфінал 2')}</div><div class="bconn">⟩</div><div class="bcol">${bm(st.final, '🏆 Фінал (1–2 місце)')}${bm(st.third, '🥉 Матч за 3-тє місце')}</div></div>
  ${!gDone ? `<div class="small muted" style="margin-top:8px">Прогноз за поточною таблицею: ${q.seeds.filter(Boolean).map((id, i) => `${i + 1}) ${esc(tn(id))}`).join(', ')}</div>` : ''}` : ''}
  <h2 style="margin-top:22px">Загальний рейтинг ${finalDone ? '(фінальний)' : '(проміжний)'}</h2>${rankTable(c, rank)}`;
}
function ph(m, side, q) {
  const L = q.labels || [];
  if (m.stage === 'sf1') return side === 'A' ? (L[0] || 'Переможець') : (L[3] || 'Wildcard');
  if (m.stage === 'sf2') return side === 'A' ? (L[1] || 'Переможець') : (L[2] || 'Переможець');
  if (m.stage === 'final') return side === 'A' ? 'Переможець ПФ1' : 'Переможець ПФ2';
  if (m.stage === 'third') return side === 'A' ? 'Переможений ПФ1' : 'Переможений ПФ2';
  return '';
}
function podiumHTML(rank) {
  const r = i => rank.find(x => x.place === i);
  const p = (i) => r(i) ? `<div class="p p${i}"><div class="nm">${esc(tn(r(i).teamId))}</div><div class="small muted">${esc(team(r(i).teamId).school || '').slice(0, 60)}</div><div class="blk">${i}</div></div>` : '';
  return `<div class="card" style="margin-bottom:16px"><div class="podium">${p(2)}${p(1)}${p(3)}</div></div>`;
}
function rankTable(c, rank) {
  const k = T[c.type].kind;
  const maxV = Math.max(1, ...rank.map(r => Math.abs(Number(c.type === 'maze' ? r.points : r.result) || 0)));
  return `<div class="tbl-wrap"><table class="t"><tr><th class="c">Місце</th><th>Команда</th><th>Заклад освіти / населений пункт</th>${k === 'match' ? '<th class="c">В-Н-П</th>' : '<th>Результат</th>'}<th style="min-width:180px">Бали</th></tr>
  ${rank.map(r => {
    const t = team(r.teamId);
    const v = c.type === 'maze' ? r.points : r.result;
    return `<tr><td class="c num">${r.place ? medal(r.place) + ' ' + r.place : '—'}</td><td><b>${esc(t.name)}</b></td><td class="small">${esc(t.school)}<br><span class="muted">${esc(t.settlement)}</span></td>${k === 'match' ? `<td class="c nowrap">${esc(r.resultText)}</td>` : `<td>${esc(r.resultText)}</td>`}<td><div class="hbar"><div class="bar"><i style="width:${v ? Math.max(3, Math.abs(v) / maxV * 100) : 0}%"></i></div><b class="num">${v === null || v === undefined ? '—' : fmt(v, 2)}</b></div></td></tr>`;
  }).join('')}</table></div>`;
}

/* ----- індивідуальні виступи ----- */
function runOf(cid, teamId, round, judgeId) { return S.runs.find(r => r.categoryId === cid && r.teamId === teamId && r.round === round && (r.judgeId || null) === (judgeId || null)); }
function runsTab(c) {
  const ents = entriesOf(c.id).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
  if (!ents.length) return '<div class="empty">Немає команд</div>';
  const rounds = T[c.type].rounds;
  const can = canJudge(c.id);
  let nextFound = false;
  const rows = ents.map((e, i) => {
    const cells = [];
    for (let rn = 1; rn <= rounds; rn++) {
      const r = runOf(c.id, e.teamId, rn);
      let txt = '<span class="muted">—</span>', cls = 'sched';
      if (r) {
        const s = RG.runScore(c, r.data);
        txt = c.type === 'delivery' ? `<b>${s.total}</b> б <span class="muted small">(${s.delivered} вант., −${s.outside}, книга ${s.book}${s.time ? ', ' + fmt(s.time, 2) + ' с' : ''})</span>` : (s.finished ? `<b>${fmt(s.adj, 2)} с</b> <span class="muted small">(${fmt(s.time, 2)} с + ${s.touches} торк.)</span>` : `<span class="chip warn">не фінішував</span> <span class="muted small">${s.touches} торк.</span>`);
        cls = r.status;
      }
      let isNext = false;
      if (!r && !nextFound) { nextFound = true; isNext = true; }
      cells.push(`<td>${isNext ? '<span class="chip next">НАСТУПНИЙ</span> ' : ''}${r ? `<span class="chip ${cls}">${STATUS[cls]}</span> ` : ''}${txt} ${can ? `<button class="btn sm ${r ? '' : 'pri'}" data-act="run" data-team="${e.teamId}" data-round="${rn}">${r ? '✏' : '▶ Оцінити'}</button>` : ''}</td>`);
    }
    return `<tr><td class="c num">${e.order || i + 1}</td><td><b>${esc(tn(e.teamId))}</b><div class="small muted">${esc(team(e.teamId).school).slice(0, 80)}</div></td>${cells.join('')}</tr>`;
  }).join('');
  return `${c.type === 'maze' ? `<div class="notice info small">Штраф за торкання стінки: +${RG.settingsOf(c).penaltySec} с. Рейтинг: ${RG.settingsOf(c).rankMode === 'sum' ? 'сума двох раундів' : 'найкращий з двох раундів'}. Час можна взяти з секундоміра категорії.</div>` : ''}
  <div class="grid" style="grid-template-columns:minmax(0,1fr) 340px;align-items:start">
  <div class="card flat tbl-wrap"><table class="t"><tr><th class="c">Черга</th><th>Команда</th>${Array.from({ length: rounds }, (_, i) => `<th>${rounds > 1 ? 'Раунд ' + (i + 1) : 'Заїзд'}</th>`).join('')}</tr>${rows}</table></div>
  <div>${timerHTML(c.id, { controls: can, presets: true, compact: true })}</div></div>`;
}

/* ----- оціночні листи (Smart) ----- */
let cardsJudge = null;
function cardsTab(c) {
  const ents = entriesOf(c.id);
  if (!ents.length) return '<div class="empty">Немає команд</div>';
  const set = RG.settingsOf(c);
  const judges = judgesOf(c.id);
  const me = S.me;
  let jid = isAdmin() ? (cardsJudge || (judges[0] && judges[0].id) || me.id) : me.id;
  const opts = isAdmin() ? `<div class="row" style="margin-bottom:12px"><label style="margin:0">Оціночний лист судді:</label><select data-change="cardsJudge" style="max-width:300px">${judges.concat(judges.some(j => j.id === me.id) ? [] : [me]).map(j => `<option value="${j.id}" ${j.id === jid ? 'selected' : ''}>${esc(j.name)}</option>`).join('')}</select>${!judges.length ? '<span class="small muted">Суддів не закріплено — оцінки вносить адміністратор.</span>' : ''}</div>` : '';
  const can = canJudge(c.id);
  const allJ = Array.from(new Set(judges.map(j => j.id).concat(S.runs.filter(r => r.categoryId === c.id).map(r => r.judgeId))));
  const rows = ents.map(e => {
    const r = runOf(c.id, e.teamId, 1, jid);
    const sc = (r && r.data.scores) || {};
    const total = r ? RG.runScore(c, r.data).total : null;
    return `<tr><td><b>${esc(tn(e.teamId))}</b><div class="small muted">${esc(team(e.teamId).school).slice(0, 70)}</div></td>${set.criteria.map(k => `<td class="c">${r ? (sc[k.key] || 0) : '<span class="muted">·</span>'}</td>`).join('')}<td class="c num">${total === null ? '—' : total}</td><td>${r ? `<span class="chip ${r.status}">${STATUS[r.status]}</span>` : ''} ${can ? `<button class="btn sm ${r ? '' : 'pri'}" data-act="card" data-team="${e.teamId}" data-judge="${jid}">${r ? '✏ Змінити' : '▶ Оцінити'}</button>` : ''}</td></tr>`;
  }).join('');
  const matrix = `<h3 style="margin-top:18px">Оцінки всіх суддів</h3><div class="tbl-wrap"><table class="t"><tr><th>Команда</th>${allJ.map(j => `<th class="c">${esc(userName(j) || 'суддя')}</th>`).join('')}<th class="c">Середній</th></tr>${RG.ranking(S, c).map(rk => `<tr><td>${medal(rk.place)} <b>${esc(tn(rk.teamId))}</b></td>${allJ.map(j => { const r = runOf(c.id, rk.teamId, 1, j); return `<td class="c">${r ? RG.runScore(c, r.data).total : '—'}</td>`; }).join('')}<td class="c num">${rk.result === null ? '—' : fmt(rk.result, 2)}</td></tr>`).join('')}</table></div>`;
  return `${opts}<div class="card flat tbl-wrap"><table class="t"><tr><th>Команда</th>${set.criteria.map(k => `<th class="c" title="${esc(k.label)}">${esc(k.label.split(' (')[0])}<br><span class="muted">0–${k.max}${k.round === 2 ? ', раунд 2' : ''}</span></th>`).join('')}<th class="c">Сума</th><th></th></tr>${rows}</table></div>${matrix}`;
}

function resultsTab(c) {
  const rank = RG.ranking(S, c);
  if (!rank.length) return '<div class="empty">Немає команд</div>';
  const p = RG.progress(S, c);
  return `${p.done >= p.total && p.total ? podiumHTML(rank) : `<div class="notice info small">Проміжні результати: оцінено ${p.done} з ${p.total}.</div>`}${rankTable(c, rank)}`;
}

/* ----- документи ----- */
function docsTab(c) {
  const doc = (kind, title, desc) => `<div class="card flat"><h3>${title}</h3><div class="small muted" style="min-height:38px">${desc}</div><div class="row" style="margin-top:10px"><button class="btn pri" data-act="doc" data-kind="${kind}" data-cat="${c.id}">⬇ Word (.docx)</button><button class="btn" data-act="doc" data-kind="${kind}" data-cat="${c.id}" data-format="html">🖨 Друк / PDF</button></div></div>`;
  return `<div class="grid g3">
    ${doc('protocol', '📄 Протокол суддівства', 'Усі матчі/виступи з рахунками, турнірні таблиці, плей-оф, підсумковий рейтинг. Місця для підписів суддів категорії та Голови журі.')}
    ${doc('summary', '📊 Зведена відомість', 'Місця команд із закладом освіти, населеним пунктом, складом учасників і балами. Підписи суддів і Голови журі.')}
    ${c.type === 'smart' ? doc('scorecards', '📝 Оціночні листи суддів', 'Окремий аркуш для кожного судді з балами за критеріями та місцем для підпису.') : ''}
    ${isAdmin() ? doc('registry', '👥 Реєстраційна відомість', 'Команди категорії з учасниками та датами народження (лише для адміністратора).') : ''}
  </div><div class="small muted" style="margin-top:10px">Документи формуються з поточних даних. Імена суддів беруться з облікових записів, закріплених за категорією; ПІБ Голови журі — у «Налаштуваннях».</div>`;
}

/* ----- учасники категорії ----- */
function teamsTab(c) {
  const ents = entriesOf(c.id).slice().sort((a, b) => (a.group || '').localeCompare(b.group || '') || (a.order || 0) - (b.order || 0));
  const k = T[c.type].kind;
  const adm = isAdmin();
  const others = S.teams.filter(t => !ents.some(e => e.teamId === t.id)).sort((a, b) => a.name.localeCompare(b.name));
  const groups = RG.GROUP_NAMES.slice(0, Math.max(1, new Set(ents.map(e => e.group).filter(Boolean)).size));
  return `${adm ? `<div class="card flat" style="margin-bottom:14px"><div class="row">
    <select id="addTeamSel" style="max-width:340px"><option value="">— додати зареєстровану команду —</option>${others.map(t => `<option value="${t.id}">${esc(t.name)} (${esc(t.school).slice(0, 50)})</option>`).join('')}</select>
    <button class="btn pri" data-act="addEntry" data-cat="${c.id}">+ Додати</button>
    <button class="btn" data-act="newTeam" data-cat="${c.id}">+ Нова команда</button>
    <span class="grow"></span>
    ${k === 'match' ? `<button class="btn org" data-act="redraw" data-cat="${c.id}">🎲 Повторне жеребкування груп</button>` : `<button class="btn org" data-act="shuffle" data-cat="${c.id}">🎲 Жеребкування черги виступів</button>`}
  </div><div class="small muted" style="margin-top:8px">Після додавання, зняття чи перенесення команди перелік матчів адаптується автоматично: нова команда потрапляє до найменшої групи, зіграні матчі зберігаються.</div></div>` : ''}
  <div class="card flat tbl-wrap"><table class="t"><tr>${k === 'match' ? '<th>Група</th>' : '<th class="c">Черга</th>'}<th>Команда</th><th>Заклад освіти</th><th>Населений пункт</th><th>Учасники</th>${adm ? '<th></th>' : ''}</tr>
  ${ents.map(e => {
    const t = team(e.teamId);
    return `<tr><td>${k === 'match' ? (adm ? `<select data-change="group" data-id="${e.id}" style="width:70px">${groups.map(g => `<option ${g === e.group ? 'selected' : ''}>${g}</option>`).join('')}</select>` : `<span class="chip grp">${esc(e.group || '—')}</span>`) : `<span class="num">${e.order || ''}</span>`}</td>
    <td><b>${esc(t.name)}</b></td><td class="small">${esc(t.school)}</td><td class="small">${esc(t.settlement) || '<span class="muted">—</span>'}</td>
    <td class="small">${(t.members || []).map(m => esc([m.surname, m.name].join(' ')) + (m.birthdate ? ` <span class="muted">${m.birthdate.split('-').reverse().join('.')}</span>` : '')).join('<br>')}</td>
    ${adm ? `<td class="nowrap"><button class="btn sm" data-act="editTeam" data-id="${t.id}">✏</button>
      <select data-change="move" data-id="${e.id}" style="width:auto;display:inline-block"><option value="">Перенести в…</option>${cats().filter(x => x.id !== c.id).map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select>
      <button class="btn sm danger" data-act="delEntry" data-id="${e.id}">Зняти</button></td>` : ''}</tr>`;
  }).join('')}</table>${!ents.length ? '<div class="empty">Команд немає</div>' : ''}</div>`;
}

/* ================= суддівство матчу ================= */
let MS = null;  // {id, data, dirty}
let saveT = null;
function matchView(id) {
  const m = S.matches.find(x => x.id === id);
  if (!m) return '<div class="empty">Матч не знайдено</div>';
  const c = cat(m.categoryId);
  const set = RG.settingsOf(c);
  if (!MS || MS.id !== id || (!MS.dirty && !saveT)) MS = { id, data: JSON.parse(JSON.stringify(m.data || RG.emptyMatchData(c.type))), status: m.status };
  const d = MS.data;
  const sc = RG.matchScore(c.type, d, set);
  const can = canJudge(c.id) && m.teamA && m.teamB;
  const po = m.stage !== 'group';
  const A = tn(m.teamA) || 'визначається', B = tn(m.teamB) || 'визначається';
  const canEdit = can && MS.status !== 'done';
  let pad = '';
  if (c.type === 'basketball') pad = basketPad(d, A, B, canEdit);
  else if (c.type === 'football') pad = footPad(d, A, B, canEdit);
  else if (c.type === 'sumo') pad = sumoPad(d, A, B, canEdit);
  else if (c.type === 'biathlon') pad = biaPad(d, A, B, canEdit, set);
  const tie = sc.a === sc.b;
  const tb = po && tie && (sc.a > 0 || (d.halves || d.rounds || []).length || c.type === 'basketball') ? `<div class="card flat" style="margin-top:14px;border-color:var(--yellow)"><h3>⚖ Нічия у плей-оф — потрібен переможець</h3><div class="small muted">${c.type === 'football' ? 'Проведіть третій тайм (60 с) або вкажіть переможця за рішенням судді.' : c.type === 'sumo' ? 'Проведіть додатковий раунд або вкажіть переможця за рішенням судді.' : 'Вкажіть переможця за рішенням судді (додатковий час / повтор).'}</div>
    <div class="seg" style="margin-top:8px"><button class="btn ${d.tb === 'A' ? 'on-A' : ''}" data-act="tb" data-v="A" ${canEdit ? '' : 'disabled'}>${esc(A)}</button><button class="btn ${d.tb === 'B' ? 'on-B' : ''}" data-act="tb" data-v="B" ${canEdit ? '' : 'disabled'}>${esc(B)}</button><button class="btn" data-act="tb" data-v="" ${can ? '' : 'disabled'}>скасувати</button></div></div>` : '';
  const ms = matchesOf(c.id);
  const idx = ms.findIndex(x => x.id === id);
  const nextM = ms.slice(idx + 1).find(x => x.status !== 'done' && x.teamA && x.teamB);
  const hist = (S.matchLog || []);
  return `<div style="${ccStyle(c)}">
  <div class="row" style="margin-bottom:10px"><a class="btn sm ghost" href="#/cat/${c.id}/matches">← ${T[c.type].icon} ${esc(c.name)}</a><span class="chip ${m.status === 'done' ? 'done' : m.status === 'live' ? 'live' : 'sched'}">${STATUS[m.status]}</span><span class="chip grp">${m.stage === 'group' ? 'Група ' + esc(m.group) : RG.STAGES[m.stage]} · матч №${m.order}</span>${m.updatedBy ? `<span class="small muted">останні зміни: ${esc(userName(m.updatedBy))}, ${timeAgo(m.updatedAt)}</span>` : ''}
    ${nextM ? `<a class="btn sm right" href="#/match/${nextM.id}">Наступний: №${nextM.order} ${esc(tn(nextM.teamA))} — ${esc(tn(nextM.teamB))} →</a>` : ''}</div>
  ${!canJudge(c.id) ? '<div class="notice">Режим перегляду: ви не закріплені суддею цієї категорії.</div>' : ''}
  <div class="scorebar"><div class="n A">${esc(A)}<div class="small muted">${esc(team(m.teamA).school || '').slice(0, 60)}</div></div><div class="s"><span style="color:var(--A)">${sc.a}</span> : <span style="color:var(--B)">${sc.b}</span></div><div class="n B">${esc(B)}<div class="small muted">${esc(team(m.teamB).school || '').slice(0, 60)}</div></div></div>
  <div class="grid" style="grid-template-columns:minmax(0,1fr) 330px;align-items:start">
    <div>${pad}${tb}
      ${can ? `<div class="row" style="margin-top:16px">
        ${MS.status === 'scheduled' ? `<button class="btn org lg" data-act="mstatus" data-v="live">▶ Розпочати матч</button>` : ''}
        ${MS.status !== 'done' ? `<button class="btn ok lg" data-act="mstatus" data-v="done">✔ Завершити матч і зберегти</button>` : `<button class="btn lg" data-act="mstatus" data-v="live">✏ Відкрити для виправлення</button>`}
        ${MS.status !== 'scheduled' ? `<button class="btn danger" data-act="mreset">Скинути результат</button>` : ''}
        <span class="small muted">${saveT ? 'збереження…' : 'Зміни зберігаються автоматично'}</span></div>` : ''}
    </div>
    <div>${timerHTML(c.id, { controls: canJudge(c.id), presets: true, compact: true, matchId: m.id, label: `Матч №${m.order}: ${A} — ${B}` })}
      <div class="card flat small" style="margin-top:12px"><b>Правила</b><div class="muted">${esc(T[c.type].rules)}</div></div></div>
  </div></div>`;
}
const dis = can => can ? '' : 'disabled';
function basketPad(d, A, B, can) {
  const side = (s, name) => {
    const k3 = s === 'A' ? 'a3' : 'b3', k1 = s === 'A' ? 'a1' : 'b1';
    return `<div class="team-panel side-${s}"><div class="tname">${esc(name)}</div><div class="big">${3 * (d[k3] || 0) + (d[k1] || 0)}</div>
      <button class="btn pad-btn" style="background:var(--sc);color:#071324" data-act="bb" data-k="${k3}" data-v="1" ${dis(can)}>🏀 Закинув зверху +3</button>
      <button class="btn pad-btn" data-act="bb" data-k="${k1}" data-v="1" ${dis(can)}>⬇ Заштовхнув у нішу +1</button>
      <div class="counter"><span>Закинуто (×3)</span><button class="btn sm" data-act="bb" data-k="${k3}" data-v="-1" ${dis(can)}>−</button><b>${d[k3] || 0}</b></div>
      <div class="counter"><span>Заштовхнуто (×1)</span><button class="btn sm" data-act="bb" data-k="${k1}" data-v="-1" ${dis(can)}>−</button><b>${d[k1] || 0}</b></div></div>`;
  };
  return `<div class="scorepad">${side('A', A)}${side('B', B)}</div>
  <div class="small muted" style="margin-top:8px">Нагадування: жовті м’ячі зараховуються лише після закидання всіх командних (зелених / фіолетових). ${(d.log || []).length ? `<button class="btn sm" data-act="bbundo" ${dis(can)}>↶ Скасувати останню дію</button>` : ''}</div>`;
}
function segRow(label, val, idx, key, A, B, can, allowDraw) {
  return `<div class="half-row"><b>${label}</b><div class="seg">
    <button class="btn ${val === 'A' ? 'on-A' : ''}" data-act="seg" data-key="${key}" data-i="${idx}" data-v="A" ${dis(can)}>${key === 'halves' ? '⚽ Гол: ' : '🏆 '}${esc(A)}</button>
    ${allowDraw ? `<button class="btn ${val === 'D' ? 'on-D' : ''}" data-act="seg" data-key="${key}" data-i="${idx}" data-v="D" ${dis(can)}>Нічия (0:0)</button>` : ''}
    <button class="btn ${val === 'B' ? 'on-B' : ''}" data-act="seg" data-key="${key}" data-i="${idx}" data-v="B" ${dis(can)}>${key === 'halves' ? '⚽ Гол: ' : '🏆 '}${esc(B)}</button></div></div>`;
}
function footPad(d, A, B, can) {
  const h = d.halves || [];
  const pts = s => h.reduce((a, x) => a + (x === s ? 10 : x === 'D' ? 5 : 0), 0);
  const n = Math.max(2, h.length);
  let rows = '';
  for (let i = 0; i < n; i++) rows += segRow(`Тайм ${i + 1}${i === 2 ? ' (дод., 60 с)' : ''}`, h[i], i, 'halves', A, B, can, true);
  const tied = h.length >= 2 && h[0] && h[1] && pts('A') === pts('B');
  return `<div class="card flat">${rows}
    ${tied && n < 3 ? `<div class="notice">Нічия після двох таймів — призначається третій тайм (60 с). <button class="btn sm org" data-act="addRound" data-key="halves" ${dis(can)}>+ Третій тайм</button></div>` : ''}
    ${h.length ? `<button class="btn sm" data-act="popRound" data-key="halves" ${dis(can)}>↶ Видалити останній тайм</button>` : ''}
    <div class="small muted" style="margin-top:8px">Тайм завершується першим голом або закінченням 120 с. Виграний тайм — 10 б, нічия — по 5 б.</div></div>`;
}
function sumoPad(d, A, B, can) {
  const r = d.rounds || [];
  const w = s => r.filter(x => x === s).length;
  const n = Math.max(2, r.length);
  let rows = '';
  for (let i = 0; i < n; i++) rows += segRow(`Раунд ${i + 1}${i === 0 ? ' (правий бік)' : i === 1 ? ' (лівий бік)' : i === 2 ? ' (від центру)' : ' (додатковий)'}`, r[i], i, 'rounds', A, B, can, false);
  const tied = r.length >= n && w('A') === w('B');
  return `<div class="card flat">${rows}
    <div class="row">${tied ? `<span class="notice" style="margin:0">Рівність — призначається ${n === 2 ? 'третій' : 'додатковий'} раунд.</span>` : ''}
    <button class="btn sm org" data-act="addRound" data-key="rounds" ${dis(can)}>+ ${n === 2 ? 'Третій' : 'Додатковий'} раунд</button>
    ${r.length ? `<button class="btn sm" data-act="popRound" data-key="rounds" ${dis(can)}>↶ Видалити останній раунд</button>` : ''}</div>
    <div class="small muted" style="margin-top:8px">Раунд до 90 с. Якщо ніхто не виштовхнутий — перемагає робот, ближчий до центру кола. Виграний раунд — 10 б.</div></div>`;
}
function biaPad(d, A, B, can, set) {
  const side = (s, name) => {
    const x = d[s] || { hits: [], touches: 0, other: 0 };
    const r = RG.biathlonSide(x, set);
    return `<div class="team-panel side-${s}"><div class="tname">${esc(name)}</div><div class="big">${r.total}</div>
      <div class="small muted">Мішені (зараховуються після зчитування QR-коду):</div>
      <div class="pad-row">${set.targets.map(v => `<button class="btn target ${(x.hits || []).indexOf(v) >= 0 ? 'hit' : ''}" data-act="bia" data-s="${s}" data-k="hit" data-v="${v}" ${dis(can)}>🎯 ${v}</button>`).join('')}</div>
      <div class="counter"><span>Дотики до стінок (−${set.wallPenalty})</span><button class="btn sm" data-act="bia" data-s="${s}" data-k="touch" data-v="-1" ${dis(can)}>−</button><b>${x.touches || 0}</b><button class="btn sm" data-act="bia" data-s="${s}" data-k="touch" data-v="1" ${dis(can)}>+</button></div>
      <div class="counter"><span>Інші бали / штрафи (±)</span><button class="btn sm" data-act="bia" data-s="${s}" data-k="other" data-v="-10" ${dis(can)}>−10</button><b>${x.other || 0}</b><button class="btn sm" data-act="bia" data-s="${s}" data-k="other" data-v="10" ${dis(can)}>+10</button></div>
      <div class="small muted" style="margin-top:6px">Влучання: ${r.hits} · штраф: −${r.pen}</div></div>`;
  };
  return `<div class="scorepad">${side('A', A)}${side('B', B)}</div>`;
}
function curMatch() { return MS && S.matches.find(m => m.id === MS.id); }
function mChanged() {
  MS.dirty = true;
  if (MS.status === 'scheduled') MS.status = 'live';
  render(true);
  clearTimeout(saveT);
  saveT = setTimeout(saveMatch, 350);
}
async function saveMatch(status) {
  clearTimeout(saveT); saveT = null;
  const m = curMatch(); if (!m) return;
  const body = { data: MS.data, status: status || MS.status, silent: !status };
  try {
    await api('PUT', '/api/matches/' + m.id, body);
    MS.dirty = false;
    if (status) MS.status = status;
    m.data = JSON.parse(JSON.stringify(MS.data)); m.status = body.status;
  } catch (e) { if (status) MS.status = m.status; }
  render(true);
}

/* ================= таймер ================= */
function timerState(cid) {
  const c = cat(cid);
  const def = T[c.type].timer;
  const set = RG.settingsOf(c);
  return S.timers[cid] || { mode: def.mode, duration: (set.timerDuration || def.duration) * 1000, running: false, startedAt: 0, acc: 0, label: '' };
}
function timerCalc(t) {
  const el = t.acc + (t.running ? now() - t.startedAt : 0);
  if (t.mode === 'down') { const rem = Math.max(0, t.duration - el); return { ms: rem, frac: t.duration ? el / t.duration : 0, end: rem <= 0 && (t.running || el > 0), warn: rem <= 10000 && rem > 0 }; }
  return { ms: el, frac: 0, end: false, warn: false };
}
function fmtMs(ms, tenth) {
  const s = Math.floor(ms / 1000), mm = Math.floor(s / 60), ss = s % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}${tenth ? '.' + Math.floor((ms % 1000) / 100) : ''}`;
}
function timerPresets(c) {
  const def = T[c.type].timer, set = RG.settingsOf(c);
  const main = set.timerDuration || def.duration;
  const list = [];
  if (def.mode === 'up') list.push({ mode: 'up', d: 0, l: '⏱ Секундомір' });
  if (main) list.push({ mode: 'down', d: main, l: `${fmtMs(main * 1000)} ${c.type === 'football' ? 'тайм' : c.type === 'sumo' ? 'раунд' : c.type === 'smart' ? 'презентація' : 'матч'}` });
  if (def.extra) list.push({ mode: 'down', d: set.timerExtra || def.extra, l: `${fmtMs((set.timerExtra || def.extra) * 1000)} дод. тайм` });
  if (c.type === 'smart') list.push({ mode: 'down', d: 180, l: '03:00 стрес-тест' });
  if (def.mode !== 'up') list.push({ mode: 'up', d: 0, l: '⏱ Секундомір' });
  return list;
}
function timerHTML(cid, o) {
  o = o || {};
  const c = cat(cid);
  const t = timerState(cid);
  const presets = timerPresets(c);
  return `<div class="timer" data-timer="${cid}" data-match="${o.matchId || ''}" data-label="${esc(o.label || '')}">
    <div class="small muted">⏱ Таймер · ${esc(c.name)} ${t.label ? '· ' + esc(t.label) : ''}</div>
    <div class="digits">00:00.0</div>
    <div class="tbar"><i style="width:0"></i></div>
    <div class="small muted tmode">${t.mode === 'down' ? 'Зворотний відлік ' + fmtMs(t.duration) : 'Секундомір'}${t.updatedBy ? ' · керує: ' + esc(t.updatedBy) : ''}</div>
    ${o.controls ? `<div class="ctrl">
      <button class="btn ok" data-act="tm" data-v="toggle" data-cat="${cid}">${t.running ? '⏸ Пауза' : '▶ Старт'}</button>
      <button class="btn" data-act="tm" data-v="reset" data-cat="${cid}">⟲ Скинути</button>
      ${t.mode === 'up' && o.matchId === undefined ? '' : ''}
    </div>
    ${o.presets ? `<div class="ctrl">${presets.map(p => `<button class="btn sm" data-act="tmset" data-cat="${cid}" data-mode="${p.mode}" data-d="${p.d}">${p.l}</button>`).join('')}
      <button class="btn sm ghost" data-act="sound">${soundOn ? '🔔' : '🔕'}</button></div>` : ''}` : ''}
  </div>`;
}
const beeped = {};
let audioCtx = null;
function beep(freq, dur) {
  if (!soundOn) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.frequency.value = freq; o.type = 'square'; g.gain.value = 0.08;
    o.connect(g); g.connect(audioCtx.destination); o.start(); o.stop(audioCtx.currentTime + dur);
  } catch (e) { /* */ }
}
function refreshTimers(full) {
  if (!S) return;
  document.querySelectorAll('[data-timer]').forEach(el => {
    const cid = el.dataset.timer;
    const t = timerState(cid);
    const r = timerCalc(t);
    const dg = el.querySelector('.digits');
    if (dg) dg.textContent = fmtMs(r.ms, true);
    const bar = el.querySelector('.tbar i');
    if (bar) bar.style.width = (t.mode === 'down' ? Math.min(100, r.frac * 100) : 0) + '%';
    el.classList.toggle('run', t.running && !r.end);
    el.classList.toggle('warn', r.warn);
    el.classList.toggle('end', r.end);
    if (full) {
      const btn = el.querySelector('[data-v="toggle"]');
      if (btn) btn.textContent = t.running ? '⏸ Пауза' : '▶ Старт';
      const md = el.querySelector('.tmode');
      if (md) md.textContent = (t.mode === 'down' ? 'Зворотний відлік ' + fmtMs(t.duration) : 'Секундомір') + (t.updatedBy ? ' · керує: ' + t.updatedBy : '');
    }
    // звукові сигнали
    if (t.mode === 'down' && t.running) {
      const sec = Math.ceil(r.ms / 1000);
      const key = cid + ':' + t.startedAt;
      beeped[key] = beeped[key] || {};
      if (sec <= 5 && sec > 0 && !beeped[key][sec]) { beeped[key][sec] = 1; beep(880, 0.12); }
      if (r.ms <= 0 && !beeped[key].end) { beeped[key].end = 1; beep(440, 1.2); }
    }
  });
  const full2 = document.querySelector('.timer-full');
  if (full2 && full) render();
}
setInterval(() => refreshTimers(false), 100);

function timerFullView(cid) {
  const c = cat(cid);
  if (!c) return '<div class="empty">Категорію не знайдено</div>';
  const t = timerState(cid);
  const m = t.matchId ? S.matches.find(x => x.id === t.matchId) : null;
  const sc = m ? RG.matchScore(c.type, m.data, RG.settingsOf(c)) : null;
  return `<div class="timer-full" data-timer="${cid}">
    <img class="logo" src="${IMG.robogames}" alt="">
    <div class="lbl">${T[c.type].icon} ${esc(c.name)}${t.label && !m ? ' · ' + esc(t.label) : ''}</div>
    ${m ? `<div class="vs"><span class="A">${esc(tn(m.teamA))}</span> <span style="color:#fff">${sc.a} : ${sc.b}</span> <span class="B">${esc(tn(m.teamB))}</span></div>` : ''}
    <div class="digits">00:00.0</div>
    <div class="tbar" style="width:80vw"><i></i></div>
    ${canJudge(cid) ? `<div class="ctrl"><button class="btn ok lg" data-act="tm" data-v="toggle" data-cat="${cid}">${t.running ? '⏸ Пауза' : '▶ Старт'}</button><button class="btn lg" data-act="tm" data-v="reset" data-cat="${cid}">⟲ Скинути</button><a class="btn lg ghost" href="#/cat/${cid}">✕</a></div>` : ''}
    <div class="row" style="margin-top:14px">${LOGOS.map(l => `<span style="background:#fff;border-radius:8px;padding:4px 8px;display:inline-flex"><img src="${l.src}" style="height:34px" alt=""></span>`).join('')}</div>
  </div>`;
}

/* ================= зведена таблиця ================= */
function summaryView() {
  const cs = cats();
  const teamIds = Array.from(new Set(S.entries.map(e => e.teamId))).sort((a, b) => tn(a).localeCompare(tn(b)));
  const ranks = {}; cs.forEach(c => { ranks[c.id] = RG.ranking(S, c); });
  const matrix = `<div class="card flat tbl-wrap" style="margin-top:18px"><h3>Команди × категорії (місця)</h3><table class="t"><tr><th>Команда</th><th>Населений пункт</th>${cs.map(c => `<th class="c" title="${esc(c.name)}">${T[c.type].icon}<br><span class="tiny">${esc(c.name)}</span></th>`).join('')}</tr>
    ${teamIds.map(id => `<tr><td><b>${esc(tn(id))}</b><div class="tiny muted">${esc(team(id).school).slice(0, 60)}</div></td><td class="small">${esc(team(id).settlement)}</td>${cs.map(c => { const r = ranks[c.id].find(x => x.teamId === id); return `<td class="c">${r ? (r.place ? `<b>${medal(r.place) || r.place}</b>` : '<span class="muted">·</span>') : ''}</td>`; }).join('')}</tr>`).join('')}</table></div>`;
  return `<div class="row"><h1 class="grow">📊 Зведена таблиця результатів</h1>
    <button class="btn pri" data-act="doc" data-kind="overall">⬇ Зведена відомість (.docx)</button><button class="btn" data-act="doc" data-kind="overall" data-format="html">🖨 Друк</button></div>
  <div class="muted small" style="margin-bottom:14px">Оновлюється в реальному часі. Доступна всім суддям.</div>
  <div class="grid g2">${cs.map(c => {
    const p = RG.progress(S, c);
    const rank = ranks[c.id];
    return `<div class="card" style="${ccStyle(c)}"><div class="row"><span style="font-size:28px">${T[c.type].icon}</span><h3 class="grow" style="margin:0"><a href="#/cat/${c.id}" style="color:inherit;text-decoration:none">${esc(c.name)}</a></h3>${p.total && p.done >= p.total ? '<span class="chip done">завершено</span>' : p.live ? '<span class="chip live">LIVE</span>' : `<span class="chip">${p.done}/${p.total}</span>`}</div>
    <div class="progress" style="margin:8px 0"><i class="d" style="width:${p.total ? p.done / p.total * 100 : 0}%"></i><i class="l" style="width:${p.total ? p.live / p.total * 100 : 0}%"></i></div>
    ${rank.length ? `<table class="t"><tr><th class="c">#</th><th>Команда</th><th class="c">Результат</th><th class="c">Бали</th></tr>${rank.map(r => `<tr><td class="c num">${r.place ? (medal(r.place) || r.place) : '—'}</td><td><b>${esc(tn(r.teamId))}</b> <span class="tiny muted">${esc(team(r.teamId).settlement)}</span></td><td class="c small">${esc(r.resultText)}</td><td class="c num">${r.points === null || r.points === undefined ? '—' : fmt(r.points, 2)}</td></tr>`).join('')}</table>` : '<div class="muted small">Немає команд</div>'}</div>`;
  }).join('')}</div>${matrix}`;
}

/* ================= адміністрування ================= */
let teamSearch = '';
function teamsView() {
  const q = teamSearch.toLowerCase();
  const list = S.teams.filter(t => !q || (t.name + ' ' + t.school + ' ' + t.settlement + ' ' + t.members.map(m => m.surname + ' ' + m.name).join(' ')).toLowerCase().indexOf(q) >= 0).sort((a, b) => a.name.localeCompare(b.name));
  return `<div class="row"><h1 class="grow">👥 Команди та учасники</h1><button class="btn" data-act="doc" data-kind="registry">⬇ Реєстраційна відомість</button><button class="btn pri" data-act="newTeam">+ Зареєструвати команду</button></div>
  <input placeholder="Пошук за назвою, закладом, населеним пунктом, учасником…" data-change="teamSearch" value="${esc(teamSearch)}" style="margin:10px 0 14px;max-width:520px">
  <div class="card flat tbl-wrap"><table class="t"><tr><th>Команда</th><th>Заклад освіти</th><th>Населений пункт</th><th>Учасники</th><th>Категорії</th><th></th></tr>
  ${list.map(t => {
    const cs = S.entries.filter(e => e.teamId === t.id).map(e => cat(e.categoryId)).filter(Boolean);
    const noBirth = t.members.some(m => !m.birthdate);
    return `<tr><td><b>${esc(t.name)}</b></td><td class="small">${esc(t.school)}</td><td class="small">${esc(t.settlement) || '<span class="chip warn">не вказано</span>'}</td>
    <td class="small">${t.members.map(m => esc(m.surname + ' ' + m.name)).join('<br>')}${noBirth ? '<br><span class="chip warn">немає дат народження</span>' : ''}</td>
    <td>${cs.map(c => `<span class="chip" style="margin:1px">${T[c.type].icon} ${esc(c.name)}</span>`).join(' ')}</td>
    <td class="nowrap"><button class="btn sm" data-act="editTeam" data-id="${t.id}">✏ Редагувати</button></td></tr>`;
  }).join('')}</table></div>`;
}

function teamModal(t, presetCat) {
  t = t || { name: '', school: '', settlement: '', members: [{ surname: '', name: '', patronymic: '', birthdate: '' }] };
  const inCats = t.id ? S.entries.filter(e => e.teamId === t.id).map(e => e.categoryId) : (presetCat ? [presetCat] : []);
  const schools = Array.from(new Set(S.teams.map(x => x.school).filter(Boolean)));
  const places = Array.from(new Set(S.teams.map(x => x.settlement).filter(Boolean)));
  openModal(`<h2>${t.id ? '✏ Редагування команди' : '+ Реєстрація команди'}</h2>
  <form id="teamForm" data-id="${t.id || ''}">
    <label>Назва команди *</label><input name="name" value="${esc(t.name)}" required>
    <label>Заклад освіти</label><input name="school" value="${esc(t.school)}" list="schoolsList"><datalist id="schoolsList">${schools.map(s => `<option value="${esc(s)}">`).join('')}</datalist>
    <label>Населений пункт</label><input name="settlement" value="${esc(t.settlement)}" list="placesList" placeholder="напр. м. Полтава"><datalist id="placesList">${places.map(s => `<option value="${esc(s)}">`).join('')}</datalist>
    <label>Учасники (прізвище, ім’я, по батькові, дата народження)</label>
    <div id="members">${t.members.map(memberRow).join('')}</div>
    <button type="button" class="btn sm" data-act="addMember">+ Учасник</button>
    <label style="margin-top:14px">Категорії, в яких бере участь</label>
    <div class="checks">${cats().map(c => `<label><input type="checkbox" name="cat" value="${c.id}" ${inCats.indexOf(c.id) >= 0 ? 'checked' : ''}> ${T[c.type].icon} ${esc(c.name)}</label>`).join('')}</div>
    <div class="row" style="margin-top:18px"><button class="btn pri">💾 Зберегти</button><button type="button" class="btn" data-act="closeModal">Скасувати</button>
    ${t.id ? `<button type="button" class="btn danger right" data-act="delTeam" data-id="${t.id}">Видалити команду повністю</button>` : ''}</div>
  </form>`);
}
function memberRow(m) {
  return `<div class="member-row"><input placeholder="Прізвище" data-f="surname" value="${esc(m.surname)}"><input placeholder="Ім’я" data-f="name" value="${esc(m.name)}"><input placeholder="По батькові" data-f="patronymic" value="${esc(m.patronymic || '')}"><input type="date" data-f="birthdate" value="${esc(m.birthdate || '')}"><button type="button" class="btn sm danger" data-act="rmMember">✕</button></div>`;
}

function judgesView() {
  const us = S.users.slice().sort((a, b) => (a.role === 'admin' ? -1 : 1) - (b.role === 'admin' ? -1 : 1) || a.name.localeCompare(b.name));
  return `<div class="row"><h1 class="grow">⚖ Судді та доступ</h1><button class="btn pri" data-act="newUser">+ Додати суддю</button></div>
  <div class="notice info small">Суддя бачить усі категорії та зведені таблиці, але виставляти й змінювати бали може лише в закріплених за ним категоріях. Адміністратор (Голова журі) може змінювати все.</div>
  <div class="grid g3" style="margin-bottom:16px">${cats().map(c => { const j = judgesOf(c.id); return `<div class="card flat" style="${ccStyle(c)}"><b>${T[c.type].icon} ${esc(c.name)}</b><div class="small ${j.length ? '' : 'muted'}">${j.length ? j.map(u => esc(u.name)).join(', ') : 'суддів не призначено'}</div></div>`; }).join('')}</div>
  <div class="card flat tbl-wrap"><table class="t"><tr><th>ПІБ</th><th>Логін</th><th>Роль</th><th>Категорії</th><th></th></tr>
  ${us.map(u => `<tr><td><b>${esc(u.name)}</b></td><td>${esc(u.login)}</td><td>${u.role === 'admin' ? '<span class="chip next">адміністратор</span>' : '<span class="chip">суддя</span>'}</td><td>${u.role === 'admin' ? '<span class="muted small">усі</span>' : (u.categories || []).map(id => cat(id)).filter(Boolean).map(c => `<span class="chip" style="margin:1px">${T[c.type].icon} ${esc(c.name)}</span>`).join(' ') || '<span class="chip warn">не закріплено</span>'}</td>
  <td class="nowrap"><button class="btn sm" data-act="editUser" data-id="${u.id}">✏</button>${u.id !== S.me.id ? ` <button class="btn sm danger" data-act="delUser" data-id="${u.id}">✕</button>` : ''}</td></tr>`).join('')}</table></div>`;
}
function userModal(u) {
  u = u || { login: '', name: '', role: 'judge', categories: [] };
  openModal(`<h2>${u.id ? '✏ Редагування' : '+ Новий суддя'}</h2><form id="userForm" data-id="${u.id || ''}">
    <label>ПІБ (буде в протоколах) *</label><input name="name" value="${esc(u.name)}" required>
    <label>Логін *${S.mode === 'firebase' ? ' (латиницею)' : ''}</label><input name="login" value="${esc(u.login)}" required autocomplete="off" ${u.id && S.mode === 'firebase' ? 'readonly' : ''}>
    ${u.id && S.mode === 'firebase' ? '<div class="small muted" style="margin-top:8px">Пароль суддя змінює сам після входу (кнопка 🔑).</div>' : `<label>${u.id ? 'Новий пароль (залиште порожнім, щоб не змінювати)' : 'Пароль *'}</label><input name="password" type="text" autocomplete="off" ${u.id ? '' : 'required'} placeholder="від ${S.mode === 'firebase' ? 6 : 4} символів">`}
    <label>Роль</label><select name="role" ${u.id === S.me.id ? 'disabled' : ''}><option value="judge" ${u.role === 'judge' ? 'selected' : ''}>Суддя</option><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Адміністратор (Голова журі)</option></select>
    <label>Закріплені категорії</label><div class="checks">${cats().map(c => `<label><input type="checkbox" name="cat" value="${c.id}" ${(u.categories || []).indexOf(c.id) >= 0 ? 'checked' : ''}> ${T[c.type].icon} ${esc(c.name)}</label>`).join('')}</div>
    <div class="row" style="margin-top:18px"><button class="btn pri">💾 Зберегти</button><button type="button" class="btn" data-act="closeModal">Скасувати</button></div></form>`);
}

function settingsView() {
  const m = S.meta || {};
  return `<h1>⚙ Налаштування</h1>
  <div class="grid g2">
  <div class="card flat"><h3>Змагання</h3><form id="metaForm">
    <label>Назва змагань</label><input name="title" value="${esc(m.title)}">
    <label>Місце проведення</label><input name="place" value="${esc(m.place)}">
    <label>Дата</label><input name="date" type="date" value="${esc(m.date)}">
    <label>Голова журі (ПІБ для підписів у протоколах)</label><input name="chairName" value="${esc(m.chairName)}">
    <button class="btn pri" style="margin-top:12px">💾 Зберегти</button></form></div>
  <div class="card flat"><h3>${S.mode === 'firebase' ? '☁ Спільний режим (Firebase)' : '💾 Локальний режим'}</h3>
    ${S.mode === 'firebase' ? `<div class="small muted">Дані зберігаються у Firebase (проєкт <b>${esc((Backend.fbConfig || {}).projectId || '')}</b>) і синхронізуються між усіма пристроями. Надішліть суддям посилання нижче: воно відкриває систему вже з підключенням.</div>
      <div class="row" style="margin-top:12px"><button class="btn pri" data-act="fbCopy">🔗 Скопіювати посилання для суддів</button><button class="btn" data-act="fbSetup">⚙ Змінити конфігурацію</button></div>`
      : `<div class="small muted">Зараз дані зберігаються лише в цьому браузері, тож судді з інших пристроїв їх не бачать. Щоб судді працювали паралельно зі своїх планшетів, підключіть безкоштовний Firebase (інструкція в README репозиторію).</div>
      <div class="row" style="margin-top:12px"><button class="btn pri" data-act="fbSetup">☁ Підключити Firebase</button><button class="btn danger" data-act="resetLocal">Скинути локальні дані</button></div>`}
  </div>
  <div class="card flat"><h3>Резервні копії</h3><div class="small muted">Регулярно завантажуйте резервну копію (файл .json) — з неї можна відновити всі команди, матчі та бали.</div>
    <div class="row" style="margin-top:12px"><button class="btn pri" data-act="backup">⬇ Завантажити резервну копію</button><label class="btn" style="margin:0;color:var(--text)">⬆ Відновити з файлу<input type="file" accept=".json" data-change="restore" style="display:none"></label></div></div>
  </div>
  <h2 style="margin-top:20px">Категорії</h2><div class="grid g2">${cats().map(c => {
    const s = RG.settingsOf(c), def = T[c.type].timer;
    return `<div class="card flat" style="${ccStyle(c)}"><form class="catForm" data-id="${c.id}"><h3>${T[c.type].icon} ${esc(c.name)}</h3>
      <label>Назва</label><input name="name" value="${esc(c.name)}">
      ${def.duration ? `<label>Тривалість таймера, с</label><input name="timerDuration" type="number" min="10" value="${s.timerDuration || def.duration}">` : ''}
      ${def.extra ? `<label>Додатковий тайм, с</label><input name="timerExtra" type="number" min="10" value="${s.timerExtra || def.extra}">` : ''}
      ${c.type === 'maze' ? `<label>Штраф за торкання стінки, с</label><input name="penaltySec" type="number" min="0" step="0.5" value="${s.penaltySec}"><label>Рейтинг</label><select name="rankMode"><option value="best" ${s.rankMode === 'best' ? 'selected' : ''}>найкращий з двох раундів</option><option value="sum" ${s.rankMode === 'sum' ? 'selected' : ''}>сума двох раундів</option></select>` : ''}
      ${c.type === 'biathlon' ? `<label>Штраф за дотик до стінки, б</label><input name="wallPenalty" type="number" min="0" value="${s.wallPenalty}">` : ''}
      ${c.type === 'delivery' ? `<label>Штраф за коробку поза зоною, б</label><input name="penaltyOutside" type="number" min="0" value="${s.penaltyOutside}">` : ''}
      <button class="btn sm pri" style="margin-top:10px">💾 Зберегти</button></form></div>`;
  }).join('')}</div>`;
}

let logData = null, logFilter = '';
async function loadLog() {
  try { logData = await api('GET', '/api/log'); } catch (e) { return; }
  const el = $('#logBody'); if (el) el.innerHTML = logRows();
}
function logRows() {
  if (!logData) return '<tr><td colspan="4" class="muted">Завантаження…</td></tr>';
  const q = logFilter.toLowerCase();
  return logData.filter(l => !q || (l.userName + ' ' + l.action + ' ' + l.details).toLowerCase().indexOf(q) >= 0).slice(0, 600).map(l => `<tr><td class="nowrap small">${new Date(l.ts).toLocaleString('uk-UA')}</td><td>${esc(l.userName)}</td><td><b>${esc(l.action)}</b></td><td class="small">${esc(l.details)}</td></tr>`).join('');
}
function logView() {
  return `<h1>🧾 Журнал змін</h1><div class="small muted">Усі зміни балів, команд і налаштувань: хто, коли і що змінив.</div>
  <input placeholder="Фільтр…" data-change="logFilter" value="${esc(logFilter)}" style="margin:10px 0;max-width:400px">
  <div class="card flat tbl-wrap"><table class="t"><tr><th>Час</th><th>Користувач</th><th>Дія</th><th>Деталі</th></tr><tbody id="logBody">${logRows()}</tbody></table></div>`;
}

/* ================= модальні вікна оцінювання ================= */
function openModal(html) {
  closeModal();
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal">${html}</div>`;
  bg.addEventListener('mousedown', e => { if (e.target === bg) closeModal(); });
  document.body.appendChild(bg);
  const f = bg.querySelector('input:not([type=hidden]),select');
  if (f && !f.closest('[data-noautofocus]')) setTimeout(() => f.focus(), 30);
}
function closeModal() { const m = $('.modal-bg'); if (m) m.remove(); if (pendingRender) { pendingRender = false; render(true); } }

let RUN = null;
function runModal(cid, teamId, round, judgeId) {
  const c = cat(cid);
  const r = runOf(cid, teamId, round, judgeId);
  RUN = { cid, teamId, round, judgeId, data: JSON.parse(JSON.stringify(r ? r.data : (c.type === 'delivery' ? { delivered: 0, outside: 0, book: 0, time: '' } : c.type === 'maze' ? { time: '', touches: 0, finished: true } : { scores: {} }))), exists: !!r, id: r && r.id };
  drawRun();
}
function stepper(key, val, max, min) {
  min = min || 0;
  let h = '<div class="steps">';
  for (let i = min; i <= max; i++) h += `<button type="button" class="btn ${Number(val) === i ? 'pri sel' : ''}" data-act="rset" data-k="${key}" data-v="${i}">${i}</button>`;
  return h + '</div>';
}
function drawRun() {
  const c = cat(RUN.cid), d = RUN.data;
  const s = RG.runScore(c, d);
  const set = RG.settingsOf(c);
  let body = '';
  if (c.type === 'delivery') {
    body = `<label>Доставлено вантажів (рух уздовж чорної лінії)</label>${stepper('delivered', d.delivered, 3)}
      <label>Коробок, що виходять за межі місця доставки (−${set.penaltyOutside} б кожна)</label>${stepper('outside', d.outside, 3)}
      <label>Інженерна книга (0–${set.bookMax} б)</label>${stepper('book', d.book, set.bookMax)}
      <label>Час заїзду, с (для довідки та рівності балів)</label><div class="row"><input type="number" step="0.01" min="0" data-rin="time" value="${esc(d.time)}" style="max-width:160px"><button type="button" class="btn" data-act="takeTime">⏱ Взяти з секундоміра</button></div>`;
  } else if (c.type === 'maze') {
    body = `<label>Час проходження, с</label><div class="row"><input type="number" step="0.01" min="0" data-rin="time" value="${esc(d.time)}" style="max-width:160px"><button type="button" class="btn" data-act="takeTime">⏱ Взяти з секундоміра</button></div>
      <label>Торкання стінок (+${set.penaltySec} с кожне)</label>${stepper('touches', d.touches, 10)}
      <label>Чи пройшов лабіринт до фінішу?</label><div class="seg"><button type="button" class="btn ${d.finished ? 'on-A' : ''}" data-act="rset" data-k="finished" data-v="1">✔ Фінішував</button><button type="button" class="btn ${!d.finished ? 'on-B' : ''}" data-act="rset" data-k="finished" data-v="0">✕ Не фінішував</button></div>`;
  } else if (c.type === 'smart') {
    d.scores = d.scores || {};
    body = set.criteria.map((k, i) => `${i === 0 || set.criteria[i - 1].round !== k.round ? `<h3 style="margin-top:12px">Раунд ${k.round}: ${k.round === 1 ? 'презентація та технічна експертиза' : 'стрес-тест і відповіді на запитання'}</h3>` : ''}<div class="crit"><div><b>${esc(k.label)}</b> <span class="muted small">(0–${k.max})</span></div><div></div></div>${stepper('s:' + k.key, d.scores[k.key] || 0, k.max)}`).join('');
  }
  const total = c.type === 'maze' ? (s.finished ? `${fmt(s.adj, 2)} с` : 'не фінішував') : `${s.total} б`;
  openModal(`<div data-noautofocus><h2>${T[c.type].icon} ${esc(tn(RUN.teamId))}</h2><div class="muted">${esc(c.name)} · ${c.type === 'smart' ? 'оціночний лист судді ' + esc(userName(RUN.judgeId)) : T[c.type].rounds > 1 ? 'раунд ' + RUN.round : 'заїзд'}</div>
  ${body}
  <div class="scorebar" style="margin-top:16px;grid-template-columns:1fr auto"><div class="n">Підсумок</div><div class="s" style="font-size:36px">${total}</div></div>
  ${c.type !== 'smart' ? `<div style="margin:8px 0">${timerHTML(c.id, { controls: true, compact: true })}</div>` : ''}
  <div class="row"><button class="btn ok lg" data-act="runSave" data-v="done">✔ Зберегти результат</button><button class="btn" data-act="runSave" data-v="live">Зберегти як чернетку</button><button class="btn ghost" data-act="closeModal">Скасувати</button>
  ${RUN.exists ? '<button class="btn danger right" data-act="runDel">Видалити результат</button>' : ''}</div></div>`);
  refreshTimers(true);
}

/* ================= обробники подій ================= */
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
function docData() { const d = Backend.rawData(); return { meta: d.meta || {}, categories: d.categories, teams: d.teams, entries: d.entries, matches: d.matches, runs: d.runs, users: d.users }; }
const ACT = {
  doc: el => {
    const kind = el.dataset.kind, c = el.dataset.cat ? cat(el.dataset.cat) : null;
    const doc = DOCS[kind](docData(), c);
    if (el.dataset.format === 'html') {
      const w = window.open('', '_blank');
      if (!w) return toast('Браузер заблокував нове вікно — дозвольте спливні вікна', true);
      w.document.open(); w.document.write(DOCX.html(doc.blocks, { landscape: doc.landscape, title: doc.title })); w.document.close();
      return;
    }
    download(DOCX.build(doc.blocks, { landscape: doc.landscape, title: doc.title }), `RoboGames2026-${{ protocol: 'protokol', summary: 'zvedena', scorecards: 'otsinochni-lysty', overall: 'zvedena-vsi', registry: 'reiestratsiia' }[kind]}${c ? '-' + c.type : ''}.docx`);
  },
  backup: () => download(new Blob([Backend.backupJson()], { type: 'application/json' }), 'robogames-backup-' + new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-') + '.json'),
  fbSetup: () => fbModal(),
  fbOff: () => { if (confirm('Перейти в локальний режим на цьому пристрої? Дані у Firebase залишаться.')) Backend.setFirebaseConfig(null); },
  fbCopy: async () => { const l = Backend.shareLink(); try { await navigator.clipboard.writeText(l); toast('Посилання скопійовано'); } catch (e) { prompt('Скопіюйте посилання:', l); } },
  resetLocal: () => { if (confirm('Видалити ВСІ локальні дані цього браузера і почати з початкових списків команд?')) Backend.resetLocal(); },
  logout: async () => { await Backend.logout(); S = null; render(); },
  pw: () => openModal(`<h2>🔑 Зміна пароля</h2><form id="pwForm"><label>Поточний пароль</label><input name="old" type="password"><label>Новий пароль (від 6 символів)</label><input name="new" type="password"><div class="row" style="margin-top:14px"><button class="btn pri">Змінити</button><button type="button" class="btn" data-act="closeModal">Скасувати</button></div></form>`),
  closeModal,
  mfilter: el => { matchFilter = el.dataset.v; render(true); },
  // таймер
  tm: async el => {
    const cid = el.dataset.cat;
    const t = timerState(cid);
    const box = el.closest('[data-timer]');
    const body = { action: el.dataset.v === 'toggle' ? (t.running ? 'pause' : 'start') : el.dataset.v };
    if (box && box.dataset.match) { body.matchId = box.dataset.match; body.label = box.dataset.label; }
    if (body.action === 'start') { try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume(); } catch (e) { /* */ } }
    const j = await api('POST', '/api/timer/' + cid, body);
    S.timers[cid] = j.timer; refreshTimers(true);
  },
  tmset: async el => {
    const cid = el.dataset.cat;
    const box = el.closest('[data-timer]');
    const body = { action: 'set', mode: el.dataset.mode, duration: Number(el.dataset.d) };
    if (box && box.dataset.match) { body.matchId = box.dataset.match; body.label = box.dataset.label; }
    const j = await api('POST', '/api/timer/' + cid, body);
    S.timers[cid] = j.timer; refreshTimers(true);
  },
  sound: el => { soundOn = !soundOn; el.textContent = soundOn ? '🔔' : '🔕'; },
  // матч
  bb: el => {
    const d = MS.data, k = el.dataset.k, v = Number(el.dataset.v);
    if (v < 0 && !(d[k] > 0)) return;
    d[k] = (d[k] || 0) + v;
    d.log = (d.log || []).concat([{ k, v, t: Date.now() }]).slice(-200);
    mChanged();
  },
  bbundo: () => { const d = MS.data; const last = (d.log || []).pop(); if (last) { d[last.k] = Math.max(0, (d[last.k] || 0) - last.v); mChanged(); } },
  seg: el => { const arr = MS.data[el.dataset.key] = MS.data[el.dataset.key] || []; const i = Number(el.dataset.i); while (arr.length < i) arr.push(null); arr[i] = arr[i] === el.dataset.v ? null : el.dataset.v; while (arr.length && arr[arr.length - 1] === null) arr.pop(); mChanged(); },
  addRound: el => { const arr = MS.data[el.dataset.key] = MS.data[el.dataset.key] || []; const n = Math.max(2, arr.length); while (arr.length < n) arr.push(null); arr.push(null); MS.extra = true; mChangedKeepNull(el.dataset.key); },
  popRound: el => { const arr = MS.data[el.dataset.key] || []; arr.pop(); mChanged(); },
  bia: el => {
    const s = el.dataset.s, d = MS.data;
    d[s] = d[s] || { hits: [], touches: 0, other: 0 };
    const x = d[s], v = Number(el.dataset.v);
    if (el.dataset.k === 'hit') { const i = (x.hits || []).indexOf(v); x.hits = x.hits || []; if (i >= 0) x.hits.splice(i, 1); else x.hits.push(v); }
    else if (el.dataset.k === 'touch') x.touches = Math.max(0, (x.touches || 0) + v);
    else x.other = (x.other || 0) + v;
    mChanged();
  },
  tb: el => { MS.data.tb = el.dataset.v || undefined; mChanged(); },
  mstatus: async el => {
    const v = el.dataset.v;
    if (v === 'done') {
      const m = curMatch(), c = cat(m.categoryId);
      const sc = RG.matchScore(c.type, MS.data, RG.settingsOf(c));
      if (!confirm(`Завершити матч з рахунком ${sc.a}:${sc.b}?`)) return;
      // прибрати порожні тайми/раунди
      ['halves', 'rounds'].forEach(k => { if (Array.isArray(MS.data[k])) MS.data[k] = MS.data[k].filter(Boolean); });
    }
    await saveMatch(v);
    if (v === 'done') toast('Результат збережено');
  },
  mreset: async () => {
    if (!confirm('Скинути результат матчу? Усі виставлені бали буде видалено.')) return;
    const m = curMatch(), c = cat(m.categoryId);
    MS.data = RG.emptyMatchData(c.type);
    await saveMatch('scheduled');
  },
  // індивідуальні
  run: el => runModal(route().a, el.dataset.team, Number(el.dataset.round), null),
  card: el => runModal(route().a, el.dataset.team, 1, el.dataset.judge),
  rset: el => {
    const k = el.dataset.k, v = Number(el.dataset.v);
    if (k.indexOf('s:') === 0) RUN.data.scores[k.slice(2)] = v;
    else if (k === 'finished') RUN.data.finished = !!v;
    else RUN.data[k] = v;
    const sc = $('.modal-bg') ? $('.modal-bg').scrollTop : 0;
    drawRun();
    if ($('.modal-bg')) $('.modal-bg').scrollTop = sc;
  },
  takeTime: () => {
    const t = timerState(RUN.cid);
    const r = timerCalc(t);
    const el = t.acc + (t.running ? now() - t.startedAt : 0);
    RUN.data.time = Math.round((t.mode === 'up' ? r.ms : el) / 10) / 100;
    drawRun();
  },
  runSave: async el => {
    const inp = document.querySelector('[data-rin="time"]');
    if (inp) RUN.data.time = inp.value === '' ? '' : Number(inp.value);
    const c = cat(RUN.cid);
    if (c.type === 'maze' && RUN.data.finished && !(Number(RUN.data.time) > 0) && el.dataset.v === 'done') return toast('Вкажіть час проходження', true);
    await api('PUT', '/api/runs', { categoryId: RUN.cid, teamId: RUN.teamId, round: RUN.round, judgeId: RUN.judgeId, data: RUN.data, status: el.dataset.v });
    closeModal(); toast('Збережено');
  },
  runDel: async () => { if (!confirm('Видалити цей результат?')) return; await api('DELETE', '/api/runs/' + RUN.id); closeModal(); },
  // адміністрування
  newTeam: el => teamModal(null, el.dataset.cat),
  editTeam: el => teamModal(JSON.parse(JSON.stringify(S.teams.find(t => t.id === el.dataset.id)))),
  addMember: () => { $('#members').insertAdjacentHTML('beforeend', memberRow({ surname: '', name: '', patronymic: '', birthdate: '' })); },
  rmMember: el => el.closest('.member-row').remove(),
  delTeam: async el => { if (!confirm('Видалити команду з усіх категорій? Її зіграні матчі буде анульовано.')) return; notes(await api('DELETE', '/api/teams/' + el.dataset.id)); closeModal(); },
  addEntry: async el => { const v = $('#addTeamSel').value; if (!v) return toast('Оберіть команду', true); notes(await api('POST', '/api/entries', { teamId: v, categoryId: el.dataset.cat })); },
  delEntry: async el => { const e = S.entries.find(x => x.id === el.dataset.id); if (!confirm(`Зняти команду «${tn(e.teamId)}» з категорії? Її матчі буде видалено, перелік матчів адаптується.`)) return; notes(await api('DELETE', '/api/entries/' + el.dataset.id)); },
  redraw: async el => {
    const played = S.matches.some(m => m.categoryId === el.dataset.cat && m.status !== 'scheduled');
    if (!confirm(played ? 'УВАГА: у категорії вже є результати матчів. Повторне жеребкування видалить УСІ матчі та результати. Продовжити?' : 'Провести повторне жеребкування груп?')) return;
    notes(await api('POST', `/api/categories/${el.dataset.cat}/redraw`));
  },
  shuffle: async el => { if (!confirm('Перемішати чергу виступів випадковим чином?')) return; await api('POST', `/api/categories/${el.dataset.cat}/shuffle`); },
  newUser: () => userModal(null),
  editUser: el => userModal(S.users.find(u => u.id === el.dataset.id)),
  delUser: async el => { if (!confirm('Видалити цього користувача?')) return; await api('DELETE', '/api/users/' + el.dataset.id); }
};
function mChangedKeepNull() { MS.dirty = true; if (MS.status === 'scheduled') MS.status = 'live'; render(true); }

document.addEventListener('click', ev => {
  const a = ev.target.closest('[data-act]');
  if (a) {
    if (a.tagName === 'A') ev.preventDefault();
    const fn = ACT[a.dataset.act];
    if (fn) { Promise.resolve(fn(a, ev)).catch(e => console.warn(e)); }
    return;
  }
  const g = ev.target.closest('[data-go]');
  if (g && g.dataset.go && !ev.target.closest('a,button,select,input')) location.hash = g.dataset.go;
});
document.addEventListener('change', async ev => {
  const el = ev.target;
  const k = el.dataset && el.dataset.change;
  if (!k) return;
  if (k === 'cardsJudge') { cardsJudge = el.value; render(true); }
  if (k === 'group') { notes(await api('PUT', '/api/entries/' + el.dataset.id, { group: el.value })); }
  if (k === 'move') {
    if (!el.value) return;
    const e = S.entries.find(x => x.id === el.dataset.id);
    if (!confirm(`Перенести «${tn(e.teamId)}» до категорії «${cat(el.value).name}»?`)) { el.value = ''; return; }
    notes(await api('POST', `/api/entries/${el.dataset.id}/move`, { categoryId: el.value }));
  }
  if (k === 'restore') {
    const f = el.files[0]; if (!f) return;
    if (!confirm('Відновити дані з файлу? Поточні команди, матчі й бали буде замінено даними з файлу.')) return;
    try { const j = JSON.parse(await f.text()); await api('POST', '/api/restore', j); toast('Дані відновлено'); } catch (e) { toast('Не вдалося прочитати файл', true); }
  }
});
document.addEventListener('input', ev => {
  const k = ev.target.dataset && ev.target.dataset.change;
  if (k === 'teamSearch') { teamSearch = ev.target.value; const pos = ev.target.selectionStart; render(true); const i = document.querySelector('[data-change="teamSearch"]'); if (i) { i.focus(); i.setSelectionRange(pos, pos); } }
  if (k === 'logFilter') { logFilter = ev.target.value; const b = $('#logBody'); if (b) b.innerHTML = logRows(); }
});
document.addEventListener('submit', async ev => {
  const f = ev.target;
  if (f.id === 'loginForm') return;
  if (!f.id && !f.classList.contains('catForm')) return;
  ev.preventDefault();
  const fd = new FormData(f);
  try { await onSubmit(f, fd); } catch (e) { console.warn(e); }
});
async function onSubmit(f, fd) {
  if (f.id === 'bootForm') {
    try {
      await Backend.bootstrapFirebase(fd.get('name'), fd.get('login'), fd.get('password'), !!fd.get('useLocal'));
      loadState(); render(); toast('Базу ініціалізовано');
    } catch (e) { toast(e.message, true); }
    return;
  }
  if (f.id === 'fbForm') {
    try { Backend.setFirebaseConfig(parseFbConfig(fd.get('cfg'))); } catch (e) { toast(e.message, true); }
    return;
  }
  if (f.id === 'pwForm') { await api('PUT', '/api/me/password', { old: fd.get('old'), new: fd.get('new') }); closeModal(); toast('Пароль змінено'); }
  if (f.id === 'teamForm') {
    const members = Array.from(f.querySelectorAll('.member-row')).map(r => { const o = {}; r.querySelectorAll('[data-f]').forEach(i => { o[i.dataset.f] = i.value; }); return o; });
    const body = { name: fd.get('name'), school: fd.get('school'), settlement: fd.get('settlement'), members, categories: fd.getAll('cat') };
    const j = f.dataset.id ? await api('PUT', '/api/teams/' + f.dataset.id, body) : await api('POST', '/api/teams', body);
    closeModal(); toast('Команду збережено'); notes(j);
  }
  if (f.id === 'userForm') {
    const body = { name: fd.get('name'), login: fd.get('login'), role: fd.get('role') || undefined, categories: fd.getAll('cat') };
    if (fd.get('password')) body.password = fd.get('password');
    if (f.dataset.id) await api('PUT', '/api/users/' + f.dataset.id, body); else await api('POST', '/api/users', body);
    closeModal(); toast('Збережено');
  }
  if (f.id === 'metaForm') { await api('PUT', '/api/meta', Object.fromEntries(fd)); toast('Збережено'); }
  if (f.classList.contains('catForm')) {
    const settings = {};
    ['timerDuration', 'timerExtra', 'penaltySec', 'wallPenalty', 'penaltyOutside'].forEach(k => { if (fd.get(k) !== null) settings[k] = Number(fd.get(k)); });
    if (fd.get('rankMode')) settings.rankMode = fd.get('rankMode');
    await api('PUT', '/api/categories/' + f.dataset.id, { name: fd.get('name'), settings });
    toast('Налаштування категорії збережено');
  }
}
document.addEventListener('keydown', ev => { if (ev.key === 'Escape') closeModal(); });

/* ================= старт ================= */
(async function start() {
  $('#app').innerHTML = '<div class="empty" style="margin:20vh auto;max-width:400px">Завантаження…</div>';
  await Backend.start();
  loadState();
  render();
})();
