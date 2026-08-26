import {
  Markup,
  type Telegraf,
} from 'telegraf';

import {
  addTrackedWallet,
  enableRobinhoodMonitoringForSavedWallet,
  getRecentTrackedWalletActivity,
  getTrackedWalletActivityById,
  getRecentWalletActivityForUser,
  getTrackedWalletByIdForUser,
  getTrackedWalletsForUser,
  getLatestWalletActivityForUser,
  removeTrackedWallet,
  setTrackedWalletActive,
} from '../services/trackedWalletService.js';
import {
  clearConversationState,
  getConversationState,
  setConversationState,
} from './conversationState.js';
import {
  detectWalletAddress,
  escapeTelegramHtml,
} from './walletInput.js';
import { walletCoverageText, walletFamilyHasLiveMonitoring, walletNetworkLabel } from '../services/walletAddress.js';
import { getContextAccess, requireCapability } from './accessControl.js';
import { hasCapability } from '../product/capabilities.js';
import { initializeRobinhoodWalletCursorAtCurrentBlock } from '../chains/robinhood/robinhoodWalletWatcher.js';
import { getAddress } from 'viem';
import { getWalletIntelligenceProfile, type WalletIntelligenceProfile } from '../services/walletIntelligenceService.js';
import { activityTokenLabel, formatActivityAmount, humanAge, normalizeWalletActivityRow, shortWalletValue, type WalletActivityView } from '../services/walletActivityPresentation.js';
import { resolveTokenOpenTarget } from '../core/tokenOpenRouter.js';
import { analyzeRobinhoodWallet } from '../services/walletHistoricalAnalysisService.js';

function userId(
  ctx: any,
): string | null {
  const id =
    ctx.from?.id;

  return id == null
    ? null
    : String(id);
}

type PendingEvmWallet = { address: string; label: string | null };
const pendingEvmWallets = new Map<string, PendingEvmWallet>();

async function showEvmNetworkSelection(ctx: any, telegramId: string, wallet: PendingEvmWallet) {
  pendingEvmWallets.set(telegramId, wallet);
  await ctx.reply([
    '🌐 <b>EVM WALLET DETECTED</b>', '',
    `<code>${escapeTelegramHtml(shortAddress(wallet.address))}</code>`, '',
    'Choose the network to monitor:', '',
    '<i>Public addresses only. Never share private keys or seed phrases.</i>',
  ].join('\n'), {
    parse_mode: 'HTML',
    reply_markup: Markup.inlineKeyboard([
      [Markup.button.callback('🔵 Robinhood / PONS', 'WALLET_NETWORK_ROBINHOOD')],
      [Markup.button.callback('⚫ Ethereum — Coming later', 'WALLET_NETWORK_UNAVAILABLE')],
      [Markup.button.callback('🔷 Base — Coming later', 'WALLET_NETWORK_UNAVAILABLE')],
      [Markup.button.callback('🟡 BSC — Coming later', 'WALLET_NETWORK_UNAVAILABLE')],
      [Markup.button.callback('✖️ Cancel', 'WALLET_ADD_CANCEL'), Markup.button.callback('⬅️ Wallets', 'WALLET_TRACKING')],
      [Markup.button.callback('🏠 Home', 'MAIN_MENU')],
    ]).reply_markup,
  });
}

function shortAddress(
  value: string,
): string {
  if (
    value.length <=
    14
  ) {
    return value;
  }

  return (
    value.slice(
      0,
      6,
    ) +
    '…' +
    value.slice(
      -6,
    )
  );
}

function intelligenceNumber(value: number | null, suffix = ''): string {
  return value == null ? 'Unknown' : `${value >= 0 ? '+' : ''}${value.toFixed(1)}${suffix}`;
}

function intelligenceUsd(value: number | null): string | null {
  if (value == null) return null;
  return `$${value >= 1_000_000 ? `${(value / 1_000_000).toFixed(2)}M` : value >= 1_000 ? `${(value / 1_000).toFixed(1)}K` : value.toFixed(0)}`;
}

