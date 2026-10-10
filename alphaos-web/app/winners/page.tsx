import AppShell from '@/components/layout/AppShell';
import WinnerShowcase from '@/components/home/WinnerShowcase';
export const metadata = {title:'Observed winners | AlphaOS',description:'Post-alert price milestones with entry, sampled peak and latest observations. Research only.'};
export default function WinnersPage() {
  return <AppShell><main className="premium-page"><div className="premium-container"><WinnerShowcase full/></div></main></AppShell>;
}
