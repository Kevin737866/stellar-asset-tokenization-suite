'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { Sun, Moon, Monitor } from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────────

export type ThemeMode = 'light' | 'dark' | 'system';

interface ThemeContextType {
  mode: ThemeMode;
  resolvedTheme: 'light' | 'dark';
  setMode: (mode: ThemeMode) => void;
  toggleTheme: () => void;
}

// ── Context ────────────────────────────────────────────────────────────────────

const ThemeContext = createContext<ThemeContextType | null>(null);

export function useTheme(): ThemeContextType {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

// ── LocalStorage helpers ───────────────────────────────────────────────────────

const THEME_STORAGE_KEY = 'stellar-rwa-theme';

function getStoredTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'system';
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      return stored;
    }
  } catch {
    // localStorage unavailable
  }
  return 'system';
}

function storeTheme(mode: ThemeMode): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // localStorage unavailable
  }
}

function getSystemPreference(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

// ── Provider ───────────────────────────────────────────────────────────────────

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [mode, setModeState] = useState<ThemeMode>(getStoredTheme);
  const [systemDark, setSystemDark] = useState<boolean>(() => getSystemPreference() === 'dark');

  // Listen for system theme changes
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e: MediaQueryListEvent) => {
      setSystemDark(e.matches);
    };
    mq.addEventListener('change', handleChange);
    return () => mq.removeEventListener('change', handleChange);
  }, []);

  const resolvedTheme: 'light' | 'dark' = useMemo(() => {
    if (mode === 'system') return systemDark ? 'dark' : 'light';
    return mode;
  }, [mode, systemDark]);

  const setMode = useCallback((newMode: ThemeMode) => {
    setModeState(newMode);
    storeTheme(newMode);
  }, []);

  const toggleTheme = useCallback(() => {
    setModeState((prev) => {
      const cycle: ThemeMode[] = ['light', 'dark', 'system'];
      const currentIndex = cycle.indexOf(prev);
      const next = cycle[(currentIndex + 1) % cycle.length];
      storeTheme(next);
      return next;
    });
  }, []);

  // Apply theme class to <html> and set CSS color-scheme
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(resolvedTheme);
    root.style.colorScheme = resolvedTheme;

    // Set theme-color meta tag for mobile browsers
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute(
        'content',
        resolvedTheme === 'dark' ? '#0f172a' : '#ffffff'
      );
    }
  }, [resolvedTheme]);

  const value = useMemo<ThemeContextType>(
    () => ({ mode, resolvedTheme, setMode, toggleTheme }),
    [mode, resolvedTheme, setMode, toggleTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

// ── Theme Toggle Button ────────────────────────────────────────────────────────

const ICON_CLASS = 'h-4 w-4 transition-transform duration-300';

export const ThemeToggle: React.FC<{ className?: string }> = ({ className = '' }) => {
  const { mode, resolvedTheme, toggleTheme } = useTheme();

  const ModeIcon = mode === 'system' ? Monitor : mode === 'dark' ? Moon : Sun;

  return (
    <button
      onClick={toggleTheme}
      className={`
        relative inline-flex items-center justify-center
        rounded-full p-2
        bg-theme-surface-hover
        text-theme-text-secondary
        hover:text-theme-text-primary
        hover:bg-theme-border
        focus:outline-none focus:ring-2 focus:ring-theme-accent-primary focus:ring-offset-2
        focus:ring-offset-theme-surface
        transition-all duration-200
        ${className}
      `}
      aria-label={`Current theme: ${mode} (${resolvedTheme}). Click to cycle through themes.`}
      title={`Theme: ${mode} (${resolvedTheme})`}
    >
      <ModeIcon className={ICON_CLASS} aria-hidden="true" />
      {/* Subtle indicator dot for system mode */}
      {mode === 'system' && (
        <span
          className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-theme-accent-primary"
          aria-hidden="true"
        />
      )}
    </button>
  );
};

// ── Inline CSS Variables ──────────────────────────────────────────────────────

/**
 * Global CSS variables injected via a style tag.
 * This ensures all components automatically pick up theme values.
 * Use Tailwind's `dark:` variant OR these CSS variables for theming.
 *
 * Usage in components:
 *   - background: bg-theme-surface (via Tailwind CSS var)
 *   - text: text-theme-text-primary
 *   - border: border-theme-border
 */
export function ThemeStyleInjector() {
  return (
    <style
      dangerouslySetInnerHTML={{
        __html: `
          /* ── Light Theme (default) ────────────────────────── */
          :root,
          .light {
            /* Surfaces */
            --color-surface-primary: #ffffff;
            --color-surface-secondary: #f8fafc;
            --color-surface-tertiary: #f1f5f9;
            --color-surface-hover: #e2e8f0;
            --color-surface-card: #ffffff;
            --color-surface-overlay: rgba(15, 23, 42, 0.5);

            /* Text */
            --color-text-primary: #0f172a;
            --color-text-secondary: #475569;
            --color-text-tertiary: #94a3b8;
            --color-text-inverse: #ffffff;

            /* Borders */
            --color-border-primary: #e2e8f0;
            --color-border-secondary: #cbd5e1;
            --color-border-focus: #3b82f6;

            /* Accent / Brand */
            --color-accent-primary: #3b82f6;
            --color-accent-primary-hover: #2563eb;
            --color-accent-secondary: #8b5cf6;
            --color-accent-success: #10b981;
            --color-accent-warning: #f59e0b;
            --color-accent-danger: #ef4444;
            --color-accent-info: #06b6d4;

            /* Accent backgrounds */
            --color-accent-primary-bg: #eff6ff;
            --color-accent-success-bg: #ecfdf5;
            --color-accent-warning-bg: #fffbeb;
            --color-accent-danger-bg: #fef2f2;
            --color-accent-info-bg: #ecfeff;

            /* Shadows */
            --shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
            --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1);
            --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1);
            --shadow-xl: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1);

            /* Inputs */
            --color-input-bg: #ffffff;
            --color-input-border: #e2e8f0;
            --color-input-focus-ring: rgba(59, 130, 246, 0.3);
            --color-input-placeholder: #94a3b8;

            /* Misc */
            --color-skeleton: #e2e8f0;
            --color-skeleton-shine: #f1f5f9;
            --radius-sm: 0.375rem;
            --radius-md: 0.5rem;
            --radius-lg: 0.75rem;
            --radius-xl: 1rem;
            --radius-full: 9999px;

            /* Transition */
            --theme-transition: background-color 0.3s ease, color 0.3s ease, border-color 0.3s ease, box-shadow 0.3s ease;
          }

          /* ── Dark Theme ──────────────────────────────────── */
          .dark {
            /* Surfaces */
            --color-surface-primary: #0f172a;
            --color-surface-secondary: #1e293b;
            --color-surface-tertiary: #334155;
            --color-surface-hover: #475569;
            --color-surface-card: #1e293b;
            --color-surface-overlay: rgba(0, 0, 0, 0.7);

            /* Text */
            --color-text-primary: #f8fafc;
            --color-text-secondary: #cbd5e1;
            --color-text-tertiary: #64748b;
            --color-text-inverse: #0f172a;

            /* Borders */
            --color-border-primary: #334155;
            --color-border-secondary: #475569;
            --color-border-focus: #60a5fa;

            /* Accent / Brand */
            --color-accent-primary: #60a5fa;
            --color-accent-primary-hover: #3b82f6;
            --color-accent-secondary: #a78bfa;
            --color-accent-success: #34d399;
            --color-accent-warning: #fbbf24;
            --color-accent-danger: #f87171;
            --color-accent-info: #22d3ee;

            /* Accent backgrounds */
            --color-accent-primary-bg: #1e3a5f;
            --color-accent-success-bg: #064e3b;
            --color-accent-warning-bg: #78350f;
            --color-accent-danger-bg: #7f1d1d;
            --color-accent-info-bg: #164e63;

            /* Shadows */
            --shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.3);
            --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.4), 0 2px 4px -2px rgba(0, 0, 0, 0.3);
            --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.4), 0 4px 6px -4px rgba(0, 0, 0, 0.3);
            --shadow-xl: 0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.4);

            /* Inputs */
            --color-input-bg: #1e293b;
            --color-input-border: #475569;
            --color-input-focus-ring: rgba(96, 165, 250, 0.3);
            --color-input-placeholder: #64748b;

            /* Misc */
            --color-skeleton: #334155;
            --color-skeleton-shine: #475569;
          }

          /* ── Base Application ──────────────────────────── */
          html {
            transition: var(--theme-transition);
          }

          body {
            background-color: var(--color-surface-primary);
            color: var(--color-text-primary);
            transition: var(--theme-transition);
          }

          /* ── Scrollbar styling ─────────────────────────── */
          ::-webkit-scrollbar {
            width: 8px;
            height: 8px;
          }
          ::-webkit-scrollbar-track {
            background: var(--color-surface-secondary);
          }
          ::-webkit-scrollbar-thumb {
            background: var(--color-border-secondary);
            border-radius: var(--radius-full);
          }
          ::-webkit-scrollbar-thumb:hover {
            background: var(--color-text-tertiary);
          }

          /* ── Selection ─────────────────────────────────── */
          ::selection {
            background-color: var(--color-accent-primary);
            color: var(--color-text-inverse);
          }

          /* ── Focus visible ──────────────────────────────── */
          :focus-visible {
            outline: 2px solid var(--color-accent-primary);
            outline-offset: 2px;
          }

          /* ── Animations ────────────────────────────────── */
          @keyframes slide-in {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
          }
          .animate-slide-in {
            animation: slide-in 0.3s ease-out;
          }

          @keyframes fade-in {
            from { opacity: 0; }
            to { opacity: 1; }
          }
          .animate-fade-in {
            animation: fade-in 0.2s ease-out;
          }
        `,
      }}
    />
  );
}

export default ThemeProvider;
