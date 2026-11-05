import { AsyncLocalStorage } from "node:async_hooks";
import {
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  defineChain,
  type Address,
  type Chain,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { arbitrum } from "viem/chains";
import { globalPulseCommittedEvent, sendraStorageAbi } from "./abi.js";
import {
  emptyAccumulators,
  mergeSealHistory,
  planRound,
  syncableIsZero,
  type Accumulators,
  type ChainPulse,
  type RoundPlan,
  type VersionRecord,
} from "./calculate.js";
import { loadJournal, putRecords, recordsFor, saveJournal, type Journal } from "./journal.js";
import {
  blockWindows,
  exceedsLogBudget,
  isLogRangeError,
  LogRangeError,
  logRangeLimit,
} from "./log-range.js";

export type ChainConfig = {
  id: number;
  name: string;
  rpcEnv: string;
  storage: Address;
  fromBlock?: string;
};

export type AppConfig = {
  journalPath: string;
  logFromBlock: string;
  users: Address[];
  chains: ChainConfig[];
};

type LoadedChain = {
  config: ChainConfig;
  chain: Chain;
  publicClient: PublicClient;
  walletClient?: WalletClient;
};

const robinhood = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
});

const knownChains = new Map<number, Chain>([
  [arbitrum.id, arbitrum],
  [robinhood.id, robinhood],
]);

export type ChainSyncResult = {
  chain: string;
  outcome?: string;
  error?: string;
};

const roundReports = new AsyncLocalStorage<Map<number, ChainSyncResult>>();

function remember(chainId: number, chain: string, text: string, failed = false): void {
  const reports = roundReports.getStore();
  if (!reports) return;
  const current = reports.get(chainId) ?? { chain };
  current.chain = chain;
  if (failed) {
    current.error = text;
    delete current.outcome;
  } else if (!current.error) {
    current.outcome = text;
  }
  reports.set(chainId, current);
}

