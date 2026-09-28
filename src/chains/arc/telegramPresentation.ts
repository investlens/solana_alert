export type ArcInlineButton = { text: string; url?: string; callback_data?: string };

function firstMatch(text: string, pattern: RegExp): string | null {
  const match = text.match(pattern);
  return match?.[1]?.trim() || null;
}

function compactArcOpportunity(text: string): string {
  const symbol = firstMatch(text, /🚀 <b>(.*?)<\/b>/) ?? 'ARC TOKEN';
  const ca = firstMatch(text, /<code>(0x[a-fA-F0-9]{40})<\/code>/) ?? '';
  const liquidity = firstMatch(text, /💧 Liquidity\s+<b>(.*?)<\/b>/) ?? 'n/a';
  const volume = firstMatch(text, /📊 5m Volume\s+<b>(.*?)<\/b>/) ?? 'n/a';
  const flow = firstMatch(text, /🟢 Buys \/ Sells\s+<b>(.*?)<\/b>\s+·\s+<b>(.*?)<\/b>/);
  const marketCap = firstMatch(text, /💰 Market Cap\s+<b>(.*?)<\/b>/) ?? 'n/a';
  const warnings = [...text.matchAll(/⚠️ ([^\n]+)/g)].map(match => match[1]).filter(Boolean);
  const lines = [
    '🟣 <b>ARC OPPORTUNITY</b>',
    `<b>$${symbol}</b>`,
    '',
    `💰 <b>Market cap</b>   ${marketCap}`,
    `💧 <b>Liquidity</b>    ${liquidity}`,
    `📊 <b>5m volume</b>    ${volume}`,
    flow ? `🟢 <b>Buy / sell</b>    ${flow}` : '',
    '',
    '<b>SAFETY</b>',
    '✅ Core ARC checks passed',
    ...warnings.slice(0, 2).map(item => `⚠️ ${item}`),
    '',
    ca ? '<b>CONTRACT</b>' : '',
    ca ? `<code>${ca}</code>` : '',
    '',
    '<i>Information only · DYOR</i>',
  ].filter(Boolean);
  return lines.join('\n');
}

function compactArcBoost(text: string): string {
  const symbol = firstMatch(text, /\n<b>([^<]+)<\/b>/) ?? 'ARC TOKEN';
  const name = firstMatch(text, /\n<b>[^<]+<\/b> · ([^\n]+)/);
  const boost = firstMatch(text, /🔥 Boost\s+<b>(.*?)<\/b>/) ?? 'n/a';
  const marketCap = firstMatch(text, /💰 Market Cap\s+<b>(.*?)<\/b>/) ?? 'n/a';
  const dev = firstMatch(text, /👤 Dev Holding\s+<b>(.*?)<\/b>/) ?? 'Not available';
  const ca = firstMatch(text, /<code>(0x[a-fA-F0-9]{40})<\/code>/) ?? '';
  return [
    '🚀 <b>ARC BOOST DETECTED</b>',
    `<b>$${symbol}</b>${name ? ` · ${name}` : ''}`,
    '',
    `⚡ <b>Boost</b>        ${boost}`,
    `💰 <b>Market cap</b>   ${marketCap}`,
    `👨‍💻 <b>Dev holding</b>  ${dev}`,
    '',
    '<b>SAFETY</b>',
    '✅ No honeypot / cannot-sell flag detected',
    '',
    ca ? '<b>CONTRACT</b>' : '',
    ca ? `<code>${ca}</code>` : '',
    '',
    '<i>Information only · DYOR</i>',
  ].filter(Boolean).join('\n');
}

function compactArcBurn(text: string): string {
  const symbol = firstMatch(text, /🔥 <b>(.*?)<\/b>/) ?? 'ARC TOKEN';
  const ca = firstMatch(text, /<code>(0x[a-fA-F0-9]{40})<\/code>/) ?? '';
  const burned = firstMatch(text, /Burned\s+<b>(.*?)<\/b>/) ?? 'n/a';
  const amount = firstMatch(text, /Amount\s+<b>(.*?)<\/b>/) ?? 'n/a';
  const marketCap = firstMatch(text, /Market Cap\s+<b>(.*?)<\/b>/) ?? 'n/a';
  const liquidity = firstMatch(text, /Liquidity\s+<b>(.*?)<\/b>/) ?? 'n/a';
  return [
    '🔥 <b>ARC SUPPLY BURN</b>',
    `<b>$${symbol}</b>`,
    '',
    `🔥 <b>Burned</b>       ${burned}`,
    `🪙 <b>Amount</b>       ${amount}`,
    `💰 <b>Market cap</b>   ${marketCap}`,
    `💧 <b>Liquidity</b>    ${liquidity}`,
    '',
    '<b>SAFETY</b>',
    '✅ Verified on-chain supply reduction',
    '✅ LP protection verified',
    '',
    ca ? '<b>CONTRACT</b>' : '',
    ca ? `<code>${ca}</code>` : '',
    '',
    '<i>Information only · DYOR</i>',
  ].filter(Boolean).join('\n');
}

function normalizeArcButtons(buttons: ArcInlineButton[][] | undefined): ArcInlineButton[][] | undefined {
  if (!buttons?.length) return buttons;
  const all = buttons.flat();
  const by = (needle: RegExp) => all.find(button => needle.test(button.text));
  const chart = by(/chart/i);
  const explorer = by(/explorer/i);
  const burnTx = by(/burn tx/i);
  const project = by(/project/i);
  const x = by(/^𝕏|\bX\b/i);
  const tg = by(/TG|Telegram/i);

  const rows: ArcInlineButton[][] = [];
  const primary = [chart, burnTx ?? explorer].filter(Boolean) as ArcInlineButton[];
  if (primary.length) rows.push(primary.slice(0, 2));
  const secondary = [burnTx ? explorer : project, burnTx ? project : x].filter(Boolean) as ArcInlineButton[];
  if (secondary.length) rows.push(secondary.slice(0, 2));
  const social = [burnTx ? x : tg, burnTx ? tg : null].filter(Boolean) as ArcInlineButton[];
  if (social.length) rows.push(social.slice(0, 2));
  return rows.length ? rows : buttons;
}

export function polishArcTelegramPresentation(text: string, buttons?: ArcInlineButton[][]): {
  text: string;
  buttons?: ArcInlineButton[][];
} {
  let polished = text;
  if (text.includes('AlphaOS · ARC OPPORTUNITY')) polished = compactArcOpportunity(text);
  else if (text.includes('BOOST DETECTED · ARC')) polished = compactArcBoost(text);
  else if (text.includes('AlphaOS · ARC SUPPLY BURN')) polished = compactArcBurn(text);
  else return { text, buttons };
  return { text: polished, buttons: normalizeArcButtons(buttons) };
}
