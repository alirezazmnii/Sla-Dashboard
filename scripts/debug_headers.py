"""
Diagnostic tool — does NOT write data.json. It only fetches the two tabs
(freelancer, Center Issue) and prints, for each one:
  1. the raw header row (row 1) exactly as Google Sheets returns it,
     wrapped in repr() so invisible/extra spaces are visible
  2. what build_data_from_gsheet.py's HEADERS dict is currently looking for
  3. which column index(es) it found for each field — empty list = "not found"

Run it locally:
    python3 scripts/debug_headers.py

Or paste its output back into the chat and we'll fix whatever it shows.
"""
import csv
import io
import urllib.request
import urllib.parse

SHEET_ID = '1E5OU--FCwpW4dBMxRj9MmuBsKzKzGx76FDZ9AvfRJF0'
CATEGORY_TABS = ['freelancer', 'Center Issue']

# Keep this in sync with build_data_from_gsheet.py's HEADERS dict.
# These are matched as case-insensitive PREFIXES, not exact equality —
# the real headers append the week text with inconsistent spacing
# (e.g. "orders 1stweek-6" vs "orders 2nd week-6").
HEADERS = {
    'name': 'Operator',
    'company': 'Company',
    'shift': 'Work Shift',
    'lead': 'Team Lead',
    'bug_price': 'Operators',
    'orders': 'orders',
    'oct': 'OCT(min)',
    'avg_score': 'average Score',
    'salary': 'salary',
}


def fetch_csv_by_sheet_name(sheet_id, sheet_name):
    encoded = urllib.parse.quote(sheet_name)
    url = f'https://docs.google.com/spreadsheets/d/{sheet_id}/gviz/tq?tqx=out:csv&sheet={encoded}'
    with urllib.request.urlopen(url, timeout=30) as resp:
        raw = resp.read().decode('utf-8-sig')
    return list(csv.reader(io.StringIO(raw)))


def main():
    for tab_name in CATEGORY_TABS:
        print('=' * 70)
        print(f'TAB: {tab_name!r}')
        try:
            rows = fetch_csv_by_sheet_name(SHEET_ID, tab_name)
        except Exception as e:
            print(f'  !! could not fetch this tab: {e}')
            print('  -> check the tab name is spelled EXACTLY like this in Google Sheets')
            continue

        if not rows:
            print('  !! tab came back empty')
            continue

        header_row = rows[0]
        print(f'  Row 1 has {len(header_row)} columns. Raw values:')
        for i, h in enumerate(header_row):
            if h.strip():
                print(f'    [{i}] {h!r}')

        print()
        print('  Matching against HEADERS dict (prefix match, case-insensitive):')
        any_missing = False
        for field, label in HEADERS.items():
            label_norm = label.strip().lower()
            positions = [i for i, h in enumerate(header_row) if h.strip().lower().startswith(label_norm)]
            status = positions if positions else 'NOT FOUND'
            if not positions:
                any_missing = True
            print(f'    {field:<10} looking for {label!r:<25} -> {status}')

        if any_missing:
            print('\n  ⚠ at least one field above is NOT FOUND — that field will read as 0/empty for every operator in this tab.')
        else:
            print('\n  ✓ all fields matched.')
        print()


if __name__ == '__main__':
    main()