export async function syncOne(
  config: AppConfig,
  user: Address,
  options: { dryRun: boolean; account?: PrivateKeyAccount },
): Promise<{ ok: boolean; error?: string; chains: ChainSyncResult[] }> {
  const address = getAddress(user);
  const reports = new Map<number, ChainSyncResult>();
  try {
    await roundReports.run(reports, async () => {
      const chains = config.chains.map((item) => loadChain(item, options.account));
      const journal = await loadJournal(config.journalPath);
      await syncUser(address, chains, journal, config, options.dryRun);
    });
    return { ok: true, chains: [...reports.values()] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\n${address} no se sincronizo: ${message}`);
    return { ok: false, error: message, chains: [...reports.values()] };
  }
}

export async function syncAll(config: AppConfig, options: { dryRun: boolean; account?: PrivateKeyAccount }): Promise<number> {
  const chains = config.chains.map((item) => loadChain(item, options.account));
  const journal = await loadJournal(config.journalPath);
  let failures = 0;
  for (const user of config.users) {
    try {
      await syncUser(getAddress(user), chains, journal, config, options.dryRun);
    } catch (error) {
      failures += 1;
      console.error(`\n${user} no se sincronizo: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return failures;
}

async function syncUser(
  user: Address,
  chains: LoadedChain[],
  journal: Journal,
  config: AppConfig,
  dryRun: boolean,
): Promise<void> {
  console.log(`\n${user}`);
  let pulses = await readAll(user, chains);
  if (!dryRun) {
    const sealedAny = await sealOpenTemporals(user, pulses, chains);
    if (sealedAny) pulses = await readAll(user, chains);
  } else {
    pulses = previewOpenTemporals(pulses);
  }

  for (const pulse of pulses) {
    const chainName = chains.find((item) => item.config.id === pulse.chainId)?.config.name ?? String(pulse.chainId);
    const line = `${chainName} v${pulse.syncVersion} root ${pulse.root} sello ${pulse.hasSeal ? pulse.sealHash : "no"} temporal ${pulse.temporal.totalCapitalIn}`;
    console.log(`  ${line}`);
    remember(pulse.chainId, chainName, line);
  }

  const history = mergeSealHistory([
    ...recordsFor(journal, user),
    ...(await readCommitHistory(pulses, chains, config.logFromBlock)),
  ]);
  const plan = planRound(pulses, history);
  printPlan(plan, chains);
  if (dryRun || plan.commits.length === 0) return;

  if (!plan.idle) {
    const kept = history.filter((record) => record.version <= plan.baseVersion && record.version !== plan.newVersion);
    putRecords(journal, user, [...kept, { version: plan.newVersion, seals: plan.freshSeals }]);
    await saveJournal(config.journalPath, journal);
  }

  await broadcast(user, plan, chains);
}

function loadChain(config: ChainConfig, account?: PrivateKeyAccount): LoadedChain {
  const rpc = process.env[config.rpcEnv];
  if (!rpc) throw new Error(`Falta ${config.rpcEnv} para ${config.name}`);
  const chain = knownChains.get(config.id) ?? defineChain({
    id: config.id,
    name: config.name,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
  });
  const transport = http(rpc);
  const publicClient = createPublicClient({ chain, transport });
  const walletClient = account ? createWalletClient({ account, chain, transport }) : undefined;
  return { config, chain, publicClient, walletClient };
}

async function readAll(user: Address, chains: LoadedChain[]): Promise<ChainPulse[]> {
  return Promise.all(chains.map((item) => readPulse(user, item)));
}

async function readPulse(user: Address, item: LoadedChain): Promise<ChainPulse> {
  const snap = await item.publicClient.readContract({
    address: item.config.storage,
    abi: sendraStorageAbi,
    functionName: "getPulseSnapshot",
    args: [user],
  });
  return {
    chainId: item.config.id,
    root: getAddress(snap.root),
    syncVersion: Number(snap.syncVersion),
    hasSeal: snap.hasSeal,
    sealHash: snap.sealHash,
    global: asAccumulators(snap.globalPulse),
    temporal: asAccumulators(snap.temporalPulse),
    sealed: asAccumulators(snap.sealedPulse),
  };
}

async function sealOpenTemporals(user: Address, pulses: ChainPulse[], chains: LoadedChain[]): Promise<boolean> {
  const pending = pulses.filter((pulse) => !pulse.hasSeal && !syncableIsZero(pulse.temporal));
  if (pending.length === 0) return false;
  await Promise.all(pending.map(async (pulse) => {
    const item = requiredChain(chains, pulse.chainId);
    const wallet = requiredWallet(item);
    const hash = await wallet.writeContract({
      address: item.config.storage,
      abi: sendraStorageAbi,
      functionName: "sealTemporalPulse",
      args: [user],
      account: wallet.account,
      chain: item.chain,
    });
    await item.publicClient.waitForTransactionReceipt({ hash });
    console.log(`  sello ${item.config.name} ${hash}`);
    remember(item.config.id, item.config.name, `sello ${item.config.name} ${hash}`);
  }));
  return true;
}

function previewOpenTemporals(pulses: ChainPulse[]): ChainPulse[] {
  return pulses.map((pulse) => {
    if (pulse.hasSeal || syncableIsZero(pulse.temporal)) return pulse;
    return {
      ...pulse,
      hasSeal: true,
      sealHash: "0x1111111111111111111111111111111111111111111111111111111111111111",
      sealed: pulse.temporal,
    };
  });
}

async function readCommitHistory(
  pulses: ChainPulse[],
  chains: LoadedChain[],
  fallbackFromBlock: string,
): Promise<VersionRecord[]> {
  const collected: VersionRecord[] = [];
  await Promise.all(pulses.map(async (pulse) => {
    const item = requiredChain(chains, pulse.chainId);
    const fromBlock = parseFromBlock(item.config.fromBlock ?? fallbackFromBlock);
    let logs;
    try {
      logs = await readRootLogs(item.publicClient, item.config.storage, pulse.root, fromBlock);
    } catch (error) {
      const fallback = canFallback(error) ? historyFallback(item) : undefined;
      if (!fallback) throw historyError(item.config.name, error);
      try {
        logs = await readRootLogs(fallback, item.config.storage, pulse.root, fromBlock);
      } catch (fallbackError) {
        throw historyError(item.config.name, fallbackError);
      }
    }
    for (const log of logs) {
      const chainIds = log.args.chainIds ?? [];
      const sealHashes = log.args.sealHashes ?? [];
      const seals = [];
      const size = Math.min(chainIds.length, sealHashes.length);
      for (let index = 0; index < size; index++) {
        const chainId = chainIds[index];
        const hash = sealHashes[index];
        if (chainId === undefined || hash === undefined) continue;
        seals.push({ chainId: Number(chainId), hash });
      }
      collected.push({ version: Number(log.args.version ?? 0), seals });
    }
  }));
  return collected;
}

async function broadcast(user: Address, plan: RoundPlan, chains: LoadedChain[]): Promise<void> {
  const results = await Promise.allSettled(plan.commits.map(async (commit) => {
    const item = requiredChain(chains, commit.chainId);
    const wallet = requiredWallet(item);
    const hash = await wallet.writeContract({
      address: item.config.storage,
      abi: sendraStorageAbi,
      functionName: "commitGlobalPulse",
      args: [
        user,
        BigInt(commit.expectedVersion),
        BigInt(commit.newVersion),
        commit.clearSeal,
        commit.consumedSealHash,
        commit.includedSeals.map((seal) => BigInt(seal.chainId)),
        commit.includedSeals.map((seal) => seal.hash),
        plan.next,
      ],
      account: wallet.account,
      chain: item.chain,
    });
    const receipt = await item.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`transaccion revertida ${hash}`);
    console.log(`  commit ${item.config.name} v${commit.newVersion} ${hash}`);
    remember(item.config.id, item.config.name, `commit ${item.config.name} v${commit.newVersion} ${hash}`);
  }));

  const failed = results.flatMap((result, index) => {
    if (result.status === "fulfilled") return [];
    const commit = plan.commits[index];
    const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
    console.error(`  commit chain ${commit?.chainId} fallo: ${message}`);
    if (commit) {
      const name = chains.find((item) => item.config.id === commit.chainId)?.config.name ?? String(commit.chainId);
      remember(commit.chainId, name, `commit chain ${commit.chainId} fallo: ${message}`, true);
    }
    return [message];
  });
  if (failed.length > 0) {
    throw new Error(`${failed.length} commits fallaron. La proxima pasada usa el global de la version mas alta.`);
  }
}

function printPlan(plan: RoundPlan, chains: LoadedChain[]): void {
  const name = (chainId: number) => chains.find((item) => item.config.id === chainId)?.config.name ?? String(chainId);
  if (plan.commits.length === 0) {
    console.log("  sin cambios");
    for (const item of chains) remember(item.config.id, item.config.name, "sin cambios");
    return;
  }
  console.log(
    `  ${plan.idle ? "alcance" : "nueva version"} v${plan.newVersion} capitalIn ${plan.next.totalCapitalIn} exposure ${plan.next.currentExposure} pnl ${plan.next.cumulativeRealizedPnl}`,
  );
  for (const commit of plan.commits) {
    console.log(
      `  -> ${name(commit.chainId)} ${commit.expectedVersion} a ${commit.newVersion}${commit.clearSeal ? " limpia sello" : ""}`,
    );
  }
}

function asAccumulators(value: {
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
}): Accumulators {
  const next = emptyAccumulators();
  for (const key of Object.keys(next) as (keyof Accumulators)[]) next[key] = value[key];
  return next;
}

function requiredChain(chains: LoadedChain[], chainId: number): LoadedChain {
  const found = chains.find((item) => item.config.id === chainId);
  if (!found) throw new Error(`Chain ${chainId} no configurada`);
  return found;
}

function requiredWallet(item: LoadedChain): WalletClient<ReturnType<typeof http>, Chain, PrivateKeyAccount> {
  if (!item.walletClient) throw new Error(`Falta SYNCER_PRIVATE_KEY para escribir en ${item.config.name}`);
  return item.walletClient as WalletClient<ReturnType<typeof http>, Chain, PrivateKeyAccount>;
}

function parseFromBlock(value: string): bigint | "earliest" {
  if (value === "earliest") return "earliest";
  if (!/^\d+$/.test(value)) throw new Error(`fromBlock invalido: ${value}`);
  return BigInt(value);
}

type LogReader = Pick<PublicClient, "getLogs" | "getBlockNumber">;

async function readRootLogs(
  client: LogReader,
  address: Address,
  root: Address,
  fromBlock: bigint | "earliest",
) {
  const query = {
    address,
    event: globalPulseCommittedEvent,
    args: { root },
  } as const;
  try {
    return await client.getLogs({ ...query, fromBlock, toBlock: "latest" });
  } catch (error) {
    if (!isLogRangeError(errorText(error))) throw error;
    const latest = await client.getBlockNumber();
    const start = fromBlock === "earliest" ? 0n : fromBlock;
    if (start > latest) return [];
    let window = logRangeLimit(errorText(error)) ?? 2_000n;
    let lastError = error;
    for (let attempt = 0; attempt < 8; attempt++) {
      if (exceedsLogBudget(start, latest, window)) throw new LogRangeError(window, start, latest);
      try {
        const windows = blockWindows(start, latest, window);
        const batches = await mapPool(windows, 4, (range) =>
          client.getLogs({ ...query, fromBlock: range.fromBlock, toBlock: range.toBlock }),
        );
        return batches.flat();
      } catch (chunkError) {
        lastError = chunkError;
        if (!isLogRangeError(errorText(chunkError))) throw chunkError;
        const narrower = logRangeLimit(errorText(chunkError));
        const next = narrower !== undefined && narrower < window ? narrower : window / 2n;
        if (next < 1n || next >= window) throw chunkError;
        window = next;
      }
    }
    throw lastError;
  }
}

function historyFallback(item: LoadedChain): PublicClient | undefined {
  const configured = process.env[item.config.rpcEnv]?.trim();
  const pub = item.chain.rpcUrls.default.http[0];
  if (!pub) return undefined;
  if (configured && sameUrl(configured, pub)) return undefined;
  return createPublicClient({ chain: item.chain, transport: http(pub, { timeout: 20_000 }) });
}

function canFallback(error: unknown): boolean {
  if (error instanceof LogRangeError) return true;
  const message = errorText(error);
  return isLogRangeError(message) || /rate limit|too many request|429|timeout|timed out/i.test(message);
}

function historyError(name: string, error: unknown): Error {
  return new Error(
    `No pude leer el historial de ${name}. Sin ese historial una chain atrasada podria contarse dos veces. ${errorText(error)}`,
  );
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sameUrl(left: string, right: string): boolean {
  return left.replace(/\/+$/, "") === right.replace(/\/+$/, "");
}

async function mapPool<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      const item = items[index];
      if (item === undefined) continue;
      results[index] = await fn(item);
    }
  });
  await Promise.all(workers);
  return results;
}

