// Standard JSON RPC responses are parsed directly; no web3 wire decoder is used.
// Opt into v1 as well as legacy/v0. A ceiling of 0 rejects otherwise valid
// confirmed v1 swaps with RPC -32015 (observed on Croakie's real trade).
export function readEchoTransaction(signature: string, rpc: (method: string, params: unknown[]) => Promise<any>) {
  return rpc('getTransaction', [signature, { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 1 }]);
}
