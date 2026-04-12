export type PlanSelection = {
  planDays: 15 | 30;
  amountSol: 0.1 | 0.15;
};

export type PendingUpgradeSession = {
  telegramId: string;
  planDays: 15 | 30;
  amountSol: 0.1 | 0.15;
  awaitingTxHash: boolean;
};