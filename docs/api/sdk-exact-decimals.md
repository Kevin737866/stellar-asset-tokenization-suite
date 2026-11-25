# SDK (TypeScript): Exact decimal parsing

Source: `sdk/src/decimal.ts` (Issue #388)

## Why

JavaScript `number` values are IEEE-754 doubles. Parsing a decimal string with
`Number()` or `parseFloat()` can round it (`0.100000000000000005` → `0.1`), lose
integer precision above `Number.MAX_SAFE_INTEGER`, or underflow very small
values to `0`. Soroban amounts are `i128` integers, so any such rounding at the
SDK boundary would silently change the value committed on-chain.

All helpers in this module operate on strings and `bigint` only; no `number`
conversion happens while parsing a value.

## Public API

### `parseExactDecimal(value: string, options?): ExactDecimal`

Accepts `[+|-]<digits>[.<digits>]`. Returns
`{ unscaled: bigint, scale: number }` where the value is exactly
`unscaled * 10^-scale`. Leading and trailing zeros are preserved.

Options:
- `name` — field name used in error messages (default `value`).
- `allowNegative` — accept a leading `-` (default `true`).
- `allowPositiveSign` — accept a leading `+` (default `true`).
- `maxScale` — reject decimals with more fractional digits than this instead
  of truncating them (default: unlimited).

### `formatExactDecimal(value: ExactDecimal): string`

Renders an exact decimal back to a canonical string. Round-trips exactly.

### `exactDecimalToScaled(value: ExactDecimal, decimals?, options?): bigint`

Scales to an integer with `decimals` fractional digits (default 18, matching
`DEFAULT_DECIMALS`). A value with more fractional digits than `decimals` is
**rejected**; it is never silently truncated.

### `scaledToExactDecimal(unscaled: bigint, decimals?): ExactDecimal`

Builds an `ExactDecimal` from an already-scaled integer.

### `parseExactScaledAmount(value: string, decimals?, options?): bigint`

Convenience composition of `parseExactDecimal` + `exactDecimalToScaled`.
Use this to produce the `i128` value passed to a contract.

## Failure semantics

Invalid input (non-string, `.5`, `1.`, exponent notation, whitespace, a
disallowed sign, or excess precision when `maxScale`/`decimals` is set) throws
`InvalidParametersError` **before** any value is produced. These functions are
pure, so a rejected parse cannot leave partial state.

## Compatibility

`validateAmount` now uses this parser for string inputs instead of
`parseFloat`; valid amounts behave identically, while very small positive
values are no longer underflowed to zero. `parseAmount` and `safeParseAmount`
delegate to the exact parser but retain their historical behaviour of
truncating fractional digits beyond the configured scale (18 by default) —
callers needing strict precision must use `parseExactScaledAmount`.
