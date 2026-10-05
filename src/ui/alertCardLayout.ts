import { RESEARCH_DISCLOSURE, withResearchDisclosure } from './researchDisclosure.js';
export type CardButton = { text: string; url?: string; callback_data?: string };

// Presentation only: preserve every metric, warning, URL and callback. No reads or writes.
export function cleanAlertCard(text: string): string {
  let clean = text.replace(/\r\n/g, '\n').split('\n').map(line => line.trimEnd()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  const title = clean.split('\n').find(line => line.trim()) ?? '';
  const isCard = /<code>/.test(clean) && /ALPHA|ALERT|BOOST|DEX PAID|SETUP|OPPORTUNITY|BURN|TRADE|CONTRACT SCREEN|CREATOR|PROTOCOL|MOMENTUM|TREND|MONITOR|TOKEN|WALLET/i.test(title);
  if (!isCard) return clean;
  clean = clean.replace(RESEARCH_DISCLOSURE, '').trim();
  // An empty STATS heading must not capture the following RISK section.
  clean = clean.replace(/<b>STATS<\/b>\s*(?=<b>(?:RISK(?: COVERAGE)?|SAFETY|SECURITY|SOCIALS|SOCIAL LINKS|OWNERSHIP|CONTRACT)<\/b>)/g, '');
  // Merge the supplemental stats into one readable section; never truncate for a banner.
  const stats = clean.match(/<b>KEY STATS<\/b>\n([\s\S]*?)(?=\n\n|$)/);
  if (stats) {
    clean = clean.replace(stats[0], '').replace(/\n{3,}/g, '\n\n');
    const current = clean.match(/<b>STATS<\/b>\n([\s\S]*?)(?=\n\n|\n<b>(?:RISK(?: COVERAGE)?|SAFETY|SECURITY|SOCIALS|SOCIAL LINKS|OWNERSHIP|CONTRACT)<\/b>|$)/);
    if (current) clean = clean.replace(current[0], current[0] + '\n' + stats[1]);
    else {
      const marker = clean.search(/<b>(?:RISK(?: COVERAGE)?|SAFETY|SECURITY|SOCIALS|SOCIAL LINKS|OWNERSHIP|CONTRACT)<\/b>/);
      const block = '<b>STATS</b>\n' + stats[1] + '\n\n';
      clean = marker >= 0 ? clean.slice(0, marker).trimEnd() + '\n\n' + block + clean.slice(marker) : clean.trimEnd() + '\n\n' + block.trimEnd();
    }
  }
  const promotion: string[] = [];
  clean = clean.split('\n').filter(line => {
    const plain = line.replace(/<[^>]*>/g, '');
    if (/^(?:[⚡🔥💎]\s*)?(?:Boost\s+\d|DEX Paid\s+|Dex Paid\s+)/.test(plain)) { promotion.push(line.trim()); return false; }
    return true;
  }).join('\n');
  // Remove any old promotion heading so edits remain idempotent.
  clean = clean.replace(/<b>(?:PROMOTION|WHY ALERTED)<\/b>\n*/g, '');
  if (promotion.length) {
    const marker = clean.search(/<b>(?:STATS|RISK(?: COVERAGE)?|SAFETY|SECURITY|SOCIALS|SOCIAL LINKS|OWNERSHIP|CONTRACT)<\/b>/);
    const block = '<b>WHY ALERTED</b>\n' + [...new Set(promotion)].join('\n') + '\n\n';
    clean = marker >= 0 ? clean.slice(0, marker).trimEnd() + '\n\n' + block + clean.slice(marker) : clean.trimEnd() + '\n\n' + block.trimEnd();
  }
  // Route risk disclosures out of the supplemental market stats block.
  const risk: string[] = [];
  clean = clean.split('\n').filter(line => {
    if (/^(?:Sellability|LP status|LP lock status)\s/.test(line)) { risk.push(line); return false; }
    return true;
  }).join('\n');
  if (risk.length) {
    const heading = clean.match(/<b>(?:RISK(?: COVERAGE)?|SAFETY|SECURITY)<\/b>/);
    if (heading) clean = clean.replace(heading[0], heading[0] + '\n' + risk.join('\n'));
    else {
      const marker = clean.search(/<b>(?:SOCIALS|SOCIAL LINKS|OWNERSHIP|CONTRACT)<\/b>/);
      const block = '<b>RISK</b>\n' + risk.join('\n') + '\n\n';
      clean = marker >= 0 ? clean.slice(0,marker).trimEnd() + '\n\n' + block + clean.slice(marker) : clean + '\n\n' + block.trimEnd();
    }
  }
  const footers: string[] = [];
  clean = clean.split('\n').filter(line => {
    if (/^(?:Source )?.* · Checked \d{2}:\d{2}:\d{2} UTC$/.test(line)) { footers.push(line.replace(/^Source /, '').replace('PONS-mapped graduated pool','PONS mapped pool')); return false; }
    return true;
  }).join('\n');
  if (footers.length) clean = clean.trimEnd() + '\n' + [...new Set(footers)].join('\n');
  clean = clean.replace(/(<a href="https:\/\/(?:x\.com|twitter\.com)\/([A-Za-z0-9_]{1,15})\/?">)X(<\/a>)/g, '$1@$2$3');
  clean = clean.replace(/<b>STATS<\/b>\s*(?=<b>RISK<\/b>)/g, '');
  return withResearchDisclosure(clean.replace(/\n{3,}/g, '\n\n').replace(/\n\n(?=\n)/g, '\n\n').trim());
}

export function cleanAlertButtons<T extends CardButton>(rows: T[][] | undefined, text = ''): T[][] | undefined {
  if (!rows) return rows;
  const seen = new Set<string>();
  const buttons = rows.flat().filter(button => {
    // Remove social controls only when the exact destination remains clickable
    // in the message. Every other action and callback remains available.
    if (button.url && /^https:\/\/(?:x\.com|twitter\.com|t\.me)\//i.test(button.url)
      && text.includes(`href="${button.url.replace(/&/g,'&amp;')}"`)) return false;
    const key = button.callback_data ? 'callback:' + button.callback_data : button.url ? 'url:' + button.url : 'text:' + button.text;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
  // Put the four primary research controls first when present. Preserve all other actions.
  const primary = [/DexScreener|Chart/i, /Full Intel/i, /^.*Track\b/i, /Copy CA/i]
    .map(pattern => buttons.find(button => pattern.test(button.text)))
    .filter((button): button is T => Boolean(button));
  const ordered = [...new Set(primary), ...buttons.filter(button => !primary.includes(button))];
  const result: T[][] = [];
  for (let i = 0; i < ordered.length; i += 2) result.push(ordered.slice(i, i + 2));
  return result;
}
