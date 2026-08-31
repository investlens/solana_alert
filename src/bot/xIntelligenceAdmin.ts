import { Markup, type Telegraf } from 'telegraf';
import { config } from '../config.js';
import { clearConversationState, getConversationState, setConversationState } from './conversationState.js';
import { escapeTelegramHtml } from '../ui/escapeHtml.js';
import {
  addXReputedAccount,
  getXReputedAccount,
  getXReputedAccountStats,
  listXReputedAccounts,
  removeXReputedAccount,
  setXReputedAccountEnabled,
  setXReputedAccountTier,
  type XAccountTier,
  type XReputedAccount,
} from '../services/xReputedAccountService.js';

const PAGE_SIZE = 8;
const isAdmin = (ctx: any) => String(ctx.from?.id ?? '') === config.adminTelegramId;

async function deny(ctx: any): Promise<boolean> {
  if (isAdmin(ctx)) return false;
  await ctx.answerCbQuery?.('Admin only', { show_alert: true }).catch(() => {});
  return true;
}

async function editOrReply(ctx: any, text: string, rows: any[][]) {
  const options = { parse_mode: 'HTML' as const, reply_markup: Markup.inlineKeyboard(rows).reply_markup };
  try { await ctx.editMessageText(text, options); }
  catch (error) {
    if (String(error).toLowerCase().includes('message is not modified')) return;
    await ctx.reply(text, options);
  }
}

export function renderXAccountList(accounts: XReputedAccount[], page: number, total: number): string {
  const lines = ['🐦 <b>X INTELLIGENCE — ACCOUNTS</b>', '', `Page ${page + 1} · ${total} account${total === 1 ? '' : 's'}`, ''];
  if (!accounts.length) lines.push('No accounts are currently on the initial reputed-account watchlist.');
  accounts.forEach((account, index) => lines.push(
    `${page * PAGE_SIZE + index + 1}. @${escapeTelegramHtml(account.handle)} — ${account.tier} ${account.enabled ? '🟢' : '🔴'}`,
  ));
  return lines.join('\n');
}

async function renderHome(ctx: any) {
  const stats = await getXReputedAccountStats();
  await editOrReply(ctx, [
    '🐦 <b>X INTELLIGENCE</b>', '',
    'Status: <b>Foundation / Monitoring Disabled</b>',
    `Watched Accounts: <b>${stats.total}</b>`,
    `Enabled Accounts: <b>${stats.enabled}</b>`, '',
    'No X discovery provider or polling process is active.',
  ].join('\n'), [
    [Markup.button.callback('➕ Add Account', 'XIA_ADD'), Markup.button.callback('📋 View Accounts', 'XIA_LIST_0')],
    [Markup.button.callback('⚙️ Manage Account', 'XIA_LIST_0')],
    [Markup.button.callback('⬅️ Intelligence', 'INTELLIGENCE_CENTER'), Markup.button.callback('🏠 Home', 'MAIN_MENU')],
  ]);
}

async function renderList(ctx: any, page: number) {
  const result = await listXReputedAccounts(page, PAGE_SIZE);
  const lastPage = Math.max(0, Math.ceil(result.total / PAGE_SIZE) - 1);
  const safePage = Math.min(result.page, lastPage);
  if (safePage !== result.page) return renderList(ctx, safePage);
  const rows = result.accounts.map(account => [Markup.button.callback(
    `@${account.handle} · ${account.tier} ${account.enabled ? '🟢' : '🔴'}`, `XIA_MANAGE_${account.id}_${safePage}`,
  )]);
  const navigation = [];
  if (safePage > 0) navigation.push(Markup.button.callback('⬅️ Previous', `XIA_LIST_${safePage - 1}`));
  if ((safePage + 1) * PAGE_SIZE < result.total) navigation.push(Markup.button.callback('Next ➡️', `XIA_LIST_${safePage + 1}`));
  if (navigation.length) rows.push(navigation);
  rows.push([Markup.button.callback('⬅️ X Intelligence', 'X_INTEL_HOME')]);
  await editOrReply(ctx, renderXAccountList(result.accounts, safePage, result.total), rows);
}

