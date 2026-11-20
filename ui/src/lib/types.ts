/**
 * UI type aliases for the SDK's shared types.
 *
 * The UI components import their data shapes from `@/lib/types`; the
 * canonical definitions live in `sdk/src/types.ts`, so this module only
 * re-exports them instead of duplicating the shapes. (Added for Drips
 * Wave 11 issue #437: the dashboard's `Portfolio` / `AssetHolding` /
 * `Balance` imports previously pointed at a module that did not exist.)
 */
export * from '../../../sdk/src/types';
