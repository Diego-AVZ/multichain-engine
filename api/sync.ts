import { readFile } from "node:fs/promises";
import { getAddress, isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { parseConfig } from "../src/config.js";
import { bearerAuthorized, corsHeaders, redact, secretValues } from "../src/http.js";
import { syncOne, type ChainSyncResult } from "../src/sync.js";

export const maxDuration = 300;

export const config = {
  maxDuration: 300,
};

type Payload = {
  user: string;
  syncer?: string;
  error?: string;
  chains?: { chain: string; outcome?: string; error?: string }[];
};

export default {
  async fetch(request: Request): Promise<Response> {
    const origin = request.headers.get("origin");
    if (request.method === "OPTIONS") return preflight(origin);
    if (request.method !== "POST") return json(405, { error: "Method not allowed" }, origin);
    if (!bearerAuthorized(request.headers.get("authorization"), process.env.SYNC_API_TOKEN)) {
      return json(401, { error: "Unauthorized" }, origin);
    }

    const user = await readUser(request);
    if (!user) return json(400, { error: "user must be an address" }, origin);

    const key = process.env.SYNCER_PRIVATE_KEY;
    if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
      return json(500, { user, error: "SYNCER_PRIVATE_KEY must be a 32-byte hex key" }, origin);
    }

    let account;
    try {
      account = privateKeyToAccount(key as `0x${string}`);
    } catch (error) {
      return json(500, { user, error: publicError(error) }, origin);
    }

    try {
      const appConfig = parseConfig(await readFile(new URL("../config.json", import.meta.url), "utf8"));
      if (process.env.VERCEL) appConfig.journalPath = "/tmp/multichain-engine-journal.json";
      const result = await syncOne(appConfig, user, { dryRun: false, account });
      return json(result.ok ? 200 : 500, present(user, account.address, result.ok, result.error, result.chains), origin);
    } catch (error) {
      return json(500, { user, syncer: account.address, error: publicError(error) }, origin);
    }
  },
};

function preflight(origin: string | null): Response {
  const headers = corsHeaders(origin, process.env.ALLOWED_ORIGIN);
  if (!headers.has("Access-Control-Allow-Origin")) return new Response(null, { status: 403 });
  return new Response(null, { status: 204, headers });
}

function json(status: number, body: Payload | { error: string }, origin: string | null): Response {
  const headers = corsHeaders(origin, process.env.ALLOWED_ORIGIN);
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status, headers });
}

async function readUser(request: Request): Promise<`0x${string}` | undefined> {
  try {
    const body = (await request.json()) as unknown;
    if (!body || typeof body !== "object" || Array.isArray(body) || !("user" in body)) return undefined;
    const user = (body as { user: unknown }).user;
    if (typeof user !== "string" || !isAddress(user)) return undefined;
    return getAddress(user);
  } catch {
    return undefined;
  }
}

function present(
  user: string,
  syncer: string,
  ok: boolean,
  error: string | undefined,
  chains: ChainSyncResult[],
): Payload {
  const payload: Payload = { user, syncer };
  if (!ok) payload.error = redact(error ?? "Sync failed", secretValues());
  if (chains.length > 0) {
    payload.chains = chains.map((chain) => {
      if (chain.error) return { chain: chain.chain, error: redact(chain.error, secretValues()) };
      return { chain: chain.chain, outcome: redact(chain.outcome ?? "", secretValues()) };
    });
  }
  return payload;
}

function publicError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return redact(message, secretValues()) || "Sync failed";
}
