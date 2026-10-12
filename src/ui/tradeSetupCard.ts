// Presentation only; selection, security, timing and action buttons are unchanged.
export function cleanTradeSetupCard(text: string): string {
  if (!text.includes('TRADE SETUP WATCH')) return text;
  const plain = (line:string) => line.replace(/<[^>]*>/g,'').replace(/^[^A-Za-z0-9]+/,'').trim();
  const lines=text.split('\n').filter(line=>line.trim());
  const take=(pattern:RegExp)=>lines.filter(line=>pattern.test(plain(line))).at(-1);
  const nonempty=(pattern:RegExp)=>{const line=take(pattern);return line&&!/Unavailable$/i.test(plain(line))?line:undefined;};
  const valuation=[nonempty(/^(?:Price)\s/i),nonempty(/^(?:Market cap|MC)\s/i),nonempty(/^FDV\s/i)].filter(Boolean);
  const recovery=take(/^(?:Recovery from observed low|Observed recovery|Confirmed breakout from observed base)\s/);
  const age=take(/^(?:Launch age|Pair age)\s/);
  const holding=take(/^Dev holding\s/),top=take(/^Top 10/);
  const risk=lines.filter(line=>/RISKY ALERT|HIGH RUG RISK|LIQUIDITY NOT LOCKED|LIQUIDITY PROTECTION UNVERIFIED|LP LOCK STATUS|LP lock:|HARD BLOCK/i.test(plain(line)));
  const activity=[nonempty(/^Vol\s*·\s*5m\s/i),nonempty(/^Trades\s*·\s*5m\s/i)].filter(Boolean);
  const paid=take(/^DEX Paid\s/i);
  const timestamp=take(/^Evidence checked /);
  const contract=lines.find(line=>/<code>0x[a-f0-9]{40}<\/code>/i.test(line));
  const links=lines.find(line=>plain(line).startsWith('Creator wallet'));
  return [
    '🎯 <b>TRADE SETUP WATCH</b>',lines[1],lines[2],
    valuation.join(' · '),'',
    '<b>WHY WATCHING</b>',
    [age,recovery?.replace('Recovery from observed low','Recovery').replace('Observed recovery','Recovery').replace('Confirmed breakout from observed base','Breakout')].filter(Boolean).join(' · '),
    take(/^Creator transfers\s/)?.replace('Creator transfers','Dev transfers'),
    '', '<b>STATS</b>',
    take(/^(?:DEX liquidity|Curve quote reserve)\s/),
    activity.length?activity.join(' · '):'DEX activity <b>Unavailable</b> · no volume confirmation',
    nonempty(/^Bonding progress\s/),
    [holding,top].filter(Boolean).join(' · '),
    paid?'Promotion · '+paid:undefined,
    '', '<b>RISK</b>',
    'Entry <b>Unconfirmed</b> · Exit/slippage <b>Unverified</b>',
    'Linked wallets <b>Unchecked</b> · Social ownership <b>Unverified</b>',
    take(/^Observed low \/ invalidation reference\s/)?.replace('Observed low / invalidation reference','Invalidation low'),
    'Invalid if price breaks that low or the creator moves tokens.',
    ...[...new Set(risk)],
    take(/^Liquidity\s.*Bonding curve/i),
    links,'',contract,timestamp,
  ].filter(line=>line!==undefined&&line!==null).join('\n').replace(/\n{3,}/g,'\n\n').trim();
}

export function tradeSetupDeliveryFlags(source: 'CURVE' | 'DEX') {
  return { preBond: source === 'CURVE', setupControls: true };
}
