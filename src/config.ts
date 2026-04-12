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
  paidChatId: process.env.PAID_CHAT_ID ?? '',
    adminTelegramId: process.env.ADMIN_TELEGRAM_ID ?? must('OWNER_CHAT_ID'),
  solanaPaymentWallet: process.env.SOLANA_PAYMENT_WALLET ?? '',
  freeChatId: process.env.FREE_CHAT_ID ?? '',
  discoveryChain: (process.env.DISCOVERY_CHAIN ?? 'solana').toLowerCase(),
  botVersion: process.env.BOT_VERSION ?? 'v1.1.0',
  pollMs: num('POLL_MS', 20_000),
  paidDelaySec: num('PAID_DELAY_SEC', 60),
  freeDelaySec: num('FREE_DELAY_SEC', 300),
  minLiqUsd: num('MIN_LIQ_USD', 8000),
  maxAgeMin: num('MAX_AGE_MIN', 10),
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
