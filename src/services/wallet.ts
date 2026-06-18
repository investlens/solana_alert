import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import { config } from '../config.js';

const connection = new Connection('https://api.mainnet-beta.solana.com');

function getAdminKeypair() {
  const raw = config.adminTradingPrivateKey;

  if (!raw) {
    throw new Error('ADMIN_TRADING_PRIVATE_KEY is missing');
  }

  const trimmed = raw.trim();

  // Supports JSON array private key: [1,2,3,...]
  if (trimmed.startsWith('[')) {
    const secret = Uint8Array.from(JSON.parse(trimmed));
    return Keypair.fromSecretKey(secret);
  }

  // Supports base58 private key
  const secret = bs58.decode(trimmed);
  return Keypair.fromSecretKey(secret);
}

export function getAdminWalletAddress() {
  return getAdminKeypair().publicKey.toBase58();
}

export async function getAdminWalletBalance() {
  const pubkey = new PublicKey(getAdminWalletAddress());
  const lamports = await connection.getBalance(pubkey);
  return lamports / 1e9;
}