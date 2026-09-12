import AppShell from "@/components/layout/AppShell";
import AlphaHome from "@/components/home/AlphaHome";
import LiveIntelligenceSummary from "@/components/home/LiveIntelligenceSummary";

export const dynamic = "force-dynamic";

export default function HomePage() {
  return (
    <AppShell>
      <LiveIntelligenceSummary />
      <AlphaHome />
    </AppShell>
  );
}
