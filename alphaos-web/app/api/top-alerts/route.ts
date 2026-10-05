import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { mapRecordedOutcome } from '@/lib/dashboard/recorded-outcomes';
import { mapTrackedOutcome } from '@/lib/dashboard/compact-outcomes';
export const dynamic = 'force-dynamic';
type Item = ReturnType<typeof mapRecordedOutcome>;
type Payload = { recent: Item[]; solanaTop: Item[]; robinhoodTop: Item[]; generatedAt: string; degraded?: boolean };
let cache: Payload | null = null;
let cachedUntil = 0;
export async function GET() {
  if (cache && Date.now() < cachedUntil) return NextResponse.json({success:true,data:cache});
  try {
    const now = Date.now();
    const events = await supabaseAdmin.from('alpha_alert_events')
      .select('id,opportunity_id,delivery_identity,asset_id,chain,symbol,token_name,semantic_event_type,alert_type,price,price_provenance,alerted_at,raw_snapshot')
      .gte('alerted_at',new Date(now-7*86400_000).toISOString())
      .order('alerted_at',{ascending:false}).limit(60).abortSignal(AbortSignal.timeout(3500));
    if (events.error) throw events.error;
    const rows = events.data ?? [], ids = rows.map(row=>row.id);
    const opportunities = [...new Set(rows.flatMap(row=>row.opportunity_id == null ? [] : [row.opportunity_id]))];
    const tokens = [...new Set(rows.flatMap(row=>row.chain === 'solana' ? [row.asset_id] : [row.asset_id, row.asset_id.toLowerCase()]))];
    const [outcomes, deliveries, opportunityDeliveries, compact, identities] = await Promise.all([
      ids.length ? supabaseAdmin.from('alpha_alert_outcomes').select('alert_event_id,checkpoint_seconds,current_price,price_provenance,measured_at,status,completeness').in('alert_event_id',ids).order('measured_at',{ascending:false}).limit(420).abortSignal(AbortSignal.timeout(3500)) : Promise.resolve({data:[],error:null}),
      ids.length ? supabaseAdmin.from('alpha_alert_event_deliveries').select('alert_event_id').in('alert_event_id',ids).not('delivered_at','is',null).limit(1000).abortSignal(AbortSignal.timeout(3500)) : Promise.resolve({data:[],error:null}),
      opportunities.length ? supabaseAdmin.from('opportunity_deliveries').select('opportunity_id,delivery_identity').in('opportunity_id',opportunities).not('delivered_at','is',null).limit(1000).abortSignal(AbortSignal.timeout(3500)) : Promise.resolve({data:[],error:null}),
      tokens.length ? supabaseAdmin.from('alpha_compact_tracking').select('chain,token,feed,price_unit,baseline_price,started_at,samples,finalized_at').in('token',tokens).limit(60).abortSignal(AbortSignal.timeout(3500)) : Promise.resolve({data:[],error:null}),
      tokens.length ? supabaseAdmin.from('latest_token_intelligence').select('chain,token_address,symbol,name').in('token_address',tokens).limit(120).abortSignal(AbortSignal.timeout(3500)) : Promise.resolve({data:[],error:null}),
    ]);
    const receipts = new Set((deliveries.data??[]).map(row=>Number(row.alert_event_id)));
    const opportunityReceipts = new Set((opportunityDeliveries.data??[]).map(row=>`${row.opportunity_id}:${row.delivery_identity}`));
    const seen = new Set<string>();
    const recent = rows.map(row=>mapTrackedOutcome(row,outcomes.error ? [] : outcomes.data??[],
      (!deliveries.error && receipts.has(Number(row.id))) || (!opportunityDeliveries.error && opportunityReceipts.has(`${row.opportunity_id}:${row.delivery_identity}`)),
      compact.error ? [] : compact.data??[], identities.error ? [] : identities.data??[], now))
      .filter(row=> { if (!row.token || !row.alertedAt || seen.has(row.identity)) return false; seen.add(row.identity); return true; }).slice(0,8);
    const payload: Payload = { recent, solanaTop:[], robinhoodTop:[], generatedAt:new Date(now).toISOString(),
      degraded: !!(outcomes.error || deliveries.error || opportunityDeliveries.error || compact.error || identities.error) };
    cache=payload; cachedUntil=now+60_000;
    return NextResponse.json({success:true,data:payload});
  } catch {
    console.error('Recent event history unavailable');
    return NextResponse.json({success:true,data:cache ? {...cache,degraded:true} : {recent:[],solanaTop:[],robinhoodTop:[],generatedAt:new Date().toISOString(),degraded:true}});
  }
}
