import 'viem';

declare module 'viem' {
  export function decodeEventLog(args: {
    abi: readonly unknown[];
    data: `0x${string}`;
    topics: readonly `0x${string}`[];
    strict?: boolean;
  }): any;
}
