import AppShell from "@/components/layout/AppShell";
import AlphaHome from "@/components/home/AlphaHome";

export const dynamic = "force-dynamic";

export default function HomePage() {
  return (
    <AppShell>
      <AlphaHome />
    </AppShell>
  );
}
