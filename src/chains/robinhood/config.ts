import {
  defineChain,
} from 'viem';

const OFFICIAL_PUBLIC_RPC = 'https://rpc.mainnet.chain.robinhood.com';
const PUBLICNODE_RPC = 'https://robinhood-rpc.publicnode.com';

function robinhoodRpcUrls(): string[] {
  const configured = String(process.env.ROBINHOOD_RPC_URL ?? '').trim();
  const fallback = String(process.env.ROBINHOOD_RPC_FALLBACK_URL ?? PUBLICNODE_RPC).trim();

  return [...new Set([
    configured,
    fallback,
    OFFICIAL_PUBLIC_RPC,
  ].filter(Boolean))];
}

const rpcHttpUrls = robinhoodRpcUrls();

export const robinhoodChain =
  defineChain({
    id: 4663,

    name: 'Robinhood Chain',

    nativeCurrency: {
      name: 'Ether',
      symbol: 'ETH',
      decimals: 18,
    },

    rpcUrls: {
      default: {
        http: rpcHttpUrls,
      },

      public: {
        http: rpcHttpUrls,
      },
    },

    blockExplorers: {
      default: {
        name: 'Robinhood Chain Blockscout',
        url:
          'https://robinhoodchain.blockscout.com',
      },
    },
  });
