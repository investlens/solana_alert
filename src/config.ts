import 'dotenv/config';

function must(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw == null ? fallback : Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw == null) return fallback;
  return String(raw).toLowerCase() === 'true';
}

export const config = {
  botToken: must('TELEGRAM_BOT_TOKEN'),
  ownerChatId: must('OWNER_CHAT_ID'),
  adminTelegramId: process.env.ADMIN_TELEGRAM_ID ?? must('OWNER_CHAT_ID'),

  heliusApiKey: process.env.HELIUS_API_KEY ?? '',
  watchedWallets: (process.env.WATCHED_WALLETS ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean),
  walletWatchPollMs: num('WALLET_WATCH_POLL_MS', 60_000),

  adminTradingEnabled: bool('ADMIN_TRADING_ENABLED', false),
  adminTradingPrivateKey: process.env.ADMIN_TRADING_PRIVATE_KEY ?? '',
  adminBuyAmountSmallSol: num('ADMIN_BUY_AMOUNT_SMALL_SOL', 0.03),
  adminBuyAmountDefaultSol: num('ADMIN_BUY_AMOUNT_DEFAULT_SOL', 0.05),
  adminMaxSlippageBps: num('ADMIN_MAX_SLIPPAGE_BPS', 1000),
  maxFreshWallet1dPct: num('MAX_FRESH_WALLET_1D_PCT', 50),
  freshWalletMinSample: num('FRESH_WALLET_MIN_SAMPLE', 8),
  freshWalletMinClassifiedCoveragePct: num('FRESH_WALLET_MIN_CLASSIFIED_COVERAGE_PCT', 60),

  autoTradeMode: (process.env.AUTO_TRADE_MODE ?? 'paper').toLowerCase(),
  autoTradeMaxOpenPositions: num('AUTO_TRADE_MAX_OPEN_POSITIONS', 3),

  solanaRpcUrl: process.env.SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com',
  jupiterApiKey: process.env.JUPITER_API_KEY ?? '',

  paidChatId: process.env.PAID_CHAT_ID ?? '',
  freeChatId: process.env.FREE_CHAT_ID ?? '',
  solanaPaymentWallet: process.env.SOLANA_PAYMENT_WALLET ?? '',

  discoveryChain: (process.env.DISCOVERY_CHAIN ?? 'solana').toLowerCase(),
  botVersion: process.env.BOT_VERSION ?? 'v1.1.0',

  pollMs: num('POLL_MS', 120_000),
  pumpfunPollMs: num('PUMPFUN_POLL_MS', 180_000),
  paidDelaySec: num('PAID_DELAY_SEC', 60),
  freeDelaySec: num('FREE_DELAY_SEC', 300),

  minLiqUsd: num('MIN_LIQ_USD', 8000),
  maxAgeMin: num('MAX_AGE_MIN', 90),
  minOwnerScore: num('MIN_OWNER_SCORE', 62),
  minPaidScore: num('MIN_PAID_SCORE', 70),
  minFreeScore: num('MIN_FREE_SCORE', 78),
  maxFdvToLiq: num('MAX_FDV_TO_LIQ', 40),
  min5mVolume: num('MIN_5M_VOLUME', 3000),


  dryRun: bool('DRY_RUN', false),

  freeTrialLimit: 5,
  freeTrialFastDelaySec: 60,
  freeTrialSlowDelaySec: 300,

  upgradeUrl: process.env.UPGRADE_URL ?? 'https://t.me/yourpaidchannel',

  sponsor: {
    label: process.env.SPONSOR_LABEL ?? 'PARTNER SLOT',
    title: process.env.SPONSOR_TITLE ?? '',
    text: process.env.SPONSOR_TEXT ?? '',
    url: process.env.SPONSOR_URL ?? '',
  },
};
