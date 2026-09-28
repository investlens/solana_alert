import { defineChain } from 'viem';

const OFFICIAL_ARC_RPC = 'https://rpc.mainnet.arc.io';

function arcRpcUrls(): string[] {
  const configured = String(process.env.ARC_RPC_URL ?? '').trim();
  const fallback = String(process.env.ARC_RPC_FALLBACK_URL ?? '').trim();
  return [...new Set([configured, fallback, OFFICIAL_ARC_RPC].filter(Boolean))];
}

const rpcHttpUrls = arcRpcUrls();

export const arcChain = defineChain({
  id: 5042,
  name: 'Arc',
  nativeCurrency: {
    name: 'USDC',
    symbol: 'USDC',
    decimals: 18,
  },
  rpcUrls: {
    default: { http: rpcHttpUrls },
    public: { http: rpcHttpUrls },
  },
  blockExplorers: {
    default: {
      name: 'Arc Explorer',
      url: 'https://explorer.arc.io',
    },
  },
});

export const ARC_USDC_ADDRESS = '0x3600000000000000000000000000000000000000' as const;
