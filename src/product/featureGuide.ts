import { subscriptionsEnabled } from './subscriptionPlan.js';

export function alphaosHomeText(): string {
  return [
    '✦ <b>ALPHAOS AI</b>',
    '<i>Your crypto research workspace</i>', '',
    '🔎 <b>Scan</b> — paste a token address or send /scan &lt;address&gt;.',
    '⚡ <b>Alerts</b> — Boost, DEX Paid and qualifying discovery/setup feeds.',
    '🎯 <b>Trader Tools</b> — check readiness and manage monitors.', '',
    'Open <b>Free / Pro</b> to compare features, or <b>How to Use</b> for help.',
    '<i>Coverage varies by chain. Research only · DYOR.</i>',
  ].join('\n');
}

export function alphaosFeatureGuide(): string {
  return ['✦ <b>ALPHAOS · FREE / PRO</b>', '',
    '<b>FREE · RESEARCH</b>',
    '• Token scans and available market data.',
    '• Wallet scans and observed launch history.',
    '• Available socials, explorer and chart links.',
    '• Group contract screening via /scan_on.',
    '• Boost + DEX Paid and qualifying feeds · 30-second release delay.', '',
    '<b>PRO · TRADER TOOLS</b>',
    '• Boost + DEX Paid and qualifying feeds · priority delivery.',
    '• Trade Readiness · indexed Robinchain pools.',
    '• Personal price/liquidity monitors · 1 hour.',
    '• Wallet tracking and available creator research.',
    '• Recorded outcomes · limited data coverage.', '',
    subscriptionsEnabled() ? 'Pro requires active membership. Risk warnings have no added delivery delay.'
      : '<b>Testing access:</b> Pro tools are open to testers. Payments remain closed.', '',
    'Open <b>Trader Tools</b> for supported tokens and monitoring limits.',
    '<i>Missing data is not a passed check. Research does not establish a safe entry.</i>',
  ].join('\n');
}
