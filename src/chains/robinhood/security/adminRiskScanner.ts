import {
  encodeFunctionData,
  getAddress,
  keccak256,
  parseAbi,
  stringToHex,
  type Address,
  type Hex,
} from 'viem';

import {
  robinhoodChain,
} from '../config.js';

import {
  robinhoodPublicClient,
} from '../rpc.js';

export type AdminRiskConfidence =
  | 'CONFIRMED'
  | 'INDICATOR'
  | 'UNKNOWN';

export type AdminRiskSignal = {
  id: string;

  label: string;

  confidence:
    AdminRiskConfidence;

  severity:
    'LOW'
    | 'MEDIUM'
    | 'HIGH'
    | 'CRITICAL';

  detected: boolean;

  details?: Record<
    string,
    unknown
  >;
};

export type RobinhoodAdminRiskResult = {
  tokenAddress: string;

  ownerAddress:
    string | null;

  ownershipReadable: boolean;

  ownershipRenounced:
    boolean | null;

  signals:
    AdminRiskSignal[];

  confirmedRiskCount: number;

  indicatorCount: number;

  scorePenalty: number;

  scannedAt: number;
};

const OWNER_ABI = parseAbi([
  'function owner() view returns (address)',
]);

const ZERO_ADDRESS =
  '0x0000000000000000000000000000000000000000';

