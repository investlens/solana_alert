export type PonsLaunchReportRow = { deployer_address: string; protocol_version: string; block_timestamp: string };
export type PonsDeveloperReport = { developer: string; totalLaunches: number; firstLaunch: string; latestLaunch: string; countsByVersion: Record<string, number> };

export function aggregatePonsDevelopers(rows: PonsLaunchReportRow[]): PonsDeveloperReport[] {
  const developers = new Map<string, PonsDeveloperReport>();
  for (const row of rows) {
    const developer = row.deployer_address.toLowerCase();
    const current = developers.get(developer) ?? { developer, totalLaunches: 0, firstLaunch: row.block_timestamp, latestLaunch: row.block_timestamp, countsByVersion: {} };
    current.totalLaunches += 1;
    if (row.block_timestamp < current.firstLaunch) current.firstLaunch = row.block_timestamp;
    if (row.block_timestamp > current.latestLaunch) current.latestLaunch = row.block_timestamp;
    current.countsByVersion[row.protocol_version] = (current.countsByVersion[row.protocol_version] ?? 0) + 1;
    developers.set(developer, current);
  }
  return [...developers.values()].sort((a, b) => b.totalLaunches - a.totalLaunches || a.developer.localeCompare(b.developer));
}
