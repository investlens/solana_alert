type LaunchIdentity = { exists: boolean; token: string; deployer: string };
import { getPonsFactoryDeployments } from '../chains/robinhood/ponsContracts.js';
const valid = (value: string | null | undefined): value is string => Boolean(value && /^0x[a-fA-F0-9]{40}$/.test(value) && !/^0x0{40}$/i.test(value));
export function creatorFromVerifiedPonsMarker(token: string, marker: unknown): string | null {
  if (!marker || typeof marker !== 'object') return null;
  const m = marker as {token?:string;creator?:string;factory?:string};
  return typeof m.token === 'string' && m.token.toLowerCase() === token.toLowerCase()
    && typeof m.factory === 'string' && getPonsFactoryDeployments().some(f => f.enabled && f.address.toLowerCase() === m.factory!.toLowerCase())
    && valid(m.creator) ? m.creator : null;
}
export async function resolvePonsCreatorFromSources(token:string, sources:{
  marker:()=>Promise<unknown>;
  indexed:()=>Promise<{exists:boolean;token:string;deployer:string|null}|null>;
  factory:()=>Promise<LaunchIdentity|null>;
}):Promise<LaunchIdentity|null> {
  const creator = creatorFromVerifiedPonsMarker(token, await sources.marker().catch(()=>null));
  if (creator) return {exists:true,token,deployer:creator};
  const indexed = await sources.indexed().catch(()=>null);
  if (indexed?.exists && indexed.token.toLowerCase()===token.toLowerCase() && valid(indexed.deployer))
    return {exists:true,token,deployer:indexed.deployer};
  return sources.factory();
}
export async function resolveCreatorIdentity(token: string, known: string | null | undefined, dependencies: {
  factory: (token: string) => Promise<LaunchIdentity | null>;
  history: (token: string) => Promise<string | null>;
}): Promise<string | null> {
  if (valid(known)) return known;
  const launch = await dependencies.factory(token).catch(() => null);
  if (launch?.exists && launch.token.toLowerCase() === token.toLowerCase() && valid(launch.deployer)) return launch.deployer;
  const historical = await dependencies.history(token).catch(() => null);
  return valid(historical) ? historical : null;
}
