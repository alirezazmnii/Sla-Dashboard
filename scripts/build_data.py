"""
Regenerates data/data.json from the SLA Excel workbook.

Usage:
    python scripts/build_data.py [path-to-xlsx] [path-to-output-json]

Defaults:
    input  = Operators_Sla_Performance.xlsx  (repo root)
    output = data/data.json

Run this on any workbook that follows the same layout (same sheet
names / column order) as the original file — e.g. next month's export,
or a different team's copy. If your sheet/column names differ, adjust
the constants right below this docstring; the rest of the script does
not need to change.
"""
import sys
import json
from datetime import datetime, timezone
import openpyxl

# ---- Adjust these if your workbook's structure differs ----
SHEET_PERF = 'Operators performance'
SHEET_BUGS = 'Operator Bugs'
PERF_HEADER_ROW = 3          # first data row in "Operators performance"
BUG_HEADER_ROW = 2           # first data row in "Operator Bugs"
BUG_COLS = {'nfb': 'M', 'fb': 'N', 'eb': 'O', 'total': 'P'}
# -------------------------------------------------------------

def col_to_idx(letter):
    return openpyxl.utils.column_index_from_string(letter) - 1


def num(v):
    """Coerce a cell value to a number; non-numeric placeholders (e.g. '-') become 0."""
    if isinstance(v, (int, float)):
        return v
    return 0


def build(xlsx_path, out_path):
    wb = openpyxl.load_workbook(xlsx_path, data_only=True)

    perf = wb[SHEET_PERF]
    rows = [r for r in perf.iter_rows(min_row=PERF_HEADER_ROW, values_only=True) if r[0] is not None]

    operators = []
    for r in rows:
        name, _, company, shift, lead, _bugprice, ord1, oct1, _iss1, _octsc1, avg1, \
            ord2, oct2, _iss2, _octsc2, avg2, salary = r[:17]
        operators.append({
            'name': name, 'company': company, 'shift': shift, 'lead': lead,
            'orders1': num(ord1), 'oct1': num(oct1), 'avg1': num(avg1),
            'orders2': num(ord2), 'oct2': num(oct2), 'avg2': num(avg2),
            'total_orders': num(ord1) + num(ord2),
            'avg_score': round((num(avg1) + num(avg2)) / 2, 2),
            'salary': num(salary),
        })

    team_leads = sorted(set(o['lead'] for o in operators if o['lead']))
    companies = sorted(set(o['company'] for o in operators if o['company']))

    def agg(rows_subset, key_field):
        summary = []
        for key in (team_leads if key_field == 'lead' else companies):
            subset = [o for o in operators if o[key_field] == key]
            count = len(subset)
            total_orders = sum(o['total_orders'] for o in subset)
            avg_score = sum(o['avg_score'] for o in subset) / count if count else 0
            if key_field == 'lead':
                avg_oct = sum(((o['oct1'] or 0) + (o['oct2'] or 0)) / 2 for o in subset) / count if count else 0
                summary.append([key, count, total_orders, avg_oct, avg_score])
            else:
                summary.append([key, count, total_orders, avg_score])
        return summary

    team_lead_summary = agg(operators, 'lead')
    company_summary = agg(operators, 'company')

    bugs_ws = wb[SHEET_BUGS]
    bug_rows = list(bugs_ws.iter_rows(min_row=BUG_HEADER_ROW, values_only=True))

    def bug_sum(col_letter):
        idx = col_to_idx(col_letter)
        return sum((r[idx] or 0) for r in bug_rows if r[0] is not None)

    bugs = [
        ['غیرمالی (N.F.B)', bug_sum(BUG_COLS['nfb'])],
        ['مالی (F.B)', bug_sum(BUG_COLS['fb'])],
        ['اثرگذار (E.B)', bug_sum(BUG_COLS['eb'])],
        ['مجموع کل', bug_sum(BUG_COLS['total'])],
    ]

    payload = {
        'generated_at': datetime.now(timezone.utc).isoformat(),
        'source_file': xlsx_path,
        'team_leads': team_lead_summary,
        'companies': company_summary,
        'bugs': bugs,
        'total_salary': sum(o['salary'] for o in operators),
        'operators': operators,
    }

    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False)

    print(f'wrote {out_path} ({len(operators)} operators, {len(team_leads)} team leads, {len(companies)} companies)')


if __name__ == '__main__':
    xlsx_path = sys.argv[1] if len(sys.argv) > 1 else 'Operators_Sla_Performance.xlsx'
    out_path = sys.argv[2] if len(sys.argv) > 2 else 'data/data.json'
    build(xlsx_path, out_path)
