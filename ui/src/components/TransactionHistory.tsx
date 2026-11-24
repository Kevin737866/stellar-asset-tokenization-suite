'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ArrowUpDown,
  ExternalLink,
  Calendar,
  Search,
  Filter,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Loader2,
  Inbox,
} from 'lucide-react';

// Transaction Types
export type TransactionStatus = 'completed' | 'pending' | 'failed' | 'cancelled' | 'processing';
export type TransactionType = 'transfer' | 'mint' | 'burn' | 'trade' | 'dividend' | 'lock' | 'unlock' | 'stake' | 'unstake' | 'all';

export interface Transaction {
  id: string;
  type: Exclude<TransactionType, 'all'>;
  token: string;
  tokenSymbol: string;
  amount: string;
  counterparty: string;
  counterpartyLabel?: string;
  date: Date;
  status: TransactionStatus;
  txHash: string;
  price?: string;
  fee?: string;
}

/** Allowed page-size options surfaced in the rows-per-page selector. */
export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];

export const DEFAULT_PAGE_SIZE: PageSize = 20;

/** Maximum number of numbered page buttons shown before ellipsis collapses them. */
const MAX_PAGE_BUTTONS = 5;

interface TransactionHistoryProps {
  transactions: Transaction[];
  onOpenExplorer?: (txHash: string) => void;
  isLoading?: boolean;
  /**
   * Initial number of rows shown per page.
   * Accepts any value from PAGE_SIZE_OPTIONS; defaults to DEFAULT_PAGE_SIZE.
   */
  defaultPageSize?: PageSize;
}

const STATUS_STYLES: Record<TransactionStatus, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon: React.FC<{ className?: string }> }> = {
  completed: { variant: 'default', icon: CheckCircle2 },
  pending: { variant: 'secondary', icon: Clock },
  failed: { variant: 'destructive', icon: XCircle },
  cancelled: { variant: 'outline', icon: XCircle },
  processing: { variant: 'secondary', icon: Loader2 },
};

const TYPE_LABELS: Record<Exclude<TransactionType, 'all'>, string> = {
  transfer: 'Transfer',
  mint: 'Mint',
  burn: 'Burn',
  trade: 'Trade',
  dividend: 'Dividend',
  lock: 'Lock',
  unlock: 'Unlock',
  stake: 'Stake',
  unstake: 'Unstake',
};

// ── Pagination helpers ───────────────────────────────────────────────────────

/**
 * Build the array of page numbers (and 'ellipsis' sentinels) to render as
 * numbered buttons in the pagination bar.
 *
 * Rules:
 * - Always show first and last page.
 * - Show up to MAX_PAGE_BUTTONS consecutive pages centred around currentPage.
 * - Insert an '...' sentinel wherever a gap exists between shown pages.
 */
export function buildPageRange(currentPage: number, totalPages: number): Array<number | 'ellipsis-start' | 'ellipsis-end'> {
  if (totalPages <= MAX_PAGE_BUTTONS + 2) {
    // Enough room to show every page without ellipsis
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }

  const half = Math.floor(MAX_PAGE_BUTTONS / 2);
  let rangeStart = Math.max(2, currentPage - half);
  let rangeEnd = Math.min(totalPages - 1, currentPage + half);

  // Clamp so the window always has MAX_PAGE_BUTTONS entries
  if (rangeEnd - rangeStart + 1 < MAX_PAGE_BUTTONS) {
    if (currentPage - 1 < totalPages - currentPage) {
      rangeEnd = Math.min(totalPages - 1, rangeStart + MAX_PAGE_BUTTONS - 1);
    } else {
      rangeStart = Math.max(2, rangeEnd - MAX_PAGE_BUTTONS + 1);
    }
  }

  const pages: Array<number | 'ellipsis-start' | 'ellipsis-end'> = [1];

  if (rangeStart > 2) {
    pages.push('ellipsis-start');
  }

  for (let p = rangeStart; p <= rangeEnd; p++) {
    pages.push(p);
  }

  if (rangeEnd < totalPages - 1) {
    pages.push('ellipsis-end');
  }

  pages.push(totalPages);
  return pages;
}

