/**
 * Minimal React stub for unit tests that only exercise pure-TypeScript exports
 * from .tsx files. No rendering occurs, so this keeps ts-jest happy without
 * requiring jsdom.
 */
const React = {
  useState: () => [undefined, () => {}],
  useMemo: (fn: () => unknown) => fn(),
  useCallback: (fn: unknown) => fn,
  useEffect: () => {},
  createContext: () => ({ Provider: null, Consumer: null }),
  useContext: () => undefined,
  FC: undefined,
};

export default React;
export const useState = React.useState;
export const useMemo = React.useMemo;
export const useCallback = React.useCallback;
export const useEffect = React.useEffect;
export const createContext = React.createContext;
export const useContext = React.useContext;
