import HeroStats from "@/components/dashboard/HeroStats";

export const dynamic = "force-dynamic";

export default function DashboardPage() {
  return (
    <main className="min-h-screen bg-[#050609] px-4 py-6 text-white sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1500px]">
        <HeroStats />
      </div>
    </main>
  );
}