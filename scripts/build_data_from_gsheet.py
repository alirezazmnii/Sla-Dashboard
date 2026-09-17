"""
Regenerates data/data.json by reading live from a Google Sheet
(instead of the local xlsx file). Uses only the Python standard
library — no pip install needed, which keeps the GitHub Action fast
and dependency-free.

Requires the sheet's sharing setting to be "Anyone with the link -
Viewer" (no sign-in). It reads TWO tabs — one per operator category
— and merges them, tagging each operator with which tab it came from.

Usage:
    python scripts/build_data_from_gsheet.py [sheet_id] [output_json] [history_json]

Defaults:
    sheet_id     = the workbook shared in chat
    output_json  = data/data.json
    history_json = data/history.json
"""
import sys
import os
import csv
import io
import json
import urllib.request
import urllib.parse
from datetime import datetime, timezone

DEFAULT_SHEET_ID = '1E5OU--FCwpW4dBMxRj9MmuBsKzKzGx76FDZ9AvfRJF0'

# Each tab in the sheet is one operator category. The first item in each
# tuple is the EXACT tab name as it appears in Google Sheets (case-sensitive);
# the second is the short key used everywhere in the dashboard's data/code.
# If a tab gets renamed, just update the name here — nothing else needs to change.
CATEGORY_TABS = [
    ('freelancer', 'freelancer'),
    ('Center Issue', 'center_issue'),
]

# Header labels as BASE keywords — matched by "starts with" (case-insensitive),
# not exact equality. This is deliberate: the real sheet appends the week
# number straight onto the label with inconsistent spacing (e.g. the actual
# columns are "orders 1stweek-6" and "orders 2nd week-6" — note the missing
# space in one and not the other). Matching only the prefix survives that
# inconsistency and also self-adapts if a tab's wording differs slightly.
# Duplicated labels (week 1 vs week 2 columns) are matched in left-to-right
# order automatically.
HEADERS = {
    'id': 'Operators id',
    'name': 'Operators name',
    'company': 'Company',
    'shift': 'Work Shift',
    'lead': 'Team Lead',
    'bug_price': 'Operators Bug',
    'orders': 'orders',
    'oct': 'OCT(min)',
    'avg_score': 'average Score',
    'salary': 'salary',
}


import re

def normalize_name(s):
    """Deep-normalizes Persian/Arabic operator names for fallback matching
    when no id is available: strips ZWNJ/extra whitespace and unifies
    Arabic vs Persian character variants (ي/ی, ك/ک) plus ک/گ, which have
    caused false negatives in past name-matching work on this project."""
    if not s:
        return ''
    s = str(s).replace('\u200c', ' ')
    s = re.sub(r'\s+', ' ', s).strip()
    s = s.replace('ي', 'ی').replace('ك', 'ک').replace('گ', 'ک')
    return s.lower()


def num(v):
    if v in (None, '', '-'):
        return 0
    try:
        # sheet numbers can come with thousands-separator commas (e.g. salary: "485,840,000")
        return float(str(v).replace(',', '').strip())
    except ValueError:
        return 0


def fetch_csv_by_sheet_name(sheet_id, sheet_name):
    """Fetches one tab's data by its NAME (not gid) via the public gviz
    CSV export — works as long as the sheet is link-shared as Viewer."""
    encoded = urllib.parse.quote(sheet_name)
    url = f'https://docs.google.com/spreadsheets/d/{sheet_id}/gviz/tq?tqx=out:csv&sheet={encoded}'
    with urllib.request.urlopen(url, timeout=30) as resp:
        raw = resp.read().decode('utf-8-sig')
    return list(csv.reader(io.StringIO(raw)))


def build_column_index(header_row):
    idx = {}
    for field, label in HEADERS.items():
        label_norm = label.strip().lower()
        positions = [
            i for i, h in enumerate(header_row)
            if h.strip().lower().startswith(label_norm)
        ]
        idx[field] = positions
    return idx


