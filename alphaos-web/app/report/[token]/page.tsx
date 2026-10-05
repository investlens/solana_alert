import { redirect } from 'next/navigation';
export const dynamic = 'force-dynamic';
type Props = {params: Promise<{token:string}>; searchParams: Promise<Record<string,string|string[]|undefined>>};
// Keep old report links usable through the same audited mapper as the terminal.
// Legacy query-string prices/scores are never trusted as market evidence.
export default async function ReportPage({params,searchParams}: Props) {
  const {token} = await params, query = await searchParams;
  const chain = Array.isArray(query.chain) ? query.chain[0] : query.chain;
  redirect(`/intelligence/${encodeURIComponent(token)}${chain ? `?chain=${encodeURIComponent(chain)}` : ''}`);
}
