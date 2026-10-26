import { timingSafeEqual } from 'node:crypto';

export function readEchoConfig(env: NodeJS.ProcessEnv) {
  const required = (name: string) => { const v = env[name]?.trim(); if (!v) throw new Error(`Missing ${name}`); return v; };
  if (env.ECHO_ENABLED !== 'true') throw new Error('Echo is disabled');
  if (env.ECHO_MODE !== 'alerts') throw new Error('Only ECHO_MODE=alerts is supported');
  const owner = required('OWNER_CHAT_ID'), admin = required('ECHO_ADMIN_CHAT_ID');
  if (!/^[1-9]\d*$/.test(owner) || admin !== owner) throw new Error('Echo requires the private owner chat');
  const secret = required('ECHO_WEBHOOK_AUTH');
  if (secret.length < 32) throw new Error('Echo webhook secret must be at least 32 characters');
  const rpcUrl = required('ECHO_SOLANA_RPC_URL');
  if (new URL(rpcUrl).protocol !== 'https:') throw new Error('Echo RPC must use HTTPS');
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid Echo port');
  const statePath = required('ECHO_STATE_PATH');
  if (!statePath.startsWith('/')) throw new Error('Echo state path must be absolute');
  return { admin, secret, rpcUrl, port, statePath, botToken: required('TELEGRAM_BOT_TOKEN') };
}
export function authenticEchoHeader(supplied: string, expected: string): boolean {
  const left = Buffer.from(supplied), right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}
