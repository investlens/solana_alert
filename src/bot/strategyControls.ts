import { Markup, type Telegraf } from 'telegraf';
import { requireCapability } from './accessControl.js';
import { LIVE_ALERT_FEEDS, liveAlertPreferences, toggleLiveFeed, isLiveFeedKey } from '../services/liveAlertPreferences.js';

async function renderPreferences(ctx:any):Promise<void> {
  const user=String(ctx.from?.id??'');if(!user)return;
  const prefs=await liveAlertPreferences(user);
  const lines=['⚙️ <b>ALERT SETTINGS</b>','','Choose the feeds you want to receive.','✅ ON · ⭕ OFF. Changes apply to upcoming alerts.','Free: 30-second release delay · Pro: priority delivery.','Risk warnings remain separate from discovery preferences.',''];
  const rows:any[][]=[];
  for(const chain of ['Robinchain / PONS','ARC']) {
    lines.push(`<b>${chain}</b>`);
    const feeds=LIVE_ALERT_FEEDS.filter(feed=>feed.chain===chain);
    for(const feed of feeds)lines.push(`${prefs[feed.key]?'✅':'⭕'} <b>${feed.name}</b> — ${feed.description}`);
    lines.push('');
    for(let i=0;i<feeds.length;i+=2) rows.push(feeds.slice(i,i+2).map(feed=>Markup.button.callback(`${prefs[feed.key]?'✅':'⭕'} ${chain==='ARC'?'ARC ':''}${feed.name}`,`FEED_TOGGLE_${feed.key}`)));
  }
  lines.push('<i>Alerts require qualifying data. Social and ARC security coverage can limit delivery.</i>');
  rows.push([Markup.button.callback('↻ Refresh','STRATEGY_SETTINGS'),Markup.button.callback('⌂ Home','MAIN_MENU')]);
  const options={parse_mode:'HTML' as const,...Markup.inlineKeyboard(rows)};
  if(ctx.callbackQuery?.message) {try{await ctx.editMessageText(lines.join('\n'),options);return;}catch(error){if(String(error).includes('message is not modified'))return;}}
  await ctx.reply(lines.join('\n'),options);
}
export function registerStrategyControls(bot:Telegraf<any>):void {
  const open=async(ctx:any)=>{
    if(!await requireCapability(ctx,'strategies.manage','MAIN_MENU'))return;
    await ctx.answerCbQuery?.().catch(()=>{});
    try{await renderPreferences(ctx);}catch{await ctx.reply('Alert preferences are temporarily unavailable. Your saved choices have not changed.');}
  };
  bot.command('strategies',open);
  for(const callback of ['SETTINGS','STRATEGY_SETTINGS','STRATEGY_ADVANCED'])bot.action(callback,open);
  bot.action(/^FEED_TOGGLE_(.+)$/,async ctx=>{
    if(!await requireCapability(ctx,'strategies.manage','MAIN_MENU'))return;
    const key=String(ctx.match?.[1]??'');if(!isLiveFeedKey(key)){await ctx.answerCbQuery('Unknown feed');return;}
    try{const enabled=await toggleLiveFeed(String(ctx.from?.id??''),key);await ctx.answerCbQuery(enabled?'Alerts enabled':'Alerts muted');await renderPreferences(ctx);}
    catch{await ctx.answerCbQuery('Update unavailable. Please refresh before retrying.',{show_alert:true});}
  });
  bot.action(/^STRAT_TOGGLE_(.+)$/,open);
}
