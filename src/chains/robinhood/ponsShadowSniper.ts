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


/*
 * PONS V1
 *
 * Existing V1 factory.
 */
const PONS_V1_FACTORY =
  PONS_CONTRACTS.factory;


/*
 * PONS V2
 *
 * IMPORTANT:
 *
 * We proved from a fresh launch transaction
 * that THIS contract emits the live V2
 * TokenLaunched event.
 *
 * This is intentionally NOT the old
 * 0x7E1E... contract we tested earlier.
 */
const PONS_V2_LIVE_EMITTER =
  '0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e' as const;


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
 * V1 and V2 have independent cursors.
 *
 * On startup both are seeded to the
 * current block.
 *
 * We deliberately do NOT backfill.
 *
 * This preserves genuine detection
 * latency measurements.
 */
let lastV1ScannedBlock:
  bigint | null =
  null;


let lastV2ScannedBlock:
  bigint | null =
  null;


/*
 * PONS V1 TokenLaunched event.
 */
const tokenLaunchedV1Event =
  parseAbiItem(
    'event TokenLaunched(address indexed token, address indexed deployer, address indexed dexFactory, address pairToken, address pool, uint256 dexId, uint256 launchConfigId, uint256 positionId, uint256 restrictionsEndBlock, uint256 initialBuyAmount)',
  );


/*
 * PONS V2 TokenLaunched event.
 *
 * Proven from a genuinely fresh
 * PONS launch receipt.
 */
const tokenLaunchedV2Event =
  parseAbiItem(
    'event TokenLaunched(address indexed token, address indexed curve, address indexed deployer, address pairToken, uint256 launchConfigId, uint256 graduationThreshold)',
  );


function normalize(
  value: string,
): string {
  return value
    .trim()
    .toLowerCase();
}


type SaveShadowLaunchArgs = {
  launchVersion:
    'V1' |
    'V2';

  tokenAddress:
    string;

  poolAddress:
    string | null;

  curveAddress:
    string | null;

  pairTokenAddress:
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

  graduationThreshold:
    bigint | null;

  launchTxHash:
    string | null;

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
};


async function saveShadowLaunch(
  args:
    SaveShadowLaunchArgs,
): Promise<void> {
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

          launch_version:
            args.launchVersion,

          pool_address:
            args.poolAddress,

          curve_address:
            args.curveAddress,

          pair_token_address:
            args.pairTokenAddress,

          deployer_address:
            args.deployerAddress,

          launch_block:
            args.launchBlock ==
            null
              ? null
              : Number(
                  args.launchBlock,
                ),

          restrictions_end_block:
            args
              .restrictionsEndBlock ==
            null
              ? null
              : Number(
                  args
                    .restrictionsEndBlock,
                ),

          pool_fee:
            args.poolFee,

          initial_buy_amount_raw:
            args.initialBuyAmount ==
            null
              ? null
              : args
                  .initialBuyAmount
                  .toString(),

          graduation_threshold_raw:
            args.graduationThreshold ==
            null
              ? null
              : args
                  .graduationThreshold
                  .toString(),

          launch_tx_hash:
            args.launchTxHash,

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
           * Shadow entry reference.
           *
           * For V1 this should normally
           * be available quickly.
           *
           * For V2 the market/indexer may
           * still be unavailable at the
           * exact launch moment.
           *
           * The outcome tracker already
           * has late-entry-reference logic.
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
        version:
          args.launchVersion,

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
      version:
        args.launchVersion,

      token:
        args.tokenAddress,

      pool:
        args.poolAddress,

      curve:
        args.curveAddress,

      pairToken:
        args.pairTokenAddress,

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

      graduationThreshold:
        args.graduationThreshold
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

      tx:
        args.launchTxHash,
    },
  );
}


/*
 * =====================================================
 * PONS V1 PROCESSOR
 * =====================================================
 */