export function renderWalletIntelligence(profile: WalletIntelligenceProfile): string {
  const performance = profile.launchPerformance;
  const behavior = profile.developerBehavior;
  const lines = [
    '🧠 <b>ALPHAOS · WALLET INTELLIGENCE</b>', '',
    `<code>${escapeTelegramHtml(shortAddress(profile.wallet))}</code>`, 'Robinhood', '',
    '📊 <b>ALPHAOS COVERAGE</b>',
    `First observed         <b>${profile.walletAge.firstObservedAt ? humanAge(profile.walletAge.firstObservedAt) : 'Unknown'}</b>`,
    `Activities recorded    <b>${profile.coverage.activitiesRecorded}</b>`,
    `Historical analysis   <b>${profile.coverage.historicalAnalysis === 'COMPLETE' ? 'Bounded scan complete' : 'Not run'}</b>`, '',
  ];
  if (profile.coverage.historicalAnalysis === 'COMPLETE' || profile.launches.total > 0) lines.push(
    '🚀 <b>LAUNCH HISTORY</b>',
    `Verified launches      <b>${profile.launches.total}</b>`,
    `Last 30d               <b>${profile.launches.recent30d}</b>`,
    `Severe failures        <b>${performance.measuredLaunches ? performance.severeCrashes : 'Unknown'}</b>`,
    `Catastrophic failures  <b>${performance.measuredLaunches ? performance.catastrophicCrashes : 'Unknown'}</b>`,
    `Reached $50K           <b>${performance.measuredLaunches ? performance.crossed50k : 'Unknown'}</b>`,
    `Reached $100K          <b>${performance.measuredLaunches ? performance.crossed100k : 'Unknown'}</b>`, '',
  ); else lines.push('🚀 <b>LAUNCH HISTORY</b>', 'Creator history      <b>Not established</b>', '',
    '<i>Historical on-chain discovery has not yet been performed for this wallet.</i>', '');
  if (performance.measuredLaunches > 0) lines.push(
    '📈 <b>PERFORMANCE</b>',
    `Measured launches      <b>${performance.measuredLaunches}</b>`,
    `Meaningful performance <b>${performance.successfulLaunches}</b>`,
    `Median 5m              <b>${intelligenceNumber(performance.median5mReturn, '%')}</b>`,
    `Median 15m             <b>${intelligenceNumber(performance.median15mReturn, '%')}</b>`,
    `Best observed          <b>${intelligenceNumber(performance.bestLaunch?.maxReturn ?? null, '%')}</b>`, '',
  );
  if (profile.dataCompleteness.devFlow) lines.push(
    '👤 <b>DEVELOPER BEHAVIOR</b>',
    `Early sells            <b>${behavior.observedEarlySells} launches</b>`,
    `Burns                  <b>${behavior.launchesWithBurn} launches</b>`,
    `Transfers              <b>${behavior.observedTransfers} launches</b>`,
    `Associated wallets     <b>${behavior.associatedWallets.length}</b>`, '',
  );
  if (behavior.currentHoldingPercent != null || behavior.verifiedBurnPercent != null) lines.push(
    '🔎 <b>CURRENT VERIFIED EVIDENCE</b>',
    ...(behavior.currentHoldingPercent == null ? [] : [`Developer holding      <b>${behavior.currentHoldingPercent.toFixed(2)}%</b>`]),
    ...(behavior.verifiedBurnPercent == null ? [] : [`Largest verified burn   <b>${behavior.verifiedBurnPercent.toFixed(2)}%</b>`]), '',
  );
  if (profile.walletAge.firstObservedAt) lines.push(`<i>First observed by AlphaOS · ${humanAge(profile.walletAge.firstObservedAt)}</i>`, '');
  if (profile.reputationEvidence.negativeSignals.length || profile.reputationEvidence.positiveSignals.length) {
    lines.push('⚠️ <b>HISTORY</b>');
    for (const signal of [...profile.reputationEvidence.negativeSignals, ...profile.reputationEvidence.positiveSignals]) lines.push(`• ${escapeTelegramHtml(signal)}`);
  }
  if (!profile.launches.total && profile.coverage.historicalAnalysis === 'COMPLETE') lines.push('No verified launches were found within the bounded known-PONS-emitter coverage.');
  return lines.join('\n');
}

export function renderWalletIntelligenceLaunches(profile: WalletIntelligenceProfile): string {
  const lines = ['📜 <b>DEVELOPER LAUNCHES</b>', ''];
  if (!profile.launches.tokens.length) lines.push('No verified launches recorded.');
  for (const [index, launch] of profile.launches.tokens.slice(0, 6).entries()) {
    const valuations = [
      intelligenceUsd(launch.initialValuation) ? `Initial ${intelligenceUsd(launch.initialValuation)}` : null,
      intelligenceUsd(launch.peakValuation) ? `Peak ${intelligenceUsd(launch.peakValuation)}` : null,
      intelligenceUsd(launch.currentValuation) ? `Current ${intelligenceUsd(launch.currentValuation)}` : null,
    ].filter(Boolean).join(' · ');
    lines.push(`${index + 1}. <b>${escapeTelegramHtml((launch.symbol ?? launch.name ?? 'Unknown token').slice(0, 64))}</b>`,
      `<code>${escapeTelegramHtml(launch.token)}</code>`,
      launch.launchedAt ? `Launched ${escapeTelegramHtml(launch.launchedAt)}` : 'Launch time unavailable',
      ...(launch.launchVersion ? [`Platform ${escapeTelegramHtml(launch.launchVersion)}`] : []),
      ...(valuations ? [valuations] : []),
      launch.maxReturn == null ? 'Peak return unavailable' : `Peak ${intelligenceNumber(launch.maxReturn, '%')}`,
      launch.return15m == null ? '15m return unavailable' : `15m ${intelligenceNumber(launch.return15m, '%')}`,
      launch.catastrophicCrash ? 'Catastrophic failure evidence' : launch.severeCrash ? 'Severe failure evidence' : 'No severe failure recorded',
      `Dev sell: ${launch.developerSellObserved ? (launch.firstSellSeconds == null ? 'verified' : `verified at ${Math.round(launch.firstSellSeconds / 60)}m`) : 'none observed'}`,
      `Dev holding: ${launch.developerHoldingPercent == null ? 'not measured' : `${launch.developerHoldingPercent.toFixed(2)}%`}`,
      `Burn: ${launch.verifiedBurnPercent == null ? 'not measured' : `${launch.verifiedBurnPercent.toFixed(2)}%`}`, '');
  }
  return lines.join('\n');
}

export function renderWalletIntelligenceLinks(profile: WalletIntelligenceProfile): string {
  const lines = ['🔗 <b>REPEATED COUNTERPARTIES</b>', '', '<i>Evidence means verified developer-token transfers; it does not establish ownership.</i>', ''];
  if (!profile.developerBehavior.associatedWallets.length) lines.push('No repeated developer-transfer counterparties are recorded.');
  for (const link of profile.developerBehavior.associatedWallets.slice(0, 10)) lines.push(
    `<code>${escapeTelegramHtml(shortAddress(link.wallet))}</code>`,
    `Developer transfers    ${link.transferEvents}`,
    `Across launches        ${link.distinctLaunches}`,
    `First seen             ${humanAge(link.firstSeen)}`,
    `Last seen              ${humanAge(link.lastSeen)}`,
    'Evidence: Repeated destination of verified developer transfers.', '',
  );
  return lines.join('\n');
}

