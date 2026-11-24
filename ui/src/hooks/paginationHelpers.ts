/**
 * Pure, framework-agnostic pagination helper functions.
 *
 * These functions contain no React dependency and can be imported and tested
 * in a plain Node.js environment without a React runtime or jsdom.
 *
 * The `usePagination` hook in usePagination.ts uses these internally.
 */

/**
 * Compute the total number of pages.
 * Always returns at least 1 so the UI never has to handle a 0-page state.
 */
export function computeTotalPages(totalItems: number, pageSize: number): number {
  if (pageSize < 1) throw new RangeError('pageSize must be ≥ 1');
  if (totalItems < 0) throw new RangeError('totalItems must be ≥ 0');
  return Math.max(1, Math.ceil(totalItems / pageSize));
}

/**
 * Clamp a candidate page number to [1, totalPages].
 */
export function clampPage(page: number, totalPages: number): number {
  return Math.max(1, Math.min(page, totalPages));
}

/**
 * Build the sliding window of page numbers shown around `currentPage`.
 *
 * Example — totalPages=10, currentPage=6, windowSize=5:
 *   returns [4, 5, 6, 7, 8]
 */
export function buildPageWindow(
  currentPage: number,
  totalPages: number,
  windowSize: number,
): number[] {
  const half = Math.floor(windowSize / 2);
  let start = currentPage - half;
  let end = currentPage + half;

  // Shift the window into range if it overflows at either end.
  if (start < 1) {
    end += 1 - start;
    start = 1;
  }
  if (end > totalPages) {
    start -= end - totalPages;
    end = totalPages;
  }

  // Final clamp — start could still go below 1 when totalPages < windowSize.
  start = Math.max(1, start);

  const pages: number[] = [];
  for (let p = start; p <= end; p++) {
    pages.push(p);
  }
  return pages;
}

/**
 * Compute the slice indices for the current page.
 * Both indices are 0-based; `endIndex` is exclusive (suitable for Array#slice).
 */
export function computeSliceIndices(
  currentPage: number,
  pageSize: number,
  totalItems: number,
): { startIndex: number; endIndex: number } {
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalItems);
  return { startIndex, endIndex };
}
