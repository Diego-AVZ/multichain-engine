import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  blockWindows,
  chunkCount,
  exceedsLogBudget,
  logRangeLimit,
} from "../src/log-range.js";

describe("logRangeLimit", () => {
  it("lee el tope de 50 bloques de 1rpc", () => {
    const message = [
      "Invalid parameters were provided to the RPC method.",
      'Details: eth_getLogs is limited to 0 - 50 blocks range',
    ].join("\n");
    assert.equal(logRangeLimit(message), 50n);
  });

  it("lee topes escritos de otras formas", () => {
    assert.equal(logRangeLimit("eth_getLogs is limited to a 10,000 range"), 10_000n);
    assert.equal(logRangeLimit("You can make eth_getLogs requests with up to a 10 block range."), 10n);
    assert.equal(logRangeLimit("query spans 10000006 blocks, but only 10000000 are allowed"), 10_000_000n);
    assert.equal(logRangeLimit("storage is missing"), undefined);
  });
});

describe("block windows", () => {
  it("parte el rango en ventanas inclusivas", () => {
    assert.deepEqual(blockWindows(10n, 24n, 5n), [
      { fromBlock: 10n, toBlock: 14n },
      { fromBlock: 15n, toBlock: 19n },
      { fromBlock: 20n, toBlock: 24n },
    ]);
  });

  it("un rango de 50 bloques no cubre el historial de arbitrum", () => {
    const from = 519_058_076n;
    const to = 521_477_177n;
    assert.equal(chunkCount(from, to, 50n) > 400n, true);
    assert.equal(exceedsLogBudget(from, to, 50n), true);
    assert.equal(exceedsLogBudget(from, to, 10_000n), false);
  });
});