const activityPresentation = {
  BUY: { icon: '🟢', verb: 'BOUGHT' }, SELL: { icon: '🔴', verb: 'SOLD' },
  SEND: { icon: '➡️', verb: 'SENT' }, RECEIVE: { icon: '⬅️', verb: 'RECEIVED' },
  LAUNCH: { icon: '🚀', verb: 'LAUNCHED' },
} as const;

export function renderWalletActivityV2(walletAddress: string, activities: WalletActivityView[], now = new Date()): string {
  const lines = ['⚡ <b>WALLET ACTIVITY</b>', '', `<code>${escapeTelegramHtml(shortWalletValue(walletAddress))}</code>`, 'Robinhood', ''];
  if (!activities.length) lines.push('No recorded wallet activity yet.');
  for (const activity of activities) {
    const presentation = activityPresentation[activity.type] ?? activityPresentation.RECEIVE;
    const amount = formatActivityAmount(activity.normalizedTokenAmount);
    lines.push(`${presentation.icon} <b>${presentation.verb}</b> · ${escapeTelegramHtml(activityTokenLabel(activity))}`);
    if (amount) lines.push(`${amount} ${escapeTelegramHtml(activity.tokenSymbol?.slice(0, 12) ?? 'tokens')}`);
    if (activity.nativeAmount != null && activity.quoteSymbol) lines.push(`${activity.type === 'BUY' ? 'Spent' : 'Received'}       ${activity.nativeAmount.toFixed(3)} ${escapeTelegramHtml(activity.quoteSymbol)}`);
    if (activity.counterparty && activity.type === 'SEND') lines.push(`To          ${escapeTelegramHtml(shortWalletValue(activity.counterparty))}`);
    if (activity.counterparty && activity.type === 'RECEIVE') lines.push(`From        ${escapeTelegramHtml(shortWalletValue(activity.counterparty))}`);
    lines.push(`When        ${humanAge(activity.timestamp, now)}`, '');
  }
  return lines.join('\n');
}

export function renderWalletActivityDetail(activity: WalletActivityView, now = new Date()): string {
  const presentation = activityPresentation[activity.type] ?? activityPresentation.RECEIVE;
  const amount = formatActivityAmount(activity.normalizedTokenAmount);
  const lines = ['⚡ <b>WALLET TRANSACTION</b>', '', `${presentation.icon} <b>${presentation.verb}</b>`, escapeTelegramHtml(activityTokenLabel(activity)), ''];
  if (amount) lines.push(`Amount       ${amount} ${escapeTelegramHtml(activity.tokenSymbol?.slice(0, 12) ?? 'tokens')}`);
  if (activity.nativeAmount != null && activity.quoteSymbol) lines.push(`${activity.type === 'BUY' ? 'Spent' : 'Received'}        ${activity.nativeAmount.toFixed(3)} ${escapeTelegramHtml(activity.quoteSymbol)}`);
  if (activity.counterparty) lines.push(`${activity.type === 'SEND' ? 'To' : activity.type === 'RECEIVE' ? 'From' : 'Counterparty'}          ${escapeTelegramHtml(shortWalletValue(activity.counterparty))}`);
  lines.push(`When         ${humanAge(activity.timestamp, now)}`, `Wallet       ${escapeTelegramHtml(shortWalletValue(activity.wallet))}`);
  if (activity.tokenContract) lines.push('', '<b>Token</b>', `<code>${escapeTelegramHtml(activity.tokenContract)}</code>`);
  if (activity.transactionHash) lines.push('', '<b>Transaction</b>', `<code>${escapeTelegramHtml(shortWalletValue(activity.transactionHash))}</code>`);
  return lines.join('\n');
}

function isMessageNotModified(error: unknown): boolean {
  const message = error instanceof Error
    ? error.message
    : String(error);
  return message.toLowerCase().includes('message is not modified');
}

