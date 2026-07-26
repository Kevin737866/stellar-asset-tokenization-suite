'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import {
  ChevronLeft,
  ChevronRight,
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

interface TransactionHistoryProps {
  transactions: Transaction[];
  onOpenExplorer?: (txHash: string) => void;
  isLoading?: boolean;
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

const ITEMS_PER_PAGE = 20;

export default function TransactionHistory({ transactions, onOpenExplorer, isLoading = false }: TransactionHistoryProps) {
  // Filter state
  const [filterType, setFilterType] = useState<TransactionType>('all');
  const [filterToken, setFilterToken] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [dateRange, setDateRange] = useState<{ start: string; end: string }>({ start: '', end: '' });
  const [searchQuery, setSearchQuery] = useState('');

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [sortField, setSortField] = useState<'date' | 'amount' | 'type' | 'status'>('date');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  // Get unique tokens for filter dropdown
  const uniqueTokens = useMemo(() => {
    const tokenSet = new Map<string, string>();
    transactions.forEach((tx) => {
      tokenSet.set(tx.token, tx.tokenSymbol || tx.token);
    });
    return Array.from(tokenSet.entries());
  }, [transactions]);

  // Filter transactions
  const filteredTransactions = useMemo(() => {
    return transactions.filter((tx) => {
      // Type filter
      if (filterType !== 'all' && tx.type !== filterType) return false;

      // Token filter
      if (filterToken !== 'all' && tx.token !== filterToken) return false;

      // Status filter
      if (filterStatus !== 'all' && tx.status !== filterStatus) return false;

      // Date range filter
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

      // Search query
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

  // Sort transactions
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

  // Paginate
  const totalPages = Math.ceil(sortedTransactions.length / ITEMS_PER_PAGE);
  const paginatedTransactions = useMemo(() => {
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    return sortedTransactions.slice(startIndex, startIndex + ITEMS_PER_PAGE);
  }, [sortedTransactions, currentPage]);

  // Reset page on filter change
  const handleFilterChange = useCallback((setter: Function, value: any) => {
    setter(value);
    setCurrentPage(1);
  }, []);

  // Sort toggle
  const handleSort = (field: typeof sortField) => {
    if (sortField === field) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
    setCurrentPage(1);
  };

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

  // Loading skeleton
  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-10 bg-gray-200 animate-pulse rounded-lg" />
          ))}
        </div>
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 bg-gray-100 animate-pulse rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

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
        <div className="flex flex-col items-center justify-center py-16 text-gray-400">
          <Inbox className="h-16 w-16 mb-4" />
          <p className="text-lg font-medium text-gray-500">No transactions found</p>
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
              <thead className="bg-gray-50 border-b">
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
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {tx.counterpartyLabel || `${tx.counterparty.slice(0, 6)}...${tx.counterparty.slice(-4)}`}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">{formatDate(tx.date)}</td>
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
                    <span className="text-xs text-gray-400">{formatDate(tx.date)}</span>
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

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-4 border-t">
          <p className="text-sm text-gray-500">
            Page {currentPage} of {totalPages} ({sortedTransactions.length} results)
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </Button>
            <div className="flex gap-1">
              {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                let pageNum: number;
                if (totalPages <= 5) {
                  pageNum = i + 1;
                } else if (currentPage <= 3) {
                  pageNum = i + 1;
                } else if (currentPage >= totalPages - 2) {
                  pageNum = totalPages - 4 + i;
                } else {
                  pageNum = currentPage - 2 + i;
                }
                return (
                  <Button
                    key={pageNum}
                    variant={pageNum === currentPage ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setCurrentPage(pageNum)}
                    className="w-9 h-9"
                  >
                    {pageNum}
                  </Button>
                );
              })}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
