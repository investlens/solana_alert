import { describe, expect, it } from 'vitest';
import { classifyProvenWallet, walletConvergenceKey } from '../src/intelligence/provenWalletIntelligence.js';

describe('proven wallet intelligence', () => {
  it('requires repeatability rather than one large winner', () => {
    expect(classifyProvenWallet({ completedTrades: 1, winRate: 100, avgMaxReturn: 1200, bestReturn: 1200 }).proven).toBe(false);
  });

  it('promotes repeatable profitable history', () => {
    const result = classifyProvenWallet({ completedTrades: 12, winRate: 67, avgMaxReturn: 110, bestReturn: 650, realisedRoi: 90, earlyEntryRate: 60 });
    expect(result.proven).toBe(true);
    expect(result.tier).toBe('PROVEN');
  });

  it('does not call a wallet proven when realised performance is negative', () => {
    expect(classifyProvenWallet({ completedTrades: 20, winRate: 70, avgMaxReturn: 180, bestReturn: 900, realisedRoi: -15 }).proven).toBe(false);
  });

  it('normalizes convergence identities', () => {
    expect(walletConvergenceKey(' 0xABC ', ' 0xDEF ')).toBe('0xabc:0xdef');
  });
});
