'use client';
import Link from 'next/link';
export default function ErrorPage({reset}: {error: Error & {digest?: string}; reset: ()=>void}) {
  return <main className="premium-page"><div className="premium-container narrow"><p className="premium-eyebrow">RESEARCH TEMPORARILY UNAVAILABLE</p><h1 className="page-title">We couldn’t load this view.</h1><p className="page-intro">Unavailable data is not a safety or trading signal. Try again or open supported research in Telegram.</p><div className="hero-actions"><button className="alpha-button-primary" onClick={reset}>Try again</button><a className="premium-button" href="/api/open-bot">Open Telegram</a><Link className="premium-button" href="/">Home</Link></div></div></main>;
}
