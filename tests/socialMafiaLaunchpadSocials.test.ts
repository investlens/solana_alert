import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildSocialMafiaAlertText,
  extractTelegramLabel,
  extractXUsername,
  resolveSocialMafiaSocials,
} from '../src/chains/robinhood/ponsSocialMafiaAlert.js';

test('Social Mafia requires both a valid X profile and Telegram community link', () => {
  const socials = resolveSocialMafiaSocials({
    twitter: 'https://x.com/seriousdev',
    telegram: 'https://t.me/seriouscommunity',
  });

  assert.deepEqual(socials, {
    xUrl: 'https://x.com/seriousdev',
    xHandle: 'seriousdev',
    telegramUrl: 'https://t.me/seriouscommunity',
    telegramLabel: '@seriouscommunity',
  });

  assert.equal(resolveSocialMafiaSocials({ twitter: 'https://x.com/seriousdev', telegram: null }), null);
  assert.equal(resolveSocialMafiaSocials({ twitter: null, telegram: 'https://t.me/seriouscommunity' }), null);
  assert.equal(resolveSocialMafiaSocials({ twitter: 'https://example.com/x', telegram: 'https://t.me/seriouscommunity' }), null);
  assert.equal(resolveSocialMafiaSocials({ twitter: 'https://x.com/seriousdev', telegram: 'https://example.com/tg' }), null);
});

test('Social Mafia validates only direct project social destinations', () => {
  assert.equal(extractXUsername('https://x.com/project_alpha'), 'project_alpha');
  assert.equal(extractXUsername('https://twitter.com/projectalpha'), 'projectalpha');
  assert.equal(extractXUsername('https://x.com/intent/post'), null);

  assert.equal(extractTelegramLabel('https://t.me/projectalpha'), '@projectalpha');
  assert.equal(extractTelegramLabel('https://telegram.me/projectalpha'), '@projectalpha');
  assert.equal(extractTelegramLabel('https://t.me/share/url?url=test'), null);
});

test('Social Mafia alert shows verified launchpad plus both communities', () => {
  const socials = resolveSocialMafiaSocials({
    twitter: 'https://x.com/projectalpha',
    telegram: 'https://t.me/projectalpha',
  });
  assert.ok(socials);

  const text = buildSocialMafiaAlertText({
    tokenAddress: '0x1234567890abcdef1234567890abcdef12345678',
    launchpadLabel: 'PONS',
    socials,
    symbol: 'ALPHA',
    name: 'Alpha Token',
    marketCap: 51_800,
    devHoldingPercent: 4.25,
  });

  assert.match(text, /SOCIAL MAFIA ALERT/);
  assert.match(text, /Launchpad\s+<b>PONS<\/b>/);
  assert.match(text, /X\s+<b>@projectalpha<\/b>/);
  assert.match(text, /Telegram\s+<b>@projectalpha<\/b>/);
  assert.match(text, /Market cap\s+<b>\$51\.8K<\/b>/);
  assert.match(text, /Dev holding\s+<b>4\.25%<\/b>/);
  assert.match(text, /Verified launchpad \+ X \+ Telegram/);
});
