import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const runtime = 'nodejs';

type Activity = {
  hash?: string;
  fromAddress?: string;
  toAddress?: string;
  value?: number;
  asset?: string;
  category?: string;
  rawContract?: { address?: string | null; decimals?: number | null };
  log?: { removed?: boolean } | null;
};

type Payload = {
  id?: string;
  type?: string;
  event?: { network?: string; activity?: Activity[] };
};

type TrackedWallet = {
  telegram_id: string;
  wallet_address: string;
  label: string | null;
};

const norm = (value: unknown) => String(value ?? '').trim().toLowerCase();
const isAddress = (value: string) => /^0x[a-f0-9]{40}$/.test(value);
const isHash = (value: string) => /^0x[a-f0-9]{64}$/.test(value);
const esc = (value: unknown) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function validSignature(raw: string, signature: string, key: string) {
  const expected = crypto.createHmac('sha256', key).update(raw, 'utf8').digest('hex');
  if (expected.length !== signature.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

function isToken(item: Activity) {
  return ['token', 'erc20'].includes(norm(item.category))
    && isAddress(norm(item.rawContract?.address));
}

function classify(wallet: string, items: Activity[]) {
  const inbound = items.filter(i => isToken(i) && norm(i.toAddress) === wallet && norm(i.fromAddress) !== wallet);
  const outbound = items.filter(i => isToken(i) && norm(i.fromAddress) === wallet && norm(i.toAddress) !== wallet);
  const spends = items.some(i => norm(i.fromAddress) === wallet && Number(i.value ?? 0) > 0);
  const receives = items.some(i => norm(i.toAddress) === wallet && Number(i.value ?? 0) > 0);

  if (inbound.length && spends) return { kind: 'BUY', item: inbound[0]!, title: '🐋 WALLET BUY' };
  if (outbound.length && receives) return { kind: 'SELL', item: outbound[0]!, title: '🔴 WALLET SELL' };
  if (inbound.length) return { kind: 'RECEIVE', item: inbound[0]!, title: '🐋 TOKEN RECEIVED' };
  if (outbound.length) return { kind: 'SEND', item: outbound[0]!, title: '🐋 TOKEN SENT' };
  return null;
}

async function reserve(args: {
  telegramId: string; wallet: string; hash: string; kind: string; token: string | null;
}) {
  const leaseToken = crypto.randomUUID();
  const { data, error } = await supabaseAdmin.rpc('reserve_wallet_activity_delivery', {
    p_telegram_id: args.telegramId,
    p_wallet_address: args.wallet,
    p_transaction_signature: args.hash,
    p_activity_type: args.kind,
    p_token_address: args.token,
    p_lease_token: leaseToken,
    p_lease_seconds: 120,
  });
  if (error) throw error;
  if (data !== true) return null;

  const { data: attached, error: attachError } = await supabaseAdmin
    .from('wallet_activity_deliveries')
    .update({
      metadata: {
        state: 'RESERVED',
        lease_token: leaseToken,
        source: 'ALCHEMY_ADDRESS_ACTIVITY',
        chain: 'robinhood',
      },
    })
    .eq('telegram_id', args.telegramId)
    .ilike('wallet_address', args.wallet)
    .eq('transaction_signature', args.hash)
    .select('id')
    .maybeSingle();
  if (attachError) throw attachError;
  if (!attached) throw new Error('Wallet delivery reservation lost');
  return leaseToken;
}

async function sendTelegram(chatId: string, text: string, token: string | null) {
  const botToken = String(process.env.TELEGRAM_BOT_TOKEN ?? '').trim();
  if (!botToken) throw new Error('TELEGRAM_BOT_TOKEN missing');
  const keyboard = token ? [[
    { text: '🔬 Full Intel', callback_data: `FI_RH_${token}` },
    { text: '📊 Dex', url: `https://dexscreener.com/robinhood/${encodeURIComponent(token)}` },
  ]] : undefined;

  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}),
    }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`Telegram HTTP ${response.status}`);
}

