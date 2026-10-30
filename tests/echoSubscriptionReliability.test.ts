import test from 'node:test';
import assert from 'node:assert/strict';
import { startEchoSubscription } from '../src/echo/subscription.js';
import { ECHO_WALLETS } from '../src/echo/signals.js';

type Listener = (event: any) => void;
test('websocket must acknowledge every tracked wallet before becoming ready', () => {
  const listeners = new Map<string, Listener>();
  const sent: any[] = [], received: string[] = [];
  let ready = 0;
  const socket = {
    addEventListener(type: string, fn: Listener) { listeners.set(type, fn); },
    send(message: string) { sent.push(JSON.parse(message)); },
    close() {},
  };
  const client = startEchoSubscription({
    url: 'wss://example.invalid',
    socket: () => socket,
    onReady: () => { ready++; },
    onSignature: sig => received.push(sig),
    later: () => 1, cancel: () => {},
  });
  listeners.get('open')!({});
  assert.equal(sent.length, Object.keys(ECHO_WALLETS).length);
  assert.equal(client.state.ready, false);
  for (let i = 0; i < sent.length; i++) {
    listeners.get('message')!({ data: JSON.stringify({ jsonrpc: '2.0', id: sent[i].id, result: i + 100 }) });
  }
  assert.equal(client.state.ready, true);
  assert.equal(ready, 1);
  const signature = '3'.repeat(88);
  listeners.get('message')!({ data: JSON.stringify({ method: 'logsNotification', params: {
    subscription: 100, result: { value: { err: null, signature } }
  } }) });
  assert.deepEqual(received, [signature]);
  client.stop();
});

test('Pump App caller log enters queue; unsolicited transfers never do', () => {
 const listeners = new Map<string, Listener>();
 const subscriptions: any[] = [];
 const received: Array<{signature:string;wallet:string}> = [];
 const socket = {
  addEventListener(type:string,fn:Listener){listeners.set(type,fn);},
  send(data:string){subscriptions.push(JSON.parse(data));},
  close(){}
 };
 const client=startEchoSubscription({
  url:'wss://example.invalid',socket:()=>socket,onReady:()=>{},
  onSignature:(signature,wallet)=>received.push({signature,wallet}),
  later:()=>1,cancel:()=>{}
 });
 listeners.get('open')!({});
 for(let i=0;i<subscriptions.length;i++)
  listeners.get('message')!({data:JSON.stringify({id:subscriptions[i].id,result:100+i})});
 const notify=(signature:string,logs:string[])=>listeners.get('message')!({data:JSON.stringify({
  method:'logsNotification',params:{subscription:100,result:{value:{signature,err:null,logs}}}
 })});
 notify('3'.repeat(88),['Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA invoke [1]',
  'Program log: Instruction: TransferChecked']);
 notify('4'.repeat(88),['Program 6Vo3245eszAb5wuqEMw8mGdbfRUdKbHhDHP5LcaGuTAB invoke [1]']);
 assert.deepEqual(received,[{signature:'4'.repeat(88),wallet:Object.keys(ECHO_WALLETS)[0]}]);
 assert.equal(client.state.walletNotifications[Object.keys(ECHO_WALLETS)[0]],2);
 assert.equal(client.state.walletPrefilterSkipped[Object.keys(ECHO_WALLETS)[0]],1);
 assert.equal(client.state.walletQueued[Object.keys(ECHO_WALLETS)[0]],1);
 client.stop();
});

test('queue handoff counter requires successful callback', () => {
 const listeners = new Map<string, Listener>(), requests:any[]=[];
 const socket={addEventListener:(type:string,fn:Listener)=>{listeners.set(type,fn);},send:(v:string)=>{requests.push(JSON.parse(v));},close:()=>{}};
 const sub=startEchoSubscription({url:'wss://example.invalid',socket:()=>socket,onReady:()=>{},
   onSignature:()=>{throw Error('queue down');},later:()=>1,cancel:()=>{}});
 listeners.get('open')!({});
 for(const [i,request] of requests.entries())listeners.get('message')!({data:JSON.stringify({id:request.id,result:i+100})});
 assert.throws(()=>listeners.get('message')!({data:JSON.stringify({method:'logsNotification',
  params:{subscription:100,result:{value:{err:null,signature:'3'.repeat(88),
   logs:['Program JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4 invoke [1]']}}}})}),/queue down/);
 const wallet=Object.keys(ECHO_WALLETS)[0];
 assert.equal(sub.state.walletNotifications[wallet],1);
 assert.equal(sub.state.walletQueued[wallet]??0,0);
 sub.stop();
});
