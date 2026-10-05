// Scope presentation to Trade Setup. Promotion trigger logic is untouched.
export function cleanTradeSetupCard(text: string): string {
  if (!text.includes('TRADE SETUP WATCH')) return text;
  const plain = (line:string) => line.replace(/<[^>]*>/g,'').trim();
  const lines = text.split('\n');
  const paid = lines.filter(line => /^DEX Paid\s/i.test(plain(line)));
  // The explicit payment disclosure is appended after generic enrichment.
  const paidLine = paid.at(-1);
  let missingActivity = false;
  const valuation: string[] = [];
  const result = lines.filter(line => {
    const p=plain(line);
    if (/^(?:Price|Market cap|MC|FDV)\s/i.test(p)) { valuation.push(line); return false; }
    if (/^DEX Paid\s/i.test(p)) return false;
    if (/^(?:Vol\s*·\s*(?:5m|24h)|Move\s*·\s*(?:5m|1h)|Trades\s*·\s*5m)\s+Unavailable$/i.test(p)) {
      missingActivity=true; return false;
    }
    if (/^Confirmation\s/.test(p)) return false;
    return true;
  }).join('\n');
  const footer = [missingActivity ? 'DEX activity windows <b>Unavailable</b> · no volume confirmation' : '', paidLine ? 'Promotion status · ' + paidLine : '']
    .filter(Boolean).join('\n');
  const parts = result.split('\n');
  parts.splice(3, 0, ...valuation);
  return parts.join('\n').replace('<b>KEY STATS</b>', '<b>STATS</b>')
    .replace('<b>CONFIRMED EVIDENCE</b>', '<b>WHY WATCHING</b>')
    .replace('Recovery from observed low', 'Observed recovery')
    .replace('Social identity  <b>Not verified for this market setup</b>', 'Social ownership <b>Unverified</b>')
    .replace('Holder concentration / linked wallets  <b>Unavailable</b>', 'Linked-wallet analysis <b>Unavailable</b>')
    .replace('Entry, position size and exit require your own execution check.', 'Entry <b>Not confirmed</b> · validate execution before trading.')
    .replace(/\n{3,}/g,'\n\n').trim() + (footer ? '\n'+footer : '');
}

export function tradeSetupDeliveryFlags(source: 'CURVE' | 'DEX') {
  return { preBond: source === 'CURVE', setupControls: true };
}
