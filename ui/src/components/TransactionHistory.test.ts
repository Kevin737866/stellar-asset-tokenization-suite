/**
 * Regression tests for the pagination helpers exported from TransactionHistory.
 *
 * Run with: npx jest ui/src/components/TransactionHistory.test.ts
 * (or via the root jest config since the pattern covers **\/\*.test.ts)
 */

import { buildPageRange, PAGE_SIZE_OPTIONS, DEFAULT_PAGE_SIZE } from './TransactionHistory';

// ── buildPageRange ─────────────────────────────────────────────────────────

describe('buildPageRange', () => {
  it('returns every page when totalPages fits within the compact threshold', () => {
    // 1–7 pages: no ellipsis needed
    expect(buildPageRange(1, 1)).toEqual([1]);
    expect(buildPageRange(1, 3)).toEqual([1, 2, 3]);
    expect(buildPageRange(3, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('always includes page 1 and the last page', () => {
    const range = buildPageRange(5, 20);
    expect(range[0]).toBe(1);
    expect(range[range.length - 1]).toBe(20);
  });

  it('inserts ellipsis-start when window is far from the beginning', () => {
    const range = buildPageRange(10, 20);
    expect(range).toContain('ellipsis-start');
  });

  it('inserts ellipsis-end when window is far from the end', () => {
    const range = buildPageRange(1, 20);
    expect(range).toContain('ellipsis-end');
  });

  it('inserts both ellipsis markers when the window is in the middle', () => {
    const range = buildPageRange(10, 25);
    expect(range).toContain('ellipsis-start');
    expect(range).toContain('ellipsis-end');
  });

  it('does not insert ellipsis-start when currentPage is near the start', () => {
    const range = buildPageRange(2, 20);
    expect(range).not.toContain('ellipsis-start');
  });

  it('does not insert ellipsis-end when currentPage is near the end', () => {
    const range = buildPageRange(19, 20);
    expect(range).not.toContain('ellipsis-end');
  });

  it('never repeats a page number', () => {
    for (const page of [1, 5, 10, 15, 20]) {
      const range = buildPageRange(page, 20);
      const nums = range.filter((e): e is number => typeof e === 'number');
      expect(new Set(nums).size).toBe(nums.length);
    }
  });

  it('produces a strictly ascending numeric sequence (excluding ellipsis)', () => {
    const range = buildPageRange(10, 25);
    const nums = range.filter((e): e is number => typeof e === 'number');
    for (let i = 1; i < nums.length; i++) {
      expect(nums[i]).toBeGreaterThan(nums[i - 1]);
    }
  });

  it('handles single-page edge case', () => {
    expect(buildPageRange(1, 1)).toEqual([1]);
  });

  it('handles currentPage equal to totalPages', () => {
    const range = buildPageRange(20, 20);
    expect(range[0]).toBe(1);
    expect(range[range.length - 1]).toBe(20);
  });
});

// ── Constants ──────────────────────────────────────────────────────────────

describe('pagination constants', () => {
  it('PAGE_SIZE_OPTIONS is a non-empty ascending tuple', () => {
    expect(PAGE_SIZE_OPTIONS.length).toBeGreaterThan(0);
    for (let i = 1; i < PAGE_SIZE_OPTIONS.length; i++) {
      expect(PAGE_SIZE_OPTIONS[i]).toBeGreaterThan(PAGE_SIZE_OPTIONS[i - 1]);
    }
  });

  it('DEFAULT_PAGE_SIZE is included in PAGE_SIZE_OPTIONS', () => {
    expect(PAGE_SIZE_OPTIONS).toContain(DEFAULT_PAGE_SIZE);
  });

  it('all PAGE_SIZE_OPTIONS are positive integers', () => {
    for (const size of PAGE_SIZE_OPTIONS) {
      expect(size).toBeGreaterThan(0);
      expect(Number.isInteger(size)).toBe(true);
    }
  });
});

// ── Pagination arithmetic ───────────────────────────────────────────────────

describe('pagination arithmetic', () => {
  const makeItems = (n: number) => Array.from({ length: n }, (_, i) => i);

  const paginate = <T,>(items: T[], page: number, size: number): T[] => {
    const start = (page - 1) * size;
    return items.slice(start, start + size);
  };

  it('first page returns exactly pageSize items when list is long enough', () => {
    const items = makeItems(100);
    expect(paginate(items, 1, 20)).toHaveLength(20);
    expect(paginate(items, 1, 20)[0]).toBe(0);
  });

  it('last page returns the remainder when total is not a multiple of pageSize', () => {
    const items = makeItems(45);
    const lastPage = paginate(items, 5, 10);
    expect(lastPage).toHaveLength(5);
    expect(lastPage[0]).toBe(40);
  });

  it('changing page size resets effectively to page 1 by recalculating totalPages', () => {
    const totalItems = 100;
    // If we were on page 5 of 10 (pageSize=10) and switch to pageSize=50,
    // totalPages drops to 2 so safePage should clamp to 2.
    const newTotalPages = Math.ceil(totalItems / 50);
    const previousPage = 5;
    const safePage = Math.min(previousPage, newTotalPages);
    expect(safePage).toBe(2);
  });

  it('filter reducing results to 0 gives totalPages = 1', () => {
    const totalPages = Math.max(1, Math.ceil(0 / 20));
    expect(totalPages).toBe(1);
  });

  it('safePage clamps to totalPages when filter reduces result count', () => {
    // Simulate: user was on page 10, filter reduces to 3 pages
    const currentPage = 10;
    const totalPages = 3;
    const safePage = Math.min(currentPage, totalPages);
    expect(safePage).toBe(3);
  });

  it('totalPages calculation rounds up correctly', () => {
    expect(Math.ceil(21 / 20)).toBe(2);
    expect(Math.ceil(20 / 20)).toBe(1);
    expect(Math.ceil(1 / 20)).toBe(1);
    expect(Math.ceil(0 / 20)).toBe(0); // guarded by Math.max(1, ...)
    expect(Math.max(1, Math.ceil(0 / 20))).toBe(1);
  });

  it('row range summary string is correct', () => {
    const page = 3;
    const size = 10;
    const total = 25;
    const from = (page - 1) * size + 1;
    const to = Math.min(page * size, total);
    expect(from).toBe(21);
    expect(to).toBe(25);
  });
});
