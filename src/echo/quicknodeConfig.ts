export function readQuicknodeEchoConfig(env: NodeJS.ProcessEnv) {
  const required = (name: string) => { const value = env[name]?.trim(); if (!value) throw new Error(`Missing ${name}`); return value; };
  if (env.ECHO_ENABLED !== 'true' || env.ECHO_MODE !== 'alerts') throw new Error('Echo requires explicit alert-only activation');
  const admin = required('ECHO_ADMIN_CHAT_ID');
  if (!/^[1-9]\d*$/.test(admin) || admin !== required('OWNER_CHAT_ID')) throw new Error('Echo requires the private owner chat');
  const rpcUrl = required('ECHO_SOLANA_RPC_URL'), wsUrl = required('ECHO_SOLANA_WS_URL');
  for (const [value, protocol] of [[rpcUrl, 'https:'], [wsUrl, 'wss:']]) {
    const url = new URL(value);
    if (url.protocol !== protocol || url.username || url.password) throw new Error('Invalid Echo endpoint protocol');
    if (/helius/i.test(url.hostname)) throw new Error('QuickNode pilot must be independent of Helius');
  }
  if (new URL(rpcUrl).hostname !== new URL(wsUrl).hostname) throw new Error('Echo HTTP and WSS must use the same provider host');
  // Optional, read-only disaster recovery using an independently configured
  // Solana provider (including existing Helius free-tier credentials).
  // No fallback is activated unless BOTH endpoints are explicitly configured.
  const fallbackRpcUrl = env.ECHO_FALLBACK_SOLANA_RPC_URL?.trim() || null;
  const fallbackWsUrl = env.ECHO_FALLBACK_SOLANA_WS_URL?.trim() || null;
  if (Boolean(fallbackRpcUrl) !== Boolean(fallbackWsUrl))
    throw new Error('Echo fallback requires both HTTPS and WSS endpoints');
  if (fallbackRpcUrl && fallbackWsUrl) {
    for (const [raw, protocol] of [[fallbackRpcUrl, 'https:'], [fallbackWsUrl, 'wss:']] as const) {
      const endpoint = new URL(raw);
      if (endpoint.protocol !== protocol || endpoint.username || endpoint.password)
        throw new Error('Invalid Echo fallback endpoint protocol');
    }
    if (new URL(fallbackRpcUrl).hostname !== new URL(fallbackWsUrl).hostname)
      throw new Error('Echo fallback HTTP and WSS must have matching hosts');
    if (fallbackRpcUrl === rpcUrl || fallbackWsUrl === wsUrl)
      throw new Error('Echo fallback must use independent endpoints');
  }
    const statePath = required('ECHO_STATE_PATH');
  if (!statePath.startsWith('/')) throw new Error('Echo requires an absolute persistent state path');
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid Echo port');
  return { rpcUrl, wsUrl, fallbackRpcUrl, fallbackWsUrl, statePath, port, admin, botToken: required('TELEGRAM_BOT_TOKEN') };
}
