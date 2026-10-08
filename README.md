# multichain-engine

Coordina el Global Pulse de Sendra. En cada ronda lee el estado de las chains configuradas, calcula el global consolidado y lo escribe.

No hay chain central. La actividad nueva vive en el temporal de cada red. Este proceso la congela, la suma y publica el mismo global en todas.

## Version

Cada global lleva `syncVersion`. Si una escritura falla, esa chain se queda en la version anterior y no borra su sello.

La pasada siguiente no usa ese global viejo. Toma el global de la version mas alta y solo suma sellos que todavia no estan publicados. Un sello ya incluido se limpia al alcanzar al resto, sin sumarlo otra vez.

## Configuracion

Copia `config.example.json` a `config.json` y `.env.example` a `.env`.

- `SYNCER_PRIVATE_KEY` es la clave que el admin dejo como `pulseSyncer` en cada `SendraStorage`.
- Cada chain necesita su RPC y la address del storage.
- `users` son las wallets a consolidar. El storage resuelve las wallets unidas al mismo root.

## Uso

```bash
npm install
npm test
npm run sync -- --dry-run
npm run sync
npm run sync -- --user 0xabc...
```

`--dry-run` lee y calcula, y no envia transacciones.

El diario queda en `data/journal.json`. Si se pierde, el engine reconstruye los sellos ya publicados leyendo los eventos `GlobalPulseCommitted`.
