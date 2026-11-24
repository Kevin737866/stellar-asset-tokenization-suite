/**
 * usePagination — reusable pagination state hook.
 *
 * Wraps the pure helpers from paginationHelpers.ts in React state so any
 * list component can add pagination without duplicating the logic.
 */

import { useState, useCallback, useMemo } from 'react';
import {
  computeTotalPages,
  clampPage,
  buildPageWindow,
  computeSliceIndices,
} from './paginationHelpers';

// Re-export the helpers so consumers can import from a single location.
export {
  computeTotalPages,
  clampPage,
  buildPageWindow,
  computeSliceIndices,
} from './paginationHelpers';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface PaginationOptions {
  /** Total number of items in the filtered/sorted list. */
  totalItems: number;
  /** Maximum items to display per page. Must be ≥ 1. */
  pageSize: number;
  /**
   * Half the size of the sliding page-number window (default 2).
   * The full window is `siblingCount * 2 + 1` pages wide.
   */
  siblingCount?: number;
}

export interface PaginationResult {
  /** Currently active page (1-indexed). */
  currentPage: number;
  /** Total number of pages, always ≥ 1. */
  totalPages: number;
  /** 0-indexed position of the first item on the current page. */
  startIndex: number;
  /** 0-indexed position one past the last item on the current page (use with Array#slice). */
  endIndex: number;
  /** Whether the previous-page action is available. */
  hasPreviousPage: boolean;
  /** Whether the next-page action is available. */
  hasNextPage: boolean;
  /** Navigate to a specific page. No-ops for out-of-range values. */
  goToPage: (page: number) => void;
  /** Navigate to the next page. No-ops when already on the last page. */
  goToNextPage: () => void;
  /** Navigate to the previous page. No-ops when already on the first page. */
  goToPreviousPage: () => void;
  /** Navigate to the first page. */
  goToFirstPage: () => void;
  /** Navigate to the last page. */
  goToLastPage: () => void;
  /**
   * Reset to page 1. Call this whenever the filtered item set changes so the
   * user does not land on a now-empty page.
   */
  reset: () => void;
  /**
   * Ordered array of page numbers to render as page-number buttons.
   * Uses a sliding window of `siblingCount * 2 + 1` pages centred on
   * `currentPage`, clamped to [1, totalPages].
   */
  pageWindow: number[];
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function usePagination({
  totalItems,
  pageSize,
  siblingCount = 2,
}: PaginationOptions): PaginationResult {
  if (pageSize < 1) throw new RangeError('pageSize must be ≥ 1');

  const [currentPage, setCurrentPage] = useState<number>(1);

  const totalPages = useMemo(
    () => computeTotalPages(totalItems, pageSize),
    [totalItems, pageSize],
  );

  // Whenever totalPages shrinks (e.g. after a filter removes items), push the
  // current page back into range without requiring the caller to do it.
  const safePage = useMemo(
    () => clampPage(currentPage, totalPages),
    [currentPage, totalPages],
  );

  const { startIndex, endIndex } = useMemo(
    () => computeSliceIndices(safePage, pageSize, totalItems),
    [safePage, pageSize, totalItems],
  );

  const pageWindow = useMemo(
    () => buildPageWindow(safePage, totalPages, siblingCount * 2 + 1),
    [safePage, totalPages, siblingCount],
  );

  const goToPage = useCallback(
    (page: number) => setCurrentPage(clampPage(page, totalPages)),
    [totalPages],
  );

  const goToNextPage = useCallback(() => goToPage(safePage + 1), [goToPage, safePage]);
  const goToPreviousPage = useCallback(() => goToPage(safePage - 1), [goToPage, safePage]);
  const goToFirstPage = useCallback(() => goToPage(1), [goToPage]);
  const goToLastPage = useCallback(() => goToPage(totalPages), [goToPage, totalPages]);
  const reset = useCallback(() => setCurrentPage(1), []);

  return {
    currentPage: safePage,
    totalPages,
    startIndex,
    endIndex,
    hasPreviousPage: safePage > 1,
    hasNextPage: safePage < totalPages,
    goToPage,
    goToNextPage,
    goToPreviousPage,
    goToFirstPage,
    goToLastPage,
    reset,
    pageWindow,
  };
}
