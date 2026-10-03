import { subscriptionsEnabled } from './subscriptionPlan.js';
export function alphaosFeatureGuide(): string {
  return ['✦ <b>ALPHAOS · FREE / PRO</b>', '',
    '<b>FREE · RESEARCH TOOLS</b>',
    '1. Token screening — /scan &lt;contract&gt;.',
    '2. Wallet screening — /scan wallet &lt;address&gt;.',
    '3. Available market stats, socials and chart links.',
    '4. Group contract screening — admin enables /scan_on.',
    '5. Qualifying discovery alerts — released after 30 seconds; alert preferences.', '',
    '<b>PRO · TRADER WORKSPACE</b>',
    '1. Priority alerts — near-real-time Boost, Social Mafia, Protocol Discovery and qualifying market/setup feeds.',
    '2. Trade Readiness — market screening and remaining entry checks.',
    '3. Personal Monitors — one-hour price/liquidity deterioration notices.',
    '4. Wallet tracking and available creator intelligence.',
    '5. Recorded alert outcomes and creator performance.', '',
    '<b>NEW · ROBINCHAIN TRADER TOOLS</b>',
    'Open a Robinchain token → Readiness → Monitor 1h.',
    'Indexed USD pools only. Readiness shows Watch / Setup forming; entry approval is not established.',
    'Monitors: 2 tokens/user, 10 overall; about 2-minute checks, maximum 3 warning events.',
    'Stop anytime in Home → My Monitors. No continuous protection or automatic trade.', '',
    subscriptionsEnabled() ? 'Pro features require active membership. Safety notices are not delivery-delayed.'
      : '<b>Testing access:</b> Pro tools are currently available to testers. Payments remain closed.',
    '<i>Availability varies by chain and data source. Missing evidence never means a passed check.</i>',
  ].join('\n');
}
