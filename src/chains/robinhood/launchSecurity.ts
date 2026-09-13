import { supabase } from '../../services/supabase.js';
import {
  evaluatePositiveAlertSecurity,
  type LaunchClassification,
  type PositiveAlertSecurityDecision,
} from '../../security/positiveAlertSecurity.js';

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

export async function classifyRobinhoodLaunch(tokenAddress: string): Promise<LaunchClassification> {
  const token = normalize(tokenAddress);
  try {
    const { data, error } = await supabase
      .from('pons_launches')
      .select('id')
      .eq('chain', 'robinhood')
      .ilike('token_address', token)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data ? 'PONS' : 'CUSTOM';
  } catch (error) {
    console.warn('[RobinhoodLaunchSecurity] PONS census lookup failed; classifying fail-closed as CUSTOM.', {
      token,
      reason: error instanceof Error ? error.message : String(error),
    });
    return 'CUSTOM';
  }
}

export async function evaluateRobinhoodPositiveAlertSecurity(args: {
  tokenAddress: string;
  raw?: Record<string, unknown> | null;
}): Promise<PositiveAlertSecurityDecision> {
  const launchType = await classifyRobinhoodLaunch(args.tokenAddress);
  return evaluatePositiveAlertSecurity({ launchType, raw: args.raw });
}
