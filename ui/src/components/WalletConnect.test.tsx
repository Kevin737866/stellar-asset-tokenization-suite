/**
 * WalletConnect – regression tests
 *
 * Covers:
 *   - Rendering in disconnected, connected, and error states
 *   - Accessible labels on every interactive control
 *   - aria-live status announcements after connect / disconnect / error
 *   - aria-busy flag on the connect button during async operations
 *   - Provider radio group selection
 *   - Copy-to-clipboard interaction
 *   - Disconnect flow including error recovery
 *
 * Test runner: Jest + @testing-library/react
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import WalletConnect, { WalletConnectProps } from './WalletConnect';
import { WalletInfo } from '@/lib/types';

// ── Toast mock ────────────────────────────────────────────────────────────────

const mockToast = {
  success: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  warning: jest.fn(),
  addToast: jest.fn(),
  removeToast: jest.fn(),
  clearToasts: jest.fn(),
  toasts: [],
};

const mockTranslateError = jest.fn((err: unknown) => {
  const e = err as { code?: string; message?: string };
  if (e?.code === 'NETWORK_ERROR') {
    return { title: 'Network Error', message: 'Network connection lost.' };
  }
  if (e?.code === 'TX_BAD_AUTH') {
    return { title: 'Authorization Failed', message: 'Wallet authorization was rejected.' };
  }
  return { title: 'Connection Failed', message: e?.message ?? 'Unknown error.' };
});

jest.mock('./Toast', () => ({
  useToast: () => mockToast,
  useErrorTranslator: () => mockTranslateError,
}));

// ── Clipboard mock ────────────────────────────────────────────────────────────

Object.defineProperty(navigator, 'clipboard', {
  value: { writeText: jest.fn().mockResolvedValue(undefined) },
  writable: true,
  configurable: true,
});

// ── Helpers ───────────────────────────────────────────────────────────────────

const CONNECTED_WALLET: WalletInfo = {
  provider: 'freighter',
  address: 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGP7FB1X7NX4A2YNPJ1E46',
  network: 'Testnet',
  balance: '1234.5678901',
};

function buildProps(overrides: Partial<WalletConnectProps> = {}): WalletConnectProps {
  return {
    onConnect: jest.fn().mockResolvedValue(CONNECTED_WALLET),
    onDisconnect: jest.fn().mockResolvedValue(undefined),
    network: 'Testnet',
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('WalletConnect – disconnected state', () => {
  it('renders a labelled "Connect wallet" section', () => {
    render(<WalletConnect {...buildProps()} />);
    expect(screen.getByRole('region', { name: /connect wallet/i })).toBeInTheDocument();
  });

  it('renders a "Connect wallet provider" heading', () => {
    render(<WalletConnect {...buildProps()} />);
    expect(screen.getByRole('heading', { name: /connect wallet/i })).toBeInTheDocument();
  });

  it('renders a radiogroup for provider selection with an accessible name', () => {
    render(<WalletConnect {...buildProps()} />);
    expect(
      screen.getByRole('group', { name: /wallet provider selection/i }),
    ).toBeInTheDocument();
  });

  it('renders a radio button for each provider', () => {
    render(<WalletConnect {...buildProps()} />);
    expect(screen.getByRole('radio', { name: /freighter/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /albedo/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /xbull/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /rabet/i })).toBeInTheDocument();
  });

  it('defaults to Freighter selected', () => {
    render(<WalletConnect {...buildProps()} />);
    expect(screen.getByRole('radio', { name: /freighter/i })).toBeChecked();
  });

  it('connect button has an aria-label describing the selected provider', () => {
    render(<WalletConnect {...buildProps()} />);
    expect(
      screen.getByRole('button', { name: /connect freighter wallet/i }),
    ).toBeInTheDocument();
  });

  it('connect button aria-label updates when provider changes', () => {
    render(<WalletConnect {...buildProps()} />);
    fireEvent.click(screen.getByRole('radio', { name: /albedo/i }));
    expect(
      screen.getByRole('button', { name: /connect albedo wallet/i }),
    ).toBeInTheDocument();
  });

  it('shows the network label', () => {
    render(<WalletConnect {...buildProps()} />);
    expect(screen.getByText(/testnet/i)).toBeInTheDocument();
  });
});

describe('WalletConnect – connection in progress', () => {
  it('sets aria-busy on the connect button while connecting', async () => {
    // onConnect never resolves during this test
    const onConnect = jest.fn(() => new Promise<WalletInfo>(() => {}));
    render(<WalletConnect {...buildProps({ onConnect })} />);

    fireEvent.click(screen.getByRole('button', { name: /connect freighter wallet/i }));

    await waitFor(() => {
      const btn = screen.getByRole('button', { name: /connecting/i });
      expect(btn).toHaveAttribute('aria-busy', 'true');
      expect(btn).toBeDisabled();
    });
  });

  it('announces "Connecting to Freighter…" in the polite live region', async () => {
    const onConnect = jest.fn(() => new Promise<WalletInfo>(() => {}));
    render(<WalletConnect {...buildProps({ onConnect })} />);

    fireEvent.click(screen.getByRole('button', { name: /connect freighter wallet/i }));

    await waitFor(() => {
      const liveRegion = document.querySelector('[role="status"][aria-live="polite"]');
      expect(liveRegion?.textContent).toMatch(/connecting to freighter/i);
    });
  });
});

describe('WalletConnect – successful connection', () => {
  it('transitions to the connected view after onConnect resolves', async () => {
    render(<WalletConnect {...buildProps()} />);
    fireEvent.click(screen.getByRole('button', { name: /connect freighter wallet/i }));

    await waitFor(() => {
      expect(screen.getByRole('region', { name: /connected wallet/i })).toBeInTheDocument();
    });
  });

  it('shows the shortened wallet address', async () => {
    render(<WalletConnect {...buildProps()} />);
    fireEvent.click(screen.getByRole('button', { name: /connect freighter wallet/i }));

    await waitFor(() => {
      // Shortened: GCEZWK…E46
      expect(screen.getByRole('code')).toHaveTextContent(/GCEZWK/i);
    });
  });

  it('announces successful connection in the polite live region', async () => {
    render(<WalletConnect {...buildProps()} />);
    fireEvent.click(screen.getByRole('button', { name: /connect freighter wallet/i }));

    await waitFor(() => {
      const region = document.querySelector('[role="status"][aria-live="polite"]');
      expect(region?.textContent).toMatch(/connected to freighter/i);
    });
  });

  it('calls onConnected callback with wallet info', async () => {
    const onConnected = jest.fn();
    render(<WalletConnect {...buildProps({ onConnected })} />);
    fireEvent.click(screen.getByRole('button', { name: /connect freighter wallet/i }));

    await waitFor(() => {
      expect(onConnected).toHaveBeenCalledWith(CONNECTED_WALLET);
    });
  });

  it('disconnect button has an accessible aria-label', async () => {
    render(<WalletConnect {...buildProps()} />);
    fireEvent.click(screen.getByRole('button', { name: /connect freighter wallet/i }));

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /disconnect wallet/i }),
      ).toBeInTheDocument();
    });
  });

  it('copy-address button has an aria-label', async () => {
    render(<WalletConnect {...buildProps()} />);
    fireEvent.click(screen.getByRole('button', { name: /connect freighter wallet/i }));

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /copy wallet address/i }),
      ).toBeInTheDocument();
    });
  });

  it('shows the wallet balance when provided', async () => {
    render(<WalletConnect {...buildProps()} />);
    fireEvent.click(screen.getByRole('button', { name: /connect freighter wallet/i }));

    await waitFor(() => {
      expect(screen.getByText(/1,234/)).toBeInTheDocument();
    });
  });
});

describe('WalletConnect – copy address', () => {
  it('calls clipboard.writeText with the full address', async () => {
    render(<WalletConnect {...buildProps({ initialWallet: CONNECTED_WALLET })} />);
    fireEvent.click(screen.getByRole('button', { name: /copy wallet address/i }));

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(CONNECTED_WALLET.address);
    });
  });

  it('updates aria-label to "Address copied" after copy', async () => {
    render(<WalletConnect {...buildProps({ initialWallet: CONNECTED_WALLET })} />);
    fireEvent.click(screen.getByRole('button', { name: /copy wallet address/i }));

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /address copied/i }),
      ).toBeInTheDocument();
    });
  });

  it('announces copy success in the polite live region', async () => {
    render(<WalletConnect {...buildProps({ initialWallet: CONNECTED_WALLET })} />);
    fireEvent.click(screen.getByRole('button', { name: /copy wallet address/i }));

    await waitFor(() => {
      const region = document.querySelector('[role="status"][aria-live="polite"]');
      expect(region?.textContent).toMatch(/copied to clipboard/i);
    });
  });
});

describe('WalletConnect – connection error', () => {
  it('shows an error banner when onConnect rejects', async () => {
    const err = { code: 'TX_BAD_AUTH', message: 'Wallet authorization was rejected.' };
    const onConnect = jest.fn().mockRejectedValue(err);
    render(<WalletConnect {...buildProps({ onConnect })} />);

    fireEvent.click(screen.getByRole('button', { name: /connect freighter wallet/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert', { name: /connection error/i })).toBeInTheDocument();
    });
  });

  it('places the error message in the assertive live region', async () => {
    const err = { code: 'TX_BAD_AUTH', message: 'Wallet authorization was rejected.' };
    const onConnect = jest.fn().mockRejectedValue(err);
    render(<WalletConnect {...buildProps({ onConnect })} />);

    fireEvent.click(screen.getByRole('button', { name: /connect freighter wallet/i }));

    await waitFor(() => {
      const urgent = document.querySelector('[role="alert"][aria-live="assertive"]');
      expect(urgent?.textContent).toMatch(/connection failed/i);
    });
  });

  it('shows a network-error icon and banner for NETWORK_ERROR code', async () => {
    const err = { code: 'NETWORK_ERROR', message: 'Network connection lost.' };
    const onConnect = jest.fn().mockRejectedValue(err);
    render(<WalletConnect {...buildProps({ onConnect })} />);

    fireEvent.click(screen.getByRole('button', { name: /connect freighter wallet/i }));

    await waitFor(() => {
      expect(
        screen.getByRole('alert', { name: /network connection error/i }),
      ).toBeInTheDocument();
    });
  });

  it('connect button returns to non-busy state after error', async () => {
    const err = { message: 'Something went wrong.' };
    const onConnect = jest.fn().mockRejectedValue(err);
    render(<WalletConnect {...buildProps({ onConnect })} />);

    fireEvent.click(screen.getByRole('button', { name: /connect freighter wallet/i }));

    await waitFor(() => {
      const btn = screen.getByRole('button', { name: /connect freighter wallet/i });
      expect(btn).toHaveAttribute('aria-busy', 'false');
      expect(btn).not.toBeDisabled();
    });
  });
});

describe('WalletConnect – disconnect flow', () => {
  it('calls onDisconnect when the disconnect button is clicked', async () => {
    const onDisconnect = jest.fn().mockResolvedValue(undefined);
    render(
      <WalletConnect
        {...buildProps({ onDisconnect, initialWallet: CONNECTED_WALLET })}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /disconnect wallet/i }));

    await waitFor(() => {
      expect(onDisconnect).toHaveBeenCalledTimes(1);
    });
  });

  it('returns to the connect view after successful disconnect', async () => {
    render(
      <WalletConnect {...buildProps({ initialWallet: CONNECTED_WALLET })} />,
    );

    fireEvent.click(screen.getByRole('button', { name: /disconnect wallet/i }));

    await waitFor(() => {
      expect(screen.getByRole('region', { name: /connect wallet/i })).toBeInTheDocument();
    });
  });

  it('announces disconnection in the polite live region', async () => {
    render(
      <WalletConnect {...buildProps({ initialWallet: CONNECTED_WALLET })} />,
    );

    fireEvent.click(screen.getByRole('button', { name: /disconnect wallet/i }));

    await waitFor(() => {
      const region = document.querySelector('[role="status"][aria-live="polite"]');
      expect(region?.textContent).toMatch(/wallet disconnected/i);
    });
  });

  it('calls onDisconnected callback after successful disconnect', async () => {
    const onDisconnected = jest.fn();
    render(
      <WalletConnect
        {...buildProps({ initialWallet: CONNECTED_WALLET, onDisconnected })}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /disconnect wallet/i }));

    await waitFor(() => {
      expect(onDisconnected).toHaveBeenCalledTimes(1);
    });
  });

  it('stays on connected view and shows assertive error when disconnect fails', async () => {
    const err = { message: 'Disconnect rejected.' };
    const onDisconnect = jest.fn().mockRejectedValue(err);
    render(
      <WalletConnect
        {...buildProps({ onDisconnect, initialWallet: CONNECTED_WALLET })}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /disconnect wallet/i }));

    await waitFor(() => {
      // Still shows connected view
      expect(screen.getByRole('region', { name: /connected wallet/i })).toBeInTheDocument();
      // Assertive region has the error
      const urgent = document.querySelector('[role="alert"][aria-live="assertive"]');
      expect(urgent?.textContent).toMatch(/disconnect failed/i);
    });
  });
});

describe('WalletConnect – initialWallet prop (pre-connected)', () => {
  it('renders connected view immediately when initialWallet is supplied', () => {
    render(
      <WalletConnect {...buildProps({ initialWallet: CONNECTED_WALLET })} />,
    );
    expect(screen.getByRole('region', { name: /connected wallet/i })).toBeInTheDocument();
  });

  it('does not render the provider radio group when already connected', () => {
    render(
      <WalletConnect {...buildProps({ initialWallet: CONNECTED_WALLET })} />,
    );
    expect(
      screen.queryByRole('group', { name: /wallet provider selection/i }),
    ).not.toBeInTheDocument();
  });

  it('shows wallet status badge labelled "connected"', () => {
    render(
      <WalletConnect {...buildProps({ initialWallet: CONNECTED_WALLET })} />,
    );
    expect(screen.getByLabelText(/wallet status: connected/i)).toBeInTheDocument();
  });
});
