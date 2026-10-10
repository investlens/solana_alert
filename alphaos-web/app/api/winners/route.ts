import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { verifiedWinners } from '@/lib/dashboard/winners';
import { recordedOutcomeIdentity } from '@/lib/dashboard/compact-outcomes';
export const dynamic = 'force-dynamic';
type Payload = { items: ReturnType<typeof verifiedWinners>; generatedAt: string; degraded: boolean; trackedSample: number };
let cache: Payload | null = null;
let pending: Promise<Payload> | null = null;
let expires = 0;
async function load(): Promise<Payload> {
  const now = Date.now();
  const tracking = await supabaseAdmin.from('alpha_compact_tracking')
    .select('chain,token,feed,price_unit,baseline_price,started_at,samples,finalized_at')
    .eq('price_unit','USD').order('started_at',{ascending:false}).limit(300).abortSignal(AbortSignal.timeout(5000));
  if(tracking.error) throw tracking.error;
  const tracks = tracking.data ?? [];
  const tokens = [...new Set(tracks.flatMap(t => [t.token,t.token.toLowerCase()]))];
  if (!tokens.length) return {items:[],generatedAt:new Date(now).toISOString(),degraded:false,trackedSample:0};
  const [events, identities] = await Promise.all([
    supabaseAdmin.from('alpha_alert_events').select('id,chain,asset_id,symbol,token_name,semantic_event_type,alert_type,price,price_provenance,alerted_at,raw_snapshot')
      .in('asset_id',tokens).gte('alerted_at',new Date(Date.parse(tracks[tracks.length-1].started_at)-5000).toISOString()).order('alerted_at',{ascending:false}).limit(1200).abortSignal(AbortSignal.timeout(5000)),
    supabaseAdmin.from('opportunities').select('chain,asset_id,raw_data').in('asset_id',tokens).order('created_at',{ascending:false}).limit(600).abortSignal(AbortSignal.timeout(5000)),
  ]);
  if(events.error) throw events.error;
  const names = (identities.data ?? []).map(recordedOutcomeIdentity).filter((r): r is NonNullable<typeof r> => r !== null);
  return {items:verifiedWinners(events.data ?? [],tracks,names,now).slice(0,100),generatedAt:new Date(now).toISOString(),
    degraded:!!identities.error || (events.data?.length ?? 0) === 1200,trackedSample:tracks.length};
}
export async function GET() {
  if(cache && Date.now()<expires) return NextResponse.json({success:true,data:cache});
  try {
    pending ??= load().then(value => {cache=value;expires=Date.now()+60000;return value;}).finally(()=>{pending=null;});
    return NextResponse.json({success:true,data:await pending});
  } catch {
    expires=Date.now()+15000;
    cache = cache ? {...cache,degraded:true} : {items:[],generatedAt:new Date().toISOString(),degraded:true,trackedSample:0};
    return NextResponse.json({success:true,data:cache});
  }
}
