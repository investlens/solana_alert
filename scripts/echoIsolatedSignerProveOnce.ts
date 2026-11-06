/** One-shot manual proof ONLY. Run inside the isolated service after an
 * authorized operator installs a sealed dedicated-wallet variable there.
 *
 * Does not run in AlphaOS startup, touch the legacy bot, open a listener,
 * connect to RPC, write any database or broadcast. Output only is
 * VERIFIED/MISMATCH/UNPROVISIONED with TRADING=OFF.
 */
import {proveEchoPinnedSealedCustodyFromEnv}
 from '../src/echo/isolatedSealedCustodyProof.js';
const status=await proveEchoPinnedSealedCustodyFromEnv(process.env);
process.stdout.write('ECHO_ISOLATED_CUSTODY='+status+';TRADING=OFF\n');
if(status!=='VERIFIED')process.exitCode=2;
