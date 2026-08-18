import {
  parseAbiItem,
} from 'viem';

import {
  supabase,
} from '../../services/supabase.js';

import {
  robinhoodPublicClient,
} from './rpc.js';

import {
  PONS_CONTRACTS,
} from './ponsContracts.js';

import {
  getPonsLaunchState,
} from './ponsLaunchState.js';

import {
  getRobinhoodMarketSnapshot,
} from './market.js';

import {
  scanRobinhoodDevHolding,
} from './security/devHoldingScanner.js';


const PONS_SHADOW_INTERVAL_MS =
  1_000;


const PONS_ACTIVE_FACTORY =
  PONS_CONTRACTS.factory;


let shadowStarted =
  false;


let shadowRunning =
  false;


let shadowInterval:
  | ReturnType<typeof setInterval>
  | null =
  null;


/*
 * IMPORTANT:
 *
 * We do NOT backfill historical launches
 * when the sniper starts.
 *
 * On startup we seed this cursor to the
 * latest block and only process launches
 * occurring after AlphaOS is online.
 *
 * Otherwise our latency measurements
 * would be meaningless.
 */
let lastScannedBlock:
  bigint | null =
  null;


const tokenLaunchedEvent =
  parseAbiItem(
    'event TokenLaunched(address indexed token, address indexed deployer, address indexed dexFactory, address pairToken, address pool, uint256 dexId, uint256 launchConfigId, uint256 positionId, uint256 restrictionsEndBlock, uint256 initialBuyAmount)',
  );


function normalize(
  value: string,
): string {
  return value
    .trim()
    .toLowerCase();
}


async function saveShadowLaunch(args: {
  tokenAddress: string;

  poolAddress:
    string | null;

  deployerAddress:
    string | null;

  launchBlock:
    bigint | null;

  restrictionsEndBlock:
    bigint | null;

  poolFee:
    number | null;

  initialBuyAmount:
    bigint | null;

  detectedAt:
    number;

  wouldBuyAt:
    number;

  detectionToGateMs:
    number;

  devHoldingPercent:
    number | null;

  devCheckMs:
    number | null;

  price:
    number | null;

  marketCap:
    number | null;

  liquidity:
    number | null;
}): Promise<void> {
  const entryPumpPercent =
    args.price != null &&
    args.price > 0
      ? 0
      : null;


  const {
    error,
  } =
    await supabase
      .from(
        'pons_shadow_trades',
      )
      .upsert(
        {
          token_address:
            normalize(
              args.tokenAddress,
            ),

          pool_address:
            args.poolAddress,

          deployer_address:
            args.deployerAddress,

          launch_block:
            args.launchBlock == null
              ? null
              : Number(
                  args.launchBlock,
                ),

          restrictions_end_block:
            args.restrictionsEndBlock == null
              ? null
              : Number(
                  args.restrictionsEndBlock,
                ),

          pool_fee:
            args.poolFee,

          initial_buy_amount_raw:
            args.initialBuyAmount == null
              ? null
              : args.initialBuyAmount
                  .toString(),

          detected_at:
            new Date(
              args.detectedAt,
            ).toISOString(),

          would_buy_at:
            new Date(
              args.wouldBuyAt,
            ).toISOString(),

          detection_to_gate_ms:
            args.detectionToGateMs,

          dev_holding_percent:
            args.devHoldingPercent,

          dev_check_ms:
            args.devCheckMs,

          /*
           * For Shadow V1 this first
           * available market snapshot is
           * our theoretical entry reference.
           *
           * Later we can replace this with
           * a direct WETH -> token quote.
           */
          launch_price:
            args.price,

          launch_market_cap:
            args.marketCap,

          launch_liquidity:
            args.liquidity,

          entry_price:
            args.price,

          entry_market_cap:
            args.marketCap,

          entry_liquidity:
            args.liquidity,

          entry_pump_percent:
            entryPumpPercent,

          peak_price:
            args.price,

          peak_roi_percent:
            0,

          shadow_status:
            'TRACKING',

          updated_at:
            new Date()
              .toISOString(),
        },
        {
          onConflict:
            'token_address',
        },
      );


  if (
    error
  ) {
    console.error(
      '[PonsShadowSniper] Save failed:',
      {
        token:
          args.tokenAddress,

        error:
          error.message,
      },
    );

    return;
  }


  console.log(
    '[PonsShadowSniper] WOULD BUY:',
    {
      token:
        args.tokenAddress,

      pool:
        args.poolAddress,

      launchBlock:
        args.launchBlock
          ?.toString() ??
        null,

      poolFee:
        args.poolFee,

      initialBuyAmount:
        args.initialBuyAmount
          ?.toString() ??
        null,

      devHolding:
        args.devHoldingPercent,

      gateMs:
        args.detectionToGateMs,

      devCheckMs:
        args.devCheckMs,

      price:
        args.price,

      marketCap:
        args.marketCap,

      liquidity:
        args.liquidity,
    },
  );
}


