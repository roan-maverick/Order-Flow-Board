# Contributing

Thanks for helping. Bug reports, data-source fixes, new features and plain-English doc fixes are all welcome.

## Run it locally

```bash
npm install
npm run dev          # board + API with instant reload, http://localhost:5199
npm test             # all tests (no internet needed: data sources are mocked)
npm run typecheck
```

`npm run dev -- --demo` (or `FLOW_DEMO=1 npm run dev`) runs on the simulated market, which is handy offline.

## Where things live

| Folder | What's in it |
|---|---|
| `src/model/` | The logic: sides, build-up, the five checks, levels, zones, sectors, universes, the AI text brief |
| `src/data/` | Crypto feeds (Binance, Bybit, Gate.io, Deribit), the demo market, coin and sector lists, the bundled S&P 500 list |
| `src/ui/` | The board (chart, tunnels, tiles, cards), detail panel, phone layout, search, colours |
| `server/` | The local server: S&P 500 engine (Yahoo bars, Cboe options), crypto engine, JSON API, MCP server |
| `scripts/` | Command-line tools (`npm run flow`, `npm run update:sp500`) |
| `examples/` | The paper-trading bot and AI prompts |

## Guidelines

- **Keep it free to run.** No feature should need a paid key to work. Paid sources are welcome as optional providers.
- **Readings, not advice.** Words on the board describe what the data shows. Avoid "buy", "sell", "signal" and promises.
- **Plain words.** The README and the board are read by traders, not only developers.
- **Tests.** Add or update tests in the same folder (`*.test.ts`) for any change to the model, a data source or the API. Data sources are tested with recorded response shapes, never live calls.
- **One change per pull request**, with a short note on what and why. Screenshots help for UI changes.

## Adding a data source

A crypto venue implements `CryptoFeed` in `src/data/crypto.ts` (`load` and `refresh`) and joins `FEEDS`. A US source replaces `fetchYahoo` / `fetchCboe` in `server/us/`. Each returns the shapes in `src/data/types.ts`, so the board and API need no changes.

## Reporting a bug

Open an issue with what you did, what you expected, what happened, your OS and Node version (`node -v`), and the server's terminal output if relevant.
