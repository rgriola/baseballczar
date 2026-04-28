import { describe, it, expect, vi } from 'vitest';
import { checkBudget, safeDebit, safeCredit } from '@/lib/finance/budget';

// Minimal mock for SupabaseClient
function createMockSupabase(overrides: Record<string, unknown> = {}) {
  const mockSingle = vi.fn();
  const mockEq = vi.fn().mockReturnValue({ single: mockSingle });
  const mockSelect = vi.fn().mockReturnValue({ eq: mockEq });
  const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });
  const mockRpc = vi.fn();

  return {
    client: { from: mockFrom, rpc: mockRpc } as unknown as Parameters<typeof checkBudget>[0],
    mockFrom,
    mockSelect,
    mockEq,
    mockSingle,
    mockRpc,
    ...overrides,
  };
}

describe('checkBudget', () => {
  it('returns ok: true when balance >= cost', async () => {
    const { client, mockSingle } = createMockSupabase();
    mockSingle.mockResolvedValue({ data: { balance: 50000 }, error: null });

    const result = await checkBudget(client, 1, 30000);
    expect(result).toEqual({ ok: true, balance: 50000, shortfall: 0 });
  });

  it('returns ok: false when balance < cost', async () => {
    const { client, mockSingle } = createMockSupabase();
    mockSingle.mockResolvedValue({ data: { balance: 10000 }, error: null });

    const result = await checkBudget(client, 1, 30000);
    expect(result).toEqual({ ok: false, balance: 10000, shortfall: 20000 });
  });

  it('treats missing budget row as 0 balance', async () => {
    const { client, mockSingle } = createMockSupabase();
    mockSingle.mockResolvedValue({ data: null, error: null });

    const result = await checkBudget(client, 1, 100);
    expect(result).toEqual({ ok: false, balance: 0, shortfall: 100 });
  });
});

describe('safeDebit', () => {
  it('returns new balance on success', async () => {
    const { client, mockRpc } = createMockSupabase();
    mockRpc.mockResolvedValue({ data: 45000, error: null });

    const balance = await safeDebit(client, 1, 5000, 'test', 'Test debit');
    expect(balance).toBe(45000);
    expect(mockRpc).toHaveBeenCalledWith('safe_debit', {
      p_team_id: 1,
      p_amount: 5000,
      p_type: 'test',
      p_desc: 'Test debit',
      p_ref_id: null,
    });
  });

  it('throws on insufficient funds (data === -1)', async () => {
    const { client, mockRpc } = createMockSupabase();
    mockRpc.mockResolvedValue({ data: -1, error: null });

    await expect(safeDebit(client, 1, 999999, 'test', 'Too much'))
      .rejects.toThrow('Insufficient funds');
  });

  it('throws on RPC error', async () => {
    const { client, mockRpc } = createMockSupabase();
    mockRpc.mockResolvedValue({ data: null, error: { message: 'DB error' } });

    await expect(safeDebit(client, 1, 100, 'test', 'Fail'))
      .rejects.toThrow('safe_debit failed: DB error');
  });
});

describe('safeCredit', () => {
  it('returns new balance on success', async () => {
    const { client, mockRpc } = createMockSupabase();
    mockRpc.mockResolvedValue({ data: 55000, error: null });

    const balance = await safeCredit(client, 1, 5000, 'revenue', 'Game revenue');
    expect(balance).toBe(55000);
    expect(mockRpc).toHaveBeenCalledWith('safe_credit', {
      p_team_id: 1,
      p_amount: 5000,
      p_type: 'revenue',
      p_desc: 'Game revenue',
      p_ref_id: null,
    });
  });

  it('passes referenceId when provided', async () => {
    const { client, mockRpc } = createMockSupabase();
    mockRpc.mockResolvedValue({ data: 60000, error: null });

    await safeCredit(client, 2, 1000, 'test', 'With ref', 42);
    expect(mockRpc).toHaveBeenCalledWith('safe_credit', {
      p_team_id: 2,
      p_amount: 1000,
      p_type: 'test',
      p_desc: 'With ref',
      p_ref_id: 42,
    });
  });
});
