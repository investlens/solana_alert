type LaunchIdentity = { exists: boolean; token: string; deployer: string };
const valid = (value: string | null | undefined): value is string => Boolean(value && /^0x[a-fA-F0-9]{40}$/.test(value) && !/^0x0{40}$/i.test(value));
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
