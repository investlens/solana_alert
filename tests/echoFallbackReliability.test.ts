import test from 'node:test';
import assert from 'node:assert/strict';
import { readQuicknodeEchoConfig } from '../src/echo/quicknodeConfig.js';
import { startEchoSubscription } from '../src/echo/subscription.js';
import { ECHO_WALLETS } from '../src/echo/signals.js';

const baseline = {
  ECHO_ENABLED: 'true', ECHO_MODE: 'alerts', ECHO_ADMIN_CHAT_ID: '123', OWNER_CHAT_ID: '123',
  TELEGRAM_BOT_TOKEN: 'test-token', ECHO_STATE_PATH: '/data/echo.json',
  ECHO_SOLANA_RPC_URL: 'https://example.quiknode.pro/secure',
  ECHO_SOLANA_WS_URL: 'wss://example.quiknode.pro/secure'
};
test('read-only fallback is optional, requires valid independent HTTPS and WSS pairing', () => {
  const original = readQuicknodeEchoConfig(baseline);
  assert.equal(original.fallbackRpcUrl, null);
  assert.equal(original.fallbackWsUrl, null);
  const valid = {
    ...baseline,
    ECHO_FALLBACK_SOLANA_RPC_URL: 'https://mainnet.helius-rpc.com/?api-key=dummy',
    ECHO_FALLBACK_SOLANA_WS_URL: 'wss://mainnet.helius-rpc.com/?api-key=dummy'
  };
  const configured = readQuicknodeEchoConfig(valid);
  assert.equal(new URL(configured.fallbackWsUrl!).hostname, 'mainnet.helius-rpc.com');
  for(const change of [
    {ECHO_FALLBACK_SOLANA_WS_URL: ''},
    {ECHO_FALLBACK_SOLANA_WS_URL: 'ws://mainnet.helius-rpc.com/'},
    {ECHO_FALLBACK_SOLANA_WS_URL: 'wss://other.example/'},
    {ECHO_FALLBACK_SOLANA_RPC_URL: 'http://mainnet.helius-rpc.com/'},
    {ECHO_FALLBACK_SOLANA_RPC_URL: baseline.ECHO_SOLANA_RPC_URL,
     ECHO_FALLBACK_SOLANA_WS_URL: baseline.ECHO_SOLANA_WS_URL},
  ]) assert.throws(() => readQuicknodeEchoConfig({...valid, ...change}));
});
test('after three failed primary subscriptions, websocket tries secondary without credential disclosure', () => {
  const opened: string[] = [];
  const sockets: Array<{handlers:Map<string,(v:any)=>void>;messages:any[];send(s:string):void;close():void;addEventListener(t:string,fn:(v:any)=>void):void}> = [];
  const timers = new Map<number,()=>void>();
  let id = 0;
  const sub = startEchoSubscription({
    url:'wss://primary.example/secret',fallbackUrl:'wss://backup.example/secret',
    onSignature:()=>{},onReady:()=>{},
    socket: (url) => {
      opened.push(url);
      const item = {
        handlers:new Map<string,(v:any)=>void>(), messages:[] as any[],
        send(s:string){this.messages.push(JSON.parse(s));},
        close(){},
        addEventListener(t:string,fn:(v:any)=>void){this.handlers.set(t,fn);}
      };
      sockets.push(item);
      return item;
    },
    later: (fn)=>{timers.set(++id,fn);return id;},cancel:(token)=>{timers.delete(Number(token));}
  });
  const fail = () => {
    const socket=sockets.at(-1)!;
    socket.handlers.get('open')!({});
    socket.handlers.get('message')!({data:JSON.stringify({id:1,error:{code:429}})});
    const callback = [...timers.values()][0];
    assert.ok(callback);
    timers.clear();callback();
  };
  for(let i=0;i<3;i++) fail();
  assert.equal(opened[0], 'wss://primary.example/secret');
  assert.equal(opened[3], 'wss://backup.example/secret');
  assert.equal(sub.state.activeProvider, 'fallback');
  const backup=sockets.at(-1)!;
  backup.handlers.get('open')!({});
  for(let i=0;i<Object.keys(ECHO_WALLETS).length;i++) backup.handlers.get('message')!({
    data:JSON.stringify({id:i+1,result:i+100})
  });
  assert.equal(sub.state.ready,true);
  assert.equal(sub.state.acknowledgedWallets,Object.keys(ECHO_WALLETS).length);
  sub.stop();
});
