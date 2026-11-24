'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import {
  ArrowUpDown,
  ExternalLink,
  Calendar,
  Search,
  Filter,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  Inbox,
} from 'lucide-react';
import { usePagination } from '@/hooks/usePagination';
import Pagination from '@/components/Pagination';

// ── Transaction Types ─────────────────────────────────────────────────────────

export type TransactionStatus = 'completed' | 'pending' | 'failed' | 'cancelled' | 'processing';
export type TransactionType =
  | 'transfer'
  | 'mint'
  | 'burn'
  | 'trade'
  | 'dividend'
  | 'lock'
  | 'unlock'
  | 'stake'
  | 'unstake'
  | 'all';

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

// ── Pagination exports (used by tests and parent components) ──────────────────

/** Allowed page-size options surfaced in the rows-per-page selector. */
export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];
export const DEFAULT_PAGE_SIZE: PageSize = 20;

/** Maximum consecutive numbered buttons shown before ellipsis collapses them. */
const MAX_PAGE_BUTTONS = 5;

/**
 * Build the array of page numbers (and ellipsis sentinels) to render as
 * numbered buttons in the pagination bar.
 *
 * Rules:
 * - Always includes page 1 and the last page.
 * - Shows up to MAX_PAGE_BUTTONS consecutive pages centred around currentPage.
 * - Inserts an ellipsis sentinel wherever a gap exists between shown pages.
 */
export function buildPageRange(
  currentPage: number,
  totalPages: number,
): Array<number | 'ellipsis-start' | 'ellipsis-end'> {
  if (totalPages <= MAX_PAGE_BUTTONS + 2) {
    // Enough room to show every page without any ellipsis.
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }

  const half = Math.floor(MAX_PAGE_BUTTONS / 2);
  let rangeStart = Math.max(2, currentPage - half);
  let rangeEnd = Math.min(totalPages - 1, currentPage + half);

  // Clamp so the window always has exactly MAX_PAGE_BUTTONS entries.
  if (rangeEnd - rangeStart + 1 < MAX_PAGE_BUTTONS) {
    if (currentPage - 1 < totalPages - currentPage) {
      rangeEnd = Math.min(totalPages - 1, rangeStart + MAX_PAGE_BUTTONS - 1);
    } else {
      rangeStart = Math.max(2, rangeEnd - MAX_PAGE_BUTTONS + 1);
    }
  }

  const pages: Array<number | 'ellipsis-start' | 'ellipsis-end'> = [1];
  if (rangeStart > 2) pages.push('ellipsis-start');
  for (let p = rangeStart; p <= rangeEnd; p++) pages.push(p);
  if (rangeEnd < totalPages - 1) pages.push('ellipsis-end');
  pages.push(totalPages);
  return pages;
}

// ── Props ─────────────────────────────────────────────────────────────────────

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

// ── Style maps ────────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<
  TransactionStatus,
  { variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon: React.FC<{ className?: string }> }