// ── Component ────────────────────────────────────────────────────────────────

export default function TransactionHistory({
  transactions,
  onOpenExplorer,
  isLoading = false,
  defaultPageSize = DEFAULT_PAGE_SIZE,
}: TransactionHistoryProps) {
  // Filter state
  const [filterType, setFilterType] = useState<TransactionType>('all');
  const [filterToken, setFilterToken] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [dateRange, setDateRange] = useState<{ start: string; end: string }>({ start: '', end: '' });
  const [searchQuery, setSearchQuery] = useState('');

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(defaultPageSize);
  const [jumpValue, setJumpValue] = useState('');

  // Sort state
  const [sortField, setSortField] = useState<'date' | 'amount' | 'type' | 'status'>('date');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  // ── Derived data ───────────────────────────────────────────────────────────

  const uniqueTokens = useMemo(() => {
    const tokenSet = new Map<string, string>();
    transactions.forEach((tx) => {
      tokenSet.set(tx.token, tx.tokenSymbol || tx.token);
    });
    return Array.from(tokenSet.entries());
  }, [transactions]);

  const filteredTransactions = useMemo(() => {
    return transactions.filter((tx) => {
      if (filterType !== 'all' && tx.type !== filterType) return false;
      if (filterToken !== 'all' && tx.token !== filterToken) return false;
      if (filterStatus !== 'all' && tx.status !== filterStatus) return false;

      if (dateRange.start) {
        const txDate = new Date(tx.date);
        const startDate = new Date(dateRange.start);
        if (txDate < startDate) return false;
      }
      if (dateRange.end) {
        const txDate = new Date(tx.date);
        const endDate = new Date(dateRange.end);
        endDate.setHours(23, 59, 59, 999);
        if (txDate > endDate) return false;
      }

      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchesSearch =
          tx.txHash.toLowerCase().includes(query) ||
          tx.tokenSymbol.toLowerCase().includes(query) ||
          tx.counterpartyLabel?.toLowerCase().includes(query) ||
          tx.counterparty.toLowerCase().includes(query) ||
          tx.amount.toLowerCase().includes(query);
        if (!matchesSearch) return false;
      }

      return true;
    });
  }, [transactions, filterType, filterToken, filterStatus, dateRange, searchQuery]);

  const sortedTransactions = useMemo(() => {
    const sorted = [...filteredTransactions];
    sorted.sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case 'date':
          comparison = new Date(a.date).getTime() - new Date(b.date).getTime();
          break;
        case 'amount':
          comparison = parseFloat(a.amount) - parseFloat(b.amount);
          break;
        case 'type':
          comparison = a.type.localeCompare(b.type);
          break;
        case 'status':
          comparison = a.status.localeCompare(b.status);
          break;
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });
    return sorted;
  }, [filteredTransactions, sortField, sortDirection]);

  const totalPages = Math.max(1, Math.ceil(sortedTransactions.length / pageSize));

  // Clamp currentPage whenever totalPages shrinks (e.g. after filtering)
  const safePage = Math.min(currentPage, totalPages);

  const paginatedTransactions = useMemo(() => {
    const startIndex = (safePage - 1) * pageSize;
    return sortedTransactions.slice(startIndex, startIndex + pageSize);
  }, [sortedTransactions, safePage, pageSize]);

  const pageRange = useMemo(
    () => buildPageRange(safePage, totalPages),
    [safePage, totalPages],
  );

  // ── Handlers ───────────────────────────────────────────────────────────────

  /** Reset to page 1 whenever a filter changes so users never land on a blank page. */
  const handleFilterChange = useCallback(<T,>(setter: React.Dispatch<React.SetStateAction<T>>, value: T) => {
    setter(value);
    setCurrentPage(1);
  }, []);

  const handleSort = useCallback((field: typeof sortField) => {
    if (sortField === field) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
    setCurrentPage(1);
  }, [sortField]);

  const handlePageSizeChange = useCallback((value: string) => {
    const newSize = parseInt(value, 10) as PageSize;
    setPageSize(newSize);
    setCurrentPage(1);
    setJumpValue('');
  }, []);

  /** Navigate to a specific page. Clamps to valid range silently. */
  const goToPage = useCallback(
    (page: number) => {
      const clamped = Math.max(1, Math.min(page, totalPages));
      setCurrentPage(clamped);
      setJumpValue('');
    },
    [totalPages],
  );

  const handleJumpSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const parsed = parseInt(jumpValue, 10);
      if (!isNaN(parsed)) {
        goToPage(parsed);
      }
    },
    [jumpValue, goToPage],
  );

  // ── Formatters ─────────────────────────────────────────────────────────────

  const formatDate = (date: Date) => {
    const d = new Date(date);
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // ── Loading skeleton ───────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-10 bg-gray-200 dark:bg-gray-700 animate-pulse rounded-lg" />
          ))}
        </div>
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 bg-gray-100 dark:bg-gray-800 animate-pulse rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Filters Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            value={searchQuery}
            onChange={(e) => handleFilterChange(setSearchQuery, e.target.value)}
            placeholder="Search by hash, token, address..."
            className="pl-9"
          />
        </div>

        {/* Type Filter */}
        <Select value={filterType} onValueChange={(v) => handleFilterChange(setFilterType, v as TransactionType)}>
          <SelectTrigger>
            <Filter className="h-4 w-4 mr-2" />
            <SelectValue placeholder="All Types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {Object.entries(TYPE_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Token Filter */}
        <Select value={filterToken} onValueChange={(v) => handleFilterChange(setFilterToken, v)}>
          <SelectTrigger>
            <SelectValue placeholder="All Tokens" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Tokens</SelectItem>
            {uniqueTokens.map(([address, symbol]) => (
              <SelectItem key={address} value={address}>
                {symbol}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Status Filter */}
        <Select value={filterStatus} onValueChange={(v) => handleFilterChange(setFilterStatus, v)}>
          <SelectTrigger>
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="processing">Processing</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Date Range Picker Row */}
      <div className="flex flex-wrap items-center gap-3">
        <Calendar className="h-4 w-4 text-gray-400" />
        <Input
          type="date"
          value={dateRange.start}
          onChange={(e) => setDateRange((prev) => ({ ...prev, start: e.target.value }))}
          className="w-auto"
          aria-label="Start date"
        />
        <span className="text-gray-400 text-sm">to</span>
        <Input
          type="date"
          value={dateRange.end}
          onChange={(e) => setDateRange((prev) => ({ ...prev, end: e.target.value }))}
          className="w-auto"
          aria-label="End date"
        />
        {(dateRange.start || dateRange.end) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setDateRange({ start: '', end: '' });
              setCurrentPage(1);
            }}
          >
            Clear
          </Button>
        )}
      </div>

      {/* Results Summary */}
      <div className="text-sm text-gray-500">
        {filteredTransactions.length} transaction{filteredTransactions.length !== 1 ? 's' : ''}
        {filteredTransactions.length !== transactions.length && ` (filtered from ${transactions.length})`}
      </div>

      {/* Empty State */}
      {sortedTransactions.length === 0 && !isLoading && (
        <div className="flex flex-col items-center justify-center py-16 text-gray-400 dark:text-gray-500">
          <Inbox className="h-16 w-16 mb-4 text-gray-300 dark:text-gray-600" />
          <p className="text-lg font-medium text-gray-500 dark:text-gray-400">No transactions found</p>
          <p className="text-sm mt-1">
            {transactions.length === 0
              ? 'Your transaction history will appear here once you start transacting.'
              : 'Try adjusting your filters to see more results.'}
          </p>
        </div>
      )}

      {/* Desktop Table */}
      {sortedTransactions.length > 0 && (
        <>
          <div className="hidden md:block overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800 border-b dark:border-gray-700">
                <tr>
                  <th
                    className="px-4 py-3 text-left font-semibold text-gray-600 cursor-pointer hover:text-gray-900"
                    onClick={() => handleSort('type')}
                  >
                    <div className="flex items-center gap-1">
                      Type <ArrowUpDown className="h-3 w-3" />
                    </div>
                  </th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">Token</th>
                  <th
                    className="px-4 py-3 text-right font-semibold text-gray-600 cursor-pointer hover:text-gray-900"
                    onClick={() => handleSort('amount')}
                  >
                    <div className="flex items-center justify-end gap-1">
                      Amount <ArrowUpDown className="h-3 w-3" />
                    </div>
                  </th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">Counterparty</th>
                  <th
                    className="px-4 py-3 text-left font-semibold text-gray-600 cursor-pointer hover:text-gray-900"
                    onClick={() => handleSort('date')}
                  >
                    <div className="flex items-center gap-1">
                      Date <ArrowUpDown className="h-3 w-3" />
                    </div>
                  </th>
                  <th
                    className="px-4 py-3 text-center font-semibold text-gray-600 cursor-pointer hover:text-gray-900"
                    onClick={() => handleSort('status')}
                  >
                    <div className="flex items-center justify-center gap-1">
                      Status <ArrowUpDown className="h-3 w-3" />
                    </div>
                  </th>
                  <th className="px-4 py-3 text-right font-semibold text-gray-600">Tx Hash</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {paginatedTransactions.map((tx) => {
                  const StatusIcon = STATUS_STYLES[tx.status].icon;
                  return (
                    <tr key={tx.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3">
                        <Badge variant="outline">{TYPE_LABELS[tx.type]}</Badge>
                      </td>
                      <td className="px-4 py-3 font-medium">{tx.tokenSymbol}</td>
                      <td className="px-4 py-3 text-right font-mono text-sm">
                        {parseFloat(tx.amount).toLocaleString(undefined, { maximumFractionDigits: 6 })}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">
                        {tx.counterpartyLabel || `${tx.counterparty.slice(0, 6)}...${tx.counterparty.slice(-4)}`}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">{formatDate(tx.date)}</td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <StatusIcon className={`h-3.5 w-3.5 ${tx.status === 'processing' ? 'animate-spin' : ''}`} />
                          <span className="text-xs capitalize">{tx.status}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => onOpenExplorer?.(tx.txHash)}
                          className="text-blue-600 hover:text-blue-800 font-mono text-xs flex items-center justify-end gap-1 hover:underline"
                          title="View on Stellar Explorer"
                        >
                          {tx.txHash.slice(0, 8)}...{tx.txHash.slice(-6)}
                          <ExternalLink className="h-3 w-3" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile Cards */}
          <div className="md:hidden space-y-3">
            {paginatedTransactions.map((tx) => {
              const StatusIcon = STATUS_STYLES[tx.status].icon;
              return (
                <div key={tx.id} className="border rounded-lg p-4 space-y-2 bg-white shadow-sm">
                  <div className="flex justify-between items-start">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{TYPE_LABELS[tx.type]}</Badge>
                      <div className="flex items-center gap-1 text-xs">
                        <StatusIcon className={`h-3 w-3 ${tx.status === 'processing' ? 'animate-spin' : ''}`} />
                        <span className="capitalize">{tx.status}</span>
                      </div>
                    </div>
                    <span className="font-mono text-sm font-semibold">
                      {parseFloat(tx.amount).toLocaleString(undefined, { maximumFractionDigits: 6 })}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm text-gray-600">
                    <span>{tx.tokenSymbol}</span>
                    <span>{tx.counterpartyLabel || `${tx.counterparty.slice(0, 4)}...${tx.counterparty.slice(-4)}`}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-gray-400 dark:text-gray-500">{formatDate(tx.date)}</span>
                    <button
                      onClick={() => onOpenExplorer?.(tx.txHash)}
                      className="text-xs text-blue-600 hover:underline flex items-center gap-1"
                    >
                      {tx.txHash.slice(0, 6)}...{tx.txHash.slice(-4)}
                      <ExternalLink className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* ── Pagination Controls ─────────────────────────────────────────────── */}
      {sortedTransactions.length > 0 && (
        <div
          className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 border-t"
          role="navigation"
          aria-label="Transaction history pagination"
        >
          {/* Left: summary + rows-per-page */}
          <div className="flex items-center gap-3 text-sm text-gray-500 dark:text-gray-400">
            <span>
              {sortedTransactions.length === 0
                ? 'No results'
                : `${(safePage - 1) * pageSize + 1}–${Math.min(safePage * pageSize, sortedTransactions.length)} of ${sortedTransactions.length}`}
            </span>
            <label className="flex items-center gap-1.5">
              <span className="whitespace-nowrap">Rows per page</span>
              <Select value={String(pageSize)} onValueChange={handlePageSizeChange}>
                <SelectTrigger className="h-8 w-20 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAGE_SIZE_OPTIONS.map((opt) => (
                    <SelectItem key={opt} value={String(opt)}>
                      {opt}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          </div>

          {/* Centre: page number buttons */}
          {totalPages > 1 && (
            <div className="flex items-center gap-1" role="group" aria-label="Page navigation">
              {/* First page */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => goToPage(1)}
                disabled={safePage === 1}
                aria-label="First page"
                title="First page"
                className="w-8 h-8 p-0"
              >
                <ChevronsLeft className="h-4 w-4" />
              </Button>

              {/* Previous page */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => goToPage(safePage - 1)}
                disabled={safePage === 1}
                aria-label="Previous page"
                title="Previous page"
                className="w-8 h-8 p-0"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>

              {/* Numbered pages with ellipsis */}
              {pageRange.map((entry, idx) => {
                if (entry === 'ellipsis-start' || entry === 'ellipsis-end') {
                  return (
                    <span
                      key={entry}
                      className="w-8 h-8 flex items-center justify-center text-gray-400 text-sm select-none"
                      aria-hidden="true"
                    >
                      …
                    </span>
                  );
                }
                return (
                  <Button
                    key={`page-${entry}`}
                    variant={entry === safePage ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => goToPage(entry)}
                    aria-label={`Page ${entry}`}
                    aria-current={entry === safePage ? 'page' : undefined}
                    className="w-8 h-8 p-0 text-xs"
                  >
                    {entry}
                  </Button>
                );
              })}

              {/* Next page */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => goToPage(safePage + 1)}
                disabled={safePage === totalPages}
                aria-label="Next page"
                title="Next page"
                className="w-8 h-8 p-0"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>

              {/* Last page */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => goToPage(totalPages)}
                disabled={safePage === totalPages}
                aria-label="Last page"
                title="Last page"
                className="w-8 h-8 p-0"
              >
                <ChevronsRight className="h-4 w-4" />
              </Button>
            </div>
          )}

          {/* Right: jump-to-page */}
          {totalPages > 1 && (
            <form onSubmit={handleJumpSubmit} className="flex items-center gap-2">
              <label htmlFor="jump-to-page" className="text-sm text-gray-500 dark:text-gray-400 whitespace-nowrap">
                Go to
              </label>
              <Input
                id="jump-to-page"
                type="number"
                min={1}
                max={totalPages}
                value={jumpValue}
                onChange={(e) => setJumpValue(e.target.value)}
                className="h-8 w-16 text-xs text-center"
                placeholder={String(safePage)}
                aria-label={`Jump to page (1–${totalPages})`}
              />
              <Button type="submit" variant="outline" size="sm" className="h-8 text-xs px-3">
                Go
              </Button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
