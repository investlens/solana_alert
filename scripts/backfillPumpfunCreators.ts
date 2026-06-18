import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const BITQUERY_API_TOKEN = process.env.BITQUERY_API_TOKEN ?? '';
const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

type PumpfunCreateRow = {
  Block?: { Time?: string };
  TokenSupplyUpdate?: {
    Currency?: {
      MintAddress?: string;
      Name?: string;
      Symbol?: string;
      Uri?: string;
      IsMutable?: boolean;
    };
  };
  Transaction?: {
    Signer?: string;
    Hash?: string;
  };
};

async function fetchPumpfunCreates(limit = 100) {
  if (!BITQUERY_API_TOKEN) {
    throw new Error('Missing BITQUERY_API_TOKEN');
  }

  const query = `
query PumpfunCreatorBackfill {
  Solana(dataset: archive) {
    TokenSupplyUpdates(
      limit: { count: ${limit} }
      orderBy: { descending: Block_Time }
      where: {
        Instruction: {
          Program: {
            Method: { in: ["create", "create_v2"] }
            Address: { is: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P" }
          }
        }
      }
    ) {
      Block {
        Time
      }
      TokenSupplyUpdate {
        Currency {
          MintAddress
          Name
          Symbol
          Uri
          IsMutable
        }
      }
      Transaction {
        Signer
        Hash
      }
    }
  }
}
`;

  const res = await fetch('https://streaming.bitquery.io/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${BITQUERY_API_TOKEN}`,
    },
    body: JSON.stringify({ query }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Bitquery failed: ${res.status} ${text}`);
  }

  const json = await res.json();

  if (json?.errors?.length) {
    throw new Error(`Bitquery errors: ${JSON.stringify(json.errors)}`);
  }

  return (json?.data?.Solana?.TokenSupplyUpdates ?? []) as PumpfunCreateRow[];
}

async function saveLaunch(row: PumpfunCreateRow) {
  const mint = row.TokenSupplyUpdate?.Currency?.MintAddress;
  const creator = row.Transaction?.Signer ?? null;

  if (!mint) return false;

  const { error } = await supabase.from('creator_launches').upsert(
    {
      creator_wallet: creator,
      token: mint,
      symbol: row.TokenSupplyUpdate?.Currency?.Symbol ?? null,
      name: row.TokenSupplyUpdate?.Currency?.Name ?? null,
      launched_at: row.Block?.Time ?? new Date().toISOString(),
      last_checked_at: new Date().toISOString(),
    },
    { onConflict: 'token' }
  );

  if (error) {
    console.log('save failed:', mint, error.message);
    return false;
  }

  return true;
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Missing Supabase env variables');
  }

  console.log('Fetching Pump.fun creator launches...');

  const rows = await fetchPumpfunCreates(100);

  console.log(`Fetched ${rows.length} rows`);

  let saved = 0;

  for (const row of rows) {
    const ok = await saveLaunch(row);
    if (ok) saved += 1;
  }

  console.log(`Saved ${saved} creator launches`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});