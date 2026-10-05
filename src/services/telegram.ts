import { cleanAlertCard, cleanAlertButtons } from '../ui/alertCardLayout.js';
import { withResearchDisclosure } from '../ui/researchDisclosure.js';
import { buildAlphaosAlertCard } from '../ui/alphaosAlertCard.js';
import { sendAlphaosPhotoAlert, telegramCaptionLength } from '../ui/alphaosPhotoDelivery.js';
import { config } from '../config.js';

export type InlineButton = {
  text: string;
  url?: string;
  callback_data?: string;
};

export type AlphaAlertLinks = {
  tokenMint?: string | null;
  reportUrl?: string | null;
  chartUrl?: string | null;
  buyUrl?: string | null;
  pumpfunUrl?: string | null;
};

function safeUrl(value?: string | null): string | null {
  const url = String(value ?? '').trim();
  if (!/^https:\/\//i.test(url)) return null;
  return url;
}

export function buildAlphaAlertButtons(links: AlphaAlertLinks): InlineButton[][] {
  const rows: InlineButton[][] = [];
  const report = safeUrl(links.reportUrl);
  const chart = safeUrl(links.chartUrl);
  const buy = safeUrl(links.buyUrl);
  const pump = safeUrl(links.pumpfunUrl) || (links.tokenMint ? `https://pump.fun/${links.tokenMint}` : null);

  if (report) rows.push([{ text: '🔍 Open AI Investigation', url: report }]);

  const marketRow: InlineButton[] = [];
  if (chart) marketRow.push({ text: '📈 Live Chart', url: chart });
  if (pump) marketRow.push({ text: '🚀 Pump.fun', url: pump });
  if (marketRow.length) rows.push(marketRow);

  if (buy) rows.push([{ text: '⚡ Open Trading Route', url: buy }]);
  return rows;
}

export function buildAlphaReportUrl(tokenMint: string, context?: { engine?: string; event?: string }): string | null {
  const base = String(process.env.ALPHAOS_WEB_URL || process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '');
  if (!base || !tokenMint) return null;
  const params = new URLSearchParams({ source: 'telegram' });
  if (context?.engine) params.set('engine', context.engine);
  if (context?.event) params.set('event', context.event);
  return `${base}/report/${encodeURIComponent(tokenMint)}?${params.toString()}`;
}

async function sendTelegramRequest(chatId: string, text: string, buttons?: InlineButton[][]): Promise<number | null> {
  if (!chatId) return null;
  text = cleanAlertCard(text);
  if (/DEX PAID DETECTED|BOOST DETECTED|BOOST INCREASED|MAX BOOST 500\+|ARC OPPORTUNITY|TRADE SETUP WATCH|SUPPLY BURN|SOCIAL MAFIA ALERT/.test(text.split('\n')[0])) text = withResearchDisclosure(text);
  if (/<code>/.test(text)) buttons = cleanAlertButtons(buttons, text);

  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  };

  if (buttons?.length) body.reply_markup = { inline_keyboard: buttons };

  if (config.dryRun) {
    console.log(`\n--- MESSAGE TO ${chatId} ---\n${text}\nButtons: ${JSON.stringify(buttons ?? [])}\n---------------------------\n`);
    return null;
  }

  // Only bounded market cards become photos; interactive screens stay as text.
  // Images exist in memory only. The caption stays within Telegram's limit.
  const category = text.match(/(?:DEX PAID DETECTED|BOOST DETECTED|BOOST INCREASED|MAX BOOST 500\+|ARC OPPORTUNITY|TRADE SETUP WATCH|SUPPLY BURN|SOCIAL MAFIA ALERT)/)?.[0];
  if (category && telegramCaptionLength(text) <= 1024) {
    const ticker = text.match(/<b>\$([A-Za-z_][A-Za-z0-9_]{0,23})\b/)?.[1] ?? text.match(/\(\$([A-Za-z_][A-Za-z0-9_]{0,23})\)<\/b>/)?.[1];
    const identityName = text.match(/<b>\$[^<]+<\/b> · ([^\n]+)/)?.[1] ?? text.match(/<b>([^<\n]+) \(\$[^)]+\)<\/b>/)?.[1];
    const name = identityName?.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    const image = await buildAlphaosAlertCard({ symbol: ticker, name, category,
      chainLabel: /ARC OPPORTUNITY/.test(category) ? 'ARC' : 'ALPHAOS / TOKEN RESEARCH',
      badge: 'INFORMATION / DYOR', footer: 'Promotion and market activity do not establish token safety.' }).catch(() => null);
    return (await sendAlphaosPhotoAlert({ botToken: config.botToken, chatId, text,
      keyboard: buttons ?? [], image })).messageId;
  }

  const res = await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    throw new Error(`Telegram send failed: ${res.status} ${bodyText}`);
  }
  const payload = await res.json() as { result?: { message_id?: number } };
  return Number.isFinite(Number(payload.result?.message_id)) ? Number(payload.result?.message_id) : null;
}

