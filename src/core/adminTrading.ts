import bs58 from 'bs58';
import { Connection, Keypair, PublicKey, VersionedTransaction } from '@solana/web3.js';
import { config } from '../config.js';

const SOL_MINT = 'So11111111111111111111111111111111111111112';

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
}) {
  const res = await fetch('https://api.jup.ag/swap/v1/swap', {
    method: 'POST',
    headers: getJupiterHeaders(),
    body: JSON.stringify({
      quoteResponse: args.quoteResponse,
      userPublicKey: args.userPublicKey,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: 'auto',
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
    maxRetries: 3,
  });

  const latest = await connection.getLatestBlockhash();

  await connection.confirmTransaction(
    {
      signature,
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
    },
    'confirmed'
  );

  return signature;
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
  const lamports = Math.floor(args.amountSol * 1_000_000_000);

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
  });

  const signature = await signAndSendSerializedSwap(built.swapTransaction);

  return {
    signature,
    quote,
  };
}

export function getAdminTradingWalletAddress() {
  return getAdminKeypair().publicKey.toBase58();
}