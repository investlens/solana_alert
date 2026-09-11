import { recordCreatorLaunch } from '../agents/creatorIntelligenceAgent.js';
import { saveCreatorLaunch } from './creatorIntelStore.js';

let started = false;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let socket: any = null;

const ENDPOINT = 'wss://pumpportal.fun/api/data';
const RECONNECT_MS = 30_000;

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    started = false;
    void startPumpPortalCreatorFeed();
  }, RECONNECT_MS);
}

export async function startPumpPortalCreatorFeed(): Promise<void> {
  if (started) return;

  const WebSocketImpl = (globalThis as any).WebSocket;
  if (!WebSocketImpl) {
    console.log('[PumpPortalCreatorFeed] WebSocket unavailable in runtime');
    return;
  }

  started = true;

  try {
    socket = new WebSocketImpl(ENDPOINT);

    socket.onopen = () => {
      console.log('[PumpPortalCreatorFeed] connected');
      socket.send(
        JSON.stringify({
          method: 'subscribeNewToken',
        })
      );
      console.log('[PumpPortalCreatorFeed] subscribed to new token creations');
    };

    socket.onmessage = async (event: any) => {
      try {
        const raw =
          typeof event?.data === 'string'
            ? event.data
            : String(event?.data ?? '');

        const message = JSON.parse(raw);

        if (String(message?.txType ?? '').toLowerCase() !== 'create') {
          return;
        }

        const token = String(message?.mint ?? '').trim();
        const creatorWallet = String(message?.traderPublicKey ?? '').trim();

        if (!token || !creatorWallet) return;

        const symbol =
          typeof message?.symbol === 'string' && message.symbol.trim()
            ? message.symbol.trim()
            : null;

        const name =
          typeof message?.name === 'string' && message.name.trim()
            ? message.name.trim()
            : null;

        await saveCreatorLaunch({
          creatorWallet,
          token,
          symbol,
          name,
          initialMarketCap: null,
        });

        await recordCreatorLaunch({
          creatorWallet,
          token,
          chain: 'solana',
          symbol,
          marketCap: null,
          sourceAgent: 'PumpPortalCreatorFeed',
          rawData: {
            signature: message?.signature ?? null,
            txType: message?.txType ?? null,
            source: 'PUMPPORTAL_NEW_TOKEN',
          },
        });

        console.log('[PumpPortalCreatorFeed] creator launch recorded', {
          creatorWallet,
          token,
          symbol,
        });
      } catch (error) {
        console.log('[PumpPortalCreatorFeed] message error', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    };

    socket.onerror = (event: any) => {
      console.log('[PumpPortalCreatorFeed] websocket error', {
        type: event?.type ?? 'unknown',
      });
    };

    socket.onclose = (event: any) => {
      console.log('[PumpPortalCreatorFeed] disconnected', {
        code: event?.code ?? null,
        reason: event?.reason ?? null,
      });
      socket = null;
      scheduleReconnect();
    };
  } catch (error) {
    console.log('[PumpPortalCreatorFeed] start failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    started = false;
    scheduleReconnect();
  }
}
