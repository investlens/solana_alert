import AppShell from "@/components/layout/AppShell";
import AlphaHome from "@/components/home/AlphaHome";
import { getHolderLaunchConfig } from '@/lib/holder-launch';

export const dynamic = "force-dynamic";

export default function HomePage() {
  return (
    <AppShell>
      <AlphaHome holderContractPublished={Boolean(getHolderLaunchConfig().contract)} />
    </AppShell>
  );
}
