import type { ColumnFilters } from "./filtering";

/** Header row plus a row of per-column filter inputs. */
export function FilterableHead({ headers, filters }: { headers: string[]; filters: ColumnFilters }) {
  return (
    <thead>
      <tr>
        {headers.map((h) => (
          <th key={h}>{h}</th>
        ))}
      </tr>
      <tr className="filter-row">
        {headers.map((h, i) => (
          <th key={h}>
            <input
              type="search"
              value={filters.values[i]}
              onChange={(e) => filters.set(i, e.target.value)}
              placeholder="סינון"
              aria-label={`סינון לפי ${h}`}
            />
          </th>
        ))}
      </tr>
    </thead>
  );
}

export function ClearFilters({ filters }: { filters: ColumnFilters }) {
  if (!filters.active) return null;
  return (
    <button type="button" className="link-btn" onClick={filters.clear}>
      ניקוי סינון
    </button>
  );
}
