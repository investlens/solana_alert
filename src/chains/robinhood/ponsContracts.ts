export const PONS_CONTRACTS = {
  factory:
    '0xA5aAb3F0c6EeadF30Ef1D3Eb997108E976351feB',

  locker:
    '0x736D76699C26D0d966744cAe304C000d471f7F35',

  uniswapV3Factory:
    '0x1f7d7550B1b028f7571E69A784071F0205FD2EfA',

  positionManager:
    '0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3',

  swapRouter:
    '0xCaf681a66D020601342297493863E78C959E5cb2',

  quoterV2:
    '0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7',

  weth:
    '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73',
} as const;

export const PONS_POOL_FEE =
  10_000;

export const PONS_V1_TOKEN_LAUNCHED_EVENT =
  'event TokenLaunched(address indexed token, address indexed deployer, address indexed dexFactory, address pairToken, address pool, uint256 dexId, uint256 launchConfigId, uint256 positionId, uint256 restrictionsEndBlock, uint256 initialBuyAmount)' as const;

export const PONS_V2_TOKEN_LAUNCHED_EVENT =
  'event TokenLaunched(address indexed token, address indexed curve, address indexed deployer, address pairToken, uint256 launchConfigId, uint256 graduationThreshold)' as const;

export type PonsFactoryDeployment = {
  id: string;
  generation: 'v1' | 'v2';
  address: `0x${string}`;
  startBlock: bigint | null;
  endBlock?: bigint;
  tokenLaunchedEvent: typeof PONS_V1_TOKEN_LAUNCHED_EVENT | typeof PONS_V2_TOKEN_LAUNCHED_EVENT;
  enabled: boolean;
};

/**
 * Historical factory registry. Add retired/replacement deployments here rather
 * than teaching the indexer about individual addresses.
 *
 * V2 start blocks are the first observed TokenLaunched blocks, not independently
 * verified contract deployment blocks.
 */
export const PONS_FACTORY_DEPLOYMENTS: readonly PonsFactoryDeployment[] = [
  {
    id: 'v1-legacy', generation: 'v1',
    address: '0x0c37a24F5D23A486FA692d1500881d698B1F77a4',
    startBlock: 8_600_612n, tokenLaunchedEvent: PONS_V1_TOKEN_LAUNCHED_EVENT, enabled: true,
  },
  {
    id: 'v1-active', generation: 'v1', address: PONS_CONTRACTS.factory,
    startBlock: 8_991_118n, tokenLaunchedEvent: PONS_V1_TOKEN_LAUNCHED_EVENT, enabled: true,
  },
  {
    id: 'v2-old', generation: 'v2',
    address: '0x7E1EAbd52Ae29598e6483F72dCf1a70b14284dB8',
    startBlock: 24_364_906n, tokenLaunchedEvent: PONS_V2_TOKEN_LAUNCHED_EVENT, enabled: true,
  },
  {
    id: 'v2-current', generation: 'v2',
    address: '0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e',
    startBlock: 27_027_321n, tokenLaunchedEvent: PONS_V2_TOKEN_LAUNCHED_EVENT, enabled: true,
  },
] as const;

export function getPonsFactoryDeployments(): PonsFactoryDeployment[] {
  return PONS_FACTORY_DEPLOYMENTS.map(factory => ({ ...factory }));
}
