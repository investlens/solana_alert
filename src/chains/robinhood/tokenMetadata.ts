import {
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  parseAbi,
  type Address,
  type Hex,
} from 'viem';

import {
  robinhoodPublicClient,
} from './rpc.js';

import {
  robinhoodChain,
} from './config.js';

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
}): Promise<Hex> {
  const rpcUrl =
    robinhoodChain.rpcUrls.default.http[0];

  const response =
    await fetch(rpcUrl, {
      method: 'POST',

      headers: {
        'Content-Type':
          'application/json',
      },

      body: JSON.stringify({
        jsonrpc: '2.0',

        id: 1,

        method: 'eth_call',

        params: [
          {
            to: args.address,
            data: args.data,
          },

          'latest',
        ],
      }),
    });

  if (!response.ok) {
    throw new Error(
      `Robinhood eth_call HTTP ${response.status}`,
    );
  }

  const payload =
    await response.json() as {
      result?: Hex;

      error?: {
        code?: number;
        message?: string;
      };
    };

  if (payload.error) {
    throw new Error(
      `Robinhood eth_call failed: ` +
      `${payload.error.code ?? ''} ` +
      `${payload.error.message ?? 'Unknown RPC error'}`,
    );
  }

  if (!payload.result) {
    throw new Error(
      'Robinhood eth_call returned no result',
    );
  }

  return payload.result;
}

async function readName(
  address: Address,
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
    });

  return decodeFunctionResult({
    abi: TOKEN_ABI,
    functionName: 'name',
    data: result,
  });
}

async function readSymbol(
  address: Address,
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
    });

  return decodeFunctionResult({
    abi: TOKEN_ABI,
    functionName: 'symbol',
    data: result,
  });
}

async function readDecimals(
  address: Address,
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
): Promise<RobinhoodTokenMetadata> {
  const address =
    getAddress(tokenAddress);

  const bytecode =
    await robinhoodPublicClient
      .getCode({
        address,
      });

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
    readName(address),
    readSymbol(address),
    readDecimals(address),
    readTotalSupply(address),
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
