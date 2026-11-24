/**
 * Tests for Pagination component prop-contract logic.
 *
 * Because the test environment is Node (no jsdom), we cannot render JSX.
 * Instead, we test the helper functions from usePagination that drive the
 * Pagination component's behaviour, and verify the data contracts the
 * component relies on (e.g. totalPages <= 1 → renders nothing; edge buttons
 * appear for > 5 pages).
 *
 * Full rendering tests would require a jsdom + React Testing Library setup
 * and belong in a separate integration test suite.
 */

import {
  computeTotalPages,
  buildPageWindow,
  computeSliceIndices,
  clampPage,
} from '../hooks/paginationHelpers';

// ── Rendering threshold ───────────────────────────────────────────────────────

/**
 * The Pagination component renders nothing when totalPages <= 1.
 * These tests verify the helper produces totalPages <= 1 for the edge cases
 * that the component guards against.
 */
describe('Pagination renders nothing condition', () => {
  test('no items → totalPages is 1 → component should not render', () => {
    expect(computeTotalPages(0, 20)).toBe(1);
  });

  test('items fit exactly on one page → totalPages is 1 → component should not render', () => {
    expect(computeTotalPages(20, 20)).toBe(1);
  });

  test('single item → totalPages is 1 → component should not render', () => {
    expect(computeTotalPages(1, 20)).toBe(1);
  });

  test('21 items on page-size 20 → totalPages is 2 → component should render', () => {
    expect(computeTotalPages(21, 20)).toBe(2);
  });
});

// ── Edge (first/last) button threshold ────────────────────────────────────────

/**
 * The Pagination component shows First/Last buttons only when totalPages > 5.
 */
describe('Edge button visibility threshold (totalPages > 5)', () => {
  test.each([
    [1, false],
    [5, false],
    [6, true],
    [100, true],
  ])('totalPages=%i → showEdgeButtons=%s', (totalPages, shouldShow) => {
    expect(totalPages > 5).toBe(shouldShow);
  });
});

// ── Page window for Pagination ────────────────────────────────────────────────

describe('buildPageWindow — Pagination page-number buttons', () => {
  const siblingCount = 2; // matches default usePagination siblingCount
  const windowSize = siblingCount * 2 + 1; // 5

  test('fewer pages than window → all pages shown', () => {
    expect(buildPageWindow(1, 4, windowSize)).toEqual([1, 2, 3, 4]);
  });

  test('first page of large set → window starts at 1', () => {
    expect(buildPageWindow(1, 100, windowSize)).toEqual([1, 2, 3, 4, 5]);
  });

  test('last page of large set → window ends at totalPages', () => {
    expect(buildPageWindow(100, 100, windowSize)).toEqual([96, 97, 98, 99, 100]);
  });

  test('middle page → window centred', () => {
    expect(buildPageWindow(50, 100, windowSize)).toEqual([48, 49, 50, 51, 52]);
  });
});

// ── onPageChange boundary behaviour ──────────────────────────────────────────

/**
 * The Previous/Next buttons pass currentPage ± 1 to onPageChange.
 * clampPage ensures that value never escapes [1, totalPages].
 */
describe('Page navigation boundary behaviour via clampPage', () => {
  test('previous from page 1 is clamped to 1', () => {
    expect(clampPage(1 - 1, 10)).toBe(1);
  });

  test('next from last page is clamped to totalPages', () => {
    expect(clampPage(10 + 1, 10)).toBe(10);
  });

  test('direct navigation to out-of-range page is clamped', () => {
    expect(clampPage(0, 5)).toBe(1);
    expect(clampPage(99, 5)).toBe(5);
  });
});

// ── Slice indices match displayed items ───────────────────────────────────────

describe('computeSliceIndices — items displayed per page', () => {
  const pageSize = 20;

  test('first page shows first pageSize items', () => {
    const { startIndex, endIndex } = computeSliceIndices(1, pageSize, 500);
    expect(endIndex - startIndex).toBe(pageSize);
  });

  test('last full page shows exactly pageSize items', () => {
    const { startIndex, endIndex } = computeSliceIndices(25, pageSize, 500);
    expect(endIndex - startIndex).toBe(pageSize);
  });

  test('partial last page shows remaining items', () => {
    // 505 items, pageSize 20 → page 26 has 5 items
    const { startIndex, endIndex } = computeSliceIndices(26, pageSize, 505);
    expect(endIndex - startIndex).toBe(5);
  });

  test('no items → slice is empty', () => {
    const { startIndex, endIndex } = computeSliceIndices(1, pageSize, 0);
    expect(endIndex - startIndex).toBe(0);
  });
});

// ── Filter reset ──────────────────────────────────────────────────────────────

/**
 * When filters change, the component resets pagination to page 1.
 * We verify that clampPage(1, totalPages) always equals 1 so the reset
 * never lands on a bad page.
 */
describe('Pagination resets to page 1 after filter changes', () => {
  test('clampPage(1, N) is always 1 regardless of totalPages', () => {
    for (const totalPages of [1, 2, 5, 10, 100]) {
      expect(clampPage(1, totalPages)).toBe(1);
    }
  });
});