def parse_tab(rows, category):
    header_row = rows[0]
    idx = build_column_index(header_row)
    data_rows = rows[1:]  # row 0 = header; data starts immediately (single header row)

    def cell(row, positions, which):
        pos = positions[which] if which < len(positions) else (positions[0] if positions else None)
        if pos is None or pos >= len(row):
            return None
        return row[pos]

    # However many week-blocks actually exist in the sheet right now (2, 3, ...).
    # This adapts automatically if a week is added or removed later.
    num_weeks = max(len(idx['orders']), len(idx['oct']), len(idx['avg_score']))

    operators = []
    for r in data_rows:
        name = cell(r, idx['name'], 0)
        if not name:
            continue
        op_id = cell(r, idx['id'], 0)
        weeks = []
        for w in range(num_weeks):
            weeks.append({
                'orders': num(cell(r, idx['orders'], w)),
                'oct': num(cell(r, idx['oct'], w)),
                'avg': num(cell(r, idx['avg_score'], w)),
            })
        total_orders = sum(wk['orders'] for wk in weeks)
        avg_score = round(sum(wk['avg'] for wk in weeks) / len(weeks), 2) if weeks else 0
        salary = num(cell(r, idx['salary'], 0))
        bug_price = num(cell(r, idx['bug_price'], 0))
        operators.append({
            'id': op_id,
            'name': name,
            'company': cell(r, idx['company'], 0),
            'shift': cell(r, idx['shift'], 0),
            'lead': cell(r, idx['lead'], 0),
            'weeks': weeks,
            'total_orders': total_orders,
            'avg_score': avg_score,
            'salary': salary,
            'bug_price': bug_price,
            'category': category,
        })
    return operators


BUGS_TAB_NAME = 'Operator Bugs'
BUGS_HEADERS = {
    'id': 'Operators id',
    'name': 'Operators name',
    'bug_count': 'Operators Bug (count)',
    'bug_price': 'Operators Bug Price',
}


def fetch_bugs(sheet_id):
    """Reads the 'Operator Bugs' tab and returns two lookup dicts keyed by
    id and by normalized name, so operators can be matched either way.
    Returns (by_id, by_name); both empty on any failure — bugs are treated
    as 0 rather than breaking the whole build."""
    try:
        rows = fetch_csv_by_sheet_name(sheet_id, BUGS_TAB_NAME)
    except Exception as e:
        print(f'warning: could not read "{BUGS_TAB_NAME}" tab ({e}) — bug counts will be 0')
        return {}, {}
    if not rows:
        return {}, {}

    header_row = rows[0]
    # The tab's header sometimes repeats itself in row 2 (frozen-row
    # duplication) — skip as many leading rows as match the header exactly.
    start = 1
    while start < len(rows) and rows[start][:len(header_row)] == header_row:
        start += 1
    data_rows = rows[start:]

    idx = {}
    for field, label in BUGS_HEADERS.items():
        label_norm = label.strip().lower()
        idx[field] = [i for i, h in enumerate(header_row) if h.strip().lower().startswith(label_norm)]

    def cell(row, field):
        positions = idx.get(field) or []
        pos = positions[0] if positions else None
        if pos is None or pos >= len(row):
            return None
        return row[pos]

    by_id, by_name = {}, {}
    for r in data_rows:
        name = cell(r, 'name')
        if not name:
            continue
        rec = {'bug_count': num(cell(r, 'bug_count')), 'bug_price': num(cell(r, 'bug_price'))}
        op_id = cell(r, 'id')
        if op_id:
            by_id[op_id] = rec
        by_name[normalize_name(name)] = rec
    return by_id, by_name


def apply_bugs(operators, bugs_by_id, bugs_by_name):
    for o in operators:
        rec = None
        if o.get('id'):
            rec = bugs_by_id.get(o['id'])
        if rec is None:
            rec = bugs_by_name.get(normalize_name(o.get('name')))
        o['bug_count'] = rec['bug_count'] if rec else 0
        o['bug_price'] = rec['bug_price'] if rec else 0


