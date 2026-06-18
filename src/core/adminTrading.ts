import bs58 from 'bs58';
import { Connection, Keypair, PublicKey, VersionedTransaction } from '@solana/web3.js';
import { config } from '../config.js';

const SOL_MINT = 'So11111111111111111111111111111111111111112';

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getConnection() {
  return new Connection(config.solanaRpcUrl, 'confirmed');
}

function getAdminKeypair() {
  if (!config.adminTradingPrivateKey) {
    throw new Error('Missing ADMIN_TRADING_PRIVATE_KEY');
  }

  const secret = bs58.decode(config.adminTradingPrivateKey);
  return Keypair.fromSecretKey(secret);
}

function getJupiterHeaders() {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (config.jupiterApiKey) {
    headers['x-api-key'] = config.jupiterApiKey;
  }

  return headers;
}

async function getQuote(args: {
  inputMint: string;
  outputMint: string;
  amount: string;
  slippageBps: number;
}) {
  const params = new URLSearchParams({
    inputMint: args.inputMint,
    outputMint: args.outputMint,
    amount: args.amount,
    slippageBps: String(args.slippageBps),
    restrictIntermediateTokens: 'true',
  });

  const res = await fetch(`https://api.jup.ag/swap/v1/quote?${params.toString()}`, {
    headers: config.jupiterApiKey ? { 'x-api-key': config.jupiterApiKey } : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Jupiter quote failed: ${res.status} ${text}`);
  }

  return res.json();
}

async function buildSwapTransaction(args: {
  quoteResponse: any;
  userPublicKey: string;
  priorityFeeLamports?: number | 'auto';
}) {
  const res = await fetch('https://api.jup.ag/swap/v1/swap', {
    method: 'POST',
    headers: getJupiterHeaders(),
    body: JSON.stringify({
      quoteResponse: args.quoteResponse,
      userPublicKey: args.userPublicKey,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: args.priorityFeeLamports ?? 'auto',
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Jupiter swap build failed: ${res.status} ${text}`);
  }

  return res.json();
}

async function signAndSendSerializedSwap(swapTransactionB64: string) {
  const connection = getConnection();
  const signer = getAdminKeypair();

  const txBuf = Buffer.from(swapTransactionB64, 'base64');
  const tx = VersionedTransaction.deserialize(txBuf);

  tx.sign([signer]);

  const signature = await connection.sendTransaction(tx, {
    skipPreflight: false,
    maxRetries: 5,
  });

  const latest = await connection.getLatestBlockhash();

  const confirmation = await connection.confirmTransaction(
    {
      signature,
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
    },
    'confirmed'
  );

  if (confirmation.value.err) {
    throw new Error(`Transaction failed on-chain: ${JSON.stringify(confirmation.value.err)}`);
  }

  return signature;
}

async function getAdminTokenRawBalance(inputMint: string): Promise<bigint> {
  const connection = getConnection();
  const owner = getAdminKeypair().publicKey;

  const accounts = await connection.getParsedTokenAccountsByOwner(owner, {
    mint: new PublicKey(inputMint),
  });

  if (!accounts.value.length) {
    return 0n;
  }

  let total = 0n;

  for (const account of accounts.value) {
    const amount = account.account.data.parsed.info.tokenAmount.amount as string;
    total += BigInt(amount);
  }

  return total;
}

export async function adminBuyToken(args: {
  outputMint: string;
  amountSol: number;
  slippageBps?: number;
}) {
  if (!config.adminTradingEnabled) {
    throw new Error('Admin trading is disabled');
  }

  const signer = getAdminKeypair();

  const connection = getConnection();
  const balance = await connection.getBalance(signer.publicKey);

  const safeLamports = Math.floor(
  Math.min(
    balance * 0.8,
    Math.floor(args.amountSol * 1_000_000_000)
  )
);

  if (safeLamports < 10_000_000) {
    throw new Error('Not enough SOL to safely execute trade');
  }

  const lamports = safeLamports;

  const quote = await getQuote({
    inputMint: SOL_MINT,
    outputMint: args.outputMint,
    amount: String(lamports),
    slippageBps: args.slippageBps ?? config.adminMaxSlippageBps,
  });

  const built = await buildSwapTransaction({
    quoteResponse: quote,
    userPublicKey: signer.publicKey.toBase58(),
  });

  const signature = await signAndSendSerializedSwap(built.swapTransaction);

  return {
    signature,
    quote,
  };
}

