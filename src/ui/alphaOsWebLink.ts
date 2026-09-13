const ALPHAOS_WEB_BASE_URL = (process.env.ALPHAOS_WEB_URL ?? 'https://alphaos-web-preview-production.up.railway.app').replace(/\/+$/, '');

export function alphaOsIntelligenceUrl(assetId: string): string {
  return `${ALPHAOS_WEB_BASE_URL}/intelligence/${encodeURIComponent(assetId)}`;
}
