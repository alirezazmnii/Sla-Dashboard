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

# Header labels as they appear in row 1 of each tab. Duplicated labels
# (week 1 vs week 2 columns) are matched in left-to-right order automatically.
HEADERS = {
    'name': 'Operator',
    'company': 'Company',
    'shift': 'Work Shift',
    'lead': 'Team Lead',
    'bug_price': 'Operators Bug Price',
    'orders': 'orders_handled',
    'oct': 'OCT(min)',
    'avg_score': 'average Score',
    'salary': 'salary',
}


def num(v):
    try:
        return float(v) if v not in (None, '', '-') else 0
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
        positions = [i for i, h in enumerate(header_row) if h.strip() == label]
        idx[field] = positions
    return idx


def parse_tab(rows, category):
    header_row = rows[0]
    idx = build_column_index(header_row)
    data_rows = rows[2:]  # row 0 = headers, row 1 = "1st week-6"/"2nd week-6" sub-header

    def cell(row, positions, which):
        pos = positions[which] if which < len(positions) else (positions[0] if positions else None)
        if pos is None or pos >= len(row):
            return None
        return row[pos]

    operators = []
    for r in data_rows:
        name = cell(r, idx['name'], 0)
        if not name:
            continue
        orders1 = num(cell(r, idx['orders'], 0))
        orders2 = num(cell(r, idx['orders'], 1))
        oct1 = num(cell(r, idx['oct'], 0))
        oct2 = num(cell(r, idx['oct'], 1))
        avg1 = num(cell(r, idx['avg_score'], 0))
        avg2 = num(cell(r, idx['avg_score'], 1))
        salary = num(cell(r, idx['salary'], 0))
        bug_price = num(cell(r, idx['bug_price'], 0))
        operators.append({
            'name': name,
            'company': cell(r, idx['company'], 0),
            'shift': cell(r, idx['shift'], 0),
            'lead': cell(r, idx['lead'], 0),
            'orders1': orders1, 'oct1': oct1, 'avg1': avg1,
            'orders2': orders2, 'oct2': oct2, 'avg2': avg2,
            'total_orders': orders1 + orders2,
            'avg_score': round((avg1 + avg2) / 2, 2),
            'salary': salary,
            'bug_price': bug_price,
            'category': category,
        })
    return operators


def agg(operators, key_field, keys):
    summary = []
    for key in keys:
        subset = [o for o in operators if o[key_field] == key]
        count = len(subset)
        total_orders = sum(o['total_orders'] for o in subset)
        avg_score = sum(o['avg_score'] for o in subset) / count if count else 0
        if key_field == 'lead':
            avg_oct = sum((o['oct1'] + o['oct2']) / 2 for o in subset) / count if count else 0
            summary.append([key, count, total_orders, avg_oct, avg_score])
        else:
            summary.append([key, count, total_orders, avg_score])
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
    weekly_trend = update_history(history_path, operators)

    payload = {
        'generated_at': datetime.now(timezone.utc).isoformat(),
        'source': f'google_sheet:{sheet_id}:tabs={[t[0] for t in CATEGORY_TABS]}',
        'categories': [c for _, c in CATEGORY_TABS],
        'bugs': [
            ['غیرمالی (N.F.B)', 0],
            ['مالی (F.B)', 0],
            ['اثرگذار (E.B)', 0],
            ['مجموع کل', 0],
        ],
        'total_salary': total_salary,
        'weekly_trend': weekly_trend,
        'operators': operators,
    }

    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False)

    print(f'wrote {out_path}: ' + ', '.join(fetched) +
          f' | total {len(operators)} operators, total_salary={total_salary}, '
          f'history now has {len(weekly_trend)} week(s))')


if __name__ == '__main__':
    sheet_id = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_SHEET_ID
    out_path = sys.argv[2] if len(sys.argv) > 2 else 'data/data.json'
    history_path = sys.argv[3] if len(sys.argv) > 3 else 'data/history.json'
    build(sheet_id, out_path, history_path)
