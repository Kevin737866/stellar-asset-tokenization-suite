import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { canonicalAccount, shouldClearAccountViews } from './walletSession';

/**
 * Holds state that belongs to the connected account only.
 *
 * The value is reset to `createInitialState()` whenever the account is
 * disconnected or switched. Connecting for the first time does not clear
 * anything, and unrelated re-renders for the same account preserve the value.
 * `reset` is also returned for explicit manual clears.
 */
export function useAccountScopedState<T>(
  account: string | null | undefined,
  createInitialState: () => T
): readonly [T, Dispatch<SetStateAction<T>>, () => void] {
  const [state, setState] = useState<T>(createInitialState);
  const previousAccount = useRef<string | null>(canonicalAccount(account));
  const initialState = useRef(createInitialState);

  const reset = useCallback(() => setState(initialState.current()), []);

  useEffect(() => {
    const nextAccount = canonicalAccount(account);
    if (shouldClearAccountViews(previousAccount.current, nextAccount)) {
      reset();
    }
    previousAccount.current = nextAccount;
  }, [account, reset]);

  return [state, setState, reset] as const;
}
