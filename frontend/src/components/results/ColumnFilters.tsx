import type { ColumnFilters } from "./filtering";
import type { ColumnSort } from "./sorting";

/** Header row of sort buttons, plus a row of per-column filter inputs. */
export function FilterableHead({ headers, filters, sort }: { headers: string[]; filters: ColumnFilters; sort: ColumnSort }) {
  const dirOf = (column: number) => (sort.column === column ? sort.dir : null);
  return (
    <thead>
      <tr>
        {headers.map((h, i) => (
          <th key={h} aria-sort={dirOf(i) === "asc" ? "ascending" : dirOf(i) === "desc" ? "descending" : "none"}>
            <button type="button" className="sort-btn" onClick={() => sort.toggle(i)}>
              {h}
              <span className={`sort-mark ${dirOf(i) ? "is-active" : ""}`} aria-hidden="true">
                {dirOf(i) === "asc" ? "▲" : dirOf(i) === "desc" ? "▼" : "↕"}
              </span>
            </button>
          </th>
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

export function ClearSort({ sort }: { sort: ColumnSort }) {
  if (sort.column == null) return null;
  return (
    <button type="button" className="link-btn" onClick={sort.clear}>
      איפוס מיון
    </button>
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
