/**
 * Tests for the pure pagination helper functions exported from usePagination.
 *
 * These run in the Node environment (no DOM, no React runtime) so they execute
 * fast and have no dependency on jsdom.  The React hook itself is not exercised
 * here because the test environment is not set up for React rendering; the
 * unit tests below cover all branching logic that the hook delegates to these
 * helpers.
 */

import {
  computeTotalPages,
  clampPage,
  buildPageWindow,
  computeSliceIndices,
} from './paginationHelpers';

// ── computeTotalPages ──────────────────────────────────────────────────────────

describe('computeTotalPages', () => {
  test('returns 1 when there are no items', () => {
    expect(computeTotalPages(0, 20)).toBe(1);
  });

  test('returns 1 when items fit exactly in one page', () => {
    expect(computeTotalPages(20, 20)).toBe(1);
  });

  test('rounds up when items do not divide evenly', () => {
    expect(computeTotalPages(21, 20)).toBe(2);
    expect(computeTotalPages(100, 20)).toBe(5);
    expect(computeTotalPages(101, 20)).toBe(6);
    expect(computeTotalPages(1, 20)).toBe(1);
  });

  test('works with a page size of 1', () => {
    expect(computeTotalPages(5, 1)).toBe(5);
  });

  test('throws for a page size < 1', () => {
    expect(() => computeTotalPages(10, 0)).toThrow(RangeError);
    expect(() => computeTotalPages(10, -1)).toThrow(RangeError);
  });

  test('throws for negative totalItems', () => {
    expect(() => computeTotalPages(-1, 20)).toThrow(RangeError);
  });
});

// ── clampPage ─────────────────────────────────────────────────────────────────

describe('clampPage', () => {
  test('returns the page unchanged when it is in range', () => {
    expect(clampPage(3, 10)).toBe(3);
  });

  test('clamps to 1 when the candidate is below 1', () => {
    expect(clampPage(0, 10)).toBe(1);
    expect(clampPage(-5, 10)).toBe(1);
  });

  test('clamps to totalPages when the candidate exceeds totalPages', () => {
    expect(clampPage(11, 10)).toBe(10);
    expect(clampPage(999, 5)).toBe(5);
  });

  test('handles the boundary value totalPages', () => {
    expect(clampPage(5, 5)).toBe(5);
  });

  test('handles single-page sets', () => {
    expect(clampPage(1, 1)).toBe(1);
    expect(clampPage(2, 1)).toBe(1);
  });
});

// ── buildPageWindow ───────────────────────────────────────────────────────────

describe('buildPageWindow', () => {
  test('returns all pages when totalPages ≤ windowSize', () => {
    expect(buildPageWindow(1, 3, 5)).toEqual([1, 2, 3]);
    expect(buildPageWindow(2, 5, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  test('centres the window on the current page', () => {
    // 10 total, window=5 → half=2; page 6 → [4,5,6,7,8]
    expect(buildPageWindow(6, 10, 5)).toEqual([4, 5, 6, 7, 8]);
  });

  test('shifts the window right when current page is near the start', () => {
    // page 1, window=5 → [1,2,3,4,5]
    expect(buildPageWindow(1, 10, 5)).toEqual([1, 2, 3, 4, 5]);
    // page 2, window=5 → [1,2,3,4,5]
    expect(buildPageWindow(2, 10, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  test('shifts the window left when current page is near the end', () => {
    // page 10, window=5 → [6,7,8,9,10]
    expect(buildPageWindow(10, 10, 5)).toEqual([6, 7, 8, 9, 10]);
    // page 9, window=5 → [6,7,8,9,10]
    expect(buildPageWindow(9, 10, 5)).toEqual([6, 7, 8, 9, 10]);
  });

  test('returns a window of exactly windowSize pages for large sets', () => {
    const window = buildPageWindow(50, 100, 5);
    expect(window).toHaveLength(5);
    expect(window).toEqual([48, 49, 50, 51, 52]);
  });

  test('returns a single-element window when windowSize is 1', () => {
    expect(buildPageWindow(5, 10, 1)).toEqual([5]);
  });

  test('never returns pages below 1 or above totalPages', () => {
    const window = buildPageWindow(1, 2, 7);
    expect(window.every((p) => p >= 1 && p <= 2)).toBe(true);
  });

  test('returns [1] for a single-page set', () => {
    expect(buildPageWindow(1, 1, 5)).toEqual([1]);
  });
});

// ── computeSliceIndices ───────────────────────────────────────────────────────

describe('computeSliceIndices', () => {
  test('page 1 starts at index 0', () => {
    const { startIndex, endIndex } = computeSliceIndices(1, 20, 100);
    expect(startIndex).toBe(0);
    expect(endIndex).toBe(20);
  });

  test('page 2 starts at index pageSize', () => {
    const { startIndex, endIndex } = computeSliceIndices(2, 20, 100);
    expect(startIndex).toBe(20);
    expect(endIndex).toBe(40);
  });

  test('last page endIndex does not exceed totalItems', () => {
    // 100 items, pageSize 20 → last page is page 5
    const { startIndex, endIndex } = computeSliceIndices(5, 20, 100);
    expect(startIndex).toBe(80);
    expect(endIndex).toBe(100);
  });

  test('partial last page clips endIndex to totalItems', () => {
    // 101 items, pageSize 20 → page 6 has 1 item
    const { startIndex, endIndex } = computeSliceIndices(6, 20, 101);
    expect(startIndex).toBe(100);
    expect(endIndex).toBe(101);
  });

  test('single-page result', () => {
    const { startIndex, endIndex } = computeSliceIndices(1, 20, 5);
    expect(startIndex).toBe(0);
    expect(endIndex).toBe(5);
  });

  test('empty list produces startIndex and endIndex of 0', () => {
    const { startIndex, endIndex } = computeSliceIndices(1, 20, 0);
    expect(startIndex).toBe(0);
    expect(endIndex).toBe(0);
  });
});
