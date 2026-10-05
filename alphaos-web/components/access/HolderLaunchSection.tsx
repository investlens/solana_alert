import Link from 'next/link';
import { getHolderLaunchConfig } from '@/lib/holder-launch';

export default function HolderLaunchSection() {
  const launch = getHolderLaunchConfig();
  return <section className="info-panel" aria-labelledby="holder-launch-title">
    <span className="feature-status">{launch.contract ? 'Contract published · access pending' : 'Launching soon'}</span>
    <h2 id="holder-launch-title">{launch.contract ? 'AlphaOS holder access' : 'AlphaOS launching soon'}</h2>
    <p>One proposed holder membership. Hold at least <strong>1,000,000 AlphaOS tokens</strong> to qualify for <strong>Holder Pro</strong> once verification is available and the final terms are published.</p>
    <p>Research access—not a promise of income, trading returns or token appreciation. Free access remains available; a subscription alternative is planned.</p>
    <dl><dt>Network</dt><dd>{launch.chainLabel}</dd><dt>Official contract</dt><dd>{launch.contract ? <code style={{ overflowWrap: 'anywhere' }}>{launch.contract}</code> : 'Not published yet. No token can be verified as AlphaOS here.'}</dd><dt>Holder verification</dt><dd>Not active. Adding a contract does not automatically enable membership.</dd></dl>
    <h3>Planned verification · ownership only</h3>
    <ol><li>Authenticate your Telegram account securely.</li><li>Connect your wallet and sign a readable, one-time ownership message.</li><li>The server checks the official contract balance and applies membership.</li></ol>
    <p>No seed phrase, private key, deposit, token transfer or spending approval will be required. Balance checks will be cached, with eligibility rechecked periodically.</p>
    <button className="premium-button" disabled aria-describedby="holder-verification-note">Verify holder access · coming soon</button>
    <p id="holder-verification-note">Wallet connection and signing are disabled until the complete verification flow passes security testing.</p>
    <Link className="text-link" href="/guide">Use the current research tools →</Link>
  </section>;
}
