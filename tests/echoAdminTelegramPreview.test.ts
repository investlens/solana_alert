import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderEchoAdminPreview } from '../src/echo/adminTelegramPreview.js';
const owner = '12345678';
const msg = { from: { id: 12345678, is_bot: false }, chat: { id: 12345678, type: 'private' }, text: '/autotrader' };
describe('Echo admin Telegram preview is fail-closed', () => {
  it('renders only private exact-owner command and remains disabled', () => {
    const preview = renderEchoAdminPreview(msg, owner);
    assert.match(preview!, /LIVE EXECUTION: OFF/);
    assert.match(preview!, /No deposit address yet/);
    assert.match(preview!, /Automatic SELL: OFF/);
  });
  it('denies other sender, forwarded group context, bot, wrong chat and invalid owner config', () => {
    for (const bad of [
      { ...msg, from: { id: 9 } }, { ...msg, chat: { id: 9, type: 'private' } },
      { ...msg, chat: { id: 12345678, type: 'group' } },
      { ...msg, from: { id: 12345678, is_bot: true } },
      { ...msg, from: undefined }, { ...msg, chat: undefined },
    ]) assert.equal(renderEchoAdminPreview(bad, owner), null);
    assert.equal(renderEchoAdminPreview(msg, ''), null);
  });
  it('rejects unknown commands and bot mention mismatch', () => {
    assert.equal(renderEchoAdminPreview({ ...msg, text: '/withdraw' }, owner), null);
    assert.equal(renderEchoAdminPreview({ ...msg, text: '/autotrader@DifferentBot' }, owner, 'ActualBot'), null);
    assert.match(renderEchoAdminPreview({ ...msg, text: '/autotrader@ActualBot' }, owner, 'ActualBot')!, /PREVIEW ONLY/);
  });
});
