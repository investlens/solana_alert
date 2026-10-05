import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { buildAlphaosAlertCard, ponsImageUrl } from '../src/ui/alphaosAlertCard.js';
import { sendAlphaosPhotoAlert, alphaosEnrichmentEdit } from '../src/ui/alphaosPhotoDelivery.js';
import { buildSocialMafiaAlertText, resolveSocialMafiaSocials } from '../src/chains/robinhood/ponsSocialMafiaAlert.js';

test('branded card renders without a token image, external fonts or database storage', async () => {
  const image = await buildAlphaosAlertCard({ symbol: 'AXIL', name: 'Axil Token' });
  const info = await sharp(image).metadata();
  assert.equal(info.format, 'png'); assert.equal(info.width, 1200); assert.equal(info.height, 540);
  assert.ok(image.length < 1_000_000);
  assert.equal(ponsImageUrl('http://localhost/image.png'), null);
  assert.equal(ponsImageUrl('ipfs://bafyabcdefghijklmnopqrstuvwx/../../secret'), null);
});
test('long token names remain within Telegram photo caption limit without cutting HTML', () => {
  const text = buildSocialMafiaAlertText({ tokenAddress: '0x1111111111111111111111111111111111111111', launchpadLabel: 'PONS',
    symbol: 'A'.repeat(500), name: '<>&'.repeat(500), socialContractConfirmed: true,
    socials: resolveSocialMafiaSocials({ twitter: 'https://x.com/projectalpha', telegram: 'https://t.me/projectalpha' })! });
  const visible = text.replace(/<[^>]*>/g, '').replace(/&(?:amp|lt|gt|quot);/g, 'x');
  assert.ok(visible.length <= 1024); assert.match(text, /Contract evidence <b>X contract match/);
});
test('photo sends use multipart caption and buttons; enrichment edits the same caption', async () => {
  let captured: FormData | null = null;
  const request = (async (url: string | URL | Request, init?: RequestInit) => {
    assert.match(String(url), /sendPhoto$/); captured = init?.body as FormData;
    return new Response(JSON.stringify({ ok: true, result: { message_id: 42 } }), { status: 200 });
  }) as typeof fetch;
  const result = await sendAlphaosPhotoAlert({ botToken: 'test', chatId: '1', text: '<b>AXIL</b>', keyboard: [], image: Buffer.from('png') }, request);
  assert.deepEqual(result, { messageId: 42, photo: true });
  const caption = String((captured as unknown as FormData).get('caption'));
  assert.ok(caption.startsWith('<b>AXIL</b>'));
  assert.match(caption, /Research only — not a buy\/sell signal/);
  assert.equal(alphaosEnrichmentEdit(result, '1', 'Updated', []).method, 'editMessageCaption');
});
test('explicit photo rejection falls back to text; ambiguous errors never duplicate an alert', async () => {
  const calls: string[] = [];
  const args = { botToken: 'test', chatId: '1', text: 'AXIL', keyboard: [], image: Buffer.from('png') };
  const request = (async (url: string | URL | Request) => {
    calls.push(String(url)); return calls.length === 1
      ? new Response(JSON.stringify({ ok: false }), { status: 400 })
      : new Response(JSON.stringify({ ok: true, result: { message_id: 43 } }), { status: 200 });
  }) as typeof fetch;
  const result = await sendAlphaosPhotoAlert(args, request);
  assert.equal(result.photo, false); assert.equal(calls.length, 2);
  assert.equal(alphaosEnrichmentEdit(result, '1', 'Updated', []).method, 'editMessageText');
  let failures = 0;
  await assert.rejects(sendAlphaosPhotoAlert(args, (async () => { failures++; throw new Error('timeout'); }) as typeof fetch));
  assert.equal(failures, 1);
});

test('supported IPFS token art is composited; an unavailable image keeps the branded fallback', async () => {
  const previous = globalThis.fetch;
  const art = await sharp({ create: { width: 50, height: 50, channels: 3, background: '#ff0000' } }).png().toBuffer();
  globalThis.fetch = (async url => {
    assert.match(String(url), /^https:\/\/ipfs\.io\/ipfs\//);
    return new Response(new Uint8Array(art), { status: 200, headers: { 'content-type': 'image/png' } });
  }) as typeof fetch;
  try {
    const image = await buildAlphaosAlertCard({ symbol: 'DEMO', logo: 'ipfs://bafyabcdefghijklmnopqrstuvwx' });
    const pixel = await sharp(image).extract({ left: 990, top: 230, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
    assert.equal(pixel[0], 255); assert.equal(pixel[1], 0); assert.equal(pixel[2], 0);
    globalThis.fetch = (async () => new Response('not an image', { status: 502 })) as typeof fetch;
    const fallback = await buildAlphaosAlertCard({ symbol: 'DEMO', logo: 'ipfs://bafyabcdefghijklmnopqrstuvwx' });
    assert.equal((await sharp(fallback).metadata()).width, 1200);
  } finally { globalThis.fetch = previous; }
});
