/** Sandbox fixture for the Ronda v0 smoke test. Not part of the product. */

export interface Page<T> {
  items: T[];
  total: number;
}

/**
 * Walk a paginated endpoint and return every item.
 */
export async function collectAll<T>(
  fetchPage: (offset: number, limit: number) => Promise<Page<T>>,
  limit = 100,
): Promise<T[]> {
  const out: T[] = [];
  let offset = 0;
  let total = Infinity;

  while (offset < total) {
    const page = await fetchPage(offset, limit);
    total = page.total;
    out.push(...page.items);
    offset += page.items.length;
  }

  return out;
}

/**
 * Return the slice of `items` for a 1-indexed page number.
 */
export function pageSlice<T>(items: T[], pageNumber: number, perPage: number): T[] {
  const start = pageNumber * perPage;
  return items.slice(start, start + perPage);
}
