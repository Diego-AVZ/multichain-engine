export const ZERO_HASH =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as const;

export type Hex = `0x${string}`;

export type Accumulators = {
  totalCapitalIn: bigint;
  totalCapitalOut: bigint;
  peakSimultaneousExposure: bigint;
  currentExposure: bigint;
  cumulativeRealizedPnl: bigint;
  grossProfit: bigint;
  grossLoss: bigint;
  highWaterMark: bigint;
  maxDrawdown: bigint;
  totalPositionsOpened: bigint;
  totalPositionsClosed: bigint;
  winCount: bigint;
  lossCount: bigint;
  totalDurationSeconds: bigint;
  firstActivityTimestamp: bigint;
  lastActivityTimestamp: bigint;
  totalLiquidationEvents: bigint;
  consecutiveLosses: bigint;
  maxConsecutiveLosses: bigint;
  totalLosingCapitalIn: bigint;
};

export const SUM_KEYS = [
  "totalCapitalIn",
  "totalCapitalOut",
  "currentExposure",
  "cumulativeRealizedPnl",
  "grossProfit",
  "grossLoss",
  "totalPositionsOpened",
  "totalPositionsClosed",
  "winCount",
  "lossCount",
  "totalDurationSeconds",
  "totalLiquidationEvents",
  "totalLosingCapitalIn",
] as const satisfies readonly (keyof Accumulators)[];

export type ChainPulse = {
  chainId: number;
  root: Hex;
  syncVersion: number;
  hasSeal: boolean;
  sealHash: Hex;
  global: Accumulators;
  temporal: Accumulators;
  sealed: Accumulators;
};

export type SealRef = {
  chainId: number;
  hash: Hex;
};

export type VersionRecord = {
  version: number;
  seals: SealRef[];
};

export type CommitPlan = {
  chainId: number;
  expectedVersion: number;
  newVersion: number;
  clearSeal: boolean;
  consumedSealHash: Hex;
  includedSeals: SealRef[];
};

export type RoundPlan = {
  idle: boolean;
  baseVersion: number;
  newVersion: number;
  next: Accumulators;
  commits: CommitPlan[];
  freshSeals: SealRef[];
};

export function emptyAccumulators(): Accumulators {
  return {
    totalCapitalIn: 0n,
    totalCapitalOut: 0n,
    peakSimultaneousExposure: 0n,
    currentExposure: 0n,
    cumulativeRealizedPnl: 0n,
    grossProfit: 0n,
    grossLoss: 0n,
    highWaterMark: 0n,
    maxDrawdown: 0n,
    totalPositionsOpened: 0n,
    totalPositionsClosed: 0n,
    winCount: 0n,
    lossCount: 0n,
    totalDurationSeconds: 0n,
    firstActivityTimestamp: 0n,
    lastActivityTimestamp: 0n,
    totalLiquidationEvents: 0n,
    consecutiveLosses: 0n,
    maxConsecutiveLosses: 0n,
    totalLosingCapitalIn: 0n,
  };
}

export function sealKey(chainId: number, hash: string): string {
  return `${chainId}:${hash.toLowerCase()}`;
}

export function earliest(a: bigint, b: bigint): bigint {
  if (a === 0n) return b;
  if (b === 0n) return a;
  return a < b ? a : b;
}

export function syncableIsZero(value: Accumulators): boolean {
  return SUM_KEYS.every((key) => value[key] === 0n);
}

export function selectCanonical(chains: ChainPulse[]): { version: number; global: Accumulators } {
  if (chains.length === 0) throw new Error("No hay chains para consolidar");
  const version = Math.max(...chains.map((chain) => chain.syncVersion));
  const group = chains.filter((chain) => chain.syncVersion === version);
  const base = group[0]?.global;
  if (!base) throw new Error("No hay global canonico");
  for (const other of group.slice(1)) {
    for (const key of SUM_KEYS) {
      if (other.global[key] !== base[key]) {
        throw new Error(
          `El global de la version ${version} no coincide en ${key} entre las chains ${group[0].chainId} y ${other.chainId}`,
        );
      }
    }
  }
  return { version, global: { ...base } };
}