export async function adminSellTokenPercent(args: {
  inputMint: string;
  percent: 25 | 50 | 100;
  slippageBps?: number;
  priorityFeeLamports?: number | 'auto';
}) {
  if (!config.adminTradingEnabled) {
    throw new Error('Admin trading is disabled');
  }

  const connection = getConnection();
  const signer = getAdminKeypair();
  const owner = signer.publicKey;

  const accounts = await connection.getParsedTokenAccountsByOwner(owner, {
    mint: new PublicKey(args.inputMint),
  });

  const tokenAccount = accounts.value[0];
  if (!tokenAccount) {
    throw new Error('No token balance found for this mint');
  }

  const rawAmount = BigInt(
    tokenAccount.account.data.parsed.info.tokenAmount.amount as string
  );

  if (rawAmount <= 0n) {
    throw new Error('Token balance is zero');
  }

  const sellRaw =
    args.percent === 100
      ? rawAmount
      : (rawAmount * BigInt(args.percent)) / 100n;

  if (sellRaw <= 0n) {
    throw new Error('Calculated sell amount is zero');
  }

  const quote = await getQuote({
    inputMint: args.inputMint,
    outputMint: SOL_MINT,
    amount: sellRaw.toString(),
    slippageBps: args.slippageBps ?? config.adminMaxSlippageBps,
  });

  const built = await buildSwapTransaction({
    quoteResponse: quote,
    userPublicKey: owner.toBase58(),
    priorityFeeLamports: args.priorityFeeLamports ?? 'auto',
  });

  const signature = await signAndSendSerializedSwap(built.swapTransaction);

  return {
    signature,
    quote,
  };
}

export async function adminSellTokenPercentWithRetry(args: {
  inputMint: string;
  percent: 25 | 50 | 100;
}) {
  const attempts = [
    { slippageBps: config.adminMaxSlippageBps, priorityFeeLamports: 'auto' as const },
    { slippageBps: 2500, priorityFeeLamports: 250_000 },
    { slippageBps: 4000, priorityFeeLamports: 500_000 },
    { slippageBps: 6500, priorityFeeLamports: 900_000 },
    { slippageBps: 9000, priorityFeeLamports: 1_500_000 },
  ];

  let lastError: unknown = null;

  for (let i = 0; i < attempts.length; i++) {
    try {
      console.log('SELL ATTEMPT:', {
        mint: args.inputMint,
        percent: args.percent,
        attempt: i + 1,
        ...attempts[i],
      });

      const beforeBalance = await getAdminTokenRawBalance(args.inputMint);

      const result = await adminSellTokenPercent({
        inputMint: args.inputMint,
        percent: args.percent,
        slippageBps: attempts[i].slippageBps,
        priorityFeeLamports: attempts[i].priorityFeeLamports,
      });

      await sleep(2500);

      let afterBalance: bigint | null = null;

      try {
        afterBalance = await getAdminTokenRawBalance(args.inputMint);
      } catch (balanceError) {
        console.log('SELL BALANCE CHECK FAILED AFTER CONFIRMED TX:', {
          mint: args.inputMint,
          signature: result.signature,
          error: balanceError instanceof Error ? balanceError.message : String(balanceError),
        });

        // Important: tx already confirmed, so do NOT retry and accidentally double-sell.
        return {
          ...result,
          beforeBalance: beforeBalance.toString(),
          afterBalance: 'unknown',
          balanceCheckFailed: true,
        };
      }

      if (args.percent === 100 && afterBalance > 0n && afterBalance >= beforeBalance) {
        throw new Error('Sell tx confirmed but token balance did not decrease');
      }

      console.log('SELL SUCCESS:', {
        mint: args.inputMint,
        signature: result.signature,
        beforeBalance: beforeBalance.toString(),
        afterBalance: afterBalance.toString(),
      });

      return {
        ...result,
        beforeBalance: beforeBalance.toString(),
        afterBalance: afterBalance.toString(),
      };
    } catch (error) {
      lastError = error;

      console.log('SELL ATTEMPT FAILED:', {
        mint: args.inputMint,
        attempt: i + 1,
        error: error instanceof Error ? error.message : String(error),
      });

      await sleep(2500);
    }
  }

  throw new Error(
    `Sell failed after retries: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`
  );
}

export function getAdminTradingWalletAddress() {
  return getAdminKeypair().publicKey.toBase58();
}