export async function sendTelegram(chatId: string, text: string, buttons?: InlineButton[][]): Promise<void> {
  await sendTelegramRequest(chatId, text, buttons);
}

export async function sendTelegramWithMessageId(chatId: string, text: string,
  buttons?: InlineButton[][]): Promise<number | null> {
  return sendTelegramRequest(chatId, text, buttons);
}

export async function editTelegramMessage(chatId: string, messageId: number, text: string,
  buttons?: InlineButton[][]): Promise<void> {
  if (!chatId || !Number.isFinite(messageId)) return;
  text = cleanAlertCard(text);
  if (/<…13141 tokens truncated…xValuation: spurdoValuation(),
      devHoldingEvidence: 'VERIFIED', devHoldingPercent: 0,
      burnEvidence: 'VERIFIED', totalBurnPercent: 0,
      otherDevTransferPercent: 3.62, devFlowEvidenceStatus: 'COMPLETE',
    }, spurdoAddress),
    recommended_action: 'EXIT', confidence: 80, risk_score: 90,
  };
  const target: TokenOpenTarget = {
    tokenUrl: `https://robinhoodchain.blockscout.com/token/${spurdoAddress}`,
    tokenSource: 'blockscout',
  };
  const message = buildOpportunityMessage(exit);
  assert.match(message, /<b>SPURDO<\/b>/);
  assert.match(message, /FDV\s+<b>\$4\.(?:58|6)K<\/b>/);
  assert.doesNotMatch(message, /Dev holding|Burned/);
  assert.doesNotMatch(message, /Market INDEXING|Market cap|Liquidity|5m volume/);

  const buttons = buildButtons(exit, target, { telegram_id: '1', tier: 'paid', is_admin: false } as any);
  assert.equal(buttons.flat().some(button => button.text.includes('Trade')), false);
  assert.deepEqual(buttons[0].map(button => button.text), ['🔬 Full Intel']);
  const copy = buttons.flat().find(button => button.text === '📋 Copy CA');
  assert.equal(copy?.callback_data, `COPY_CA_${spurdoAddress}`);
  assert.ok(Buffer.byteLength(copy!.callback_data!, 'utf8') <= 64);
});

test('PONS Entry Ready and Watching render verified FDV while indexed market replaces it', async () => {
  const { buildOpportunityMessage } = await service();
  for (const action of ['CHECK_ENTRY', 'TRACK', 'WATCH']) {
    const row = {
      ...opportunity({ symbol: 'SPURDO', elapsedSec: 60, marketIndexState: 'NOT_INDEXED',
        preIndexValuation: spurdoValuation() }, spurdoAddress),
      recommended_action: action,
    };
    assert.match(buildOpportunityMessage(row), /FDV\s+<b>\$4\.(?:58|6)K<\/b>/);
    assert.doesNotMatch(buildOpportunityMessage(row), /Market\s+<b>INDEXING<\/b>/);
  }

  const indexed = {
    ...opportunity({
      symbol: 'SPURDO', elapsedSec: 60, marketIndexState: 'VERIFIED',
      marketCap: 8_200, liquidity: 3_100, volume5m: 900,
      chartUrl: 'https://dexscreener.com/robinhood/spurdo',
      preIndexValuation: spurdoValuation(),
    }, spurdoAddress),
    recommended_action: 'EXIT',
  };
  const message = buildOpportunityMessage(indexed);
  assert.match(message, /Market cap\s+<b>\$8\.2K<\/b>/);
  assert.doesNotMatch(message, /FDV|verified launch curve|INDEXING/);
});

test('same-token lifecycle valuation is recovered even when Exit identity is already complete', async () => {
  const { resolvePonsDeliveryContext } = await ponsResolver();
  const exit = {
    ...opportunity({ symbol: 'SPURDO', name: 'SPURDO', elapsedSec: 180 }, spurdoAddress),
    recommended_action: 'EXIT',
  };
  let lifecycleLookedUp = false;
  const resolved = await resolvePonsDeliveryContext(exit, {
    loadLifecycleIdentity: async () => {
      lifecycleLookedUp = true;
      return { symbol: 'SPURDO', preIndexValuation: spurdoValuation() };
    },
    loadObservationIdentity: async () => null,
    resolveTarget: async () => ({
      tokenUrl: `https://robinhoodchain.blockscout.com/token/${spurdoAddress}`,
      tokenSource: 'blockscout',
    }),
  });
  assert.equal(lifecycleLookedUp, true);
  assert.ok(resolved.rawData.preIndexValuation);
  const { buildOpportunityMessage } = await service();
  exit.raw_data = resolved.rawData;
  assert.match(buildOpportunityMessage(exit), /FDV\s+<b>\$4\.(?:58|6)K<\/b>/);
});

