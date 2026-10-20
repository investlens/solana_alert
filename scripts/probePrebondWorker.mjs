// Generated read-only diagnostic from PR243 reader; not research collection.
import { decodeFunctionResult, encodeFunctionData, parseAbi } from 'viem';
const ABI = parseAbi(['function token() view returns(address)', 'function pairToken() view returns(address)',
    'function getReserves() view returns(uint256,uint256)', 'function graduated() view returns(bool)']);
const address = (v) => typeof v === 'string' && /^0x[a-f0-9]{40}$/i.test(v) && !/^0x0{40}$/i.test(v);
export async function readPrebondResearchQuote(token, curve, rpc, now = Date.now, check = () => { }) {
    const unavailable = (reason) => ({ status: 'UNAVAILABLE', price: null, at: new Date(now()).toISOString(), block: null, block_hash: null, reason });
    if (!address(token) || !address(curve) || token.toLowerCase() === curve.toLowerCase())
        return unavailable('INVALID_IDENTITY');
    try {
        check();
        const raw = await rpc({ method: 'eth_blockNumber', params: [] });
        check();
        if (typeof raw !== 'string' || !/^0x[a-f0-9]+$/i.test(raw) || BigInt(raw) < 2n)
            return unavailable('INVALID_HEAD');
        const height = BigInt(raw) - 2n, block = '0x' + height.toString(16);
        const header = await rpc({ method: 'eth_getBlockByNumber', params: [block, false] });
        check();
        if (!header || header.number?.toLowerCase() !== block || !/^0x[a-f0-9]{64}$/i.test(header.hash ?? '') || !/^0x[a-f0-9]+$/i.test(header.timestamp ?? ''))
            return unavailable('INVALID_BLOCK');
        const at = Number(BigInt(header.timestamp)) * 1000;
        if (!Number.isSafeInteger(at) || at > now() || now() - at > 30_000)
            return unavailable('STALE_BLOCK');
        const read = async (functionName) => {
            check();
            const value = await rpc({ method: 'eth_call', params: [{ to: curve, data: encodeFunctionData({ abi: ABI, functionName }) }, block] });
            check();
            if (typeof value !== 'string' || !/^0x[a-f0-9]+$/i.test(value))
                throw Error('Invalid response');
            return decodeFunctionResult({ abi: ABI, functionName, data: value });
        };
        // Serial reads respect the existing provider gate and use exactly one block.
        const actualToken = await read('token'), quote = await read('pairToken');
        if (String(actualToken).toLowerCase() !== token.toLowerCase())
            return unavailable('TOKEN_MISMATCH');
        if (String(quote).toLowerCase() !== '0x' + '0'.repeat(40))
            return unavailable('NON_NATIVE_QUOTE');
        const graduated = await read('graduated');
        const identity = { at: new Date(at).toISOString(), block: height.toString(), block_hash: String(header.hash).toLowerCase() };
        if (graduated === true)
            return { status: 'GRADUATED', price: null, ...identity, reason: 'VENUE_TRANSITION' };
        const reserves = await read('getReserves');
        const price = Number(reserves[0]) / Number(reserves[1]);
        check();
        if (reserves[0] <= 0n || reserves[1] <= 0n || !Number.isFinite(price) || price <= 0)
            return unavailable('INVALID_RESERVES');
        if (now() - at > 30_000)
            return unavailable('STALE_BLOCK');
        return { status: 'MEASURED', price, ...identity };
    }
    catch {
        return unavailable('PROVIDER_UNAVAILABLE');
    }
}
// One-shot, read-only diagnostic. Not imported by any startup/alert path.
import { requestRobinhoodRpcResilient } from '../src/chains/robinhood/rpc.js';
import { withRequestDeadline, throwIfRequestAborted } from '../src/services/requestDeadline.js';
import { withDatabaseRequestPriority } from '../src/services/databaseLoadGovernor.js';
import { supabase } from '../src/services/supabase.js';
import { getPonsFactoryDeployments } from '../src/chains/robinhood/ponsContracts.js';
const log = (value) => console.log('[PrebondRpcProbe]', JSON.stringify(value));
const watchdog = setTimeout(() => { log({ status: 'PROBE_DEADLINE', researchCollection: false }); process.exit(0); }, 20_000);
try {
    log({ status: 'START', readOnly: true, researchCollection: false, maxCandidates: 3, snapshotDeadlineMs: 4000 });
    const { data, error } = await withDatabaseRequestPriority('BACKGROUND', async () => await supabase.from('pons_launches')
        .select('token_address,curve_address,factory_address,protocol_version,block_timestamp').eq('chain', 'robinhood').eq('protocol_version', 'v2-current')
        .order('block_timestamp', { ascending: false }).limit(3).abortSignal(AbortSignal.timeout(2000)));
    if (error)
        throw Error('SOURCE_UNAVAILABLE');
    const chain = await withRequestDeadline(2000, () => requestRobinhoodRpcResilient({ method: 'eth_chainId', params: [] }));
    if (chain !== '0x1237')
        throw Error('CHAIN_UNVERIFIED');
    for (const row of data ?? []) {
        if (!getPonsFactoryDeployments().some(f => f.enabled && f.generation === 'v2' && f.id === row.protocol_version && f.address.toLowerCase() === row.factory_address?.toLowerCase()))
            continue;
        const durations = [];
        const started = Date.now();
        const rpc = async (args) => {
            const at = Date.now();
            try {
                const value = await requestRobinhoodRpcResilient(args);
                durations.push({ method: args.method, selector: args.params?.[0]?.data?.slice(0, 10), ms: Date.now() - at, status: 'OK' });
                return value;
            }
            catch (error) {
                durations.push({ method: args.method, ms: Date.now() - at, status: 'UNAVAILABLE' });
                throw error;
            }
        };
        try {
            const value = await withRequestDeadline(4000, () => readPrebondResearchQuote(row.token_address, row.curve_address, rpc, Date.now, throwIfRequestAborted));
            log({ status: 'RESULT', token: row.token_address, elapsedMs: Date.now() - started, durations, value });
        }
        catch {
            log({ status: 'SNAPSHOT_DEADLINE', token: row.token_address, elapsedMs: Date.now() - started, durations });
        }
    }
    log({ status: 'COMPLETE', candidates: data?.length ?? 0, researchCollection: false });
}
catch {
    log({ status: 'PROBE_UNAVAILABLE', researchCollection: false });
}
finally {
    clearTimeout(watchdog);
    process.exit(0);
}
