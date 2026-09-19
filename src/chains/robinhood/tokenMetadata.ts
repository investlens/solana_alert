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
