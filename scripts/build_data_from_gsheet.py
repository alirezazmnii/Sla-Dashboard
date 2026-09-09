"""
Regenerates data/data.json by reading live from a Google Sheet
(instead of the local xlsx file). Uses only the Python standard
library — no pip install needed, which keeps the GitHub Action fast
and dependency-free.

Requires the sheet's sharing setting to be "Anyone with the link -
Viewer" (no sign-in). It reads the CSV export of one tab.

Usage:
    python scripts/build_data_from_gsheet.py [sheet_id] [gid] [output_json]

Defaults:
    sheet_id    = the "Operators performance" workbook shared in chat
    gid         = 0  (the first/active tab — change if your data tab
                       isn't the first one; open the tab in the browser
                       and copy the number after #gid= in the URL)
    output_json = data/data.json
"""
import sys
import os
import csv
import io
import json
import urllib.request
from datetime import datetime, timezone

DEFAULT_SHEET_ID = '1E5OU--FCwpW4dBMxRj9MmuBsKzKzGx76FDZ9AvfRJF0'
DEFAULT_GID = '0'

# Header labels as they appear in row 1 of the "Operators performance" tab.
# Duplicated labels (week 1 vs week 2 columns) are matched in left-to-right
# order automatically.
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


def fetch_csv(sheet_id, gid):
    url = f'https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=csv&gid={gid}'
    with urllib.request.urlopen(url, timeout=30) as resp:
        raw = resp.read().decode('utf-8-sig')
    return list(csv.reader(io.StringIO(raw)))


def build_column_index(header_row):
    """Map each logical field to a column index, handling duplicate headers
    (orders_handled / OCT(min) / average Score each appear twice: week 1 then week 2)."""
    idx = {}
    for field, label in HEADERS.items():
        positions = [i for i, h in enumerate(header_row) if h.strip() == label]
        idx[field] = positions
    return idx


def update_history(history_path, team_lead_summary):
    """Appends this week's average score per team lead to a running
    history file, so a weekly trend can be charted over time. Only one
    entry is kept per ISO week — if this runs again in the same week,
    it overwrites that week's numbers instead of duplicating them."""
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
        entry = {'week': week_key, 'scores': {}}
        history.append(entry)

    for row in team_lead_summary:
        lead, avg_score = row[0], row[4]
        entry['scores'][lead] = round(avg_score, 2)

    history.sort(key=lambda h: h['week'])

    with open(history_path, 'w', encoding='utf-8') as f:
        json.dump(history, f, ensure_ascii=False)

    return history


def build(sheet_id, gid, out_path, history_path):
    rows = fetch_csv(sheet_id, gid)
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
        })

    team_leads = sorted(set(o['lead'] for o in operators if o['lead']))
    companies = sorted(set(o['company'] for o in operators if o['company']))

    def agg(key_field, keys):
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

    total_salary = sum(o['salary'] for o in operators)

    team_lead_summary = agg('lead', team_leads)
    weekly_trend = update_history(history_path, team_lead_summary)

    payload = {
        'generated_at': datetime.now(timezone.utc).isoformat(),
        'source': f'google_sheet:{sheet_id}:gid={gid}',
        'team_leads': team_lead_summary,
        'companies': agg('company', companies),
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

    print(f'wrote {out_path} ({len(operators)} operators, total_salary={total_salary}, '
          f'history now has {len(weekly_trend)} week(s))')


if __name__ == '__main__':
    sheet_id = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_SHEET_ID
    gid = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_GID
    out_path = sys.argv[3] if len(sys.argv) > 3 else 'data/data.json'
    history_path = sys.argv[4] if len(sys.argv) > 4 else 'data/history.json'
    build(sheet_id, gid, out_path, history_path)
