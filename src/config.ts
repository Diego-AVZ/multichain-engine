import { readFile } from "node:fs/promises";
import { getAddress, isAddress } from "viem";
import type { AppConfig, ChainConfig } from "./sync.js";

export function parseConfig(text: string): AppConfig {
  const parsed = JSON.parse(text) as {
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

export async function readConfig(filePath: string): Promise<AppConfig> {
  return parseConfig(await readFile(filePath, "utf8"));
}
