import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { corsHeaders, redact } from "../src/http.js";

describe("corsHeaders", () => {
  it("allows any origin so the frontend can call before gas payment exists", () => {
    const headers = corsHeaders();
    assert.equal(headers.get("access-control-allow-origin"), "*");
    assert.equal(headers.get("access-control-allow-headers"), "Content-Type");
    assert.equal(headers.get("access-control-allow-methods"), "POST");
  });
});

describe("redact", () => {
  it("removes secrets, RPC URLs, and stack frames", () => {
    const key = `0x${"ab".repeat(32)}`;
    const text = [
      `failed at ${key} via https://arb.example/rpc?key=secret`,
      "    at syncUser (src/sync.ts:10:5)",
    ].join("\n");
    const cleaned = redact(text, [key, "https://arb.example/rpc?key=secret"]);
    assert.equal(cleaned.includes(key), false);
    assert.equal(cleaned.includes("https://"), false);
    assert.equal(cleaned.includes("at syncUser"), false);
    assert.match(cleaned, /failed at \[redacted\] via \[redacted\]/);
  });
});
