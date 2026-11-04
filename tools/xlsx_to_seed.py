"""Перетворює Excel зі списками команд у src/seed.json для системи RoboGames."""
import json, re, sys, openpyxl

SHEET_TO_CAT = {
    'Доставка майбутнього': 'delivery',
    'Баскетбол': 'basketball',
    'Футбол': 'football',
    'Сумо': 'sumo',
    'Лабіринт': 'maze',
    'Robo-біатлон': 'biathlon',
    'Проєкт майбутнього': 'smart',
}
SETTLEMENTS = [
    ('Кременчуцька', 'м. Кременчук'), ('Гадяцький', 'м. Гадяч'), ('міста Київ', 'м. Київ'),
    ('Шишацький', 'смт Шишаки'), ('Горішньоплавнівської', 'м. Горішні Плавні'),
    ('Терешківська', 'с. Терешки'), ('Пришибської', 'с. Пришиб'),
    ('Полтавської міської ради', 'м. Полтава'), ('Полтавський фаховий коледж', 'м. Полтава'),
    ('Польтавський міжшкільний', 'м. Полтава'), ('Полтавський міський', 'м. Полтава'),
]
def clean(s):
    return re.sub(r'\s+', ' ', str(s)).strip() if s is not None else ''
def settlement(school):
    for k, v in SETTLEMENTS:
        if k in school: return v
    return ''
def person(full):
    parts = clean(full).split(' ')
    return {'surname': parts[0], 'name': parts[1] if len(parts) > 1 else '',
            'patronymic': ' '.join(parts[2:]), 'birthdate': ''}

wb = openpyxl.load_workbook(sys.argv[1], data_only=True)
teams, entries = {}, []
for ws in wb:
    cat = SHEET_TO_CAT.get(ws.title.strip())
    if not cat: continue
    header = [clean(c) for c in next(ws.iter_rows(min_row=2, max_row=2, values_only=True))]
    has_school = 'Школа' in header
    for row in ws.iter_rows(min_row=3, values_only=True):
        row = list(row)
        if has_school:
            school, name, members = clean(row[1]), clean(row[2]), row[3:]
        else:
            school, name, members = '', clean(row[1]), row[2:]
        if not name: continue
        key = (name.lower(), re.sub(r'№\s*', '№', school.lower()))
        mem = [person(m) for m in members if clean(m)]
        t = teams.get(key)
        if not t:
            t = teams[key] = {'id': 't%d' % (len(teams) + 1), 'name': name, 'school': school,
                              'settlement': settlement(school), 'members': mem}
        elif len(mem) > len(t['members']):
            t['members'] = mem
        entries.append({'teamId': t['id'], 'category': cat})
json.dump({'teams': list(teams.values()), 'entries': entries}, open(sys.argv[2], 'w', encoding='utf-8'),
          ensure_ascii=False, indent=1)
print(len(teams), 'teams,', len(entries), 'entries')
