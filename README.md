# Moechess

Moechess teaches chess openings and assesses tactical patterns in recent Chess.com games. Its first course covers the Ruy Lopez.

## Run locally

```bash
pnpm install
pnpm dev
```

Open `http://localhost:3000`. At `/assessment`, enter a Chess.com username to import up to 50 rated rapid games from the last 12 months, then start analysis. The report suggests recurring tactical themes, shows replayable evidence, and links matched Ruy Lopez positions to the course. Games and reports stay in this browser's IndexedDB. Import uses Chess.com's public game archive; no Chess.com password is requested. You can pause, resume, refresh after the cooldown, or delete a player's local data.

Analysis runs a pinned, locally served Stockfish.js worker. See `/credits` and `public/engines/stockfish/BUILDING.txt` for license and source details.

## Checks

```bash
node scripts/vendor-stockfish.mjs --check
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm e2e --grep-invert @live
```

The live Chess.com check needs network access and is opt-in:

```bash
MOECHESS_LIVE_API=1 pnpm e2e tests/e2e/assessment-prerequisites.spec.ts --grep @live
```

The varied 50-game real-engine browser benchmark is also opt-in:

```bash
MOECHESS_PERFORMANCE=1 pnpm e2e tests/e2e/assessment.spec.ts --grep @performance
```

See [assessment validation](docs/assessment-validation.md) for fixture provenance, measured results, and the remaining performance, device, and default-build checks.
