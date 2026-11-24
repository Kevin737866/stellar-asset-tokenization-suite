'use client';

import React from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface PaginationProps {
  /** Currently active page (1-indexed). */
  currentPage: number;
  /** Total number of pages. */
  totalPages: number;
  /** Total number of items in the data set (after filtering). */
  totalItems: number;
  /** Whether the previous-page button should be disabled. */
  hasPreviousPage: boolean;
  /** Whether the next-page button should be disabled. */
  hasNextPage: boolean;
  /** Ordered page numbers to render as individual buttons. */
  pageWindow: number[];
  /** Called with the target page number when any navigation action fires. */
  onPageChange: (page: number) => void;
  /** Called when the user clicks "first page". */
  onFirstPage: () => void;
  /** Called when the user clicks "last page". */
  onLastPage: () => void;
  /** Label used in the aria-label for the nav landmark. */
  label?: string;
}

// ── Component ──────────────────────────────────────────────────────────────────

/**
 * Pagination controls for any long list.
 *
 * Renders a "Page X of Y (N results)" summary on the left and a row of
 * navigation buttons on the right. First/last buttons are shown only when
 * there are more than 5 pages so the control does not become too wide on
 * small result sets.
 *
 * All interactive elements carry descriptive aria-labels so screen readers
 * can announce the destination before the user activates a button.
 *
 * Usage:
 * ```tsx
 * const pagination = usePagination({ totalItems: items.length, pageSize: 20 });
 * const page = items.slice(pagination.startIndex, pagination.endIndex);
 *
 * return (
 *   <>
 *     <ItemList items={page} />
 *     <Pagination
 *       currentPage={pagination.currentPage}
 *       totalPages={pagination.totalPages}
 *       totalItems={items.length}
 *       hasPreviousPage={pagination.hasPreviousPage}
 *       hasNextPage={pagination.hasNextPage}
 *       pageWindow={pagination.pageWindow}
 *       onPageChange={pagination.goToPage}
 *       onFirstPage={pagination.goToFirstPage}
 *       onLastPage={pagination.goToLastPage}
 *     />
 *   </>
 * );
 * ```
 */
export default function Pagination({
  currentPage,
  totalPages,
  totalItems,
  hasPreviousPage,
  hasNextPage,
  pageWindow,
  onPageChange,
  onFirstPage,
  onLastPage,
  label = 'Pagination',
}: PaginationProps) {
  if (totalPages <= 1) return null;

  const showEdgeButtons = totalPages > 5;

  return (
    <nav
      className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-4 border-t"
      aria-label={label}
    >
      {/* Result summary */}
      <p className="text-sm text-gray-500 dark:text-gray-400 order-2 sm:order-1">
        Page{' '}
        <span className="font-medium text-gray-700 dark:text-gray-200">{currentPage}</span>
        {' '}of{' '}
        <span className="font-medium text-gray-700 dark:text-gray-200">{totalPages}</span>
        <span className="hidden sm:inline">
          {' '}({totalItems.toLocaleString()} result{totalItems !== 1 ? 's' : ''})
        </span>
      </p>

      {/* Navigation buttons */}
      <div className="flex items-center gap-1 order-1 sm:order-2" role="group" aria-label="Page navigation">
        {/* First page */}
        {showEdgeButtons && (
          <Button
            variant="outline"
            size="sm"
            onClick={onFirstPage}
            disabled={!hasPreviousPage}
            aria-label="Go to first page"
            className="hidden sm:flex"
          >
            <ChevronsLeft className="h-4 w-4" aria-hidden="true" />
          </Button>
        )}

        {/* Previous page */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={!hasPreviousPage}
          aria-label="Go to previous page"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline ml-1">Previous</span>
        </Button>

        {/* Page number window */}
        <div className="flex gap-1" role="list" aria-label="Page numbers">
          {pageWindow.map((pageNum) => (
            <Button
              key={pageNum}
              role="listitem"
              variant={pageNum === currentPage ? 'default' : 'outline'}
              size="sm"
              onClick={() => onPageChange(pageNum)}
              aria-label={`Page ${pageNum}`}
              aria-current={pageNum === currentPage ? 'page' : undefined}
              className="w-9 h-9 font-mono"
            >
              {pageNum}
            </Button>
          ))}
        </div>

        {/* Next page */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={!hasNextPage}
          aria-label="Go to next page"
        >
          <span className="hidden sm:inline mr-1">Next</span>
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Button>

        {/* Last page */}
        {showEdgeButtons && (
          <Button
            variant="outline"
            size="sm"
            onClick={onLastPage}
            disabled={!hasNextPage}
            aria-label="Go to last page"
            className="hidden sm:flex"
          >
            <ChevronsRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        )}
      </div>
    </nav>
  );
}
