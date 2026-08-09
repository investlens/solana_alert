import type {
  ChainAdapter,
} from './chainAdapter.js';

import type {
  ChainId,
} from './types.js';

const adapters =
  new Map<ChainId, ChainAdapter>();

export function registerChainAdapter(
  adapter: ChainAdapter,
): void {
  adapters.set(
    adapter.id,
    adapter,
  );

  console.log(
    `[ChainRegistry] Registered ${adapter.name}`,
  );
}

export function getChainAdapter(
  chain: ChainId,
): ChainAdapter {
  const adapter =
    adapters.get(chain);

  if (!adapter) {
    throw new Error(
      `Chain adapter not registered: ${chain}`,
    );
  }

  return adapter;
}

export function hasChainAdapter(
  chain: ChainId,
): boolean {
  return adapters.has(chain);
}

export function getRegisteredChains():
  ChainId[] {
  return Array.from(
    adapters.keys(),
  );
}