def agg(operators, key_field, keys):
    summary = []
    for key in keys:
        subset = [o for o in operators if o[key_field] == key]
        count = len(subset)
        total_orders = sum(o['total_orders'] for o in subset)
        avg_score = sum(o['avg_score'] for o in subset) / count if count else 0
        total_salary = sum(o['salary'] for o in subset)
        if key_field == 'lead':
            def op_avg_oct(o):
                wks = o.get('weeks') or []
                return sum(w['oct'] for w in wks) / len(wks) if wks else 0
            avg_oct = sum(op_avg_oct(o) for o in subset) / count if count else 0
            summary.append([key, count, total_orders, avg_oct, avg_score, total_salary])
        else:
            summary.append([key, count, total_orders, avg_score, total_salary])
    return summary


def update_history(history_path, operators):
    """Appends this week's average score per (category, team lead) to a
    running history file. Only one entry is kept per ISO week — reruns
    within the same week overwrite that week's numbers instead of
    duplicating them."""
    week_key = datetime.now(timezone.utc).strftime('%G-W%V')

    history = []
    if os.path.exists(history_path):
        try:
            with open(history_path, encoding='utf-8') as f:
                history = json.load(f)
        except (json.JSONDecodeError, OSError):
            history = []

    entry = next((h for h in history if h['week'] == week_key), None)
    if entry is None:
        entry = {'week': week_key, 'categories': {}}
        history.append(entry)

    cats = sorted(set(o['category'] for o in operators)) + ['all']
    for cat in cats:
        subset = operators if cat == 'all' else [o for o in operators if o['category'] == cat]
        leads = sorted(set(o['lead'] for o in subset if o['lead']))
        scores = entry['categories'].setdefault(cat, {})
        for row in agg(subset, 'lead', leads):
            scores[row[0]] = round(row[4], 2)

    history.sort(key=lambda h: h['week'])

    with open(history_path, 'w', encoding='utf-8') as f:
        json.dump(history, f, ensure_ascii=False)

    return history


def build(sheet_id, out_path, history_path):
    operators = []
    fetched = []
    for tab_name, category in CATEGORY_TABS:
        rows = fetch_csv_by_sheet_name(sheet_id, tab_name)
        tab_operators = parse_tab(rows, category)
        operators.extend(tab_operators)
        fetched.append(f'{tab_name} -> {category} ({len(tab_operators)} rows)')

    total_salary = sum(o['salary'] for o in operators)

    bugs_by_id, bugs_by_name = fetch_bugs(sheet_id)
    apply_bugs(operators, bugs_by_id, bugs_by_name)
    total_bug_count = sum(o['bug_count'] for o in operators)
    total_bug_price = sum(o['bug_price'] for o in operators)

    weekly_trend = update_history(history_path, operators)

    payload = {
        'generated_at': datetime.now(timezone.utc).isoformat(),
        'source': f'google_sheet:{sheet_id}:tabs={[t[0] for t in CATEGORY_TABS]}',
        'categories': [c for _, c in CATEGORY_TABS],
        'bugs': [
            ['غیرمالی (N.F.B)', 0],
            ['مالی (F.B)', 0],
            ['اثرگذار (E.B)', 0],
            ['مجموع کل', total_bug_count],
        ],
        'total_salary': total_salary,
        'total_bug_count': total_bug_count,
        'total_bug_price': total_bug_price,
        'weekly_trend': weekly_trend,
        'operators': operators,
    }

    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False)

    print(f'wrote {out_path}: ' + ', '.join(fetched) +
          f' | total {len(operators)} operators, total_salary={total_salary}, '
          f'total_bug_count={total_bug_count}, total_bug_price={total_bug_price}, '
          f'history now has {len(weekly_trend)} week(s))')


if __name__ == '__main__':
    sheet_id = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_SHEET_ID
    out_path = sys.argv[2] if len(sys.argv) > 2 else 'data/data.json'
    history_path = sys.argv[3] if len(sys.argv) > 3 else 'data/history.json'
    build(sheet_id, out_path, history_path)
