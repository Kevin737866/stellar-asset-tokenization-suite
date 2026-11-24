# Ownership dashboards

## `OwnershipDashboard`

`OwnershipDashboard` renders portfolio overview, assets, dividends, and voting tabs. It supports three top-level presentation states in addition to the populated dashboard:

- **Loading** — `isLoading` renders skeleton cards and a labelled status region.
- **Error** — `error` renders an alert with the error message and, when `onRetry` is supplied, a retry button. Error takes precedence over loading.
- **Empty** — when `isLoading` is false, `error` is absent, and `portfolio.assets.length === 0`, an empty-state card explains that tokenized assets will appear once issued.

Once assets are present, the existing tabs and per-operation loading/error handling are unchanged.

```tsx
<OwnershipDashboard
  userAddress={userAddress}
  portfolio={portfolio}
  isLoading={isPortfolioLoading}
  error={portfolioError}
  onRetry={reloadPortfolio}
/>
```

## `TransactionHistory`

`TransactionHistory` accepts the same `isLoading`, `error`, and `onRetry` props. Error state takes precedence over the loading skeleton and existing filters/pagination. When there are no transactions, or no transactions match the active filters, the existing empty state remains with an explanatory message.

```tsx
<TransactionHistory
  transactions={transactions}
  isLoading={isHistoryLoading}
  error={historyError}
  onRetry={reloadHistory}
/>
```
