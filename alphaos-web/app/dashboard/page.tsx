import AppShell from "@/components/layout/AppShell";
import HeroStats from "@/components/dashboard/HeroStats";
import MissionBrief from "@/components/dashboard/MissionBrief";
import LiveOpportunities from "@/components/dashboard/LiveOpportunities";

export const dynamic = "force-dynamic";

export default function DashboardPage() {
  return (
    <AppShell>
      <main className="px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <div className="mx-auto max-w-[1540px]">
          <HeroStats />
          <MissionBrief />
          <LiveOpportunities />
        </div>
      </main>
    </AppShell>
  );
}
