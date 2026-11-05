import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import handler from "../api/sync.js";

const USER = "0x0000000000000000000000000000000000000001";
const savedKey = process.env.SYNCER_PRIVATE_KEY;

afterEach(() => {
  restore("SYNCER_PRIVATE_KEY", savedKey);
});

describe("POST /api/sync", () => {
  it("answers preflight for any origin", async () => {
    const response = await handler.fetch(request("OPTIONS", { origin: "http://localhost:5173" }));
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("access-control-allow-origin"), "*");
    assert.equal(response.headers.get("access-control-allow-headers"), "Content-Type");
    assert.equal(response.headers.get("access-control-allow-methods"), "POST");
  });

  it("returns 400 when user is missing or not an address", async () => {
    const cases = [{}, { user: "" }, { user: "diego" }, { user: 1 }, "not-json"];
    for (const body of cases) {
      const response = await handler.fetch(request("POST", { body }));
      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error: "user must be an address" });
    }
  });

  it("does not sync without the server key or a key from the request", async () => {
    delete process.env.SYNCER_PRIVATE_KEY;
    const response = await handler.fetch(request("POST", {
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

function request(method: string, init: { origin?: string; body?: unknown } = {}): Request {
  const headers = new Headers();
  if (init.origin) headers.set("origin", init.origin);
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
