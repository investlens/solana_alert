import Link from 'next/link';
import AppShell from '@/components/layout/AppShell';
import HolderLaunchSection from '@/components/access/HolderLaunchSection';
export const dynamic = 'force-dynamic';
const plans = [
  { name: 'Free', tag: 'Start here', description: 'Explore the evidence and receive your enabled alerts.', points: ['Free-tier alerts: 30-second delivery delay', 'Telegram contract and wallet research', 'Recorded browser research and outcomes', 'Choose enabled feeds in bot Settings'], action: 'Open Telegram', href: '/api/open-bot' },
  { name: 'Pro', tag: 'Access via bot', description: 'Earlier delivery for members with Pro access.', points: ['Priority alerts: about 5 seconds after detection', 'Same evidence and risk disclosures', 'Bot preferences control your enabled feeds', 'Pricing and payment availability confirmed in bot'], action: 'Check Pro access', href: '/api/open-bot' },
  { name: 'Holder Pro', tag: 'Launching soon · proposed', description: 'One planned holder tier. Eligibility is not active.', points: ['Proposed threshold: 1,000,000 AlphaOS tokens', 'Ownership proof and on-chain balance verification', 'Final benefits and usage limits published before activation', 'No deposit, token approval or seed phrase required'], action: 'View launch details', href: '/token' },
];
export default function MePage() {
  return <AppShell><main className="premium-page"><div className="premium-container">
    <p className="premium-eyebrow">ACCESS & MEMBERSHIP</p><h1 className="page-title">Choose how you use AlphaOS.</h1>
    <p className="page-intro">Telegram is where identity, preferences and membership are managed today. This browser has not authenticated your account or verified a holding.</p>
    <div className="plan-grid">{plans.map(plan => <section className="plan-card" key={plan.name}><span className="feature-status">{plan.tag}</span><h2>{plan.name}</h2><p>{plan.description}</p><ul>{plan.points.map(point => <li key={point}>{point}</li>)}</ul><a href={plan.href} className={plan.name === 'Pro' ? 'alpha-button-primary' : 'premium-button'}>{plan.action} →</a></section>)}</div>
    <HolderLaunchSection />
    <section className="info-panel"><h2>Get started in three steps</h2><ol><li>Open Telegram and press Start.</li><li>Open Settings to choose your alert feeds and supported chains.</li><li>Send <code>/scan</code> followed by a token contract or wallet address.</li></ol><p>Delivery times are intentional tier delays after detection, not a guarantee of time from the on-chain event. Provider indexing and availability can add latency.</p><Link href="/guide" className="text-link">Full command guide →</Link></section>
  </div></main></AppShell>;
}