async function renderWalletCenter(
  ctx: any,
) {
  const telegramId =
    userId(
      ctx,
    );

  if (!telegramId) {
    return;
  }

  const wallets =
    await getTrackedWalletsForUser(
      telegramId,
    );
  const latestActivity = await getLatestWalletActivityForUser(telegramId);

  const lines = [
    '🐋 <b>WALLETS</b>',
    '',
    wallets.length ===
    0
      ? 'No wallets tracked yet.'
      : `Tracked wallets: <b>${wallets.length}</b>`,
    '',
  ];

  for (
    const wallet
    of wallets.slice(
      0,
      10,
    )
  ) {
    const liveMonitoring = walletFamilyHasLiveMonitoring(wallet.chain);
    lines.push(
      `${liveMonitoring && wallet.is_active ? '🟢' : '⚪'} <b>${escapeTelegramHtml(walletNetworkLabel(wallet.chain))}</b> · ${wallet.label
        ? `<b>${escapeTelegramHtml(wallet.label)}</b> · `
        : ''
      }<code>${escapeTelegramHtml(shortAddress(
        wallet.wallet_address,
      ))}</code>`,
      `<i>${walletCoverageText(wallet.chain, wallet.is_active)}</i>`,
      `<i>Monitoring ${liveMonitoring && wallet.is_active ? 'ON' : 'OFF'} · Last activity ${latestActivity.get(wallet.wallet_address.toLowerCase()) ?? 'not detected'}</i>`,
    );
  }

  lines.push(
    '',
    '<i>Public wallet addresses only. Never share private keys or seed phrases.</i>',
  );

  const buttons:
    any[][] = [
      [
        Markup.button.callback(
          '➕ Add Wallet',
          'WALLET_ADD_HELP',
        ),

        Markup.button.callback(
          '🔄 Refresh',
          'WALLET_TRACKING',
        ),
      ],
    ];
  if (wallets.some(wallet => walletFamilyHasLiveMonitoring(wallet.chain))) {
    buttons.push([Markup.button.callback('⚡ Recent Activity', 'WALLET_RECENT_ACTIVITY')]);
  }

  for (
    const wallet
    of wallets.slice(
      0,
      8,
    )
  ) {
    const row = [];
    if (wallet.chain === 'evm') {
      row.push(Markup.button.callback(
        '🔵 Enable Robinhood Monitoring',
        `WALLET_ENABLE_RH_CONFIRM_${wallet.id}`,
      ));
    }
    if (walletFamilyHasLiveMonitoring(wallet.chain)) {
      row.push(
        Markup.button.callback(
          wallet.is_active ? `⏸ ${shortAddress(wallet.wallet_address)}` : `▶️ ${shortAddress(wallet.wallet_address)}`,
          `WALLET_TOGGLE_${wallet.id}`,
        ),
        Markup.button.callback('⚡ Activity', `WALLET_ACTIVITY_${wallet.id}`),
      );
    }
    if (wallet.chain === 'robinhood') row.push(Markup.button.callback('🧠 Intelligence', `WALLET_INTEL_${wallet.id}`));
    row.push(Markup.button.callback('🗑', `WALLET_REMOVE_CONFIRM_${wallet.id}`));
    buttons.push(row);
  }

  buttons.push([
    Markup.button.callback(
      '🏠 Home',
      'MAIN_MENU',
    ),
  ]);

  const options = {
    parse_mode:
      'HTML' as const,

    reply_markup:
      Markup.inlineKeyboard(
        buttons,
      ).reply_markup,
  };

  try {
    await ctx.editMessageText(
      lines.join(
        '\n',
      ),
      options,
    );
  } catch (error) {
    if (isMessageNotModified(error)) return;
    await ctx.reply(
      lines.join(
        '\n',
      ),
      options,
    );
  }
}

