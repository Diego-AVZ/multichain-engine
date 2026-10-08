import { readFile } from "node:fs/promises";
import { getAddress, isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { syncAll, type AppConfig, type ChainConfig } from "./sync.js";

async function main(): Promise<void> {
  await loadEnvFile(".env");
  const configPath = argument("--config") ?? "config.json";
  const dryRun = process.argv.includes("--dry-run");
  const config = await readConfig(configPath);
  const onlyUser = argument("--user");
  if (onlyUser) {
    if (!isAddress(onlyUser)) throw new Error("--user no es una address");
    config.users = [getAddress(onlyUser)];
  }
  if (config.users.length === 0) throw new Error("Configura users o pasa --user");

  let account;
  if (!dryRun) {
    const key = process.env.SYNCER_PRIVATE_KEY;
    if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
      throw new Error("SYNCER_PRIVATE_KEY tiene que ser una clave de 32 bytes");
    }
    account = privateKeyToAccount(key as `0x${string}`);
    console.log(`syncer ${account.address}`);
  }

  const failures = await syncAll(config, { dryRun, account });
  if (failures > 0) process.exitCode = 1;
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}

async function readConfig(filePath: string): Promise<AppConfig> {
  const parsed = JSON.parse(await readFile(filePath, "utf8")) as {
    journalPath?: string;
    logFromBlock?: string;
    users?: string[];
    chains?: ChainConfig[];
  };
  const chains = parsed.chains ?? [];
  if (chains.length === 0) throw new Error("Configura al menos una chain");
  for (const chain of chains) {
    if (!isAddress(chain.storage) || chain.storage === "0x0000000000000000000000000000000000000000") {
      throw new Error(`${chain.name} no tiene storage`);
    }
    chain.storage = getAddress(chain.storage);
  }
  return {
    journalPath: parsed.journalPath ?? "./data/journal.json",
    logFromBlock: parsed.logFromBlock ?? "earliest",
    users: (parsed.users ?? []).map((user) => {
      if (!isAddress(user)) throw new Error(`User invalido: ${user}`);
      return getAddress(user);
    }),
    chains,
  };
}

async function loadEnvFile(filePath: string): Promise<void> {
  try {
    const text = await readFile(filePath, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const split = trimmed.indexOf("=");
      if (split < 0) continue;
      const key = trimmed.slice(0, split).trim();
      let value = trimmed.slice(split + 1).trim();
      if (
        (value.startsWith("\"") && value.endsWith("\"")) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = value;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
