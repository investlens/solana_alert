import {
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  parseAbi,
  type Address,
  type Hex,
} from 'viem';

import { requestRobinhoodRpcResilient } from './rpc.js';

const TOKEN_ABI = parseAbi([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function socials() view returns (string twitter, string telegram, string discord, string website, string farcaster)',
]);

export type RobinhoodTokenMetadata = {
  address: Address;

  name: string | null;

  symbol: string | null;

  decimals: number | null;

  totalSupplyRaw: bigint | null;

  bytecodeExists: boolean;

  readErrors: string[];
};

async function rawEthCall(args: {
  address: Address;
  data: Hex;
  signal?: AbortSignal;
}): Promise<Hex> {
  return await requestRobinhoodRpcResilient({
    method: 'eth_call',
    params: [{ to: args.address, data: args.data }, 'latest'],
  }) as Hex;
}

async function rawGetCode(address: Address, _signal?: AbortSignal): Promise<Hex> {
  return await requestRobinhoodRpcResilient({
    method: 'eth_getCode',
    params: [address, 'latest'],
  }) as Hex;
}

async function readName(
  address: Address,
  signal?: AbortSignal,
): Promise<string> {
  const data =
    encodeFunctionData({
      abi: TOKEN_ABI,
      functionName: 'name',
    });

  const result =
    await rawEthCall({
      address,
      data,
      signal,
    });

  return decodeFunctionResult({
    abi: TOKEN_ABI,
    functionName: 'name',
    data: result,
  });
}

async function readSymbol(
  address: Address,
  signal?: AbortSignal,
): Promise<string> {
  const data =
    encodeFunctionData({
      abi: TOKEN_ABI,
      functionName: 'symbol',
    });

  const result =
    await rawEthCall({
      address,
      data,
      signal,
    });

  return decodeFunctionResult({
    abi: TOKEN_ABI,
    functionName: 'symbol',
    data: result,
  });
}

async function readDecimals(
  address: Address,
  signal?: AbortSignal,
): Promise<number> {
  const data =
    encodeFunctionData({
      abi: TOKEN_ABI,
      functionName: 'decimals',
    });

  const result =
    await rawEthCall({
      address,
      data,
      signal,
    });

  return Number(
    decodeFunctionResult({
      abi: TOKEN_ABI,
      functionName: 'decimals',
      data: result,
    }),
  );
}

async function readTotalSupply(
  address: Address,
  signal?: AbortSignal,
): Promise<bigint> {
  const data =
    encodeFunctionData({
      abi: TOKEN_ABI,
      functionName: 'totalSupply',
    });

  const result =
    await rawEthCall({
      address,
      data,
      signal,
    });

  return decodeFunctionResult({
    abi: TOKEN_ABI,
    functionName: 'totalSupply',
    data: result,
  });
}

function errorMessage(
  error: unknown,
): string {
  return error instanceof Error
    ? error.message
    : String(error);
}

export async function getRobinhoodTokenMetadata(
  tokenAddress: string,
  options: { signal?: AbortSignal } = {},
): Promise<RobinhoodTokenMetadata> {
  const address =
    getAddress(tokenAddress);

  const bytecode = await rawGetCode(address, options.signal);

  const bytecodeExists =
    Boolean(
      bytecode &&
      bytecode !== '0x',
    );

  if (!bytecodeExists) {
    return {
      address,

      name: null,

      symbol: null,

      decimals: null,

      totalSupplyRaw: null,

      bytecodeExists: false,

      readErrors: [
        'No contract bytecode found',
      ],
    };
  }

  const [
    nameResult,
    symbolResult,
    decimalsResult,
    supplyResult,
  ] = await Promise.allSettled([
    readName(address, options.signal),
    readSymbol(address, options.signal),
    readDecimals(address, options.signal),
    readTotalSupply(address, options.signal),
  ]);

  const readErrors:
    string[] = [];

  if (
    nameResult.status ===
    'rejected'
  ) {
    readErrors.push(
      `name(): ${errorMessage(
        nameResult.reason,
      )}`,
    );
  }

  if (
    symbolResult.status ===
    'rejected'
  ) {
    readErrors.push(
      `symbol(): ${errorMessage(
        symbolResult.reason,
      )}`,
    );
  }

  if (
    decimalsResult.status ===
    'rejected'
  ) {
    readErrors.push(
      `decimals(): ${errorMessage(
        decimalsResult.reason,
      )}`,
    );
  }

  if (
    supplyResult.status ===
    'rejected'
  ) {
    readErrors.push(
      `totalSupply(): ${errorMessage(
        supplyResult.reason,
      )}`,
    );
  }

  return {
    address,

    name:
      nameResult.status ===
      'fulfilled'
        ? nameResult.value
        : null,

    symbol:
      symbolResult.status ===
      'fulfilled'
        ? symbolResult.value
        : null,

    decimals:
      decimalsResult.status ===
      'fulfilled'
        ? decimalsResult.value
        : null,

    totalSupplyRaw:
      supplyResult.status ===
      'fulfilled'
        ? supplyResult.value
        : null,

    bytecodeExists: true,

    readErrors,
  };
}


export type RobinhoodTokenSocials = {
  twitter: string | null;
  telegram: string | null;
  website: string | null;
};

const socialsCache = new Map<string, { expiresAt: number; value: RobinhoodTokenSocials }>();

function safeProjectUrl(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw.startsWith('http://') || raw.startsWith('https://') ? raw : `https://${raw}`);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch { return null; }
}

export async function getRobinhoodTokenSocials(tokenAddress: string): Promise<RobinhoodTokenSocials> {
  const address = getAddress(tokenAddress);
  const key = address.toLowerCase();
  const cached = socialsCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  let value: RobinhoodTokenSocials = { twitter: null, telegram: null, website: null };
  try {
    const data = encodeFunctionData({ abi: TOKEN_ABI, functionName: 'socials' });
    const result = await rawEthCall({ address, data });
    const decoded = decodeFunctionResult({ abi: TOKEN_ABI, functionName: 'socials', data: result }) as readonly [string, string, string, string, string];
    value = {
      twitter: safeProjectUrl(decoded[0]),
      telegram: safeProjectUrl(decoded[1]),
      website: safeProjectUrl(decoded[3]),
    };
  } catch {
    // Social metadata is optional and must never block an opportunity alert.
  }
  socialsCache.set(key, { expiresAt: Date.now() + 30 * 60_000, value });
  if (socialsCache.size > 2_000) {
    const oldest = socialsCache.keys().next().value;
    if (oldest) socialsCache.delete(oldest);
  }
  return value;
}
