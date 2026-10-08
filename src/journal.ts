import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { mergeSealHistory, type Hex, type VersionRecord } from "./calculate.js";

export type Journal = {
  users: Record<string, { versions: VersionRecord[] }>;
};

export function emptyJournal(): Journal {
  return { users: {} };
}

export async function loadJournal(filePath: string): Promise<Journal> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as {
      users?: Record<string, { versions?: { version: number; seals: { chainId: number; hash: string }[] }[] }>;
    };
    const journal = emptyJournal();
    for (const [user, entry] of Object.entries(parsed.users ?? {})) {
      journal.users[user.toLowerCase()] = {
        versions: (entry.versions ?? []).map((version) => ({
          version: version.version,
          seals: version.seals.map((seal) => ({
            chainId: seal.chainId,
            hash: seal.hash.toLowerCase() as Hex,
          })),
        })),
      };
    }
    return journal;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyJournal();
    throw error;
  }
}

export async function saveJournal(filePath: string, journal: Journal): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const stable: Journal = { users: {} };
  for (const user of Object.keys(journal.users).sort()) {
    stable.users[user] = {
      versions: mergeSealHistory(journal.users[user]?.versions ?? []),
    };
  }
  await writeFile(filePath, `${JSON.stringify(stable, null, 2)}\n`, "utf8");
}

export function recordsFor(journal: Journal, user: string): VersionRecord[] {
  return journal.users[user.toLowerCase()]?.versions ?? [];
}

export function putRecords(journal: Journal, user: string, versions: VersionRecord[]): void {
  journal.users[user.toLowerCase()] = { versions: mergeSealHistory(versions) };
}