async function renderAccount(ctx: any, id: number, page: number) {
  const account = await getXReputedAccount(id);
  if (!account) {
    await ctx.answerCbQuery?.('Account not found', { show_alert: true }).catch(() => {});
    return renderList(ctx, page);
  }
  await editOrReply(ctx, [
    '🐦 <b>X INTELLIGENCE — ACCOUNT</b>', '',
    `Handle: <b>@${escapeTelegramHtml(account.handle)}</b>`,
    `Display name: ${escapeTelegramHtml(account.display_name ?? 'Not set')}`,
    `Status: ${account.enabled ? '🟢 Enabled' : '🔴 Disabled'}`,
    `Tier: <b>${account.tier}</b>`,
    `Source: <b>${escapeTelegramHtml(account.source)}</b>`,
    `Source rank: ${account.source_rank ?? 'Not supplied'}`, '',
    'Watchlist classifications do not guarantee profitable calls.',
  ].join('\n'), [
    [Markup.button.callback(account.enabled ? '🔴 Disable' : '🟢 Enable', `XIA_ENABLE_${id}_${account.enabled ? 0 : 1}_${page}`)],
    [Markup.button.callback('HIGH_ALPHA', `XIA_TIER_${id}_HIGH_ALPHA_${page}`),
      Markup.button.callback('REPUTED', `XIA_TIER_${id}_REPUTED_${page}`),
      Markup.button.callback('WATCH', `XIA_TIER_${id}_WATCH_${page}`)],
    [Markup.button.callback('➖ Remove', `XIA_REMOVE_${id}_${page}`)],
    [Markup.button.callback('⬅️ Accounts', `XIA_LIST_${page}`), Markup.button.callback('🏠 Home', 'MAIN_MENU')],
  ]);
}

export function registerXIntelligenceAdmin(bot: Telegraf<any>): void {
  bot.action('X_INTEL_HOME', async ctx => {
    if (await deny(ctx)) return;
    await ctx.answerCbQuery();
    await renderHome(ctx);
  });

  bot.action('XIA_ADD', async ctx => {
    if (await deny(ctx)) return;
    await ctx.answerCbQuery();
    setConversationState(String(ctx.from.id), 'ADD_X_REPUTED_ACCOUNT');
    await ctx.reply('Send the X handle to add, for example @account.\n\nSend /cancel to stop.',
      Markup.inlineKeyboard([[Markup.button.callback('✖️ Cancel', 'XIA_CANCEL_ADD')]]));
  });

  bot.action('XIA_CANCEL_ADD', async ctx => {
    if (await deny(ctx)) return;
    clearConversationState(String(ctx.from.id));
    await ctx.answerCbQuery('Cancelled');
    await renderHome(ctx);
  });

  bot.action(/^XIA_LIST_(\d+)$/, async ctx => {
    if (await deny(ctx)) return;
    await ctx.answerCbQuery();
    await renderList(ctx, Number(ctx.match[1]));
  });

  bot.action(/^XIA_MANAGE_(\d+)_(\d+)$/, async ctx => {
    if (await deny(ctx)) return;
    await ctx.answerCbQuery();
    await renderAccount(ctx, Number(ctx.match[1]), Number(ctx.match[2]));
  });

  bot.action(/^XIA_ENABLE_(\d+)_(0|1)_(\d+)$/, async ctx => {
    if (await deny(ctx)) return;
    await setXReputedAccountEnabled(Number(ctx.match[1]), ctx.match[2] === '1');
    await ctx.answerCbQuery(ctx.match[2] === '1' ? 'Account enabled' : 'Account disabled');
    await renderAccount(ctx, Number(ctx.match[1]), Number(ctx.match[3]));
  });

  bot.action(/^XIA_TIER_(\d+)_(HIGH_ALPHA|REPUTED|WATCH)_(\d+)$/, async ctx => {
    if (await deny(ctx)) return;
    await setXReputedAccountTier(Number(ctx.match[1]), ctx.match[2] as XAccountTier);
    await ctx.answerCbQuery(`Tier changed to ${ctx.match[2]}`);
    await renderAccount(ctx, Number(ctx.match[1]), Number(ctx.match[3]));
  });

  bot.action(/^XIA_REMOVE_(\d+)_(\d+)$/, async ctx => {
    if (await deny(ctx)) return;
    await removeXReputedAccount(Number(ctx.match[1]));
    await ctx.answerCbQuery('Account removed');
    await renderList(ctx, Number(ctx.match[2]));
  });

  bot.on('text', async (ctx, next) => {
    const telegramId = String(ctx.from?.id ?? '');
    if (!isAdmin(ctx) || getConversationState(telegramId) !== 'ADD_X_REPUTED_ACCOUNT') return next();
    const value = String(ctx.message?.text ?? '').trim();
    if (value.startsWith('/')) {
      if (value.toLowerCase() === '/cancel') {
        clearConversationState(telegramId);
        await ctx.reply('X account add cancelled.');
        return;
      }
      return next();
    }
    try {
      const account = await addXReputedAccount({ handle: value, addedBy: telegramId });
      clearConversationState(telegramId);
      await ctx.reply(`✅ @${escapeTelegramHtml(account.handle)} added as WATCH.`, {
        parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback('⚙️ Manage', `XIA_MANAGE_${account.id}_0`)],
          [Markup.button.callback('⬅️ X Intelligence', 'X_INTEL_HOME')],
        ]).reply_markup,
      });
    } catch (error) {
      await ctx.reply(`Could not add account: ${escapeTelegramHtml(error instanceof Error ? error.message : 'invalid handle')}`, {
        parse_mode: 'HTML', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('✖️ Cancel', 'XIA_CANCEL_ADD')]]).reply_markup,
      });
    }
  });
}
