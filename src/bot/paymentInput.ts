import bs58 from 'bs58';

export function isLikelySolanaSignature(value: string): boolean {
  const signature = value.trim();
  if (signature.length < 80 || signature.length > 90) return false;
  try {
    return bs58.decode(signature).length === 64;
  } catch {
    return false;
  }
}
