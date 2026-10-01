import sharp from 'sharp';
import { readFileSync } from 'node:fs';
const font = JSON.parse(readFileSync(new URL('./assets/alphaosGlyphs.json', import.meta.url), 'utf8')) as {
  units: number; glyphs: Record<string, { path: string; width: number }>;
};

// Outlined glyphs make the banner identical on Railway without system font installs.
function text(value: string, x: number, y: number, size: number, color: string, width = 1_000): string {
  const chars = [...value.normalize('NFKD').replace(/[^\x20-\x7e]/g, '')].slice(0, 90);
  const measured = chars.reduce((total, c) => total + font.glyphs[c].width, 0);
  const scale = Math.min(size / font.units, width / Math.max(1, measured));
  let offset = 0;
  const paths = chars.map(c => { const glyph = font.glyphs[c]; const path = `<path transform="translate(${offset},0)" d="${glyph.path}"/>`; offset += glyph.width; return path; });
  return `<g fill="${color}" transform="translate(${x},${y}) scale(${scale},${-scale})">${paths.join('')}</g>`;
}

export function alphaosAlertCardSvg(args: { symbol?: string | null; name?: string | null }): string {
  const symbol = (args.symbol ?? '').replace(/^\$+/, '').trim();
  const title = symbol ? `$${symbol.toUpperCase()}` : 'Launchpad discovery';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="540" viewBox="0 0 1200 540">
  <defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#0c1830"/><stop offset="1" stop-color="#080d1d"/></linearGradient>
  <radialGradient id="glow"><stop stop-color="#644bf2" stop-opacity=".32"/><stop offset="1" stop-color="#644bf2" stop-opacity="0"/></radialGradient></defs>
  <rect width="1200" height="540" fill="url(#bg)"/><ellipse cx="1010" cy="210" rx="430" ry="390" fill="url(#glow)"/>
  <g stroke="#243251" stroke-width="1" opacity=".6"><circle cx="990" cy="230" r="205" fill="none"/><circle cx="990" cy="230" r="260" fill="none"/><path d="M770 0v540M0 430h1200"/></g>
  <rect x="54" y="44" width="48" height="48" rx="14" fill="#55e0d0"/>
  <path d="M65 79L78 56L91 79M70 72h16" fill="none" stroke="#0c1830" stroke-width="5" stroke-linejoin="round"/>
  ${text('ALPHAOS', 117, 78, 28, '#eef5ff')}${text('SOCIAL MAFIA', 58, 177, 24, '#55e0d0')}
  ${text(title, 54, 270, 64, '#ffffff', 710)}${text(args.name || 'Verified PONS launchpad origin', 58, 323, 24, '#adbad1', 700)}
  <rect x="56" y="357" width="327" height="41" rx="20" fill="#183c40" stroke="#32615e"/>
  ${text('CA LISTED ON X', 77, 384, 18, '#91eddf')}
  <rect x="876" y="126" width="240" height="240" rx="42" fill="#131f39" stroke="#43506d"/>
  <path d="M932 302L996 179L1060 302M955 260h82" fill="none" stroke="#8d84ff" stroke-width="17" stroke-linejoin="round"/>
  ${text('PONS / ROBINCHAIN', 58, 471, 21, '#d0dbee')}${text('Contract publication matched. Ownership and safety unverified.', 58, 507, 17, '#8391ab', 1060)}
  </svg>`;
}

export function ponsImageUrl(logo: string | null | undefined): string | null {
  const match = logo?.match(/^ipfs:\/\/((?:Qm[1-9A-HJ-NP-Za-km-z]{44}|bafy[a-z2-7]{20,100}))(\/[A-Za-z0-9_.-]+)?$/);
  return match ? `https://ipfs.io/ipfs/${match[1]}${match[2] ?? ''}` : null;
}

async function tokenImage(logo?: string | null): Promise<Buffer | null> {
  const url = ponsImageUrl(logo); if (!url) return null;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1_500), redirect: 'error' });
    if (!response.ok || !/^image\/(png|jpeg|webp)(?:;|$)/i.test(response.headers.get('content-type') ?? '')) return null;
    const reader = response.body?.getReader(); if (!reader) return null;
    const chunks: Buffer[] = []; let size = 0;
    try { while (true) { const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.length; if (size > 1_000_000) return null; chunks.push(Buffer.from(chunk.value)); } }
    finally { await reader.cancel().catch(() => {}); }
    const image = await sharp(Buffer.concat(chunks), { limitInputPixels: 4_000_000 }).resize(224, 224, { fit: 'cover' }).png().toBuffer();
    const mask = Buffer.from('<svg width="224" height="224"><rect width="224" height="224" rx="34" fill="white"/></svg>');
    return sharp(image).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
  } catch { return null; }
}

export async function buildAlphaosAlertCard(args: { symbol?: string | null; name?: string | null; logo?: string | null }): Promise<Buffer> {
  const image = await tokenImage(args.logo);
  return sharp(Buffer.from(alphaosAlertCardSvg(args))).composite(image ? [{ input: image, left: 884, top: 134 }] : []).png().toBuffer();
}
