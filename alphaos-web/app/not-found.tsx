import Link from 'next/link';
import AppShell from '@/components/layout/AppShell';
export default function NotFound() {
  return <AppShell><main className="premium-page"><div className="premium-container narrow"><p className="premium-eyebrow">PAGE NOT FOUND</p><h1 className="page-title">Let’s get you back to research.</h1><p className="page-intro">This page does not exist. No market or safety conclusion can be drawn from a missing page.</p><div className="hero-actions"><Link className="alpha-button-primary" href="/">Home</Link><Link className="premium-button" href="/scan">Research a contract</Link></div></div></main></AppShell>;
}
