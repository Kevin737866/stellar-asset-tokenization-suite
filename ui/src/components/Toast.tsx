'use client';

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { CheckCircle, XCircle, AlertTriangle, Info, X } from 'lucide-react';

// Toast Types
export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastMessage {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
  retryAction?: () => void;
}

interface ToastContextType {
  toasts: ToastMessage[];
  addToast: (toast: Omit<ToastMessage, 'id'>) => void;
  removeToast: (id: string) => void;
  clearToasts: () => void;
  success: (title: string, message?: string) => void;
  error: (title: string, message?: string, retryAction?: () => void) => void;
  warning: (title: string, message?: string) => void;
  info: (title: string, message?: string) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

export function useToast(): ToastContextType {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}

// Default duration per type in ms
const DEFAULT_DURATIONS: Record<ToastType, number> = {
  success: 5000,
  error: 8000,
  warning: 6000,
  info: 5000,
};

// Icons per type
const ToastIcon: React.FC<{ type: ToastType }> = ({ type }) => {
  switch (type) {
    case 'success':
      return <CheckCircle className="h-5 w-5 text-green-500" />;
    case 'error':
      return <XCircle className="h-5 w-5 text-red-500" />;
    case 'warning':
      return <AlertTriangle className="h-5 w-5 text-yellow-500" />;
    case 'info':
      return <Info className="h-5 w-5 text-blue-500" />;
  }
};

// Color styles per type
const STYLES: Record<ToastType, { border: string; bg: string }> = {
  success: { border: 'border-green-400', bg: 'bg-green-50' },
  error: { border: 'border-red-400', bg: 'bg-red-50' },
  warning: { border: 'border-yellow-400', bg: 'bg-yellow-50' },
  info: { border: 'border-blue-400', bg: 'bg-blue-50' },
};

// Individual Toast Item with auto-dismiss and retry
const ToastItem: React.FC<{
  toast: ToastMessage;
  onRemove: (id: string) => void;
}> = ({ toast, onRemove }) => {
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const duration = toast.duration ?? DEFAULT_DURATIONS[toast.type];

  useEffect(() => {
    if (duration > 0) {
      timerRef.current = setTimeout(() => {
        onRemove(toast.id);
      }, duration);
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [toast.id, duration, onRemove]);

  return (
    <div
      className={`flex items-start gap-3 p-4 rounded-lg shadow-lg border-l-4 ${STYLES[toast.type].border} ${STYLES[toast.type].bg} transition-all duration-300 animate-slide-in`}
      role="alert"
    >
      <ToastIcon type={toast.type} />
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-gray-900 text-sm">{toast.title}</p>
        {toast.message && (
          <p className="text-sm text-gray-600 mt-0.5">{toast.message}</p>
        )}
        {toast.retryAction && toast.type === 'error' && (
          <button
            onClick={() => {
              toast.retryAction?.();
              onRemove(toast.id);
            }}
            className="mt-2 text-sm font-medium text-red-600 hover:text-red-700 underline"
          >
            Retry
          </button>
        )}
      </div>
      <button
        onClick={() => onRemove(toast.id)}
        className="shrink-0 p-1 rounded-full hover:bg-black/5 transition-colors"
        aria-label="Dismiss"
      >
        <X className="h-4 w-4 text-gray-400" />
      </button>
    </div>
  );
};

// ToastProvider wraps the app
export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const addToast = useCallback((toast: Omit<ToastMessage, 'id'>) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    setToasts((prev) => [...prev, { ...toast, id }]);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const clearToasts = useCallback(() => {
    setToasts([]);
  }, []);

  // Convenience methods
  const success = useCallback(
    (title: string, message?: string) => addToast({ type: 'success', title, message }),
    [addToast]
  );

  const error = useCallback(
    (title: string, message?: string, retryAction?: () => void) =>
      addToast({ type: 'error', title, message, retryAction }),
    [addToast]
  );

  const warning = useCallback(
    (title: string, message?: string) => addToast({ type: 'warning', title, message }),
    [addToast]
  );

  const info = useCallback(
    (title: string, message?: string) => addToast({ type: 'info', title, message }),
    [addToast]
  );

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast, clearToasts, success, error, warning, info }}>
      {children}
      {/* Toast Container - fixed position */}
      <div
        className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none"
        aria-live="polite"
        aria-label="Notifications"
      >
        {toasts.map((toast) => (
          <div key={toast.id} className="pointer-events-auto">
            <ToastItem toast={toast} onRemove={removeToast} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};

// Hook to convert contract errors to user-friendly messages
export function useErrorTranslator() {
  const translateError = useCallback((error: any): { title: string; message: string } => {
    if (!error) return { title: 'Unknown Error', message: 'An unexpected error occurred.' };

    const code = error?.code;
    const message = error?.message || '';

    // Network errors
    if (code === 'NETWORK_ERROR' || message.includes('Network') || message.includes('fetch')) {
      return {
        title: 'Network Connection Error',
        message: 'Unable to connect to the Stellar network. Please check your internet connection and try again.',
      };
    }

    // Stellar Horizon errors
    if (code === 'TX_BAD_AUTH') {
      return {
        title: 'Transaction Authorization Failed',
        message: 'The transaction was rejected due to invalid signatures. Please check your wallet authorization.',
      };
    }
    if (code === 'TX_INSUFFICIENT_FEE') {
      return {
        title: 'Insufficient Transaction Fee',
        message: 'The transaction fee is too low. Please increase the fee and try again.',
      };
    }
    if (code === 'OP_UNDERFUNDED') {
      return {
        title: 'Insufficient Balance',
        message: 'Your account does not have enough funds to complete this operation. Please add funds and retry.',
      };
    }
    if (code === 'OP_LOW_RESERVE') {
      return {
        title: 'Minimum Reserve Required',
        message: 'This operation would drop your account below the minimum reserve. Please maintain a higher balance.',
      };
    }
    if (code === 'TX_TOO_EARLY' || code === 'TX_TOO_LATE') {
      return {
        title: 'Transaction Expired',
        message: 'The transaction time window has passed. Please resubmit the transaction.',
      };
    }
    if (code === 'TX_MALFORMED') {
      return {
        title: 'Invalid Transaction',
        message: 'The transaction contains invalid data. Please check your inputs and try again.',
      };
    }

    // Contract errors
    if (code === 'COMPLIANCE_FAILED' || code === 'KYC_NOT_VERIFIED') {
      return {
        title: 'Compliance Check Failed',
        message: 'Your account does not meet the compliance requirements. Please complete KYC verification first.',
      };
    }
    if (code === 'BLACKLISTED') {
      return {
        title: 'Account Restricted',
        message: 'Your account is currently restricted from performing this operation.',
      };
    }
    if (code === 'TRANSFER_PAUSED') {
      return {
        title: 'Transfers Paused',
        message: 'Token transfers are currently paused. Please try again later.',
      };
    }
    if (code === 'ASSET_FROZEN') {
      return {
        title: 'Asset Frozen',
        message: 'This asset is currently frozen and cannot be transferred.',
      };
    }
    if (code === 'INSUFFICIENT_BALANCE') {
      return {
        title: 'Insufficient Balance',
        message: 'You do not have enough tokens to complete this operation.',
      };
    }
    if (code === 'TRADING_PAUSED') {
      return {
        title: 'Trading Paused',
        message: 'Trading is currently paused on this market. Please check back later.',
      };
    }
    if (code === 'ORDER_EXPIRED') {
      return {
        title: 'Order Expired',
        message: 'Your order has expired. Please place a new order.',
      };
    }
    if (code === 'INSUFFICIENT_LIQUIDITY') {
      return {
        title: 'Insufficient Liquidity',
        message: 'There is not enough liquidity in the order book to fill your order.',
      };
    }
    if (code === 'SIMULATION_FAILED') {
      return {
        title: 'Transaction Simulation Failed',
        message: message || 'The transaction would fail if submitted. Please check your parameters.',
      };
    }

    // Generic fallback
    return {
      title: 'Operation Failed',
      message: message || 'An unexpected error occurred. Please try again or contact support.',
    };
  }, []);

  return translateError;
}

export default ToastProvider;
