// Preserve dust balances; unknown or inconsistent reads must never become zero.
export function tokenBalancePercent(balance:bigint,supply:bigint):number|null {
  if(supply<=0n || balance<0n || balance>supply)return null;
  if(balance===0n)return 0;
  const percent=Number(balance)/Number(supply)*100;
  return Number.isFinite(percent)&&percent>0?percent:null;
}