async function processPonsV1Launch(args: {
  tokenAddress:
    string;

  poolAddress:
    string | null;

  eventDeployer:
    string | null;

  pairTokenAddress:
    string | null;

  launchBlock:
    bigint | null;

  launchTxHash:
    string | null;

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
      '[PonsShadowSniper][V1] Launch state failed:',
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
      '[PonsShadowSniper][V1] Skip - launch not verified:',
      args.tokenAddress,
    );

    return;
  }


  /*
   * V1 fast safety gate.
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
      '[PonsShadowSniper][V1] Skip - unexpected pair token:',
      {
        token:
          args.tokenAddress,

        pairToken:
          launchState.pairedToken,
      },
    );

    return;
  }


  if (
    !Number.isFinite(
      launchState.poolFee,
    ) ||
    launchState.poolFee <=
      0
  ) {
    console.log(
      '[PonsShadowSniper][V1] Skip - invalid pool fee:',
      args.tokenAddress,
    );

    return;
  }


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


  const devHoldingPercent =
    devHoldingResult
      ?.holdingPercent ??
    null;


  const wouldBuyAt =
    Date.now();


  const detectionToGateMs =
    wouldBuyAt -
    args.detectedAt;


  console.log(
    '[PonsShadowSniper][V1] Gate complete:',
    {
      token:
        args.tokenAddress,

      gateMs:
        Date.now() -
        gateStartedAt,
    },
  );


  await saveShadowLaunch({
    launchVersion:
      'V1',

    tokenAddress:
      args.tokenAddress,

    poolAddress:
      args.poolAddress,

    curveAddress:
      null,

    pairTokenAddress:
      launchState.pairedToken ??
      args.pairTokenAddress,

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

    graduationThreshold:
      null,

    launchTxHash:
      args.launchTxHash,

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
      market
        ?.marketCapUsd ??
      null,

    liquidity:
      market
        ?.liquidityUsd ??
      null,
  });
}


/*
 * =====================================================
 * PONS V2 PROCESSOR
 * =====================================================
 *
 * IMPORTANT:
 *
 * V2 is curve-based.
 *
 * Do NOT run V2 through:
 *
 * - getPonsLaunchState()
 * - V1 poolFee checks
 * - V1 PONS sellability assumptions
 *
 * Those belong to V1.
 */
async function processPonsV2Launch(args: {
  tokenAddress:
    string;

  curveAddress:
    string | null;

  eventDeployer:
    string | null;

  pairTokenAddress:
    string | null;

  graduationThreshold:
    bigint | null;

  launchBlock:
    bigint | null;

  launchTxHash:
    string | null;

  detectedAt:
    number;
}): Promise<void> {
  const gateStartedAt =

  
    Date.now();


  /*
   * For the first V2 shadow version we
   * intentionally keep the gate extremely
   * small.
   *
   * We already know:
   *
   * 1. the event came from the proven
   *    PONS V2 live emitter
   *
   * 2. the event supplied the real curve
   *    and deployer
   *
   * We therefore record the launch first
   * and learn from it rather than waiting
   * for V1-specific scanners.
   */


  let market:
    Awaited<
      ReturnType<
        typeof getRobinhoodMarketSnapshot
      >
    > | null =
    null;

const wouldBuyAt =
  Date.now();


const detectionToGateMs =
  wouldBuyAt -
  args.detectedAt;


  const marketStartedAt =
    Date.now();


  try {
    market =
      await getRobinhoodMarketSnapshot(
        args.tokenAddress,
      );
  } catch {
    /*
     * Totally acceptable for V2 launch.
     *
     * Dex/indexer market data may not exist
     * yet at the exact launch moment.
     *
     * Outcome tracker can establish the
     * first later entry reference.
     */
    market =
      null;
  }


  const marketCheckMs =
    Date.now() -
    marketStartedAt;


  console.log(
    '[PonsShadowSniper][V2] Gate complete:',
    {
      token:
        args.tokenAddress,

      curve:
        args.curveAddress,

      deployer:
        args.eventDeployer,

      pairToken:
        args.pairTokenAddress,

      marketAvailable:
        Boolean(
          market?.priceUsd,
        ),

      marketCheckMs,

      gateMs:
        Date.now() -
        gateStartedAt,
    },
  );


  await saveShadowLaunch({
    launchVersion:
      'V2',

    tokenAddress:
      args.tokenAddress,

    /*
     * V2 has no V1 Uniswap pool at launch.
     */
    poolAddress:
      null,

    curveAddress:
      args.curveAddress,

    pairTokenAddress:
      args.pairTokenAddress,

    deployerAddress:
      args.eventDeployer,

    launchBlock:
      args.launchBlock,

    restrictionsEndBlock:
      null,

    poolFee:
      null,

    initialBuyAmount:
      null,

    graduationThreshold:
      args.graduationThreshold,

    launchTxHash:
      args.launchTxHash,

    detectedAt:
      args.detectedAt,

    wouldBuyAt,

    detectionToGateMs,

    /*
     * V2 dev tracking will be added using
     * the V2-native balance/curve path.
     *
     * Do not fake this with the V1 scanner.
     */
    devHoldingPercent:
      null,

    devCheckMs:
      null,

    price:
      market?.priceUsd ??
      null,

    marketCap:
      market
        ?.marketCapUsd ??
      null,

    liquidity:
      market
        ?.liquidityUsd ??
      null,
  });
}


/*
 * =====================================================
 * V1 SCANNER
 * =====================================================
 */