export function includedSealKeys(records: VersionRecord[], maxOnChain: number): Set<string> {
  const keys = new Set<string>();
  for (const record of records) {
    if (record.version > maxOnChain) continue;
    for (const seal of record.seals) {
      if (seal.hash === ZERO_HASH) continue;
      keys.add(sealKey(seal.chainId, seal.hash));
    }
  }
  return keys;
}

export function mergeSealHistory(records: VersionRecord[]): VersionRecord[] {
  const byVersion = new Map<number, Map<string, SealRef>>();
  for (const record of records) {
    const bucket = byVersion.get(record.version) ?? new Map<string, SealRef>();
    for (const seal of record.seals) {
      if (seal.hash === ZERO_HASH) continue;
      bucket.set(sealKey(seal.chainId, seal.hash), {
        chainId: seal.chainId,
        hash: seal.hash.toLowerCase() as Hex,
      });
    }
    byVersion.set(record.version, bucket);
  }
  return [...byVersion.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([version, seals]) => ({ version, seals: [...seals.values()] }));
}

/**
 * The base global is the one with the highest syncVersion.
 * A seal already recorded in a published version is not added again.
 * A seal that is still open is pending and is added once.
 */
export function planRound(chains: ChainPulse[], published: VersionRecord[]): RoundPlan {
  const canonical = selectCanonical(chains);
  const included = includedSealKeys(published, canonical.version);
  const fresh = chains.filter(
    (chain) => chain.hasSeal && !included.has(sealKey(chain.chainId, chain.sealHash)),
  );
  const stuck = chains.filter(
    (chain) =>
      chain.syncVersion === canonical.version &&
      chain.hasSeal &&
      included.has(sealKey(chain.chainId, chain.sealHash)),
  );

  const next = { ...canonical.global };
  for (const chain of fresh) {
    for (const key of SUM_KEYS) next[key] += chain.sealed[key];
  }

  let first = 0n;
  let last = 0n;
  for (const chain of chains) {
    first = earliest(first, chain.global.firstActivityTimestamp);
    if (chain.global.lastActivityTimestamp > last) last = chain.global.lastActivityTimestamp;
  }
  next.firstActivityTimestamp = first;
  next.lastActivityTimestamp = last;

  const timestampsChanged =
    first !== canonical.global.firstActivityTimestamp ||
    last !== canonical.global.lastActivityTimestamp;
  const idle = fresh.length === 0 && stuck.length === 0 && !timestampsChanged;
  const newVersion = idle ? canonical.version : canonical.version + 1;
  const freshSeals = fresh.map((chain) => ({ chainId: chain.chainId, hash: chain.sealHash }));

  const commits: CommitPlan[] = [];
  for (const chain of chains) {
    const key = sealKey(chain.chainId, chain.sealHash);
    const alreadyPublished = chain.hasSeal && included.has(key);
    const inThisRound = fresh.some((item) => item.chainId === chain.chainId);
    const clearSeal = chain.hasSeal && (alreadyPublished || inThisRound);
    const behind = chain.syncVersion < canonical.version;

    if (idle) {
      if (!behind && !clearSeal) continue;
      if (chain.syncVersion === canonical.version) continue;
      commits.push({
        chainId: chain.chainId,
        expectedVersion: chain.syncVersion,
        newVersion: canonical.version,
        clearSeal,
        consumedSealHash: clearSeal ? chain.sealHash : ZERO_HASH,
        includedSeals: [],
      });
      continue;
    }

    commits.push({
      chainId: chain.chainId,
      expectedVersion: chain.syncVersion,
      newVersion,
      clearSeal,
      consumedSealHash: clearSeal ? chain.sealHash : ZERO_HASH,
      includedSeals: freshSeals,
    });
  }

  return {
    idle,
    baseVersion: canonical.version,
    newVersion,
    next,
    commits,
    freshSeals,
  };
}