test('OFY V2 Exit retries verified curve FDV when lifecycle and Dex context are empty', async () => {
  const { resolvePonsDeliveryContext } = await ponsResolver();
  const { buildButtons, buildOpportunityMessage } = await service();
  const exit = {
    ...opportunity({
      symbol: 'OFY', name: 'OffYield', elapsedSec: 135,
      currentRoi: -26.930228436484715, roiChange: -22.980829294790144,
      marketIndexState: 'NOT_INDEXED', preIndexValuation: null,
      devHoldingPercent: 0, devHoldingEvidence: 'VERIFIED',
      totalBurnPercent: 0, burnEvidence: 'VERIFIED',
      otherDevTransferPercent: 3, devFlowEvidenceStatus: 'COMPLETE',
    }, ofyAddress),
    strategy_key: 'PONS_RISK', recommended_action: 'EXIT', confidence: 80, risk_score: 90,
  };
  const target: TokenOpenTarget = {
    tokenUrl: `https://robinhoodchain.blockscout.com/token/${ofyAddress}`,
    tokenSource: 'blockscout', marketIndexState: 'NOT_INDEXED',
  };
  const resolved = await resolvePonsDeliveryContext(exit, {
    loadLifecycleIdentity: async () => ({ symbol: 'OFY', name: 'OffYield' }),
    loadObservationIdentity: async () => null,
    loadPreIndexValuation: async () => ({ preIndexValuation: ofyValuation() }),
    resolveTarget: async () => target,
  });
  exit.raw_data = resolved.rawData;
  const message = buildOpportunityMessage(exit);
  assert.match(message, /<b>OFY<\/b> · <code>0x6267…b3106<\/code>/);
  assert.match(message, /FDV\s+<b>\$4\.(?:11|1)K<\/b>/);
  assert.doesNotMatch(message, /Market cap|Market\s+<b>INDEXING|Liquidity|5m volume/);
  const buttons = buildButtons(exit, target, { telegram_id: '1', tier: 'paid', is_admin: false } as any);
  assert.deepEqual(buttons.map(row => row.map(button => button.text)), [
    ['🔬 Full Intel'], ['⭐ Track', '📋 Copy CA'], ['🔕 Mute'],
  ]);
  assert.equal(buttons[1][1].callback_data, `COPY_CA_${ofyAddress}`);
  assert.equal(buttons.flat().some(button => button.text.includes('Trade')), false);
});

test('OFY lifecycle keeps verified FDV while indexed current market takes precedence', async () => {
  const { buildOpportunityMessage, mergeOpportunityMarketContext } = await service();
  let raw: Record<string, unknown> = {
    symbol: 'OFY', name: 'OffYield', marketIndexState: 'NOT_INDEXED',
    preIndexValuation: ofyValuation(), elapsedSec: 30,
  };
  for (const action of ['CHECK_ENTRY', 'TRACK', 'EXIT']) {
    const row = { ...opportunity(raw, ofyAddress), recommended_action: action };
    assert.match(buildOpportunityMessage(row), /FDV\s+<b>\$4\.(?:11|1)K<\/b>/);
    raw = mergePonsLifecycleContext(raw, { ...raw, elapsedSec: Number(raw.elapsedSec) + 45 });
  }
  const indexed = { ...opportunity(raw, ofyAddress), recommended_action: 'EXIT' };
  indexed.raw_data = mergeOpportunityMarketContext(indexed, {
    symbol: 'OFY', marketCap: 9_000, fdv: 10_000, liquidity: 3_000, volume5m: 800,
    chartUrl: 'https://dexscreener.com/robinhood/ofy',
  }, 'VERIFIED');
  const message = buildOpportunityMessage(indexed);
  assert.match(message, /Market cap\s+<b>\$9\.0K<\/b>/);
  assert.match(message, /Liquidity\s+<b>\$3\.0K<\/b>/);
  assert.match(message, /5m volume\s+<b>\$800<\/b>/);
  assert.doesNotMatch(message, /FDV|verified launch curve|INDEXING/);
});

test('PONS V1 without indexed market or defensible valuation remains truthfully unavailable', async () => {
  const { resolvePonsDeliveryContext } = await ponsResolver();
  const { buildOpportunityMessage } = await service();
  const exit = {
    ...opportunity({ symbol: 'VONE', elapsedSec: 120, marketIndexState: 'NOT_INDEXED' }, ofyAddress),
    strategy_key: 'PONS_RISK', recommended_action: 'EXIT',
  };
  const resolved = await resolvePonsDeliveryContext(exit, {
    loadLifecycleIdentity: async () => null,
    loadObservationIdentity: async () => null,
    loadPreIndexValuation: async () => null,
    resolveTarget: async () => ({
      tokenUrl: `https://robinhoodchain.blockscout.com/token/${ofyAddress}`,
      tokenSource: 'blockscout', marketIndexState: 'NOT_INDEXED',
    }),
  });
  exit.raw_data = resolved.rawData;
  assert.doesNotMatch(buildOpportunityMessage(exit), /Market cap|FDV|Liquidity|5m volume|INDEXING/);
});
