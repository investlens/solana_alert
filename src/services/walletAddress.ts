import { PublicKey } from '@solana/web3.js';
import { getAddress } from 'viem';

export type WalletFamily = 'solana' | 'evm';

export type WalletAddressDetection = {
  valid: boolean;
  family: WalletFamily | null;
  normalizedAddress: string | null;
  network: null;
  liveMonitoringAvailable: boolean;
};

const invalidDetection: WalletAddressDetection = {
  valid: false,
  family: null,
  normalizedAddress: null,
  network: null,
  liveMonitoringAvailable: false,
};

export function walletFamilyHasLiveMonitoring(family: WalletFamily | string): boolean {
  return String(family).toLowerCase() === 'solana';
}

export function walletCoverageText(family: WalletFamily | string, active: boolean): string {
  return walletFamilyHasLiveMonitoring(family)
    ? `Live tracking · ${active ? 'ON' : 'PAUSED'}`
    : 'Saved wallet · Monitoring unavailable';
}

export function detectWalletAddress(value: string): WalletAddressDetection {
  const candidate = String(value ?? '').trim();
  if (!candidate || /\s/.test(candidate)) return invalidDetection;

  if (candidate.startsWith('0x') || candidate.startsWith('0X')) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(candidate)) return invalidDetection;
    try {
      return {
        valid: true,
        family: 'evm',
        normalizedAddress: getAddress(candidate),
        network: null,
        liveMonitoringAvailable: false,
      };
    } catch {
      return invalidDetection;
    }
  }

  try {
    return {
      valid: true,
      family: 'solana',
      normalizedAddress: new PublicKey(candidate).toBase58(),
      network: null,
      liveMonitoringAvailable: true,
    };
  } catch {
    return invalidDetection;
  }
}

export function requireWalletAddress(value: string): WalletAddressDetection & {
  valid: true;
  family: WalletFamily;
  normalizedAddress: string;
} {
  const result = detectWalletAddress(value);
  if (!result.valid || !result.family || !result.normalizedAddress) {
    throw new Error('Invalid public wallet address');
  }
  return result as WalletAddressDetection & {
    valid: true;
    family: WalletFamily;
    normalizedAddress: string;
  };
}
