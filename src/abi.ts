export const accumulatorComponents = [
  { name: "totalCapitalIn", type: "uint256" },
  { name: "totalCapitalOut", type: "uint256" },
  { name: "peakSimultaneousExposure", type: "uint256" },
  { name: "currentExposure", type: "uint256" },
  { name: "cumulativeRealizedPnl", type: "int256" },
  { name: "grossProfit", type: "uint256" },
  { name: "grossLoss", type: "uint256" },
  { name: "highWaterMark", type: "int256" },
  { name: "maxDrawdown", type: "uint256" },
  { name: "totalPositionsOpened", type: "uint256" },
  { name: "totalPositionsClosed", type: "uint256" },
  { name: "winCount", type: "uint256" },
  { name: "lossCount", type: "uint256" },
  { name: "totalDurationSeconds", type: "uint256" },
  { name: "firstActivityTimestamp", type: "uint256" },
  { name: "lastActivityTimestamp", type: "uint256" },
  { name: "totalLiquidationEvents", type: "uint256" },
  { name: "consecutiveLosses", type: "uint256" },
  { name: "maxConsecutiveLosses", type: "uint256" },
  { name: "totalLosingCapitalIn", type: "uint256" },
] as const;

const accumulatorTuple = {
  type: "tuple",
  components: accumulatorComponents,
} as const;

export const globalPulseCommittedEvent = {
  type: "event",
  name: "GlobalPulseCommitted",
  inputs: [
    { name: "root", type: "address", indexed: true },
    { name: "version", type: "uint64", indexed: true },
    { name: "consumedSealHash", type: "bytes32", indexed: false },
    { name: "chainIds", type: "uint256[]", indexed: false },
    { name: "sealHashes", type: "bytes32[]", indexed: false },
  ],
} as const;

export const sendraStorageAbi = [
  {
    type: "function",
    name: "getPulseSnapshot",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [
      {
        name: "snap",
        type: "tuple",
        components: [
          { name: "root", type: "address" },
          { name: "syncVersion", type: "uint64" },
          { name: "hasSeal", type: "bool" },
          { name: "sealedBaseVersion", type: "uint64" },
          { name: "sealHash", type: "bytes32" },
          { name: "globalPulse", ...accumulatorTuple },
          { name: "temporalPulse", ...accumulatorTuple },
          { name: "sealedPulse", ...accumulatorTuple },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "sealTemporalPulse",
    stateMutability: "nonpayable",
    inputs: [{ name: "user", type: "address" }],
    outputs: [],
  },
  {
    type: "function",
    name: "commitGlobalPulse",
    stateMutability: "nonpayable",
    inputs: [
      { name: "user", type: "address" },
      { name: "expectedVersion", type: "uint64" },
      { name: "newVersion", type: "uint64" },
      { name: "clearSeal", type: "bool" },
      { name: "consumedSealHash", type: "bytes32" },
      { name: "chainIds", type: "uint256[]" },
      { name: "sealHashes", type: "bytes32[]" },
      { name: "next", ...accumulatorTuple },
    ],
    outputs: [],
  },
  globalPulseCommittedEvent,
] as const;
