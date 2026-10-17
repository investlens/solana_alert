import { open } from 'node:fs/promises';
import { compareReportedDemand, readReportedDemandWindow } from '../src/services/confirmedDemandShadow.js';

// Explicit local-file replay only; never loads .env or production clients.
// Input: { first: {scope,page}, second: {scope,page} }. Maximum 256 KiB.
const path = process.argv[2];
if (!path) throw Error('Usage: node --import tsx scripts/replayConfirmedDemand.ts input.json');
const file = await open(path, 'r');
let input: any;
try {
  const stat = await file.stat();
  if (!stat.isFile() || stat.size > 262_144) throw Error('Regular input file up to 256 KiB required');
  const buffer = Buffer.alloc(262_145);
  const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
  if (bytesRead > 262_144) throw Error('Input exceeds 256 KiB');
  input = JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'));
} finally { await file.close(); }
const first = readReportedDemandWindow(input?.first?.scope, input?.first?.page);
const second = readReportedDemandWindow(input?.second?.scope, input?.second?.page);
console.log(JSON.stringify(first.window && second.window ? compareReportedDemand(first.window, second.window)
  : { mode: 'OFFLINE_SHADOW', status: 'INSUFFICIENT_EVIDENCE', eligibleForAlert: false,
    firstReason: first.reason, secondReason: second.reason }, null, 2));