> = {
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

// ── Component ─────────────────────────────────────────────────────────────────

export default function TransactionHistory({
  transactions,
  onOpenExplorer,
  isLoading = false,
  defaultPageSize = DEFAULT_PAGE_SIZE,
}: TransactionHistoryProps) {
  // ── Filter state ────────────────────────────────────────────────────────────
  const [filterType, setFilterType] = useState<TransactionType>('all');
  const [filterToken, setFilterToken] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [dateRange, setDateRange] = useState<{ start: string; end: string }>({ start: '', end: '' });
  const [searchQuery, setSearchQuery] = useState('');

  // ── Sort state ──────────────────────────────────────────────────────────────
  const [sortField, setSortField] = useState<'date' | 'amount' | 'type' | 'status'>('date');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  // ── Page-size state (rows-per-page selector) ────────────────────────────────
  const [pageSize, setPageSize] = useState<PageSize>(defaultPageSize);

  // ── Derived: unique tokens for the token filter dropdown ───────────────────
  const uniqueTokens = useMemo(() => {
    const tokenSet = new Map<string, string>();
    transactions.forEach((tx) => {
      tokenSet.set(tx.token, tx.tokenSymbol || tx.token);
    });
    return Array.from(tokenSet.entries());
  }, [transactions]);

  // ── Derived: filtered transactions ─────────────────────────────────────────
  const filteredTransactions = useMemo(() => {
    return transactions.filter((tx) => {
      if (filterType !== 'all' && tx.type !== filterType) return false;
      if (filterToken !== 'all' && tx.token !== filterToken) return false;
      if (filterStatus !== 'all' && tx.status !== filterStatus) return false;

      if (dateRange.start) {
        const startDate = new Date(dateRange.start);
        if (new Date(tx.date) < startDate) return false;
      }
      if (dateRange.end) {
        const endDate = new Date(dateRange.end);
        endDate.setHours(23, 59, 59, 999);
        if (new Date(tx.date) > endDate) return false;
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const hit =
          tx.txHash.toLowerCase().includes(q) ||
          tx.tokenSymbol.toLowerCase().includes(q) ||
          (tx.counterpartyLabel?.toLowerCase().includes(q) ?? false) ||
          tx.counterparty.toLowerCase().includes(q) ||
          tx.amount.toLowerCase().includes(q);
        if (!hit) return false;
      }

      return true;
    });
  }, [transactions, filterType, filterToken, filterStatus, dateRange, searchQuery]);

  // ── Derived: sorted transactions ────────────────────────────────────────────
  const sortedTransactions = useMemo(() => {
    const sorted = [...filteredTransactions];
    sorted.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'date':
          cmp = new Date(a.date).getTime() - new Date(b.date).getTime();
          break;
        case 'amount':
          cmp = parseFloat(a.amount) - parseFloat(b.amount);
          break;
        case 'type':
          cmp = a.type.localeCompare(b.type);
          break;
        case 'status':
          cmp = a.status.localeCompare(b.status);
          break;
      }
      return sortDirection === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [filteredTransactions, sortField, sortDirection]);

  // ── Pagination hook ─────────────────────────────────────────────────────────
  const pagination = usePagination({
    totalItems: sortedTransactions.length,
    pageSize,
  });

  const paginatedTransactions = useMemo(
    () => sortedTransactions.slice(pagination.startIndex, pagination.endIndex),
    [sortedTransactions, pagination.startIndex, pagination.endIndex],
  );

  // ── Handlers ────────────────────────────────────────────────────────────────

  const resetAndCall = useCallback(
    (fn: () => void) => {
      fn();
      pagination.reset();
    },
    [pagination],
  );

  const handleSort = useCallback(
    (field: typeof sortField) => {
      if (sortField === field) {
        setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortField(field);
        setSortDirection('desc');
      }
      pagination.reset();
    },
    [sortField, pagination],
  );

  const handlePageSizeChange = useCallback(
    (value: string) => {
      setPageSize(Number(value) as PageSize);
      pagination.reset();
    },
    [pagination],
  );

  const formatDate = (date: Date) =>
    new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

  // Row-range summary ("Showing 21–40 of 95")
  const fromRow = sortedTransactions.length === 0 ? 0 : pagination.startIndex + 1;
  const toRow = pagination.endIndex;

  // ── Loading skeleton ─────────────────────────────────────────────────────────
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

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Filters Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <Input
            value={searchQuery}
            onChange={(e) => resetAndCall(() => setSearchQuery(e.target.value))}
            placeholder="Search by hash, token, address…"
            className="pl-9"
          />
        </div>

        {/* Type Filter */}
        <Select
          value={filterType}
          onValueChange={(v) => resetAndCall(() => setFilterType(v as TransactionType))}
        >
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
        <Select
          value={filterToken}
          onValueChange={(v) => resetAndCall(() => setFilterToken(v))}
        >
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
        <Select
          value={filterStatus}
          onValueChange={(v) => resetAndCall(() => setFilterStatus(v))}
        >
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

      {/* Date Range Picker */}
      <div className="flex flex-wrap items-center gap-3">
        <Calendar className="h-4 w-4 text-gray-400" aria-hidden="true" />
        <Input
          type="date"
          value={dateRange.start}
          onChange={(e) => {
            setDateRange((prev) => ({ ...prev, start: e.target.value }));
            pagination.reset();
          }}
          className="w-auto"
          aria-label="Filter start date"
        />
        <span className="text-gray-400 text-sm" aria-hidden="true">to</span>
        <Input
          type="date"
          value={dateRange.end}
          onChange={(e) => {
            setDateRange((prev) => ({ ...prev, end: e.target.value }));
            pagination.reset();
          }}
          className="w-auto"
          aria-label="Filter end date"
        />
        {(dateRange.start || dateRange.end) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setDateRange({ start: '', end: '' });
              pagination.reset();
            }}
          >
            Clear dates
          </Button>
        )}
      </div>

      {/* Results Summary + Rows-per-page selector */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {sortedTransactions.length > 0
            ? `Showing ${fromRow}–${toRow} of ${sortedTransactions.length} transaction${sortedTransactions.length !== 1 ? 's' : ''}`
            : `${filteredTransactions.length} transaction${filteredTransactions.length !== 1 ? 's' : ''}`}
          {filteredTransactions.length !== transactions.length &&
            ` (filtered from ${transactions.length})`}
        </p>
        <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
          <span>Rows per page</span>
          <Select value={String(pageSize)} onValueChange={handlePageSizeChange}>
            <SelectTrigger className="w-20 h-8">
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
        </div>
      </div>

      {/* Empty State */}
      {sortedTransactions.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-gray-400 dark:text-gray-500">
          <Inbox className="h-16 w-16 mb-4 text-gray-300 dark:text-gray-600" aria-hidden="true" />
          <p className="text-lg font-medium text-gray-500 dark:text-gray-400">No transactions found</p>
          <p className="text-sm mt-1">
            {transactions.length === 0
              ? 'Your transaction history will appear here once you start transacting.'
              : 'Try adjusting your filters to see more results.'}
          </p>
        </div>
      )}

      {/* Transaction list */}
      {sortedTransactions.length > 0 && (
        <>
          {/* Desktop Table */}
          <div className="hidden md:block overflow-x-auto rounded-lg border">
            <table className="w-full text-sm" aria-label="Transaction history">
              <thead className="bg-gray-50 dark:bg-gray-800 border-b dark:border-gray-700">
                <tr>
                  <th
                    className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-300 cursor-pointer hover:text-gray-900 dark:hover:text-gray-100 select-none"
                    onClick={() => handleSort('type')}
                    aria-sort={sortField === 'type' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
                  >
                    <div className="flex items-center gap-1">
                      Type <ArrowUpDown className="h-3 w-3" aria-hidden="true" />
                    </div>
                  </th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-300">Token</th>
                  <th
                    className="px-4 py-3 text-right font-semibold text-gray-600 dark:text-gray-300 cursor-pointer hover:text-gray-900 dark:hover:text-gray-100 select-none"
                    onClick={() => handleSort('amount')}
                    aria-sort={sortField === 'amount' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
                  >
                    <div className="flex items-center justify-end gap-1">
                      Amount <ArrowUpDown className="h-3 w-3" aria-hidden="true" />
                    </div>
                  </th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-300">Counterparty</th>
                  <th
                    className="px-4 py-3 text-left font-semibold text-gray-600 dark:text-gray-300 cursor-pointer hover:text-gray-900 dark:hover:text-gray-100 select-none"
                    onClick={() => handleSort('date')}
                    aria-sort={sortField === 'date' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
                  >
                    <div className="flex items-center gap-1">
                      Date <ArrowUpDown className="h-3 w-3" aria-hidden="true" />
                    </div>
                  </th>
                  <th
                    className="px-4 py-3 text-center font-semibold text-gray-600 dark:text-gray-300 cursor-pointer hover:text-gray-900 dark:hover:text-gray-100 select-none"
                    onClick={() => handleSort('status')}
                    aria-sort={sortField === 'status' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
                  >
                    <div className="flex items-center justify-center gap-1">
                      Status <ArrowUpDown className="h-3 w-3" aria-hidden="true" />
                    </div>
                  </th>
                  <th className="px-4 py-3 text-right font-semibold text-gray-600 dark:text-gray-300">Tx Hash</th>
                </tr>
              </thead>
              <tbody className="divide-y dark:divide-gray-700">
                {paginatedTransactions.map((tx) => {
                  const StatusIcon = STATUS_STYLES[tx.status].icon;
                  return (
                    <tr key={tx.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                      <td className="px-4 py-3">
                        <Badge variant="outline">{TYPE_LABELS[tx.type]}</Badge>
                      </td>
                      <td className="px-4 py-3 font-medium dark:text-gray-200">{tx.tokenSymbol}</td>
                      <td className="px-4 py-3 text-right font-mono text-sm dark:text-gray-200">
                        {parseFloat(tx.amount).toLocaleString(undefined, { maximumFractionDigits: 6 })}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">
                        {tx.counterpartyLabel ||
                          `${tx.counterparty.slice(0, 6)}…${tx.counterparty.slice(-4)}`}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                        {formatDate(tx.date)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <StatusIcon
                            className={`h-3.5 w-3.5 ${tx.status === 'processing' ? 'animate-spin' : ''}`}
                            aria-hidden="true"
                          />
                          <span className="text-xs capitalize">{tx.status}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => onOpenExplorer?.(tx.txHash)}
                          className="text-blue-600 hover:text-blue-800 font-mono text-xs flex items-center justify-end gap-1 hover:underline"
                          aria-label={`View transaction ${tx.txHash} on Stellar Explorer`}
                        >
                          {tx.txHash.slice(0, 8)}…{tx.txHash.slice(-6)}
                          <ExternalLink className="h-3 w-3" aria-hidden="true" />
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
                <div
                  key={tx.id}
                  className="border rounded-lg p-4 space-y-2 bg-white dark:bg-gray-900 shadow-sm"
                >
                  <div className="flex justify-between items-start">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{TYPE_LABELS[tx.type]}</Badge>
                      <div className="flex items-center gap-1 text-xs">
                        <StatusIcon
                          className={`h-3 w-3 ${tx.status === 'processing' ? 'animate-spin' : ''}`}
                          aria-hidden="true"
                        />
                        <span className="capitalize">{tx.status}</span>
                      </div>
                    </div>
                    <span className="font-mono text-sm font-semibold dark:text-gray-100">
                      {parseFloat(tx.amount).toLocaleString(undefined, { maximumFractionDigits: 6 })}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm text-gray-600 dark:text-gray-300">
                    <span>{tx.tokenSymbol}</span>
                    <span>
                      {tx.counterpartyLabel ||
                        `${tx.counterparty.slice(0, 4)}…${tx.counterparty.slice(-4)}`}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-gray-400 dark:text-gray-500">
                      {formatDate(tx.date)}
                    </span>
                    <button
                      onClick={() => onOpenExplorer?.(tx.txHash)}
                      className="text-xs text-blue-600 hover:underline flex items-center gap-1"
                      aria-label={`View transaction ${tx.txHash} on Stellar Explorer`}
                    >
                      {tx.txHash.slice(0, 6)}…{tx.txHash.slice(-4)}
                      <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Pagination controls */}
          <Pagination
            currentPage={pagination.currentPage}
            totalPages={pagination.totalPages}
            totalItems={sortedTransactions.length}
            hasPreviousPage={pagination.hasPreviousPage}
            hasNextPage={pagination.hasNextPage}
            pageWindow={pagination.pageWindow}
            onPageChange={pagination.goToPage}
            onFirstPage={pagination.goToFirstPage}
            onLastPage={pagination.goToLastPage}
            label="Transaction history pagination"
          />
        </>
      )}
    </div>
  );
}
