import Link from 'next/link';
import AppShell from '@/components/layout/AppShell';
import HolderLaunchSection from '@/components/access/HolderLaunchSection';
export const dynamic = 'force-dynamic';
export default function TokenPage() {
  return <AppShell><main className="premium-page"><div className="premium-container narrow">
    <p className="premium-eyebrow">ALPHAOS TOKEN · HOLDER ACCESS ROADMAP</p>
    <h1 className="page-title">Product first.<br/>Transparent utility next.</h1>
    <p className="page-intro">AlphaOS is a token intelligence workspace. The proposed token connects eligible holders to research tools—not guaranteed income. Holder verification is not active.</p>
    <HolderLaunchSection />
    <div className="hero-actions"><a className="alpha-button-primary" href="/api/open-bot">Explore the bot ↗</a><Link className="premium-button" href="/guide">Learn the tools</Link></div>
    <section className="info-panel"><h2>Explore the product today</h2><p>Use Telegram for supported alerts and fresh contract research. Browse recorded market evidence and creator history on the website. Coverage varies; the website does not verify Telegram membership or token holdings.</p><Link className="text-link" href="/status">Review data coverage →</Link></section>
    <section className="info-panel"><h2>Proposed holder utility</h2><ul><li>Pro access while the published holding threshold is maintained.</li><li>Research and watchlist allowances within sustainable limits.</li><li>Clear eligibility checks with a displayed verification time.</li><li>A subscription alternative for users who prefer direct access.</li></ul><p>Exact benefits, allowances and eligibility rules must be published and implemented before access is offered.</p></section>
    <section className="info-panel"><h2>Required before activation</h2><ul><li>Official PONS project, chain and complete token contract address.</li><li>Total supply, allocations, team wallets and vesting schedule.</li><li>Secure Telegram account linking and tested wallet ownership verification.</li><li>Holder benefits, subscription terms and privacy policy.</li><li>Validated data mappings and ongoing delivery checks.</li></ul><div className="data-notice">Only use the official contract displayed above once published. Never treat a similarly named token as AlphaOS. No wallet connection or signature is requested on this page.</div></section>
    <section className="info-panel"><h2>Grow gradually</h2><p>Validate the research and delivery experience first. Activate holder eligibility only after end-to-end security testing. Add tools once their evidence, reliability and operating cost have been tested.</p><p>Holding a token does not guarantee access before verification is implemented, price appreciation, profit or a share of revenue.</p></section>
    <div className="hero-actions"><Link href="/me" className="premium-button">Compare current access</Link><Link href="/disclosures" className="text-link">Risk & privacy →</Link></div>
  </div></main></AppShell>;
}
