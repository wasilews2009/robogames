/* Спільна логіка підрахунку балів і турнірних схем RoboGames.
 * Працює і в браузері (window.RG), і на сервері (require). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RG = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const GROUP_NAMES = ['А', 'Б', 'В', 'Г'];

  const TYPES = {
    delivery: {
      kind: 'individual', title: 'Доставка майбутнього', icon: '📦', color: '#0ea5e9',
      rounds: 1, unit: 'бали', better: 'high',
      timer: { mode: 'up', duration: 0 },
      defaults: { pointsPerBox: 10, penaltyOutside: 5, bookMax: 10 },
      rules: 'Один автономний заїзд. 3 вантажі — 30 б, 2 — 20 б, 1 — 10 б. −5 б за кожну коробку, що виходить за межі місця доставки. До +10 б за інженерну книгу.'
    },
    maze: {
      kind: 'individual', title: 'Лабіринт', icon: '🧩', color: '#eab308',
      rounds: 2, unit: 'с', better: 'low',
      timer: { mode: 'up', duration: 0 },
      defaults: { penaltySec: 5, rankMode: 'best', placePoints: [30, 20, 10] },
      rules: 'Два раунди автономного проходження. Рейтинг за часом (з урахуванням штрафних секунд за торкання стінок). 1 місце — 30 б, 2 — 20 б, 3 — 10 б.'
    },
    smart: {
      kind: 'scorecard', title: 'Сучасні Smart рішення', icon: '💡', color: '#14b8a6',
      rounds: 1, unit: 'бали', better: 'high',
      timer: { mode: 'down', duration: 300 },
      defaults: {
        criteria: [
          { key: 'relevance', label: 'Актуальність ідеї', max: 5, round: 1 },
          { key: 'innovation', label: 'Інноваційність ідеї', max: 5, round: 1 },
          { key: 'circuit', label: 'Реалізація схеми (дроти, акуратність збірки)', max: 5, round: 1 },
          { key: 'code', label: 'Якість програмної реалізації', max: 5, round: 1 },
          { key: 'stress', label: 'Стрес-тест та відповіді на запитання', max: 10, round: 2 }
        ]
      },
      rules: 'Раунд 1 — презентація (до 5 хв), 4 критерії по 5 балів. Раунд 2 — стрес-тест і запитання, до 10 балів. Підсумок — середнє за оцінками всіх суддів категорії.'
    },
    basketball: {
      kind: 'match', title: 'Баскетбол', icon: '🏀', color: '#f97316',
      timer: { mode: 'down', duration: 120 },
      defaults: {},
      rules: 'Матч 120 с. Закидання зверху — 3 очки, заштовхування в нішу — 1 очко. Перемога в матчі — 10 б, нічия — 5 б. У групі: перемога 3, нічия 1, поразка 0; при рівності — сума ігрових очок.'
    },
    football: {
      kind: 'match', title: 'Футбол', icon: '⚽', color: '#22c55e',
      timer: { mode: 'down', duration: 120, extra: 60 },
      defaults: {},
      rules: 'Два тайми до 120 с або до першого гола; при нічиїй — третій тайм 60 с. Виграний тайм — 10 б, нічия в таймі — по 5 б. Wildcard серед других місць — за середнім показником за матч.'
    },
    sumo: {
      kind: 'match', title: 'Сумо', icon: '🥋', color: '#a855f7',
      timer: { mode: 'down', duration: 90 },
      defaults: {},
      rules: 'Два раунди до 90 с; при рівності — третій раунд, за рішенням судді — додатковий. Виграний раунд — 10 б. Якщо ніхто не виштовхнутий — перемагає робот, ближчий до центру.'
    },
    biathlon: {
      kind: 'match', title: 'Робо-біатлон', icon: '🎯', color: '#ef4444',
      timer: { mode: 'down', duration: 300 },
      defaults: { targets: [100, 150, 250], wallPenalty: 20 },
      rules: 'Раунд 5 хв, 1 на 1. Мішені 100/150/250 б (зараховуються лише після зчитування QR-коду). −20 б за кожен дотик до стінок лабіринту. Перемагає команда з більшою сумою.'
    }
  };

  function settingsOf(cat) {
    const t = TYPES[cat.type] || {};
    return Object.assign({}, JSON.parse(JSON.stringify(t.defaults || {})), cat.settings || {});
  }

  /* ---------- Груповий етап ---------- */
  function groupCount(n) {
    if (n <= 5) return 1;
    if (n <= 15) return 3;
    return 4;
  }
  function groupSizes(n, g) {
    const base = Math.floor(n / g), rest = n % g;
    return Array.from({ length: g }, (_, i) => base + (i < rest ? 1 : 0));
  }
  /* Колова система (метод кола) — повертає тури з парами індексів */
  function roundRobin(n) {
    const ids = Array.from({ length: n }, (_, i) => i);
    if (n % 2) ids.push(-1);
    const m = ids.length, rounds = [];
    for (let r = 0; r < m - 1; r++) {
      const pairs = [];
      for (let i = 0; i < m / 2; i++) {
        const a = ids[i], b = ids[m - 1 - i];
        if (a >= 0 && b >= 0) pairs.push(r % 2 ? [b, a] : [a, b]);
      }
      rounds.push(pairs);
      ids.splice(1, 0, ids.pop());
    }
    return rounds;
  }

  /* ---------- Рахунок матчу ---------- */
  function emptyMatchData(type) {
    switch (type) {
      case 'basketball': return { a3: 0, a1: 0, b3: 0, b1: 0, log: [] };
      case 'football': return { halves: [] };
      case 'sumo': return { rounds: [] };
      case 'biathlon': return { A: { hits: [], touches: 0, other: 0 }, B: { hits: [], touches: 0, other: 0 } };
      default: return {};
    }
  }

  function biathlonSide(s, set) {
    s = s || {};
    const hits = (s.hits || []).reduce((acc, v) => acc + Number(v || 0), 0);
    const pen = (Number(s.touches) || 0) * (set.wallPenalty || 20);
    return { hits, pen, total: hits - pen + (Number(s.other) || 0) };
  }

  /* Повертає { a, b, winner: 'A'|'B'|'D'|null, goalsA, goalsB, text } */
  function matchScore(type, data, set) {
    data = data || {};
    set = set || {};
    let a = 0, b = 0, text = '', ga = 0, gb = 0;
    if (type === 'basketball') {
      a = 3 * (data.a3 || 0) + (data.a1 || 0);
      b = 3 * (data.b3 || 0) + (data.b1 || 0);
      ga = a; gb = b;
      text = `${a}:${b}`;
    } else if (type === 'football') {
      (data.halves || []).forEach(h => {
        if (h === 'A') { a += 10; ga++; } else if (h === 'B') { b += 10; gb++; } else if (h === 'D') { a += 5; b += 5; }
      });
      text = `${a}:${b}` + ((data.halves || []).length ? ` (тайми: ${(data.halves || []).map(h => h === 'A' ? '1:0' : h === 'B' ? '0:1' : '0:0').join(', ')})` : '');
    } else if (type === 'sumo') {
      (data.rounds || []).forEach(r => { if (r === 'A') { a += 10; ga++; } else if (r === 'B') { b += 10; gb++; } });
      text = `${a}:${b}` + ((data.rounds || []).length ? ` (раунди ${ga}:${gb})` : '');
    } else if (type === 'biathlon') {
      const A = biathlonSide(data.A, set), B = biathlonSide(data.B, set);
      a = A.total; b = B.total; ga = a; gb = b;
      text = `${a}:${b}`;
    }
    let winner = a > b ? 'A' : b > a ? 'B' : 'D';
    if (winner === 'D' && (data.tb === 'A' || data.tb === 'B')) winner = data.tb;
    if (winner === 'D' && data.tb) text += '';
    if (data.tb && a === b) text += ` (переможець за рішенням судді: ${data.tb === 'A' ? 'команда 1' : 'команда 2'})`;
    return { a, b, winner, goalsA: ga, goalsB: gb, text };
  }

  /* Бали за регламентом за матч (для зведених таблиць) */
  function regPoints(type, sc, side) {
    if (type === 'basketball' || type === 'biathlon') {
      if (sc.winner === 'D') return 5;
      return sc.winner === side ? 10 : 0;
    }
    return side === 'A' ? sc.a : sc.b; // футбол/сумо: бали за тайми/раунди
  }

  function isDone(m) { return m && m.status === 'done'; }

  function groupStandings(cat, teamIds, matches) {
    const set = settingsOf(cat);
    const rows = {};
    teamIds.forEach(id => { rows[id] = { teamId: id, p: 0, w: 0, d: 0, l: 0, pts: 0, gf: 0, ga: 0, rp: 0 }; });
    matches.filter(m => m.stage === 'group' && isDone(m) && rows[m.teamA] && rows[m.teamB]).forEach(m => {
      const sc = matchScore(cat.type, m.data, set);
      const A = rows[m.teamA], B = rows[m.teamB];
      A.p++; B.p++;
      A.gf += sc.a; A.ga += sc.b; B.gf += sc.b; B.ga += sc.a;
      A.rp += regPoints(cat.type, sc, 'A'); B.rp += regPoints(cat.type, sc, 'B');
      // у груповому етапі рішення судді (tb) не скасовує нічию
      const w = sc.a > sc.b ? 'A' : sc.b > sc.a ? 'B' : 'D';
      if (w === 'A') { A.w++; B.l++; A.pts += 3; } else if (w === 'B') { B.w++; A.l++; B.pts += 3; } else { A.d++; B.d++; A.pts++; B.pts++; }
    });
    const list = Object.values(rows);
    list.forEach(r => { r.avgPts = r.p ? r.pts / r.p : 0; r.avgGf = r.p ? r.gf / r.p : 0; r.diff = r.gf - r.ga; });
    list.sort((x, y) => y.pts - x.pts || y.gf - x.gf || y.diff - x.diff || y.w - x.w);
    list.forEach((r, i) => { r.pos = i + 1; });
    return list;
  }

  function byAvg(x, y) { return y.avgPts - x.avgPts || y.avgGf - x.avgGf || (y.diff / (y.p || 1)) - (x.diff / (x.p || 1)); }

  function groupsOf(entries) {
    const g = {};
    entries.forEach(e => { if (e.group) (g[e.group] = g[e.group] || []).push(e.teamId); });
    return Object.keys(g).sort((a, b) => GROUP_NAMES.indexOf(a) - GROUP_NAMES.indexOf(b)).map(name => ({ name, teamIds: g[name] }));
  }

  /* Учасники плей-оф: seeds[0..3] => ПФ1: s0 vs s3, ПФ2: s1 vs s2 */
  function qualifiers(cat, entries, matches) {
    const groups = groupsOf(entries).filter(g => g.teamIds.length);
    const tables = groups.map(g => ({ name: g.name, rows: groupStandings(cat, g.teamIds, matches.filter(m => m.group === g.name)) }));
    let seeds = [], wildcard = null, labels = [];
    if (tables.length === 1) {
      seeds = tables[0].rows.slice(0, 4).map(r => r.teamId);
      labels = ['1-ше місце', '2-ге місце', '3-тє місце', '4-те місце'];
    } else if (tables.length === 2) {
      const [A, B] = tables;
      seeds = [A.rows[0], B.rows[0], A.rows[1], B.rows[1]].map(r => r && r.teamId);
      // ПФ1: A1-B2, ПФ2: B1-A2
      seeds = [seeds[0], seeds[1], seeds[2], seeds[3]];
      seeds = [seeds[0], seeds[1], seeds[2], seeds[3]];
      labels = [`1 гр. ${A.name}`, `1 гр. ${B.name}`, `2 гр. ${A.name}`, `2 гр. ${B.name}`];
      return { tables, seeds: [seeds[0], seeds[1], seeds[2], seeds[3]], sf: [[seeds[0], seeds[3]], [seeds[1], seeds[2]]], wildcard: null, labels };
    } else {
      const winners = tables.map(t => Object.assign({ group: t.name }, t.rows[0])).filter(r => r.teamId);
      winners.sort(byAvg);
      seeds = winners.map(r => r.teamId);
      labels = winners.map((r, i) => `${i + 1}-й серед переможців груп (гр. ${r.group})`);
      if (tables.length === 3) {
        const seconds = tables.map(t => Object.assign({ group: t.name }, t.rows[1])).filter(r => r.teamId);
        seconds.sort(byAvg);
        wildcard = seconds[0] ? seconds[0].teamId : null;
        seeds.push(wildcard);
        labels.push(seconds[0] ? `Wildcard — найкраще 2-ге місце (гр. ${seconds[0].group})` : 'Wildcard');
      }
    }
    return { tables, seeds, sf: [[seeds[0], seeds[3]], [seeds[1], seeds[2]]], wildcard, labels };
  }

  const STAGES = {
    group: 'Груповий етап', sf1: 'Півфінал 1', sf2: 'Півфінал 2', third: 'Матч за 3-тє місце', final: 'Фінал'
  };

  function winnerOf(cat, m) {
    if (!isDone(m)) return null;
    const sc = matchScore(cat.type, m.data, settingsOf(cat));
    if (sc.winner === 'A') return m.teamA;
    if (sc.winner === 'B') return m.teamB;
    return null;
  }
  function loserOf(cat, m) {
    const w = winnerOf(cat, m);
    if (!w) return null;
    return w === m.teamA ? m.teamB : m.teamA;
  }

  /* ---------- Індивідуальні заїзди ---------- */
  function runScore(cat, data) {
    const set = settingsOf(cat);
    data = data || {};
    if (cat.type === 'delivery') {
      const delivered = Math.max(0, Math.min(3, Number(data.delivered) || 0));
      const outside = Math.max(0, Number(data.outside) || 0);
      const book = Math.max(0, Math.min(set.bookMax, Number(data.book) || 0));
      const total = delivered * set.pointsPerBox - outside * set.penaltyOutside + book;
      return { total, delivered, outside, book, time: Number(data.time) || null };
    }
    if (cat.type === 'maze') {
      const time = Number(data.time) || 0;
      const touches = Number(data.touches) || 0;
      const finished = !!data.finished && time > 0;
      return { finished, time, touches, adj: finished ? Math.round((time + touches * set.penaltySec) * 100) / 100 : null };
    }
    if (cat.type === 'smart') {
      let total = 0;
      (set.criteria || []).forEach(c => { total += Math.max(0, Math.min(c.max, Number((data.scores || {})[c.key]) || 0)); });
      return { total };
    }
    return {};
  }

  function fmtNum(x, d) {
    if (x === null || x === undefined || isNaN(x)) return '—';
    const r = Math.round(x * Math.pow(10, d || 0)) / Math.pow(10, d || 0);
    return String(r).replace('.', ',');
  }

  /* ---------- Підсумковий рейтинг категорії ----------
   * Повертає [{teamId, place, result, resultText, points, details}] */
  function ranking(state, cat) {
    const type = TYPES[cat.type];
    const set = settingsOf(cat);
    const entries = state.entries.filter(e => e.categoryId === cat.id);
    const teamIds = entries.map(e => e.teamId);
    if (!type) return [];
    if (type.kind === 'match') {
      const matches = state.matches.filter(m => m.categoryId === cat.id);
      const q = qualifiers(cat, entries, matches);
      // загальна статистика групового етапу
      const all = {};
      q.tables.forEach(t => t.rows.forEach(r => { all[r.teamId] = Object.assign({ group: t.name }, r); }));
      teamIds.forEach(id => { if (!all[id]) all[id] = { teamId: id, p: 0, w: 0, d: 0, l: 0, pts: 0, gf: 0, ga: 0, rp: 0, avgPts: 0, avgGf: 0, diff: 0 }; });
      // бали за регламентом з плей-оф теж
      const extraRp = {};
      matches.filter(m => m.stage !== 'group' && isDone(m)).forEach(m => {
        const sc = matchScore(cat.type, m.data, set);
        extraRp[m.teamA] = (extraRp[m.teamA] || 0) + regPoints(cat.type, sc, 'A');
        extraRp[m.teamB] = (extraRp[m.teamB] || 0) + regPoints(cat.type, sc, 'B');
      });
      const st = {};
      matches.forEach(m => { if (m.stage !== 'group') st[m.stage] = m; });
      const top = [];
      const fin = st.final, third = st.third;
      if (fin && isDone(fin)) { top.push(winnerOf(cat, fin), loserOf(cat, fin)); }
      if (third && isDone(third)) {
        while (top.length < 2) top.push(null);
        top.push(winnerOf(cat, third), loserOf(cat, third));
      }
      const placed = new Set(top.filter(Boolean));
      const rest = teamIds.filter(id => !placed.has(id)).map(id => all[id]);
      // ті, хто дійшов до півфіналу, але ще без місця — вище за інших
      const sfTeams = new Set();
      ['sf1', 'sf2'].forEach(s => { if (st[s]) { if (st[s].teamA) sfTeams.add(st[s].teamA); if (st[s].teamB) sfTeams.add(st[s].teamB); } });
      rest.sort((x, y) => (sfTeams.has(y.teamId) - sfTeams.has(x.teamId)) || byAvg(x, y) || y.gf - x.gf);
      const order = top.map(id => id ? all[id] : null).filter(Boolean).concat(rest);
      const anyPlayed = matches.some(isDone);
      return order.map((r, i) => {
        const rp = r.rp + (extraRp[r.teamId] || 0);
        return {
          teamId: r.teamId,
          place: anyPlayed ? i + 1 : null,
          result: rp,
          resultText: `${r.w}-${r.d}-${r.l}`,
          points: rp,
          details: { group: r.group, p: r.p, w: r.w, d: r.d, l: r.l, pts: r.pts, gf: r.gf, ga: r.ga, rp, playoff: top.indexOf(r.teamId) >= 0 }
        };
      });
    }
    const runs = state.runs.filter(r => r.categoryId === cat.id);
    if (cat.type === 'delivery') {
      const rows = teamIds.map(id => {
        const run = runs.find(r => r.teamId === id && r.round === 1 && r.status === 'done');
        const s = run ? runScore(cat, run.data) : null;
        return { teamId: id, s };
      });
      rows.sort((x, y) => (!!y.s - !!x.s) || (y.s && x.s ? (y.s.total - x.s.total) || ((x.s.time || 1e9) - (y.s.time || 1e9)) : 0));
      return rows.map((r, i) => ({
        teamId: r.teamId, place: r.s ? i + 1 : null,
        result: r.s ? r.s.total : null, points: r.s ? r.s.total : null,
        resultText: r.s ? `${r.s.total} б` : '—', details: r.s
      }));
    }
    if (cat.type === 'maze') {
      const rows = teamIds.map(id => {
        const rr = [1, 2].map(n => {
          const run = runs.find(r => r.teamId === id && r.round === n && r.status === 'done');
          return run ? runScore(cat, run.data) : null;
        });
        const fin = rr.filter(x => x && x.finished);
        let val = null;
        if (set.rankMode === 'sum') val = fin.length === 2 ? fin[0].adj + fin[1].adj : null;
        else val = fin.length ? Math.min.apply(null, fin.map(x => x.adj)) : null;
        return { teamId: id, rr, val, finished: fin.length, attempted: rr.filter(Boolean).length };
      });
      rows.sort((x, y) => {
        if (x.val !== null && y.val !== null) return x.val - y.val;
        if (x.val !== null) return -1;
        if (y.val !== null) return 1;
        return y.finished - x.finished || y.attempted - x.attempted;
      });
      const pp = set.placePoints || [30, 20, 10];
      return rows.map((r, i) => ({
        teamId: r.teamId, place: r.attempted ? i + 1 : null,
        result: r.val, resultText: r.val !== null ? `${fmtNum(r.val, 2)} с` : (r.attempted ? 'не фінішував' : '—'),
        points: r.val !== null ? (pp[i] || 0) : 0, details: { rounds: r.rr }
      }));
    }
    if (cat.type === 'smart') {
      const rows = teamIds.map(id => {
        const cards = runs.filter(r => r.teamId === id && r.status === 'done');
        const totals = cards.map(c => runScore(cat, c.data).total);
        const avg = totals.length ? totals.reduce((a, b) => a + b, 0) / totals.length : null;
        return { teamId: id, avg, n: totals.length, totals };
      });
      rows.sort((x, y) => (y.avg !== null) - (x.avg !== null) || (y.avg || 0) - (x.avg || 0));
      return rows.map((r, i) => ({
        teamId: r.teamId, place: r.avg !== null ? i + 1 : null,
        result: r.avg, points: r.avg, resultText: r.avg !== null ? `${fmtNum(r.avg, 2)} б` : '—',
        details: { judges: r.n, totals: r.totals }
      }));
    }
    return [];
  }

  /* Прогрес категорії: {done, live, total} */
  function progress(state, cat) {
    const type = TYPES[cat.type];
    if (!type) return { done: 0, live: 0, total: 0 };
    if (type.kind === 'match') {
      const ms = state.matches.filter(m => m.categoryId === cat.id);
      return { done: ms.filter(isDone).length, live: ms.filter(m => m.status === 'live').length, total: ms.length };
    }
    const n = state.entries.filter(e => e.categoryId === cat.id).length;
    const runs = state.runs.filter(r => r.categoryId === cat.id);
    if (type.kind === 'scorecard') {
      const judges = Math.max(1, state.users.filter(u => (u.categories || []).indexOf(cat.id) >= 0 && u.role === 'judge').length);
      return { done: runs.filter(r => r.status === 'done').length, live: runs.filter(r => r.status === 'live').length, total: n * judges };
    }
    return { done: runs.filter(r => r.status === 'done').length, live: runs.filter(r => r.status === 'live').length, total: n * type.rounds };
  }

  return {
    TYPES, GROUP_NAMES, STAGES, settingsOf, groupCount, groupSizes, roundRobin,
    emptyMatchData, matchScore, regPoints, biathlonSide, groupStandings, groupsOf, qualifiers,
    winnerOf, loserOf, runScore, ranking, progress, isDone, fmtNum
  };
});
