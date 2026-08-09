export type RobinhoodSecuritySeverity =
  | 'LOW'
  | 'MEDIUM'
  | 'HIGH'
  | 'CRITICAL';

export type RobinhoodSecurityDecision =
  | 'PASS'
  | 'REVIEW'
  | 'BLOCK';

export type RobinhoodSecurityCheck = {
  id: string;

  passed: boolean | null;

  severity:
    RobinhoodSecuritySeverity;

  message: string;

  details?: Record<
    string,
    unknown
  >;
};

export type RobinhoodContractSecurityResult = {
  chain: 'robinhood';

  tokenAddress: string;

  decision:
    RobinhoodSecurityDecision;

  score: number;

  severity:
    RobinhoodSecuritySeverity;

  bytecodeExists: boolean;

  metadataReadable: boolean;

  name: string | null;

  symbol: string | null;

  decimals: number | null;

  totalSupplyRaw:
    string | null;

  blockers: string[];

  warnings: string[];

  checks:
    RobinhoodSecurityCheck[];

  scannedAt: number;
};