export function
registerWalletTracking(
  bot: Telegraf<any>,
) {
  bot.use(async (ctx, next) => {
    const telegramId = userId(ctx);
    const callback = String((ctx.callbackQuery as any)?.data ?? '');
    const command = String((ctx.message as any)?.text ?? '').split(/\s+/, 1)[0].toLowerCase();
    const walletFlow = Boolean(
      callback.startsWith('WALLET_') ||
      command === '/trackwallet' ||
      (telegramId && getConversationState(telegramId) === 'ADD_WALLET')
    );

    if (callback === 'MAIN_MENU' && telegramId) pendingEvmWallets.delete(telegramId);

    if (!walletFlow) return next();

    const access = await getContextAccess(ctx);
    if (hasCapability(access, 'wallets.track')) return next();

    if (telegramId) clearConversationState(telegramId);
    await requireCapability(ctx, 'wallets.track', 'SETTINGS');
  });

  bot.action(
    'WALLET_TRACKING',
    async ctx => {
      await ctx.answerCbQuery();

      const telegramId = userId(ctx);
      if (telegramId) {
        clearConversationState(telegramId);
        pendingEvmWallets.delete(telegramId);
      }

      await renderWalletCenter(
        ctx,
      );
    },
  );

  bot.action(
    'WALLET_ADD_HELP',
    async ctx => {
      const telegramId =
        userId(
          ctx,
        );

      if (!telegramId) {
        return;
      }

      setConversationState(telegramId, 'ADD_WALLET');

      await ctx.answerCbQuery(
        'Paste wallet address',
      );

      await ctx.reply(
        [
          '➕ <b>ADD WALLET</b>',
          '',
          'Paste a public wallet address.',
          'AlphaOS will detect the wallet type and show available tracking coverage.',
          '',
          '<i>Public addresses only. Never share private keys or seed phrases.</i>',
        ].join(
          '\n',
        ),
        {
          parse_mode:
            'HTML',

          reply_markup:
            Markup.inlineKeyboard([
              [
                Markup.button.callback(
                  '✖️ Cancel',
                  'WALLET_ADD_CANCEL',
                ),

                Markup.button.callback(
                  '⬅️ Wallets',
                  'WALLET_TRACKING',
                ),
                Markup.button.callback(
                  '🏠 Home',
                  'MAIN_MENU',
                ),
              ],
            ]).reply_markup,
        },
      );
    },
  );

  bot.action(
    'WALLET_ADD_CANCEL',
    async ctx => {
      const telegramId =
        userId(
          ctx,
        );

      if (telegramId) {
        clearConversationState(telegramId);
        pendingEvmWallets.delete(telegramId);
      }

      await ctx.answerCbQuery(
        'Cancelled',
      );

      await renderWalletCenter(
        ctx,
      );
    },
  );

  bot.command(
    'trackwallet',
    async ctx => {
      try {
        const telegramId =
          userId(
            ctx,
          );

        if (!telegramId) {
          return;
        }

        const message =
          String(
            ctx.message?.text ??
            '',
          );

        const parts =
          message
            .trim()
            .split(
              /\s+/,
            );

        const walletAddress =
          parts[1];

        const label =
          parts
            .slice(
              2,
            )
            .join(
              ' ',
            )
            .trim() ||
          null;

        if (!walletAddress) {
          await ctx.reply(
            'Usage: /trackwallet WALLET_ADDRESS optional label',
          );

          return;
        }

        const detected = detectWalletAddress(walletAddress);
        if (!detected.valid || !detected.family || !detected.normalizedAddress) {
          await ctx.reply('❌ That does not look like a valid public wallet address.');
          return;
        }
        const address = detected.normalizedAddress;

        if (detected.family === 'evm') {
          setConversationState(telegramId, 'ADD_WALLET');
          await showEvmNetworkSelection(ctx, telegramId, { address, label });
          return;
        }

        await addTrackedWallet({
          telegramId,

          walletAddress: address,

          chain: detected.family,

          label,
        });

        await ctx.reply(
          [
            detected.liveMonitoringAvailable
              ? '✅ <b>SOLANA WALLET ADDED</b>'
              : '✅ <b>EVM WALLET SAVED</b>',
            '',
            label
              ? `<b>${escapeTelegramHtml(label)}</b>`
              : 'Wallet',

            `<code>${escapeTelegramHtml(address)}</code>`,
            '',
            detected.liveMonitoringAvailable
              ? 'Live activity tracking is available.'
              : 'Live activity monitoring is not available for this wallet yet.',
          ].join(
            '\n',
          ),
          {
            parse_mode:
              'HTML',

            reply_markup:
              Markup.inlineKeyboard([
                [
                  Markup.button.callback(
                    '🐋 View Wallets',
                    'WALLET_TRACKING',
                  ),
                ],
              ]).reply_markup,
          },
        );
      } catch (
        error
      ) {
        console.error(
          '[WalletTracking] Add wallet failed:',
          error,
        );

        await ctx.reply(
          'Could not add that wallet.',
        );
      }
    },
  );

  bot.action('WALLET_NETWORK_UNAVAILABLE', async ctx => {
    await ctx.answerCbQuery('This network is not live yet', { show_alert: true });
  });

  bot.action('WALLET_NETWORK_ROBINHOOD', async ctx => {
    const telegramId = userId(ctx);
    if (!telegramId) return;
    const pending = pendingEvmWallets.get(telegramId);
    if (!pending || getConversationState(telegramId) !== 'ADD_WALLET') {
      pendingEvmWallets.delete(telegramId);
      await ctx.answerCbQuery('Wallet selection expired. Add the wallet again.', { show_alert: true });
      return;
    }
    try {
      await addTrackedWallet({
        telegramId, walletAddress: pending.address, chain: 'robinhood', label: pending.label,
      });
      pendingEvmWallets.delete(telegramId);
      clearConversationState(telegramId);
      await ctx.answerCbQuery('Robinhood monitoring enabled');
      await ctx.reply([
        '✅ <b>WALLET ADDED</b>', '',
        `Robinhood · <code>${escapeTelegramHtml(shortAddress(pending.address))}</code>`,
        pending.label ? `<b>${escapeTelegramHtml(pending.label)}</b>` : '', '',
        'Live monitoring · <b>ON</b>', '',
        'AlphaOS watches this public wallet for token activity.', '',
        '<i>Public wallet addresses only. Never share private keys or seed phrases.</i>',
      ].filter(Boolean).join('\n'), {
        parse_mode: 'HTML',
        reply_markup: Markup.inlineKeyboard([[
          Markup.button.callback('🐋 View Wallets', 'WALLET_TRACKING'),
          Markup.button.callback('🏠 Home', 'MAIN_MENU'),
        ]]).reply_markup,
      });
    } catch (error) {
      console.error('[WalletTracking] Robinhood wallet add failed:', error);
      await ctx.answerCbQuery('Could not add wallet', { show_alert: true }).catch(() => {});
    }
  });

  bot.action(
    'WALLET_RECENT_ACTIVITY',
    async ctx => {
      const telegramId = userId(ctx);
      if (!telegramId) return;
      await ctx.answerCbQuery();
      try {
        const activity = await getRecentWalletActivityForUser(telegramId, 12);
        const lines = ['⚡ <b>RECENT WALLET ACTIVITY</b>', ''];
        if (!activity.length) lines.push('No tracked-wallet activity recorded yet.');
        for (const row of activity) {
          lines.push(
            `${String(row.action ?? '').toUpperCase() === 'SELL' ? '🔴' : '🟢'} ` +
            `<b>${escapeTelegramHtml(String(row.action ?? 'Activity').toUpperCase())}</b> ` +
            `${escapeTelegramHtml(shortAddress(String(row.token ?? '-')))}`,
          );
        }
        await ctx.reply(lines.join('\n'), {
          parse_mode: 'HTML',
          reply_markup: Markup.inlineKeyboard([[
            Markup.button.callback('⬅️ Wallets', 'WALLET_TRACKING'),
            Markup.button.callback('🏠 Home', 'MAIN_MENU'),
          ]]).reply_markup,
        });
      } catch (error) {
        console.error('[WalletTracking] Recent activity failed:', error);
        await ctx.reply('Unable to load recent wallet activity. Please try again.');
      }
    },
  );

  bot.action(
    /^WALLET_ENABLE_RH_CONFIRM_(\d+)$/,
    async ctx => {
      const telegramId = userId(ctx);
      if (!telegramId) return;
      const wallet = await getTrackedWalletByIdForUser({ telegramId, id: Number(ctx.match[1]) });
      if (!wallet || wallet.chain !== 'evm') {
        await ctx.answerCbQuery('Saved EVM wallet not found', { show_alert: true });
        return;
      }
      await ctx.answerCbQuery();
      await ctx.reply([
        '🔵 <b>ENABLE ROBINHOOD MONITORING?</b>', '',
        '<b>Wallet</b>',
        `<code>${escapeTelegramHtml(shortAddress(wallet.wallet_address))}</code>`, '',
        'AlphaOS will monitor public Robinhood-chain activity for:',
        '• Buys',
        '• Sells',
        '• Token transfers',
        '• Verified launches', '',
        '<i>No private keys or signing permission are required.</i>',
      ].join('\n'), {
        parse_mode: 'HTML',
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback('✅ Enable', `WALLET_ENABLE_RH_${wallet.id}`)],
          [Markup.button.callback('❌ Cancel', 'WALLET_TRACKING')],
        ]).reply_markup,
      });
    },
  );

  bot.action(
    /^WALLET_ENABLE_RH_(\d+)$/,
    async ctx => {
      const telegramId = userId(ctx);
      if (!telegramId) return;
      try {
        const wallet = await enableRobinhoodMonitoringForSavedWallet({
          telegramId,
          id: Number(ctx.match[1]),
        });
        await initializeRobinhoodWalletCursorAtCurrentBlock(getAddress(wallet.wallet_address));
        await ctx.answerCbQuery('Robinhood monitoring enabled');
        await ctx.reply([
          '✅ <b>ROBINHOOD MONITORING ENABLED</b>', '',
          `<code>${escapeTelegramHtml(shortAddress(wallet.wallet_address))}</code>`, '',
          'Live monitoring · <b>ON</b>',
          'Monitoring starts from the current block. Earlier activity is not replayed.',
        ].join('\n'), {
          parse_mode: 'HTML',
          reply_markup: Markup.inlineKeyboard([[
            Markup.button.callback('⬅️ Wallets', 'WALLET_TRACKING'),
            Markup.button.callback('🏠 Home', 'MAIN_MENU'),
          ]]).reply_markup,
        });
      } catch (error) {
        console.error('[WalletTracking] Robinhood enable failed:', error);
        await ctx.answerCbQuery('Could not enable monitoring', { show_alert: true }).catch(() => {});
      }
    },
  );

  bot.action(
    /^WALLET_TOGGLE_(\d+)$/,
    async ctx => {
      try {
        const telegramId =
          userId(
            ctx,
          );

        if (!telegramId) {
          return;
        }

        const id =
          Number(
            ctx.match[1],
          );

        const wallets =
          await getTrackedWalletsForUser(
            telegramId,
          );

        const wallet =
          wallets.find(
            row =>
              row.id ===
              id,
          );

        if (!wallet) {
          await ctx.answerCbQuery(
            'Wallet not found',
          );

          return;
        }

        if (!walletFamilyHasLiveMonitoring(wallet.chain)) {
          await ctx.answerCbQuery('Live monitoring is unavailable for this wallet type', { show_alert: true });
          return;
        }

        await setTrackedWalletActive({
          telegramId,

          id,

          active:
            !wallet.is_active,
        });

        await ctx.answerCbQuery(
          wallet.is_active
            ? 'Tracking paused'
            : 'Tracking enabled',
        );

        await renderWalletCenter(
          ctx,
        );
      } catch (
        error
      ) {
        console.error(
          '[WalletTracking] Toggle failed:',
          error,
        );

        await ctx.answerCbQuery('Could not update wallet', {
          show_alert: true,
        }).catch(() => {});
      }
    },
  );

  bot.action(
    /^WALLET_REMOVE_CONFIRM_(\d+)$/,
    async ctx => {
      const telegramId =
        userId(
          ctx,
        );

      if (!telegramId) {
        return;
      }

      const wallet =
        await getTrackedWalletByIdForUser({
          telegramId,

          id:
            Number(
              ctx.match[1],
            ),
        });

      if (!wallet) {
        await ctx.answerCbQuery(
          'Wallet not found',
        );

        return;
      }

      await ctx.answerCbQuery();

      await ctx.reply(
        [
          '🗑 <b>REMOVE WALLET?</b>',
          '',
          wallet.label
            ? `<b>${escapeTelegramHtml(wallet.label)}</b>`
            : 'Tracked wallet',
          `<code>${escapeTelegramHtml(wallet.wallet_address)}</code>`,
          '',
          walletFamilyHasLiveMonitoring(wallet.chain)
            ? 'This stops AlphaOS wallet activity tracking for this address.'
            : 'This removes the saved public wallet from AlphaOS.',
        ].join(
          '\n',
        ),
        {
          parse_mode:
            'HTML',

          reply_markup:
            Markup.inlineKeyboard([
              [
                Markup.button.callback(
                  '🗑 Yes, Remove',
                  `WALLET_REMOVE_${wallet.id}`,
                ),
              ],
              [
                Markup.button.callback(
                  '⬅️ Keep Wallet',
                  'WALLET_TRACKING',
                ),
              ],
            ]).reply_markup,
        },
      );
    },
  );

  bot.action(
    /^WALLET_REMOVE_(\d+)$/,
    async ctx => {
      try {
        const telegramId =
          userId(
            ctx,
          );

        if (!telegramId) {
          return;
        }

        await removeTrackedWallet({
          telegramId,

          id:
            Number(
              ctx.match[1],
            ),
        });

        await ctx.answerCbQuery(
          'Wallet removed',
        );

        await renderWalletCenter(
          ctx,
        );
      } catch (
        error
      ) {
        console.error(
          '[WalletTracking] Remove failed:',
          error,
        );

        await ctx.answerCbQuery('Could not remove wallet', {
          show_alert: true,
        }).catch(() => {});
      }
    },
  );


  bot.action(
    /^WALLET_INTEL_(\d+)$/,
    async ctx => {
      const telegramId = userId(ctx);
      if (!telegramId) return;
      try {
        const wallet = await getTrackedWalletByIdForUser({ telegramId, id: Number(ctx.match[1]) });
        if (!wallet || wallet.chain !== 'robinhood') {
          await ctx.answerCbQuery('Wallet intelligence is currently available for Robinhood wallets only', { show_alert: true });
          return;
        }
        const profile = await getWalletIntelligenceProfile({ walletAddress: wallet.wallet_address, chain: 'robinhood' });
        await ctx.answerCbQuery();
        await ctx.reply(renderWalletIntelligence(profile), {
          parse_mode: 'HTML',
          reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback('🔍 Analyze Wallet', `WALLET_INTEL_ANALYZE_${wallet.id}`)],
            [Markup.button.callback('📜 Launches', `WALLET_INTEL_LAUNCHES_${wallet.id}`), Markup.button.callback('🔗 Associated Wallets', `WALLET_INTEL_LINKS_${wallet.id}`)],
            [Markup.button.callback('⚡ Activity', `WALLET_ACTIVITY_${wallet.id}`)],
            [Markup.button.callback('⬅️ Wallets', 'WALLET_TRACKING'), Markup.button.callback('🏠 Home', 'MAIN_MENU')],
          ]).reply_markup,
        });
      } catch (error) {
        console.error('[WalletTracking] Intelligence failed:', error);
        await ctx.answerCbQuery('Could not load wallet intelligence', { show_alert: true }).catch(() => {});
      }
    },
  );

  bot.action(
    /^WALLET_INTEL_ANALYZE_(\d+)$/,
    async ctx => {
      const telegramId = userId(ctx);
      if (!telegramId) return;
      try {
        const wallet = await getTrackedWalletByIdForUser({ telegramId, id: Number(ctx.match[1]) });
        if (!wallet || wallet.chain !== 'robinhood') return void await ctx.answerCbQuery('Analyze Wallet is available for Robinhood wallets only', { show_alert: true });
        await ctx.answerCbQuery('Running bounded read-only analysis…');
        await analyzeRobinhoodWallet(wallet.wallet_address);
        const profile = await getWalletIntelligenceProfile({ walletAddress: wallet.wallet_address, chain: 'robinhood' });
        await ctx.reply(renderWalletIntelligence(profile), { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback('📜 Launches', `WALLET_INTEL_LAUNCHES_${wallet.id}`), Markup.button.callback('🔗 Associated Wallets', `WALLET_INTEL_LINKS_${wallet.id}`)],
          [Markup.button.callback('⚡ Activity', `WALLET_ACTIVITY_${wallet.id}`)],
          [Markup.button.callback('⬅️ Wallets', 'WALLET_TRACKING'), Markup.button.callback('🏠 Home', 'MAIN_MENU')],
        ]).reply_markup });
      } catch (error) {
        console.error('[WalletTracking] Analyze wallet failed:', error);
        await ctx.reply('Wallet analysis could not be completed. No monitoring or alerts were changed.');
      }
    },
  );

  bot.action(
    /^WALLET_INTEL_LAUNCHES_(\d+)$/,
    async ctx => {
      const telegramId = userId(ctx);
      if (!telegramId) return;
      try {
        const wallet = await getTrackedWalletByIdForUser({ telegramId, id: Number(ctx.match[1]) });
        if (!wallet || wallet.chain !== 'robinhood') return void await ctx.answerCbQuery('Robinhood wallet not found', { show_alert: true });
        const profile = await getWalletIntelligenceProfile({ walletAddress: wallet.wallet_address, chain: 'robinhood' });
        await ctx.answerCbQuery();
        await ctx.reply(renderWalletIntelligenceLaunches(profile), { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback('🧠 Summary', `WALLET_INTEL_${wallet.id}`), Markup.button.callback('🔗 Associated Wallets', `WALLET_INTEL_LINKS_${wallet.id}`)],
          [Markup.button.callback('⬅️ Wallets', 'WALLET_TRACKING'), Markup.button.callback('🏠 Home', 'MAIN_MENU')],
        ]).reply_markup });
      } catch (error) {
        console.error('[WalletTracking] Intelligence launches failed:', error);
        await ctx.answerCbQuery('Could not load launch history', { show_alert: true }).catch(() => {});
      }
    },
  );

  bot.action(
    /^WALLET_INTEL_LINKS_(\d+)$/,
    async ctx => {
      const telegramId = userId(ctx);
      if (!telegramId) return;
      try {
        const wallet = await getTrackedWalletByIdForUser({ telegramId, id: Number(ctx.match[1]) });
        if (!wallet || wallet.chain !== 'robinhood') return void await ctx.answerCbQuery('Robinhood wallet not found', { show_alert: true });
        const profile = await getWalletIntelligenceProfile({ walletAddress: wallet.wallet_address, chain: 'robinhood' });
        await ctx.answerCbQuery();
        await ctx.reply(renderWalletIntelligenceLinks(profile), { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback('🧠 Summary', `WALLET_INTEL_${wallet.id}`), Markup.button.callback('📜 Launches', `WALLET_INTEL_LAUNCHES_${wallet.id}`)],
          [Markup.button.callback('⬅️ Wallets', 'WALLET_TRACKING'), Markup.button.callback('🏠 Home', 'MAIN_MENU')],
        ]).reply_markup });
      } catch (error) {
        console.error('[WalletTracking] Intelligence links failed:', error);
        await ctx.answerCbQuery('Could not load associated wallets', { show_alert: true }).catch(() => {});
      }
    },
  );

  bot.action(
    /^WALLET_ACTIVITY_DETAIL_(\d+)_(\d+)$/,
    async ctx => {
      const telegramId = userId(ctx);
      if (!telegramId) return;
      try {
        const wallet = await getTrackedWalletByIdForUser({ telegramId, id: Number(ctx.match[1]) });
        if (!wallet || wallet.chain !== 'robinhood') return void await ctx.answerCbQuery('Robinhood wallet not found', { show_alert: true });
        const row = await getTrackedWalletActivityById({ telegramId, walletAddress: wallet.wallet_address, id: Number(ctx.match[2]) });
        if (!row) return void await ctx.answerCbQuery('Activity not found', { show_alert: true });
        const activity = normalizeWalletActivityRow(row);
        const target = activity.tokenContract ? await resolveTokenOpenTarget({ chain: 'robinhood', tokenAddress: activity.tokenContract }) : null;
        const actions: any[][] = [];
        const marketRow = [];
        if (target?.chartUrl) marketRow.push(Markup.button.url('📊 Chart', target.chartUrl));
        if (target?.tokenUrl) marketRow.push(Markup.button.url('🔎 Token', target.tokenUrl));
        if (marketRow.length) actions.push(marketRow);
        const contractRow = [];
        if (activity.tokenContract) contractRow.push(Markup.button.callback('📋 Copy CA', `COPY_CA_${activity.tokenContract}`));
        if (activity.transactionHash) contractRow.push(Markup.button.url('🔗 Explorer', `https://robinhoodchain.blockscout.com/tx/${activity.transactionHash}`));
        if (contractRow.length) actions.push(contractRow);
        actions.push([Markup.button.callback('⬅️ Activity', `WALLET_ACTIVITY_${wallet.id}`), Markup.button.callback('🏠 Home', 'MAIN_MENU')]);
        await ctx.answerCbQuery();
        await ctx.reply(renderWalletActivityDetail(activity), { parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard(actions).reply_markup });
      } catch (error) {
        console.error('[WalletTracking] Activity detail failed:', error);
        await ctx.answerCbQuery('Could not load activity detail', { show_alert: true }).catch(() => {});
      }
    },
  );

  bot.action(
    /^WALLET_ACTIVITY_(\d+)$/,
    async ctx => {
      try {
        const telegramId =
          userId(
            ctx,
          );

        if (!telegramId) {
          return;
        }

        const wallet =
          await getTrackedWalletByIdForUser({
            telegramId,

            id:
              Number(
                ctx.match[1],
              ),
          });

        if (!wallet) {
          await ctx.answerCbQuery(
            'Wallet not found',
          );

          return;
        }

        if (!walletFamilyHasLiveMonitoring(wallet.chain)) {
          await ctx.answerCbQuery();
          await ctx.reply('Live monitoring is not available for this wallet type yet.', {
            reply_markup: Markup.inlineKeyboard([[
              Markup.button.callback('⬅️ Wallets', 'WALLET_TRACKING'),
              Markup.button.callback('🏠 Home', 'MAIN_MENU'),
            ]]).reply_markup,
          });
          return;
        }

        const rows =
          await getRecentTrackedWalletActivity(
            wallet.wallet_address,
            8,
            telegramId,
            wallet.chain,
          );

        const activity = rows.map(row => normalizeWalletActivityRow(row));

        await ctx.answerCbQuery();

        await ctx.reply(
          renderWalletActivityV2(wallet.wallet_address, activity),
          {
            parse_mode:
              'HTML',

            reply_markup:
              Markup.inlineKeyboard([
                ...activity.filter(row => row.id != null).map(row => [Markup.button.callback(
                  `${activityPresentation[row.type]?.icon ?? '⚡'} ${activityTokenLabel(row).slice(0, 24)}`,
                  `WALLET_ACTIVITY_DETAIL_${wallet.id}_${row.id}`,
                )]),
                [
                  Markup.button.callback(
                    '⬅️ Wallets',
                    'WALLET_TRACKING',
                  ),

                  Markup.button.callback(
                    '🔄 Refresh',
                    `WALLET_ACTIVITY_${wallet.id}`,
                  ),
                ],
                [Markup.button.callback('🏠 Home', 'MAIN_MENU')],
              ]).reply_markup,
          },
        );
      } catch (
        error
      ) {
        console.error(
          '[WalletTracking] Activity failed:',
          error,
        );

        await ctx.answerCbQuery('Could not load wallet activity', {
          show_alert: true,
        }).catch(() => {});
      }
    },
  );

  bot.on(
    'text',
    async (
      ctx,
      next,
    ) => {
      const telegramId =
        userId(
          ctx,
        );

      if (
        !telegramId ||
        getConversationState(telegramId) !== 'ADD_WALLET'
      ) {
        return next();
      }

      const value =
        String(
          ctx.message?.text ??
          '',
        ).trim();

      if (
        value.startsWith(
          '/',
        )
      ) {
        if (
          value.toLowerCase() ===
          '/cancel'
        ) {
          clearConversationState(telegramId);
          pendingEvmWallets.delete(telegramId);

          await ctx.reply(
            'Wallet add cancelled.',
          );

          return;
        }

        return next();
      }

      try {
        const detected = detectWalletAddress(value);
        if (!detected.valid || !detected.family || !detected.normalizedAddress) {
          throw new Error('Invalid public wallet address');
        }
        const address = detected.normalizedAddress;

        if (detected.family === 'evm') {
          await showEvmNetworkSelection(ctx, telegramId, { address, label: null });
          return;
        }

        await addTrackedWallet({
          telegramId,

          walletAddress:
            address,

          chain: detected.family,
        });

        clearConversationState(telegramId);

        await ctx.reply(
          [
            detected.liveMonitoringAvailable
              ? '✅ <b>SOLANA WALLET ADDED</b>'
              : '✅ <b>EVM WALLET SAVED</b>',
            '',
            `<code>${address}</code>`,
            '',
            detected.liveMonitoringAvailable
              ? 'Live activity tracking is available.'
              : 'Live activity monitoring is not available for this wallet yet.',
          ].join(
            '\n',
          ),
          {
            parse_mode:
              'HTML',

            reply_markup:
              Markup.inlineKeyboard([
                [
                  Markup.button.callback(
                    '🐋 View Wallets',
                    'WALLET_TRACKING',
                  ),
                ],
              ]).reply_markup,
          },
        );
      } catch {
        await ctx.reply(
          [
            '❌ That does not look like a valid public wallet address.',
            '',
            'Paste the public wallet address again or send /cancel.',
          ].join(
            '\n',
          ),
        );
      }
    },
  );

  console.log(
    '[WalletTracking] Registered.',
  );
}
