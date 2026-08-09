import {
  getAddress,
} from 'viem';

import {
  robinhoodPublicClient,
} from '../rpc.js';

import {
  getRobinhoodTokenMetadata,
} from '../tokenMetadata.js';

import type {
  RobinhoodContractSecurityResult,
  RobinhoodSecurityCheck,
  RobinhoodSecurityDecision,
  RobinhoodSecuritySeverity,
} from './types.js';

function clampScore(
  score: number,
): number {
  return Math.max(
    0,
    Math.min(
      100,
      Math.round(score),
    ),
  );
}

function severityRank(
  severity:
    RobinhoodSecuritySeverity,
): number {
  switch (severity) {
    case 'CRITICAL':
      return 4;

    case 'HIGH':
      return 3;

    case 'MEDIUM':
      return 2;

    case 'LOW':
    default:
      return 1;
  }
}

function highestSeverity(
  checks:
    RobinhoodSecurityCheck[],
): RobinhoodSecuritySeverity {
  let severity:
    RobinhoodSecuritySeverity =
      'LOW';

  for (const check of checks) {
    if (
      !check.passed &&
      severityRank(
        check.severity,
      ) >
        severityRank(
          severity,
        )
    ) {
      severity =
        check.severity;
    }
  }

  return severity;
}

function calculateDecision(args: {
  score: number;

  blockers: string[];

  warnings: string[];
}): RobinhoodSecurityDecision {
  if (
    args.blockers.length > 0
  ) {
    return 'BLOCK';
  }

  if (
    args.score < 70 ||
    args.warnings.length >= 2
  ) {
    return 'REVIEW';
  }

  return 'PASS';
}

export async function scanRobinhoodContractSecurity(
  tokenAddress: string,
): Promise<RobinhoodContractSecurityResult> {
  const address =
    getAddress(
      tokenAddress,
    );

  const scannedAt =
    Date.now();

  const checks:
    RobinhoodSecurityCheck[] =
      [];

  const blockers:
    string[] = [];

  const warnings:
    string[] = [];

  let score = 100;

  /*
   * CHECK 1
   *
   * Contract code must exist.
   */
  const bytecode =
    await robinhoodPublicClient
      .getCode({
        address,
      });

  const bytecodeExists =
    Boolean(
      bytecode &&
      bytecode !== '0x',
    );

  checks.push({
    id:
      'BYTECODE_EXISTS',

    passed:
      bytecodeExists,

    severity:
      'CRITICAL',

    message:
      bytecodeExists
        ? 'Contract bytecode exists.'
        : 'No contract bytecode found.',
  });

  if (!bytecodeExists) {
    blockers.push(
      'No contract bytecode found',
    );

    score -= 100;

    return {
      chain:
        'robinhood',

      tokenAddress:
        address,

      decision:
        'BLOCK',

      score:
        0,

      severity:
        'CRITICAL',

      bytecodeExists:
        false,

      metadataReadable:
        false,

      name:
        null,

      symbol:
        null,

      decimals:
        null,

      totalSupplyRaw:
        null,

      blockers,

      warnings,

      checks,

      scannedAt,
    };
  }

  /*
   * CHECK 2
   *
   * Standard ERC-20 metadata should be
   * readable.
   */
  const metadata =
    await getRobinhoodTokenMetadata(
      address,
    );

  const metadataReadable =
    Boolean(
      metadata.name &&
      metadata.symbol &&
      metadata.decimals != null &&
      metadata.totalSupplyRaw != null &&
      metadata.readErrors.length === 0,
    );

  checks.push({
    id:
      'ERC20_METADATA',

    passed:
      metadataReadable,

    severity:
      'HIGH',

    message:
      metadataReadable
        ? 'Standard ERC-20 metadata is readable.'
        : 'One or more standard ERC-20 metadata reads failed.',

    details: {
      readErrors:
        metadata.readErrors,
    },
  });

  if (!metadataReadable) {
    warnings.push(
      'Standard ERC-20 metadata is incomplete',
    );

    score -= 20;
  }

  /*
   * CHECK 3
   *
   * Decimals sanity.
   *
   * Most ERC-20 assets use <= 18.
   * We treat unusual values as review-worthy
   * rather than automatically malicious.
   */
  const decimalsSane =
    metadata.decimals != null &&
    metadata.decimals >= 0 &&
    metadata.decimals <= 18;

  checks.push({
    id:
      'DECIMALS_SANITY',

    passed:
      decimalsSane,

    severity:
      'MEDIUM',

    message:
      decimalsSane
        ? `Decimals look sane (${metadata.decimals}).`
        : `Unusual or unreadable decimals (${metadata.decimals ?? 'unknown'}).`,
  });

  if (!decimalsSane) {
    warnings.push(
      'Token decimals are unusual or unreadable',
    );

    score -= 10;
  }

  /*
   * CHECK 4
   *
   * Supply must exist and be positive.
   */
  const positiveSupply =
    metadata.totalSupplyRaw != null &&
    metadata.totalSupplyRaw > 0n;

  checks.push({
    id:
      'POSITIVE_SUPPLY',

    passed:
      positiveSupply,

    severity:
      'HIGH',

    message:
      positiveSupply
        ? 'Token has positive total supply.'
        : 'Token total supply is zero or unreadable.',
  });

  if (!positiveSupply) {
    blockers.push(
      'Invalid or zero total supply',
    );

    score -= 35;
  }

  /*
   * CHECK 5
   *
   * Very small bytecode deserves review.
   *
   * This does NOT attempt to label proxies,
   * honeypots or malicious contracts.
   * It is simply an anomaly signal.
   */
  const bytecodeLength =
    bytecode
      ? Math.max(
          0,
          (bytecode.length - 2) /
            2,
        )
      : 0;

  const suspiciouslySmallCode =
    bytecodeLength > 0 &&
    bytecodeLength < 100;

  checks.push({
    id:
      'BYTECODE_SIZE',

    passed:
      !suspiciouslySmallCode,

    severity:
      'MEDIUM',

    message:
      suspiciouslySmallCode
        ? `Contract bytecode is unusually small (${bytecodeLength} bytes).`
        : `Contract bytecode size is ${bytecodeLength} bytes.`,

    details: {
      bytecodeLength,
    },
  });

  if (suspiciouslySmallCode) {
    warnings.push(
      'Unusually small contract bytecode',
    );

    score -= 10;
  }

  score =
    clampScore(
      score,
    );

  const decision =
    calculateDecision({
      score,
      blockers,
      warnings,
    });

  return {
    chain:
      'robinhood',

    tokenAddress:
      address,

    decision,

    score,

    severity:
      highestSeverity(
        checks,
      ),

    bytecodeExists,

    metadataReadable,

    name:
      metadata.name,

    symbol:
      metadata.symbol,

    decimals:
      metadata.decimals,

    totalSupplyRaw:
      metadata.totalSupplyRaw
        ?.toString() ??
      null,

    blockers,

    warnings,

    checks,

    scannedAt,
  };
}
