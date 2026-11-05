export const MAX_LOG_CHUNKS = 400;

export class LogRangeError extends Error {
  readonly window: bigint;
  readonly fromBlock: bigint;
  readonly toBlock: bigint;

  constructor(window: bigint, fromBlock: bigint, toBlock: bigint) {
    const span = toBlock - fromBlock + 1n;
    const calls = chunkCount(fromBlock, toBlock, window);
    super(
      `El RPC solo acepta ${window} bloques por eth_getLogs y hay que cubrir ${span} bloques desde ${fromBlock}. Serian ${calls} llamadas.`,
    );
    this.name = "LogRangeError";
    this.window = window;
    this.fromBlock = fromBlock;
    this.toBlock = toBlock;
  }
}

export function logRangeLimit(message: string): bigint | undefined {
  const bounded = message.match(/limited to\s+(\d[\d,]*)\s*-\s*(\d[\d,]*)\s+blocks/i);
  if (bounded?.[1] && bounded[2]) {
    const low = parseBig(bounded[1]);
    const high = parseBig(bounded[2]);
    const span = high > low ? high - low : high;
    if (span > 0n) return span;
  }
  const patterns = [
    /limited to(?: a)?\s+(\d[\d,]*)\s+(?:block\s+)?range/i,
    /up to a\s+(\d[\d,]*)\s+block range/i,
    /only\s+(\d[\d,]*)\s+are allowed/i,
    /exceed maximum block range:\s*(\d[\d,]*)/i,
    /must not exceed\s+(\d[\d,]*)\s+blocks/i,
    /greater than\s+(\d[\d,]*)\s+max/i,
    /exceeds limit of\s+(\d[\d,]*)/i,
    /ranges over\s+(\d[\d,]*)\s+blocks/i,
  ];
  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (!match?.[1]) continue;
    const value = parseBig(match[1]);
    if (value > 0n) return value;
  }
  return undefined;
}

export function isLogRangeError(message: string): boolean {
  return (
    logRangeLimit(message) !== undefined ||
    /block range|too many results|exceed maximum block|log query range|spans \d+ blocks/i.test(message)
  );
}

export function chunkCount(from: bigint, to: bigint, window: bigint): bigint {
  if (window < 1n) throw new Error("ventana de bloques invalida");
  if (to < from) return 0n;
  const span = to - from + 1n;
  return (span + window - 1n) / window;
}

export function exceedsLogBudget(
  from: bigint,
  to: bigint,
  window: bigint,
  maxChunks = MAX_LOG_CHUNKS,
): boolean {
  return chunkCount(from, to, window) > BigInt(maxChunks);
}

export function blockWindows(
  from: bigint,
  to: bigint,
  window: bigint,
): { fromBlock: bigint; toBlock: bigint }[] {
  if (window < 1n) throw new Error("ventana de bloques invalida");
  const windows: { fromBlock: bigint; toBlock: bigint }[] = [];
  for (let cursor = from; cursor <= to; cursor += window) {
    const end = cursor + window - 1n;
    windows.push({ fromBlock: cursor, toBlock: end > to ? to : end });
  }
  return windows;
}

function parseBig(value: string): bigint {
  return BigInt(value.replace(/,/g, ""));
}
