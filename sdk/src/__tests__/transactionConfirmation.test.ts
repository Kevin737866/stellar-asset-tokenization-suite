import {
  pollTransactionConfirmation,
  TransactionConfirmationError,
  MAX_CONFIRMATION_TIMEOUT_MS,
  type TransactionConfirmationServer,
} from '../transactionConfirmation';

describe('pollTransactionConfirmation', () => {
  const txHash = 'a'.repeat(64);
  const noopSleep = async () => {};

  it('resolves immediately when transaction is already SUCCESS', async () => {
    const server: TransactionConfirmationServer = {
      getTransaction: jest.fn().mockResolvedValue({
        status: 'SUCCESS',
        ledger: 12345,
        createdAt: 1700000000,
        resultXdr: 'RESULT_XDR',
        resultMetaXdr: 'META_XDR',
      }),
    };

    const result = await pollTransactionConfirmation(txHash, {
      server,
      timeoutMs: 5000,
      pollIntervalMs: 100,
      sleep: noopSleep,
    });

    expect(result.confirmed).toBe(true);
    expect(result.status).toBe('SUCCESS');
    expect(result.transactionHash).toBe(txHash);
    expect(result.ledger).toBe(12345);
    expect(result.resultXdr).toBe('RESULT_XDR');
    expect(result.resultMetaXdr).toBe('META_XDR');
    expect(result.attempts).toBe(1);
    expect(server.getTransaction).toHaveBeenCalledTimes(1);
  });

  it('polls through NOT_FOUND and PENDING until SUCCESS', async () => {
    const onPoll = jest.fn();
    const server: TransactionConfirmationServer = {
      getTransaction: jest
        .fn()
        .mockResolvedValueOnce({ status: 'NOT_FOUND' })
        .mockResolvedValueOnce({ status: 'PENDING' })
        .mockResolvedValueOnce({ status: 'SUCCESS', ledger: 99 }),
    };

    const result = await pollTransactionConfirmation(txHash, {
      server,
      timeoutMs: 5000,
      pollIntervalMs: 50,
      onPoll,
      sleep: noopSleep,
    });

    expect(result.confirmed).toBe(true);
    expect(result.attempts).toBe(3);
    expect(result.ledger).toBe(99);
    expect(onPoll).toHaveBeenCalledTimes(3);
    expect(onPoll).toHaveBeenNthCalledWith(1, expect.objectContaining({ attempt: 1, status: 'NOT_FOUND' }));
    expect(onPoll).toHaveBeenNthCalledWith(2, expect.objectContaining({ attempt: 2, status: 'PENDING' }));
    expect(onPoll).toHaveBeenNthCalledWith(3, expect.objectContaining({ attempt: 3, status: 'SUCCESS' }));
  });

  it('throws TRANSACTION_FAILED immediately when status is FAILED', async () => {
    const server: TransactionConfirmationServer = {
      getTransaction: jest.fn().mockResolvedValue({
        status: 'FAILED',
        ledger: 100,
        resultXdr: 'ERR_XDR',
      }),
    };

    await expect(
      pollTransactionConfirmation(txHash, {
        server,
        timeoutMs: 5000,
        pollIntervalMs: 50,
        sleep: noopSleep,
      }),
    ).rejects.toMatchObject({
      name: 'TransactionConfirmationError',
      code: 'TRANSACTION_FAILED',
    });

    expect(server.getTransaction).toHaveBeenCalledTimes(1);
  });

  it('throws TIMEOUT when bounded timeout expires', async () => {
    const server: TransactionConfirmationServer = {
      getTransaction: jest.fn().mockResolvedValue({ status: 'NOT_FOUND' }),
    };

    await expect(
      pollTransactionConfirmation(txHash, {
        server,
        timeoutMs: 30,
        pollIntervalMs: 10,
      }),
    ).rejects.toMatchObject({
      name: 'TransactionConfirmationError',
      code: 'TIMEOUT',
    });
  });

  it('throws TIMEOUT when maxAttempts is reached', async () => {
    const server: TransactionConfirmationServer = {
      getTransaction: jest.fn().mockResolvedValue({ status: 'PENDING' }),
    };

    await expect(
      pollTransactionConfirmation(txHash, {
        server,
        timeoutMs: 5000,
        pollIntervalMs: 10,
        maxAttempts: 2,
        sleep: noopSleep,
      }),
    ).rejects.toMatchObject({
      name: 'TransactionConfirmationError',
      code: 'TIMEOUT',
    });

    expect(server.getTransaction).toHaveBeenCalledTimes(2);
  });

  it('throws TIMEOUT when AbortSignal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const server: TransactionConfirmationServer = {
      getTransaction: jest.fn().mockResolvedValue({ status: 'SUCCESS' }),
    };

    await expect(
      pollTransactionConfirmation(txHash, {
        server,
        timeoutMs: 5000,
        pollIntervalMs: 10,
        signal: controller.signal,
        sleep: noopSleep,
      }),
    ).rejects.toMatchObject({
      name: 'TransactionConfirmationError',
      code: 'TIMEOUT',
    });

    expect(server.getTransaction).not.toHaveBeenCalled();
  });

  it('wraps RPC transport errors in NETWORK_ERROR', async () => {
    const server: TransactionConfirmationServer = {
      getTransaction: jest.fn().mockRejectedValue(new Error('ECONNRESET')),
    };

    await expect(
      pollTransactionConfirmation(txHash, {
        server,
        timeoutMs: 5000,
        pollIntervalMs: 10,
        sleep: noopSleep,
      }),
    ).rejects.toMatchObject({
      name: 'TransactionConfirmationError',
      code: 'NETWORK_ERROR',
    });
  });

  describe('input validation', () => {
    const server: TransactionConfirmationServer = {
      getTransaction: jest.fn().mockResolvedValue({ status: 'SUCCESS' }),
    };

    it('rejects empty txHash', async () => {
      await expect(pollTransactionConfirmation('', { server })).rejects.toBeInstanceOf(
        TransactionConfirmationError,
      );
      await expect(pollTransactionConfirmation('   ', { server })).rejects.toMatchObject({
        code: 'INVALID_PARAMETERS',
      });
    });

    it('rejects non-positive or unbounded timeoutMs', async () => {
      await expect(pollTransactionConfirmation(txHash, { server, timeoutMs: 0 })).rejects.toMatchObject({
        code: 'INVALID_PARAMETERS',
      });
      await expect(pollTransactionConfirmation(txHash, { server, timeoutMs: -10 })).rejects.toMatchObject({
        code: 'INVALID_PARAMETERS',
      });
      await expect(
        pollTransactionConfirmation(txHash, { server, timeoutMs: Number.POSITIVE_INFINITY }),
      ).rejects.toMatchObject({ code: 'INVALID_PARAMETERS' });
      await expect(
        pollTransactionConfirmation(txHash, { server, timeoutMs: MAX_CONFIRMATION_TIMEOUT_MS + 1 }),
      ).rejects.toMatchObject({ code: 'INVALID_PARAMETERS' });
    });

    it('rejects invalid pollIntervalMs or pollIntervalMs > timeoutMs', async () => {
      await expect(
        pollTransactionConfirmation(txHash, { server, timeoutMs: 1000, pollIntervalMs: 0 }),
      ).rejects.toMatchObject({ code: 'INVALID_PARAMETERS' });
      await expect(
        pollTransactionConfirmation(txHash, { server, timeoutMs: 1000, pollIntervalMs: 2000 }),
      ).rejects.toMatchObject({ code: 'INVALID_PARAMETERS' });
    });

    it('rejects invalid maxAttempts', async () => {
      await expect(
        pollTransactionConfirmation(txHash, { server, timeoutMs: 1000, pollIntervalMs: 100, maxAttempts: 0 }),
      ).rejects.toMatchObject({ code: 'INVALID_PARAMETERS' });
      await expect(
        pollTransactionConfirmation(txHash, { server, timeoutMs: 1000, pollIntervalMs: 100, maxAttempts: 1.5 }),
      ).rejects.toMatchObject({ code: 'INVALID_PARAMETERS' });
    });

    it('rejects missing server and invalid serverUrl', async () => {
      await expect(pollTransactionConfirmation(txHash, { timeoutMs: 1000 })).rejects.toMatchObject({
        code: 'INVALID_PARAMETERS',
      });
      await expect(
        pollTransactionConfirmation(txHash, { timeoutMs: 1000, serverUrl: 'ftp://invalid' }),
      ).rejects.toMatchObject({ code: 'INVALID_PARAMETERS' });
    });
  });
});
