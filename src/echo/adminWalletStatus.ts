/**
 * Read-only admin view-model. No Telegram transport, secret handling,
 * signing, wallet creation, or execution capabilities.
 */
import { ECHO_ADMIN_PILOT } from './adminPilotConfig.js';
export type AdminWalletSnapshot = Readonly<{
  publicAddress: string | null;
  balanceSol: number | null;
  observedAt: number | null;
  verifiedMainnet: boolean;
  openPositions: number | null;
  realizedPnlSol: number | null;
  emergencyStop: boolean;
}>;
export function renderAdminWalletStatus(s: AdminWalletSnapshot): string {
  const lines = ['⚡ ALPHAOS ECHO · AUTOTRADER', '🔒 Live BUY: DISABLED', '✋ Automatic SELL: DISABLED'];
  if (!s.publicAddress || !s.verifiedMainnet || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s.publicAddress)) {
    lines.push('👛 Wallet: NOT VERIFIED', '⚠️ Do not fund a wallet based on this dashboard.');
  } else {
    lines.push('👛 Wallet: ' + s.publicAddress);
    if (s.observedAt === null || !Number.isFinite(s.observedAt) ||
        s.observedAt > Date.now() + 30_000 || Date.now() - s.observedAt > 60_000 ||
        s.balanceSol === null || !Number.isFinite(s.balanceSol) || s.balanceSol < 0)
      lines.push('💰 Balance: UNAVAILABLE (stale or unverified)');
    else lines.push('💰 Observed balance: ' + s.balanceSol.toFixed(4) + ' SOL');
  }
  lines.push('📊 Open positions: ' + (s.openPositions === null ||
    !Number.isInteger(s.openPositions) || s.openPositions < 0 ? 'UNAVAILABLE' :
    s.openPositions + ' / ' + ECHO_ADMIN_PILOT.maxOpenPositions));
  lines.push('📈 Realized P&L: ' + (s.realizedPnlSol === null ||
    !Number.isFinite(s.realizedPnlSol) ? 'UNAVAILABLE' : s.realizedPnlSol.toFixed(4) + ' SOL'));
  lines.push('🛑 Emergency STOP: ' + (s.emergencyStop ? 'ON' : 'STATUS UNVERIFIED'));
  lines.push('ℹ️ Read-only preview · No deposit or SELL controls connected');
  return lines.join('\n');
}
