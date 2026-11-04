const DOCS = (function () {
'use strict';
/* Формування протоколів і зведених відомостей (блоки для docx/html) */

function ctx(db) {
  const teams = {}; db.teams.forEach(t => { teams[t.id] = t; });
  const users = {}; db.users.forEach(u => { users[u.id] = u; });
  return {
    db, teams, users,
    tn: id => (teams[id] ? teams[id].name : '—'),
    un: id => (users[id] ? users[id].name : ''),
    judges: cat => db.users.filter(u => u.role === 'judge' && (u.categories || []).indexOf(cat.id) >= 0)
  };
}
function fmtDate(s) {
  if (!s) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : s;
}
function memberLine(m, withBirth) {
  const n = [m.surname, m.name, m.patronymic].filter(Boolean).join(' ');
  return withBirth && m.birthdate ? `${n} (${fmtDate(m.birthdate)})` : n;
}
function header(c, title, cat) {
  const meta = c.db.meta || {};
  const b = [
    { t: 'logos' },
    { t: 'p', text: meta.title || 'Обласні змагання з робототехніки «RoboGames-2026»', bold: true, align: 'center', size: 13, after: 20 },
    { t: 'p', text: [meta.place, fmtDate(meta.date)].filter(Boolean).join(', '), align: 'center', size: 11, after: 120 },
    { t: 'h1', text: title }
  ];
  if (cat) b.push({ t: 'p', text: `Категорія «${cat.name}»`, bold: true, align: 'center', size: 14, after: 120 });
  return b;
}
function sigs(c, cat, opts) {
  opts = opts || {};
  const items = [];
  if (cat && !opts.noJudges) {
    const j = opts.judges || c.judges(cat);
    if (j.length) j.forEach(u => items.push({ role: 'Суддя категорії', name: u.name }));
    else items.push({ role: 'Суддя категорії', name: '' }, { role: 'Суддя категорії', name: '' });
  }
  if (!opts.noChair) items.push({ role: 'Голова журі', name: (c.db.meta || {}).chairName || '' });
  return [{ t: 'p', text: `Дата складання: ${new Date().toLocaleDateString('uk-UA')}`, italic: true, size: 10, before: 120 }, { t: 'signatures', items }];
}
const STATUS = { scheduled: 'заплановано', live: 'триває', done: 'завершено' };

function placeText(r) { return r.place ? String(r.place) : '—'; }

function rankingTable(c, cat, rank, full) {
  const type = RG.TYPES[cat.type];
  const head = ['Місце', 'Команда', 'Заклад освіти', 'Населений пункт'];
  if (full) head.push('Учасники');
  const widths = full ? [7, 13, 27, 12, 21] : [8, 20, 40, 16];
  if (type.kind === 'match') { head.push('В-Н-П', 'Бали'); widths.push(9, 8); }
  else if (cat.type === 'maze') { head.push('Результат', 'Бали'); widths.push(11, 8); }
  else { head.push('Бали'); widths.push(13); }
  const sum = widths.reduce((a, b) => a + b, 0);
  const rows = rank.map(r => {
    const t = c.teams[r.teamId] || {};
    const row = [placeText(r), t.name || '—', t.school || '', t.settlement || ''];
    if (full) row.push((t.members || []).map(m => memberLine(m)).join('\n'));
    if (type.kind === 'match') row.push(r.resultText, RG.fmtNum(r.points, 2));
    else if (cat.type === 'maze') row.push(r.resultText, String(r.points || 0));
    else row.push(r.result === null ? '—' : RG.fmtNum(r.result, 2));
    return row;
  });
  return { t: 'table', head, rows, widths: widths.map(w => w * 100 / sum), center: [0, head.length - 1, head.length - 2] };
}

/* ---------- Протокол категорії ---------- */
function protocol(db, cat) {
  const c = ctx(db);
  const type = RG.TYPES[cat.type];
  const set = RG.settingsOf(cat);
  const state = { entries: db.entries, matches: db.matches, runs: db.runs, users: db.users };
  let b = header(c, 'ПРОТОКОЛ СУДДІВСТВА', cat);
  b.push({ t: 'p', text: 'Правила оцінювання: ' + type.rules, italic: true, size: 10, after: 100 });
  const entries = db.entries.filter(e => e.categoryId === cat.id);

  if (type.kind === 'match') {
    const matches = db.matches.filter(m => m.categoryId === cat.id).sort((a, b) => a.order - b.order);
    const q = RG.qualifiers(cat, entries, matches);
    q.tables.forEach(g => {
      b.push({ t: 'h2', text: `Група ${g.name}` });
      const gm = matches.filter(m => m.stage === 'group' && m.group === g.name);
      b.push({
        t: 'table', head: ['№', 'Команда 1', 'Рахунок', 'Команда 2', 'Переможець', 'Статус', 'Суддя'],
        widths: [5, 19, 20, 19, 15, 10, 12], center: [0, 2, 5],
        rows: gm.map(m => {
          const sc = RG.matchScore(cat.type, m.data, set);
          const done = m.status === 'done';
          const w = done ? (sc.a > sc.b ? c.tn(m.teamA) : sc.b > sc.a ? c.tn(m.teamB) : 'нічия') : '';
          return [String(m.order), c.tn(m.teamA), done || m.status === 'live' ? sc.text : '', c.tn(m.teamB), w, STATUS[m.status], c.un(m.updatedBy)];
        })
      });
      b.push({
        t: 'table', head: ['Місце', 'Команда', 'Ігор', 'В', 'Н', 'П', 'Очки (3/1/0)', 'Ігрові очки', 'Бали'],
        widths: [8, 28, 8, 7, 7, 7, 12, 13, 10], center: [0, 2, 3, 4, 5, 6, 7, 8],
        rows: g.rows.map(r => [String(r.pos), c.tn(r.teamId), String(r.p), String(r.w), String(r.d), String(r.l), String(r.pts), `${r.gf}–${r.ga}`, String(r.rp)])
      });
    });
    const po = matches.filter(m => m.stage !== 'group');
    if (po.length) {
      b.push({ t: 'h2', text: 'Плей-оф («Фінал чотирьох»)' });
      if (q.wildcard) b.push({ t: 'p', text: `Wildcard (найкраще 2-ге місце за середнім показником за матч): ${c.tn(q.wildcard)}`, size: 11 });
      b.push({
        t: 'table', head: ['Етап', 'Команда 1', 'Рахунок', 'Команда 2', 'Переможець', 'Суддя'],
        widths: [16, 19, 22, 19, 13, 11], center: [2],
        rows: ['sf1', 'sf2', 'third', 'final'].map(s => po.find(m => m.stage === s)).filter(Boolean).map(m => {
          const sc = RG.matchScore(cat.type, m.data, set);
          const w = RG.winnerOf(cat, m);
          return [RG.STAGES[m.stage], m.teamA ? c.tn(m.teamA) : 'визначається', m.status !== 'scheduled' ? sc.text : '', m.teamB ? c.tn(m.teamB) : 'визначається', w ? c.tn(w) : '', c.un(m.updatedBy)];
        })
      });
    }
  } else if (cat.type === 'delivery') {
    const runs = db.runs.filter(r => r.categoryId === cat.id);
    b.push({
      t: 'table', head: ['№', 'Команда', 'Доставлено вантажів', 'Коробок за межами (−5)', 'Інженерна книга', 'Час, с', 'Сума балів', 'Суддя'],
      widths: [5, 22, 12, 13, 12, 9, 11, 16], center: [0, 2, 3, 4, 5, 6],
      rows: entries.sort((a, b) => (a.order || 0) - (b.order || 0)).map((e, i) => {
        const run = runs.find(r => r.teamId === e.teamId && r.round === 1);
        if (!run) return [String(i + 1), c.tn(e.teamId), '', '', '', '', 'не виступала', ''];
        const s = RG.runScore(cat, run.data);
        return [String(i + 1), c.tn(e.teamId), String(s.delivered), String(s.outside), String(s.book), s.time ? RG.fmtNum(s.time, 2) : '', String(s.total) + (run.status !== 'done' ? ' (не завершено)' : ''), c.un(run.updatedBy)];
      })
    });
  } else if (cat.type === 'maze') {
    const runs = db.runs.filter(r => r.categoryId === cat.id);
    b.push({ t: 'p', text: `Штраф за торкання стінки: +${set.penaltySec} с. Рейтинг: ${set.rankMode === 'sum' ? 'сума двох раундів' : 'найкращий раунд'}.`, size: 11 });
    const cell = (s, run) => !run ? ['', '', ''] : [s.time ? RG.fmtNum(s.time, 2) : '', String(s.touches), s.finished ? RG.fmtNum(s.adj, 2) : 'не фініш.'];
    b.push({
      t: 'table', head: ['№', 'Команда', 'Р1: час, с', 'Р1: торк.', 'Р1: підсумок', 'Р2: час, с', 'Р2: торк.', 'Р2: підсумок', 'Суддя'],
      widths: [5, 22, 10, 8, 11, 10, 8, 11, 15], center: [0, 2, 3, 4, 5, 6, 7],
      rows: entries.sort((a, b) => (a.order || 0) - (b.order || 0)).map((e, i) => {
        const r1 = runs.find(r => r.teamId === e.teamId && r.round === 1);
        const r2 = runs.find(r => r.teamId === e.teamId && r.round === 2);
        return [String(i + 1), c.tn(e.teamId)].concat(cell(r1 && RG.runScore(cat, r1.data), r1), cell(r2 && RG.runScore(cat, r2.data), r2), [[r1, r2].filter(Boolean).map(r => c.un(r.updatedBy)).filter((v, i, a) => v && a.indexOf(v) === i).join(', ')]);
      })
    });
  } else if (cat.type === 'smart') {
    const crit = set.criteria;
    const runs = db.runs.filter(r => r.categoryId === cat.id);
    const judgeIds = Array.from(new Set(runs.map(r => r.judgeId)));
    b.push({ t: 'h2', text: 'Оцінки суддів (сума балів)' });
    b.push({
      t: 'table', head: ['Команда'].concat(judgeIds.map(id => c.un(id) || 'суддя'), ['Середній бал']),
      widths: [30].concat(judgeIds.map(() => 55 / Math.max(1, judgeIds.length)), [15]),
      center: judgeIds.map((_, i) => i + 1).concat([judgeIds.length + 1]),
      rows: entries.map(e => {
        const vals = judgeIds.map(j => { const r = runs.find(x => x.teamId === e.teamId && x.judgeId === j); return r ? RG.runScore(cat, r.data).total : null; });
        const v = vals.filter(x => x !== null);
        return [c.tn(e.teamId)].concat(vals.map(x => x === null ? '—' : String(x)), [v.length ? RG.fmtNum(v.reduce((a, b) => a + b, 0) / v.length, 2) : '—']);
      })
    });
    b.push({ t: 'p', text: 'Критерії: ' + crit.map(k => `${k.label} (до ${k.max})`).join('; '), size: 10, italic: true });
  }
  b.push({ t: 'h2', text: 'Підсумковий рейтинг' });
  b.push(rankingTable(c, cat, RG.ranking(state, cat), false));
  b = b.concat(sigs(c, cat));
  return { blocks: b, landscape: true, title: `Протокол — ${cat.name}` };
}

/* ---------- Оціночні листи суддів (Smart) ---------- */
function scorecards(db, cat) {
  const c = ctx(db);
  const set = RG.settingsOf(cat);
  const crit = set.criteria;
  const entries = db.entries.filter(e => e.categoryId === cat.id);
  const runs = db.runs.filter(r => r.categoryId === cat.id);
  let judges = c.judges(cat);
  runs.forEach(r => { if (!judges.find(j => j.id === r.judgeId) && c.users[r.judgeId]) judges.push(c.users[r.judgeId]); });
  if (!judges.length) judges = [{ id: null, name: '' }];
  let b = [];
  judges.forEach((j, ji) => {
    if (ji) b.push({ t: 'pagebreak' });
    b = b.concat(header(c, 'ОЦІНОЧНИЙ ЛИСТ СУДДІ', cat));
    b.push({ t: 'p', text: `Суддя: ${j.name || '______________________________'}`, bold: true });
    b.push({
      t: 'table', head: ['№', 'Команда'].concat(crit.map(k => `${k.label} (0–${k.max})`), ['Сума']),
      widths: [4, 18].concat(crit.map(() => 68 / crit.length), [10]),
      center: [0].concat(crit.map((_, i) => i + 2), [crit.length + 2]),
      rows: entries.map((e, i) => {
        const r = runs.find(x => x.teamId === e.teamId && x.judgeId === j.id);
        const sc = (r && r.data && r.data.scores) || {};
        return [String(i + 1), c.tn(e.teamId)].concat(crit.map(k => r ? String(sc[k.key] || 0) : ''), [r ? String(RG.runScore(cat, r.data).total) : '']);
      })
    });
    b.push({ t: 'signatures', items: [{ role: 'Суддя', name: j.name }] });
  });
  return { blocks: b, landscape: true, title: `Оціночні листи — ${cat.name}` };
}

/* ---------- Зведена відомість категорії ---------- */
function summary(db, cat) {
  const c = ctx(db);
  const state = { entries: db.entries, matches: db.matches, runs: db.runs, users: db.users };
  let b = header(c, 'ЗВЕДЕНА ВІДОМІСТЬ РЕЗУЛЬТАТІВ', cat);
  const p = RG.progress(state, cat);
  b.push({ t: 'p', text: `Проведено: ${p.done} з ${p.total}${p.done < p.total ? ' (результати проміжні)' : ''}`, size: 11, italic: true });
  b.push(rankingTable(c, cat, RG.ranking(state, cat), true));
  b = b.concat(sigs(c, cat));
  return { blocks: b, landscape: true, title: `Зведена відомість — ${cat.name}` };
}

/* ---------- Загальна зведена відомість ---------- */
function overall(db) {
  const c = ctx(db);
  const state = { entries: db.entries, matches: db.matches, runs: db.runs, users: db.users };
  let b = header(c, 'ЗВЕДЕНА ВІДОМІСТЬ РЕЗУЛЬТАТІВ ЗМАГАНЬ');
  db.categories.slice().sort((a, b) => a.order - b.order).forEach(cat => {
    const rank = RG.ranking(state, cat);
    b.push({ t: 'h2', text: `${cat.name}` });
    if (!rank.length) { b.push({ t: 'p', text: 'Команди не зареєстровані.', italic: true }); return; }
    const p = RG.progress(state, cat);
    b.push({ t: 'p', text: `Проведено: ${p.done} з ${p.total}. Судді: ${c.judges(cat).map(u => u.name).join(', ') || '—'}`, size: 10, italic: true });
    b.push(rankingTable(c, cat, rank, false));
  });
  b = b.concat(sigs(c, null));
  return { blocks: b, landscape: true, title: 'Зведена відомість змагань' };
}

/* ---------- Реєстраційна відомість учасників ---------- */
function registry(db, cat) {
  const c = ctx(db);
  const cats = cat ? [cat] : db.categories.slice().sort((a, b) => a.order - b.order);
  let b = header(c, 'РЕЄСТРАЦІЙНА ВІДОМІСТЬ КОМАНД-УЧАСНИЦЬ', cat);
  cats.forEach(k => {
    const entries = db.entries.filter(e => e.categoryId === k.id);
    if (!cat) b.push({ t: 'h2', text: k.name });
    if (!entries.length) { b.push({ t: 'p', text: 'Команди не зареєстровані.', italic: true }); return; }
    b.push({
      t: 'table', head: ['№', 'Команда', 'Заклад освіти', 'Населений пункт', 'Учасники (прізвище, ім’я, дата народження)'],
      widths: [5, 15, 33, 14, 33], center: [0],
      rows: entries.map((e, i) => { const t = c.teams[e.teamId] || {}; return [String(i + 1), t.name, t.school, t.settlement, (t.members || []).map(m => memberLine(m, true)).join('\n')]; })
    });
  });
  b = b.concat(sigs(c, null));
  return { blocks: b, landscape: true, title: 'Реєстраційна відомість' };
}

return { protocol, summary, scorecards, overall, registry };

})();
