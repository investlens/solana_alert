export type OwnershipDisclosure = {
  devPercent: number | null;
  devInitialPercent?:number; devInitialObservedAt?:number;
  devSource?:'RPC'|'BLOCKSCOUT_INDEXED';
  creator?: string | null;
  devObservedAt?:number;devBlock?:string;top10ObservedAt?:number;
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
    ...(evidence.creator && /^0x[a-f0-9]{40}$/i.test(evidence.creator) && !/^0x0{40}$/i.test(evidence.creator)
      ? [`Creator <a href="https://robinhoodchain.blockscout.com/address/${evidence.creator}">${evidence.creator.slice(0,8)}…${evidence.creator.slice(-4)}</a>`] : []),
    `👨‍💻 Dev holding${evidence.devSource==='BLOCKSCOUT_INDEXED'?' · indexed':''}  <b>${effectiveDev == null ? 'Unavailable' : effectiveDev > 0 && effectiveDev < 0.005 ? '&lt;0.01%' : effectiveDev.toFixed(2) + '%'}</b>`,
    `👥 Top 10${evidence.top10Coverage === 'INDEXED_SAMPLE' ? ' · indexed sample' : evidence.top10Coverage === 'PROVIDER_REPORTED' ? ' · provider wallet sample' : ''}  <b>${top == null ? 'Unavailable' : top.toFixed(2) + '%'}</b>`,
    ...(dev != null && Number.isFinite(evidence.devObservedAt) ? [`Dev observed ${new Date(evidence.devObservedAt!).toISOString().slice(11,19)} UTC${evidence.devBlock ? ' · on-chain block '+evidence.devBlock.replace(/[^0-9]/g,'') : ' · provider reported'}`] : []),
    ...(top != null && Number.isFinite(evidence.top10ObservedAt) ? [`Holder sample observed ${new Date(evidence.top10ObservedAt!).toISOString().slice(11,19)} UTC`] : []),
    ...(dev != null && validOwnershipPercent(evidence.devInitialPercent) != null && Number.isFinite(evidence.devInitialObservedAt) && Number.isFinite(evidence.devObservedAt) && evidence.devObservedAt! > evidence.devInitialObservedAt! ? [`Creator balance change <b>${dev-evidence.devInitialPercent!>=0?'+':''}${(dev-evidence.devInitialPercent!).toFixed(2)} pp</b> since ${new Date(evidence.devInitialObservedAt!).toISOString().slice(11,19)} UTC · observed wallet balance, not proof of selling`] : []),
    ...(effectiveDev != null && effectiveDev >= 10 ? ['⚠️ Concentrated dev holding · potential sell pressure'] : []),
    ...(evidence.devSource==='BLOCKSCOUT_INDEXED'?['Explorer indexed balance · live block not confirmed']:[]),
    ...(effectiveDev === 0 ? ['Creator wallet balance only · sale, transfer or burn not established'] : []),
  ].join('\n');
  const contractMarker = clean.indexOf('<b>CONTRACT</b>');
  const marker = contractMarker >= 0 ? contractMarker : clean.indexOf('<code>');
  return marker >= 0 ? clean.slice(0, marker).trimEnd() + '\n\n' + lines + '\n\n' + clean.slice(marker)
    : clean.trimEnd() + '\n\n' + lines;
}