async function complete(args: {
  telegramId: string; wallet: string; hash: string; leaseToken: string;
  token: string | null; kind: string; symbol: string | null; value: number | null;
}) {
  const { error } = await supabaseAdmin
    .from('wallet_activity_deliveries')
    .update({
      delivered_at: new Date().toISOString(),
      metadata: {
        state: 'DELIVERED',
        source: 'ALCHEMY_ADDRESS_ACTIVITY',
        chain: 'robinhood',
        transaction_hash: args.hash,
        token_contract: args.token,
        token_symbol: args.symbol,
        normalized_token_amount: args.value,
        schema_version: 2,
      },
    })
    .eq('telegram_id', args.telegramId)
    .ilike('wallet_address', args.wallet)
    .eq('transaction_signature', args.hash)
    .contains('metadata', { lease_token: args.leaseToken });
  if (error) throw error;
}

export async function POST(request: Request) {
  const raw = await request.text();
  const key = String(process.env.ALCHEMY_WEBHOOK_SIGNING_KEY ?? '').trim();
  const signature = request.headers.get('x-alchemy-signature') ?? '';

  if (!key) return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 });
  if (!signature || !validSignature(raw, signature, key)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let payload: Payload;
  try { payload = JSON.parse(raw) as Payload; }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  if (payload.type !== 'ADDRESS_ACTIVITY') {
    return NextResponse.json({ ok: true, ignored: 'type' });
  }

  const activity = (payload.event?.activity ?? []).filter(item => item.log?.removed !== true);
  if (!activity.length) return NextResponse.json({ ok: true, delivered: 0 });

  const { data, error } = await supabaseAdmin
    .from('user_tracked_wallets')
    .select('telegram_id,wallet_address,label')
    .eq('chain', 'robinhood')
    .eq('is_active', true)
    .eq('alerts_enabled', true);
  if (error) throw error;

  const tracked = (data ?? []) as TrackedWallet[];
  const grouped = new Map<string, Activity[]>();
  for (const item of activity) {
    const hash = norm(item.hash);
    if (!isHash(hash)) continue;
    grouped.set(hash, [...(grouped.get(hash) ?? []), item]);
  }

  let delivered = 0;
  let skipped = 0;

  for (const subscriber of tracked) {
    const wallet = norm(subscriber.wallet_address);
    for (const [hash, items] of grouped) {
      if (!items.some(item => norm(item.fromAddress) === wallet || norm(item.toAddress) === wallet)) continue;
      const result = classify(wallet, items);
      if (!result) continue;

      const tokenCandidate = norm(result.item.rawContract?.address);
      const token = isAddress(tokenCandidate) ? tokenCandidate : null;
      const leaseToken = await reserve({
        telegramId: subscriber.telegram_id,
        wallet,
        hash,
        kind: result.kind,
        token,
      });
      if (!leaseToken) { skipped += 1; continue; }

      const symbol = String(result.item.asset ?? '').trim() || null;
      const value = Number.isFinite(Number(result.item.value)) ? Number(result.item.value) : null;
      const label = subscriber.label?.trim()
        || `${wallet.slice(0, 8)}…${wallet.slice(-6)}`;

      const text = [
        `<b>${result.title}</b>`,
        '',
        `Wallet: <b>${esc(label)}</b>`,
        `Action: <b>${result.kind}</b>`,
        ...(symbol ? [`Asset: <b>${esc(symbol)}</b>`] : []),
        ...(value != null ? [`Amount: <b>${value.toLocaleString(undefined, { maximumFractionDigits: 6 })}</b>`] : []),
        ...(token ? [`CA: <code>${token}</code>`] : []),
        `Tx: <code>${hash}</code>`,
      ].join('\n');

      try {
        await sendTelegram(subscriber.telegram_id, text, token);
        await complete({
          telegramId: subscriber.telegram_id,
          wallet,
          hash,
          leaseToken,
          token,
          kind: result.kind,
          symbol,
          value,
        });
        delivered += 1;
        console.log('[RobinhoodWalletWebhook] Delivered', { wallet, hash, kind: result.kind, token });
      } catch (deliveryError) {
        console.error('[RobinhoodWalletWebhook] Delivery failed', {
          wallet,
          hash,
          reason: deliveryError instanceof Error ? deliveryError.message : String(deliveryError),
        });
      }
    }
  }

  return NextResponse.json({ ok: true, delivered, skipped });
}
