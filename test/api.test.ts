import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import handler from "../api/sync.js";

const TOKEN = "sync-token-0123456789";
const ORIGIN = "https://app.example";
const USER = "0x0000000000000000000000000000000000000001";
const saved = {
  token: process.env.SYNC_API_TOKEN,
  origin: process.env.ALLOWED_ORIGIN,
  key: process.env.SYNCER_PRIVATE_KEY,
  vite: process.env.VITE_SYNC_API_TOKEN,
};

afterEach(() => {
  restore("SYNC_API_TOKEN", saved.token);
  restore("ALLOWED_ORIGIN", saved.origin);
  restore("SYNCER_PRIVATE_KEY", saved.key);
  restore("VITE_SYNC_API_TOKEN", saved.vite);
});

describe("POST /api/sync", () => {
  it("answers preflight only for the allowed origin", async () => {
    process.env.ALLOWED_ORIGIN = ORIGIN;
    const allowed = await handler.fetch(request("OPTIONS", { origin: ORIGIN }));
    assert.equal(allowed.status, 204);
    assert.equal(allowed.headers.get("access-control-allow-origin"), ORIGIN);
    assert.equal(allowed.headers.get("access-control-allow-headers"), "Content-Type, Authorization");
    assert.equal(allowed.headers.get("access-control-allow-methods"), "POST");

    const blocked = await handler.fetch(request("OPTIONS", { origin: "https://evil.example" }));
    assert.equal(blocked.status, 403);
    assert.equal(blocked.headers.get("access-control-allow-origin"), null);
  });

  it("rejects a missing or wrong bearer token", async () => {
    process.env.SYNC_API_TOKEN = TOKEN;
    process.env.VITE_SYNC_API_TOKEN = TOKEN;
    process.env.ALLOWED_ORIGIN = ORIGIN;
    const missing = await handler.fetch(request("POST", { origin: ORIGIN, body: { user: USER } }));
    assert.equal(missing.status, 401);
    const wrong = await handler.fetch(request("POST", {
      origin: ORIGIN,
      authorization: "Bearer not-the-token",
      body: { user: USER },
    }));
    assert.equal(wrong.status, 401);
    delete process.env.SYNC_API_TOKEN;
    const publicName = await handler.fetch(request("POST", {
      origin: ORIGIN,
      authorization: `Bearer ${TOKEN}`,
      body: { user: USER },
    }));
    assert.equal(publicName.status, 401);
    process.env.SYNC_API_TOKEN = TOKEN;
    const bodyToken = await handler.fetch(request("POST", {
      origin: ORIGIN,
      body: { user: USER, token: TOKEN },
    }));
    assert.equal(bodyToken.status, 401);
  });

  it("returns 400 when user is missing or not an address", async () => {
    process.env.SYNC_API_TOKEN = TOKEN;
    const cases = [{}, { user: "" }, { user: "diego" }, { user: 1 }, "not-json"];
    for (const body of cases) {
      const response = await handler.fetch(request("POST", { authorization: `Bearer ${TOKEN}`, body }));
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: "user must be an address" });
    }
  });

  it("does not sync without the server key", async () => {
    process.env.SYNC_API_TOKEN = TOKEN;
    delete process.env.SYNCER_PRIVATE_KEY;
    const response = await handler.fetch(request("POST", {
      authorization: `Bearer ${TOKEN}`,
      body: { user: USER, SYNCER_PRIVATE_KEY: `0x${"11".repeat(32)}` },
    }));
    assert.equal(response.status, 500);
    const payload = await response.json() as { user?: string; error?: string; syncer?: string };
    assert.equal(payload.user, USER);
    assert.equal(payload.syncer, undefined);
    assert.equal(payload.error, "SYNCER_PRIVATE_KEY must be a 32-byte hex key");
  });

  it("rejects other methods", async () => {
    const response = await handler.fetch(request("GET"));
    assert.equal(response.status, 405);
  });
});

function request(method: string, init: { origin?: string; authorization?: string; body?: unknown } = {}): Request {
  const headers = new Headers();
  if (init.origin) headers.set("origin", init.origin);
  if (init.authorization) headers.set("authorization", init.authorization);
  if (init.body === undefined) return new Request("http://localhost/api/sync", { method, headers });
  if (init.body === "not-json") {
    headers.set("content-type", "application/json");
    return new Request("http://localhost/api/sync", { method, headers, body: "{" });
  }
  headers.set("content-type", "application/json");
  return new Request("http://localhost/api/sync", { method, headers, body: JSON.stringify(init.body) });
}

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
