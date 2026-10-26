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
  const statePath = required('ECHO_STATE_PATH');
  if (!statePath.startsWith('/')) throw new Error('Echo requires an absolute persistent state path');
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid Echo port');
  return { rpcUrl, wsUrl, statePath, port, admin, botToken: required('TELEGRAM_BOT_TOKEN') };
}
