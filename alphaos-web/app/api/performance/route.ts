import { loadPerformance } from '@/lib/performance';
export async function GET() {
 try {return Response.json(await loadPerformance(),{headers:{'Cache-Control':'public, s-maxage=30, stale-while-revalidate=60'}});}
 catch {return Response.json({error:'Performance data unavailable'},{status:503});}
}
