import { getBundleIntelligenceV2 } from '../src/scoring/bundleIntelligenceV2.js';

const mint = String(process.argv[2] ?? '').trim();
if (!mint) {
  console.error('Usage: npx tsx scripts/testBundleIntelligenceV2.ts <mint>');
  process.exit(1);
}

const result = await getBundleIntelligenceV2(mint);
console.log(JSON.stringify({ mint, result }, null, 2));
