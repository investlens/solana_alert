import { eventEngine } from "./eventEngine.js";

export type OutcomeStatus =
  | "ACTIVE"
  | "COMPLETED"
  | "RUGGED"
  | "DEAD"
  | "EXPIRED";

export async function publishOutcomeStatus(args: {
  alertId: string;
  chain: string;
  tokenAddress: string;
  symbol?: string | null;

  previousStatus: OutcomeStatus;
  nextStatus: OutcomeStatus;

  roiCurrent: number;
  roiPeak: number;
  maxDrawdown: number;
}) {
  if (args.previousStatus === args.nextStatus) {
    return;
  }

  let eventType: string | null = null;
    let severity: "INFO" | "WARNING" = "INFO";

    switch (args.nextStatus) {
    case "RUGGED":
    case "DEAD":
        eventType = "TOKEN_DIED";
        severity = "WARNING";
        break;

    case "COMPLETED":
        eventType = "OUTCOME_COMPLETED";
        break;

    case "EXPIRED":
        eventType = "OUTCOME_EXPIRED";
        break;

    default:
        return;
    }

  try {
    const result = await eventEngine.emit({
      eventType,

      token: {
        chain: args.chain,
        tokenAddress: args.tokenAddress,
      },

      source: "OUTCOME_TRACKER",

      severity,

      deduplicationKey:
        `${args.alertId}:${args.nextStatus}`,

      deduplicationWindowSeconds:
        86400,

      payload: {
        alertId: args.alertId,
        symbol: args.symbol,
        previousStatus: args.previousStatus,
        nextStatus: args.nextStatus,

        roiCurrent: args.roiCurrent,
        roiPeak: args.roiPeak,
        maxDrawdown: args.maxDrawdown,
      },
    });

    if (result.persisted) {
      console.log(
        `[OutcomeService] ${args.symbol ?? args.tokenAddress} -> ${args.nextStatus}`
      );
    }
  } catch (error) {
    console.warn(
      "[OutcomeService] Failed:",
      error
    );
  }
}