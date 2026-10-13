// Locate only blocks containing wallet-initiated transactions. Empty ranges
// cost one nonce comparison, rather than fetching every full block.
export async function locateWalletNonceBlocks(args: {
  from: bigint; to: bigint; before: bigint; after: bigint;
  nonceAt: (block: bigint) => Promise<bigint>; maxReads?: number; maxBlocks?: number;
}) {
  const blocks: bigint[] = []; let reads = 0, throughBlock = args.from;
  const visit = async (low: bigint, before: bigint, high: bigint, after: bigint): Promise<boolean> => {
    if (after < before) throw new Error('Wallet nonce decreased; retain checkpoint for reorg verification');
    if (before === after) { throughBlock = high; return true; }
    if (blocks.length >= (args.maxBlocks ?? 4)) return false;
    if (high - low <= 1n) { blocks.push(high); throughBlock = high; return true; }
    if (reads >= (args.maxReads ?? 24)) return false;
    const middle = (low + high) / 2n; reads++;
    const nonce = await args.nonceAt(middle);
    if (nonce < before || nonce > after) throw new Error('Inconsistent wallet nonce; retain checkpoint');
    if (!await visit(low, before, middle, nonce)) return false;
    return visit(middle, nonce, high, after);
  };
  if (args.to < args.from) throw new Error('Invalid nonce scan range');
  const complete = await visit(args.from, args.before, args.to, args.after);
  return { blocks, reads, throughBlock, complete };
}
