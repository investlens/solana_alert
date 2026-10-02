export type SocialContractConfirmation = {
  confirmed: boolean;
  reason: 'X_CONTRACT_MATCH' | 'X_UNAVAILABLE' | 'X_CONTENT_UNREADABLE' | 'X_CONTRACT_NOT_CONFIRMED' | 'TELEGRAM_CONTRACT_CONFLICT';
};

function plainText(html: string): string {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]*>/g, ' ').replace(/&#x([a-f0-9]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&nbsp;|&amp;|&quot;|&#39;/g, ' ').replace(/\s+/g, ' ').trim();
}

// Only biography and author-attributed post text count. URLs, scripts, widgets and
// arbitrary mentions elsewhere on a profile page cannot confirm a contract.
export function xProjectStatements(html: string, handle: string): string[] {
  html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
  const statements: string[] = [];
  const bio = html.match(/<div\b[^>]*data-testid=["']UserDescription["'][^>]*>([\s\S]*?)<\/div>/i)?.[1];
  if (bio) statements.push(plainText(bio));
  for (const article of html.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/gi)) {
    const author = article[1].match(/data-testid=["']User-Name["'][^>]*>([\s\S]*?)<\/div>/i)?.[1];
    const authors = author ? [...author.matchAll(/href=["']\/([a-z0-9_]+)["']/gi)].map(m => m[1].toLowerCase()) : [];
    if (!authors.length || authors.some(name => name !== handle.toLowerCase())) continue;
    const post = article[1].match(/<div\b[^>]*data-testid=["']tweetText["'][^>]*>([\s\S]*?)<\/div>/i)?.[1];
    if (post) statements.push(plainText(post));
  }
  return statements.filter(Boolean);
}

export function confirmsRobinchainContract(statement: string, token: string): boolean {
  if (!/^0x[a-f0-9]{40}$/i.test(token)) return false;
  const addresses = statement.match(/\b0x[a-f0-9]{40}\b/gi) ?? [];
  // Require explicit chain context in the same short statement. A Solana-only
  // announcement or an address buried in an unrelated post is not confirmation.
  return statement.length <= 2_000 && /\b(?:robinhood(?:\s+chain)?|robinchain)\b/i.test(statement)
    && /\b(?:CA|contract|token address)\b/i.test(statement)
    && addresses.length === 1 && addresses[0].toLowerCase() === token.toLowerCase()
    && !/\b(?:fake|scam|impersonat\w*|do not buy|not our|unofficial)\b/i.test(statement);
}

export async function readPublicSocialHtml(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(3_000), redirect: 'error', headers: { accept: 'text/html' } });
    if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) return null;
    const reader = response.body?.getReader(); if (!reader) return null;
    let size = 0; let html = ''; const decoder = new TextDecoder();
    try {
      while (true) { const chunk = await reader.read(); if (chunk.done) break;
        size += chunk.value.byteLength; if (size > 512_000) return null;
        html += decoder.decode(chunk.value, { stream: true }); }
      return html + decoder.decode();
    } finally { await reader.cancel().catch(() => {}); }
  } catch { return null; }
}

export async function verifySocialContract(args: {
  token: string; xHandle: string; telegramUrl: string;
}, readHtml = readPublicSocialHtml): Promise<SocialContractConfirmation> {
  if (!/^[A-Za-z0-9_]{1,15}$/.test(args.xHandle) || !/^0x[a-f0-9]{40}$/i.test(args.token))
    return { confirmed: false, reason: 'X_CONTRACT_NOT_CONFIRMED' };
  const x = await readHtml(`https://x.com/${args.xHandle}`).catch(() => null);
  if (!x) return { confirmed: false, reason: 'X_UNAVAILABLE' };
  const statements = xProjectStatements(x, args.xHandle);
  if (!statements.length) return { confirmed: false, reason: 'X_CONTENT_UNREADABLE' };
  if (!statements.some(statement => confirmsRobinchainContract(statement, args.token)))
    return { confirmed: false, reason: 'X_CONTRACT_NOT_CONFIRMED' };
  try {
    const url = new URL(args.telegramUrl);
    if (['t.me', 'telegram.me', 'telegram.dog'].includes(url.hostname) && /^\/[A-Za-z][A-Za-z0-9_]{4,31}\/?$/.test(url.pathname)) {
      const tg = await readHtml(`https://t.me${url.pathname}`).catch(() => null);
      const description = tg?.match(/class=["']tgme_page_description["'][^>]*>([\s\S]*?)<\/div>/i)?.[1];
      const text = description ? plainText(description) : '';
      const addresses = text.match(/\b0x[a-f0-9]{40}\b/gi) ?? [];
      if (/\b(?:CA|contract|token address)\b/i.test(text) && addresses.length === 1 && addresses[0].toLowerCase() !== args.token.toLowerCase())
        return { confirmed: false, reason: 'TELEGRAM_CONTRACT_CONFLICT' };
    }
  } catch { /* Telegram type/availability is separate; it never substitutes for X confirmation. */ }
  return { confirmed: true, reason: 'X_CONTRACT_MATCH' };
}
