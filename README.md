# multichain-engine

Syncs one Sendra wallet across the configured chains. A round reads that wallet, seals any open temporal pulse, and publishes one consolidated global on every chain that needs it.

There is no hub chain. New activity stays in each chain's temporal pulse until this process freezes it, adds seals that are not already published, and writes the same global everywhere.

## What a round does

1. Read `getPulseSnapshot` for the wallet on every chain in `config.json`.
2. Seal open temporals with `sealTemporalPulse` and wait for the receipts.
3. Rebuild published seals from `GlobalPulseCommitted` logs. The journal is a cache. If it is missing, those logs are enough to avoid counting a seal twice.
4. Take the global with the highest `syncVersion`. Add sealed activity that is not in that version. Chains still on an older version catch up and do not add the same seal again.
5. Send `commitGlobalPulse` on each chain that needs it and wait for the receipts.

A failed write leaves that chain on its previous version and keeps its seal. The next round starts from the highest version already on chain.

## Operator

`npm run sync` is the operator fallback.

```bash
npm install
npm test
npm run sync -- --dry-run
npm run sync
npm run sync -- --user 0xabc...
```

`--dry-run` reads and plans. It does not send transactions. `--user` syncs that one address. Without it, the command syncs the `users` list in `config.json`.

Copy `config.example.json` to `config.json` and set each chain id, `SendraStorage` address, and `logFromBlock`. Copy `.env.example` to `.env` for a local run. Keep RPC URLs and keys out of `config.json`.

The local journal is `data/journal.json`.

## Environment

The server reads these from the environment. It does not take them from the request, and it does not read `VITE_` or `NEXT_PUBLIC_` variables.

| Variable | Purpose |
| --- | --- |
| `SYNCER_PRIVATE_KEY` | 32-byte hex key of the wallet that sends the transactions. |
| `SYNC_API_TOKEN` | Bearer token for `POST /api/sync`. This is not the syncer key. |
| `ALLOWED_ORIGIN` | Exact browser origin allowed on preflight, such as `https://app.example`. |
| `RPC_ARBITRUM` | RPC URL for Arbitrum. |
| `RPC_BASE` | RPC URL for Base. |
| `RPC_BNB` | RPC URL for BNB Chain. |

The address derived from `SYNCER_PRIVATE_KEY` must already be `pulseSyncer` on every `SendraStorage`. This service does not grant that role. The wallet also needs native gas on each chain.

`SYNC_API_TOKEN` authorizes the browser call. The private key never leaves the server.

## POST /api/sync

One request syncs the address in the body. The service does not discover wallets.

```http
POST /api/sync
Authorization: Bearer <SYNC_API_TOKEN>
Content-Type: application/json

{ "user": "0x..." }
```

- `400` if `user` is missing or is not an address.
- `401` if the bearer token is missing or wrong. The check uses `crypto.timingSafeEqual`.
- `OPTIONS` answers the browser preflight. The only allowed origin is `ALLOWED_ORIGIN`. Allowed headers are `Content-Type` and `Authorization`. The allowed method is `POST`. The origin is never `*`.
- `200` returns `user`, `syncer` (the address of `SYNCER_PRIVATE_KEY`), and `chains`. Each chain has the outcome text the engine already logs.
- `500` if that wallet failed. The body includes `user`, `syncer` when the key is valid, and `error` with the engine's message. A chain that failed includes its own `error` text. The response never includes the private key, the API token, an RPC URL, or a stack trace.

The route runs the same single-wallet sync as `npm run sync -- --user`.

## Vercel

Set the project Root Directory to `multichain-engine`, not the monorepo root.

`api/sync.ts` is the Node function Vercel builds. `maxDuration` is 300 seconds, the Hobby maximum. A round seals and commits on every configured chain and waits for receipts.

Deploy `config.json` with the project. It holds the chains, storage addresses, and `logFromBlock`.

The filesystem is ephemeral. On Vercel the journal is written under `/tmp`. Published seals are still rebuilt from `GlobalPulseCommitted` logs.

Mark these environment variables sensitive:

- `SYNCER_PRIVATE_KEY`
- `SYNC_API_TOKEN`
- `ALLOWED_ORIGIN`
- `RPC_ARBITRUM`
- `RPC_BASE`
- `RPC_BNB`
