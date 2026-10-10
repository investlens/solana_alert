import { getWalletLinkResearch, renderWalletLinkResearch } from '../services/walletLinkResearch.js';
import { getCompactTokenView, getCompactCreatorView, renderCompactTokenView, renderCompactCreatorView } from '../services/compactOutcomeViews.js';
import type { Telegraf } from 'telegraf';
import { requireCapability } from './accessControl.js';
import { getRobinhoodTokenIntelligence } from '../services/tokenIntelligenceService.js';
import { renderTokenIntelligence, tokenIntelligenceButtons } from '../ui/tokenIntelligenceView.js';
import { trackRuntimeToken } from '../services/runtimeTokenTracking.js';
import { getPositionCheck, hasCachedPonsCurve, type PositionSize } from '../services/positionCheckService.js';
import { renderPositionCheck, positionCheckButtons } from '../ui/positionCheckView.js';

const activeReplies = new Set<string>();

export function registerTokenIntelligenceActions(bot: Telegraf<any>) {
  console.log('[CompactViews] READY creatorOutcomes=true tokenCheckpoints=true cachedReads=true marketPolling=false');
  console.log('[PositionCheck] READY sizes=0.001,0.01,0.05 mode=READ_ONLY source=PONS_NATIVE_CURVE_MODEL');
  bot.action(/^PC_RH_(0\.001|0\.01|0\.05)_(0x[a-fA-F0-9]{40})$/, async ctx => {
    if (!await requireCapability(ctx, 'intelligence.investigations', 'POSITION_CHECK')) return;
    await ctx.answerCbQuery('Checking position evidence…').catch(() => {});
    const key = `position:${String(ctx.from?.id ?? '')}`;
    if (activeReplies.has(key)) return;
    activeReplies.add(key);
    try {
      const check = await getPositionCheck(ctx.match[2], ctx.match[1] as PositionSize);
      const options = { parse_mode: 'HTML' as const, link_preview_options: { is_disabled: true },
        reply_markup: { inline_keyboard: positionCheckButtons(check.token, Boolean(check.quote)) } };
      const previous = ctx.callbackQuery?.message;
      if (previous && 'text' in previous && previous.text.startsWith('🎯 POSITION CHECK')) {
        await ctx.editMessageText(renderPositionCheck(check), options);
      } else await ctx.reply(renderPositionCheck(check), options);
    } catch {
      await ctx.reply('Position Check is unavailable or busy. Please try again shortly.').catch(() => {});
    } finally { activeReplies.delete(key); }
  });
  bot.action(/^WL_RH_(0x[a-fA-F0-9]{40})$/, async ctx => {
    if (!await requireCapability(ctx,'intelligence.creators','INTELLIGENCE_CENTER')) return;
    await ctx.answerCbQuery('Checking observed wallet relationships…').catch(()=>{});
    const key=`links:${ctx.from?.id}`; if(activeReplies.has(key)) return; activeReplies.add(key);
    try { await ctx.reply(renderWalletLinkResearch(await getWalletLinkResearch(ctx.match[1])),{parse_mode:'HTML',link_preview_options:{is_disabled:true},reply_markup:{inline_keyboard:[[{text:'🧠 Full Intel',callback_data:`FI_RH_${ctx.match[1]}`}]]}}); }
    catch { await ctx.reply('Wallet-link research is busy or unavailable. Please retry shortly.').catch(()=>{}); }
    finally { activeReplies.delete(key); }
  });
  bot.action(/^COPY_CA_(0x[a-fA-F0-9]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/, async ctx => {
    const token = String(ctx.match[1]);
    await ctx.answerCbQuery('Contract address ready').catch(() => {});
    await ctx.reply(`<code>${token}</code>`, { parse_mode: 'HTML' }).catch(() => {});
  });

  async function outcomes(ctx:any, chain:string, address:string, creator=false, refresh=false) {
    if (!await requireCapability(ctx, creator?'intelligence.creators':'watchlist.use')) return;
    await ctx.answerCbQuery('Loading recorded outcomes…').catch(()=>{});
    const key=`outcome:${ctx.from?.id}`; if(activeReplies.has(key)) return; activeReplies.add(key);
    try {
      const result=creator ? renderCompactCreatorView(chain,address,await getCompactCreatorView(chain,address))
        : renderCompactTokenView(chain,address,await getCompactTokenView(chain,address));
      const tag=chain==='robinhood'?'RH':chain==='arc'?'ARC':'SOL';
      const options={parse_mode:'HTML' as const,link_preview_options:{is_disabled:true},reply_markup:{inline_keyboard:[
        [{text:'↻ Refresh',callback_data:`${creator?'CO':'OUT'}_${tag}_${address}`}],
      ]}};
      const previous=ctx.callbackQuery?.message;
      if(refresh && previous && 'text' in previous && /^⭐ ALPHAOS · ALERT TRACKING|^👤 ALPHAOS · CREATOR OUTCOMES/.test(previous.text)) {
        await ctx.editMessageText(result,options).catch(async(error:unknown)=>{if(!/message is not modified/i.test(String(error))) throw error;});
      } else await ctx.reply(result,options);
    } catch {await ctx.reply('Recorded outcomes are temporarily unavailable. Please try again shortly.').catch(()=>{});}
    finally{activeReplies.delete(key);}
  }
  bot.action(/^BOOST_TRACK_(0x[a-fA-F0-9]{40})$/, async ctx => {
    if (!await requireCapability(ctx,'watchlist.use')) return;
    trackRuntimeToken(String(ctx.from?.id??''),String(ctx.match[1]));
    await outcomes(ctx,'robinhood',ctx.match[1]);
  });
  bot.action(/^(OUT|CO)_(RH|ARC|SOL)_([1-9A-HJ-NP-Za-km-z]{32,44}|0x[a-fA-F0-9]{40})$/, async ctx => {
    await outcomes(ctx,ctx.match[2]==='RH'?'robinhood':ctx.match[2]==='ARC'?'arc':'solana',ctx.match[3],ctx.match[1]==='CO',true);
  });
  bot.action(/^FI_RH_(0x[a-fA-F0-9]{40})$/, async ctx => {
    if (!await requireCapability(ctx, 'intelligence.investigations', 'TOKEN_INTELLIGENCE')) return;
    await ctx.answerCbQuery('Building token intelligence…').catch(() => {});
    const replyKey = `${String(ctx.from?.id ?? '')}:${String(ctx.match[1]).toLowerCase()}`;
    if (activeReplies.has(replyKey)) return;
    activeReplies.add(replyKey);
    try {
      const intel = await getRobinhoodTokenIntelligence(ctx.match[1]);
      await ctx.reply(renderTokenIntelligence(intel), { parse_mode: 'HTML',
        link_preview_options: { is_disabled: true }, reply_markup: { inline_keyboard: tokenIntelligenceButtons(intel, !intel.chartUrl && await hasCachedPonsCurve(intel.tokenAddress)) } });
    } catch (error) {
      console.error('[TokenIntel]', { event: 'ANALYSIS_FAILED', token: ctx.match[1],
        reason: error instanceof Error ? error.message : String(error) });
      await ctx.reply('Token intelligence could not be completed. No monitoring, alerts, or trading settings were changed.').catch(() => {});
    } finally { activeReplies.delete(replyKey); }
  });
}