async function scanPonsV1(args: {
  fromBlock:
    bigint;

  toBlock:
    bigint;
}): Promise<void> {
  const logs =
    await robinhoodPublicClient
      .getLogs({
        address:
          PONS_V1_FACTORY,

        event:
          tokenLaunchedV1Event,

        fromBlock:
          args.fromBlock,

        toBlock:
          args.toBlock,
      });


  if (
    logs.length >
    0
  ) {
    console.log(
      '[PonsShadowSniper][V1] Launches found:',
      logs.length,
    );
  }


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
      '[PonsShadowSniper] NEW PONS V1 LAUNCH:',
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

        tx:
          log.transactionHash ??
          null,
      },
    );


    await processPonsV1Launch({
      tokenAddress:
        token,

      poolAddress:
        log.args.pool ??
        null,

      eventDeployer:
        log.args.deployer ??
        null,

      pairTokenAddress:
        log.args.pairToken ??
        null,

      launchBlock:
        log.blockNumber ??
        null,

      launchTxHash:
        log.transactionHash ??
        null,

      detectedAt,
    });
  }
}


/*
 * =====================================================
 * V2 SCANNER
 * =====================================================
 */
async function scanPonsV2(args: {
  fromBlock:
    bigint;

  toBlock:
    bigint;
}): Promise<void> {
  const logs =
    await robinhoodPublicClient
      .getLogs({
        address:
          PONS_V2_LIVE_EMITTER,

        event:
          tokenLaunchedV2Event,

        fromBlock:
          args.fromBlock,

        toBlock:
          args.toBlock,
      });


  if (
    logs.length >
    0
  ) {
    console.log(
      '[PonsShadowSniper][V2] Launches found:',
      logs.length,
    );
  }


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
      '[PonsShadowSniper] 🚀 NEW PONS V2 LAUNCH:',
      {
        token,

        curve:
          log.args.curve ??
          null,

        deployer:
          log.args.deployer ??
          null,

        pairToken:
          log.args.pairToken ??
          null,

        launchConfigId:
          log.args
            .launchConfigId
            ?.toString() ??
          null,

        graduationThreshold:
          log.args
            .graduationThreshold
            ?.toString() ??
          null,

        block:
          log.blockNumber
            ?.toString() ??
          null,

        tx:
          log.transactionHash ??
          null,
      },
    );


    await processPonsV2Launch({
      tokenAddress:
        token,

      curveAddress:
        log.args.curve ??
        null,

      eventDeployer:
        log.args.deployer ??
        null,

      pairTokenAddress:
        log.args.pairToken ??
        null,

      graduationThreshold:
        log.args
          .graduationThreshold ??
        null,

      launchBlock:
        log.blockNumber ??
        null,

      launchTxHash:
        log.transactionHash ??
        null,

      detectedAt,
    });
  }
}


/*
 * =====================================================
 * MAIN 1-SECOND REFRESH
 * =====================================================
 */
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
     *
     * seed BOTH independent cursors
     * to NOW.
     */
    if (
      lastV1ScannedBlock ==
        null ||
      lastV2ScannedBlock ==
        null
    ) {
      lastV1ScannedBlock =
        latestBlock;

      lastV2ScannedBlock =
        latestBlock;


      console.log(
        '[PonsShadowSniper] V1 cursor seeded:',
        latestBlock
          .toString(),
      );


      console.log(
        '[PonsShadowSniper] V2 cursor seeded:',
        latestBlock
          .toString(),
      );


      return;
    }


    const v1FromBlock =
      lastV1ScannedBlock +
      1n;


    const v2FromBlock =
      lastV2ScannedBlock +
      1n;


    /*
     * Scan independently.
     *
     * If one source fails, the other
     * source must still keep working.
     */
    if (
      v1FromBlock <=
      latestBlock
    ) {
      try {
        await scanPonsV1({
          fromBlock:
            v1FromBlock,

          toBlock:
            latestBlock,
        });


        /*
         * Advance V1 cursor only after
         * its scan succeeds.
         */
        lastV1ScannedBlock =
          latestBlock;
      } catch (error) {
        console.error(
          '[PonsShadowSniper][V1] Scan failed:',
          error instanceof Error
            ? error.message
            : String(
                error,
              ),
        );
      }
    }


    if (
      v2FromBlock <=
      latestBlock
    ) {
      try {
        await scanPonsV2({
          fromBlock:
            v2FromBlock,

          toBlock:
            latestBlock,
        });


        /*
         * Advance V2 cursor only after
         * its scan succeeds.
         */
        lastV2ScannedBlock =
          latestBlock;
      } catch (error) {
        console.error(
          '[PonsShadowSniper][V2] Scan failed:',
          error instanceof Error
            ? error.message
            : String(
                error,
              ),
        );
      }
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
    `[PonsShadowSniper] Started. Polling V1 + V2 every ${
      PONS_SHADOW_INTERVAL_MS
    }ms.`,
  );


  console.log(
    '[PonsShadowSniper] V1 factory:',
    PONS_V1_FACTORY,
  );


  console.log(
    '[PonsShadowSniper] V2 live emitter:',
    PONS_V2_LIVE_EMITTER,
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