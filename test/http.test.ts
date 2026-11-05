import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bearerAuthorized, corsHeaders, redact } from "../src/http.js";

const TOKEN = "sync-token-0123456789";

describe("bearerAuthorized", () => {
  it("accepts the exact bearer token", () => {
    assert.equal(bearerAuthorized(`Bearer ${TOKEN}`, TOKEN), true);
  });

  it("rejects a missing, wrong, or empty token", () => {
    assert.equal(bearerAuthorized(null, TOKEN), false);
    assert.equal(bearerAuthorized("Bearer ", TOKEN), false);
    assert.equal(bearerAuthorized(`Bearer ${TOKEN}x`, TOKEN), false);
    assert.equal(bearerAuthorized(`Bearer ${"x".repeat(TOKEN.length)}`, TOKEN), false);
    assert.equal(bearerAuthorized(`Bearer ${TOKEN}`, undefined), false);
    assert.equal(bearerAuthorized(TOKEN, TOKEN), false);
  });
});

describe("corsHeaders", () => {
  it("allows only the configured origin", () => {
    const headers = corsHeaders("https://app.example", "https://app.example");
    assert.equal(headers.get("access-control-allow-origin"), "https://app.example");
    assert.equal(headers.get("access-control-allow-headers"), "Content-Type, Authorization");
    assert.equal(headers.get("access-control-allow-methods"), "POST");
    assert.equal(headers.get("access-control-allow-origin")?.includes("*"), false);
  });

  it("does not reflect another origin or a wildcard", () => {
    for (const headers of [
      corsHeaders("https://evil.example", "https://app.example"),
      corsHeaders("https://app.example", "*"),
      corsHeaders("*", "*"),
      corsHeaders("https://app.example", undefined),
    ]) {
      assert.equal(headers.get("access-control-allow-origin"), null);
      assert.equal([...headers.values()].includes("*"), false);
    }
  });
});

describe("redact", () => {
  it("removes secrets, RPC URLs, and stack frames", () => {
    const key = `0x${"ab".repeat(32)}`;
    const text = [
      `failed at ${key} via https://arb.example/rpc?key=secret`,
      "    at syncUser (src/sync.ts:10:5)",
      `token ${TOKEN}`,
    ].join("\n");
    const cleaned = redact(text, [key, TOKEN, "https://arb.example/rpc?key=secret"]);
    assert.equal(cleaned.includes(key), false);
    assert.equal(cleaned.includes(TOKEN), false);
    assert.equal(cleaned.includes("https://"), false);
    assert.equal(cleaned.includes("at syncUser"), false);
    assert.match(cleaned, /failed at \[redacted\] via \[redacted\]/);
  });
});
