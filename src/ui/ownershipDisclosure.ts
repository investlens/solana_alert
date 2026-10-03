export type OwnershipDisclosure = {
  devPercent: number | null;
  top10Percent: number | null;
  top10Coverage: 'INDEXED_SAMPLE' | 'PROVIDER_REPORTED' | 'UNAVAILABLE';
};
export function validOwnershipPercent(value: unknown): number | null {
  if (!['string', 'number'].includes(typeof value) || (typeof value === 'string' && !value.trim())) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
}
export function withOwnershipDisclosure(text: string, evidence: OwnershipDisclosure): string {
  const dev = validOwnershipPercent(evidence.devPercent);
  const top = validOwnershipPercent(evidence.top10Percent);
  const existing = text.match(/(?:Dev holding|Dev Holding|Dev holds)[^\n]*?(\d+(?:\.\d+)?)%/i);
  const effectiveDev = dev ?? validOwnershipPercent(existing?.[1]);
  const clean = text.replace(/\n?<b>OWNERSHIP<\/b>\n[^]*?(?=\n\n|$)/g, '').replace(/^.*(?:Dev holding|Dev Holding|Creator holding not verified)[^\n]*\n?/gmi, '')
    .replace(/Dev holds \d+(?:\.\d+)?%/gi, effectiveDev == null ? 'Dev holding unavailable' : `Dev holds ${effectiveDev.toFixed(2)}%`);
  const lines = ['<b>OWNERSHIP</b>',
    `👨‍💻 Dev holding  <b>${effectiveDev == null ? 'Unavailable' : effectiveDev.toFixed(2) + '%'}</b>`,
    `👥 Top 10${evidence.top10Coverage === 'INDEXED_SAMPLE' ? ' · indexed sample' : evidence.top10Coverage === 'PROVIDER_REPORTED' ? ' · provider wallet sample' : ''}  <b>${top == null ? 'Unavailable' : top.toFixed(2) + '%'}</b>`,
    ...(effectiveDev != null && effectiveDev >= 10 ? ['⚠️ Concentrated dev holding · potential sell pressure'] : []),
  ].join('\n');
  const contractMarker = clean.indexOf('<b>CONTRACT</b>');
  const marker = contractMarker >= 0 ? contractMarker : clean.indexOf('<code>');
  return marker >= 0 ? clean.slice(0, marker).trimEnd() + '\n\n' + lines + '\n\n' + clean.slice(marker)
    : clean.trimEnd() + '\n\n' + lines;
}
