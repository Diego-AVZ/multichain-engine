import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  emptyAccumulators,
  planRound,
  selectCanonical,
  type ChainPulse,
  type VersionRecord,
} from "../src/calculate.js";

const HASH_A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const;
const HASH_B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as const;

function chain(partial: Partial<ChainPulse> & Pick<ChainPulse, "chainId" | "syncVersion">): ChainPulse {
  return {
    root: "0x0000000000000000000000000000000000000001",
    hasSeal: false,
    sealHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
    global: emptyAccumulators(),
    temporal: emptyAccumulators(),
    sealed: emptyAccumulators(),
    ...partial,
  };
}

describe("planRound", () => {
  it("suma sellos nuevos y no suma metricas de secuencia", () => {
    const arbitrum = chain({
      chainId: 42161,
      syncVersion: 4,
      hasSeal: true,
      sealHash: HASH_A,
      global: { ...emptyAccumulators(), totalCapitalIn: 100n, peakSimultaneousExposure: 7n },
      sealed: { ...emptyAccumulators(), totalCapitalIn: 20n, peakSimultaneousExposure: 99n, currentExposure: 4n },
    });
    const base = chain({
      chainId: 8453,
      syncVersion: 4,
      hasSeal: true,
      sealHash: HASH_B,
      global: { ...emptyAccumulators(), totalCapitalIn: 100n, peakSimultaneousExposure: 7n },
      sealed: { ...emptyAccumulators(), totalCapitalIn: 5n, cumulativeRealizedPnl: -3n },
    });

    const plan = planRound([arbitrum, base], []);
    assert.equal(plan.idle, false);
    assert.equal(plan.newVersion, 5);
    assert.equal(plan.next.totalCapitalIn, 125n);
    assert.equal(plan.next.currentExposure, 4n);
    assert.equal(plan.next.cumulativeRealizedPnl, -3n);
    assert.equal(plan.next.peakSimultaneousExposure, 7n);
    assert.equal(plan.commits.length, 2);
    assert.equal(plan.commits.every((commit) => commit.clearSeal), true);
  });

  it("usa el global de la version mas alta y no resuma un sello ya publicado", () => {
    const published: VersionRecord[] = [{ version: 2, seals: [{ chainId: 56, hash: HASH_B }] }];
    const arbitrum = chain({
      chainId: 42161,
      syncVersion: 2,
      global: { ...emptyAccumulators(), totalCapitalIn: 133n, firstActivityTimestamp: 50n, lastActivityTimestamp: 80n },
    });
    const bnb = chain({
      chainId: 56,
      syncVersion: 1,
      hasSeal: true,
      sealHash: HASH_B,
      global: {
        ...emptyAccumulators(),
        totalCapitalIn: 100n,
        firstActivityTimestamp: 40n,
        lastActivityTimestamp: 90n,
      },
      sealed: { ...emptyAccumulators(), totalCapitalIn: 8n },
      temporal: { ...emptyAccumulators(), totalCapitalIn: 3n },
    });

    const plan = planRound([bnb, arbitrum], published);
    assert.equal(selectCanonical([bnb, arbitrum]).version, 2);
    assert.equal(plan.next.totalCapitalIn, 133n);
    assert.equal(plan.next.firstActivityTimestamp, 40n);
    assert.equal(plan.next.lastActivityTimestamp, 90n);
    assert.equal(plan.idle, false);
    const behind = plan.commits.find((commit) => commit.chainId === 56);
    assert.equal(behind?.expectedVersion, 1);
    assert.equal(behind?.newVersion, 3);
    assert.equal(behind?.clearSeal, true);
    assert.equal(behind?.consumedSealHash, HASH_B);
  });

  it("si el sello atrasado ya esta en el global, solo alcanza la version canonica", () => {
    const published: VersionRecord[] = [{ version: 2, seals: [{ chainId: 56, hash: HASH_B }] }];
    const plan = planRound(
      [
        chain({
          chainId: 42161,
          syncVersion: 2,
          global: { ...emptyAccumulators(), totalCapitalIn: 133n },
        }),
        chain({
          chainId: 56,
          syncVersion: 1,
          hasSeal: true,
          sealHash: HASH_B,
          global: { ...emptyAccumulators(), totalCapitalIn: 100n },
          sealed: { ...emptyAccumulators(), totalCapitalIn: 8n },
        }),
      ],
      published,
    );

    assert.equal(plan.idle, true);
    assert.equal(plan.next.totalCapitalIn, 133n);
    assert.equal(plan.commits.length, 1);
    assert.equal(plan.commits[0]?.chainId, 56);
    assert.equal(plan.commits[0]?.newVersion, 2);
    assert.equal(plan.commits[0]?.clearSeal, true);
  });

  it("aborta si dos chains en la misma version no tienen el mismo global", () => {
    assert.throws(() =>
      planRound(
        [
          chain({
            chainId: 42161,
            syncVersion: 1,
            global: { ...emptyAccumulators(), totalCapitalIn: 10n },
          }),
          chain({
            chainId: 8453,
            syncVersion: 1,
            global: { ...emptyAccumulators(), totalCapitalIn: 11n },
          }),
        ],
        [],
      ),
    );
  });
});