async function rawEthCall(args: {
  address: Address;
  data: Hex;
}): Promise<Hex> {
  const rpcUrl =
    robinhoodChain.rpcUrls
      .default.http[0];

  const response =
    await fetch(rpcUrl, {
      method:
        'POST',

      headers: {
        'Content-Type':
          'application/json',
      },

      body:
        JSON.stringify({
          jsonrpc:
            '2.0',

          id:
            1,

          method:
            'eth_call',

          params: [
            {
              to:
                args.address,

              data:
                args.data,
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
      payload.error.message ??
      'Robinhood eth_call failed',
    );
  }

  if (!payload.result) {
    throw new Error(
      'Robinhood eth_call returned no result',
    );
  }

  return payload.result;
}

async function tryReadOwner(
  address: Address,
): Promise<{
  readable: boolean;
  owner: string | null;
}> {
  try {
    const data =
      encodeFunctionData({
        abi:
          OWNER_ABI,

        functionName:
          'owner',
      });

    const result =
      await rawEthCall({
        address,
        data,
      });

    /*
     * owner() returns a 32-byte ABI encoded address.
     */
    if (
      !result ||
      result === '0x' ||
      result.length < 66
    ) {
      return {
        readable:
          false,

        owner:
          null,
      };
    }

    const owner =
      `0x${result.slice(-40)}`;

    return {
      readable:
        true,

      owner:
        getAddress(owner),
    };
  } catch {
    return {
      readable:
        false,

      owner:
        null,
    };
  }
}

function functionSelector(
  signature: string,
): string {
  return keccak256(
    stringToHex(signature),
  )
    .slice(2, 10)
    .toLowerCase();
}

function bytecodeContainsSelector(
  bytecode: Hex,
  signature: string,
): boolean {
  const selector =
    functionSelector(
      signature,
    );

  return bytecode
    .toLowerCase()
    .includes(selector);
}

function indicator(args: {
  id: string;
  label: string;
  signature: string;
  severity:
    | 'LOW'
    | 'MEDIUM'
    | 'HIGH'
    | 'CRITICAL';
  bytecode: Hex;
}): AdminRiskSignal {
  const detected =
    bytecodeContainsSelector(
      args.bytecode,
      args.signature,
    );

  return {
    id:
      args.id,

    label:
      args.label,

    confidence:
      detected
        ? 'INDICATOR'
        : 'UNKNOWN',

    severity:
      args.severity,

    detected,

    details: {
      signature:
        args.signature,

      selector:
        functionSelector(
          args.signature,
        ),
    },
  };
}

export async function scanRobinhoodAdminRisk(
  tokenAddress: string,
): Promise<RobinhoodAdminRiskResult> {
  const address =
    getAddress(
      tokenAddress,
    );

  const scannedAt =
    Date.now();

  const bytecode =
    await robinhoodPublicClient
      .getCode({
        address,
      });

  if (
    !bytecode ||
    bytecode === '0x'
  ) {
    return {
      tokenAddress:
        address,

      ownerAddress:
        null,

      ownershipReadable:
        false,

      ownershipRenounced:
        null,

      signals: [],

      confirmedRiskCount:
        0,

      indicatorCount:
        0,

      scorePenalty:
        0,

      scannedAt,
    };
  }

  const ownerResult =
    await tryReadOwner(
      address,
    );

  const ownershipRenounced =
    ownerResult.readable &&
    ownerResult.owner
      ? ownerResult.owner.toLowerCase() ===
        ZERO_ADDRESS.toLowerCase()
      : null;

  const signals:
    AdminRiskSignal[] =
      [];

  /*
   * Confirmed ownership state.
   */
  if (
    ownerResult.readable &&
    ownerResult.owner
  ) {
    signals.push({
      id:
        'OWNER_READABLE',

      label:
        ownershipRenounced
          ? 'Ownership renounced'
          : 'Active owner detected',

      confidence:
        'CONFIRMED',

      severity:
        ownershipRenounced
          ? 'LOW'
          : 'MEDIUM',

      detected:
        true,

      details: {
        owner:
          ownerResult.owner,

        renounced:
          ownershipRenounced,
      },
    });
  }

  /*
   * Function selector indicators.
   *
   * Presence does NOT prove the method is
   * reachable, privileged, or malicious.
   */
  signals.push(
    indicator({
      id:
        'MINT_INDICATOR',

      label:
        'Mint capability indicator',

      signature:
        'mint(address,uint256)',

      severity:
        'HIGH',

      bytecode,
    }),

    indicator({
      id:
        'BLACKLIST_INDICATOR',

      label:
        'Blacklist control indicator',

      signature:
        'blacklist(address,bool)',

      severity:
        'HIGH',

      bytecode,
    }),

    indicator({
      id:
        'SET_BLACKLIST_INDICATOR',

      label:
        'Blacklist setter indicator',

      signature:
        'setBlacklist(address,bool)',

      severity:
        'HIGH',

      bytecode,
    }),

    indicator({
      id:
        'PAUSE_INDICATOR',

      label:
        'Pause capability indicator',

      signature:
        'pause()',

      severity:
        'HIGH',

      bytecode,
    }),

    indicator({
      id:
        'UNPAUSE_INDICATOR',

      label:
        'Unpause capability indicator',

      signature:
        'unpause()',

      severity:
        'MEDIUM',

      bytecode,
    }),

    indicator({
      id:
        'TRADING_ENABLE_INDICATOR',

      label:
        'Trading enable/disable indicator',

      signature:
        'enableTrading()',

      severity:
        'MEDIUM',

      bytecode,
    }),

    indicator({
      id:
        'MAX_TX_INDICATOR',

      label:
        'Maximum transaction control indicator',

      signature:
        'setMaxTxAmount(uint256)',

      severity:
        'MEDIUM',

      bytecode,
    }),

    indicator({
      id:
        'MAX_WALLET_INDICATOR',

      label:
        'Maximum wallet control indicator',

      signature:
        'setMaxWalletSize(uint256)',

      severity:
        'MEDIUM',

      bytecode,
    }),
  );

  const detectedIndicators =
    signals.filter(
      (signal) =>
        signal.detected &&
        signal.confidence ===
          'INDICATOR',
    );

  const confirmedRisks =
    signals.filter(
      (signal) =>
        signal.detected &&
        signal.confidence ===
          'CONFIRMED' &&
        signal.severity !==
          'LOW',
    );

  let scorePenalty = 0;

  if (
    ownerResult.readable &&
    ownerResult.owner &&
    ownershipRenounced === false
  ) {
    scorePenalty += 8;
  }

  for (
    const signal
    of detectedIndicators
  ) {
    switch (
      signal.severity
    ) {
      case 'CRITICAL':
        scorePenalty += 30;
        break;

      case 'HIGH':
        scorePenalty += 15;
        break;

      case 'MEDIUM':
        scorePenalty += 7;
        break;

      case 'LOW':
      default:
        scorePenalty += 2;
        break;
    }
  }

  scorePenalty =
    Math.min(
      70,
      scorePenalty,
    );

  return {
    tokenAddress:
      address,

    ownerAddress:
      ownerResult.owner,

    ownershipReadable:
      ownerResult.readable,

    ownershipRenounced,

    signals,

    confirmedRiskCount:
      confirmedRisks.length,

    indicatorCount:
      detectedIndicators.length,

    scorePenalty,

    scannedAt,
  };
}
