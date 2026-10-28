import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';

/**
 * Isolated in-memory Postgres tests. No production database, RPC, signer or wallet.
 * Exercises the same unique wallet/mint reservation constraint as the SQL migration.
 */
describe('Echo shadow ledger atomic dedup', () => {
  it('allows one reservation under concurrent duplicate attempts', async () => {
    const db = new PGlite();
    try {
      await db.exec(`CREATE TABLE intents (
        wallet text NOT NULL,
        mint text NOT NULL,
        source_signature text NOT NULL,
        state text NOT NULL DEFAULT 'reserved',
        PRIMARY KEY(wallet,mint)
      )`);
      const reserve = async (signature: string) => {
        const result = await db.query(
          `INSERT INTO intents(wallet,mint,source_signature) VALUES($1,$2,$3)
           ON CONFLICT(wallet,mint) DO NOTHING RETURNING source_signature`,
          ['walletA','mintA',signature]
        );
        return result.rows.length === 1;
      };
      const outcomes = await Promise.all(Array.from({length: 20},(_,i)=>reserve('sig'+i)));
      assert.equal(outcomes.filter(Boolean).length,1);
      const row = await db.query('SELECT count(*)::integer AS n FROM intents');
      assert.equal(row.rows[0]?.n,1);
      assert.equal(await reserve('late-replay'),false);
      assert.equal(await db.query(
        `INSERT INTO intents(wallet,mint,source_signature) VALUES($1,$2,$3)
         ON CONFLICT(wallet,mint) DO NOTHING RETURNING source_signature`,
        ['walletB','mintA','other-wallet']
      ).then(r=>r.rows.length),1);
    } finally { await db.close(); }
  });
});