async function processPonsLaunch(args: {
  tokenAddress: string;

  poolAddress:
    string | null;

  eventDeployer:
    string | null;

  launchBlock:
    bigint | null;

  detectedAt:
    number;
}): Promise<void> {
  const gateStartedAt =
    Date.now();


  let launchState:
    Awaited<
      ReturnType<
        typeof getPonsLaunchState
      >
    >;


  try {
    launchState =
      await getPonsLaunchState(
        args.tokenAddress,
      );
  } catch (error) {
    console.error(
      '[PonsShadowSniper] Launch state failed:',
      {
        token:
          args.tokenAddress,

        error:
          error instanceof Error
            ? error.message
            : String(
                error,
              ),
      },
    );

    return;
  }


  if (
    !launchState.exists
  ) {
    console.log(
      '[PonsShadowSniper] Skip - launch not verified:',
      args.tokenAddress,
    );

    return;
  }


  /*
   * FAST PONS GATE.
   *
   * For Shadow V1:
   * - genuine PONS launch
   * - WETH pair
   * - valid pool fee
   *
   * We deliberately do not run the
   * generic ONCHAIN safety pipeline here.
   */
  if (
    normalize(
      launchState.pairedToken,
    ) !==
    normalize(
      PONS_CONTRACTS.weth,
    )
  ) {
    console.log(
      '[PonsShadowSniper] Skip - unexpected pair token:',
      args.tokenAddress,
    );

    return;
  }


  if (
    !Number.isFinite(
      launchState.poolFee,
    ) ||
    launchState.poolFee <= 0
  ) {
    console.log(
      '[PonsShadowSniper] Skip - invalid pool fee:',
      args.tokenAddress,
    );

    return;
  }


  /*
   * Run dev-state + market read in parallel.
   *
   * This allows us to measure whether the
   * dev check is materially slowing entry.
   */
  const devStartedAt =
    Date.now();


  const [
    devHoldingResult,
    market,
  ] =
    await Promise.all([
      scanRobinhoodDevHolding(
        args.tokenAddress,
      )
        .catch(
          () =>
            null,
        ),

      getRobinhoodMarketSnapshot(
        args.tokenAddress,
      )
        .catch(
          () =>
            null,
        ),
    ]);


  const devCheckMs =
    Date.now() -
    devStartedAt;


  /*
   * SHADOW ONLY:
   *
   * Unknown dev data does not prevent
   * recording the opportunity.
   *
   * We want to learn how often this data
   * is unavailable at launch.
   *
   * Real-money mode will use a stricter
   * policy later.
   */
  const devHoldingPercent =
    devHoldingResult
      ?.holdingPercent ??
    null;


  const wouldBuyAt =
    Date.now();


  const detectionToGateMs =
    wouldBuyAt -
    args.detectedAt;


  await saveShadowLaunch({
    tokenAddress:
      args.tokenAddress,

    poolAddress:
      args.poolAddress,

    deployerAddress:
      launchState.deployer ??
      args.eventDeployer,

    launchBlock:
      args.launchBlock,

    restrictionsEndBlock:
      launchState
        .restrictionsEndBlock,

    poolFee:
      launchState.poolFee,

    initialBuyAmount:
      launchState
        .initialBuyAmount,

    detectedAt:
      args.detectedAt,

    wouldBuyAt,

    detectionToGateMs,

    devHoldingPercent,

    devCheckMs,

    price:
      market?.priceUsd ??
      null,

    marketCap:
      market?.marketCapUsd ??
      null,

    liquidity:
      market?.liquidityUsd ??
      null,
  });
}


export async function refreshPonsShadowSniper():
Promise<void> {
  if (
    shadowRunning
  ) {
    return;
  }


  shadowRunning =
    true;


  try {
    const latestBlock =
      await robinhoodPublicClient
        .getBlockNumber();


    /*
     * First startup cycle:
     * start clean from NOW.
     */
    if (
      lastScannedBlock ==
      null
    ) {
      lastScannedBlock =
        latestBlock;


      console.log(
        '[PonsShadowSniper] Cursor seeded:',
        latestBlock.toString(),
      );


      return;
    }


    const fromBlock =
      lastScannedBlock +
      1n;


    if (
      fromBlock >
      latestBlock
    ) {
      return;
    }


    const logs =
      await robinhoodPublicClient
        .getLogs({
          address:
            PONS_ACTIVE_FACTORY,

          event:
            tokenLaunchedEvent,

          fromBlock,

          toBlock:
            latestBlock,
        });


    /*
     * Advance only after getLogs succeeds.
     */
    lastScannedBlock =
      latestBlock;


    for (
      const log
      of logs
    ) {
      const token =
        log.args.token;


      if (
        !token
      ) {
        continue;
      }


      const detectedAt =
        Date.now();


      console.log(
        '[PonsShadowSniper] NEW PONS LAUNCH:',
        {
          token,

          deployer:
            log.args.deployer ??
            null,

          pool:
            log.args.pool ??
            null,

          block:
            log.blockNumber
              ?.toString() ??
            null,

          initialBuyAmount:
            log.args
              .initialBuyAmount
              ?.toString() ??
            null,
        },
      );


      await processPonsLaunch({
        tokenAddress:
          token,

        poolAddress:
          log.args.pool ??
          null,

        eventDeployer:
          log.args.deployer ??
          null,

        launchBlock:
          log.blockNumber ??
          null,

        detectedAt,
      });
    }
  } catch (error) {
    console.error(
      '[PonsShadowSniper] Cycle failed:',
      error instanceof Error
        ? error.message
        : String(
            error,
          ),
    );
  } finally {
    shadowRunning =
      false;
  }
}


export function startPonsShadowSniper():
void {
  if (
    shadowStarted
  ) {
    console.log(
      '[PonsShadowSniper] Already started.',
    );

    return;
  }


  shadowStarted =
    true;


  console.log(
    `[PonsShadowSniper] Started. Polling every ${
      PONS_SHADOW_INTERVAL_MS
    }ms.`,
  );


  void refreshPonsShadowSniper();


  shadowInterval =
    setInterval(
      () => {
        void refreshPonsShadowSniper();
      },
      PONS_SHADOW_INTERVAL_MS,
    );
}


export function stopPonsShadowSniper():
void {
  if (
    shadowInterval
  ) {
    clearInterval(
      shadowInterval,
    );


    shadowInterval =
      null;
  }


  shadowStarted =
    false;


  console.log(
    '[PonsShadowSniper] Stopped.',
  );
}