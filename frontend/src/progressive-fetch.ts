/**
 * fetchPaged — progressive pagination helper.
 *
 * Heavy list endpoints (/bookings/all, /surgeries, /prescriptions) now
 * support `limit` + `skip`. On mobile networks downloading the whole
 * history in one response is what made screens feel frozen: nothing
 * paints until the last byte arrives. This helper fetches page-by-page
 * and invokes `onPage` after EVERY page, so the screen renders the
 * first 200 rows almost immediately while the rest streams in behind.
 */
import api from './api';

export async function fetchPaged<T = any>(
  path: string,
  opts: {
    pageSize?: number;
    max?: number;
    params?: Record<string, any>;
    onPage?: (rows: T[], done: boolean) => void;
  } = {},
): Promise<T[]> {
  const pageSize = opts.pageSize ?? 200;
  const max = opts.max ?? 5000;
  let all: T[] = [];
  let skip = 0;
  for (;;) {
    const { data } = await api.get(path, {
      params: { ...(opts.params || {}), limit: pageSize, skip },
    });
    const rows: T[] = Array.isArray(data) ? data : [];
    all = all.concat(rows);
    const done = rows.length < pageSize || all.length >= max;
    opts.onPage?.(all, done);
    if (done) break;
    skip += pageSize;
  }
  return all;
}
