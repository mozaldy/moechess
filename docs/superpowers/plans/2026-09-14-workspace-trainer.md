# Workspace & Opening Trainer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Moechess workspace: a custom SVG board, a PGN-driven course tree (Ruy Lopez sample), Explore / Learn / Review modes with FSRS scheduling, browser-saved progress behind a swappable store, and a token-based theme system with two built-in themes.

**Architecture:** Chess, course, training, progress, events and theme logic live in plain TypeScript under `lib/` with no React, all unit-tested with Vitest. React components under `components/` are a thin layer. Next.js App Router server components load and validate course PGN at build time and pass plain JSON trees to client components. All visuals come from `--mc-*` CSS custom properties, and meaningful elements carry stable `mc-*` class hooks.

**Tech Stack:** Next.js 16.3.5 (App Router), React 19.2, TypeScript 5, Tailwind CSS 4, chess.js 1.4.0, ts-fsrs 5.4.2, @mliebelt/pgn-parser 1.4.19, Vitest 5 + jsdom + React Testing Library, Playwright 1.63.

**Spec:** `docs/superpowers/specs/2026-09-14-workspace-trainer-design.md`

## Global Constraints

- Package manager is pnpm (`pnpm@11.0.9`). Never use npm or yarn to add packages.
- Next.js 16 differs from older versions. Before writing a route, layout, font or metadata file, read the matching guide in `node_modules/next/dist/docs/01-app/`. Route `params` is a `Promise` and must be awaited (server) or unwrapped with `use()` (client). Use the global `PageProps<'/route'>` and `LayoutProps<'/route'>` helpers.
- Lint uses `eslint-plugin-react-hooks` 7 recommended rules, including React Compiler rules. Do not call `setState` synchronously in an effect body, do not read or write `ref.current` during render, and do not call `Date.now()`, `new Date()` or `Math.random()` during render.
- `lib/**` must not import React, Next or any DOM API, except `lib/progress/local-storage-store.ts`, `lib/settings/local-storage-store.ts` and `lib/theme/apply.ts`, which take a `Storage` or `Document` argument instead of using globals directly.
- Styles never hard-code colours, fonts, radii, border widths, shadows or animation durations. Use `var(--mc-*)` tokens (directly or through Tailwind theme utilities). Behavioural timings in code (opponent move delay, typing speed) are props or named constants, not tokens.
- Every stable hook class starts with `mc-`, and every hook used in this plan is listed in `docs/theming-hooks.md` (Task 21). Nothing else in `app/` or `components/` may start with `mc-` (keyframes and form `name`s use `moechess-`).
- No course is special-cased: never write `ruy-lopez` outside `content/courses/ruy-lopez/`, tests and fixtures.
- Card IDs are `${"w" | "b"}:${PositionKey}`, where `PositionKey` is the first four FEN fields.
- Progress schema version is `1`. Local storage key is `moechess:progress`. Backups go to `moechess:progress:backup:<ISO timestamp>`. Settings key is `moechess:settings`.
- FSRS is created with `generatorParameters({ enable_short_term: false })`. A line becoming learned grades each of its cards `Good` and then sets the first `due` to exactly 24 hours after learning.
- Review grading: correct first try → `Rating.Good`; correct after one wrong attempt → `Rating.Again`; second wrong attempt → show answer, `Rating.Again`.
- Default review session size is `20`.
- All copy is sentence case, active voice. Errors say what happened and what to do.
- `prefers-reduced-motion: reduce` disables slides, pulses, typing animation and the learned stamp animation; state changes still render.
- Commit after every task. End each commit message with:
  `Claude-Session: https://claude.ai/code/session_01BfTAeMFyUHh6d2PzGfPGns`

## File Structure

```
content/courses/ruy-lopez/course.json      course metadata
content/courses/ruy-lopez/lines.pgn        sample lines (one PGN game per line)
docs/theming-hooks.md                      public styling hook contract
public/pieces/cburnett/{w,b}{K,Q,R,B,N,P}.svg

lib/chess/position.ts        position keys, SAN application, turn, square helpers
lib/board/track.ts           board coordinates and stable piece ids for slide animations
lib/course/types.ts          CourseMeta, CourseNode, CourseTree, Line, Arrow, Highlight, Commentary
lib/course/build-tree.ts     parsed PGN games → CourseTree (+ validation errors)
lib/course/errors.ts         CourseValidationError
lib/course/load.ts           server-only fs loader for content/courses
lib/course/queries.ts        pathTo, findLine, linesThrough
lib/course/labels.ts         move number and commentary source labels
lib/training/cards.ts        card generation per side
lib/training/scheduler.ts    FSRS wrapper: grade, learn, due, markDeviation
lib/training/learn.ts        learn-mode reducer
lib/training/review.ts       review selection + review reducer
lib/progress/types.ts        ProgressSnapshot, CardState, ProgressStore
lib/progress/validate.ts     record validation + migrations
lib/progress/memory-store.ts
lib/progress/local-storage-store.ts
lib/progress/reconcile.ts    drop/reset cards after course changes
lib/settings/types.ts        Settings, SettingsStore
lib/settings/local-storage-store.ts
lib/settings/source.ts       cached, subscribable settings for useSyncExternalStore
lib/events/bus.ts            typed event bus
lib/theme/tokens.ts          token names
lib/theme/themes.ts          Summer Sky, Night Shift
lib/theme/validate.ts        theme validation
lib/theme/contrast.ts        WCAG contrast
lib/theme/skins.ts           piece set + board skin registry
lib/theme/apply.ts           theme → CSS variables on a document
lib/branch-map/layout.ts     tree → map coordinates with collapsing

components/board/Board.tsx            SVG board (render + input)
components/hooks/usePrefersReducedMotion.ts
components/dialogue/Dialogue.tsx
components/branch-map/BranchMap.tsx
components/workspace/Workspace.tsx    layout slots incl. dock
components/workspace/Providers.tsx    progress, settings, events contexts
components/workspace/StorageBanner.tsx
components/modes/ExploreView.tsx
components/modes/LearnView.tsx
components/modes/ReviewView.tsx
components/nav/TopBar.tsx
components/home/CourseList.tsx
components/settings/ThemePicker.tsx
components/settings/SettingsForm.tsx

app/layout.tsx  app/globals.css  app/page.tsx
app/course/[slug]/page.tsx
app/course/[slug]/learn/[line]/page.tsx
app/review/page.tsx  app/settings/page.tsx  app/credits/page.tsx

tests/unit/**                    Vitest (mirrors lib/ and components/)
tests/unit/theme-contract.test.ts  hook and token contract
tests/e2e/trainer.spec.ts
scripts/screenshots.mjs          visual review captures
```

---
### Task 1: Tooling and dependencies

**Files:**
- Modify: `package.json` (scripts, deps)
- Create: `vitest.config.mts`, `tests/setup.ts`, `tests/unit/smoke.test.ts`, `playwright.config.ts`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `pnpm test` (Vitest run once), `pnpm test:watch`, `pnpm typecheck`, `pnpm e2e`. Path alias `@/` works in tests.

- [ ] **Step 1: Read the Next testing guides**

Read `node_modules/next/dist/docs/01-app/02-guides/testing/vitest.md` and `playwright.md`.

- [ ] **Step 2: Install dependencies**

```bash
pnpm add chess.js@1.4.0 ts-fsrs@5.4.2 @mliebelt/pgn-parser@1.4.19
pnpm add -D vitest@5.0.0 vite@8.3.0 @vitejs/plugin-react@6.1.1 vite-tsconfig-paths@6.1.1 jsdom@30.0.1 @testing-library/react@16.3.3 @testing-library/dom@10.4.2 @testing-library/user-event@14.6.7 @testing-library/jest-dom@7.0.1 @playwright/test@1.63.0
pnpm exec playwright install chromium
```

If pnpm reports ignored build scripts, do not approve them; none of these packages need one.

- [ ] **Step 3: Add scripts to `package.json`**

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "eslint",
  "typecheck": "tsc --noEmit",
  "test": "vitest run",
  "test:watch": "vitest",
  "e2e": "playwright test"
}
```

- [ ] **Step 4: Create `vitest.config.mts`**

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/unit/**/*.test.{ts,tsx}"],
  },
});
```

- [ ] **Step 5: Create `tests/setup.ts`**

```ts
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
  localStorage.clear();
});
```

- [ ] **Step 6: Write the smoke test `tests/unit/smoke.test.ts`**

```ts
import { expect, test } from "vitest";
import { Chess } from "chess.js";

test("tooling resolves dependencies", () => {
  expect(new Chess().turn()).toBe("w");
  expect(document.body).toBeInTheDocument();
});
```

- [ ] **Step 7: Run it**

Run: `pnpm test`
Expected: `1 passed`.

- [ ] **Step 8: Create `playwright.config.ts`**

```ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  use: { baseURL: "http://localhost:3100", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm build && pnpm start --port 3100",
    url: "http://localhost:3100",
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
});
```

- [ ] **Step 9: Ignore test output**

Append to `.gitignore`:

```
/test-results/
/playwright-report/
```

- [ ] **Step 10: Verify typecheck and lint, then commit**

Run: `pnpm typecheck && pnpm lint`
Expected: no errors.

```bash
git add package.json pnpm-lock.yaml vitest.config.mts tests playwright.config.ts .gitignore
git commit -m "chore: add test tooling and chess dependencies"
```

---

### Task 2: Chess position helpers

**Files:**
- Create: `lib/chess/position.ts`
- Test: `tests/unit/lib/chess/position.test.ts`

**Interfaces:**
- Produces:
  - `type PositionKey = string`
  - `type Side = "white" | "black"`
  - `type Square = string` (e.g. `"e4"`)
  - `START_KEY: PositionKey`
  - `positionKey(fen: string): PositionKey`
  - `turnOf(key: PositionKey): Side`
  - `sideLetter(side: Side): "w" | "b"`
  - `applySan(fen: string, san: string): AppliedMove | null` where `AppliedMove = { san: string; from: Square; to: Square; fenAfter: string; keyAfter: PositionKey; captured: boolean; promotion?: string }`. `san` is chess.js's canonical SAN (with check suffix).
  - `sanEquals(fen: string, a: string, b: string): boolean` (true when both resolve to the same legal move)
  - `moveFromSquares(fen: string, from: Square, to: Square, promotion?: string): AppliedMove | null`
  - `legalTargets(fen: string, from: Square): Square[]`
  - `piecesOf(fen: string): { square: Square; code: PieceCode }[]` where `PieceCode = "wK" | "wQ" | "wR" | "wB" | "wN" | "wP" | "bK" | "bQ" | "bR" | "bB" | "bN" | "bP"`
  - `needsPromotion(fen: string, from: Square, to: Square): boolean`
  - `START_FEN: string`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "vitest";
import {
  START_FEN, START_KEY, applySan, legalTargets, moveFromSquares, needsPromotion,
  piecesOf, positionKey, sanEquals, turnOf,
} from "@/lib/chess/position";

describe("positionKey", () => {
  test("drops halfmove and fullmove counters", () => {
    expect(positionKey("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"))
      .toBe("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -");
    expect(START_KEY).toBe(positionKey(START_FEN));
  });

  test("transposed move orders give the same key", () => {
    const a = ["e4", "e5", "Nf3", "Nc6", "Bc4"].reduce((f, m) => applySan(f, m)!.fenAfter, START_FEN);
    const b = ["e4", "e5", "Bc4", "Nc6", "Nf3"].reduce((f, m) => applySan(f, m)!.fenAfter, START_FEN);
    expect(positionKey(a)).toBe(positionKey(b));
  });
});

describe("applySan", () => {
  test("returns canonical SAN and squares", () => {
    const m = applySan(START_FEN, "e4")!;
    expect(m).toMatchObject({ san: "e4", from: "e2", to: "e4", captured: false });
    expect(turnOf(m.keyAfter)).toBe("black");
  });

  test("returns null for an illegal move instead of throwing", () => {
    expect(applySan(START_FEN, "e5")).toBeNull();
    expect(applySan(START_FEN, "nonsense")).toBeNull();
  });

  test("accepts SAN without a check suffix and zero-castling", () => {
    const fen = "rnb1kbnr/pppp1ppp/8/4p3/4P3/5Q2/PPPP1PPP/RNB1KBNR w KQkq - 0 1";
    expect(applySan(fen, "Qxf7")!.san).toBe("Qxf7+");
    expect(sanEquals(fen, "Qxf7", "Qxf7+")).toBe(true);
    expect(applySan("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1", "0-0")!.san).toBe("O-O");
  });
});

describe("board helpers", () => {
  test("moveFromSquares and legalTargets", () => {
    expect(moveFromSquares(START_FEN, "g1", "f3")!.san).toBe("Nf3");
    expect(moveFromSquares(START_FEN, "g1", "g3")).toBeNull();
    expect(legalTargets(START_FEN, "b1").sort()).toEqual(["a3", "c3"]);
    expect(legalTargets(START_FEN, "e4")).toEqual([]);
  });

  test("promotion detection and application", () => {
    const fen = "4k3/1P6/8/8/8/8/8/4K3 w - - 0 1";
    expect(needsPromotion(fen, "b7", "b8")).toBe(true);
    expect(needsPromotion(START_FEN, "e2", "e4")).toBe(false);
    expect(moveFromSquares(fen, "b7", "b8", "q")!.san).toBe("b8=Q+");
  });

  test("piecesOf lists 32 pieces at the start", () => {
    const pieces = piecesOf(START_FEN);
    expect(pieces).toHaveLength(32);
    expect(pieces).toContainEqual({ square: "g1", code: "wN" });
    expect(pieces).toContainEqual({ square: "e8", code: "bK" });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test tests/unit/lib/chess/position.test.ts`
Expected: FAIL, cannot resolve `@/lib/chess/position`.

- [ ] **Step 3: Implement `lib/chess/position.ts`**

```ts
import { Chess, type Move } from "chess.js";

export type PositionKey = string;
export type Side = "white" | "black";
export type Square = string;
export type PieceCode =
  | "wK" | "wQ" | "wR" | "wB" | "wN" | "wP"
  | "bK" | "bQ" | "bR" | "bB" | "bN" | "bP";

export interface AppliedMove {
  san: string;
  from: Square;
  to: Square;
  fenAfter: string;
  keyAfter: PositionKey;
  captured: boolean;
  promotion?: string;
}

export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export function positionKey(fen: string): PositionKey {
  return fen.trim().split(/\s+/).slice(0, 4).join(" ");
}

export const START_KEY = positionKey(START_FEN);

export function turnOf(key: PositionKey): Side {
  return key.split(" ")[1] === "b" ? "black" : "white";
}

export function sideLetter(side: Side): "w" | "b" {
  return side === "white" ? "w" : "b";
}

function toApplied(move: Move): AppliedMove {
  return {
    san: move.san,
    from: move.from,
    to: move.to,
    fenAfter: move.after,
    keyAfter: positionKey(move.after),
    captured: Boolean(move.captured),
    ...(move.promotion ? { promotion: move.promotion } : {}),
  };
}

function load(fen: string): Chess | null {
  try {
    return new Chess(fen);
  } catch {
    return null;
  }
}

export function applySan(fen: string, san: string): AppliedMove | null {
  const board = load(fen);
  if (!board) return null;
  try {
    return toApplied(board.move(san.replace(/0/g, "O")));
  } catch {
    return null;
  }
}

export function sanEquals(fen: string, a: string, b: string): boolean {
  const ma = applySan(fen, a);
  const mb = applySan(fen, b);
  return ma !== null && mb !== null && ma.san === mb.san;
}

export function moveFromSquares(
  fen: string, from: Square, to: Square, promotion?: string,
): AppliedMove | null {
  const board = load(fen);
  if (!board) return null;
  try {
    return toApplied(board.move({ from, to, ...(promotion ? { promotion } : {}) }));
  } catch {
    return null;
  }
}

export function legalTargets(fen: string, from: Square): Square[] {
  const board = load(fen);
  if (!board) return [];
  try {
    const targets = board.moves({ square: from as never, verbose: true }).map((m) => m.to);
    return [...new Set(targets)];
  } catch {
    return [];
  }
}

export function needsPromotion(fen: string, from: Square, to: Square): boolean {
  const board = load(fen);
  if (!board) return false;
  try {
    return board
      .moves({ square: from as never, verbose: true })
      .some((m) => m.to === to && Boolean(m.promotion));
  } catch {
    return false;
  }
}

export function piecesOf(fen: string): { square: Square; code: PieceCode }[] {
  const board = load(fen);
  if (!board) return [];
  return board
    .board()
    .flat()
    .filter((p): p is NonNullable<typeof p> => p !== null)
    .map((p) => ({ square: p.square, code: `${p.color}${p.type.toUpperCase()}` as PieceCode }));
}
```

Note: `.replace(/0/g, "O")` only affects castling written with zeros; SAN never contains the digit `0` otherwise (ranks are 1–8).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test tests/unit/lib/chess/position.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/chess tests/unit/lib/chess
git commit -m "feat: add chess position helpers"
```

---

### Task 3: Course tree from PGN

**Files:**
- Create: `lib/course/types.ts`, `lib/course/errors.ts`, `lib/course/build-tree.ts`, `lib/course/queries.ts`
- Test: `tests/unit/lib/course/build-tree.test.ts`

**Interfaces:**
- Consumes: `START_FEN`, `START_KEY`, `applySan`, `positionKey`, `PositionKey`, `Side`, `Square` from `@/lib/chess/position`.
- Produces (`lib/course/types.ts`):

```ts
export type Brush = "G" | "R" | "Y" | "B";
export interface Arrow { from: Square; to: Square; brush: Brush }
export interface Highlight { square: Square; brush: Brush }
export interface Credit { label: string; author?: string; url?: string; license: string }
export interface Commentary { text: string; source: "wikibooks" | "generated" | "sample"; sourceRef?: string }
export interface CourseMeta {
  slug: string; name: string; eco: string[]; mainSide: Side;
  credits: Credit[]; contentLicense: string;
}
export interface CourseNode {
  id: string;             // "root", or space-joined canonical SAN path: "e4 e5 Nf3"
  fen: string;            // full FEN after this move
  position: PositionKey;
  san: string | null;     // null for root
  parentId: string | null;
  children: string[];     // first = main move
  comment?: Commentary;
  arrows?: Arrow[];
  highlights?: Highlight[];
}
export interface Line { id: string; name: string; nodeIds: string[] } // root excluded
export interface CourseTree {
  meta: CourseMeta;
  rootId: "root";
  nodes: Record<string, CourseNode>;
  lines: Line[];
}
```

- Produces (`lib/course/errors.ts`): `class CourseValidationError extends Error { readonly problems: string[] }`.
- Produces (`lib/course/build-tree.ts`):
  - `interface SourceGame { file: string; startLine: number; game: ParsedGame }`
  - `parsePgnFile(file: string, text: string): SourceGame[]` (throws `CourseValidationError` on syntax errors, message includes `file:line:column`)
  - `buildCourseTree(meta: CourseMeta, games: SourceGame[]): CourseTree` (throws `CourseValidationError` listing every problem)
- Produces (`lib/course/queries.ts`):
  - `pathTo(tree: CourseTree, nodeId: string): CourseNode[]` (root excluded, in move order)
  - `findLine(tree: CourseTree, lineId: string): Line | undefined`
  - `linesThrough(tree: CourseTree, nodeId: string): Line[]`

Transposition note: tree nodes are keyed by move path so each node has one parent. Transpositions merge at card level (Task 5), because cards are keyed by position.

PGN conventions for course files:
- One PGN game per named line. Required tags: `LineId` (kebab-case, unique in the course) and `LineName`.
- Optional tags: `CommentSource` (`wikibooks` | `generated` | `sample`, default `sample`) and `CommentRef`.
- Variations in parentheses add accepted alternatives to the tree but do not create named lines.
- A comment attaches to the move before it. `[%cal Gb5c6]` becomes an arrow; `[%csl Ge4]` becomes a highlight.
- The same move reached from two games merges into one node. If both games annotate that node differently, the build fails.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "vitest";
import { buildCourseTree, parsePgnFile } from "@/lib/course/build-tree";
import { CourseValidationError } from "@/lib/course/errors";
import { findLine, linesThrough, pathTo } from "@/lib/course/queries";
import type { CourseMeta } from "@/lib/course/types";

const meta: CourseMeta = {
  slug: "fixture", name: "Fixture", eco: ["C60"], mainSide: "white",
  credits: [], contentLicense: "CC BY-SA 4.0",
};

const PGN = `[Event "?"]
[LineId "berlin"]
[LineName "Berlin Defence"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 {The Ruy Lopez. [%cal Gb5c6] [%csl Ge5]} 3... Nf6 4. O-O *

[Event "?"]
[LineId "morphy"]
[LineName "Morphy Defence"]
[CommentSource "wikibooks"]
[CommentRef "https://en.wikibooks.org/wiki/Chess_Opening_Theory"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 {Asks the bishop. } (3... d6 {Steinitz.}) 4. Ba4 *
`;

function build(text = PGN) {
  return buildCourseTree(meta, parsePgnFile("fixture/lines.pgn", text));
}

describe("parsePgnFile", () => {
  test("records the line each game starts on", () => {
    const games = parsePgnFile("fixture/lines.pgn", PGN);
    expect(games.map((g) => g.startLine)).toEqual([1, 7]);
  });

  test("syntax errors name the file, line and column", () => {
    expect(() => parsePgnFile("fixture/bad.pgn", `[Event "?"]\n\n1. e4 {unclosed *`))
      .toThrowError(/fixture\/bad\.pgn:3:\d+/);
  });
});

describe("buildCourseTree", () => {
  test("merges shared moves into one trunk", () => {
    const tree = build();
    const bb5 = tree.nodes["e4 e5 Nf3 Nc6 Bb5"];
    expect(bb5.children).toEqual(["e4 e5 Nf3 Nc6 Bb5 Nf6", "e4 e5 Nf3 Nc6 Bb5 a6", "e4 e5 Nf3 Nc6 Bb5 d6"]);
    expect(tree.nodes.root.children).toEqual(["e4"]);
    expect(tree.nodes.e4.parentId).toBe("root");
  });

  test("attaches comments, arrows and highlights", () => {
    const tree = build();
    const bb5 = tree.nodes["e4 e5 Nf3 Nc6 Bb5"];
    expect(bb5.comment).toEqual({ text: "The Ruy Lopez.", source: "sample" });
    expect(bb5.arrows).toEqual([{ from: "b5", to: "c6", brush: "G" }]);
    expect(bb5.highlights).toEqual([{ square: "e5", brush: "G" }]);
    expect(tree.nodes["e4 e5 Nf3 Nc6 Bb5 a6"].comment).toEqual({
      text: "Asks the bishop.", source: "wikibooks",
      sourceRef: "https://en.wikibooks.org/wiki/Chess_Opening_Theory",
    });
  });

  test("variations become alternatives, not lines", () => {
    const tree = build();
    expect(tree.nodes["e4 e5 Nf3 Nc6 Bb5 d6"].comment?.text).toBe("Steinitz.");
    expect(tree.lines.map((l) => l.id)).toEqual(["berlin", "morphy"]);
    expect(findLine(tree, "berlin")!.nodeIds.at(-1)).toBe("e4 e5 Nf3 Nc6 Bb5 Nf6 O-O");
  });

  test("stores canonical SAN, FEN and position keys", () => {
    const tree = build();
    const castle = tree.nodes["e4 e5 Nf3 Nc6 Bb5 Nf6 O-O"];
    expect(castle.san).toBe("O-O");
    expect(castle.position.split(" ")[1]).toBe("b");
    expect(castle.fen.split(" ")).toHaveLength(6);
  });

  test("queries", () => {
    const tree = build();
    expect(pathTo(tree, "e4 e5 Nf3").map((n) => n.san)).toEqual(["e4", "e5", "Nf3"]);
    expect(linesThrough(tree, "e4 e5 Nf3 Nc6 Bb5").map((l) => l.id)).toEqual(["berlin", "morphy"]);
    expect(linesThrough(tree, "e4 e5 Nf3 Nc6 Bb5 a6").map((l) => l.id)).toEqual(["morphy"]);
  });

  test("illegal moves fail with file, game start line and move", () => {
    const bad = `[Event "?"]\n[LineId "x"]\n[LineName "X"]\n\n1. e4 e5 2. Ke3 *\n`;
    try {
      build(bad);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(CourseValidationError);
      expect((e as CourseValidationError).problems).toEqual([
        'fixture/lines.pgn (game starting line 1, line "x"): illegal move 2. Ke3',
      ]);
    }
  });

  test("missing or duplicate line tags fail", () => {
    const bad = `[Event "?"]\n[LineName "No id"]\n\n1. e4 *\n\n[Event "?"]\n[LineId "a"]\n[LineName "A"]\n\n1. d4 *\n\n[Event "?"]\n[LineId "a"]\n[LineName "A again"]\n\n1. c4 *\n`;
    expect(() => build(bad)).toThrowError(CourseValidationError);
    try { build(bad); } catch (e) {
      const problems = (e as CourseValidationError).problems;
      expect(problems).toContain("fixture/lines.pgn (game starting line 1): missing LineId tag");
      expect(problems).toContain('fixture/lines.pgn (game starting line 12): duplicate LineId "a"');
    }
  });

  test("conflicting annotations on a shared node fail", () => {
    const bad = `[Event "?"]\n[LineId "a"]\n[LineName "A"]\n\n1. e4 {One.} e5 *\n\n[Event "?"]\n[LineId "b"]\n[LineName "B"]\n\n1. e4 {Two.} c5 *\n`;
    expect(() => build(bad)).toThrowError(/conflicting annotation on 1\. e4/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test tests/unit/lib/course/build-tree.test.ts`
Expected: FAIL, cannot resolve `@/lib/course/build-tree`.

- [ ] **Step 3: Create `lib/course/types.ts`**

Copy the `lib/course/types.ts` block from the Interfaces section above exactly, and add this import at the top:

```ts
import type { PositionKey, Side, Square } from "@/lib/chess/position";
```

- [ ] **Step 4: Create `lib/course/errors.ts`**

```ts
export class CourseValidationError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(`Course content is invalid:\n- ${problems.join("\n- ")}`);
    this.name = "CourseValidationError";
    this.problems = problems;
  }
}
```

- [ ] **Step 5: Create `lib/course/build-tree.ts`**

```ts
import { parseGames } from "@mliebelt/pgn-parser";
import { START_FEN, applySan, positionKey } from "@/lib/chess/position";
import { CourseValidationError } from "./errors";
import type {
  Arrow, Brush, Commentary, CourseMeta, CourseNode, CourseTree, Highlight, Line,
} from "./types";

// Shape verified against @mliebelt/pgn-parser 1.4.19 runtime output. Its bundled
// types describe `variations` incorrectly, so we declare what we read.
export interface ParsedMove {
  notation: { notation: string };
  commentDiag?: { comment?: string; colorArrows?: string[]; colorFields?: string[] } | null;
  variations: ParsedMove[][];
}
export interface ParsedGame {
  tags?: Record<string, unknown>;
  moves: ParsedMove[];
}
export interface SourceGame {
  file: string;
  startLine: number;
  game: ParsedGame;
}

const COMMENT_SOURCES = ["wikibooks", "generated", "sample"] as const;
const ARROW_RE = /^([GRYB])([a-h][1-8])([a-h][1-8])$/;
const FIELD_RE = /^([GRYB])([a-h][1-8])$/;

function gameStartLines(text: string): number[] {
  const starts: number[] = [];
  let inHeader = false;
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (line === "") return;
    const isHeader = line.startsWith("[");
    if (isHeader && !inHeader) starts.push(index + 1);
    inHeader = isHeader;
  });
  return starts;
}

export function parsePgnFile(file: string, text: string): SourceGame[] {
  let games: ParsedGame[];
  try {
    games = parseGames(text, { startRule: "games" }) as unknown as ParsedGame[];
  } catch (error) {
    const loc = (error as { location?: { start?: { line: number; column: number } } }).location?.start;
    const where = loc ? `${file}:${loc.line}:${loc.column}` : file;
    throw new CourseValidationError([`${where}: PGN syntax error: ${(error as Error).message}`]);
  }
  const starts = gameStartLines(text);
  return games.map((game, i) => ({ file, startLine: starts[i] ?? 1, game }));
}

function tag(game: ParsedGame, name: string): string | undefined {
  const value = game.tags?.[name];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function moveLabel(fen: string, san: string): string {
  const [, turn, , , , full] = fen.split(" ");
  return turn === "w" ? `${full}. ${san}` : `${full}... ${san}`;
}

interface Annotation {
  comment?: Commentary;
  arrows?: Arrow[];
  highlights?: Highlight[];
}

function annotationOf(move: ParsedMove, source: Commentary["source"], sourceRef?: string): Annotation {
  const diag = move.commentDiag ?? undefined;
  const text = diag?.comment?.trim();
  const arrows = (diag?.colorArrows ?? [])
    .map((a) => ARROW_RE.exec(a))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ brush: m[1] as Brush, from: m[2], to: m[3] }))
    .map(({ from, to, brush }) => ({ from, to, brush }));
  const highlights = (diag?.colorFields ?? [])
    .map((f) => FIELD_RE.exec(f))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ square: m[2], brush: m[1] as Brush }));
  return {
    ...(text ? { comment: { text, source, ...(sourceRef ? { sourceRef } : {}) } } : {}),
    ...(arrows.length ? { arrows } : {}),
    ...(highlights.length ? { highlights } : {}),
  };
}

function isEmpty(a: Annotation): boolean {
  return !a.comment && !a.arrows && !a.highlights;
}

function sameAnnotation(node: CourseNode, a: Annotation): boolean {
  return JSON.stringify({ c: node.comment, a: node.arrows, h: node.highlights })
    === JSON.stringify({ c: a.comment, a: a.arrows, h: a.highlights });
}

export function buildCourseTree(meta: CourseMeta, games: SourceGame[]): CourseTree {
  const problems: string[] = [];
  const root: CourseNode = {
    id: "root", fen: START_FEN, position: positionKey(START_FEN),
    san: null, parentId: null, children: [],
  };
  const nodes: Record<string, CourseNode> = { root };
  const lines: Line[] = [];
  const seenLineIds = new Set<string>();

  for (const { file, startLine, game } of games) {
    const lineId = tag(game, "LineId");
    const lineName = tag(game, "LineName");
    const where = `${file} (game starting line ${startLine}${lineId ? `, line "${lineId}"` : ""})`;
    if (!lineId) problems.push(`${file} (game starting line ${startLine}): missing LineId tag`);
    if (!lineName) problems.push(`${where}: missing LineName tag`);
    if (lineId && seenLineIds.has(lineId)) {
      problems.push(`${file} (game starting line ${startLine}): duplicate LineId "${lineId}"`);
    }
    if (lineId) seenLineIds.add(lineId);

    const sourceTag = tag(game, "CommentSource") ?? "sample";
    if (!COMMENT_SOURCES.includes(sourceTag as Commentary["source"])) {
      problems.push(`${where}: unknown CommentSource "${sourceTag}"`);
    }
    const source = (COMMENT_SOURCES.includes(sourceTag as Commentary["source"]) ? sourceTag : "sample") as Commentary["source"];
    const sourceRef = tag(game, "CommentRef");

    const walk = (parent: CourseNode, moves: ParsedMove[]): string[] => {
      const path: string[] = [];
      let current = parent;
      for (const move of moves) {
        const before = current;
        const applied = applySan(before.fen, move.notation.notation);
        if (!applied) {
          problems.push(`${where}: illegal move ${moveLabel(before.fen, move.notation.notation)}`);
          return path;
        }
        const id = before.id === "root" ? applied.san : `${before.id} ${applied.san}`;
        let node = nodes[id];
        if (!node) {
          node = {
            id, fen: applied.fenAfter, position: applied.keyAfter, san: applied.san,
            parentId: before.id, children: [],
          };
          nodes[id] = node;
          before.children.push(id);
        }
        const annotation = annotationOf(move, source, sourceRef);
        if (!isEmpty(annotation)) {
          if (!node.comment && !node.arrows && !node.highlights) {
            Object.assign(node, annotation);
          } else if (!sameAnnotation(node, annotation)) {
            problems.push(`${where}: conflicting annotation on ${moveLabel(before.fen, applied.san)}`);
          }
        }
        for (const variation of move.variations) walk(before, variation);
        path.push(id);
        current = node;
      }
      return path;
    };

    const nodeIds = walk(root, game.moves);
    if (nodeIds.length === 0 && game.moves.length === 0) problems.push(`${where}: line has no moves`);
    if (lineId && lineName) lines.push({ id: lineId, name: lineName, nodeIds });
  }

  if (problems.length) throw new CourseValidationError(problems);
  return { meta, rootId: "root", nodes, lines };
}
```

Note the variation order: a variation on a move is an alternative to that move, so it is walked from `before` (the position before the move), after the main move's node has been created. That keeps the main move first in `children`.

- [ ] **Step 6: Create `lib/course/queries.ts`**

```ts
import type { CourseNode, CourseTree, Line } from "./types";

export function pathTo(tree: CourseTree, nodeId: string): CourseNode[] {
  const path: CourseNode[] = [];
  let node: CourseNode | undefined = tree.nodes[nodeId];
  while (node && node.parentId !== null) {
    path.unshift(node);
    node = tree.nodes[node.parentId];
  }
  return path;
}

export function findLine(tree: CourseTree, lineId: string): Line | undefined {
  return tree.lines.find((line) => line.id === lineId);
}

export function linesThrough(tree: CourseTree, nodeId: string): Line[] {
  return tree.lines.filter((line) => line.nodeIds.includes(nodeId));
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm test tests/unit/lib/course/build-tree.test.ts`
Expected: all tests pass. If the start-line test fails, print `parsePgnFile(...).map(g => g.startLine)` and fix `gameStartLines`, not the test.

- [ ] **Step 8: Typecheck and commit**

Run: `pnpm typecheck`
Expected: no errors.

```bash
git add lib/course tests/unit/lib/course
git commit -m "feat: build course trees from annotated PGN"
```

---

### Task 4: Ruy Lopez sample content and course loader

**Files:**
- Create: `content/courses/ruy-lopez/course.json`, `content/courses/ruy-lopez/lines.pgn`, `lib/course/load.ts`
- Test: `tests/unit/lib/course/load.test.ts`

**Interfaces:**
- Consumes: `parsePgnFile`, `buildCourseTree`, `CourseValidationError`, `CourseMeta`, `CourseTree`.
- Produces (`lib/course/load.ts`, server only, uses `node:fs`):
  - `COURSES_DIR: string` (`path.join(process.cwd(), "content/courses")`)
  - `listCourseSlugs(dir?: string): string[]` (sorted directory names containing `course.json`)
  - `loadCourse(slug: string, dir?: string): CourseTree | null` (`null` when the course folder doesn't exist; throws `CourseValidationError` for invalid content)
  - `loadAllCourses(dir?: string): CourseTree[]`

- [ ] **Step 1: Create `content/courses/ruy-lopez/course.json`**

```json
{
  "slug": "ruy-lopez",
  "name": "Ruy Lopez",
  "eco": ["C60", "C65", "C67", "C68", "C69", "C80", "C84", "C88", "C89", "C92", "C95", "C96"],
  "mainSide": "white",
  "credits": [
    {
      "label": "Opening names",
      "author": "lichess-org/chess-openings",
      "url": "https://github.com/lichess-org/chess-openings",
      "license": "CC0 1.0"
    },
    {
      "label": "Sample notes",
      "author": "Moechess",
      "license": "CC BY-SA 4.0"
    }
  ],
  "contentLicense": "CC BY-SA 4.0"
}
```

- [ ] **Step 2: Create `content/courses/ruy-lopez/lines.pgn`**

All seven lines were replayed move by move with chess.js 1.4.0 while writing this plan.

```
[Event "Moechess sample course"]
[LineId "berlin"]
[LineName "Berlin Defence"]
[Result "*"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 {The Ruy Lopez. The bishop attacks the knight that defends e5. [%cal Gb5c6,Gc6e5]} 3... Nf6 {The Berlin Defence. Black counterattacks e4 instead of chasing the bishop. [%csl Ge4]} 4. O-O Nxe4 5. d4 Nd6 6. Bxc6 dxc6 7. dxe5 Nf5 8. Qxd8+ {The queens come off. This endgame is known as the Berlin Wall.} 8... Kxd8 9. Nc3 Ke8 10. h3 h5 *

[Event "Moechess sample course"]
[LineId "exchange"]
[LineName "Exchange Variation"]
[Result "*"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 {The Morphy Defence. Black asks the bishop to decide right away.} 4. Bxc6 {The Exchange Variation. White gives up the bishop pair to damage Black's pawn structure. [%cal Gb5c6]} 4... dxc6 5. O-O f6 6. d4 exd4 7. Nxd4 c5 8. Nb3 Qxd1 9. Rxd1 Bg4 10. f3 Be6 *

[Event "Moechess sample course"]
[LineId "open"]
[LineName "Open Variation"]
[Result "*"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 {The bishop keeps the pin on the c6 knight. [%cal Ga4e8]} 4... Nf6 5. O-O Nxe4 {The Open Variation. Black takes the e4 pawn. [%csl Ge4]} 6. d4 b5 7. Bb3 d5 8. dxe5 Be6 9. Nbd2 Nc5 10. c3 d4 *

[Event "Moechess sample course"]
[LineId "marshall"]
[LineName "Marshall Attack"]
[Result "*"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 {Black develops and prepares to castle. This leads to the Closed Ruy Lopez.} 6. Re1 b5 7. Bb3 O-O 8. c3 d5 {The Marshall Attack. Black gives up a pawn for fast piece play against White's king. [%cal Gd5e4]} 9. exd5 Nxd5 10. Nxe5 Nxe5 11. Rxe5 c6 12. d4 Bd6 13. Re1 Qh4 14. g3 Qh3 *

[Event "Moechess sample course"]
[LineId "chigorin"]
[LineName "Closed, Chigorin Variation"]
[Result "*"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O 9. h3 {Stops ...Bg4, which would pin the f3 knight. [%csl Gg4]} 9... Na5 {The Chigorin Variation. The knight hits the b3 bishop and frees the c-pawn. [%cal Ga5b3]} 10. Bc2 c5 11. d4 Qc7 12. Nbd2 cxd4 13. cxd4 *

[Event "Moechess sample course"]
[LineId "breyer"]
[LineName "Closed, Breyer Variation"]
[Result "*"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O 9. h3 Nb8 {The Breyer Variation. The knight reroutes to d7 to support e5. [%cal Gb8d7]} 10. d4 Nbd7 11. Nbd2 Bb7 12. Bc2 Re8 13. Nf1 Bf8 14. Ng3 g6 *

[Event "Moechess sample course"]
[LineId "zaitsev"]
[LineName "Closed, Zaitsev Variation"]
[Result "*"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O 9. h3 Bb7 {The Zaitsev Variation. The bishop adds pressure to e4. [%cal Gb7e4]} 10. d4 Re8 11. Nbd2 Bf8 12. a4 h6 13. Bc2 exd4 14. cxd4 *
```

Note: `[%cal Gb5c6,Gc6e5]` uses the comma form. The parser splits it into two arrows; the loader test below checks this.

- [ ] **Step 3: Write the failing test `tests/unit/lib/course/load.test.ts`**

```ts
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { listCourseSlugs, loadAllCourses, loadCourse } from "@/lib/course/load";
import { CourseValidationError } from "@/lib/course/errors";

describe("real content", () => {
  test("every course in content/courses builds", () => {
    const courses = loadAllCourses();
    expect(courses.length).toBeGreaterThan(0);
    for (const course of courses) {
      expect(course.lines.length).toBeGreaterThan(0);
      for (const line of course.lines) {
        for (const id of line.nodeIds) expect(course.nodes[id]).toBeDefined();
      }
    }
  });

  test("the Ruy Lopez sample has its seven lines and shared trunk", () => {
    const tree = loadCourse("ruy-lopez")!;
    expect(tree.lines.map((l) => l.id)).toEqual([
      "berlin", "exchange", "open", "marshall", "chigorin", "breyer", "zaitsev",
    ]);
    const bb5 = tree.nodes["e4 e5 Nf3 Nc6 Bb5"];
    expect(bb5.children).toEqual(["e4 e5 Nf3 Nc6 Bb5 Nf6", "e4 e5 Nf3 Nc6 Bb5 a6"]);
    expect(bb5.arrows).toEqual([
      { from: "b5", to: "c6", brush: "G" },
      { from: "c6", to: "e5", brush: "G" },
    ]);
  });

  test("unknown slugs return null", () => {
    expect(loadCourse("does-not-exist")).toBeNull();
    expect(listCourseSlugs()).toContain("ruy-lopez");
  });
});

describe("metadata validation", () => {
  function fixture(meta: object, pgn = `[LineId "a"]\n[LineName "A"]\n\n1. e4 *\n`) {
    const dir = mkdtempSync(path.join(tmpdir(), "mc-course-"));
    mkdirSync(path.join(dir, "demo"));
    writeFileSync(path.join(dir, "demo", "course.json"), JSON.stringify(meta));
    writeFileSync(path.join(dir, "demo", "lines.pgn"), pgn);
    return dir;
  }

  test("slug must match the folder and required fields must exist", () => {
    const dir = fixture({ slug: "other", name: "", eco: "C60", mainSide: "green", credits: [], contentLicense: "CC0" });
    try {
      loadCourse("demo", dir);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(CourseValidationError);
      expect((e as CourseValidationError).problems).toEqual([
        'demo/course.json: slug "other" must match folder name "demo"',
        "demo/course.json: name is required",
        "demo/course.json: eco must be an array of strings",
        'demo/course.json: mainSide must be "white" or "black"',
      ]);
    }
  });

  test("a course folder without PGN files fails", () => {
    const dir = fixture({ slug: "demo", name: "Demo", eco: [], mainSide: "white", credits: [], contentLicense: "CC0" }, "");
    expect(() => loadCourse("demo", dir)).toThrowError(/demo: no lines found/);
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `pnpm test tests/unit/lib/course/load.test.ts`
Expected: FAIL, cannot resolve `@/lib/course/load`.

- [ ] **Step 5: Implement `lib/course/load.ts`**

```ts
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { buildCourseTree, parsePgnFile, type SourceGame } from "./build-tree";
import { CourseValidationError } from "./errors";
import type { CourseMeta, CourseTree, Credit } from "./types";

export const COURSES_DIR = path.join(process.cwd(), "content/courses");

export function listCourseSlugs(dir: string = COURSES_DIR): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(path.join(dir, entry.name, "course.json")))
    .map((entry) => entry.name)
    .sort();
}

function validateMeta(slug: string, raw: unknown): CourseMeta {
  const file = `${slug}/course.json`;
  const problems: string[] = [];
  const m = (raw ?? {}) as Record<string, unknown>;
  if (m.slug !== slug) problems.push(`${file}: slug "${String(m.slug)}" must match folder name "${slug}"`);
  if (typeof m.name !== "string" || m.name.trim() === "") problems.push(`${file}: name is required`);
  if (!Array.isArray(m.eco) || !m.eco.every((e) => typeof e === "string")) {
    problems.push(`${file}: eco must be an array of strings`);
  }
  if (m.mainSide !== "white" && m.mainSide !== "black") {
    problems.push(`${file}: mainSide must be "white" or "black"`);
  }
  const creditsOk = Array.isArray(m.credits) && m.credits.every((c: Credit) =>
    typeof c?.label === "string" && typeof c?.license === "string");
  if (!creditsOk) problems.push(`${file}: credits must be an array of { label, license }`);
  if (typeof m.contentLicense !== "string" || m.contentLicense === "") {
    problems.push(`${file}: contentLicense is required`);
  }
  if (problems.length) throw new CourseValidationError(problems);
  return m as unknown as CourseMeta;
}

export function loadCourse(slug: string, dir: string = COURSES_DIR): CourseTree | null {
  const courseDir = path.join(dir, slug);
  const metaPath = path.join(courseDir, "course.json");
  if (!existsSync(metaPath)) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(metaPath, "utf8"));
  } catch (error) {
    throw new CourseValidationError([`${slug}/course.json: invalid JSON: ${(error as Error).message}`]);
  }
  const meta = validateMeta(slug, raw);

  const games: SourceGame[] = readdirSync(courseDir)
    .filter((name) => name.endsWith(".pgn"))
    .sort()
    .flatMap((name) => parsePgnFile(`${slug}/${name}`, readFileSync(path.join(courseDir, name), "utf8")));
  if (games.length === 0) throw new CourseValidationError([`${slug}: no lines found (add a .pgn file)`]);

  return buildCourseTree(meta, games);
}

export function loadAllCourses(dir: string = COURSES_DIR): CourseTree[] {
  return listCourseSlugs(dir).map((slug) => loadCourse(slug, dir)!);
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm test tests/unit/lib/course`
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add content lib/course/load.ts tests/unit/lib/course/load.test.ts
git commit -m "feat: add Ruy Lopez sample course and course loader"
```

---

### Task 5: Card generation

**Files:**
- Create: `lib/training/cards.ts`
- Test: `tests/unit/lib/training/cards.test.ts`

**Interfaces:**
- Consumes: `turnOf`, `sideLetter`, `PositionKey`, `Side` from `@/lib/chess/position`; `CourseTree`, `Line` from `@/lib/course/types`.
- Produces:
  - `type CardId = \`${"w" | "b"}:${PositionKey}\``
  - `interface CardSpec { id: CardId; side: Side; position: PositionKey; fen: string; expected: string[]; nodeIds: string[]; courseSlugs: string[] }` (`expected[0]` is the main move; `nodeIds` are every course node with this position)
  - `cardId(side: Side, position: PositionKey): CardId`
  - `generateCards(trees: CourseTree[], side: Side): Map<CardId, CardSpec>`
  - `cardsForLine(tree: CourseTree, line: Line, side: Side): CardId[]` (in move order, no duplicates)
  - `cardForNode(tree: CourseTree, nodeId: string, side: Side): CardId | null`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "vitest";
import { buildCourseTree, parsePgnFile } from "@/lib/course/build-tree";
import type { CourseMeta, CourseTree } from "@/lib/course/types";
import { cardForNode, cardId, cardsForLine, generateCards } from "@/lib/training/cards";

function course(slug: string, pgn: string): CourseTree {
  const meta: CourseMeta = { slug, name: slug, eco: [], mainSide: "white", credits: [], contentLicense: "CC0" };
  return buildCourseTree(meta, parsePgnFile(`${slug}/lines.pgn`, pgn));
}

const ruy = course("ruy", `[LineId "berlin"]
[LineName "Berlin"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 Nf6 4. O-O *

[LineId "morphy"]
[LineName "Morphy"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 (3... d6) 4. Ba4 *
`);

describe("generateCards", () => {
  test("white cards are positions where white is to move and the course continues", () => {
    const cards = generateCards([ruy], "white");
    expect([...cards.values()].map((c) => c.expected)).toEqual([
      ["e4"], ["Nf3"], ["Bb5"], ["O-O"], ["Ba4"],
    ]);
    const first = cards.get(cardId("white", ruy.nodes.root.position))!;
    expect(first).toMatchObject({ side: "white", nodeIds: ["root"], courseSlugs: ["ruy"] });
    expect(first.id.startsWith("w:")).toBe(true);
  });

  test("black cards list every accepted reply, main move first", () => {
    const cards = generateCards([ruy], "black");
    const afterBb5 = cards.get(cardId("black", ruy.nodes["e4 e5 Nf3 Nc6 Bb5"].position))!;
    expect(afterBb5.expected).toEqual(["Nf6", "a6", "d6"]);
    expect(cards.size).toBe(3);
  });

  test("transpositions across courses share one card", () => {
    const italianA = course("a", `[LineId "a"]\n[LineName "A"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 *\n`);
    const italianB = course("b", `[LineId "b"]\n[LineName "B"]\n\n1. e4 e5 2. Bc4 Nc6 3. Nf3 Nf6 *\n`);
    const cards = generateCards([italianA, italianB], "black");
    const shared = cards.get(cardId("black", italianA.nodes["e4 e5 Nf3 Nc6 Bc4"].position))!;
    expect(shared.expected).toEqual(["Bc5", "Nf6"]);
    expect(shared.courseSlugs).toEqual(["a", "b"]);
    expect(shared.nodeIds).toEqual(["e4 e5 Nf3 Nc6 Bc4", "e4 e5 Bc4 Nc6 Nf3"]);
  });
});

describe("line helpers", () => {
  test("cardsForLine returns the learner's positions in move order", () => {
    const berlin = ruy.lines[0];
    expect(cardsForLine(ruy, berlin, "white")).toEqual([
      cardId("white", ruy.nodes.root.position),
      cardId("white", ruy.nodes["e4 e5"].position),
      cardId("white", ruy.nodes["e4 e5 Nf3 Nc6"].position),
      cardId("white", ruy.nodes["e4 e5 Nf3 Nc6 Bb5 Nf6"].position),
    ]);
    expect(cardsForLine(ruy, berlin, "black")).toHaveLength(3);
  });

  test("cardForNode is null for the opponent's turn and for leaves", () => {
    expect(cardForNode(ruy, "e4", "white")).toBeNull();
    expect(cardForNode(ruy, "e4 e5 Nf3 Nc6 Bb5 Nf6 O-O", "black")).toBeNull();
    expect(cardForNode(ruy, "e4", "black")).toBe(cardId("black", ruy.nodes.e4.position));
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test tests/unit/lib/training/cards.test.ts`
Expected: FAIL, cannot resolve `@/lib/training/cards`.

- [ ] **Step 3: Implement `lib/training/cards.ts`**

```ts
import { sideLetter, turnOf, type PositionKey, type Side } from "@/lib/chess/position";
import type { CourseTree, Line } from "@/lib/course/types";

export type CardId = `${"w" | "b"}:${PositionKey}`;

export interface CardSpec {
  id: CardId;
  side: Side;
  position: PositionKey;
  fen: string;
  expected: string[];
  nodeIds: string[];
  courseSlugs: string[];
}

export function cardId(side: Side, position: PositionKey): CardId {
  return `${sideLetter(side)}:${position}`;
}

export function generateCards(trees: CourseTree[], side: Side): Map<CardId, CardSpec> {
  const cards = new Map<CardId, CardSpec>();
  for (const tree of trees) {
    for (const node of Object.values(tree.nodes)) {
      if (node.children.length === 0 || turnOf(node.position) !== side) continue;
      const id = cardId(side, node.position);
      const sans = node.children.map((childId) => tree.nodes[childId].san as string);
      const existing = cards.get(id);
      if (!existing) {
        cards.set(id, {
          id, side, position: node.position, fen: node.fen,
          expected: [...sans], nodeIds: [node.id], courseSlugs: [tree.meta.slug],
        });
        continue;
      }
      for (const san of sans) if (!existing.expected.includes(san)) existing.expected.push(san);
      existing.nodeIds.push(node.id);
      if (!existing.courseSlugs.includes(tree.meta.slug)) existing.courseSlugs.push(tree.meta.slug);
    }
  }
  return cards;
}

export function cardForNode(tree: CourseTree, nodeId: string, side: Side): CardId | null {
  const node = tree.nodes[nodeId];
  if (!node || node.children.length === 0 || turnOf(node.position) !== side) return null;
  return cardId(side, node.position);
}

export function cardsForLine(tree: CourseTree, line: Line, side: Side): CardId[] {
  const path = [tree.rootId, ...line.nodeIds];
  const ids: CardId[] = [];
  for (let i = 0; i < path.length - 1; i += 1) {
    const node = tree.nodes[path[i]];
    if (turnOf(node.position) !== side) continue;
    const id = cardId(side, node.position);
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test tests/unit/lib/training/cards.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/training/cards.ts tests/unit/lib/training/cards.test.ts
git commit -m "feat: generate training cards per side"
```

---

### Task 6: Progress storage

**Files:**
- Create: `lib/progress/types.ts`, `lib/progress/validate.ts`, `lib/progress/memory-store.ts`, `lib/progress/local-storage-store.ts`, `lib/progress/reconcile.ts`
- Test: `tests/unit/lib/progress/validate.test.ts`, `tests/unit/lib/progress/stores.test.ts`, `tests/unit/lib/progress/reconcile.test.ts`

**Interfaces:**
- Consumes: `CardId`, `CardSpec` from `@/lib/training/cards`; `Side` from `@/lib/chess/position`.
- Produces (`lib/progress/types.ts`):

```ts
export type CardStatus = "new" | "learning" | "review";

// ts-fsrs Card with dates stored as ISO strings.
export interface StoredFsrsCard {
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  reps: number;
  lapses: number;
  learning_steps: number;
  state: number;
  last_review?: string;
}

export interface CardState {
  id: CardId;
  expected: string[];
  fsrs: StoredFsrsCard;
  status: CardStatus;
}

export interface ProgressSnapshotV1 {
  schemaVersion: 1;
  cards: Record<CardId, CardState>;
  learnedLines: Record<string, { learnedAt: string }>;
  explore: Record<string, { lastNodeId: string }>;
}
export type ProgressSnapshot = ProgressSnapshotV1;

export type StoreStatus =
  | { kind: "ok" }
  | { kind: "unavailable" }
  | { kind: "recovered"; backupKey: string }
  | { kind: "newer-schema"; version: number };

export interface ProgressStore {
  load(): Promise<ProgressSnapshot>;
  saveCards(cards: CardState[]): Promise<void>;
  markLineLearned(key: string, learnedAt: string): Promise<void>;
  setExplorePosition(slug: string, nodeId: string): Promise<void>;
  status(): StoreStatus;
}

export function learnedLineKey(slug: string, side: Side, lineId: string): string {
  return `${slug}:${side}:${lineId}`;
}
```

`markLineLearned` takes `learnedAt` so callers pass the clock time; this keeps stores deterministic in tests. It is the only signature difference from the spec's sketch.

- Produces (`lib/progress/validate.ts`):
  - `CURRENT_SCHEMA_VERSION = 1`
  - `emptySnapshot(): ProgressSnapshot`
  - `type Migration = (raw: Record<string, unknown>) => Record<string, unknown>` and `MIGRATIONS: Record<number, Migration>` (key = version migrated **from**; empty for now)
  - `type ParseResult = { kind: "ok"; snapshot: ProgressSnapshot; dropped: number } | { kind: "corrupt" } | { kind: "newer"; version: number }`
  - `parseSnapshot(text: string | null, migrations?: Record<number, Migration>, currentVersion?: number): ParseResult`
- Produces (`lib/progress/memory-store.ts`): `class MemoryProgressStore implements ProgressStore` with `constructor(initial?: ProgressSnapshot, status?: StoreStatus)`.
- Produces (`lib/progress/local-storage-store.ts`): `PROGRESS_KEY = "moechess:progress"`; `class LocalStorageProgressStore implements ProgressStore` with `constructor(storage: Storage | null, now?: () => Date)`.
- Produces (`lib/progress/reconcile.ts`): `reconcileCards(cards: Record<CardId, CardState>, specs: Map<CardId, CardSpec>): { cards: Record<CardId, CardState>; dropped: CardId[]; reset: CardId[] }`. A reset card is returned with `status: "new"` and a fresh FSRS state supplied by the caller through `resetCard: (spec: CardSpec) => CardState` (third parameter).

Final signature: `reconcileCards(cards, specs, resetCard)`.

- [ ] **Step 1: Write the failing validation test `tests/unit/lib/progress/validate.test.ts`**

```ts
import { describe, expect, test } from "vitest";
import { emptySnapshot, parseSnapshot } from "@/lib/progress/validate";

const validCard = {
  id: "w:rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -",
  expected: ["e4"],
  status: "review",
  fsrs: {
    due: "2026-01-02T12:00:00.000Z", stability: 2.3, difficulty: 5, elapsed_days: 0,
    scheduled_days: 1, reps: 1, lapses: 0, learning_steps: 0, state: 2,
    last_review: "2026-01-01T12:00:00.000Z",
  },
};

describe("parseSnapshot", () => {
  test("missing data is an empty snapshot", () => {
    expect(parseSnapshot(null)).toEqual({ kind: "ok", snapshot: emptySnapshot(), dropped: 0 });
  });

  test("valid data round-trips", () => {
    const snapshot = {
      schemaVersion: 1,
      cards: { [validCard.id]: validCard },
      learnedLines: { "ruy:white:berlin": { learnedAt: "2026-01-01T12:00:00.000Z" } },
      explore: { ruy: { lastNodeId: "e4 e5" } },
    };
    expect(parseSnapshot(JSON.stringify(snapshot))).toEqual({ kind: "ok", snapshot, dropped: 0 });
  });

  test("invalid records are dropped one by one", () => {
    const text = JSON.stringify({
      schemaVersion: 1,
      cards: {
        [validCard.id]: validCard,
        "w:bad": { ...validCard, id: "w:bad", fsrs: { ...validCard.fsrs, due: "not a date" } },
        "b:mismatch": validCard,
      },
      learnedLines: { ok: { learnedAt: "2026-01-01T00:00:00.000Z" }, bad: { learnedAt: 3 } },
      explore: { ruy: { lastNodeId: 7 } },
    });
    const result = parseSnapshot(text);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(Object.keys(result.snapshot.cards)).toEqual([validCard.id]);
    expect(Object.keys(result.snapshot.learnedLines)).toEqual(["ok"]);
    expect(result.snapshot.explore).toEqual({});
    expect(result.dropped).toBe(4);
  });

  test("unparseable or unversioned data is corrupt", () => {
    expect(parseSnapshot("{not json")).toEqual({ kind: "corrupt" });
    expect(parseSnapshot(JSON.stringify({ cards: {} }))).toEqual({ kind: "corrupt" });
    expect(parseSnapshot(JSON.stringify([1, 2]))).toEqual({ kind: "corrupt" });
  });

  test("a newer schema is reported, not parsed", () => {
    expect(parseSnapshot(JSON.stringify({ schemaVersion: 9 }))).toEqual({ kind: "newer", version: 9 });
  });

  test("migrations run from older versions in order", () => {
    const migrations = {
      0: (raw: Record<string, unknown>) => ({ ...raw, schemaVersion: 1, cards: raw.oldCards, learnedLines: {}, explore: {} }),
    };
    const text = JSON.stringify({ schemaVersion: 0, oldCards: { [validCard.id]: validCard } });
    const result = parseSnapshot(text, migrations, 1);
    expect(result.kind === "ok" && Object.keys(result.snapshot.cards)).toEqual([validCard.id]);
    expect(parseSnapshot(JSON.stringify({ schemaVersion: 0 }), {}, 1)).toEqual({ kind: "corrupt" });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test tests/unit/lib/progress/validate.test.ts`
Expected: FAIL, cannot resolve `@/lib/progress/validate`.

- [ ] **Step 3: Create `lib/progress/types.ts`**

Copy the `lib/progress/types.ts` block from the Interfaces section above exactly, and add these imports at the top:

```ts
import type { Side } from "@/lib/chess/position";
import type { CardId } from "@/lib/training/cards";
```

- [ ] **Step 4: Implement `lib/progress/validate.ts`**

```ts
import type { CardState, ProgressSnapshot } from "./types";

export const CURRENT_SCHEMA_VERSION = 1;

export type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;

// Key = the version a record is migrated FROM. Add an entry whenever
// CURRENT_SCHEMA_VERSION goes up.
export const MIGRATIONS: Record<number, Migration> = {};

export type ParseResult =
  | { kind: "ok"; snapshot: ProgressSnapshot; dropped: number }
  | { kind: "corrupt" }
  | { kind: "newer"; version: number };

export function emptySnapshot(): ProgressSnapshot {
  return { schemaVersion: 1, cards: {}, learnedLines: {}, explore: {} };
}

const FSRS_NUMBER_FIELDS = [
  "stability", "difficulty", "elapsed_days", "scheduled_days",
  "reps", "lapses", "learning_steps", "state",
] as const;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isCardState(id: string, value: unknown): value is CardState {
  if (!isObject(value) || value.id !== id || !/^[wb]:\S/.test(id)) return false;
  const { expected, status, fsrs } = value;
  if (!Array.isArray(expected) || expected.length === 0 || !expected.every((s) => typeof s === "string")) return false;
  if (status !== "new" && status !== "learning" && status !== "review") return false;
  if (!isObject(fsrs) || !isIsoDate(fsrs.due)) return false;
  if (fsrs.last_review !== undefined && !isIsoDate(fsrs.last_review)) return false;
  return FSRS_NUMBER_FIELDS.every((field) => typeof fsrs[field] === "number" && Number.isFinite(fsrs[field]));
}

export function parseSnapshot(
  text: string | null,
  migrations: Record<number, Migration> = MIGRATIONS,
  currentVersion: number = CURRENT_SCHEMA_VERSION,
): ParseResult {
  if (text === null) return { kind: "ok", snapshot: emptySnapshot(), dropped: 0 };

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { kind: "corrupt" };
  }
  if (!isObject(raw) || !Number.isInteger(raw.schemaVersion) || (raw.schemaVersion as number) < 0) {
    return { kind: "corrupt" };
  }

  let version = raw.schemaVersion as number;
  if (version > currentVersion) return { kind: "newer", version };
  let data = raw;
  while (version < currentVersion) {
    const migrate = migrations[version];
    if (!migrate) return { kind: "corrupt" };
    data = migrate(data);
    version += 1;
  }

  const snapshot = emptySnapshot();
  let dropped = 0;

  for (const [id, card] of Object.entries(isObject(data.cards) ? data.cards : {})) {
    if (isCardState(id, card)) snapshot.cards[card.id] = card;
    else dropped += 1;
  }
  for (const [key, entry] of Object.entries(isObject(data.learnedLines) ? data.learnedLines : {})) {
    if (isObject(entry) && isIsoDate(entry.learnedAt)) snapshot.learnedLines[key] = { learnedAt: entry.learnedAt };
    else dropped += 1;
  }
  for (const [slug, entry] of Object.entries(isObject(data.explore) ? data.explore : {})) {
    if (isObject(entry) && typeof entry.lastNodeId === "string") snapshot.explore[slug] = { lastNodeId: entry.lastNodeId };
    else dropped += 1;
  }

  return { kind: "ok", snapshot, dropped };
}
```

- [ ] **Step 5: Run the validation tests to verify they pass**

Run: `pnpm test tests/unit/lib/progress/validate.test.ts`
Expected: all tests pass.

- [ ] **Step 6: Write the failing store test `tests/unit/lib/progress/stores.test.ts`**

```ts
import { describe, expect, test } from "vitest";
import { LocalStorageProgressStore, PROGRESS_KEY } from "@/lib/progress/local-storage-store";
import { MemoryProgressStore } from "@/lib/progress/memory-store";
import type { CardState } from "@/lib/progress/types";

const NOW = new Date("2026-03-01T09:30:00.000Z");
const card: CardState = {
  id: "w:rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -",
  expected: ["e4"],
  status: "new",
  fsrs: {
    due: NOW.toISOString(), stability: 0, difficulty: 0, elapsed_days: 0,
    scheduled_days: 0, reps: 0, lapses: 0, learning_steps: 0, state: 0,
  },
};

function throwingStorage(options: { read: boolean; write: boolean }): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    clear: () => data.clear(),
    key: (i: number) => [...data.keys()][i] ?? null,
    removeItem: (k: string) => { data.delete(k); },
    getItem: (k: string) => {
      if (options.read) throw new DOMException("blocked", "SecurityError");
      return data.get(k) ?? null;
    },
    setItem: (k: string, v: string) => {
      if (options.write) throw new DOMException("full", "QuotaExceededError");
      data.set(k, v);
    },
  };
}

describe("MemoryProgressStore", () => {
  test("saves cards, learned lines and explore positions", async () => {
    const store = new MemoryProgressStore();
    await store.saveCards([card]);
    await store.markLineLearned("ruy:white:berlin", NOW.toISOString());
    await store.setExplorePosition("ruy", "e4 e5");
    const snapshot = await store.load();
    expect(snapshot.cards[card.id]).toEqual(card);
    expect(snapshot.learnedLines["ruy:white:berlin"]).toEqual({ learnedAt: NOW.toISOString() });
    expect(snapshot.explore.ruy).toEqual({ lastNodeId: "e4 e5" });
    expect(store.status()).toEqual({ kind: "ok" });
  });

  test("returned snapshots are copies", async () => {
    const store = new MemoryProgressStore();
    await store.saveCards([card]);
    (await store.load()).cards[card.id].expected.push("d4");
    expect((await store.load()).cards[card.id].expected).toEqual(["e4"]);
  });
});

describe("LocalStorageProgressStore", () => {
  test("persists to localStorage and reloads in a new instance", async () => {
    const first = new LocalStorageProgressStore(localStorage, () => NOW);
    await first.saveCards([card]);
    const second = new LocalStorageProgressStore(localStorage, () => NOW);
    expect((await second.load()).cards[card.id]).toEqual(card);
    expect(JSON.parse(localStorage.getItem(PROGRESS_KEY)!).schemaVersion).toBe(1);
  });

  test("corrupt data is backed up and replaced, and the store reports recovery", async () => {
    localStorage.setItem(PROGRESS_KEY, "{broken");
    const store = new LocalStorageProgressStore(localStorage, () => NOW);
    expect((await store.load()).cards).toEqual({});
    const backupKey = `${PROGRESS_KEY}:backup:${NOW.toISOString()}`;
    expect(store.status()).toEqual({ kind: "recovered", backupKey });
    expect(localStorage.getItem(backupKey)).toBe("{broken");
  });

  test("one bad record keeps the rest", async () => {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify({
      schemaVersion: 1, cards: { [card.id]: card, "w:x": { id: "w:x" } }, learnedLines: {}, explore: {},
    }));
    const store = new LocalStorageProgressStore(localStorage, () => NOW);
    expect(Object.keys((await store.load()).cards)).toEqual([card.id]);
    expect(store.status().kind).toBe("recovered");
  });

  test("a newer schema is never overwritten", async () => {
    const future = JSON.stringify({ schemaVersion: 2, cards: {} });
    localStorage.setItem(PROGRESS_KEY, future);
    const store = new LocalStorageProgressStore(localStorage, () => NOW);
    await store.saveCards([card]);
    expect(store.status()).toEqual({ kind: "newer-schema", version: 2 });
    expect(localStorage.getItem(PROGRESS_KEY)).toBe(future);
    expect((await store.load()).cards[card.id]).toEqual(card);
  });

  test("blocked storage falls back to memory", async () => {
    const store = new LocalStorageProgressStore(throwingStorage({ read: true, write: true }), () => NOW);
    await store.saveCards([card]);
    expect((await store.load()).cards[card.id]).toEqual(card);
    expect(store.status()).toEqual({ kind: "unavailable" });
  });

  test("a full storage keeps working in memory", async () => {
    const store = new LocalStorageProgressStore(throwingStorage({ read: false, write: true }), () => NOW);
    await store.saveCards([card]);
    expect((await store.load()).cards[card.id]).toEqual(card);
    expect(store.status()).toEqual({ kind: "unavailable" });
  });

  test("no storage at all falls back to memory", async () => {
    const store = new LocalStorageProgressStore(null, () => NOW);
    await store.setExplorePosition("ruy", "e4");
    expect((await store.load()).explore.ruy).toEqual({ lastNodeId: "e4" });
    expect(store.status()).toEqual({ kind: "unavailable" });
  });
});
```

- [ ] **Step 7: Run it to verify it fails**

Run: `pnpm test tests/unit/lib/progress/stores.test.ts`
Expected: FAIL, cannot resolve the store modules.

- [ ] **Step 8: Implement `lib/progress/memory-store.ts`**

```ts
import type { CardState, ProgressSnapshot, ProgressStore, StoreStatus } from "./types";
import { emptySnapshot } from "./validate";

export class MemoryProgressStore implements ProgressStore {
  private snapshot: ProgressSnapshot;
  private readonly currentStatus: StoreStatus;

  constructor(initial: ProgressSnapshot = emptySnapshot(), status: StoreStatus = { kind: "ok" }) {
    this.snapshot = structuredClone(initial);
    this.currentStatus = status;
  }

  async load(): Promise<ProgressSnapshot> {
    return structuredClone(this.snapshot);
  }

  async saveCards(cards: CardState[]): Promise<void> {
    for (const card of cards) this.snapshot.cards[card.id] = structuredClone(card);
  }

  async markLineLearned(key: string, learnedAt: string): Promise<void> {
    this.snapshot.learnedLines[key] = { learnedAt };
  }

  async setExplorePosition(slug: string, nodeId: string): Promise<void> {
    this.snapshot.explore[slug] = { lastNodeId: nodeId };
  }

  status(): StoreStatus {
    return this.currentStatus;
  }
}
```

- [ ] **Step 9: Implement `lib/progress/local-storage-store.ts`**

```ts
import { MemoryProgressStore } from "./memory-store";
import type { CardState, ProgressSnapshot, ProgressStore, StoreStatus } from "./types";
import { emptySnapshot, parseSnapshot } from "./validate";

export const PROGRESS_KEY = "moechess:progress";

export class LocalStorageProgressStore implements ProgressStore {
  private memory: MemoryProgressStore | null = null;
  private currentStatus: StoreStatus = { kind: "ok" };

  constructor(
    private readonly storage: Storage | null,
    private readonly now: () => Date = () => new Date(),
  ) {}

  status(): StoreStatus {
    return this.currentStatus;
  }

  async load(): Promise<ProgressSnapshot> {
    return this.ensureLoaded().load();
  }

  async saveCards(cards: CardState[]): Promise<void> {
    await this.ensureLoaded().saveCards(cards);
    await this.persist();
  }

  async markLineLearned(key: string, learnedAt: string): Promise<void> {
    await this.ensureLoaded().markLineLearned(key, learnedAt);
    await this.persist();
  }

  async setExplorePosition(slug: string, nodeId: string): Promise<void> {
    await this.ensureLoaded().setExplorePosition(slug, nodeId);
    await this.persist();
  }

  private ensureLoaded(): MemoryProgressStore {
    if (!this.memory) this.memory = new MemoryProgressStore(this.readInitial());
    return this.memory;
  }

  private readInitial(): ProgressSnapshot {
    if (!this.storage) {
      this.currentStatus = { kind: "unavailable" };
      return emptySnapshot();
    }
    let text: string | null;
    try {
      text = this.storage.getItem(PROGRESS_KEY);
    } catch {
      this.currentStatus = { kind: "unavailable" };
      return emptySnapshot();
    }

    const result = parseSnapshot(text);
    if (result.kind === "newer") {
      this.currentStatus = { kind: "newer-schema", version: result.version };
      return emptySnapshot();
    }
    if (result.kind === "ok" && result.dropped === 0) return result.snapshot;

    const snapshot = result.kind === "ok" ? result.snapshot : emptySnapshot();
    const backupKey = `${PROGRESS_KEY}:backup:${this.now().toISOString()}`;
    try {
      this.storage.setItem(backupKey, text ?? "");
      this.storage.setItem(PROGRESS_KEY, JSON.stringify(snapshot));
      this.currentStatus = { kind: "recovered", backupKey };
    } catch {
      this.currentStatus = { kind: "unavailable" };
    }
    return snapshot;
  }

  private async persist(): Promise<void> {
    const kind = this.currentStatus.kind;
    if (!this.storage || !this.memory || kind === "newer-schema" || kind === "unavailable") return;
    try {
      this.storage.setItem(PROGRESS_KEY, JSON.stringify(await this.memory.load()));
    } catch {
      this.currentStatus = { kind: "unavailable" };
    }
  }
}
```

- [ ] **Step 10: Run the store tests to verify they pass**

Run: `pnpm test tests/unit/lib/progress/stores.test.ts`
Expected: all tests pass.

- [ ] **Step 11: Write the failing reconcile test `tests/unit/lib/progress/reconcile.test.ts`**

```ts
import { expect, test } from "vitest";
import { reconcileCards } from "@/lib/progress/reconcile";
import type { CardState } from "@/lib/progress/types";
import type { CardId, CardSpec } from "@/lib/training/cards";

const fsrs = {
  due: "2026-01-02T00:00:00.000Z", stability: 2, difficulty: 5, elapsed_days: 0,
  scheduled_days: 1, reps: 1, lapses: 0, learning_steps: 0, state: 2,
};
const state = (id: CardId, expected: string[]): CardState => ({ id, expected, fsrs, status: "review" });
const spec = (id: CardId, expected: string[]): CardSpec => ({
  id, side: "white", position: id.slice(2), fen: "", expected, nodeIds: [], courseSlugs: [],
});

test("drops removed positions, resets changed moves, keeps the rest", () => {
  const cards = {
    "w:kept": state("w:kept", ["e4"]),
    "w:gone": state("w:gone", ["d4"]),
    "w:changed": state("w:changed", ["Nf3"]),
  };
  const specs = new Map<CardId, CardSpec>([
    ["w:kept", spec("w:kept", ["e4"])],
    ["w:changed", spec("w:changed", ["Bb5", "Nf3"])],
    ["w:unseen", spec("w:unseen", ["c4"])],
  ]);
  const reset = (s: CardSpec): CardState => ({ ...state(s.id, s.expected), status: "new" });

  const result = reconcileCards(cards, specs, reset);

  expect(result.dropped).toEqual(["w:gone"]);
  expect(result.reset).toEqual(["w:changed"]);
  expect(Object.keys(result.cards)).toEqual(["w:kept", "w:changed"]);
  expect(result.cards["w:changed"]).toMatchObject({ status: "new", expected: ["Bb5", "Nf3"] });
  expect(result.cards["w:kept"]).toBe(cards["w:kept"]);
});
```

- [ ] **Step 12: Implement `lib/progress/reconcile.ts`**

```ts
import type { CardId, CardSpec } from "@/lib/training/cards";
import type { CardState } from "./types";

export function reconcileCards(
  cards: Record<CardId, CardState>,
  specs: Map<CardId, CardSpec>,
  resetCard: (spec: CardSpec) => CardState,
): { cards: Record<CardId, CardState>; dropped: CardId[]; reset: CardId[] } {
  const next: Record<CardId, CardState> = {};
  const dropped: CardId[] = [];
  const reset: CardId[] = [];

  for (const card of Object.values(cards)) {
    const spec = specs.get(card.id);
    if (!spec) {
      dropped.push(card.id);
    } else if (JSON.stringify(spec.expected) !== JSON.stringify(card.expected)) {
      next[card.id] = resetCard(spec);
      reset.push(card.id);
    } else {
      next[card.id] = card;
    }
  }
  return { cards: next, dropped, reset };
}
```

- [ ] **Step 13: Run all progress tests, typecheck, commit**

Run: `pnpm test tests/unit/lib/progress && pnpm typecheck`
Expected: all tests pass, no type errors.

```bash
git add lib/progress tests/unit/lib/progress
git commit -m "feat: add progress stores with validation and recovery"
```

---

### Task 7: FSRS scheduler

**Files:**
- Create: `lib/training/scheduler.ts`
- Test: `tests/unit/lib/training/scheduler.test.ts`

**Interfaces:**
- Consumes: `CardSpec`, `CardId` from `@/lib/training/cards`; `CardState`, `CardStatus`, `StoredFsrsCard` from `@/lib/progress/types`; `sideLetter`, `Side` from `@/lib/chess/position`.
- Produces:
  - `type ReviewRating = "again" | "good"`
  - `DAY_MS: number`
  - `statusOf(state: number): CardStatus`
  - `newCardState(spec: CardSpec, now: Date): CardState`
  - `gradeCard(card: CardState, rating: ReviewRating, now: Date): CardState`
  - `learnCards(cards: CardState[], now: Date): CardState[]` (new cards → graded Good, first `due` = `now + DAY_MS`; non-new cards returned unchanged, same object)
  - `isDue(card: CardState, now: Date): boolean` (never true for `status: "new"`)
  - `dueCards(cards: Record<CardId, CardState>, side: Side, now: Date): CardState[]` (sorted by due date, then id)
  - `markDeviation(card: CardState, now: Date): CardState` (learned card → due now; new card returned unchanged)

FSRS facts this task relies on (checked against ts-fsrs 5.4.2 with `enable_short_term: false`): a new card graded Good is scheduled 3 days out, and Again on a card in review is scheduled about 1 day out. Stored cards keep dates as ISO strings; `ts-fsrs` accepts the converted `Date` objects.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "vitest";
import { parseSnapshot } from "@/lib/progress/validate";
import type { CardSpec } from "@/lib/training/cards";
import {
  DAY_MS, dueCards, gradeCard, isDue, learnCards, markDeviation, newCardState,
} from "@/lib/training/scheduler";

const T0 = new Date("2026-03-01T09:00:00.000Z");
const at = (days: number) => new Date(T0.getTime() + days * DAY_MS);

const spec = (id: CardSpec["id"], expected = ["e4"]): CardSpec => ({
  id, side: id.startsWith("w") ? "white" : "black", position: id.slice(2),
  fen: "", expected, nodeIds: [], courseSlugs: ["ruy"],
});

describe("scheduler", () => {
  test("new cards are never due", () => {
    const card = newCardState(spec("w:a"), T0);
    expect(card.status).toBe("new");
    expect(isDue(card, at(30))).toBe(false);
  });

  test("learning a line schedules the first review exactly one day later", () => {
    const [learned] = learnCards([newCardState(spec("w:a"), T0)], T0);
    expect(learned.status).toBe("review");
    expect(learned.fsrs.due).toBe(at(1).toISOString());
    expect(isDue(learned, at(0.99))).toBe(false);
    expect(isDue(learned, at(1))).toBe(true);
  });

  test("learning leaves cards that are already in review untouched", () => {
    const [existing] = learnCards([newCardState(spec("w:a"), T0)], T0);
    expect(learnCards([existing], at(5))[0]).toBe(existing);
  });

  test("good pushes the next review further out than again", () => {
    const [learned] = learnCards([newCardState(spec("w:a"), T0)], T0);
    const good = gradeCard(learned, "good", at(1));
    const again = gradeCard(learned, "again", at(1));
    const gap = (c: typeof learned) => Date.parse(c.fsrs.due) - at(1).getTime();
    expect(gap(good)).toBeGreaterThanOrEqual(2 * DAY_MS);
    expect(gap(again)).toBeGreaterThan(0);
    expect(gap(again)).toBeLessThanOrEqual(DAY_MS);
    expect(again.fsrs.lapses).toBe(1);
  });

  test("graded cards pass progress validation after a JSON round trip", () => {
    const [learned] = learnCards([newCardState(spec("w:a"), T0)], T0);
    const graded = gradeCard(JSON.parse(JSON.stringify(learned)), "good", at(1));
    const text = JSON.stringify({ schemaVersion: 1, cards: { [graded.id]: graded }, learnedLines: {}, explore: {} });
    const result = parseSnapshot(text);
    expect(result.kind === "ok" && result.dropped).toBe(0);
  });

  test("dueCards filters by side and sorts by due date", () => {
    const [w1, w2, b1] = learnCards(
      [newCardState(spec("w:a"), T0), newCardState(spec("w:b"), T0), newCardState(spec("b:c"), T0)], T0,
    );
    const later = { ...w1, fsrs: { ...w1.fsrs, due: at(1.5).toISOString() } };
    const cards = { [later.id]: later, [w2.id]: w2, [b1.id]: b1 };
    expect(dueCards(cards, "white", at(2)).map((c) => c.id)).toEqual(["w:b", "w:a"]);
    expect(dueCards(cards, "white", at(1.2)).map((c) => c.id)).toEqual(["w:b"]);
    expect(dueCards(cards, "black", at(2)).map((c) => c.id)).toEqual(["b:c"]);
  });

  test("markDeviation makes a learned card due now and ignores new cards", () => {
    const fresh = newCardState(spec("w:a"), T0);
    expect(markDeviation(fresh, at(3))).toBe(fresh);
    const [learned] = learnCards([fresh], T0);
    const good = gradeCard(learned, "good", at(1));
    const flagged = markDeviation(good, at(2));
    expect(isDue(flagged, at(2))).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test tests/unit/lib/training/scheduler.test.ts`
Expected: FAIL, cannot resolve `@/lib/training/scheduler`.

- [ ] **Step 3: Implement `lib/training/scheduler.ts`**

```ts
import { Rating, State, createEmptyCard, fsrs, generatorParameters, type Card } from "ts-fsrs";
import { sideLetter, type Side } from "@/lib/chess/position";
import type { CardState, CardStatus, StoredFsrsCard } from "@/lib/progress/types";
import type { CardId, CardSpec } from "./cards";

export type ReviewRating = "again" | "good";

export const DAY_MS = 24 * 60 * 60 * 1000;

const engine = fsrs(generatorParameters({ enable_short_term: false }));

function toStored(card: Card): StoredFsrsCard {
  return {
    due: card.due.toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    reps: card.reps,
    lapses: card.lapses,
    learning_steps: card.learning_steps,
    state: card.state,
    ...(card.last_review ? { last_review: card.last_review.toISOString() } : {}),
  };
}

function fromStored(stored: StoredFsrsCard): Card {
  return {
    ...stored,
    due: new Date(stored.due),
    last_review: stored.last_review ? new Date(stored.last_review) : undefined,
    state: stored.state as State,
  };
}

export function statusOf(state: number): CardStatus {
  if (state === State.New) return "new";
  if (state === State.Review) return "review";
  return "learning";
}

export function newCardState(spec: CardSpec, now: Date): CardState {
  return {
    id: spec.id,
    expected: [...spec.expected],
    fsrs: toStored(createEmptyCard(now)),
    status: "new",
  };
}

export function gradeCard(card: CardState, rating: ReviewRating, now: Date): CardState {
  const grade = rating === "good" ? Rating.Good : Rating.Again;
  const next = engine.next(fromStored(card.fsrs), now, grade).card;
  return { ...card, fsrs: toStored(next), status: statusOf(next.state) };
}

// A newly learned line: every card still "new" gets a Good grade, and its
// first review is pinned to exactly one day later. Cards already in review
// (for example a shared trunk learned through another line) are left alone.
export function learnCards(cards: CardState[], now: Date): CardState[] {
  return cards.map((card) => {
    if (card.status !== "new") return card;
    const graded = gradeCard(card, "good", now);
    return { ...graded, fsrs: { ...graded.fsrs, due: new Date(now.getTime() + DAY_MS).toISOString() } };
  });
}

export function isDue(card: CardState, now: Date): boolean {
  return card.status !== "new" && Date.parse(card.fsrs.due) <= now.getTime();
}

export function dueCards(cards: Record<CardId, CardState>, side: Side, now: Date): CardState[] {
  const prefix = `${sideLetter(side)}:`;
  return Object.values(cards)
    .filter((card) => card.id.startsWith(prefix) && isDue(card, now))
    .sort((a, b) => Date.parse(a.fsrs.due) - Date.parse(b.fsrs.due) || a.id.localeCompare(b.id));
}

// Hook for Chess.com analysis: a learned card the player got wrong in a real game
// becomes due now. Cards never learned stay new.
export function markDeviation(card: CardState, now: Date): CardState {
  if (card.status === "new") return card;
  return { ...card, fsrs: { ...card.fsrs, due: now.toISOString() } };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test tests/unit/lib/training/scheduler.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/training/scheduler.ts tests/unit/lib/training/scheduler.test.ts
git commit -m "feat: add FSRS scheduling for training cards"
```

---

### Task 8: Learn mode state machine

**Files:**
- Create: `lib/training/learn.ts`
- Test: `tests/unit/lib/training/learn.test.ts`

**Interfaces:**
- Consumes: `applySan`, `sanEquals`, `turnOf`, `Side` from `@/lib/chess/position`; `CourseNode`, `CourseTree`, `Line` from `@/lib/course/types`.
- Produces:
  - `type LearnPhase = "guided" | "recall" | "completed"`
  - `type LearnFeedback = { kind: "correct"; san } | { kind: "alternative"; played; expected } | { kind: "mistake"; played; expected; nodeId } | { kind: "restarted" }`
  - `interface LearnState { lineId; side; phase; path: string[]; index: number; feedback: LearnFeedback | null }`
  - `type LearnAction = { type: "play"; san: string } | { type: "opponentMoved" } | { type: "restart" }`
  - `type LearnTurn = "learner" | "opponent" | "done"`
  - `initLearn(tree, line, side): LearnState`
  - `currentNode(tree, state): CourseNode`
  - `expectedMove(tree, state): string | null`
  - `learnTurn(tree, state): LearnTurn`
  - `learnReducer(tree, state, action): LearnState` (returns the same object when an action is ignored)

Behaviour (from spec §6):
- **Guided pass:** the learner plays each of their moves with a hint; the UI dispatches `opponentMoved` for the opponent's moves. A wrong move gives `mistake` feedback and the learner must play the right move; the pass continues.
- **End of guided pass:** the recall pass starts from index 0.
- **Recall pass:** a wrong move gives `mistake` feedback; playing the correct move then restarts the pass from index 0 with `restarted` feedback.
- **Completion:** reaching the end of a recall pass sets `phase: "completed"`. The UI then calls `learnCards`, marks the line learned and emits `lineLearned`.
- **Accepted alternatives:** another move the course accepts in that position gives `alternative` feedback. It is not a mistake, and the learner still plays the line's move.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "vitest";
import { buildCourseTree, parsePgnFile } from "@/lib/course/build-tree";
import type { CourseMeta, CourseTree } from "@/lib/course/types";
import {
  expectedMove, initLearn, learnReducer, learnTurn, type LearnAction, type LearnState,
} from "@/lib/training/learn";

const meta: CourseMeta = { slug: "ruy", name: "Ruy", eco: [], mainSide: "white", credits: [], contentLicense: "CC0" };
const tree: CourseTree = buildCourseTree(meta, parsePgnFile("ruy/lines.pgn", `[LineId "berlin"]
[LineName "Berlin"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 Nf6 4. O-O *

[LineId "morphy"]
[LineName "Morphy"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 *
`));
const [berlin, morphy] = tree.lines;

const run = (state: LearnState, ...actions: LearnAction[]) =>
  actions.reduce((s, a) => learnReducer(tree, s, a), state);

// Plays expected moves for both sides until the current pass ends.
function playPass(state: LearnState): LearnState {
  let s = state;
  const phase = s.phase;
  while (s.phase === phase && learnTurn(tree, s) !== "done") {
    s = learnTurn(tree, s) === "learner"
      ? learnReducer(tree, s, { type: "play", san: expectedMove(tree, s)! })
      : learnReducer(tree, s, { type: "opponentMoved" });
  }
  return s;
}

describe("learn mode as white", () => {
  test("starts guided with the learner to move", () => {
    const s = initLearn(tree, berlin, "white");
    expect(s).toMatchObject({ phase: "guided", index: 0, feedback: null });
    expect(learnTurn(tree, s)).toBe("learner");
    expect(expectedMove(tree, s)).toBe("e4");
  });

  test("a correct move advances and hands the turn to the opponent", () => {
    const s = run(initLearn(tree, berlin, "white"), { type: "play", san: "e4" });
    expect(s).toMatchObject({ index: 1, feedback: { kind: "correct", san: "e4" } });
    expect(learnTurn(tree, s)).toBe("opponent");
    const after = run(s, { type: "opponentMoved" });
    expect(after).toMatchObject({ index: 2, feedback: null });
    expect(expectedMove(tree, after)).toBe("Nf3");
  });

  test("finishing the guided pass starts the recall pass from the beginning", () => {
    const s = playPass(initLearn(tree, berlin, "white"));
    expect(s).toMatchObject({ phase: "recall", index: 0 });
  });

  test("a clean recall pass completes the line", () => {
    const s = playPass(playPass(initLearn(tree, berlin, "white")));
    expect(s.phase).toBe("completed");
    expect(learnTurn(tree, s)).toBe("done");
  });

  test("a guided mistake must be corrected but does not restart", () => {
    const s = run(initLearn(tree, berlin, "white"), { type: "play", san: "d4" });
    expect(s).toMatchObject({ index: 0, feedback: { kind: "mistake", played: "d4", expected: "e4", nodeId: "root" } });
    expect(run(s, { type: "play", san: "e4" })).toMatchObject({ phase: "guided", index: 1 });
  });

  test("a recall mistake is corrected and then the pass restarts", () => {
    let s = playPass(initLearn(tree, berlin, "white"));
    s = run(s, { type: "play", san: "e4" }, { type: "opponentMoved" }, { type: "play", san: "Nf3" }, { type: "opponentMoved" });
    expect(expectedMove(tree, s)).toBe("Bb5");
    s = run(s, { type: "play", san: "Bc4" });
    expect(s.feedback).toMatchObject({ kind: "mistake", expected: "Bb5" });
    s = run(s, { type: "play", san: "Bb5" });
    expect(s).toMatchObject({ phase: "recall", index: 0, feedback: { kind: "restarted" } });
  });

  test("moves out of turn and illegal moves are ignored", () => {
    const opponentTurn = run(initLearn(tree, berlin, "white"), { type: "play", san: "e4" });
    expect(run(opponentTurn, { type: "play", san: "e5" })).toBe(opponentTurn);
    const start = initLearn(tree, berlin, "white");
    expect(run(start, { type: "play", san: "Ke2" })).toBe(start);
    expect(run(start, { type: "opponentMoved" })).toBe(start);
  });

  test("restart returns to the guided pass", () => {
    const s = run(playPass(initLearn(tree, berlin, "white")), { type: "restart" });
    expect(s).toMatchObject({ phase: "guided", index: 0, feedback: null });
  });
});

describe("learn mode as black", () => {
  test("the opponent moves first", () => {
    const s = initLearn(tree, morphy, "black");
    expect(learnTurn(tree, s)).toBe("opponent");
    expect(expectedMove(tree, run(s, { type: "opponentMoved" }))).toBe("e5");
  });

  test("another course move is accepted with a note, not graded as a mistake", () => {
    let s = run(initLearn(tree, morphy, "black"), { type: "opponentMoved" }, { type: "play", san: "e5" },
      { type: "opponentMoved" }, { type: "play", san: "Nc6" }, { type: "opponentMoved" });
    expect(expectedMove(tree, s)).toBe("a6");
    s = run(s, { type: "play", san: "Nf6" });
    expect(s.feedback).toEqual({ kind: "alternative", played: "Nf6", expected: "a6" });
    expect(s.index).toBe(5);
    expect(run(s, { type: "play", san: "a6" }).index).toBe(6);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test tests/unit/lib/training/learn.test.ts`
Expected: FAIL, cannot resolve `@/lib/training/learn`.

- [ ] **Step 3: Implement `lib/training/learn.ts`**

```ts
import { applySan, sanEquals, turnOf, type Side } from "@/lib/chess/position";
import type { CourseNode, CourseTree, Line } from "@/lib/course/types";

export type LearnPhase = "guided" | "recall" | "completed";

export type LearnFeedback =
  | { kind: "correct"; san: string }
  | { kind: "alternative"; played: string; expected: string }
  | { kind: "mistake"; played: string; expected: string; nodeId: string }
  | { kind: "restarted" };

export interface LearnState {
  lineId: string;
  side: Side;
  phase: LearnPhase;
  path: string[]; // [rootId, ...line.nodeIds]
  index: number; // the board shows path[index]
  feedback: LearnFeedback | null;
}

export type LearnAction =
  | { type: "play"; san: string }
  | { type: "opponentMoved" }
  | { type: "restart" };

export type LearnTurn = "learner" | "opponent" | "done";

export function initLearn(tree: CourseTree, line: Line, side: Side): LearnState {
  return {
    lineId: line.id, side, phase: "guided",
    path: [tree.rootId, ...line.nodeIds], index: 0, feedback: null,
  };
}

export function currentNode(tree: CourseTree, state: LearnState): CourseNode {
  return tree.nodes[state.path[state.index]];
}

export function expectedMove(tree: CourseTree, state: LearnState): string | null {
  const nextId = state.path[state.index + 1];
  return nextId ? tree.nodes[nextId].san : null;
}

export function learnTurn(tree: CourseTree, state: LearnState): LearnTurn {
  if (state.phase === "completed" || state.index >= state.path.length - 1) return "done";
  return turnOf(currentNode(tree, state).position) === state.side ? "learner" : "opponent";
}

function advance(state: LearnState): LearnState {
  const index = state.index + 1;
  if (index < state.path.length - 1) return { ...state, index };
  if (state.phase === "guided") return { ...state, phase: "recall", index: 0 };
  return { ...state, phase: "completed", index };
}

export function learnReducer(tree: CourseTree, state: LearnState, action: LearnAction): LearnState {
  switch (action.type) {
    case "restart":
      return { ...state, phase: "guided", index: 0, feedback: null };

    case "opponentMoved":
      if (learnTurn(tree, state) !== "opponent") return state;
      return advance({ ...state, feedback: null });

    case "play": {
      if (learnTurn(tree, state) !== "learner") return state;
      const node = currentNode(tree, state);
      const expected = expectedMove(tree, state) as string;

      if (sanEquals(node.fen, action.san, expected)) {
        if (state.phase === "recall" && state.feedback?.kind === "mistake") {
          return { ...state, index: 0, feedback: { kind: "restarted" } };
        }
        return advance({ ...state, feedback: { kind: "correct", san: expected } });
      }

      const applied = applySan(node.fen, action.san);
      if (!applied) return state;

      const accepted = node.children.some((id) => tree.nodes[id].san === applied.san);
      if (accepted && state.feedback?.kind !== "mistake") {
        return { ...state, feedback: { kind: "alternative", played: applied.san, expected } };
      }
      return { ...state, feedback: { kind: "mistake", played: applied.san, expected, nodeId: node.id } };
    }
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test tests/unit/lib/training/learn.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/training/learn.ts tests/unit/lib/training/learn.test.ts
git commit -m "feat: add learn mode state machine"
```

---

### Task 9: Review selection and grading

**Files:**
- Create: `lib/training/review.ts`
- Test: `tests/unit/lib/training/review.test.ts`

**Interfaces:**
- Consumes: `applySan`, `sanEquals`, `turnOf`, `Side`; `CourseNode`, `CourseTree`, `Line`; `learnedLineKey`, `CardState`, `ProgressSnapshot` from `@/lib/progress/types`; `cardId`, `cardsForLine`, `CardId`; `isDue`, `ReviewRating` from `@/lib/training/scheduler`.
- Produces:
  - `DEFAULT_SESSION_SIZE = 20`
  - `interface ReviewPick { tree: CourseTree; line: Line; dueIds: CardId[] }`
  - `type ReviewFeedback = { kind: "correct"; san } | { kind: "alternative"; played; expected } | { kind: "mistake"; played; expected } | { kind: "revealed"; played; expected }`
  - `interface ReviewState { side; courseSlug; lineId; path: string[]; index; dueIds: CardId[]; attempts; feedback: ReviewFeedback | null; graded: { cardId: CardId; rating: ReviewRating }[] }`
  - `type ReviewAction = { type: "play"; san: string } | { type: "advance" }`
  - `type ReviewTurn = "learner" | "auto" | "opponent" | "done"`
  - `pickReviewLine(trees, cards, learnedLines, side, now): ReviewPick | null`
  - `initReview(pick, side): ReviewState`
  - `nextReview(trees, snapshot, side, now, gradedSoFar, sessionSize = DEFAULT_SESSION_SIZE): ReviewState | null`
  - `reviewNode(tree, state): CourseNode`
  - `reviewExpectedMove(tree, state): string | null`
  - `remainingDue(state): CardId[]`
  - `reviewTurn(tree, state): ReviewTurn`
  - `reviewReducer(tree, state, action): ReviewState`

Behaviour (spec §6):
- **Line choice:** among learned lines for the chosen side, the one with the most due cards wins. This covers "choose the opponent reply leading to the most due cards", because each named line fixes the opponent's replies. Ties keep course order, then line order.
- **Turns:**
  - `opponent`: the UI dispatches `advance` after a short pause.
  - `auto`: the learner's move here isn't due; the UI dispatches `advance` quickly.
  - `learner`: play stops for the learner's move.
- **Grading:**
  - Correct first try → `good`, and the state advances.
  - Correct after one wrong attempt → `again`.
  - A second wrong attempt → `revealed` feedback, graded `again`. The turn becomes `auto`, so the UI shows the answer and then plays it.
- **Accepted alternatives** get `alternative` feedback and don't count as an attempt.
- **End of line:** the turn is `done` once every due card in the line is graded. The UI saves grades after each one, then calls `nextReview` with fresh cards.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "vitest";
import { buildCourseTree, parsePgnFile } from "@/lib/course/build-tree";
import type { CourseMeta, CourseTree } from "@/lib/course/types";
import { learnedLineKey, type CardState, type ProgressSnapshot } from "@/lib/progress/types";
import { cardId, cardsForLine, generateCards, type CardId } from "@/lib/training/cards";
import {
  initReview, nextReview, pickReviewLine, remainingDue, reviewExpectedMove, reviewReducer, reviewTurn,
  type ReviewAction, type ReviewState,
} from "@/lib/training/review";
import { DAY_MS, gradeCard, learnCards, newCardState } from "@/lib/training/scheduler";

const meta: CourseMeta = { slug: "ruy", name: "Ruy", eco: [], mainSide: "white", credits: [], contentLicense: "CC0" };
const tree: CourseTree = buildCourseTree(meta, parsePgnFile("ruy/lines.pgn", `[LineId "berlin"]
[LineName "Berlin"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 Nf6 4. O-O *

[LineId "morphy"]
[LineName "Morphy"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 *
`));

const T0 = new Date("2026-03-01T09:00:00.000Z");
const at = (days: number) => new Date(T0.getTime() + days * DAY_MS);

function learn(
  snapshot: ProgressSnapshot, lineIds: string[], when: Date,
): ProgressSnapshot {
  const specs = generateCards([tree], "white");
  const next = structuredClone(snapshot);
  for (const lineId of lineIds) {
    const line = tree.lines.find((l) => l.id === lineId)!;
    const ids = cardsForLine(tree, line, "white");
    const states = ids.map((id) => next.cards[id] ?? newCardState(specs.get(id)!, when));
    for (const card of learnCards(states, when)) next.cards[card.id] = card;
    next.learnedLines[learnedLineKey("ruy", "white", lineId)] = { learnedAt: when.toISOString() };
  }
  return next;
}

const empty = (): ProgressSnapshot => ({ schemaVersion: 1, cards: {}, learnedLines: {}, explore: {} });
const run = (state: ReviewState, ...actions: ReviewAction[]) =>
  actions.reduce((s, a) => reviewReducer(tree, s, a), state);

describe("pickReviewLine", () => {
  test("nothing is picked before cards are due or for unlearned lines", () => {
    const snap = learn(empty(), ["berlin"], T0);
    expect(pickReviewLine([tree], snap.cards, snap.learnedLines, "white", at(0.5))).toBeNull();
    expect(pickReviewLine([tree], snap.cards, snap.learnedLines, "black", at(2))).toBeNull();
  });

  test("the learned line with the most due cards wins", () => {
    let snap = learn(empty(), ["berlin"], T0);
    snap = learn(snap, ["morphy"], at(0.5));
    const first = pickReviewLine([tree], snap.cards, snap.learnedLines, "white", at(1.2))!;
    expect(first.line.id).toBe("berlin");
    expect(first.dueIds).toHaveLength(4);

    for (const id of first.dueIds) snap.cards[id] = gradeCard(snap.cards[id], "good", at(1.2));
    const second = pickReviewLine([tree], snap.cards, snap.learnedLines, "white", at(1.6))!;
    expect(second.line.id).toBe("morphy");
    expect(second.dueIds).toEqual([cardId("white", tree.nodes["e4 e5 Nf3 Nc6 Bb5 a6"].position)]);
  });
});

describe("reviewReducer", () => {
  const due = learn(empty(), ["berlin"], T0);
  const start = () => initReview(pickReviewLine([tree], due.cards, due.learnedLines, "white", at(1))!, "white");

  test("a correct first try is graded good and advances", () => {
    const s = run(start(), { type: "play", san: "e4" });
    expect(s.graded).toEqual([{ cardId: cardId("white", tree.nodes.root.position), rating: "good" }]);
    expect(s.feedback).toEqual({ kind: "correct", san: "e4" });
    expect(reviewTurn(tree, s)).toBe("opponent");
    expect(reviewExpectedMove(tree, run(s, { type: "advance" }))).toBe("Nf3");
  });

  test("correct after one wrong attempt is graded again", () => {
    let s = run(start(), { type: "play", san: "d4" });
    expect(s).toMatchObject({ attempts: 1, index: 0, feedback: { kind: "mistake", played: "d4", expected: "e4" } });
    s = run(s, { type: "play", san: "e4" });
    expect(s.graded.at(-1)?.rating).toBe("again");
    expect(s.attempts).toBe(0);
  });

  test("a second wrong attempt reveals the answer, grades again and auto-plays it", () => {
    const s = run(start(), { type: "play", san: "d4" }, { type: "play", san: "c4" });
    expect(s.feedback).toEqual({ kind: "revealed", played: "c4", expected: "e4" });
    expect(s.graded).toEqual([{ cardId: cardId("white", tree.nodes.root.position), rating: "again" }]);
    expect(reviewTurn(tree, s)).toBe("auto");
    expect(run(s, { type: "advance" }).index).toBe(1);
  });

  test("moves that are not due are auto-played", () => {
    const partly = structuredClone(due);
    const rootId = cardId("white", tree.nodes.root.position) as CardId;
    partly.cards[rootId] = gradeCard(partly.cards[rootId] as CardState, "good", at(1));
    const s = initReview(pickReviewLine([tree], partly.cards, partly.learnedLines, "white", at(1))!, "white");
    expect(reviewTurn(tree, s)).toBe("auto");
    expect(run(s, { type: "play", san: "e4" })).toBe(s);
    expect(reviewTurn(tree, run(s, { type: "advance" }))).toBe("opponent");
  });

  test("the line is done once every due card is graded", () => {
    let s = start();
    while (reviewTurn(tree, s) !== "done") {
      s = reviewTurn(tree, s) === "learner"
        ? run(s, { type: "play", san: reviewExpectedMove(tree, s)! })
        : run(s, { type: "advance" });
    }
    expect(remainingDue(s)).toEqual([]);
    expect(s.graded.map((g) => g.rating)).toEqual(["good", "good", "good", "good"]);
  });

  test("illegal moves and moves out of turn are ignored", () => {
    const s = start();
    expect(run(s, { type: "play", san: "Ke2" })).toBe(s);
    expect(run(s, { type: "advance" })).toBe(s);
  });

  test("another course move gets a note without counting as an attempt", () => {
    const withAlternative = buildCourseTree(meta, parsePgnFile("ruy/lines.pgn", `[LineId "morphy"]
[LineName "Morphy"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 (4. Bxc6 dxc6) *
`));
    const line = withAlternative.lines[0];
    const specs = generateCards([withAlternative], "white");
    const cards = Object.fromEntries(
      learnCards(cardsForLine(withAlternative, line, "white").map((id) => newCardState(specs.get(id)!, T0)), T0)
        .map((card) => [card.id, card]),
    );
    const learned = { [learnedLineKey("ruy", "white", "morphy")]: { learnedAt: T0.toISOString() } };
    const step = (s: ReviewState, action: ReviewAction) => reviewReducer(withAlternative, s, action);

    let s = initReview(pickReviewLine([withAlternative], cards, learned, "white", at(1))!, "white");
    while (reviewExpectedMove(withAlternative, s) !== "Ba4") {
      s = reviewTurn(withAlternative, s) === "learner"
        ? step(s, { type: "play", san: reviewExpectedMove(withAlternative, s)! })
        : step(s, { type: "advance" });
    }
    const before = s.graded.length;
    s = step(s, { type: "play", san: "Bxc6" });
    expect(s.feedback).toEqual({ kind: "alternative", played: "Bxc6", expected: "Ba4" });
    expect(s.attempts).toBe(0);
    expect(s.graded).toHaveLength(before);
    expect(step(s, { type: "play", san: "Ba4" }).graded.at(-1)?.rating).toBe("good");
  });
});

describe("nextReview", () => {
  test("stops at the session size or when nothing is due", () => {
    const snap = learn(empty(), ["berlin"], T0);
    expect(nextReview([tree], snap, "white", at(1), 0)?.lineId).toBe("berlin");
    expect(nextReview([tree], snap, "white", at(1), 20)).toBeNull();
    expect(nextReview([tree], snap, "white", at(1), 3, 3)).toBeNull();
    expect(nextReview([tree], snap, "white", at(0.5), 0)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test tests/unit/lib/training/review.test.ts`
Expected: FAIL, cannot resolve `@/lib/training/review`.

- [ ] **Step 3: Implement `lib/training/review.ts`**

```ts
import { applySan, sanEquals, turnOf, type Side } from "@/lib/chess/position";
import type { CourseNode, CourseTree, Line } from "@/lib/course/types";
import { learnedLineKey, type CardState, type ProgressSnapshot } from "@/lib/progress/types";
import { cardId, cardsForLine, type CardId } from "./cards";
import { isDue, type ReviewRating } from "./scheduler";

export const DEFAULT_SESSION_SIZE = 20;

export interface ReviewPick {
  tree: CourseTree;
  line: Line;
  dueIds: CardId[];
}

export type ReviewFeedback =
  | { kind: "correct"; san: string }
  | { kind: "alternative"; played: string; expected: string }
  | { kind: "mistake"; played: string; expected: string }
  | { kind: "revealed"; played: string; expected: string };

export interface ReviewState {
  side: Side;
  courseSlug: string;
  lineId: string;
  path: string[]; // [rootId, ...line.nodeIds]
  index: number;
  dueIds: CardId[];
  attempts: number; // wrong attempts on the current card
  feedback: ReviewFeedback | null;
  graded: { cardId: CardId; rating: ReviewRating }[];
}

export type ReviewAction = { type: "play"; san: string } | { type: "advance" };

// learner: a due card is waiting for the learner's move
// auto: the learner's move here is not being tested; play it automatically
// opponent: the course plays the opponent's move
export type ReviewTurn = "learner" | "auto" | "opponent" | "done";

// The learned line with the most due cards wins; ties keep course and line order.
export function pickReviewLine(
  trees: CourseTree[],
  cards: Record<CardId, CardState>,
  learnedLines: ProgressSnapshot["learnedLines"],
  side: Side,
  now: Date,
): ReviewPick | null {
  let best: ReviewPick | null = null;
  for (const tree of trees) {
    for (const line of tree.lines) {
      if (!learnedLines[learnedLineKey(tree.meta.slug, side, line.id)]) continue;
      const dueIds = cardsForLine(tree, line, side).filter((id) => cards[id] && isDue(cards[id], now));
      if (dueIds.length > (best?.dueIds.length ?? 0)) best = { tree, line, dueIds };
    }
  }
  return best;
}

export function initReview(pick: ReviewPick, side: Side): ReviewState {
  return {
    side,
    courseSlug: pick.tree.meta.slug,
    lineId: pick.line.id,
    path: [pick.tree.rootId, ...pick.line.nodeIds],
    index: 0,
    dueIds: pick.dueIds,
    attempts: 0,
    feedback: null,
    graded: [],
  };
}

export function nextReview(
  trees: CourseTree[],
  snapshot: ProgressSnapshot,
  side: Side,
  now: Date,
  gradedSoFar: number,
  sessionSize: number = DEFAULT_SESSION_SIZE,
): ReviewState | null {
  if (gradedSoFar >= sessionSize) return null;
  const pick = pickReviewLine(trees, snapshot.cards, snapshot.learnedLines, side, now);
  return pick ? initReview(pick, side) : null;
}

export function reviewNode(tree: CourseTree, state: ReviewState): CourseNode {
  return tree.nodes[state.path[state.index]];
}

export function reviewExpectedMove(tree: CourseTree, state: ReviewState): string | null {
  const nextId = state.path[state.index + 1];
  return nextId ? tree.nodes[nextId].san : null;
}

function isGraded(state: ReviewState, id: CardId): boolean {
  return state.graded.some((g) => g.cardId === id);
}

export function remainingDue(state: ReviewState): CardId[] {
  return state.dueIds.filter((id) => !isGraded(state, id));
}

export function reviewTurn(tree: CourseTree, state: ReviewState): ReviewTurn {
  if (state.index >= state.path.length - 1 || remainingDue(state).length === 0) return "done";
  const node = reviewNode(tree, state);
  if (turnOf(node.position) !== state.side) return "opponent";
  const id = cardId(state.side, node.position);
  return state.dueIds.includes(id) && !isGraded(state, id) ? "learner" : "auto";
}

export function reviewReducer(tree: CourseTree, state: ReviewState, action: ReviewAction): ReviewState {
  const turn = reviewTurn(tree, state);

  if (action.type === "advance") {
    if (turn !== "opponent" && turn !== "auto") return state;
    return { ...state, index: state.index + 1, attempts: 0, feedback: null };
  }

  if (turn !== "learner") return state;
  const node = reviewNode(tree, state);
  const expected = reviewExpectedMove(tree, state) as string;
  const id = cardId(state.side, node.position);

  if (sanEquals(node.fen, action.san, expected)) {
    const rating: ReviewRating = state.attempts === 0 ? "good" : "again";
    return {
      ...state,
      index: state.index + 1,
      attempts: 0,
      feedback: { kind: "correct", san: expected },
      graded: [...state.graded, { cardId: id, rating }],
    };
  }

  const applied = applySan(node.fen, action.san);
  if (!applied) return state;

  if (node.children.some((childId) => tree.nodes[childId].san === applied.san)) {
    return { ...state, feedback: { kind: "alternative", played: applied.san, expected } };
  }

  const attempts = state.attempts + 1;
  if (attempts >= 2) {
    return {
      ...state,
      attempts,
      feedback: { kind: "revealed", played: applied.san, expected },
      graded: [...state.graded, { cardId: id, rating: "again" }],
    };
  }
  return { ...state, attempts, feedback: { kind: "mistake", played: applied.san, expected } };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test tests/unit/lib/training/review.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/training/review.ts tests/unit/lib/training/review.test.ts
git commit -m "feat: add review line selection and grading"
```

---

### Task 10: Workspace event bus

**Files:**
- Create: `lib/events/bus.ts`
- Test: `tests/unit/lib/events/bus.test.ts`

**Interfaces:**
- Consumes: `Side`; `Commentary`; `CardId`; `ReviewRating`.
- Produces:
  - `interface SessionStats { graded: number; good: number; again: number; mistakes: number }`
  - `type WorkspaceEvent` (exactly the union in spec §7)
  - `type WorkspaceEventType`, `type EventOf<T>`
  - `interface EventBus { emit(event); on(type, handler): () => void; onAny(handler): () => void }`
  - `createEventBus(onError?: (error: unknown) => void): EventBus`

The companion (sub-project 4) will subscribe with `onAny`. A subscriber that throws is reported through `onError` and never interrupts training.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test, vi } from "vitest";
import { createEventBus, type WorkspaceEvent } from "@/lib/events/bus";

const move: WorkspaceEvent = { type: "moveMade", san: "e4", by: "learner", nodeId: "e4" };
const learned: WorkspaceEvent = { type: "lineLearned", courseSlug: "ruy", lineId: "berlin", side: "white" };

describe("createEventBus", () => {
  test("typed subscribers only receive their event type", () => {
    const bus = createEventBus();
    const onMove = vi.fn();
    bus.on("moveMade", onMove);
    bus.emit(learned);
    bus.emit(move);
    expect(onMove).toHaveBeenCalledTimes(1);
    expect(onMove).toHaveBeenCalledWith(move);
  });

  test("onAny receives every event in order", () => {
    const bus = createEventBus();
    const seen: string[] = [];
    bus.onAny((event) => seen.push(event.type));
    bus.emit(move);
    bus.emit(learned);
    expect(seen).toEqual(["moveMade", "lineLearned"]);
  });

  test("unsubscribing stops delivery", () => {
    const bus = createEventBus();
    const handler = vi.fn();
    const off = bus.on("lineLearned", handler);
    off();
    bus.emit(learned);
    expect(handler).not.toHaveBeenCalled();
  });

  test("a throwing handler is reported and does not block other handlers", () => {
    const onError = vi.fn();
    const bus = createEventBus(onError);
    const after = vi.fn();
    bus.onAny(() => {
      throw new Error("companion crashed");
    });
    bus.onAny(after);
    bus.emit(move);
    expect(after).toHaveBeenCalledWith(move);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "companion crashed" }));
  });

  test("handlers added during an emit start with the next event", () => {
    const bus = createEventBus();
    const late = vi.fn();
    bus.onAny(() => {
      bus.onAny(late);
    });
    bus.emit(move);
    expect(late).not.toHaveBeenCalled();
    bus.emit(learned);
    expect(late).toHaveBeenCalledWith(learned);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test tests/unit/lib/events/bus.test.ts`
Expected: FAIL, cannot resolve `@/lib/events/bus`.

- [ ] **Step 3: Implement `lib/events/bus.ts`**

```ts
import type { Side } from "@/lib/chess/position";
import type { Commentary } from "@/lib/course/types";
import type { CardId } from "@/lib/training/cards";
import type { ReviewRating } from "@/lib/training/scheduler";

export interface SessionStats {
  graded: number;
  good: number;
  again: number;
  mistakes: number;
}

export type WorkspaceEvent =
  | { type: "moveMade"; san: string; by: "learner" | "opponent"; nodeId: string }
  | { type: "mistake"; played: string; expected: string; cardId?: CardId }
  | { type: "cardReviewed"; cardId: CardId; rating: ReviewRating }
  | { type: "lineLearned"; courseSlug: string; lineId: string; side: Side }
  | { type: "commentaryShown"; nodeId: string; commentary: Commentary }
  | { type: "sessionEnded"; mode: "learn" | "review"; stats: SessionStats };

export type WorkspaceEventType = WorkspaceEvent["type"];
export type EventOf<T extends WorkspaceEventType> = Extract<WorkspaceEvent, { type: T }>;

export interface EventBus {
  emit(event: WorkspaceEvent): void;
  on<T extends WorkspaceEventType>(type: T, handler: (event: EventOf<T>) => void): () => void;
  onAny(handler: (event: WorkspaceEvent) => void): () => void;
}

type AnyHandler = (event: WorkspaceEvent) => void;

// One failing subscriber (for example a future companion) must never break
// training, so handler errors are reported and swallowed.
export function createEventBus(onError: (error: unknown) => void = console.error): EventBus {
  const handlers = new Set<{ type: WorkspaceEventType | "*"; handler: AnyHandler }>();

  const subscribe = (type: WorkspaceEventType | "*", handler: AnyHandler) => {
    const entry = { type, handler };
    handlers.add(entry);
    return () => {
      handlers.delete(entry);
    };
  };

  return {
    emit(event) {
      for (const entry of [...handlers]) {
        if (entry.type !== "*" && entry.type !== event.type) continue;
        try {
          entry.handler(event);
        } catch (error) {
          onError(error);
        }
      }
    },
    on(type, handler) {
      return subscribe(type, handler as AnyHandler);
    },
    onAny(handler) {
      return subscribe("*", handler);
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test tests/unit/lib/events/bus.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/events tests/unit/lib/events
git commit -m "feat: add typed workspace event bus"
```

---

### Task 11: Theme tokens, built-in themes, skins and piece art

**Files:**
- Create: `lib/theme/tokens.ts`, `lib/theme/themes.ts`, `lib/theme/contrast.ts`, `lib/theme/skins.ts`, `lib/theme/validate.ts`, `lib/theme/apply.ts`
- Create: `public/pieces/cburnett/{wK,wQ,wR,wB,wN,wP,bK,bQ,bR,bB,bN,bP}.svg`
- Test: `tests/unit/lib/theme/theme.test.ts`

**Interfaces:**
- Consumes: `PieceCode` from `@/lib/chess/position`; `Credit` from `@/lib/course/types`.
- Produces (`tokens.ts`):
  - `COLOR_TOKENS`, `SHAPE_TOKENS`, `TOKEN_NAMES`
  - `type ColorToken`, `type TokenName`
  - `cssVar(name): "--mc-<name>"`
  - `CONTRAST_PAIRS: [ColorToken, ColorToken, number][]`
- Produces (`themes.ts`):
  - `interface Theme { schemaVersion: 1; id; name; tokens: Record<TokenName, string>; pieceSetId; boardSkinId }`
  - `SUMMER_SKY`, `NIGHT_SHIFT`, `BUILT_IN_THEMES`, `DEFAULT_THEME_ID`
  - `getTheme(id): Theme` (unknown → Summer Sky)
- Produces (`contrast.ts`): `isHexColor(value)`, `relativeLuminance(hex)`, `contrastRatio(fg, bg)`.
- Produces (`skins.ts`):
  - `PIECE_CODES`
  - `interface PieceSet { id; name; credit: Credit; pieces: Partial<Record<PieceCode, string>> }`
  - `type BoardSkin = { id; name; kind: "tokens" } | { id; name; kind: "texture"; lightTexture; darkTexture }`
  - `DEFAULT_PIECE_SET_ID = "cburnett"`, `DEFAULT_BOARD_SKIN_ID = "tokens"`
  - `PIECE_SETS`, `BOARD_SKINS`
  - `getPieceSet(id)`, `getBoardSkin(id)`
  - `pieceUrl(set, code)` (falls back to the default set per piece), `defaultPieceUrl(code)`
- Produces (`validate.ts`): `type ThemeValidation = { ok: true; theme } | { ok: false; problems: string[] }`; `validateTheme(raw: unknown): ThemeValidation`.
- Produces (`apply.ts`):
  - `themeCssVariables(theme): Record<string, string>`
  - `applyTheme(root: HTMLElement, theme): void` (sets variables and `data-theme`)
  - `themeBootScript(themes, settingsKey): string` (inline `<head>` script that applies the saved theme before paint)

Font tokens reference `--mc-face-display` and `--mc-face-body`, which Task 13 defines through `next/font`.

- [ ] **Step 1: Download the cburnett piece set**

The SVGs come from Wikimedia Commons, where they are licensed CC BY-SA 3.0 by Colin M.L. Burnett (verified through the Commons API while writing this plan). Commons names are `Chess_<piece><l|d>t45.svg`: `l` = white, `d` = black.

```bash
mkdir -p public/pieces/cburnett
for p in k q r b n p; do
  for c in l d; do
    color=$([ "$c" = l ] && echo w || echo b)
    upper=$(echo "$p" | tr a-z A-Z)
    curl -sSL -A "moechess-dev/0.1" -o "public/pieces/cburnett/${color}${upper}.svg" \
      "https://commons.wikimedia.org/wiki/Special:FilePath/Chess_${p}${c}t45.svg"
  done
done
ls public/pieces/cburnett | wc -l
head -c 120 public/pieces/cburnett/wN.svg
```

Expected: `12`, and the file starts with `<?xml`. If any file is HTML instead of SVG, re-download that piece.

- [ ] **Step 2: Write the failing test**

```ts
import { describe, expect, test } from "vitest";
import { applyTheme, themeBootScript, themeCssVariables } from "@/lib/theme/apply";
import { contrastRatio } from "@/lib/theme/contrast";
import { PIECE_CODES, PIECE_SETS, getBoardSkin, getPieceSet, pieceUrl } from "@/lib/theme/skins";
import { BUILT_IN_THEMES, NIGHT_SHIFT, SUMMER_SKY, getTheme } from "@/lib/theme/themes";
import { TOKEN_NAMES } from "@/lib/theme/tokens";
import { validateTheme } from "@/lib/theme/validate";

describe("contrast", () => {
  test("matches known WCAG ratios", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#FFFFFF")).toBeCloseTo(4.48, 2);
  });
});

describe("built-in themes", () => {
  test.each(BUILT_IN_THEMES.map((t) => [t.id, t] as const))("%s passes validation, including contrast", (_, theme) => {
    expect(validateTheme(theme)).toEqual({ ok: true, theme });
  });

  test("every built-in theme defines exactly the token set", () => {
    for (const theme of BUILT_IN_THEMES) expect(Object.keys(theme.tokens).sort()).toEqual([...TOKEN_NAMES].sort());
  });

  test("unknown theme ids fall back to Summer Sky", () => {
    expect(getTheme("night-shift")).toBe(NIGHT_SHIFT);
    expect(getTheme("nope")).toBe(SUMMER_SKY);
    expect(getTheme(null)).toBe(SUMMER_SKY);
  });
});

describe("validateTheme", () => {
  const withTokens = (tokens: Partial<typeof SUMMER_SKY.tokens> & Record<string, string>) =>
    ({ ...SUMMER_SKY, tokens: { ...SUMMER_SKY.tokens, ...tokens } });

  test("reports missing and unknown tokens", () => {
    const tokens: Record<string, string> = { ...SUMMER_SKY.tokens, sparkle: "#FFFFFF" };
    delete tokens.bg;
    const result = validateTheme({ ...SUMMER_SKY, tokens });
    expect(result).toEqual({ ok: false, problems: ['unknown token "sparkle"', 'token "bg" is missing'] });
  });

  test("colour tokens must be hex and pass contrast", () => {
    expect(validateTheme(withTokens({ ink: "purple" }))).toMatchObject({ ok: false, problems: ['token "ink" must be a #RRGGBB colour'] });
    const low = validateTheme(withTokens({ "ink-muted": "#C8D4EE" }));
    expect(low.ok).toBe(false);
    expect(!low.ok && low.problems[0]).toMatch(/^"ink-muted" on "bg" has contrast \d\.\d\d, needs 4\.5$/);
  });

  test("values that could escape CSS are rejected", () => {
    const result = validateTheme(withTokens({ "font-body": "x; background: url(https://evil.example/)" }));
    expect(result).toEqual({ ok: false, problems: ['token "font-body" contains characters that aren\'t allowed'] });
  });

  test("ids, names and skin references are checked", () => {
    const result = validateTheme({ ...SUMMER_SKY, id: "Bad Id", name: " ", pieceSetId: "nope", boardSkinId: "nope" });
    expect(result).toEqual({
      ok: false,
      problems: [
        "id must be lowercase words joined by hyphens",
        "name is required",
        'unknown piece set "nope"',
        'unknown board skin "nope"',
      ],
    });
  });
});

describe("skins", () => {
  test("the default piece set has all twelve pieces", () => {
    expect(PIECE_CODES.map((code) => pieceUrl(PIECE_SETS.cburnett, code))).toHaveLength(12);
    expect(pieceUrl(PIECE_SETS.cburnett, "wN")).toBe("/pieces/cburnett/wN.svg");
  });

  test("missing pieces and unknown ids fall back to defaults", () => {
    const partial = { id: "half", name: "Half", credit: { label: "x", license: "CC0" }, pieces: { wK: "/k.png" } };
    expect(pieceUrl(partial, "wK")).toBe("/k.png");
    expect(pieceUrl(partial, "bQ")).toBe("/pieces/cburnett/bQ.svg");
    expect(getPieceSet("nope").id).toBe("cburnett");
    expect(getBoardSkin(undefined).kind).toBe("tokens");
  });
});

describe("applying themes", () => {
  test("css variables use the --mc- prefix", () => {
    expect(themeCssVariables(SUMMER_SKY)["--mc-bg"]).toBe("#DDEBFF");
  });

  test("applyTheme sets variables and data-theme on the root", () => {
    const root = document.documentElement;
    applyTheme(root, NIGHT_SHIFT);
    expect(root.style.getPropertyValue("--mc-surface")).toBe("#2A2150");
    expect(root.getAttribute("data-theme")).toBe("night-shift");
  });

  test("the boot script applies a saved theme and ignores bad data", () => {
    const script = themeBootScript(BUILT_IN_THEMES, "moechess:settings");
    const root = document.documentElement;

    root.removeAttribute("data-theme");
    root.removeAttribute("style");
    localStorage.setItem("moechess:settings", JSON.stringify({ themeId: "night-shift" }));
    new Function(script)();
    expect(root.getAttribute("data-theme")).toBe("night-shift");
    expect(root.style.getPropertyValue("--mc-bg")).toBe("#1A1433");

    root.removeAttribute("data-theme");
    for (const bad of ["{oops", JSON.stringify({ themeId: "toString" }), JSON.stringify({ themeId: 4 })]) {
      localStorage.setItem("moechess:settings", bad);
      expect(() => new Function(script)()).not.toThrow();
      expect(root.getAttribute("data-theme")).toBeNull();
    }
  });

  test("the boot script cannot close its script tag", () => {
    const evil = { ...SUMMER_SKY, id: "evil", name: "</script><script>alert(1)</script>" };
    expect(themeBootScript([evil], "</script>")).not.toContain("</script>");
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm test tests/unit/lib/theme/theme.test.ts`
Expected: FAIL, cannot resolve `@/lib/theme/apply`.

- [ ] **Step 4: Create `lib/theme/tokens.ts`**

```ts
export const COLOR_TOKENS = [
  "bg",
  "surface",
  "ink",
  "ink-muted",
  "outline",
  "focus",
  "board-light",
  "board-dark",
  "accent-course",
  "on-accent",
  "correct",
  "on-correct",
  "mistake",
  "on-mistake",
  "brush-g",
  "brush-r",
  "brush-y",
  "brush-b",
] as const;

export const SHAPE_TOKENS = [
  "font-display",
  "font-body",
  "radius-panel",
  "radius-button",
  "border-width",
  "duration-move",
  "duration-feedback",
] as const;

export const TOKEN_NAMES = [...COLOR_TOKENS, ...SHAPE_TOKENS] as const;

export type ColorToken = (typeof COLOR_TOKENS)[number];
export type TokenName = (typeof TOKEN_NAMES)[number];

export function cssVar(name: TokenName): `--mc-${TokenName}` {
  return `--mc-${name}`;
}

// [foreground, background, minimum WCAG ratio]. Text pairs need 4.5, UI outlines 3.
export const CONTRAST_PAIRS: [ColorToken, ColorToken, number][] = [
  ["ink", "bg", 4.5],
  ["ink", "surface", 4.5],
  ["ink-muted", "bg", 4.5],
  ["ink-muted", "surface", 4.5],
  ["on-accent", "accent-course", 4.5],
  ["on-correct", "correct", 4.5],
  ["on-mistake", "mistake", 4.5],
  ["outline", "surface", 3],
  ["focus", "bg", 3],
  ["focus", "surface", 3],
];
```

- [ ] **Step 5: Create `lib/theme/themes.ts`**

Summer Sky values come from spec §8; the extra tokens (`ink-muted`, `outline`, `focus`, `on-*`, `brush-*`) are the additions needed to meet contrast and cover PGN arrow colours. Night Shift is the dark counterpart. Both pass the contrast pairs in `tokens.ts`.

```ts
import type { TokenName } from "./tokens";

export interface Theme {
  schemaVersion: 1;
  id: string;
  name: string;
  tokens: Record<TokenName, string>;
  pieceSetId: string;
  boardSkinId: string;
}

// Font tokens point at the faces loaded by next/font in app/layout.tsx.
const shape = {
  "font-display": "var(--mc-face-display), system-ui, sans-serif",
  "font-body": "var(--mc-face-body), system-ui, sans-serif",
  "radius-panel": "14px",
  "radius-button": "999px",
  "border-width": "2px",
  "duration-move": "180ms",
  "duration-feedback": "420ms",
} as const;

export const SUMMER_SKY: Theme = {
  schemaVersion: 1,
  id: "summer-sky",
  name: "Summer Sky",
  pieceSetId: "cburnett",
  boardSkinId: "tokens",
  tokens: {
    bg: "#DDEBFF",
    surface: "#FFFFFF",
    ink: "#25184A",
    "ink-muted": "#5A4E80",
    outline: "#25184A",
    focus: "#5B2BD9",
    "board-light": "#FFF4DC",
    "board-dark": "#8E7CC3",
    "accent-course": "#FFC63D",
    "on-accent": "#25184A",
    correct: "#1FB88A",
    "on-correct": "#25184A",
    mistake: "#FF4F7B",
    "on-mistake": "#25184A",
    "brush-g": "#E09A00",
    "brush-r": "#FF4F7B",
    "brush-y": "#FFC63D",
    "brush-b": "#3C7BF0",
    ...shape,
  },
};

export const NIGHT_SHIFT: Theme = {
  schemaVersion: 1,
  id: "night-shift",
  name: "Night Shift",
  pieceSetId: "cburnett",
  boardSkinId: "tokens",
  tokens: {
    bg: "#1A1433",
    surface: "#2A2150",
    ink: "#F3EEFF",
    "ink-muted": "#B9ADE0",
    outline: "#B9ADE0",
    focus: "#FFC63D",
    "board-light": "#CFC3F0",
    "board-dark": "#5B4A99",
    "accent-course": "#FFC63D",
    "on-accent": "#1A1433",
    correct: "#3DDBA8",
    "on-correct": "#1A1433",
    mistake: "#FF6B92",
    "on-mistake": "#1A1433",
    "brush-g": "#FFC63D",
    "brush-r": "#FF6B92",
    "brush-y": "#FFE08A",
    "brush-b": "#7FB0FF",
    ...shape,
  },
};

export const BUILT_IN_THEMES: Theme[] = [SUMMER_SKY, NIGHT_SHIFT];
export const DEFAULT_THEME_ID = SUMMER_SKY.id;

export function getTheme(id: string | null | undefined): Theme {
  return BUILT_IN_THEMES.find((theme) => theme.id === id) ?? SUMMER_SKY;
}
```

- [ ] **Step 6: Create `lib/theme/contrast.ts`**

```ts
const HEX_RE = /^#([0-9a-f]{6})$/i;

export function isHexColor(value: string): boolean {
  return HEX_RE.test(value);
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const match = HEX_RE.exec(hex);
  if (!match) throw new Error(`Expected a #RRGGBB colour, got "${hex}"`);
  const n = parseInt(match[1], 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

export function contrastRatio(foreground: string, background: string): number {
  const [light, dark] = [relativeLuminance(foreground), relativeLuminance(background)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}
```

- [ ] **Step 7: Create `lib/theme/skins.ts`**

```ts
import type { PieceCode } from "@/lib/chess/position";
import type { Credit } from "@/lib/course/types";

export const PIECE_CODES: PieceCode[] = [
  "wK", "wQ", "wR", "wB", "wN", "wP", "bK", "bQ", "bR", "bB", "bN", "bP",
];

export interface PieceSet {
  id: string;
  name: string;
  credit: Credit;
  pieces: Partial<Record<PieceCode, string>>;
}

export type BoardSkin =
  | { id: string; name: string; kind: "tokens" }
  | { id: string; name: string; kind: "texture"; lightTexture: string; darkTexture: string };

export const DEFAULT_PIECE_SET_ID = "cburnett";
export const DEFAULT_BOARD_SKIN_ID = "tokens";

export const PIECE_SETS: Record<string, PieceSet> = {
  cburnett: {
    id: "cburnett",
    name: "Cburnett",
    credit: {
      label: "Chess pieces",
      author: "Colin M.L. Burnett",
      url: "https://commons.wikimedia.org/wiki/Category:SVG_chess_pieces",
      license: "CC BY-SA 3.0",
    },
    pieces: Object.fromEntries(PIECE_CODES.map((code) => [code, `/pieces/cburnett/${code}.svg`])),
  },
};

export const BOARD_SKINS: Record<string, BoardSkin> = {
  tokens: { id: "tokens", name: "Theme colours", kind: "tokens" },
};

export function getPieceSet(id: string | null | undefined): PieceSet {
  return (id && PIECE_SETS[id]) || PIECE_SETS[DEFAULT_PIECE_SET_ID];
}

export function getBoardSkin(id: string | null | undefined): BoardSkin {
  return (id && BOARD_SKINS[id]) || BOARD_SKINS[DEFAULT_BOARD_SKIN_ID];
}

// A set that lacks a piece falls back to the default set for that piece.
export function pieceUrl(set: PieceSet, code: PieceCode): string {
  return set.pieces[code] ?? (PIECE_SETS[DEFAULT_PIECE_SET_ID].pieces[code] as string);
}

export function defaultPieceUrl(code: PieceCode): string {
  return PIECE_SETS[DEFAULT_PIECE_SET_ID].pieces[code] as string;
}
```

- [ ] **Step 8: Create `lib/theme/validate.ts`**

```ts
import { contrastRatio, isHexColor } from "./contrast";
import { BOARD_SKINS, PIECE_SETS } from "./skins";
import type { Theme } from "./themes";
import { COLOR_TOKENS, CONTRAST_PAIRS, TOKEN_NAMES, type TokenName } from "./tokens";

export type ThemeValidation = { ok: true; theme: Theme } | { ok: false; problems: string[] };

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
// Token values end up inside CSS declarations; block anything that could
// escape the declaration or load a remote resource.
const UNSAFE_VALUE_RE = /[;{}<>\\]|url\s*\(|@import|expression\s*\(/i;

export function validateTheme(raw: unknown): ThemeValidation {
  const problems: string[] = [];
  const theme = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;

  if (theme.schemaVersion !== 1) problems.push("schemaVersion must be 1");
  if (typeof theme.id !== "string" || !ID_RE.test(theme.id)) problems.push("id must be lowercase words joined by hyphens");
  if (typeof theme.name !== "string" || theme.name.trim() === "") problems.push("name is required");
  if (typeof theme.pieceSetId !== "string" || !PIECE_SETS[theme.pieceSetId]) {
    problems.push(`unknown piece set "${String(theme.pieceSetId)}"`);
  }
  if (typeof theme.boardSkinId !== "string" || !BOARD_SKINS[theme.boardSkinId]) {
    problems.push(`unknown board skin "${String(theme.boardSkinId)}"`);
  }

  const tokens = (typeof theme.tokens === "object" && theme.tokens !== null ? theme.tokens : {}) as Record<string, unknown>;
  for (const name of Object.keys(tokens)) {
    if (!(TOKEN_NAMES as readonly string[]).includes(name)) problems.push(`unknown token "${name}"`);
  }
  for (const name of TOKEN_NAMES) {
    const value = tokens[name];
    if (typeof value !== "string" || value.trim() === "") {
      problems.push(`token "${name}" is missing`);
    } else if (UNSAFE_VALUE_RE.test(value)) {
      problems.push(`token "${name}" contains characters that aren't allowed`);
    } else if ((COLOR_TOKENS as readonly string[]).includes(name) && !isHexColor(value)) {
      problems.push(`token "${name}" must be a #RRGGBB colour`);
    }
  }

  const colorsOk = COLOR_TOKENS.every((name) => typeof tokens[name] === "string" && isHexColor(tokens[name] as string));
  if (colorsOk) {
    for (const [fg, bg, min] of CONTRAST_PAIRS) {
      const ratio = contrastRatio(tokens[fg] as string, tokens[bg] as string);
      if (ratio < min) problems.push(`"${fg}" on "${bg}" has contrast ${ratio.toFixed(2)}, needs ${min}`);
    }
  }

  return problems.length ? { ok: false, problems } : { ok: true, theme: raw as Theme };
}

export type { TokenName };
```

- [ ] **Step 9: Create `lib/theme/apply.ts`**

```ts
import type { Theme } from "./themes";
import { TOKEN_NAMES, cssVar } from "./tokens";

export function themeCssVariables(theme: Theme): Record<string, string> {
  return Object.fromEntries(TOKEN_NAMES.map((name) => [cssVar(name), theme.tokens[name]]));
}

export function applyTheme(root: HTMLElement, theme: Theme): void {
  for (const [name, value] of Object.entries(themeCssVariables(theme))) {
    root.style.setProperty(name, value);
  }
  root.setAttribute("data-theme", theme.id);
}

// Runs in <head> before paint so a saved theme never flashes the default one.
// It reads the settings record directly because React hasn't loaded yet.
export function themeBootScript(themes: Theme[], settingsKey: string): string {
  const variables = Object.fromEntries(themes.map((theme) => [theme.id, themeCssVariables(theme)]));
  const json = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");
  return `(function(){try{var t=${json(variables)};var s=JSON.parse(localStorage.getItem(${json(settingsKey)})||"null");var id=s&&typeof s.themeId==="string"&&Object.prototype.hasOwnProperty.call(t,s.themeId)?s.themeId:null;if(!id)return;var r=document.documentElement,v=t[id];for(var k in v)r.style.setProperty(k,v[k]);r.setAttribute("data-theme",id)}catch(e){}})()`;
}
```

- [ ] **Step 10: Run the tests to verify they pass**

Run: `pnpm test tests/unit/lib/theme/theme.test.ts`
Expected: all tests pass.

- [ ] **Step 11: Commit**

```bash
git add lib/theme public/pieces tests/unit/lib/theme
git commit -m "feat: add theme tokens, built-in themes and piece skins"
```

---

### Task 12: Settings store

**Files:**
- Create: `lib/settings/types.ts`, `lib/settings/local-storage-store.ts`
- Test: `tests/unit/lib/settings/settings.test.ts`

**Interfaces:**
- Consumes: `Side`; `DEFAULT_THEME_ID`, `getTheme` from `@/lib/theme/themes`; `DEFAULT_SESSION_SIZE` from `@/lib/training/review`.
- Produces (`types.ts`):
  - `SETTINGS_KEY = "moechess:settings"`, `SESSION_SIZE_MIN = 5`, `SESSION_SIZE_MAX = 100`
  - `interface Settings { schemaVersion: 1; side: Side; sessionSize: number; themeId: string }`
  - `DEFAULT_SETTINGS`
  - `interface SettingsStore { load(): Settings; save(settings: Settings): void; available(): boolean }`
  - `parseSettings(text: string | null): Settings`
- Produces (`local-storage-store.ts`): `class LocalStorageSettingsStore implements SettingsStore` with `constructor(storage: Storage | null)`.

Settings are synchronous (unlike progress) because the theme must be known before first paint. A future account-backed store can cache the server copy and still satisfy this interface.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "vitest";
import { LocalStorageSettingsStore } from "@/lib/settings/local-storage-store";
import { DEFAULT_SETTINGS, SETTINGS_KEY, parseSettings } from "@/lib/settings/types";

describe("parseSettings", () => {
  test("defaults when nothing is saved or the data is unreadable", () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings("{oops")).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings("[]")).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS).toEqual({ schemaVersion: 1, side: "white", sessionSize: 20, themeId: "summer-sky" });
  });

  test("keeps valid fields and replaces invalid ones individually", () => {
    expect(parseSettings(JSON.stringify({ side: "black", sessionSize: 1000, themeId: "night-shift" })))
      .toEqual({ schemaVersion: 1, side: "black", sessionSize: 20, themeId: "night-shift" });
    expect(parseSettings(JSON.stringify({ side: "green", sessionSize: 30, themeId: "missing" })))
      .toEqual({ schemaVersion: 1, side: "white", sessionSize: 30, themeId: "summer-sky" });
    expect(parseSettings(JSON.stringify({ sessionSize: 12.5 })).sessionSize).toBe(20);
  });
});

describe("LocalStorageSettingsStore", () => {
  test("saves and reloads", () => {
    new LocalStorageSettingsStore(localStorage).save({ ...DEFAULT_SETTINGS, side: "black", themeId: "night-shift" });
    const loaded = new LocalStorageSettingsStore(localStorage).load();
    expect(loaded).toMatchObject({ side: "black", themeId: "night-shift" });
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY)!).themeId).toBe("night-shift");
  });

  test("keeps settings in memory when storage is blocked", () => {
    const blocked = {
      getItem: () => { throw new DOMException("blocked", "SecurityError"); },
      setItem: () => { throw new DOMException("blocked", "SecurityError"); },
    } as unknown as Storage;
    const store = new LocalStorageSettingsStore(blocked);
    expect(store.load()).toEqual(DEFAULT_SETTINGS);
    store.save({ ...DEFAULT_SETTINGS, sessionSize: 40 });
    expect(store.load().sessionSize).toBe(40);
    expect(store.available()).toBe(false);
  });

  test("works without any storage", () => {
    const store = new LocalStorageSettingsStore(null);
    store.save({ ...DEFAULT_SETTINGS, side: "black" });
    expect(store.load().side).toBe("black");
    expect(store.available()).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test tests/unit/lib/settings/settings.test.ts`
Expected: FAIL, cannot resolve `@/lib/settings/local-storage-store`.

- [ ] **Step 3: Create `lib/settings/types.ts`**

```ts
import type { Side } from "@/lib/chess/position";
import { DEFAULT_THEME_ID, getTheme } from "@/lib/theme/themes";
import { DEFAULT_SESSION_SIZE } from "@/lib/training/review";

export const SETTINGS_KEY = "moechess:settings";
export const SESSION_SIZE_MIN = 5;
export const SESSION_SIZE_MAX = 100;

export interface Settings {
  schemaVersion: 1;
  side: Side;
  sessionSize: number;
  themeId: string;
}

export const DEFAULT_SETTINGS: Settings = {
  schemaVersion: 1,
  side: "white",
  sessionSize: DEFAULT_SESSION_SIZE,
  themeId: DEFAULT_THEME_ID,
};

export interface SettingsStore {
  load(): Settings;
  save(settings: Settings): void;
  available(): boolean;
}

// Each field falls back on its own, so one bad value never resets the others.
export function parseSettings(text: string | null): Settings {
  let raw: Record<string, unknown> = {};
  try {
    const parsed: unknown = text ? JSON.parse(text) : {};
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) raw = parsed as Record<string, unknown>;
  } catch {
    raw = {};
  }
  const size = raw.sessionSize;
  return {
    schemaVersion: 1,
    side: raw.side === "black" || raw.side === "white" ? raw.side : DEFAULT_SETTINGS.side,
    sessionSize: Number.isInteger(size) && (size as number) >= SESSION_SIZE_MIN && (size as number) <= SESSION_SIZE_MAX
      ? (size as number)
      : DEFAULT_SETTINGS.sessionSize,
    themeId: typeof raw.themeId === "string" ? getTheme(raw.themeId).id : DEFAULT_SETTINGS.themeId,
  };
}
```

- [ ] **Step 4: Create `lib/settings/local-storage-store.ts`**

```ts
import { SETTINGS_KEY, parseSettings, type Settings, type SettingsStore } from "./types";

export class LocalStorageSettingsStore implements SettingsStore {
  private memory: Settings | null = null;
  private isAvailable = true;

  constructor(private readonly storage: Storage | null) {
    if (!storage) this.isAvailable = false;
  }

  load(): Settings {
    if (this.memory) return { ...this.memory };
    let text: string | null = null;
    if (this.storage) {
      try {
        text = this.storage.getItem(SETTINGS_KEY);
      } catch {
        this.isAvailable = false;
      }
    }
    this.memory = parseSettings(text);
    return { ...this.memory };
  }

  save(settings: Settings): void {
    this.memory = parseSettings(JSON.stringify(settings));
    if (!this.storage || !this.isAvailable) return;
    try {
      this.storage.setItem(SETTINGS_KEY, JSON.stringify(this.memory));
    } catch {
      this.isAvailable = false;
    }
  }

  available(): boolean {
    return this.isAvailable;
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test tests/unit/lib/settings/settings.test.ts`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add lib/settings tests/unit/lib/settings
git commit -m "feat: add settings store"
```

---

### Task 13: Board component

**Files:**
- Create: `lib/board/track.ts`, `components/board/Board.tsx`
- Test: `tests/unit/lib/board/track.test.ts`, `tests/unit/components/board/Board.test.tsx`

**Interfaces:**
- Consumes: from `@/lib/chess/position`: `applySan`, `legalTargets`, `moveFromSquares`, `needsPromotion`, `piecesOf`, `positionKey`, `turnOf`, `AppliedMove`, `PieceCode`, `Side`, `Square`. Also `Arrow`, `Brush`, `Highlight` from `@/lib/course/types`, and `defaultPieceUrl`, `getPieceSet`, `pieceUrl`, `PieceSet` from `@/lib/theme/skins`.
- Produces (`lib/board/track.ts`):
  - `interface TrackedPiece { id: string; square: Square; code: PieceCode }`
  - `squareXY(square, orientation): { x; y }`
  - `squareAt(x, y, orientation): Square`
  - `squareColor(square): "light" | "dark"`
  - `trackPieces(prev: TrackedPiece[], next: { square; code }[]): TrackedPiece[]`
- Produces (`components/board/Board.tsx`, client component):
  - `interface BoardFeedback { square: Square; state: "correct" | "mistake" | "hint" }`
  - `interface BoardProps { fen; orientation: Side; interactive: boolean; label: string; onMove?: (move: AppliedMove) => boolean; lastMove?; arrows?; highlights?; feedback?; pieceSet? }`
  - `Board(props)`
  - `onMove` returns `false` to reject a move: the piece appears on the target square for `--mc-duration-feedback`, then slides back.
- Stable hooks rendered: `.mc-board-wrap`, `.mc-board[data-orientation][data-interactive][data-state]`, `.mc-board-svg`, `.mc-square[data-square][data-color]`, `.mc-square-mark[data-mark="last-move|selected"]`, `.mc-highlight[data-brush]`, `.mc-feedback[data-state]`, `.mc-target`, `.mc-piece[data-piece][data-square]`, `.mc-arrow[data-brush]`, `.mc-board-grid`, `.mc-move-input`, `.mc-move-error`, `.mc-sr-only`.

Design notes:
- **Layers.** The SVG layer draws everything and is `aria-hidden`. A transparent 8×8 grid of `<button>`s on top handles clicks, drags, focus and screen-reader labels ("e2, white pawn").
- **Keyboard.** The grid uses a roving `tabIndex`, so arrow keys move between squares in the board's orientation and Enter or Space clicks. A small form below the board takes SAN typing.
- **Piece identity.** Pieces keep stable ids through `trackPieces`, so the CSS `transform` transition slides them between squares. Keeping the previous pieces uses React's "adjust state while rendering" pattern (a guarded `setState` during render). The React hooks lint rules accept it (checked while writing this plan).
- **Promotion.** Promotion always picks a queen. Opening courses don't reach promotions; a picker can come later.
- **Styles.** Board styles live in `app/globals.css` (Task 15), since Next.js imports global CSS from the root layout.

- [ ] **Step 1: Write the failing test for coordinates and tracking**

```ts
import { describe, expect, test } from "vitest";
import { START_FEN, applySan, piecesOf } from "@/lib/chess/position";
import { squareAt, squareColor, squareXY, trackPieces } from "@/lib/board/track";

const play = (...sans: string[]) => sans.reduce((fen, san) => applySan(fen, san)!.fenAfter, START_FEN);

describe("coordinates", () => {
  test("squareXY and squareAt are inverses for both orientations", () => {
    expect(squareXY("a1", "white")).toEqual({ x: 0, y: 7 });
    expect(squareXY("a1", "black")).toEqual({ x: 7, y: 0 });
    for (const orientation of ["white", "black"] as const) {
      expect(squareAt(squareXY("e4", orientation).x, squareXY("e4", orientation).y, orientation)).toBe("e4");
    }
  });

  test("square colours", () => {
    expect(squareColor("a1")).toBe("dark");
    expect(squareColor("h1")).toBe("light");
    expect(squareColor("e4")).toBe("light");
  });
});

describe("trackPieces", () => {
  test("gives every piece a unique id", () => {
    const pieces = trackPieces([], piecesOf(START_FEN));
    expect(new Set(pieces.map((p) => p.id)).size).toBe(32);
  });

  test("a moved piece keeps its id", () => {
    const start = trackPieces([], piecesOf(START_FEN));
    const after = trackPieces(start, piecesOf(play("e4")));
    const pawn = start.find((p) => p.square === "e2")!;
    expect(after.find((p) => p.square === "e4")!.id).toBe(pawn.id);
    expect(after.find((p) => p.square === "g1")).toBe(start.find((p) => p.square === "g1"));
  });

  test("captured pieces disappear and castling moves both king and rook", () => {
    let tracked = trackPieces([], piecesOf(START_FEN));
    const rook = tracked.find((p) => p.square === "h1")!;
    const king = tracked.find((p) => p.square === "e1")!;
    for (const fen of [play("e4", "d5"), play("e4", "d5", "exd5")]) tracked = trackPieces(tracked, piecesOf(fen));
    expect(tracked).toHaveLength(31);

    let castled = trackPieces([], piecesOf(START_FEN));
    for (const fen of [play("e4", "e5"), play("e4", "e5", "Nf3", "Nc6"), play("e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5"), play("e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "O-O")]) {
      castled = trackPieces(castled, piecesOf(fen));
    }
    expect(castled.find((p) => p.square === "g1")!.id).toBe(king.id);
    expect(castled.find((p) => p.square === "f1")!.id).toBe(rook.id);
  });

  test("a promoted piece gets a new id", () => {
    const before = trackPieces([], piecesOf("4k3/1P6/8/8/8/8/8/4K3 w - - 0 1"));
    const after = trackPieces(before, piecesOf(applySan("4k3/1P6/8/8/8/8/8/4K3 w - - 0 1", "b8=Q")!.fenAfter));
    const queen = after.find((p) => p.code === "wQ")!;
    expect(before.some((p) => p.id === queen.id)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test tests/unit/lib/board/track.test.ts`
Expected: FAIL, cannot resolve `@/lib/board/track`.

- [ ] **Step 3: Implement `lib/board/track.ts`**

```ts
import type { PieceCode, Side, Square } from "@/lib/chess/position";

export interface TrackedPiece {
  id: string;
  square: Square;
  code: PieceCode;
}

const FILES = "abcdefgh";

// Board coordinates in 0..7 with (0, 0) at the top-left from the viewer's side.
export function squareXY(square: Square, orientation: Side): { x: number; y: number } {
  const file = FILES.indexOf(square[0]);
  const rank = Number(square[1]) - 1;
  return orientation === "white" ? { x: file, y: 7 - rank } : { x: 7 - file, y: rank };
}

export function squareAt(x: number, y: number, orientation: Side): Square {
  const file = orientation === "white" ? x : 7 - x;
  const rank = orientation === "white" ? 7 - y : y;
  return `${FILES[file]}${rank + 1}`;
}

export function squareColor(square: Square): "light" | "dark" {
  return (FILES.indexOf(square[0]) + Number(square[1])) % 2 === 0 ? "light" : "dark";
}

function distance(a: Square, b: Square): number {
  return Math.max(Math.abs(FILES.indexOf(a[0]) - FILES.indexOf(b[0])), Math.abs(Number(a[1]) - Number(b[1])));
}

// Keeps a stable id for each piece across positions so the board can animate
// a piece sliding from its old square instead of popping in.
export function trackPieces(prev: TrackedPiece[], next: { square: Square; code: PieceCode }[]): TrackedPiece[] {
  let counter = prev.reduce((max, piece) => Math.max(max, Number(piece.id.split("#")[1]) || 0), 0);
  const stayed = (p: { square: Square; code: PieceCode }) =>
    prev.find((old) => old.square === p.square && old.code === p.code);
  const unmatched = prev.filter((old) => !next.some((p) => p.square === old.square && p.code === old.code));

  return next.map((piece) => {
    const same = stayed(piece);
    if (same) return same;
    const candidates = unmatched.filter((old) => old.code === piece.code);
    if (candidates.length > 0) {
      const nearest = candidates.reduce((best, old) =>
        distance(old.square, piece.square) < distance(best.square, piece.square) ? old : best);
      unmatched.splice(unmatched.indexOf(nearest), 1);
      return { ...nearest, square: piece.square };
    }
    counter += 1;
    return { id: `${piece.code}#${counter}`, ...piece };
  });
}
```

- [ ] **Step 4: Run the tracking tests to verify they pass**

Run: `pnpm test tests/unit/lib/board/track.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Write the failing Board test `tests/unit/components/board/Board.test.tsx`**

```tsx
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { Board } from "@/components/board/Board";
import { START_FEN, type AppliedMove } from "@/lib/chess/position";

const square = (name: string) => screen.getByRole("button", { name: new RegExp(`^${name},`) });

function setup(props: Partial<Parameters<typeof Board>[0]> = {}) {
  const onMove = vi.fn<(move: AppliedMove) => boolean>(() => true);
  const utils = render(
    <Board fen={START_FEN} orientation="white" interactive label="Training board" onMove={onMove} {...props} />,
  );
  return { onMove, ...utils };
}

describe("Board rendering", () => {
  test("renders 64 labelled squares and 32 pieces with stable hooks", () => {
    const { container } = setup();
    expect(screen.getAllByRole("button", { name: /^[a-h][1-8], / })).toHaveLength(64);
    expect(square("e2")).toHaveAccessibleName("e2, white pawn");
    expect(square("e4")).toHaveAccessibleName("e4, empty");
    expect(container.querySelectorAll(".mc-piece")).toHaveLength(32);
    expect(container.querySelector('.mc-piece[data-piece="wN"][data-square="g1"]')).not.toBeNull();
    expect(container.querySelectorAll('.mc-square[data-color="dark"]')).toHaveLength(32);
    expect(container.querySelector(".mc-board")).toHaveAttribute("data-orientation", "white");
  });

  test("black orientation puts h1 first", () => {
    setup({ orientation: "black" });
    expect(screen.getAllByRole("button", { name: /^[a-h][1-8], / })[0]).toHaveAccessibleName("h1, white rook");
  });

  test("arrows, highlights and feedback render with data hooks", () => {
    const { container } = setup({
      arrows: [{ from: "f1", to: "b5", brush: "G" }],
      highlights: [{ square: "e5", brush: "R" }],
      feedback: { square: "e4", state: "mistake" },
    });
    expect(container.querySelector('.mc-arrow[data-brush="G"]')).not.toBeNull();
    expect(container.querySelector('.mc-highlight[data-brush="R"]')).not.toBeNull();
    expect(container.querySelector('.mc-feedback[data-state="mistake"]')).not.toBeNull();
  });
});

describe("Board input", () => {
  test("click a piece, then a target square, to move", () => {
    const { onMove, container } = setup();
    fireEvent.click(square("e2"));
    expect(square("e2")).toHaveAttribute("aria-pressed", "true");
    expect(container.querySelectorAll(".mc-target")).toHaveLength(2);
    fireEvent.click(square("e4"));
    expect(onMove).toHaveBeenCalledWith(expect.objectContaining({ san: "e4", from: "e2", to: "e4" }));
  });

  test("the opponent's pieces can't be selected", () => {
    const { onMove } = setup();
    fireEvent.click(square("e7"));
    expect(square("e7")).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(square("e5"));
    expect(onMove).not.toHaveBeenCalled();
  });

  test("a non-interactive board ignores input", () => {
    const { onMove } = setup({ interactive: false });
    fireEvent.click(square("e2"));
    fireEvent.click(square("e4"));
    expect(onMove).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "Type a move" })).toBeDisabled();
  });

  test("drag from one square to another", () => {
    const { onMove } = setup();
    fireEvent.pointerDown(square("g1"));
    fireEvent.pointerUp(square("f3"));
    expect(onMove).toHaveBeenCalledWith(expect.objectContaining({ san: "Nf3" }));
  });

  test("type a move in SAN", async () => {
    const { onMove } = setup();
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: "Type a move" }), "Nf3{Enter}");
    expect(onMove).toHaveBeenCalledWith(expect.objectContaining({ san: "Nf3" }));
    expect(screen.getByRole("textbox", { name: "Type a move" })).toHaveValue("");
  });

  test("typing an illegal move explains what to fix", async () => {
    const { onMove } = setup();
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: "Type a move" }), "Ke2{Enter}");
    expect(onMove).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Ke2 isn't a legal move here. Check the piece letter and the square.");
  });

  test("arrow keys move focus across squares in board orientation", async () => {
    setup();
    const user = userEvent.setup();
    square("e2").focus();
    await user.keyboard("{ArrowUp}");
    expect(square("e3")).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(square("f3")).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(square("f3")).toHaveAttribute("tabindex", "0");
  });

  test("promotion moves promote to a queen", () => {
    const { onMove } = setup({ fen: "4k3/1P6/8/8/8/8/8/4K3 w - - 0 1" });
    fireEvent.click(square("b7"));
    fireEvent.click(square("b8"));
    expect(onMove).toHaveBeenCalledWith(expect.objectContaining({ san: "b8=Q+" }));
  });

  test("a rejected move shows briefly and then slides back", () => {
    vi.useFakeTimers();
    try {
      const onMove = vi.fn(() => false);
      const { container } = render(
        <Board fen={START_FEN} orientation="white" interactive label="Training board" onMove={onMove} />,
      );
      fireEvent.click(square("e2"));
      fireEvent.click(square("e4"));
      expect(container.querySelector('.mc-piece[data-piece="wP"][data-square="e4"]')).not.toBeNull();
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(container.querySelector('.mc-piece[data-piece="wP"][data-square="e4"]')).toBeNull();
      expect(container.querySelector('.mc-piece[data-piece="wP"][data-square="e2"]')).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  test("announces played moves to screen readers", () => {
    setup();
    fireEvent.click(square("e2"));
    fireEvent.click(square("e4"));
    expect(screen.getByText("You played e4")).toHaveAttribute("aria-live", "polite");
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm test tests/unit/components/board/Board.test.tsx`
Expected: FAIL, cannot resolve `@/components/board/Board`.

- [ ] **Step 7: Implement `components/board/Board.tsx`**

```tsx
"use client";

import {
  useEffect, useId, useRef, useState,
  type FormEvent, type KeyboardEvent, type PointerEvent,
} from "react";
import {
  applySan, legalTargets, moveFromSquares, needsPromotion, piecesOf, positionKey, turnOf,
  type AppliedMove, type PieceCode, type Side, type Square,
} from "@/lib/chess/position";
import { squareAt, squareColor, squareXY, trackPieces } from "@/lib/board/track";
import type { Arrow, Brush, Highlight } from "@/lib/course/types";
import { defaultPieceUrl, getPieceSet, pieceUrl, type PieceSet } from "@/lib/theme/skins";

export interface BoardFeedback {
  square: Square;
  state: "correct" | "mistake" | "hint";
}

export interface BoardProps {
  fen: string;
  orientation: Side;
  interactive: boolean;
  label: string;
  // Return false to reject the move: the piece shows on the new square briefly, then slides back.
  onMove?: (move: AppliedMove) => boolean;
  lastMove?: { from: Square; to: Square } | null;
  arrows?: Arrow[];
  highlights?: Highlight[];
  feedback?: BoardFeedback | null;
  pieceSet?: PieceSet;
}

const PIECE_NAMES: Record<string, string> = {
  K: "king", Q: "queen", R: "rook", B: "bishop", N: "knight", P: "pawn",
};
const BRUSHES: Brush[] = ["G", "R", "Y", "B"];
const FEEDBACK_FILL = { correct: "var(--mc-correct)", mistake: "var(--mc-mistake)", hint: "var(--mc-accent-course)" };
const ARROW_KEYS: Record<string, [number, number]> = {
  ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
};

// Mirrors --mc-duration-feedback so a rejected move slides back when the flash ends.
function feedbackDuration(): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--mc-duration-feedback").trim();
  const ms = raw.endsWith("ms") ? parseFloat(raw) : raw.endsWith("s") ? parseFloat(raw) * 1000 : NaN;
  return Number.isFinite(ms) ? ms : 420;
}

function describePiece(code: PieceCode | undefined): string {
  return code ? `${code[0] === "w" ? "white" : "black"} ${PIECE_NAMES[code[1]]}` : "empty";
}

export function Board({
  fen, orientation, interactive, label, onMove,
  lastMove = null, arrows = [], highlights = [], feedback = null, pieceSet,
}: BoardProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const set = pieceSet ?? getPieceSet(null);

  const [selection, setSelection] = useState<{ fen: string; square: Square } | null>(null);
  const [cursor, setCursor] = useState<Square>(orientation === "white" ? "e2" : "e7");
  const [rejectedFen, setRejectedFen] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [typed, setTyped] = useState("");
  const [typedError, setTypedError] = useState<string | null>(null);

  const dragFrom = useRef<Square | null>(null);
  const rejectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const buttons = useRef(new Map<Square, HTMLButtonElement>());

  const displayFen = rejectedFen ?? fen;
  const [tracked, setTracked] = useState(() => ({ fen: displayFen, pieces: trackPieces([], piecesOf(displayFen)) }));
  if (tracked.fen !== displayFen) {
    setTracked({ fen: displayFen, pieces: trackPieces(tracked.pieces, piecesOf(displayFen)) });
  }

  useEffect(() => () => {
    if (rejectTimer.current) clearTimeout(rejectTimer.current);
  }, []);

  const selected = selection && selection.fen === fen ? selection.square : null;
  const targets = selected ? legalTargets(fen, selected) : [];
  const pieceAt = new Map(piecesOf(displayFen).map((p) => [p.square, p.code]));
  const moverColor = turnOf(positionKey(fen)) === "white" ? "w" : "b";
  const isOwnPiece = (square: Square) => pieceAt.get(square)?.[0] === moverColor;
  const squares = Array.from({ length: 64 }, (_, i) => squareAt(i % 8, Math.floor(i / 8), orientation));

  function submit(move: AppliedMove) {
    setSelection(null);
    const accepted = onMove ? onMove(move) : true;
    if (accepted === false) {
      if (rejectTimer.current) clearTimeout(rejectTimer.current);
      setRejectedFen(move.fenAfter);
      rejectTimer.current = setTimeout(() => setRejectedFen(null), feedbackDuration());
    }
    setAnnouncement(`You played ${move.san}`);
  }

  function tryMove(from: Square, to: Square) {
    const move = moveFromSquares(fen, from, to, needsPromotion(fen, from, to) ? "q" : undefined);
    if (move) submit(move);
  }

  function handleClick(square: Square) {
    if (!interactive) return;
    setCursor(square);
    if (selected && targets.includes(square)) {
      tryMove(selected, square);
    } else if (isOwnPiece(square) && selected !== square) {
      setSelection({ fen, square });
    } else {
      setSelection(null);
    }
  }

  function handlePointerDown(square: Square) {
    dragFrom.current = interactive && isOwnPiece(square) ? square : null;
  }

  function handlePointerUp(event: PointerEvent<HTMLButtonElement>) {
    const from = dragFrom.current;
    dragFrom.current = null;
    if (!from) return;
    // Touch pointers stay captured by the starting square, so find what is under the finger.
    const hit = typeof document.elementFromPoint === "function"
      ? document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-square]")
      : null;
    const to = (hit ?? event.currentTarget).dataset.square;
    if (to && to !== from && legalTargets(fen, from).includes(to)) tryMove(from, to);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const delta = ARROW_KEYS[event.key];
    if (!delta) return;
    event.preventDefault();
    const { x, y } = squareXY(cursor, orientation);
    const next = squareAt(Math.min(7, Math.max(0, x + delta[0])), Math.min(7, Math.max(0, y + delta[1])), orientation);
    setCursor(next);
    buttons.current.get(next)?.focus();
  }

  function handleTypedMove(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = typed.trim();
    if (!interactive || value === "") return;
    const move = applySan(fen, value);
    if (!move) {
      setTypedError(`${value} isn't a legal move here. Check the piece letter and the square.`);
      return;
    }
    setTypedError(null);
    setTyped("");
    submit(move);
  }

  const marks = [
    ...(lastMove ? [lastMove.from, lastMove.to].map((square) => ({ square, kind: "last-move" })) : []),
    ...(selected ? [{ square: selected, kind: "selected" }] : []),
  ];

  return (
    <div className="mc-board-wrap">
      <div
        className="mc-board"
        data-orientation={orientation}
        data-interactive={interactive}
        data-state={feedback?.state}
      >
        <svg className="mc-board-svg" viewBox="0 0 8 8" aria-hidden="true">
          <defs>
            {BRUSHES.map((brush) => (
              <marker
                key={brush}
                id={`${uid}-head-${brush}`}
                viewBox="0 0 10 10"
                refX="5"
                refY="5"
                markerWidth="3"
                markerHeight="3"
                orient="auto-start-reverse"
              >
                <path d="M0 0 L10 5 L0 10 z" fill={`var(--mc-brush-${brush.toLowerCase()})`} />
              </marker>
            ))}
          </defs>

          {squares.map((square) => {
            const { x, y } = squareXY(square, orientation);
            const color = squareColor(square);
            return (
              <rect
                key={square}
                className="mc-square"
                data-square={square}
                data-color={color}
                x={x}
                y={y}
                width={1}
                height={1}
                fill={`var(--mc-board-${color})`}
              />
            );
          })}

          {marks.map(({ square, kind }) => {
            const { x, y } = squareXY(square, orientation);
            return <rect key={`${kind}-${square}`} className="mc-square-mark" data-mark={kind} x={x} y={y} width={1} height={1} />;
          })}

          {highlights.map(({ square, brush }) => {
            const { x, y } = squareXY(square, orientation);
            return (
              <rect
                key={`hl-${square}`}
                className="mc-highlight"
                data-brush={brush}
                x={x}
                y={y}
                width={1}
                height={1}
                fill={`var(--mc-brush-${brush.toLowerCase()})`}
              />
            );
          })}

          {feedback && (() => {
            const { x, y } = squareXY(feedback.square, orientation);
            return (
              <rect
                key={`${feedback.state}-${feedback.square}-${fen}`}
                className="mc-feedback"
                data-state={feedback.state}
                x={x}
                y={y}
                width={1}
                height={1}
                fill={FEEDBACK_FILL[feedback.state]}
              />
            );
          })()}

          {targets.map((square) => {
            const { x, y } = squareXY(square, orientation);
            return <circle key={`t-${square}`} className="mc-target" cx={x + 0.5} cy={y + 0.5} r={0.14} />;
          })}

          {tracked.pieces.map((piece) => {
            const { x, y } = squareXY(piece.square, orientation);
            return (
              <image
                key={piece.id}
                className="mc-piece"
                data-piece={piece.code}
                data-square={piece.square}
                href={pieceUrl(set, piece.code)}
                width={1}
                height={1}
                style={{ transform: `translate(${x}px, ${y}px)` }}
                onError={(event) => {
                  const fallback = defaultPieceUrl(piece.code);
                  if (event.currentTarget.getAttribute("href") !== fallback) {
                    event.currentTarget.setAttribute("href", fallback);
                  }
                }}
              />
            );
          })}

          {arrows.map((arrow, i) => {
            const from = squareXY(arrow.from, orientation);
            const to = squareXY(arrow.to, orientation);
            const dx = to.x - from.x;
            const dy = to.y - from.y;
            const length = Math.hypot(dx, dy) || 1;
            return (
              <line
                key={`${arrow.from}-${arrow.to}-${i}`}
                className="mc-arrow"
                data-brush={arrow.brush}
                x1={from.x + 0.5}
                y1={from.y + 0.5}
                x2={to.x + 0.5 - (dx / length) * 0.3}
                y2={to.y + 0.5 - (dy / length) * 0.3}
                stroke={`var(--mc-brush-${arrow.brush.toLowerCase()})`}
                markerEnd={`url(#${uid}-head-${arrow.brush})`}
              />
            );
          })}
        </svg>

        <div className="mc-board-grid" role="group" aria-label={label} onKeyDown={handleKeyDown}>
          {squares.map((square) => (
            <button
              key={square}
              ref={(element) => {
                if (element) buttons.current.set(square, element);
                else buttons.current.delete(square);
              }}
              type="button"
              data-square={square}
              tabIndex={square === cursor ? 0 : -1}
              aria-label={`${square}, ${describePiece(pieceAt.get(square))}`}
              aria-pressed={selected === square}
              aria-disabled={!interactive}
              onClick={() => handleClick(square)}
              onPointerDown={() => handlePointerDown(square)}
              onPointerUp={handlePointerUp}
            />
          ))}
        </div>
      </div>

      <form className="mc-move-input" onSubmit={handleTypedMove}>
        <label htmlFor={`${uid}-move`}>Type a move</label>
        <input
          id={`${uid}-move`}
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          placeholder="Nf3"
          autoComplete="off"
          spellCheck={false}
          disabled={!interactive}
          aria-invalid={typedError !== null}
          aria-describedby={typedError ? `${uid}-move-error` : undefined}
        />
        <button type="submit" disabled={!interactive}>Play</button>
        {typedError && <p id={`${uid}-move-error`} className="mc-move-error" role="alert">{typedError}</p>}
      </form>

      <p className="mc-sr-only" aria-live="polite">{announcement}</p>
    </div>
  );
}
```

- [ ] **Step 8: Run the Board tests, typecheck and lint**

Run: `pnpm test tests/unit/components/board tests/unit/lib/board && pnpm typecheck && pnpm lint`
Expected: all tests pass; no type errors; no lint errors.

- [ ] **Step 9: Commit**

```bash
git add lib/board components/board tests/unit/lib/board tests/unit/components/board
git commit -m "feat: add accessible SVG board with click, drag and typed moves"
```

---

### Task 14: Dialogue box

**Files:**
- Create: `components/hooks/usePrefersReducedMotion.ts`, `components/dialogue/Dialogue.tsx`
- Test: `tests/unit/components/dialogue/Dialogue.test.tsx`

**Interfaces:**
- Produces:
  - `usePrefersReducedMotion(): boolean` (uses `useSyncExternalStore`; `false` on the server)
  - `interface DialogueProps { speaker: string; text: string | null; source?: string; emptyText?: string }`
  - `Dialogue(props)` (client component)
- Stable hooks rendered:
  - `.mc-dialogue[data-state="typing|complete"]`
  - `.mc-dialogue-nametag`, `.mc-dialogue-body`, `.mc-dialogue-text`, `.mc-dialogue-empty`
  - `.mc-dialogue-footer`, `.mc-dialogue-source`, `.mc-dialogue-skip`

Behaviour (spec §8):
- **Typing.** Text types in two characters every 24 ms. Clicking the text, or the "Show all" button, completes it.
- **Screen readers** get the full text at once through a polite live region, and the typed copy is `aria-hidden`.
- **Reduced motion** skips typing entirely.
- **New text** restarts typing, using the same "adjust state while rendering" pattern as the board.
- **Speaker.** The `speaker` name tag reads "Course" for now; sub-project 4's companion will pass its own name.

- [ ] **Step 1: Write the failing test**

```tsx
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Dialogue } from "@/components/dialogue/Dialogue";

const TEXT = "The Berlin Defence. Black counterattacks e4 instead of chasing the bishop.";

function mockReducedMotion(matches: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }));
}

const typed = (container: HTMLElement) => container.querySelector(".mc-dialogue-text")!.textContent;

describe("Dialogue", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockReducedMotion(false);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("shows the speaker name tag and source", () => {
    render(<Dialogue speaker="Course" text={TEXT} source="Wikibooks" />);
    expect(screen.getByText("Course")).toHaveClass("mc-dialogue-nametag");
    expect(screen.getByText("Source: Wikibooks")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Commentary" })).toHaveAttribute("data-state", "typing");
  });

  test("types the text in over time", () => {
    const { container } = render(<Dialogue speaker="Course" text={TEXT} />);
    expect(typed(container)).toBe("");
    act(() => {
      vi.advanceTimersByTime(24 * 5);
    });
    expect(typed(container)).toBe(TEXT.slice(0, 10));
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(typed(container)).toBe(TEXT);
    expect(screen.queryByRole("button", { name: "Show all" })).toBeNull();
  });

  test("screen readers get the full text immediately", () => {
    render(<Dialogue speaker="Course" text={TEXT} />);
    expect(screen.getByText(TEXT)).toHaveAttribute("aria-live", "polite");
  });

  test("Show all completes the text", () => {
    const { container } = render(<Dialogue speaker="Course" text={TEXT} />);
    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    expect(typed(container)).toBe(TEXT);
    expect(screen.getByRole("region", { name: "Commentary" })).toHaveAttribute("data-state", "complete");
  });

  test("new text starts typing again", () => {
    const { container, rerender } = render(<Dialogue speaker="Course" text={TEXT} />);
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    rerender(<Dialogue speaker="Course" text="Main line." />);
    expect(typed(container)).toBe("");
  });

  test("reduced motion shows everything at once", () => {
    mockReducedMotion(true);
    const { container } = render(<Dialogue speaker="Course" text={TEXT} />);
    expect(typed(container)).toBe(TEXT);
  });

  test("an empty note says so", () => {
    render(<Dialogue speaker="Course" text={null} />);
    expect(screen.getByText("No notes for this move.")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test tests/unit/components/dialogue`
Expected: FAIL, cannot resolve `@/components/dialogue/Dialogue`.

- [ ] **Step 3: Create `components/hooks/usePrefersReducedMotion.ts`**

```ts
"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function getSnapshot(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(QUERY).matches;
}

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
```

- [ ] **Step 4: Create `components/dialogue/Dialogue.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { usePrefersReducedMotion } from "@/components/hooks/usePrefersReducedMotion";

export interface DialogueProps {
  speaker: string;
  text: string | null;
  source?: string;
  emptyText?: string;
}

const CHARS_PER_TICK = 2;
const TICK_MS = 24;

// Visual-novel style commentary box. The companion (sub-project 4) will take
// over `speaker` and feed the same text.
export function Dialogue({ speaker, text, source, emptyText = "No notes for this move." }: DialogueProps) {
  const reducedMotion = usePrefersReducedMotion();
  const fullText = text ?? "";
  const [typing, setTyping] = useState({ text: fullText, shown: 0 });
  if (typing.text !== fullText) setTyping({ text: fullText, shown: 0 });

  const shown = reducedMotion ? fullText.length : Math.min(typing.shown, fullText.length);
  const done = shown >= fullText.length;

  useEffect(() => {
    if (reducedMotion || done) return;
    const timer = setInterval(() => {
      setTyping((current) => ({ ...current, shown: current.shown + CHARS_PER_TICK }));
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [reducedMotion, done, fullText]);

  const showAll = () => setTyping({ text: fullText, shown: fullText.length });

  return (
    <section className="mc-dialogue" aria-label="Commentary" data-state={done ? "complete" : "typing"}>
      <p className="mc-dialogue-nametag">{speaker}</p>
      {text ? (
        <div className="mc-dialogue-body" onClick={done ? undefined : showAll}>
          <p className="mc-dialogue-text" aria-hidden="true">
            {fullText.slice(0, shown)}
          </p>
          <p className="mc-sr-only" aria-live="polite">{fullText}</p>
        </div>
      ) : (
        <p className="mc-dialogue-text mc-dialogue-empty">{emptyText}</p>
      )}
      <div className="mc-dialogue-footer">
        {source && <p className="mc-dialogue-source">Source: {source}</p>}
        {!done && (
          <button type="button" className="mc-dialogue-skip" onClick={showAll}>
            Show all
          </button>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Run the tests and lint**

Run: `pnpm test tests/unit/components/dialogue && pnpm lint`
Expected: all tests pass; no lint errors.

- [ ] **Step 6: Commit**

```bash
git add components/hooks components/dialogue tests/unit/components/dialogue
git commit -m "feat: add visual-novel dialogue box for commentary"
```

---

### Task 15: Branch map

**Files:**
- Create: `lib/course/labels.ts`, `lib/branch-map/layout.ts`, `components/branch-map/BranchMap.tsx`
- Test: `tests/unit/lib/course/labels.test.ts`, `tests/unit/lib/branch-map/layout.test.ts`, `tests/unit/components/branch-map/BranchMap.test.tsx`

**Interfaces:**
- Consumes: `CourseTree`, `Commentary` from `@/lib/course/types`.
- Produces (`lib/course/labels.ts`):
  - `moveNumberLabel(fenAfter: string, san: string): string` ("1. e4", "1... e5")
  - `commentarySourceLabel(source: Commentary["source"]): string`
- Produces (`lib/branch-map/layout.ts`):
  - `interface MapNode { id; nodeId; kind: "move" | "collapsed"; x; y; san; lineIds; label?; hiddenCount? }`
  - `interface MapEdge { from; to; lineIds }`
  - `interface MapLayout { nodes; edges; lanes; depth }`
  - `interface LayoutOptions { currentNodeId?; expanded?: ReadonlySet<string>; collapseDepth? }`
  - `DEFAULT_COLLAPSE_DEPTH = 32`
  - `stackLabels(positions: number[], gap: number): number[]`
  - `layoutBranchMap(tree, options?): MapLayout`
- Produces (`components/branch-map/BranchMap.tsx`):
  - `interface BranchMapProps { tree; currentNodeId; learnedLineIds: ReadonlySet<string>; dueNodeIds: ReadonlySet<string>; onSelect(nodeId); stampLineId?; collapseDepth? }`
  - `BranchMap(props)`
- Stable hooks rendered:
  - `.mc-branch-map`, `.mc-branch-map-canvas`, `.mc-branch-map-svg`
  - `.mc-branch[data-state="learned|unlearned"]`
  - `.mc-station[data-kind][data-role="stop|pass"][data-state="current|due|learned|unlearned"]`
  - `.mc-branch-leader`, `.mc-branch-label[data-state]`
  - `.mc-branch-station-button[data-kind]`
  - `.mc-learned-stamp`

Design (spec §8):
- **Layout.** The map is a vertical transit map: plies run top to bottom and each branch takes its own lane. The trunk (1.e4 e5 2.Nf3 Nc6 3.Bb5) is one straight route.
- **Stations.** Full "stops" mark the start, branch points, line ends, the current position and due positions. Every other ply is a small pass-through dot, which keeps the map calm.
- **Line names.** Names sit in a column to the right, pushed apart with `stackLabels` when several lines end at the same depth, with a dotted leader back to each line's last station.
- **Collapsing.** Past `collapseDepth` (32 plies by default) a branch folds into a "Show N more lines" stub, unless it is on the current path or was opened. The compact Ruy Lopez (up to 28 plies) never collapses; bigger future courses stay readable.
- **Accessibility.** The SVG is `aria-hidden`. Each station is a real `<button>` placed over its dot, with an accessible name like "3... Nf6, due for review".
- **Celebration.** `stampLineId` shows the single celebration: a "Learned!" stamp on the line's name.

- [ ] **Step 1: Write the failing label test `tests/unit/lib/course/labels.test.ts`**

```ts
import { expect, test } from "vitest";
import { START_FEN, applySan } from "@/lib/chess/position";
import { commentarySourceLabel, moveNumberLabel } from "@/lib/course/labels";

test("move number labels", () => {
  const e4 = applySan(START_FEN, "e4")!;
  const e5 = applySan(e4.fenAfter, "e5")!;
  const nf3 = applySan(e5.fenAfter, "Nf3")!;
  expect(moveNumberLabel(e4.fenAfter, "e4")).toBe("1. e4");
  expect(moveNumberLabel(e5.fenAfter, "e5")).toBe("1... e5");
  expect(moveNumberLabel(nf3.fenAfter, "Nf3")).toBe("2. Nf3");
});

test("commentary source labels", () => {
  expect(commentarySourceLabel("wikibooks")).toBe("Wikibooks");
  expect(commentarySourceLabel("sample")).toBe("Moechess sample notes");
});
```

- [ ] **Step 2: Implement `lib/course/labels.ts` and run the test**

```ts
import type { Commentary } from "./types";

// "1. e4" for White's moves, "1... e5" for Black's, from the FEN after the move.
export function moveNumberLabel(fenAfter: string, san: string): string {
  const [, turn, , , , full] = fenAfter.split(" ");
  return turn === "b" ? `${full}. ${san}` : `${Number(full) - 1}... ${san}`;
}

const SOURCE_LABELS: Record<Commentary["source"], string> = {
  wikibooks: "Wikibooks",
  generated: "Generated from game data",
  sample: "Moechess sample notes",
};

export function commentarySourceLabel(source: Commentary["source"]): string {
  return SOURCE_LABELS[source];
}
```

Run: `pnpm test tests/unit/lib/course/labels.test.ts`
Expected: PASS (run it once before creating the file to see it fail).

- [ ] **Step 3: Write the failing layout test `tests/unit/lib/branch-map/layout.test.ts`**

```ts
import { describe, expect, test } from "vitest";
import { buildCourseTree, parsePgnFile } from "@/lib/course/build-tree";
import type { CourseMeta } from "@/lib/course/types";
import { layoutBranchMap, stackLabels } from "@/lib/branch-map/layout";

const meta: CourseMeta = { slug: "ruy", name: "Ruy", eco: [], mainSide: "white", credits: [], contentLicense: "CC0" };
const tree = buildCourseTree(meta, parsePgnFile("ruy/lines.pgn", `[LineId "berlin"]
[LineName "Berlin"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 Nf6 4. O-O *

[LineId "morphy"]
[LineName "Morphy"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 (3... d6) 4. Ba4 *
`));

const byId = (layout: ReturnType<typeof layoutBranchMap>, id: string) => layout.nodes.find((n) => n.id === id)!;

describe("stackLabels", () => {
  test("keeps labels apart without reordering them", () => {
    expect(stackLabels([100, 100, 100], 16)).toEqual([100, 116, 132]);
    expect(stackLabels([200, 50, 58], 16)).toEqual([200, 50, 66]);
    expect(stackLabels([], 16)).toEqual([]);
  });
});

describe("layoutBranchMap", () => {
  test("the trunk shares a lane and each branch gets its own", () => {
    const layout = layoutBranchMap(tree);
    expect(layout.lanes).toBe(3);
    expect(layout.depth).toBe(7);
    expect(byId(layout, "root")).toMatchObject({ x: 0, y: 0, san: null, lineIds: ["berlin", "morphy"] });
    expect(byId(layout, "e4 e5 Nf3 Nc6 Bb5")).toMatchObject({ x: 0, y: 5 });
    expect(byId(layout, "e4 e5 Nf3 Nc6 Bb5 Nf6")).toMatchObject({ x: 0, y: 6, lineIds: ["berlin"] });
    expect(byId(layout, "e4 e5 Nf3 Nc6 Bb5 a6")).toMatchObject({ x: 1, y: 6, lineIds: ["morphy"] });
    expect(byId(layout, "e4 e5 Nf3 Nc6 Bb5 d6")).toMatchObject({ x: 2, y: 6, lineIds: [] });
  });

  test("line names label the last move of each line", () => {
    const layout = layoutBranchMap(tree);
    expect(byId(layout, "e4 e5 Nf3 Nc6 Bb5 Nf6 O-O").label).toBe("Berlin");
    expect(byId(layout, "e4 e5 Nf3 Nc6 Bb5 a6 Ba4").label).toBe("Morphy");
    expect(byId(layout, "e4 e5 Nf3 Nc6 Bb5 d6").label).toBeUndefined();
  });

  test("edges connect every visible parent and child, carrying their lines", () => {
    const layout = layoutBranchMap(tree);
    expect(layout.edges).toHaveLength(layout.nodes.length - 1);
    expect(layout.edges).toContainEqual({ from: "e4 e5 Nf3 Nc6 Bb5", to: "e4 e5 Nf3 Nc6 Bb5 a6", lineIds: ["morphy"] });
  });

  test("deep branches collapse into a stub", () => {
    const layout = layoutBranchMap(tree, { collapseDepth: 3 });
    expect(layout.nodes.some((n) => n.id === "e4 e5 Nf3 Nc6")).toBe(false);
    expect(byId(layout, "e4 e5 Nf3::more")).toMatchObject({
      kind: "collapsed", nodeId: "e4 e5 Nf3", y: 4, hiddenCount: 2, lineIds: ["berlin", "morphy"],
    });
    expect(layout.lanes).toBe(1);
  });

  test("the current path and expanded nodes stay open", () => {
    const current = "e4 e5 Nf3 Nc6 Bb5 a6";
    const layout = layoutBranchMap(tree, { collapseDepth: 3, currentNodeId: current });
    expect(byId(layout, current)).toMatchObject({ kind: "move", y: 6 });
    expect(byId(layout, "e4 e5 Nf3 Nc6 Bb5 a6 Ba4").kind).toBe("move");
    expect(byId(layout, "e4 e5 Nf3 Nc6 Bb5 Nf6::more").hiddenCount).toBe(1);

    const opened = layoutBranchMap(tree, {
      collapseDepth: 3, currentNodeId: current, expanded: new Set(["e4 e5 Nf3 Nc6 Bb5 Nf6"]),
    });
    expect(byId(opened, "e4 e5 Nf3 Nc6 Bb5 Nf6 O-O").kind).toBe("move");
    expect(opened.nodes.some((n) => n.kind === "collapsed")).toBe(false);
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `pnpm test tests/unit/lib/branch-map`
Expected: FAIL, cannot resolve `@/lib/branch-map/layout`.

- [ ] **Step 5: Implement `lib/branch-map/layout.ts`**

```ts
import type { CourseTree } from "@/lib/course/types";

export interface MapNode {
  id: string; // course node id, or `${parentId}::more` for a collapsed stub
  nodeId: string; // the course node it stands for (the parent for stubs)
  kind: "move" | "collapsed";
  x: number; // lane
  y: number; // ply depth
  san: string | null;
  lineIds: string[];
  label?: string; // line names ending at this node
  hiddenCount?: number; // stubs only: lines hidden under this branch
}

export interface MapEdge {
  from: string;
  to: string;
  lineIds: string[];
}

export interface MapLayout {
  nodes: MapNode[];
  edges: MapEdge[];
  lanes: number;
  depth: number;
}

export interface LayoutOptions {
  currentNodeId?: string;
  expanded?: ReadonlySet<string>;
  collapseDepth?: number;
}

export const DEFAULT_COLLAPSE_DEPTH = 32;

// Pushes label positions down so no two are closer than `gap`, keeping input order.
export function stackLabels(positions: number[], gap: number): number[] {
  const order = positions.map((position, index) => ({ position, index })).sort((a, b) => a.position - b.position);
  const result = new Array<number>(positions.length);
  let previous = -Infinity;
  for (const { position, index } of order) {
    previous = Math.max(position, previous + gap);
    result[index] = previous;
  }
  return result;
}

// Vertical transit map: moves run top to bottom, each branch takes its own lane.
// Past `collapseDepth`, a branch folds into one stub unless it is on the current
// path or the learner opened it.
export function layoutBranchMap(tree: CourseTree, options: LayoutOptions = {}): MapLayout {
  const collapseDepth = options.collapseDepth ?? DEFAULT_COLLAPSE_DEPTH;
  const expanded = options.expanded ?? new Set<string>();

  const linesByNode = new Map<string, string[]>([[tree.rootId, tree.lines.map((l) => l.id)]]);
  const labels = new Map<string, string[]>();
  for (const line of tree.lines) {
    for (const id of line.nodeIds) linesByNode.set(id, [...(linesByNode.get(id) ?? []), line.id]);
    const last = line.nodeIds.at(-1);
    if (last) labels.set(last, [...(labels.get(last) ?? []), line.name]);
  }

  const onPath = new Set<string>();
  for (let id: string | null | undefined = options.currentNodeId; id; id = tree.nodes[id]?.parentId) onPath.add(id);

  const nodes: MapNode[] = [];
  const edges: MapEdge[] = [];
  let lanes = 0;
  let depth = 0;

  const place = (id: string, y: number): number => {
    const node = tree.nodes[id];
    const open = onPath.has(id) || expanded.has(id);
    const visibleChildren = node.children.filter(() => y + 1 <= collapseDepth || open);
    const hiddenChildren = node.children.filter((child) => !visibleChildren.includes(child));

    let lane = -1;
    for (const child of visibleChildren) {
      const childLane = place(child, y + 1);
      if (lane === -1) lane = childLane;
      edges.push({ from: id, to: child, lineIds: linesByNode.get(child) ?? [] });
    }

    if (hiddenChildren.length > 0) {
      const hiddenLines = [...new Set(hiddenChildren.flatMap((child) => linesByNode.get(child) ?? []))];
      const stubLane = lanes++;
      if (lane === -1) lane = stubLane;
      const stubId = `${id}::more`;
      nodes.push({
        id: stubId, nodeId: id, kind: "collapsed", x: stubLane, y: y + 1, san: null,
        lineIds: hiddenLines, hiddenCount: hiddenLines.length,
      });
      edges.push({ from: id, to: stubId, lineIds: hiddenLines });
      depth = Math.max(depth, y + 1);
    }

    if (lane === -1) lane = lanes++;
    const label = labels.get(id)?.join(" / ");
    nodes.push({
      id, nodeId: id, kind: "move", x: lane, y, san: node.san,
      lineIds: linesByNode.get(id) ?? [], ...(label ? { label } : {}),
    });
    depth = Math.max(depth, y);
    return lane;
  };

  place(tree.rootId, 0);
  nodes.sort((a, b) => a.y - b.y || a.x - b.x);
  return { nodes, edges, lanes, depth };
}
```

- [ ] **Step 6: Run the layout tests to verify they pass**

Run: `pnpm test tests/unit/lib/branch-map`
Expected: all tests pass.

- [ ] **Step 7: Write the failing component test `tests/unit/components/branch-map/BranchMap.test.tsx`**

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { BranchMap } from "@/components/branch-map/BranchMap";
import { buildCourseTree, parsePgnFile } from "@/lib/course/build-tree";
import type { CourseMeta } from "@/lib/course/types";

const meta: CourseMeta = { slug: "ruy", name: "Ruy Lopez", eco: [], mainSide: "white", credits: [], contentLicense: "CC0" };
const tree = buildCourseTree(meta, parsePgnFile("ruy/lines.pgn", `[LineId "berlin"]
[LineName "Berlin"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 Nf6 4. O-O *

[LineId "morphy"]
[LineName "Morphy"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 *
`));

function setup(props: Partial<Parameters<typeof BranchMap>[0]> = {}) {
  const onSelect = vi.fn();
  const utils = render(
    <BranchMap
      tree={tree}
      currentNodeId="e4 e5 Nf3"
      learnedLineIds={new Set(["berlin"])}
      dueNodeIds={new Set(["e4 e5 Nf3 Nc6 Bb5 Nf6"])}
      onSelect={onSelect}
      {...props}
    />,
  );
  return { onSelect, ...utils };
}

describe("BranchMap", () => {
  test("labels stations with move numbers and line names", () => {
    setup();
    expect(screen.getByRole("navigation", { name: "Ruy Lopez lines" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2... Nc6" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "4. O-O, Berlin" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2. Nf3" })).toHaveAttribute("aria-current", "step");
  });

  test("clicking a station selects that position", () => {
    const { onSelect } = setup();
    fireEvent.click(screen.getByRole("button", { name: "3... a6" }));
    expect(onSelect).toHaveBeenCalledWith("e4 e5 Nf3 Nc6 Bb5 a6");
  });

  test("learned routes and due stations carry state hooks", () => {
    const { container } = setup();
    expect(container.querySelectorAll('.mc-branch[data-state="learned"]').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('.mc-branch[data-state="unlearned"]').length).toBeGreaterThan(0);
    expect(container.querySelector('.mc-station[data-state="due"]')).not.toBeNull();
    expect(container.querySelector('.mc-station[data-state="current"]')).not.toBeNull();
    expect(screen.getByRole("button", { name: "3... Nf6, due for review" })).toBeInTheDocument();
    expect(container.querySelector('.mc-branch-label[data-state="learned"]')).toHaveTextContent("Berlin");
    // 1... e5 is a plain ply; 3. Bb5 is where the lines split.
    expect(container.querySelectorAll('.mc-station[data-role="pass"]').length).toBeGreaterThan(0);
    const stops = container.querySelectorAll('.mc-station[data-role="stop"]');
    expect(stops.length).toBeLessThan(container.querySelectorAll(".mc-station").length);
  });

  test("collapsed branches open when clicked", () => {
    setup({ collapseDepth: 3, currentNodeId: "e4" });
    const stub = screen.getByRole("button", { name: "Show 2 more lines after 2. Nf3" });
    fireEvent.click(stub);
    expect(screen.getByRole("button", { name: "2... Nc6" })).toBeInTheDocument();
  });

  test("a newly learned line gets a stamp", () => {
    setup({ stampLineId: "morphy" });
    expect(screen.getByRole("status")).toHaveTextContent("Learned!");
  });
});
```

- [ ] **Step 8: Implement `components/branch-map/BranchMap.tsx`**

```tsx
"use client";

import { useState } from "react";
import { layoutBranchMap, stackLabels, type MapNode } from "@/lib/branch-map/layout";
import { moveNumberLabel } from "@/lib/course/labels";
import type { CourseTree } from "@/lib/course/types";

export interface BranchMapProps {
  tree: CourseTree;
  currentNodeId: string;
  learnedLineIds: ReadonlySet<string>;
  dueNodeIds: ReadonlySet<string>;
  onSelect: (nodeId: string) => void;
  stampLineId?: string | null;
  collapseDepth?: number;
}

const LANE = 18;
const ROW = 22;
const PAD = 14;
const LABEL_SPACE = 200;
const LABEL_GAP = 16;

function moveLabel(tree: CourseTree, node: MapNode): string {
  return node.san === null ? "Start" : moveNumberLabel(tree.nodes[node.nodeId].fen, node.san);
}

export function BranchMap({
  tree, currentNodeId, learnedLineIds, dueNodeIds, onSelect, stampLineId = null, collapseDepth,
}: BranchMapProps) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const layout = layoutBranchMap(tree, { currentNodeId, expanded, collapseDepth });

  const px = (lane: number) => PAD + lane * LANE;
  const py = (depth: number) => PAD + depth * ROW;
  const labelled = layout.nodes.filter((node) => node.label);
  const labelX = px(layout.lanes - 1) + LANE;
  const labelYs = stackLabels(labelled.map((node) => py(node.y)), LABEL_GAP);
  const width = labelX + LABEL_SPACE;
  const height = Math.max(py(layout.depth), ...labelYs) + PAD;
  const nodeById = new Map(layout.nodes.map((node) => [node.id, node]));
  const isLearned = (lineIds: string[]) => lineIds.some((id) => learnedLineIds.has(id));
  const stamped = stampLineId ? tree.lines.find((line) => line.id === stampLineId) : undefined;
  const stampIndex = stamped ? labelled.findIndex((node) => node.id === stamped.nodeIds.at(-1)) : -1;

  function stationState(node: MapNode): string {
    if (node.nodeId === currentNodeId && node.kind === "move") return "current";
    if (dueNodeIds.has(node.nodeId) && node.kind === "move") return "due";
    return isLearned(node.lineIds) ? "learned" : "unlearned";
  }

  // Transit-map stops: the start, branch points, line ends, the current position and due
  // positions. Every other ply is drawn as a small pass-through dot.
  function stationRole(node: MapNode): "stop" | "pass" {
    if (node.kind === "collapsed" || node.san === null || node.label) return "stop";
    if (tree.nodes[node.nodeId].children.length !== 1) return "stop";
    return node.nodeId === currentNodeId || dueNodeIds.has(node.nodeId) ? "stop" : "pass";
  }

  function describe(node: MapNode): string {
    if (node.kind === "collapsed") {
      return `Show ${node.hiddenCount} more ${node.hiddenCount === 1 ? "line" : "lines"} after ${moveLabel(tree, { ...node, san: tree.nodes[node.nodeId].san })}`;
    }
    const parts = [moveLabel(tree, node)];
    if (node.label) parts.push(node.label);
    if (dueNodeIds.has(node.nodeId)) parts.push("due for review");
    return parts.join(", ");
  }

  return (
    <nav className="mc-branch-map" aria-label={`${tree.meta.name} lines`}>
      <div className="mc-branch-map-canvas" style={{ width, height }}>
        <svg className="mc-branch-map-svg" width={width} height={height} aria-hidden="true">
          {layout.edges.map((edge) => {
            const from = nodeById.get(edge.from)!;
            const to = nodeById.get(edge.to)!;
            const [x1, y1, x2, y2] = [px(from.x), py(from.y), px(to.x), py(to.y)];
            const mid = (y1 + y2) / 2;
            const d = x1 === x2 ? `M${x1} ${y1} L${x2} ${y2}` : `M${x1} ${y1} C${x1} ${mid} ${x2} ${mid} ${x2} ${y2}`;
            return (
              <path
                key={`${edge.from}->${edge.to}`}
                className="mc-branch"
                data-state={isLearned(edge.lineIds) ? "learned" : "unlearned"}
                d={d}
              />
            );
          })}
          {layout.nodes.map((node) => (
            <circle
              key={node.id}
              className="mc-station"
              data-kind={node.kind}
              data-role={stationRole(node)}
              data-state={stationState(node)}
              cx={px(node.x)}
              cy={py(node.y)}
              r={stationRole(node) === "pass" ? 2.5 : node.kind === "collapsed" ? 4 : 5}
            />
          ))}
          {labelled.map((node, i) => (
            <g key={`label-${node.id}`}>
              <path
                className="mc-branch-leader"
                d={`M${px(node.x)} ${py(node.y)} L${labelX - 6} ${labelYs[i]}`}
              />
              <text
                className="mc-branch-label"
                data-state={isLearned(node.lineIds) ? "learned" : "unlearned"}
                x={labelX}
                y={labelYs[i]}
                dominantBaseline="middle"
              >
                {node.label}
              </text>
            </g>
          ))}
        </svg>

        {layout.nodes.map((node) => (
          <button
            key={node.id}
            type="button"
            className="mc-branch-station-button"
            data-kind={node.kind}
            style={{ left: px(node.x), top: py(node.y) }}
            aria-label={describe(node)}
            aria-current={node.nodeId === currentNodeId && node.kind === "move" ? "step" : undefined}
            onClick={() => {
              if (node.kind === "collapsed") setExpanded((current) => new Set([...current, node.nodeId]));
              else onSelect(node.nodeId);
            }}
          />
        ))}

        {stampIndex >= 0 && (
          <p
            key={stampLineId}
            className="mc-learned-stamp"
            style={{ left: labelX, top: labelYs[stampIndex] }}
            role="status"
          >
            Learned!
          </p>
        )}
      </div>
    </nav>
  );
}
```

- [ ] **Step 9: Run tests and lint, then commit**

Run: `pnpm test tests/unit/components/branch-map tests/unit/lib/branch-map tests/unit/lib/course && pnpm lint`
Expected: all tests pass; no lint errors.

```bash
git add lib/course/labels.ts lib/branch-map components/branch-map tests/unit/lib/course/labels.test.ts tests/unit/lib/branch-map tests/unit/components/branch-map
git commit -m "feat: add transit-style branch map of course lines"
```

---

### Task 16: Workspace shell, providers and storage banner

**Files:**
- Create: `lib/settings/source.ts`, `components/workspace/Providers.tsx`, `components/workspace/StorageBanner.tsx`, `components/workspace/Workspace.tsx`
- Test: `tests/unit/lib/settings/source.test.ts`, `tests/unit/components/workspace/workspace.test.tsx`

**Interfaces:**
- Consumes: `createEventBus`, `EventBus`; `LocalStorageProgressStore`, `ProgressSnapshot`, `ProgressStore`, `StoreStatus`; `LocalStorageSettingsStore`, `DEFAULT_SETTINGS`, `parseSettings`, `Settings`, `SettingsStore`; `applyTheme`, `getTheme`.
- Produces (`lib/settings/source.ts`): `interface SettingsSource { get(); set(patch); subscribe(listener) }`, `createSettingsSource(store): SettingsSource`.
- Produces (`components/workspace/Providers.tsx`):
  - `interface WorkspaceContextValue { snapshot: ProgressSnapshot | null; status: StoreStatus; settings: Settings; updateSettings; events: EventBus; now: () => Date; commitProgress(write): Promise<void> }`
  - `interface WorkspaceProviderProps { children; progressStore?; settingsStore?; now? }`
  - `WorkspaceProvider(props)`, `useWorkspace()`
- Produces (`components/workspace/StorageBanner.tsx`): `StorageBanner()`.
- Produces (`components/workspace/Workspace.tsx`): `interface WorkspaceProps { board; dialogue?; map?; panel?; dock? }`, `Workspace(props)`.
- Stable hooks rendered:
  - `.mc-workspace[data-dock="open|closed"][data-has-map]`
  - `.mc-workspace-map[data-open]`, `.mc-workspace-map-toggle`, `.mc-workspace-map-body`
  - `.mc-workspace-stage`, `.mc-workspace-board`, `.mc-workspace-dialogue`
  - `.mc-workspace-dock[data-state]`, `.mc-workspace-panel`
  - `.mc-storage-banner[data-kind]`

Design notes:
- **Where it mounts.** `WorkspaceProvider` mounts once in the root layout (Task 19), so the event bus, the stores and the future companion survive page navigation.
- **Progress.** Progress loads in an effect with an async `.then`, so the server render and first client render match. `snapshot` is `null` until then, and views show a loading state.
- **Settings.** Settings use `useSyncExternalStore`, with `DEFAULT_SETTINGS` as the server snapshot. On first paint the saved theme is already applied by the boot script (Task 19); the effect keeps `data-theme` in sync afterwards.
- **Companion dock.** `Workspace.dock` is the companion slot. It stays `hidden` and zero-width until something is passed in; sub-project 4 only needs `<Workspace dock={<CompanionCanvas />} />` plus `events.onAny`.
- **Removed positions.** When a course update removes a position, its card is never deleted from storage. Review filters it out through `reconcileCards` (Task 18), which is what the spec means by "silently dropped from review".

- [ ] **Step 1: Write the failing settings source test `tests/unit/lib/settings/source.test.ts`**

```ts
import { expect, test, vi } from "vitest";
import { LocalStorageSettingsStore } from "@/lib/settings/local-storage-store";
import { createSettingsSource } from "@/lib/settings/source";

test("get is stable until set, and set notifies, validates and saves", () => {
  const store = new LocalStorageSettingsStore(localStorage);
  const source = createSettingsSource(store);
  const first = source.get();
  expect(source.get()).toBe(first);

  const listener = vi.fn();
  const unsubscribe = source.subscribe(listener);
  source.set({ side: "black", sessionSize: 9999 });

  expect(listener).toHaveBeenCalledTimes(1);
  expect(source.get()).not.toBe(first);
  expect(source.get()).toMatchObject({ side: "black", sessionSize: 20 });
  expect(new LocalStorageSettingsStore(localStorage).load().side).toBe("black");

  unsubscribe();
  source.set({ themeId: "night-shift" });
  expect(listener).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Implement `lib/settings/source.ts` and run the test**

```ts
import { parseSettings, type Settings, type SettingsStore } from "./types";

// A cached, subscribable view of settings for React's useSyncExternalStore.
// get() returns the same object until settings change.
export interface SettingsSource {
  get(): Settings;
  set(patch: Partial<Omit<Settings, "schemaVersion">>): void;
  subscribe(listener: () => void): () => void;
}

export function createSettingsSource(store: SettingsStore): SettingsSource {
  let cached = store.load();
  const listeners = new Set<() => void>();

  return {
    get: () => cached,
    set(patch) {
      cached = parseSettings(JSON.stringify({ ...cached, ...patch }));
      store.save(cached);
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
```

Run: `pnpm test tests/unit/lib/settings/source.test.ts`
Expected: PASS (run it once before creating the file to see it fail).

- [ ] **Step 3: Write the failing workspace test `tests/unit/components/workspace/workspace.test.tsx`**

```tsx
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { StorageBanner } from "@/components/workspace/StorageBanner";
import { WorkspaceProvider, useWorkspace, type WorkspaceContextValue } from "@/components/workspace/Providers";
import { Workspace } from "@/components/workspace/Workspace";
import { MemoryProgressStore } from "@/lib/progress/memory-store";
import type { StoreStatus } from "@/lib/progress/types";
import { emptySnapshot } from "@/lib/progress/validate";
import { LocalStorageSettingsStore } from "@/lib/settings/local-storage-store";

function Probe({ onValue }: { onValue: (value: WorkspaceContextValue) => void }) {
  onValue(useWorkspace());
  return null;
}

describe("WorkspaceProvider", () => {
  test("loads progress on the client and refreshes after a commit", async () => {
    const store = new MemoryProgressStore();
    let latest: WorkspaceContextValue | null = null;
    render(
      <WorkspaceProvider progressStore={store}>
        <Probe onValue={(v) => { latest = v; }} />
      </WorkspaceProvider>,
    );
    await waitFor(() => expect(latest!.snapshot).toEqual(emptySnapshot()));

    await act(() => latest!.commitProgress((s) => s.setExplorePosition("ruy", "e4")));
    expect(latest!.snapshot!.explore.ruy).toEqual({ lastNodeId: "e4" });
    expect(latest!.status).toEqual({ kind: "ok" });
  });

  test("settings updates are saved and apply the theme to the page", async () => {
    let latest: WorkspaceContextValue | null = null;
    render(
      <WorkspaceProvider progressStore={new MemoryProgressStore()} settingsStore={new LocalStorageSettingsStore(localStorage)}>
        <Probe onValue={(v) => { latest = v; }} />
      </WorkspaceProvider>,
    );
    expect(latest!.settings.themeId).toBe("summer-sky");
    act(() => latest!.updateSettings({ themeId: "night-shift" }));
    expect(latest!.settings.themeId).toBe("night-shift");
    await waitFor(() => expect(document.documentElement).toHaveAttribute("data-theme", "night-shift"));
    expect(JSON.parse(localStorage.getItem("moechess:settings")!).themeId).toBe("night-shift");
  });

  test("the event bus is stable across renders", async () => {
    const seen: WorkspaceContextValue["events"][] = [];
    const { rerender } = render(
      <WorkspaceProvider progressStore={new MemoryProgressStore()}>
        <Probe onValue={(v) => seen.push(v.events)} />
      </WorkspaceProvider>,
    );
    rerender(
      <WorkspaceProvider progressStore={new MemoryProgressStore()}>
        <Probe onValue={(v) => seen.push(v.events)} />
      </WorkspaceProvider>,
    );
    await waitFor(() => expect(seen.length).toBeGreaterThan(1));
    expect(new Set(seen).size).toBe(1);
  });

  test("useWorkspace outside the provider explains the fix", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Probe onValue={() => {}} />)).toThrowError("useWorkspace must be used inside <WorkspaceProvider>");
    vi.mocked(console.error).mockRestore();
  });
});

describe("StorageBanner", () => {
  const renderWithStatus = async (status: StoreStatus) => {
    render(
      <WorkspaceProvider progressStore={new MemoryProgressStore(emptySnapshot(), status)}>
        <StorageBanner />
      </WorkspaceProvider>,
    );
    if (status.kind !== "ok") await screen.findByRole("status");
  };

  test("shows nothing when storage works", async () => {
    await renderWithStatus({ kind: "ok" });
    await act(async () => {});
    expect(screen.queryByRole("status")).toBeNull();
  });

  test.each([
    [{ kind: "unavailable" } as const, "Progress won't be saved in this browser."],
    [{ kind: "recovered", backupKey: "k" } as const, "Some saved progress couldn't be read and was reset."],
    [{ kind: "newer-schema", version: 2 } as const, "saved by a newer version of Moechess"],
  ])("explains %o", async (status, text) => {
    await renderWithStatus(status);
    expect(screen.getByRole("status")).toHaveTextContent(text);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("Workspace", () => {
  test("renders slots and keeps the companion dock closed when empty", () => {
    const { container } = render(
      <Workspace board={<div>board</div>} dialogue={<div>dialogue</div>} map={<div>map</div>} panel={<div>panel</div>} />,
    );
    expect(container.querySelector(".mc-workspace")).toHaveAttribute("data-dock", "closed");
    expect(container.querySelector(".mc-workspace-dock")).toHaveAttribute("hidden");
    for (const slot of ["board", "dialogue", "map", "panel"]) {
      expect(container.querySelector(`.mc-workspace-${slot}`)).toHaveTextContent(slot);
    }
  });

  test("a docked companion opens the dock", () => {
    const { container } = render(<Workspace board={<div />} dock={<canvas aria-label="Companion" />} />);
    expect(container.querySelector(".mc-workspace-dock")).toHaveAttribute("data-state", "open");
    expect(screen.getByLabelText("Companion")).toBeInTheDocument();
  });

  test("the lines drawer toggles on small screens", () => {
    render(<Workspace board={<div />} map={<div />} />);
    const toggle = screen.getByRole("button", { name: "Show lines" });
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Hide lines" })).toHaveAttribute("aria-expanded", "true");
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `pnpm test tests/unit/components/workspace`
Expected: FAIL, cannot resolve `@/components/workspace/StorageBanner`.

- [ ] **Step 5: Create `components/workspace/Providers.tsx`**

```tsx
"use client";

import {
  createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore,
  type ReactNode,
} from "react";
import { createEventBus, type EventBus } from "@/lib/events/bus";
import { LocalStorageProgressStore } from "@/lib/progress/local-storage-store";
import type { ProgressSnapshot, ProgressStore, StoreStatus } from "@/lib/progress/types";
import { LocalStorageSettingsStore } from "@/lib/settings/local-storage-store";
import { createSettingsSource, type SettingsSource } from "@/lib/settings/source";
import { DEFAULT_SETTINGS, type Settings, type SettingsStore } from "@/lib/settings/types";
import { applyTheme } from "@/lib/theme/apply";
import { getTheme } from "@/lib/theme/themes";

export interface WorkspaceContextValue {
  // null until progress has loaded on the client
  snapshot: ProgressSnapshot | null;
  status: StoreStatus;
  settings: Settings;
  updateSettings: SettingsSource["set"];
  events: EventBus;
  now: () => Date;
  // Runs a write against the progress store, then refreshes snapshot and status.
  commitProgress: (write: (store: ProgressStore) => Promise<void>) => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

function browserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export interface WorkspaceProviderProps {
  children: ReactNode;
  progressStore?: ProgressStore;
  settingsStore?: SettingsStore;
  now?: () => Date;
}

const systemNow = () => new Date();

export function WorkspaceProvider({ children, progressStore, settingsStore, now = systemNow }: WorkspaceProviderProps) {
  const [progress] = useState(() => progressStore ?? new LocalStorageProgressStore(browserStorage()));
  const [settingsSource] = useState(() => createSettingsSource(settingsStore ?? new LocalStorageSettingsStore(browserStorage())));
  const [events] = useState(() => createEventBus());
  const [snapshot, setSnapshot] = useState<ProgressSnapshot | null>(null);
  const [status, setStatus] = useState<StoreStatus>({ kind: "ok" });

  const settings = useSyncExternalStore(settingsSource.subscribe, settingsSource.get, () => DEFAULT_SETTINGS);

  useEffect(() => {
    let cancelled = false;
    progress.load().then((loaded) => {
      if (cancelled) return;
      setSnapshot(loaded);
      setStatus(progress.status());
    });
    return () => {
      cancelled = true;
    };
  }, [progress]);

  useEffect(() => {
    applyTheme(document.documentElement, getTheme(settings.themeId));
  }, [settings.themeId]);

  const commitProgress = useCallback(async (write: (store: ProgressStore) => Promise<void>) => {
    await write(progress);
    setSnapshot(await progress.load());
    setStatus(progress.status());
  }, [progress]);

  const value = useMemo<WorkspaceContextValue>(() => ({
    snapshot, status, settings, updateSettings: settingsSource.set, events, now, commitProgress,
  }), [snapshot, status, settings, settingsSource, events, now, commitProgress]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceContextValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspace must be used inside <WorkspaceProvider>");
  return value;
}
```

- [ ] **Step 6: Create `components/workspace/StorageBanner.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useWorkspace } from "./Providers";

const MESSAGES = {
  unavailable: "Progress won't be saved in this browser. Allow site data for Moechess in your browser settings to keep it.",
  recovered: "Some saved progress couldn't be read and was reset. A backup was kept in this browser.",
  "newer-schema": "Your progress was saved by a newer version of Moechess. Reload the page to update. Until then, new progress won't be saved.",
} as const;

export function StorageBanner() {
  const { status } = useWorkspace();
  const [dismissed, setDismissed] = useState<string | null>(null);

  if (status.kind === "ok" || dismissed === status.kind) return null;

  return (
    <div className="mc-storage-banner" data-kind={status.kind} role="status">
      <p>{MESSAGES[status.kind]}</p>
      <button type="button" onClick={() => setDismissed(status.kind)}>
        Dismiss
      </button>
    </div>
  );
}
```

- [ ] **Step 7: Create `components/workspace/Workspace.tsx`**

```tsx
"use client";

import { useState, type ReactNode } from "react";

export interface WorkspaceProps {
  board: ReactNode;
  dialogue?: ReactNode;
  map?: ReactNode;
  panel?: ReactNode;
  // Reserved for the 3D companion (sub-project 4). Collapsed to zero width when empty.
  dock?: ReactNode;
}

export function Workspace({ board, dialogue, map, panel, dock }: WorkspaceProps) {
  const [mapOpen, setMapOpen] = useState(false);

  return (
    <div className="mc-workspace" data-dock={dock ? "open" : "closed"} data-has-map={Boolean(map)}>
      {map && (
        <aside className="mc-workspace-map" data-open={mapOpen}>
          <button
            type="button"
            className="mc-workspace-map-toggle"
            aria-expanded={mapOpen}
            onClick={() => setMapOpen((open) => !open)}
          >
            {mapOpen ? "Hide lines" : "Show lines"}
          </button>
          <div className="mc-workspace-map-body">{map}</div>
        </aside>
      )}
      <div className="mc-workspace-stage">
        <div className="mc-workspace-board">{board}</div>
        {dialogue && <div className="mc-workspace-dialogue">{dialogue}</div>}
      </div>
      <div className="mc-workspace-dock" data-state={dock ? "open" : "closed"} hidden={!dock}>
        {dock}
      </div>
      {panel && <aside className="mc-workspace-panel">{panel}</aside>}
    </div>
  );
}
```

- [ ] **Step 8: Run tests, typecheck and lint, then commit**

Run: `pnpm test tests/unit/components/workspace tests/unit/lib/settings && pnpm typecheck && pnpm lint`
Expected: all tests pass; no errors.

```bash
git add lib/settings/source.ts components/workspace tests/unit/lib/settings/source.test.ts tests/unit/components/workspace
git commit -m "feat: add workspace providers, layout slots and storage banner"
```

---

### Task 17: Explore mode

**Files:**
- Create: `components/modes/ExploreView.tsx`
- Test: `tests/unit/components/modes/ExploreView.test.tsx`

**Interfaces:**
- Consumes: `Board`; `BranchMap`; `Dialogue`; `useWorkspace`; `Workspace`; `applySan`, `AppliedMove`; `commentarySourceLabel`, `moveNumberLabel`; `linesThrough`, `pathTo`; `CourseTree`; `learnedLineKey`; `cardForNode`; `isDue`.
- Produces: `ExploreView({ tree }: { tree: CourseTree })` (client component).
- Stable hooks rendered: `.mc-panel`, `.mc-explore-panel`, `.mc-panel-title`, `.mc-panel-heading`, `.mc-button-row`, `.mc-move-list`, `.mc-next-moves`, `.mc-line-links`, `.mc-notice`, `.mc-muted`.

Behaviour (spec §6 Explore):
- **Navigation.** Move freely with the board, the move list, Start / Back / Forward, or the branch map. Both sides' moves are playable.
- **Course-only moves.** Moves outside the course slide back, and a notice lists the course moves from here.
- **Saving.** Only the last position is saved (`setExplorePosition`), and it is restored when progress loads.
- **Events.** It emits `moveMade` for board moves and `commentaryShown` whenever it reaches an annotated node.
- **Links.** Lines through the current position link to Learn mode.

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { describe, expect, test } from "vitest";
import { ExploreView } from "@/components/modes/ExploreView";
import { WorkspaceProvider, useWorkspace } from "@/components/workspace/Providers";
import { buildCourseTree, parsePgnFile } from "@/lib/course/build-tree";
import type { CourseMeta } from "@/lib/course/types";
import type { WorkspaceEvent } from "@/lib/events/bus";
import { MemoryProgressStore } from "@/lib/progress/memory-store";
import { emptySnapshot } from "@/lib/progress/validate";
import { LocalStorageSettingsStore } from "@/lib/settings/local-storage-store";

const meta: CourseMeta = { slug: "ruy", name: "Ruy Lopez", eco: [], mainSide: "white", credits: [], contentLicense: "CC0" };
const tree = buildCourseTree(meta, parsePgnFile("ruy/lines.pgn", `[LineId "berlin"]
[LineName "Berlin"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 {The Ruy Lopez.} 3... Nf6 4. O-O *

[LineId "morphy"]
[LineName "Morphy"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 *
`));

function EventLog({ into }: { into: WorkspaceEvent[] }) {
  const { events } = useWorkspace();
  useEffect(() => events.onAny((event) => into.push(event)), [events, into]);
  return null;
}

function setup(store = new MemoryProgressStore(), log: WorkspaceEvent[] = []) {
  render(
    <WorkspaceProvider progressStore={store} settingsStore={new LocalStorageSettingsStore(null)}>
      <EventLog into={log} />
      <ExploreView tree={tree} />
    </WorkspaceProvider>,
  );
  return { store, log, user: userEvent.setup() };
}

const panel = () => within(screen.getByRole("heading", { name: "Ruy Lopez" }).parentElement!);

describe("ExploreView", () => {
  test("starts at the beginning with the course moves offered", async () => {
    setup();
    expect(await screen.findByText("Play a move on the board, or pick one of the course moves below.")).toBeInTheDocument();
    expect(panel().getByRole("button", { name: "1. e4" })).toBeInTheDocument();
    expect(screen.getByText("No notes for this move.")).toBeInTheDocument();
  });

  test("playing a course move on the board advances and saves the position", async () => {
    const { store, user } = setup();
    await user.type(screen.getByRole("textbox", { name: "Type a move" }), "e4{Enter}");
    expect(within(screen.getByRole("list", { name: "Moves played" })).getByRole("button", { name: "1. e4" }))
      .toHaveAttribute("aria-current", "step");
    await waitFor(async () => expect((await store.load()).explore.ruy).toEqual({ lastNodeId: "e4" }));
  });

  test("a move outside the course explains what the course plays instead", async () => {
    const { user } = setup();
    await user.type(screen.getByRole("textbox", { name: "Type a move" }), "d4{Enter}");
    expect(screen.getByRole("alert")).toHaveTextContent("d4 isn't in this course. From here the course plays e4.");
  });

  test("restores the saved position and shows its commentary and lines", async () => {
    const saved = { ...emptySnapshot(), explore: { ruy: { lastNodeId: "e4 e5 Nf3 Nc6 Bb5" } } };
    const { log, user } = setup(new MemoryProgressStore(saved));
    expect(await screen.findByText("The Ruy Lopez.")).toHaveAttribute("aria-live", "polite");
    expect(screen.getByText("Source: Moechess sample notes")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Learn Berlin" })).toHaveAttribute("href", "/course/ruy/learn/berlin");
    expect(screen.getByRole("link", { name: "Learn Morphy" })).toBeInTheDocument();

    await user.click(panel().getByRole("button", { name: "Back" }));
    await user.click(panel().getByRole("button", { name: "Forward" }));
    expect(log).toContainEqual({
      type: "commentaryShown", nodeId: "e4 e5 Nf3 Nc6 Bb5",
      commentary: { text: "The Ruy Lopez.", source: "sample" },
    });
  });

  test("the branch map moves the board", async () => {
    const { user } = setup();
    await user.click(within(screen.getByRole("navigation", { name: "Ruy Lopez lines" })).getByRole("button", { name: "3... a6" }));
    expect(screen.getByRole("link", { name: "Learn Morphy" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Learn Berlin" })).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test tests/unit/components/modes/ExploreView.test.tsx`
Expected: FAIL, cannot resolve `@/components/modes/ExploreView`.

- [ ] **Step 3: Implement `components/modes/ExploreView.tsx`**

```tsx
"use client";

import Link from "next/link";
import { useState } from "react";
import { Board } from "@/components/board/Board";
import { BranchMap } from "@/components/branch-map/BranchMap";
import { Dialogue } from "@/components/dialogue/Dialogue";
import { useWorkspace } from "@/components/workspace/Providers";
import { Workspace } from "@/components/workspace/Workspace";
import { applySan, type AppliedMove } from "@/lib/chess/position";
import { commentarySourceLabel, moveNumberLabel } from "@/lib/course/labels";
import { linesThrough, pathTo } from "@/lib/course/queries";
import type { CourseTree } from "@/lib/course/types";
import { learnedLineKey } from "@/lib/progress/types";
import { cardForNode } from "@/lib/training/cards";
import { isDue } from "@/lib/training/scheduler";

export function ExploreView({ tree }: { tree: CourseTree }) {
  const { snapshot, settings, events, now, commitProgress } = useWorkspace();
  const [openedAt] = useState(now);
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const slug = tree.meta.slug;
  const side = settings.side;
  const savedId = snapshot?.explore[slug]?.lastNodeId;
  const nodeId = chosenId ?? (savedId && tree.nodes[savedId] ? savedId : tree.rootId);
  const node = tree.nodes[nodeId];
  const parent = node.parentId ? tree.nodes[node.parentId] : null;
  const lastMove = parent && node.san ? applySan(parent.fen, node.san) : null;

  const learnedLineIds = new Set(
    tree.lines.filter((line) => snapshot?.learnedLines[learnedLineKey(slug, side, line.id)]).map((line) => line.id),
  );
  const dueNodeIds = new Set(
    Object.keys(tree.nodes).filter((id) => {
      const card = cardForNode(tree, id, side);
      const state = card ? snapshot?.cards[card] : undefined;
      return Boolean(state && isDue(state, openedAt));
    }),
  );

  function select(id: string) {
    setChosenId(id);
    setNotice(null);
    const target = tree.nodes[id];
    if (target.comment) events.emit({ type: "commentaryShown", nodeId: id, commentary: target.comment });
    void commitProgress((store) => store.setExplorePosition(slug, id));
  }

  function handleMove(move: AppliedMove): boolean {
    const childId = node.children.find((id) => tree.nodes[id].san === move.san);
    if (childId) {
      events.emit({ type: "moveMade", san: move.san, by: "learner", nodeId: childId });
      select(childId);
      return true;
    }
    const options = node.children.map((id) => tree.nodes[id].san).join(", ");
    setNotice(options
      ? `${move.san} isn't in this course. From here the course plays ${options}.`
      : `${move.san} isn't in this course, and this line ends here. Go back to try another line.`);
    return false;
  }

  const path = pathTo(tree, nodeId);
  const lines = linesThrough(tree, nodeId);

  const panel = (
    <div className="mc-panel mc-explore-panel">
      <h1 className="mc-panel-title">{tree.meta.name}</h1>
      <div className="mc-button-row">
        <button type="button" onClick={() => select(tree.rootId)} disabled={!parent}>Start</button>
        <button type="button" onClick={() => parent && select(parent.id)} disabled={!parent}>Back</button>
        <button type="button" onClick={() => select(node.children[0])} disabled={node.children.length === 0}>Forward</button>
      </div>

      {path.length > 0 ? (
        <ol className="mc-move-list" aria-label="Moves played">
          {path.map((step) => (
            <li key={step.id}>
              <button type="button" aria-current={step.id === nodeId ? "step" : undefined} onClick={() => select(step.id)}>
                {moveNumberLabel(step.fen, step.san as string)}
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mc-muted">Play a move on the board, or pick one of the course moves below.</p>
      )}

      <h2 className="mc-panel-heading">Next in the course</h2>
      {node.children.length > 0 ? (
        <ul className="mc-next-moves">
          {node.children.map((id) => (
            <li key={id}>
              <button type="button" onClick={() => select(id)}>
                {moveNumberLabel(tree.nodes[id].fen, tree.nodes[id].san as string)}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mc-muted">This line ends here.</p>
      )}
      {notice && <p className="mc-notice" role="alert">{notice}</p>}

      {lines.length > 0 && (
        <>
          <h2 className="mc-panel-heading">Lines through this position</h2>
          <ul className="mc-line-links">
            {lines.map((line) => (
              <li key={line.id}>
                <Link href={`/course/${slug}/learn/${line.id}`}>
                  {learnedLineIds.has(line.id) ? `Practise ${line.name} again` : `Learn ${line.name}`}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );

  return (
    <Workspace
      map={(
        <BranchMap
          tree={tree}
          currentNodeId={nodeId}
          learnedLineIds={learnedLineIds}
          dueNodeIds={dueNodeIds}
          onSelect={select}
        />
      )}
      board={(
        <Board
          fen={node.fen}
          orientation={side}
          interactive
          label={`${tree.meta.name} board`}
          onMove={handleMove}
          lastMove={lastMove ? { from: lastMove.from, to: lastMove.to } : null}
          arrows={node.arrows}
          highlights={node.highlights}
        />
      )}
      dialogue={(
        <Dialogue
          speaker="Course"
          text={node.comment?.text ?? null}
          source={node.comment ? commentarySourceLabel(node.comment.source) : undefined}
        />
      )}
      panel={panel}
    />
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass, then commit**

Run: `pnpm test tests/unit/components/modes/ExploreView.test.tsx && pnpm lint`
Expected: all tests pass; no lint errors.

```bash
git add components/modes/ExploreView.tsx tests/unit/components/modes/ExploreView.test.tsx
git commit -m "feat: add explore mode"
```

---

### Task 18: Learn mode view

**Files:**
- Create: `components/modes/LearnView.tsx`
- Test: `tests/unit/components/modes/LearnView.test.tsx`

**Interfaces:**
- Consumes: `Board`, `BoardFeedback`; `BranchMap`; `Dialogue`; `useWorkspace`; `Workspace`; `applySan`, `AppliedMove`, `Side`; `commentarySourceLabel`; `findLine`; `Arrow`, `CourseTree`, `Line`; `learnedLineKey`; `cardsForLine`, `generateCards`; `currentNode`, `expectedMove`, `initLearn`, `learnReducer`, `learnTurn`, `LearnAction`, `LearnState`; `learnCards`, `newCardState`.
- Produces: `interface LearnViewProps { tree: CourseTree; lineId: string; opponentDelayMs?: number }` and `LearnView(props)` (client component).
- Stable hooks rendered: `.mc-learn-panel`, `.mc-learn-phase[data-phase="guided|recall|completed"]`, `.mc-learn-progress`, plus the board, dialogue and branch-map hooks.

Behaviour (spec §6 Learn):
- **Session per side.** `LearnView` keys an inner session by `settings.side`, so switching sides starts fresh.
- **Opponent moves** auto-play after `opponentDelayMs` (500 ms by default; tests pass 0).
- **Hints.** In the guided pass, a sunflower (`G`) arrow shows the course move. After a mistake the arrow comes back, the square flashes, and the dialogue explains the move, using the course comment for it when there is one.
- **Completion** saves once, guarded by a ref:
  - Cards not yet in progress are created, and all of them go through `learnCards` (review due in exactly 24 hours).
  - The line is marked learned.
  - `lineLearned` and `sessionEnded` are emitted, and the branch map stamps the line.
- **Events.** It emits `moveMade` for both sides and `mistake` for wrong moves.

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { describe, expect, test } from "vitest";
import { LearnView } from "@/components/modes/LearnView";
import { WorkspaceProvider, useWorkspace } from "@/components/workspace/Providers";
import { buildCourseTree, parsePgnFile } from "@/lib/course/build-tree";
import type { CourseMeta } from "@/lib/course/types";
import type { WorkspaceEvent } from "@/lib/events/bus";
import { MemoryProgressStore } from "@/lib/progress/memory-store";
import { LocalStorageSettingsStore } from "@/lib/settings/local-storage-store";
import { DAY_MS } from "@/lib/training/scheduler";

const meta: CourseMeta = { slug: "ruy", name: "Ruy Lopez", eco: [], mainSide: "white", credits: [], contentLicense: "CC0" };
const tree = buildCourseTree(meta, parsePgnFile("ruy/lines.pgn", `[LineId "short"]
[LineName "Short line"]

1. e4 {Take the centre.} e5 2. Nf3 Nc6 *
`));

const NOW = new Date("2026-03-01T09:00:00.000Z");

function EventLog({ into }: { into: WorkspaceEvent[] }) {
  const { events } = useWorkspace();
  useEffect(() => events.onAny((event) => into.push(event)), [events, into]);
  return null;
}

function setup(lineId = "short") {
  const store = new MemoryProgressStore();
  const log: WorkspaceEvent[] = [];
  render(
    <WorkspaceProvider progressStore={store} settingsStore={new LocalStorageSettingsStore(null)} now={() => NOW}>
      <EventLog into={log} />
      <LearnView tree={tree} lineId={lineId} opponentDelayMs={0} />
    </WorkspaceProvider>,
  );
  const user = userEvent.setup();
  const play = async (san: string) => {
    const input = await screen.findByRole("textbox", { name: "Type a move" });
    await waitFor(() => expect(input).toBeEnabled());
    await user.clear(input);
    await user.type(input, `${san}{Enter}`);
  };
  return { store, log, play, user };
}

describe("LearnView", () => {
  test("guides the first pass with a hint arrow and commentary", () => {
    setup();
    expect(screen.getByText("Step 1 of 2: follow the highlighted moves")).toBeInTheDocument();
    expect(document.querySelector('.mc-arrow[data-brush="G"]')).not.toBeNull();
    expect(screen.getByText("Your move 1 of 2")).toBeInTheDocument();
  });

  test("a wrong move is explained and must be corrected", async () => {
    const { play, log } = setup();
    await play("d4");
    expect(screen.getByText(/Not quite\. The course plays e4 here\. Take the centre\. Play e4 to continue\./, { selector: ".mc-sr-only" }))
      .toBeInTheDocument();
    expect(log).toContainEqual({ type: "mistake", played: "d4", expected: "e4" });
    expect(document.querySelector('.mc-feedback[data-state="mistake"]')).not.toBeNull();
  });

  test("two clean passes learn the line and schedule review for tomorrow", async () => {
    const { play, store, log } = setup();
    await play("e4");
    await play("Nf3");
    expect(await screen.findByText("Step 2 of 2: play the line from memory")).toBeInTheDocument();
    await play("e4");
    await play("Nf3");

    expect(await screen.findByText("Learned", { selector: ".mc-learn-phase" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Learned!");
    await waitFor(async () => expect((await store.load()).learnedLines["ruy:white:short"]).toBeDefined());

    const snapshot = await store.load();
    const cards = Object.values(snapshot.cards);
    expect(cards).toHaveLength(2);
    for (const card of cards) {
      expect(card.status).toBe("review");
      expect(card.fsrs.due).toBe(new Date(NOW.getTime() + DAY_MS).toISOString());
    }
    await waitFor(() => expect(log).toContainEqual({ type: "lineLearned", courseSlug: "ruy", lineId: "short", side: "white" }));
    expect(screen.getByRole("link", { name: "Choose another line" })).toHaveAttribute("href", "/course/ruy");
  });

  test("a recall mistake restarts the pass", async () => {
    const { play } = setup();
    await play("e4");
    await play("Nf3");
    await screen.findByText("Step 2 of 2: play the line from memory");
    await play("d4");
    await play("e4");
    expect(await screen.findByText("Good. Now play the whole line again from the start.", { selector: ".mc-sr-only" }))
      .toBeInTheDocument();
    expect(screen.getByText("Your move 1 of 2")).toBeInTheDocument();
  });

  test("an unknown line explains what to do", () => {
    setup("missing");
    expect(screen.getByText("This line isn't in Ruy Lopez. Pick a line from the course page.")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test tests/unit/components/modes/LearnView.test.tsx`
Expected: FAIL, cannot resolve `@/components/modes/LearnView`.

- [ ] **Step 3: Implement `components/modes/LearnView.tsx`**

```tsx
"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Board, type BoardFeedback } from "@/components/board/Board";
import { BranchMap } from "@/components/branch-map/BranchMap";
import { Dialogue } from "@/components/dialogue/Dialogue";
import { useWorkspace } from "@/components/workspace/Providers";
import { Workspace } from "@/components/workspace/Workspace";
import { applySan, type AppliedMove, type Side } from "@/lib/chess/position";
import { commentarySourceLabel } from "@/lib/course/labels";
import { findLine } from "@/lib/course/queries";
import type { Arrow, CourseTree, Line } from "@/lib/course/types";
import { learnedLineKey } from "@/lib/progress/types";
import { cardsForLine, generateCards } from "@/lib/training/cards";
import {
  currentNode, expectedMove, initLearn, learnReducer, learnTurn, type LearnAction, type LearnState,
} from "@/lib/training/learn";
import { learnCards, newCardState } from "@/lib/training/scheduler";

export interface LearnViewProps {
  tree: CourseTree;
  lineId: string;
  opponentDelayMs?: number;
}

export function LearnView({ tree, lineId, opponentDelayMs = 500 }: LearnViewProps) {
  const { settings } = useWorkspace();
  const line = findLine(tree, lineId);
  if (!line) return <p className="mc-notice">This line isn&apos;t in {tree.meta.name}. Pick a line from the course page.</p>;
  // Switching sides starts a fresh session for that side.
  return <LearnSession key={settings.side} tree={tree} line={line} side={settings.side} opponentDelayMs={opponentDelayMs} />;
}

interface LearnSessionProps {
  tree: CourseTree;
  line: Line;
  side: Side;
  opponentDelayMs: number;
}

function coachText(tree: CourseTree, state: LearnState): string | null {
  const feedback = state.feedback;
  if (state.phase === "completed") return "Line learned. It comes back for review tomorrow.";
  if (feedback?.kind === "mistake") {
    const reason = tree.nodes[`${feedback.nodeId === "root" ? "" : `${feedback.nodeId} `}${feedback.expected}`]?.comment?.text;
    return `Not quite. The course plays ${feedback.expected} here.${reason ? ` ${reason}` : ""} Play ${feedback.expected} to continue.`;
  }
  if (feedback?.kind === "alternative") {
    return `${feedback.played} is also a good move, but this line plays ${feedback.expected}.`;
  }
  if (feedback?.kind === "restarted") return "Good. Now play the whole line again from the start.";
  if (state.phase === "recall" && state.index === 0) return "Now play the whole line from memory.";
  return currentNode(tree, state).comment?.text ?? null;
}

function LearnSession({ tree, line, side, opponentDelayMs }: LearnSessionProps) {
  const { snapshot, events, now, commitProgress } = useWorkspace();
  const [state, setState] = useState(() => initLearn(tree, line, side));
  const mistakes = useRef(0);
  const saved = useRef(false);

  const node = currentNode(tree, state);
  const turn = learnTurn(tree, state);
  const expected = expectedMove(tree, state);
  const slug = tree.meta.slug;

  function dispatch(action: LearnAction): LearnState {
    const next = learnReducer(tree, state, action);
    setState(next);
    return next;
  }

  useEffect(() => {
    if (turn !== "opponent") return;
    const timer = setTimeout(() => {
      const nextId = state.path[state.index + 1];
      events.emit({ type: "moveMade", san: tree.nodes[nextId].san as string, by: "opponent", nodeId: nextId });
      setState((current) => learnReducer(tree, current, { type: "opponentMoved" }));
    }, opponentDelayMs);
    return () => clearTimeout(timer);
  }, [turn, state, tree, events, opponentDelayMs]);

  useEffect(() => {
    if (state.phase !== "completed" || saved.current) return;
    saved.current = true;
    const learnedAt = now();
    const specs = generateCards([tree], side);
    void commitProgress(async (store) => {
      const current = await store.load();
      const cards = cardsForLine(tree, line, side).map((id) => current.cards[id] ?? newCardState(specs.get(id)!, learnedAt));
      await store.saveCards(learnCards(cards, learnedAt));
      await store.markLineLearned(learnedLineKey(slug, side, line.id), learnedAt.toISOString());
    }).then(() => {
      events.emit({ type: "lineLearned", courseSlug: slug, lineId: line.id, side });
      events.emit({
        type: "sessionEnded", mode: "learn",
        stats: { graded: 0, good: 0, again: 0, mistakes: mistakes.current },
      });
    });
  }, [state.phase, tree, line, side, slug, now, commitProgress, events]);

  function handleMove(move: AppliedMove): boolean {
    const before = state;
    const next = dispatch({ type: "play", san: move.san });
    if (next.feedback?.kind === "mistake" && next !== before) {
      mistakes.current += 1;
      events.emit({ type: "mistake", played: move.san, expected: next.feedback.expected });
      return false;
    }
    if (next.feedback?.kind === "alternative") return false;
    const nodeId = before.path[before.index + 1];
    events.emit({ type: "moveMade", san: move.san, by: "learner", nodeId });
    return true;
  }

  const parent = node.parentId ? tree.nodes[node.parentId] : null;
  const lastMove = parent && node.san ? applySan(parent.fen, node.san) : null;
  const expectedMoveSquares = expected && turn === "learner" ? applySan(node.fen, expected) : null;

  const arrows: Arrow[] = [...(node.arrows ?? [])];
  let feedback: BoardFeedback | null = null;
  if (expectedMoveSquares && (state.phase === "guided" || state.feedback?.kind === "mistake")) {
    arrows.push({ from: expectedMoveSquares.from, to: expectedMoveSquares.to, brush: "G" });
  }
  if (state.feedback?.kind === "mistake" || state.feedback?.kind === "alternative") {
    const played = applySan(node.fen, state.feedback.played);
    if (played) feedback = { square: played.to, state: state.feedback.kind === "mistake" ? "mistake" : "hint" };
  } else if (state.feedback?.kind === "correct" && lastMove) {
    feedback = { square: lastMove.to, state: "correct" };
  }

  const learnerMoves = cardsForLine(tree, line, side).length;
  const learnerMovesDone = state.path.slice(0, state.index).filter((id) => tree.nodes[id].position.split(" ")[1] === (side === "white" ? "w" : "b")).length;
  const learnedLineIds = new Set(
    tree.lines.filter((l) => snapshot?.learnedLines[learnedLineKey(slug, side, l.id)]).map((l) => l.id),
  );
  if (state.phase === "completed") learnedLineIds.add(line.id);

  const text = coachText(tree, state);
  const showsNodeComment = text !== null && text === node.comment?.text;

  const panel = (
    <div className="mc-panel mc-learn-panel">
      <p className="mc-muted">{tree.meta.name}</p>
      <h1 className="mc-panel-title">{line.name}</h1>
      <p className="mc-learn-phase" data-phase={state.phase}>
        {state.phase === "guided" && "Step 1 of 2: follow the highlighted moves"}
        {state.phase === "recall" && "Step 2 of 2: play the line from memory"}
        {state.phase === "completed" && "Learned"}
      </p>
      {state.phase !== "completed" && (
        <p className="mc-learn-progress">
          Your move {Math.min(learnerMovesDone + 1, learnerMoves)} of {learnerMoves}
        </p>
      )}
      <div className="mc-button-row">
        {state.phase === "completed" ? (
          <Link href={`/course/${slug}`}>Choose another line</Link>
        ) : (
          <button type="button" onClick={() => dispatch({ type: "restart" })}>Start over</button>
        )}
      </div>
    </div>
  );

  return (
    <Workspace
      map={(
        <BranchMap
          tree={tree}
          currentNodeId={node.id}
          learnedLineIds={learnedLineIds}
          dueNodeIds={new Set()}
          onSelect={() => {}}
          stampLineId={state.phase === "completed" ? line.id : null}
        />
      )}
      board={(
        <Board
          fen={node.fen}
          orientation={side}
          interactive={turn === "learner"}
          label={`${line.name} board`}
          onMove={handleMove}
          lastMove={lastMove ? { from: lastMove.from, to: lastMove.to } : null}
          arrows={arrows}
          highlights={node.highlights}
          feedback={feedback}
        />
      )}
      dialogue={(
        <Dialogue
          speaker="Course"
          text={text}
          source={showsNodeComment && node.comment ? commentarySourceLabel(node.comment.source) : undefined}
        />
      )}
      panel={panel}
    />
  );
}
```

- [ ] **Step 4: Run tests, typecheck and lint, then commit**

Run: `pnpm test tests/unit/components/modes/LearnView.test.tsx && pnpm typecheck && pnpm lint`
Expected: all tests pass; no errors.

```bash
git add components/modes/LearnView.tsx tests/unit/components/modes/LearnView.test.tsx
git commit -m "feat: add learn mode view"
```

---

### Task 19: Review mode view

**Files:**
- Create: `components/modes/ReviewView.tsx`
- Test: `tests/unit/components/modes/ReviewView.test.tsx`

**Interfaces:**
- Consumes: `Board`, `BoardFeedback`; `Dialogue`; `useWorkspace`; `Workspace`; `applySan`, `AppliedMove`, `Side`; `Arrow`, `CourseTree`; `SessionStats`; `reconcileCards`; `CardState`, `ProgressSnapshot`; `generateCards`, `CardId`; `nextReview`, `reviewExpectedMove`, `reviewNode`, `reviewReducer`, `reviewTurn`, `ReviewState`; `gradeCard`, `newCardState`.
- Produces: `interface ReviewViewProps { trees: CourseTree[]; opponentDelayMs?: number; autoDelayMs?: number; revealDelayMs?: number }` and `ReviewView(props)` (client component).
- Stable hooks rendered: `.mc-review-panel`, `.mc-review-progress`, `.mc-review-summary`, plus the board and dialogue hooks.

Behaviour (spec §6 Review, §11):
- **Loading.** It waits for progress to load, then keys a session by side.
- **Reconciling.** Cards are reconciled against the current courses. Positions that were removed are skipped, and cards whose course moves changed are reset to new and saved once.
- **Session flow.** The session picks the learned line with the most due cards.
  - Opponent moves play after `opponentDelayMs`, and moves that aren't due after `autoDelayMs`.
  - A revealed answer stays visible for `revealDelayMs`, then plays.
  - When a line is done, the next line is picked, skipping cards already graded this session. It stops at `settings.sessionSize` or when nothing is due.
- **Saving grades.** Each grade is saved immediately with `gradeCard` and emits `cardReviewed`; a reload mid-session loses nothing. Mistakes emit `mistake`, and the end emits `sessionEnded` with stats.
- **Copy.**
  - Nothing due: "Nothing is due right now" with a way back.
  - Session end: "Review done" with remembered / to-practise counts.

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { describe, expect, test } from "vitest";
import { ReviewView } from "@/components/modes/ReviewView";
import { WorkspaceProvider, useWorkspace } from "@/components/workspace/Providers";
import { buildCourseTree, parsePgnFile } from "@/lib/course/build-tree";
import type { CourseMeta } from "@/lib/course/types";
import type { WorkspaceEvent } from "@/lib/events/bus";
import { MemoryProgressStore } from "@/lib/progress/memory-store";
import { learnedLineKey, type ProgressSnapshot } from "@/lib/progress/types";
import { emptySnapshot } from "@/lib/progress/validate";
import { LocalStorageSettingsStore } from "@/lib/settings/local-storage-store";
import { cardsForLine, generateCards } from "@/lib/training/cards";
import { DAY_MS, learnCards, newCardState } from "@/lib/training/scheduler";

const meta: CourseMeta = { slug: "ruy", name: "Ruy Lopez", eco: [], mainSide: "white", credits: [], contentLicense: "CC0" };
const tree = buildCourseTree(meta, parsePgnFile("ruy/lines.pgn", `[LineId "short"]
[LineName "Short line"]

1. e4 e5 2. Nf3 {Attacks e5.} 2... Nc6 *
`));

const NOW = new Date("2026-03-02T09:00:00.000Z");
const LEARNED_AT = new Date(NOW.getTime() - DAY_MS);

function learnedSnapshot(): ProgressSnapshot {
  const specs = generateCards([tree], "white");
  const snapshot = emptySnapshot();
  const cards = learnCards(cardsForLine(tree, tree.lines[0], "white").map((id) => newCardState(specs.get(id)!, LEARNED_AT)), LEARNED_AT);
  for (const card of cards) snapshot.cards[card.id] = card;
  snapshot.learnedLines[learnedLineKey("ruy", "white", "short")] = { learnedAt: LEARNED_AT.toISOString() };
  return snapshot;
}

function EventLog({ into }: { into: WorkspaceEvent[] }) {
  const { events } = useWorkspace();
  useEffect(() => events.onAny((event) => into.push(event)), [events, into]);
  return null;
}

function setup(snapshot: ProgressSnapshot) {
  const store = new MemoryProgressStore(snapshot);
  const log: WorkspaceEvent[] = [];
  render(
    <WorkspaceProvider progressStore={store} settingsStore={new LocalStorageSettingsStore(null)} now={() => NOW}>
      <EventLog into={log} />
      <ReviewView trees={[tree]} opponentDelayMs={0} autoDelayMs={0} revealDelayMs={400} />
    </WorkspaceProvider>,
  );
  const user = userEvent.setup();
  const play = async (san: string) => {
    const input = await screen.findByRole("textbox", { name: "Type a move" });
    await waitFor(() => expect(input).toBeEnabled());
    await user.type(input, `${san}{Enter}`);
  };
  return { store, log, play };
}

describe("ReviewView", () => {
  test("says when nothing is due", async () => {
    setup(emptySnapshot());
    expect(await screen.findByRole("heading", { name: "Nothing is due right now" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to courses" })).toHaveAttribute("href", "/");
  });

  test("reviews due positions, saves grades and summarises the session", async () => {
    const { play, store, log } = setup(learnedSnapshot());
    expect(await screen.findByRole("heading", { name: "Short line" })).toBeInTheDocument();
    await play("e4");
    await play("Nf3");
    expect(await screen.findByRole("heading", { name: "Review done" })).toBeInTheDocument();
    expect(screen.getByText("2 remembered, 0 to practise again.")).toBeInTheDocument();

    const cards = Object.values((await store.load()).cards);
    for (const card of cards) expect(Date.parse(card.fsrs.due)).toBeGreaterThan(NOW.getTime() + DAY_MS);
    expect(log.filter((e) => e.type === "cardReviewed").map((e) => e.type === "cardReviewed" && e.rating)).toEqual(["good", "good"]);
    await waitFor(() => expect(log).toContainEqual({
      type: "sessionEnded", mode: "review", stats: { graded: 2, good: 2, again: 0, mistakes: 0 },
    }));
  });

  test("two wrong tries reveal the answer and grade the position again", async () => {
    const { play, store } = setup(learnedSnapshot());
    await play("d4");
    expect(await screen.findByText("d4 isn't the course move. Try again.", { selector: ".mc-sr-only" })).toBeInTheDocument();
    await play("c4");
    expect(await screen.findByText("The course plays e4 here. This position comes back soon.", { selector: ".mc-sr-only" }))
      .toBeInTheDocument();

    await waitFor(async () => {
      const lapsed = Object.values((await store.load()).cards).filter((card) => card.fsrs.lapses === 1);
      expect(lapsed).toHaveLength(1);
    });
    await play("Nf3");
    expect(await screen.findByText("1 remembered, 1 to practise again.")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test tests/unit/components/modes/ReviewView.test.tsx`
Expected: FAIL, cannot resolve `@/components/modes/ReviewView`.

- [ ] **Step 3: Implement `components/modes/ReviewView.tsx`**

```tsx
"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Board, type BoardFeedback } from "@/components/board/Board";
import { Dialogue } from "@/components/dialogue/Dialogue";
import { useWorkspace } from "@/components/workspace/Providers";
import { Workspace } from "@/components/workspace/Workspace";
import { applySan, type AppliedMove, type Side } from "@/lib/chess/position";
import type { Arrow, CourseTree } from "@/lib/course/types";
import type { SessionStats } from "@/lib/events/bus";
import { reconcileCards } from "@/lib/progress/reconcile";
import type { CardState, ProgressSnapshot } from "@/lib/progress/types";
import { generateCards, type CardId } from "@/lib/training/cards";
import {
  nextReview, reviewExpectedMove, reviewNode, reviewReducer, reviewTurn, type ReviewState,
} from "@/lib/training/review";
import { gradeCard, newCardState } from "@/lib/training/scheduler";

export interface ReviewViewProps {
  trees: CourseTree[];
  opponentDelayMs?: number;
  autoDelayMs?: number;
  // How long a revealed answer stays on screen before it is played.
  revealDelayMs?: number;
}

export function ReviewView({ trees, opponentDelayMs = 500, autoDelayMs = 250, revealDelayMs = 1500 }: ReviewViewProps) {
  const { settings, snapshot } = useWorkspace();
  if (!snapshot) return <p className="mc-muted">Loading your progress…</p>;
  return (
    <ReviewSession
      key={settings.side}
      trees={trees}
      side={settings.side}
      sessionSize={settings.sessionSize}
      opponentDelayMs={opponentDelayMs}
      autoDelayMs={autoDelayMs}
      revealDelayMs={revealDelayMs}
    />
  );
}

interface ReviewSessionProps {
  trees: CourseTree[];
  side: Side;
  sessionSize: number;
  opponentDelayMs: number;
  autoDelayMs: number;
  revealDelayMs: number;
}

interface Session {
  review: ReviewState | null;
  gradedIds: CardId[];
  stats: SessionStats;
}

// Cards for positions that left the course are filtered out; cards whose
// course moves changed come back as new (and are saved as such).
function reviewableCards(trees: CourseTree[], side: Side, snapshot: ProgressSnapshot, now: Date) {
  const specs = generateCards(trees, side);
  const prefix = side === "white" ? "w:" : "b:";
  const ownSide = Object.fromEntries(Object.entries(snapshot.cards).filter(([id]) => id.startsWith(prefix))) as Record<CardId, CardState>;
  return reconcileCards(ownSide, specs, (spec) => newCardState(spec, now));
}

function pickNext(trees: CourseTree[], side: Side, snapshot: ProgressSnapshot, now: Date, session: Session, size: number) {
  const { cards } = reviewableCards(trees, side, snapshot, now);
  for (const id of session.gradedIds) delete cards[id];
  return nextReview(trees, { ...snapshot, cards }, side, now, session.stats.graded, size);
}

function coachText(tree: CourseTree, review: ReviewState): string {
  const feedback = review.feedback;
  if (feedback?.kind === "mistake") return `${feedback.played} isn't the course move. Try again.`;
  if (feedback?.kind === "revealed") return `The course plays ${feedback.expected} here. This position comes back soon.`;
  if (feedback?.kind === "alternative") return `${feedback.played} is also good, but this line plays ${feedback.expected}.`;
  if (feedback?.kind === "correct") return reviewNode(tree, review).comment?.text ?? "Correct.";
  return "Find the course move.";
}

function ReviewSession({ trees, side, sessionSize, opponentDelayMs, autoDelayMs, revealDelayMs }: ReviewSessionProps) {
  const { snapshot, events, now, commitProgress } = useWorkspace();
  const [openedAt] = useState(now);
  const [session, setSession] = useState<Session>(() => {
    const empty: Session = { review: null, gradedIds: [], stats: { graded: 0, good: 0, again: 0, mistakes: 0 } };
    return { ...empty, review: pickNext(trees, side, snapshot as ProgressSnapshot, openedAt, empty, sessionSize) };
  });
  const [finished, setFinished] = useState(session.review === null);
  const resetSaved = useRef(false);

  const review = session.review;
  const tree = review ? trees.find((t) => t.meta.slug === review.courseSlug)! : null;
  const turn = tree && review ? reviewTurn(tree, review) : "done";

  useEffect(() => {
    if (resetSaved.current || !snapshot) return;
    resetSaved.current = true;
    const { reset, cards } = reviewableCards(trees, side, snapshot, openedAt);
    if (reset.length > 0) void commitProgress((store) => store.saveCards(reset.map((id) => cards[id])));
  }, [snapshot, trees, side, openedAt, commitProgress]);

  useEffect(() => {
    if (finished) {
      events.emit({ type: "sessionEnded", mode: "review", stats: session.stats });
    }
    // Emit once when the session finishes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished]);

  useEffect(() => {
    if (!tree || !review || finished) return;
    if (turn === "opponent" || turn === "auto") {
      const delay = review.feedback?.kind === "revealed" ? revealDelayMs : turn === "opponent" ? opponentDelayMs : autoDelayMs;
      const timer = setTimeout(() => {
        const nextId = review.path[review.index + 1];
        events.emit({
          type: "moveMade", san: tree.nodes[nextId].san as string,
          by: turn === "opponent" ? "opponent" : "learner", nodeId: nextId,
        });
        setSession((current) => current.review
          ? { ...current, review: reviewReducer(tree, current.review, { type: "advance" }) }
          : current);
      }, delay);
      return () => clearTimeout(timer);
    }
    if (turn === "done") {
      const timer = setTimeout(() => {
        const next = snapshot ? pickNext(trees, side, snapshot, now(), session, sessionSize) : null;
        if (next) setSession((current) => ({ ...current, review: next }));
        else setFinished(true);
      }, opponentDelayMs);
      return () => clearTimeout(timer);
    }
  }, [tree, review, turn, finished, opponentDelayMs, autoDelayMs, revealDelayMs, events, snapshot, trees, side, now, session, sessionSize]);

  function handleMove(move: AppliedMove): boolean {
    if (!tree || !review || !snapshot) return false;
    const next = reviewReducer(tree, review, { type: "play", san: move.san });
    if (next === review) return false;

    const gradedNow = next.graded.length > review.graded.length ? next.graded[next.graded.length - 1] : null;
    const isMistake = next.feedback?.kind === "mistake" || next.feedback?.kind === "revealed";
    const stats: SessionStats = {
      graded: session.stats.graded + (gradedNow ? 1 : 0),
      good: session.stats.good + (gradedNow?.rating === "good" ? 1 : 0),
      again: session.stats.again + (gradedNow?.rating === "again" ? 1 : 0),
      mistakes: session.stats.mistakes + (isMistake ? 1 : 0),
    };
    setSession((current) => ({
      review: next,
      gradedIds: gradedNow ? [...current.gradedIds, gradedNow.cardId] : current.gradedIds,
      stats,
    }));

    if (isMistake && next.feedback && next.feedback.kind !== "correct" && next.feedback.kind !== "alternative") {
      events.emit({ type: "mistake", played: move.san, expected: next.feedback.expected, cardId: gradedNow?.cardId });
    }
    if (gradedNow) {
      const reviewedAt = now();
      const { cards } = reviewableCards(trees, side, snapshot, reviewedAt);
      const card = cards[gradedNow.cardId];
      if (card) void commitProgress((store) => store.saveCards([gradeCard(card, gradedNow.rating, reviewedAt)]));
      events.emit({ type: "cardReviewed", cardId: gradedNow.cardId, rating: gradedNow.rating });
    }
    if (next.feedback?.kind === "correct") {
      events.emit({ type: "moveMade", san: move.san, by: "learner", nodeId: next.path[next.index] });
      return true;
    }
    return false;
  }

  if (finished || !tree || !review) {
    return (
      <div className="mc-panel mc-review-summary">
        {session.stats.graded === 0 ? (
          <>
            <h1 className="mc-panel-title">Nothing is due right now</h1>
            <p>Learn a new line, or come back when your next review is due.</p>
          </>
        ) : (
          <>
            <h1 className="mc-panel-title">Review done</h1>
            <p>
              {session.stats.good} remembered, {session.stats.again} to practise again.
            </p>
          </>
        )}
        <Link href="/">Back to courses</Link>
      </div>
    );
  }

  const node = reviewNode(tree, review);
  const parent = node.parentId ? tree.nodes[node.parentId] : null;
  const lastMove = parent && node.san ? applySan(parent.fen, node.san) : null;
  const line = tree.lines.find((l) => l.id === review.lineId)!;
  const expected = reviewExpectedMove(tree, review);

  const arrows: Arrow[] = [];
  let feedback: BoardFeedback | null = null;
  const fb = review.feedback;
  if (fb?.kind === "mistake" || fb?.kind === "revealed" || fb?.kind === "alternative") {
    const played = applySan(node.fen, fb.played);
    if (played) feedback = { square: played.to, state: fb.kind === "alternative" ? "hint" : "mistake" };
  }
  if (fb?.kind === "revealed" && expected) {
    const answer = applySan(node.fen, expected);
    if (answer) arrows.push({ from: answer.from, to: answer.to, brush: "G" });
  }
  if (fb?.kind === "correct" && lastMove) feedback = { square: lastMove.to, state: "correct" };

  const panel = (
    <div className="mc-panel mc-review-panel">
      <p className="mc-muted">{tree.meta.name}</p>
      <h1 className="mc-panel-title">{line.name}</h1>
      <p className="mc-review-progress">
        {session.stats.graded} of up to {sessionSize} positions reviewed
      </p>
      <div className="mc-button-row">
        <button type="button" onClick={() => setFinished(true)}>End review</button>
      </div>
    </div>
  );

  return (
    <Workspace
      board={(
        <Board
          fen={node.fen}
          orientation={side}
          interactive={turn === "learner"}
          label={`${line.name} review board`}
          onMove={handleMove}
          lastMove={lastMove ? { from: lastMove.from, to: lastMove.to } : null}
          arrows={arrows}
          feedback={feedback}
        />
      )}
      dialogue={<Dialogue speaker="Course" text={coachText(tree, review)} />}
      panel={panel}
    />
  );
}
```

- [ ] **Step 4: Run tests, typecheck and lint, then commit**

Run: `pnpm test tests/unit/components/modes && pnpm typecheck && pnpm lint`
Expected: all tests pass; no errors.

```bash
git add components/modes/ReviewView.tsx tests/unit/components/modes/ReviewView.test.tsx
git commit -m "feat: add spaced-repetition review view"
```

---

### Task 20: App shell, styles and routes

**Files:**
- Modify (replace): `app/globals.css`, `app/layout.tsx`, `app/page.tsx`
- Create: `app/course/[slug]/page.tsx`, `app/course/[slug]/learn/[line]/page.tsx`, `app/review/page.tsx`, `app/settings/page.tsx`, `app/credits/page.tsx`
- Create: `components/nav/TopBar.tsx`, `components/home/CourseList.tsx`, `components/settings/ThemePicker.tsx`, `components/settings/SettingsForm.tsx`
- Delete: `public/file.svg`, `public/globe.svg`, `public/next.svg`, `public/vercel.svg`, `public/window.svg` (Create Next App leftovers)
- Test: `tests/unit/components/shell.test.tsx`

**Interfaces:**
- Consumes: every view and provider from Tasks 13–19; `loadAllCourses`, `listCourseSlugs`, `loadCourse`; `findLine`; `SETTINGS_KEY`, `SESSION_SIZE_MIN`, `SESSION_SIZE_MAX`; `themeBootScript`, `themeCssVariables`; `BUILT_IN_THEMES`, `SUMMER_SKY`; `PIECE_SETS`.
- Produces:
  - `TopBar()`
  - `CourseList({ courses })`
  - `ThemePicker({ themes, value, onChange })`
  - `SettingsForm()`
  - Routes: `/`, `/course/[slug]`, `/course/[slug]/learn/[line]`, `/review`, `/settings`, `/credits`
- Stable hooks rendered: `.mc-body`, `.mc-skip-link`, `.mc-topbar`, `.mc-wordmark`, `.mc-topbar-nav`, `.mc-side-toggle`, `.mc-main`, `.mc-page-title`, `.mc-page-intro`, `.mc-course-list`, `.mc-course`, `.mc-course-name`, `.mc-course-stats`, `.mc-settings`, `.mc-theme-options`, `.mc-theme-option[data-theme-id]`, `.mc-theme-swatch`, `.mc-radio-row`, `.mc-credits`.

Design notes:
- **Static pages.** Course pages are statically generated with `generateStaticParams` and `dynamicParams = false`. Loading the courses at build time is what makes invalid PGN fail `pnpm build` (spec §11).
- **Theme before paint.** The root layout sets Summer Sky's variables on `<html>` for the server render. An inline `<head>` script (`themeBootScript`) then applies the saved theme before paint, following `node_modules/next/dist/docs/01-app/02-guides/preventing-flash-before-hydration.md`; `suppressHydrationWarning` covers that attribute change.
- **Fonts.** `next/font/google` loads Dela Gothic One (weight `400` is required) as `--mc-face-display` and Atkinson Hyperlegible Next as `--mc-face-body`. Next can't compute fallback metrics for Atkinson Hyperlegible Next, so `adjustFontFallback: false` with a system fallback avoids the build warning.
- **Styles.** All component styles live in `app/globals.css`, which is only imported by the root layout. Every value comes from `--mc-*` tokens.
- **Keyframes.** Keyframe names use a `moechess-` prefix so they aren't mistaken for styling hooks by the contract test (Task 21).
- **Radio names.** Radio `name` attributes use `moechess-*` for the same reason.
- **Layout fixes from the visual review.** These were found while writing this plan (Task 23):
  - The map column needs `min-width: 0` and a `minmax(0, 1fr)` inner column, or the map's canvas pushes under the board.
  - The stage is capped at `calc(100dvh - 21rem)`, so the dialogue box stays above the fold at 1440×900.
  - The wordmark uses a thick underline rather than a highlight, because light text on sunflower fails in Night Shift.

- [ ] **Step 1: Read the Next.js guides this task relies on**

Read these in `node_modules/next/dist/docs/01-app/`:
- `03-api-reference/03-file-conventions/layout.md` (root layout)
- `03-api-reference/03-file-conventions/page.md` (`PageProps` helper)
- `03-api-reference/03-file-conventions/dynamic-routes.md`
- `03-api-reference/04-functions/generate-static-params.md`
- `03-api-reference/03-file-conventions/02-route-segment-config/dynamicParams.md`
- `03-api-reference/04-functions/not-found.md`
- `01-getting-started/13-fonts.md` and `03-api-reference/02-components/font.md`
- `02-guides/preventing-flash-before-hydration.md` (Themes section)

- [ ] **Step 2: Write the failing shell test `tests/unit/components/shell.test.tsx`**

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { CourseList } from "@/components/home/CourseList";
import { TopBar } from "@/components/nav/TopBar";
import { SettingsForm } from "@/components/settings/SettingsForm";
import { WorkspaceProvider } from "@/components/workspace/Providers";
import { buildCourseTree, parsePgnFile } from "@/lib/course/build-tree";
import type { CourseMeta } from "@/lib/course/types";
import { MemoryProgressStore } from "@/lib/progress/memory-store";
import { learnedLineKey } from "@/lib/progress/types";
import { emptySnapshot } from "@/lib/progress/validate";
import { LocalStorageSettingsStore } from "@/lib/settings/local-storage-store";
import { cardsForLine, generateCards } from "@/lib/training/cards";
import { DAY_MS, learnCards, newCardState } from "@/lib/training/scheduler";

vi.mock("next/navigation", () => ({ usePathname: () => "/course/ruy" }));

const NOW = new Date("2026-03-02T09:00:00.000Z");
const meta: CourseMeta = { slug: "ruy", name: "Ruy Lopez", eco: [], mainSide: "white", credits: [], contentLicense: "CC0" };
const tree = buildCourseTree(meta, parsePgnFile("ruy/lines.pgn", `[LineId "a"]
[LineName "A"]

1. e4 e5 2. Nf3 *

[LineId "b"]
[LineName "B"]

1. e4 c5 2. Nf3 *
`));

function withProvider(ui: React.ReactNode, store = new MemoryProgressStore()) {
  return render(
    <WorkspaceProvider progressStore={store} settingsStore={new LocalStorageSettingsStore(localStorage)} now={() => NOW}>
      {ui}
    </WorkspaceProvider>,
  );
}

describe("TopBar", () => {
  test("marks the current section and switches sides", () => {
    withProvider(<TopBar />);
    expect(screen.getByRole("link", { name: "Courses" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Review" })).not.toHaveAttribute("aria-current");
    fireEvent.click(screen.getByRole("radio", { name: "Black" }));
    expect(screen.getByRole("radio", { name: "Black" })).toBeChecked();
    expect(JSON.parse(localStorage.getItem("moechess:settings")!).side).toBe("black");
  });
});

describe("SettingsForm", () => {
  test("switching theme applies it to the page", async () => {
    withProvider(<SettingsForm />);
    fireEvent.click(screen.getByRole("radio", { name: "Night Shift" }));
    await waitFor(() => expect(document.documentElement).toHaveAttribute("data-theme", "night-shift"));
  });

  test("session size ignores values out of range", () => {
    withProvider(<SettingsForm />);
    const input = screen.getByRole("spinbutton", { name: "Positions per session" });
    fireEvent.change(input, { target: { value: "30" } });
    expect(input).toHaveValue(30);
    fireEvent.change(input, { target: { value: "500" } });
    expect(input).toHaveValue(30);
  });
});

describe("CourseList", () => {
  test("shows learned lines and due reviews for the chosen side", async () => {
    const learnedAt = new Date(NOW.getTime() - DAY_MS);
    const specs = generateCards([tree], "white");
    const snapshot = emptySnapshot();
    for (const card of learnCards(cardsForLine(tree, tree.lines[0], "white").map((id) => newCardState(specs.get(id)!, learnedAt)), learnedAt)) {
      snapshot.cards[card.id] = card;
    }
    snapshot.learnedLines[learnedLineKey("ruy", "white", "a")] = { learnedAt: learnedAt.toISOString() };

    withProvider(<CourseList courses={[tree]} />, new MemoryProgressStore(snapshot));
    expect(await screen.findByText("1 of 2 lines learned as white, 2 due for review")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Explore lines" })).toHaveAttribute("href", "/course/ruy");
    expect(screen.getByRole("link", { name: "Review 2 due" })).toHaveAttribute("href", "/review");
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm test tests/unit/components/shell.test.tsx`
Expected: FAIL, cannot resolve `@/components/home/CourseList`.

- [ ] **Step 4: Create `components/nav/TopBar.tsx`**

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWorkspace } from "@/components/workspace/Providers";
import type { Side } from "@/lib/chess/position";

const LINKS = [
  { href: "/", label: "Courses", matches: (path: string) => path === "/" || path.startsWith("/course") },
  { href: "/review", label: "Review", matches: (path: string) => path.startsWith("/review") },
  { href: "/settings", label: "Settings", matches: (path: string) => path.startsWith("/settings") },
];

const SIDES: { value: Side; label: string }[] = [
  { value: "white", label: "White" },
  { value: "black", label: "Black" },
];

export function TopBar() {
  const pathname = usePathname() ?? "/";
  const { settings, updateSettings } = useWorkspace();

  return (
    <header className="mc-topbar">
      <Link href="/" className="mc-wordmark">Moechess</Link>
      <nav className="mc-topbar-nav" aria-label="Main">
        {LINKS.map((link) => (
          <Link key={link.href} href={link.href} aria-current={link.matches(pathname) ? "page" : undefined}>
            {link.label}
          </Link>
        ))}
      </nav>
      <fieldset className="mc-side-toggle">
        <legend className="mc-sr-only">Play as</legend>
        {SIDES.map((side) => (
          <label key={side.value}>
            <input
              type="radio"
              name="moechess-side"
              value={side.value}
              checked={settings.side === side.value}
              onChange={() => updateSettings({ side: side.value })}
            />
            {side.label}
          </label>
        ))}
      </fieldset>
    </header>
  );
}
```

- [ ] **Step 5: Create `components/home/CourseList.tsx`**

```tsx
"use client";

import Link from "next/link";
import { useState } from "react";
import { useWorkspace } from "@/components/workspace/Providers";
import type { CourseTree } from "@/lib/course/types";
import { learnedLineKey } from "@/lib/progress/types";
import { generateCards } from "@/lib/training/cards";
import { isDue } from "@/lib/training/scheduler";

export function CourseList({ courses }: { courses: CourseTree[] }) {
  const { snapshot, settings, now } = useWorkspace();
  const [openedAt] = useState(now);
  const side = settings.side;

  return (
    <ul className="mc-course-list">
      {courses.map((course) => {
        const learned = course.lines.filter((line) => snapshot?.learnedLines[learnedLineKey(course.meta.slug, side, line.id)]).length;
        const due = [...generateCards([course], side).keys()]
          .filter((id) => snapshot?.cards[id] && isDue(snapshot.cards[id], openedAt)).length;
        return (
          <li key={course.meta.slug} className="mc-panel mc-course">
            <div>
              <h2 className="mc-course-name">{course.meta.name}</h2>
              <p className="mc-course-stats">
                {snapshot
                  ? `${learned} of ${course.lines.length} lines learned as ${side}${due > 0 ? `, ${due} due for review` : ""}`
                  : `${course.lines.length} lines`}
              </p>
            </div>
            <div className="mc-button-row">
              <Link href={`/course/${course.meta.slug}`}>Explore lines</Link>
              {due > 0 && <Link href="/review">Review {due} due</Link>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 6: Create `components/settings/ThemePicker.tsx`**

```tsx
"use client";

import type { Theme } from "@/lib/theme/themes";

export interface ThemePickerProps {
  themes: Theme[];
  value: string;
  onChange: (themeId: string) => void;
}

const SWATCH_TOKENS = ["bg", "board-light", "board-dark", "accent-course"] as const;

export function ThemePicker({ themes, value, onChange }: ThemePickerProps) {
  return (
    <div className="mc-theme-options">
      {themes.map((theme) => (
        <label key={theme.id} className="mc-theme-option" data-theme-id={theme.id}>
          <input
            type="radio"
            name="moechess-theme"
            value={theme.id}
            checked={value === theme.id}
            onChange={() => onChange(theme.id)}
          />
          <span className="mc-theme-swatch" aria-hidden="true">
            {SWATCH_TOKENS.map((token) => (
              <span key={token} style={{ background: theme.tokens[token] }} />
            ))}
          </span>
          <span>{theme.name}</span>
        </label>
      ))}
    </div>
  );
}
```

- [ ] **Step 7: Create `components/settings/SettingsForm.tsx`**

```tsx
"use client";

import { useWorkspace } from "@/components/workspace/Providers";
import { SESSION_SIZE_MAX, SESSION_SIZE_MIN } from "@/lib/settings/types";
import { BUILT_IN_THEMES } from "@/lib/theme/themes";
import { ThemePicker } from "./ThemePicker";

export function SettingsForm() {
  const { settings, updateSettings } = useWorkspace();

  return (
    <form className="mc-settings" onSubmit={(event) => event.preventDefault()}>
      <fieldset>
        <legend>Theme</legend>
        <ThemePicker themes={BUILT_IN_THEMES} value={settings.themeId} onChange={(themeId) => updateSettings({ themeId })} />
      </fieldset>

      <fieldset>
        <legend>Play as</legend>
        <div className="mc-radio-row">
          {(["white", "black"] as const).map((side) => (
            <label key={side}>
              <input
                type="radio"
                name="moechess-settings-side"
                value={side}
                checked={settings.side === side}
                onChange={() => updateSettings({ side })}
              />{" "}
              {side === "white" ? "White" : "Black"}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend>Review session</legend>
        <label>
          Positions per session{" "}
          <input
            type="number"
            min={SESSION_SIZE_MIN}
            max={SESSION_SIZE_MAX}
            value={settings.sessionSize}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (Number.isInteger(value) && value >= SESSION_SIZE_MIN && value <= SESSION_SIZE_MAX) {
                updateSettings({ sessionSize: value });
              }
            }}
          />
        </label>
        <p className="mc-muted">
          Between {SESSION_SIZE_MIN} and {SESSION_SIZE_MAX}. Changes save automatically.
        </p>
      </fieldset>
    </form>
  );
}
```

- [ ] **Step 8: Run the shell test to verify it passes**

Run: `pnpm test tests/unit/components/shell.test.tsx`
Expected: all tests pass.

- [ ] **Step 9: Replace `app/globals.css`**

```css
@import "tailwindcss";

/*
 * Every colour, font, radius, border and duration comes from --mc-* tokens.
 * Token values are set on <html> from lib/theme/themes.ts (layout + boot script).
 * Component hooks (.mc-*) are a public contract: see docs/theming-hooks.md.
 */

@theme inline {
  --color-mc-bg: var(--mc-bg);
  --color-mc-surface: var(--mc-surface);
  --color-mc-ink: var(--mc-ink);
  --color-mc-ink-muted: var(--mc-ink-muted);
  --color-mc-outline: var(--mc-outline);
  --color-mc-accent: var(--mc-accent-course);
  --font-display: var(--mc-font-display);
  --font-body: var(--mc-font-body);
  --radius-panel: var(--mc-radius-panel);
  --radius-button: var(--mc-radius-button);
}

/* Base ------------------------------------------------------------------ */

html {
  background: var(--mc-bg);
  color: var(--mc-ink);
  font-family: var(--mc-font-body);
  -webkit-text-size-adjust: 100%;
}

body.mc-body {
  margin: 0;
  min-height: 100dvh;
  font-size: 1rem;
  line-height: 1.5;
}

h1,
h2,
h3 {
  margin: 0;
  font-family: var(--mc-font-display);
  font-weight: 400;
  line-height: 1.15;
  letter-spacing: 0.01em;
}

p {
  margin: 0;
}

button,
input,
select {
  font: inherit;
  color: inherit;
}

input[type="radio"],
input[type="checkbox"] {
  accent-color: var(--mc-ink);
}

:focus-visible {
  outline: calc(var(--mc-border-width) + 1px) solid var(--mc-focus);
  outline-offset: 2px;
}

.mc-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}

.mc-skip-link {
  position: absolute;
  left: 1rem;
  top: -4rem;
  z-index: 10;
  padding: 0.5rem 1rem;
  background: var(--mc-surface);
  border: var(--mc-border-width) solid var(--mc-outline);
  border-radius: var(--mc-radius-button);
}

.mc-skip-link:focus {
  top: 0.75rem;
}

.mc-muted {
  color: var(--mc-ink-muted);
}

/* Buttons and links ------------------------------------------------------ */

.mc-button,
.mc-panel button,
.mc-panel a,
.mc-dialogue-skip,
.mc-move-input button,
.mc-storage-banner button,
.mc-workspace-map-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  min-height: 2.5rem;
  padding: 0.35rem 1rem;
  background: var(--mc-surface);
  color: var(--mc-ink);
  border: var(--mc-border-width) solid var(--mc-outline);
  border-radius: var(--mc-radius-button);
  font-weight: 700;
  text-decoration: none;
  cursor: pointer;
  transition: background-color var(--mc-duration-move) ease-out, transform var(--mc-duration-move) ease-out;
}

.mc-button:hover,
.mc-panel button:hover:not(:disabled),
.mc-panel a:hover,
.mc-dialogue-skip:hover,
.mc-move-input button:hover:not(:disabled),
.mc-workspace-map-toggle:hover {
  background: var(--mc-accent-course);
  color: var(--mc-on-accent);
}

.mc-panel button:active:not(:disabled),
.mc-move-input button:active:not(:disabled) {
  transform: translateY(1px);
}

.mc-panel button:disabled,
.mc-move-input button:disabled,
.mc-move-input input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.mc-panel button[aria-current="step"] {
  background: var(--mc-ink);
  color: var(--mc-surface);
}

/* App shell -------------------------------------------------------------- */

.mc-topbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem 1.5rem;
  padding: 0.75rem clamp(1rem, 3vw, 2rem);
  border-bottom: var(--mc-border-width) solid var(--mc-outline);
  background: var(--mc-surface);
}

.mc-wordmark {
  font-family: var(--mc-font-display);
  font-size: 1.6rem;
  line-height: 1;
  color: var(--mc-ink);
  /* The one decorative flourish: a thick sunflower underline below the letters. */
  text-decoration: underline;
  text-decoration-color: var(--mc-accent-course);
  text-decoration-thickness: 0.2em;
  text-underline-offset: 0.12em;
}

.mc-topbar-nav {
  display: flex;
  gap: 0.25rem;
  flex-wrap: wrap;
}

.mc-topbar-nav a {
  padding: 0.35rem 0.8rem;
  border-radius: var(--mc-radius-button);
  color: var(--mc-ink);
  font-weight: 700;
  text-decoration: none;
}

.mc-topbar-nav a:hover {
  background: var(--mc-bg);
}

.mc-topbar-nav a[aria-current="page"] {
  background: var(--mc-ink);
  color: var(--mc-surface);
}

.mc-side-toggle {
  display: inline-flex;
  margin: 0 0 0 auto;
  padding: 0;
  border: var(--mc-border-width) solid var(--mc-outline);
  border-radius: var(--mc-radius-button);
  overflow: hidden;
}

.mc-side-toggle label {
  position: relative;
  padding: 0.3rem 0.9rem;
  font-weight: 700;
  cursor: pointer;
}

.mc-side-toggle input {
  position: absolute;
  opacity: 0;
  inset: 0;
  cursor: pointer;
}

.mc-side-toggle label:has(input:checked) {
  background: var(--mc-accent-course);
  color: var(--mc-on-accent);
}

.mc-side-toggle label:has(input:focus-visible) {
  outline: calc(var(--mc-border-width) + 1px) solid var(--mc-focus);
  outline-offset: -4px;
}

.mc-main {
  max-width: 88rem;
  margin-inline: auto;
  padding-inline: clamp(1rem, 3vw, 2rem);
  padding-block: 1.5rem 3rem;
}

.mc-storage-banner {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.75rem clamp(1rem, 3vw, 2rem);
  background: var(--mc-accent-course);
  color: var(--mc-on-accent);
  border-bottom: var(--mc-border-width) solid var(--mc-outline);
  font-weight: 700;
}

/* Panels ----------------------------------------------------------------- */

.mc-panel {
  display: grid;
  gap: 0.75rem;
  align-content: start;
  padding: 1rem 1.125rem 1.25rem;
  background: var(--mc-surface);
  border: var(--mc-border-width) solid var(--mc-outline);
  border-radius: var(--mc-radius-panel);
}

.mc-panel-title {
  font-size: clamp(1.5rem, 1.2rem + 1vw, 2.1rem);
}

.mc-panel-heading {
  margin-top: 0.5rem;
  font-family: var(--mc-font-body);
  font-size: 1rem;
  font-weight: 700;
}

.mc-button-row,
.mc-move-list,
.mc-next-moves,
.mc-line-links {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.mc-move-list button,
.mc-next-moves button {
  min-height: 2.1rem;
  padding-inline: 0.7rem;
  font-variant-numeric: tabular-nums;
}

.mc-notice {
  padding: 0.6rem 0.8rem;
  background: var(--mc-mistake);
  color: var(--mc-on-mistake);
  border: var(--mc-border-width) solid var(--mc-outline);
  border-radius: calc(var(--mc-radius-panel) / 2);
  font-weight: 700;
}

.mc-learn-phase {
  font-weight: 700;
}

.mc-learn-phase[data-phase="completed"] {
  justify-self: start;
  padding: 0.1rem 0.7rem;
  background: var(--mc-correct);
  color: var(--mc-on-correct);
  border-radius: var(--mc-radius-button);
}

.mc-learn-progress,
.mc-review-progress {
  font-variant-numeric: tabular-nums;
  color: var(--mc-ink-muted);
}

.mc-review-summary {
  max-width: 36rem;
}

/* Workspace layout -------------------------------------------------------- */

.mc-workspace {
  display: grid;
  gap: 1.25rem;
  align-items: start;
  grid-template-columns: minmax(12rem, 19rem) minmax(0, 1fr) auto minmax(16rem, 20rem);
  grid-template-areas: "map stage dock panel";
}

.mc-workspace[data-has-map="false"] {
  grid-template-columns: minmax(0, 1fr) auto minmax(16rem, 20rem);
  grid-template-areas: "stage dock panel";
}

.mc-workspace-map {
  grid-area: map;
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 0.5rem;
}

.mc-workspace-map-toggle {
  display: none;
}

.mc-workspace-stage {
  grid-area: stage;
  display: grid;
  gap: 1.5rem;
  width: 100%;
  max-width: max(18rem, min(44rem, calc(100dvh - 21rem)));
  justify-self: center;
}

.mc-workspace-dock {
  grid-area: dock;
}

.mc-workspace-dock[data-state="closed"] {
  width: 0;
}

.mc-workspace-panel {
  grid-area: panel;
}

@media (max-width: 68rem) {
  .mc-workspace,
  .mc-workspace[data-has-map="false"] {
    grid-template-columns: minmax(0, 1fr) minmax(15rem, 19rem);
    grid-template-areas:
      "map map"
      "stage panel"
      "dock dock";
  }

  .mc-workspace[data-has-map="false"] {
    grid-template-areas:
      "stage panel"
      "dock dock";
  }

  .mc-workspace-map-toggle {
    display: inline-flex;
    justify-self: start;
  }

  .mc-workspace-map[data-open="false"] .mc-workspace-map-body {
    display: none;
  }
}

@media (max-width: 45rem) {
  .mc-workspace,
  .mc-workspace[data-has-map="false"] {
    grid-template-columns: minmax(0, 1fr);
    grid-template-areas:
      "stage"
      "panel"
      "map"
      "dock";
  }

  .mc-workspace[data-has-map="false"] {
    grid-template-areas:
      "stage"
      "panel"
      "dock";
  }

  .mc-workspace-stage {
    max-width: none;
  }
}

/* Board ------------------------------------------------------------------- */

.mc-board-wrap {
  display: grid;
  gap: 0.75rem;
}

.mc-board {
  position: relative;
  aspect-ratio: 1 / 1;
  border: var(--mc-border-width) solid var(--mc-outline);
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
}

.mc-board-svg {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
}

.mc-square-mark[data-mark="last-move"] {
  fill: var(--mc-accent-course);
  opacity: 0.4;
}

.mc-square-mark[data-mark="selected"] {
  fill: none;
  stroke: var(--mc-focus);
  stroke-width: 0.07;
}

.mc-highlight {
  opacity: 0.45;
}

.mc-feedback {
  opacity: 0.55;
  animation: moechess-flash var(--mc-duration-feedback) ease-out;
}

.mc-target {
  fill: var(--mc-ink);
  opacity: 0.3;
  pointer-events: none;
}

.mc-piece {
  transition: transform var(--mc-duration-move) cubic-bezier(0.2, 0.8, 0.2, 1);
  pointer-events: none;
}

.mc-arrow {
  stroke-width: 0.17;
  stroke-linecap: round;
  opacity: 0.9;
  pointer-events: none;
}

.mc-board-grid {
  position: absolute;
  inset: 0;
  display: grid;
  grid-template: repeat(8, 1fr) / repeat(8, 1fr);
}

.mc-board-grid button {
  margin: 0;
  padding: 0;
  background: transparent;
  border: 0;
  border-radius: 0;
  cursor: default;
}

.mc-board[data-interactive="true"] .mc-board-grid button {
  cursor: pointer;
}

.mc-board-grid button:focus-visible {
  outline: calc(var(--mc-border-width) + 1px) solid var(--mc-focus);
  outline-offset: calc(-1 * (var(--mc-border-width) + 1px));
}

.mc-move-input {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}

.mc-move-input label {
  font-weight: 700;
}

.mc-move-input input {
  width: 7rem;
  min-height: 2.5rem;
  padding: 0.3rem 0.9rem;
  background: var(--mc-surface);
  border: var(--mc-border-width) solid var(--mc-outline);
  border-radius: var(--mc-radius-button);
  font-variant-numeric: tabular-nums;
}

.mc-move-error {
  flex-basis: 100%;
  padding: 0.4rem 0.8rem;
  background: var(--mc-mistake);
  color: var(--mc-on-mistake);
  border-radius: calc(var(--mc-radius-panel) / 2);
  font-weight: 700;
}

@keyframes moechess-flash {
  from {
    opacity: 0.95;
  }
  to {
    opacity: 0.55;
  }
}

/* Dialogue: the visual-novel box under the board ------------------------- */

.mc-dialogue {
  position: relative;
  padding: 1.75rem 1.25rem 0.9rem;
  background: var(--mc-surface);
  border: var(--mc-border-width) solid var(--mc-outline);
  border-radius: var(--mc-radius-panel);
  box-shadow: calc(var(--mc-border-width) * 3) calc(var(--mc-border-width) * 3) 0 var(--mc-outline);
}

.mc-dialogue-nametag {
  position: absolute;
  top: 0;
  left: 1rem;
  transform: translateY(-55%);
  padding: 0.15rem 0.9rem;
  background: var(--mc-accent-course);
  color: var(--mc-on-accent);
  border: var(--mc-border-width) solid var(--mc-outline);
  border-radius: var(--mc-radius-button);
  font-family: var(--mc-font-display);
  font-size: 1rem;
}

.mc-dialogue-body {
  cursor: pointer;
}

.mc-dialogue[data-state="complete"] .mc-dialogue-body {
  cursor: auto;
}

.mc-dialogue-text {
  max-width: 62ch;
  min-height: 3.2em;
  font-size: 1.125rem;
  line-height: 1.6;
}

.mc-dialogue-empty {
  color: var(--mc-ink-muted);
}

.mc-dialogue-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  min-height: 2.5rem;
  margin-top: 0.5rem;
}

.mc-dialogue-source {
  font-size: 0.875rem;
  color: var(--mc-ink-muted);
}

.mc-dialogue-skip {
  margin-left: auto;
}

/* Branch map: the course as a transit map -------------------------------- */

.mc-branch-map {
  max-height: calc(100dvh - 9rem);
  overflow: auto;
  padding: 0.5rem;
  background: var(--mc-surface);
  border: var(--mc-border-width) solid var(--mc-outline);
  border-radius: var(--mc-radius-panel);
}

.mc-branch-map-canvas {
  position: relative;
}

.mc-branch-map-svg {
  position: absolute;
  inset: 0;
  overflow: visible;
}

.mc-branch {
  fill: none;
  stroke: var(--mc-ink);
  stroke-width: 2;
  stroke-linecap: round;
  opacity: 0.4;
  transition: stroke var(--mc-duration-feedback) ease-out, stroke-width var(--mc-duration-feedback) ease-out,
    opacity var(--mc-duration-feedback) ease-out;
}

.mc-branch[data-state="learned"] {
  stroke: var(--mc-accent-course);
  stroke-width: 6;
  opacity: 1;
}

.mc-station {
  fill: var(--mc-surface);
  stroke: var(--mc-ink);
  stroke-width: 2;
}

.mc-station[data-role="pass"] {
  fill: var(--mc-ink);
  stroke: none;
  opacity: 0.55;
}

.mc-station[data-role="pass"][data-state="learned"] {
  fill: var(--mc-outline);
  opacity: 1;
}

.mc-station[data-role="stop"][data-state="learned"] {
  fill: var(--mc-accent-course);
  stroke: var(--mc-outline);
}

.mc-station[data-role="stop"][data-state="due"] {
  fill: var(--mc-mistake);
  stroke: var(--mc-outline);
}

.mc-station[data-role="stop"][data-state="current"] {
  fill: var(--mc-ink);
  stroke: var(--mc-accent-course);
  stroke-width: 3;
}

.mc-station[data-kind="collapsed"] {
  stroke-dasharray: 2 2;
}

.mc-branch-leader {
  fill: none;
  stroke: var(--mc-ink-muted);
  stroke-width: 1;
  stroke-dasharray: 2 3;
}

.mc-branch-label {
  fill: var(--mc-ink-muted);
  font-size: 12px;
  font-weight: 700;
}

.mc-branch-label[data-state="learned"] {
  fill: var(--mc-ink);
}

.mc-branch-station-button {
  position: absolute;
  width: 22px;
  height: 22px;
  padding: 0;
  transform: translate(-50%, -50%);
  background: transparent;
  border: 0;
  border-radius: 50%;
  cursor: pointer;
}

.mc-learned-stamp {
  position: absolute;
  padding: 0.05rem 0.6rem;
  transform: translateY(-50%) rotate(-7deg);
  background: var(--mc-accent-course);
  color: var(--mc-on-accent);
  border: var(--mc-border-width) solid var(--mc-outline);
  border-radius: calc(var(--mc-radius-panel) / 3);
  font-family: var(--mc-font-display);
  white-space: nowrap;
  animation: moechess-stamp var(--mc-duration-feedback) cubic-bezier(0.2, 1.4, 0.4, 1) both;
}

@keyframes moechess-stamp {
  from {
    opacity: 0;
    transform: translateY(-50%) rotate(-7deg) scale(2.4);
  }
  to {
    opacity: 1;
    transform: translateY(-50%) rotate(-7deg) scale(1);
  }
}

/* Home, settings, credits ------------------------------------------------ */

.mc-page-title {
  font-size: clamp(2rem, 1.4rem + 2.5vw, 3.4rem);
  max-width: 18ch;
}

.mc-page-intro {
  max-width: 60ch;
  margin-top: 0.75rem;
  font-size: 1.125rem;
}

.mc-course-list {
  display: grid;
  gap: 1rem;
  margin: 2rem 0 0;
  padding: 0;
  list-style: none;
}

.mc-course {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.75rem 1.5rem;
}

.mc-course-name {
  font-size: clamp(1.6rem, 1.3rem + 1vw, 2.2rem);
}

.mc-course-stats {
  font-variant-numeric: tabular-nums;
  color: var(--mc-ink-muted);
}

@media (max-width: 45rem) {
  .mc-course {
    grid-template-columns: minmax(0, 1fr);
  }
}

.mc-settings {
  display: grid;
  gap: 1.5rem;
  max-width: 44rem;
  margin-top: 1.5rem;
}

.mc-settings fieldset {
  display: grid;
  gap: 0.75rem;
  margin: 0;
  padding: 1rem 1.125rem 1.25rem;
  background: var(--mc-surface);
  border: var(--mc-border-width) solid var(--mc-outline);
  border-radius: var(--mc-radius-panel);
}

.mc-settings legend {
  padding: 0 0.4rem;
  font-weight: 700;
}

.mc-theme-options {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
  gap: 0.75rem;
}

.mc-theme-option {
  position: relative;
  display: grid;
  gap: 0.5rem;
  padding: 0.75rem;
  border: var(--mc-border-width) solid var(--mc-outline);
  border-radius: calc(var(--mc-radius-panel) / 1.5);
  cursor: pointer;
}

.mc-theme-option:has(input:checked) {
  box-shadow: 0 0 0 calc(var(--mc-border-width) * 2) var(--mc-accent-course);
}

.mc-theme-option input {
  position: absolute;
  opacity: 0;
}

.mc-theme-option:has(input:focus-visible) {
  outline: calc(var(--mc-border-width) + 1px) solid var(--mc-focus);
  outline-offset: 3px;
}

.mc-theme-swatch {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  height: 2.5rem;
  border: var(--mc-border-width) solid var(--mc-outline);
  border-radius: calc(var(--mc-radius-panel) / 3);
  overflow: hidden;
}

.mc-settings input[type="number"] {
  width: 6rem;
  min-height: 2.5rem;
  padding: 0.3rem 0.8rem;
  background: var(--mc-surface);
  border: var(--mc-border-width) solid var(--mc-outline);
  border-radius: var(--mc-radius-button);
}

.mc-radio-row {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
}

.mc-credits {
  display: grid;
  gap: 1rem;
  max-width: 44rem;
  margin: 1.5rem 0 0;
  padding: 0;
  list-style: none;
}

.mc-credits a {
  color: var(--mc-ink);
}

/* Motion preferences ------------------------------------------------------ */

@media (prefers-reduced-motion: reduce) {
  .mc-piece,
  .mc-branch,
  .mc-button,
  .mc-panel button,
  .mc-panel a {
    transition: none;
  }

  .mc-feedback,
  .mc-learned-stamp {
    animation: none;
  }
}
```

- [ ] **Step 10: Replace `app/layout.tsx`**

```tsx
import type { Metadata } from "next";
import type { CSSProperties } from "react";
import { Atkinson_Hyperlegible_Next, Dela_Gothic_One } from "next/font/google";
import { TopBar } from "@/components/nav/TopBar";
import { StorageBanner } from "@/components/workspace/StorageBanner";
import { WorkspaceProvider } from "@/components/workspace/Providers";
import { SETTINGS_KEY } from "@/lib/settings/types";
import { themeBootScript, themeCssVariables } from "@/lib/theme/apply";
import { BUILT_IN_THEMES, SUMMER_SKY } from "@/lib/theme/themes";
import "./globals.css";

const display = Dela_Gothic_One({ weight: "400", subsets: ["latin"], variable: "--mc-face-display" });
// Next can't compute fallback metrics for this family, so use a plain system fallback.
const body = Atkinson_Hyperlegible_Next({
  subsets: ["latin"],
  variable: "--mc-face-body",
  adjustFontFallback: false,
  fallback: ["system-ui", "sans-serif"],
});

export const metadata: Metadata = {
  title: { default: "Moechess", template: "%s | Moechess" },
  description: "Learn chess openings move by move, then drill them with spaced repetition.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      data-theme={SUMMER_SKY.id}
      className={`${display.variable} ${body.variable}`}
      style={themeCssVariables(SUMMER_SKY) as CSSProperties}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript(BUILT_IN_THEMES, SETTINGS_KEY) }} />
      </head>
      <body className="mc-body">
        <WorkspaceProvider>
          <a className="mc-skip-link" href="#main">Skip to content</a>
          <TopBar />
          <StorageBanner />
          <main id="main" className="mc-main">
            {children}
          </main>
        </WorkspaceProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 11: Replace `app/page.tsx`**

```tsx
import { CourseList } from "@/components/home/CourseList";
import { loadAllCourses } from "@/lib/course/load";

export default function HomePage() {
  const courses = loadAllCourses();
  return (
    <>
      <h1 className="mc-page-title">Learn an opening one line at a time</h1>
      <p className="mc-page-intro">
        Explore a line with notes, play it until you know it, then keep it fresh with short reviews.
      </p>
      <CourseList courses={courses} />
    </>
  );
}
```

- [ ] **Step 12: Create `app/course/[slug]/page.tsx`**

```tsx
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ExploreView } from "@/components/modes/ExploreView";
import { listCourseSlugs, loadCourse } from "@/lib/course/load";

export const dynamicParams = false;

export function generateStaticParams() {
  return listCourseSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata(props: PageProps<"/course/[slug]">): Promise<Metadata> {
  const { slug } = await props.params;
  return { title: loadCourse(slug)?.meta.name ?? "Course not found" };
}

export default async function CoursePage(props: PageProps<"/course/[slug]">) {
  const { slug } = await props.params;
  const course = loadCourse(slug);
  if (!course) notFound();
  return <ExploreView tree={course} />;
}
```

- [ ] **Step 13: Create `app/course/[slug]/learn/[line]/page.tsx`**

```tsx
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LearnView } from "@/components/modes/LearnView";
import { findLine } from "@/lib/course/queries";
import { loadAllCourses, loadCourse } from "@/lib/course/load";

export const dynamicParams = false;

export function generateStaticParams() {
  return loadAllCourses().flatMap((course) =>
    course.lines.map((line) => ({ slug: course.meta.slug, line: line.id })));
}

export async function generateMetadata(props: PageProps<"/course/[slug]/learn/[line]">): Promise<Metadata> {
  const { slug, line } = await props.params;
  const course = loadCourse(slug);
  const found = course ? findLine(course, line) : undefined;
  return { title: course && found ? `Learn ${found.name}` : "Line not found" };
}

export default async function LearnPage(props: PageProps<"/course/[slug]/learn/[line]">) {
  const { slug, line } = await props.params;
  const course = loadCourse(slug);
  if (!course || !findLine(course, line)) notFound();
  return <LearnView tree={course} lineId={line} />;
}
```

- [ ] **Step 14: Create `app/review/page.tsx`**

```tsx
import type { Metadata } from "next";
import { ReviewView } from "@/components/modes/ReviewView";
import { loadAllCourses } from "@/lib/course/load";

export const metadata: Metadata = { title: "Review" };

export default function ReviewPage() {
  return <ReviewView trees={loadAllCourses()} />;
}
```

- [ ] **Step 15: Create `app/settings/page.tsx`**

```tsx
import type { Metadata } from "next";
import { SettingsForm } from "@/components/settings/SettingsForm";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <>
      <h1 className="mc-page-title">Settings</h1>
      <SettingsForm />
    </>
  );
}
```

- [ ] **Step 16: Create `app/credits/page.tsx`**

```tsx
import type { Metadata } from "next";
import { loadAllCourses } from "@/lib/course/load";
import type { Credit } from "@/lib/course/types";
import { PIECE_SETS } from "@/lib/theme/skins";

export const metadata: Metadata = { title: "Credits" };

const FONT_CREDITS: Credit[] = [
  { label: "Display type: Dela Gothic One", author: "artakana", url: "https://fonts.google.com/specimen/Dela+Gothic+One", license: "SIL Open Font License 1.1" },
  { label: "Text type: Atkinson Hyperlegible Next", author: "Braille Institute", url: "https://fonts.google.com/specimen/Atkinson+Hyperlegible+Next", license: "SIL Open Font License 1.1" },
];

function CreditItem({ credit }: { credit: Credit }) {
  return (
    <li className="mc-panel">
      <h2 className="mc-panel-heading">{credit.label}</h2>
      <p>
        {credit.author && <>{credit.author}. </>}
        License: {credit.license}.
      </p>
      {credit.url && <a href={credit.url}>View source</a>}
    </li>
  );
}

export default function CreditsPage() {
  const courses = loadAllCourses();
  return (
    <>
      <h1 className="mc-page-title">Credits</h1>
      <p className="mc-page-intro">
        Course notes are shared under each course&apos;s content license. The Moechess code is separate from this content.
      </p>
      <ul className="mc-credits">
        {courses.map((course) => (
          <li key={course.meta.slug} className="mc-panel">
            <h2 className="mc-panel-heading">{course.meta.name}</h2>
            <p>Content license: {course.meta.contentLicense}.</p>
            <ul className="mc-credits">
              {course.meta.credits.map((credit) => <CreditItem key={credit.label} credit={credit} />)}
            </ul>
          </li>
        ))}
        {Object.values(PIECE_SETS).map((set) => <CreditItem key={set.id} credit={set.credit} />)}
        {FONT_CREDITS.map((credit) => <CreditItem key={credit.label} credit={credit} />)}
      </ul>
    </>
  );
}
```

- [ ] **Step 17: Delete the starter assets**

```bash
git rm public/file.svg public/globe.svg public/next.svg public/vercel.svg public/window.svg
```

- [ ] **Step 18: Verify everything, including a production build**

Run: `pnpm test && pnpm typecheck && pnpm lint && pnpm build`
Expected:
- All tests pass and there are no type or lint errors.
- The build lists `/course/ruy-lopez` and seven `/course/ruy-lopez/learn/*` pages as SSG.
- There is no font warning.

Then run `pnpm dev` and check in a browser:
- `/course/ruy-lopez` shows the board, the dialogue box and the branch map.
- Typing `e4` advances the position.
- `/settings` → Night Shift recolours the page, and the theme survives a reload without a flash.

- [ ] **Step 19: Commit**

```bash
git add app components/nav components/home components/settings tests/unit/components/shell.test.tsx
git commit -m "feat: add app shell, routes, settings and credits"
```

---

### Task 21: Theming hook contract

**Files:**
- Create: `docs/theming-hooks.md`
- Test: `tests/unit/theme-contract.test.ts`

**Interfaces:**
- Consumes: `TOKEN_NAMES`, `cssVar` from `@/lib/theme/tokens`; every `mc-` class in `app/` and `components/`.
- Produces: the documented, versioned styling contract (spec §9.2), enforced by tests in both directions.

- [ ] **Step 1: Write the failing contract test `tests/unit/theme-contract.test.ts`**

```ts
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { TOKEN_NAMES, cssVar } from "@/lib/theme/tokens";

const ROOT = process.cwd();

function sourceFiles(dir: string): string[] {
  return readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const relative = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(relative);
    return /\.(tsx?|css)$/.test(entry.name) ? [relative] : [];
  });
}

const doc = readFileSync(path.join(ROOT, "docs/theming-hooks.md"), "utf8");
const documentedHooks = new Set([...doc.matchAll(/`\.(mc-[a-z0-9-]+)/g)].map((m) => m[1]));
const documentedTokens = new Set([...doc.matchAll(/`(--mc-[a-z0-9-]+)`/g)].map((m) => m[1]));

const source = ["app", "components"].flatMap(sourceFiles).map((file) => readFileSync(path.join(ROOT, file), "utf8")).join("\n");
// `mc-` preceded by a letter, digit or hyphen is part of something else (for example `--mc-bg`).
const usedHooks = new Set([...source.matchAll(/(?<![\w-])(mc-[a-z][a-z0-9-]*)/g)].map((m) => m[1]));

describe("theming hook contract", () => {
  test("every mc- class used in app/ and components/ is documented", () => {
    expect([...usedHooks].filter((hook) => !documentedHooks.has(hook)).sort()).toEqual([]);
  });

  test("every documented hook still exists", () => {
    expect([...documentedHooks].filter((hook) => !usedHooks.has(hook)).sort()).toEqual([]);
  });

  test("every theme token is documented, and nothing else", () => {
    const tokens = TOKEN_NAMES.map((name) => cssVar(name));
    expect(tokens.filter((token) => !documentedTokens.has(token))).toEqual([]);
    expect([...documentedTokens].filter((token) => !tokens.includes(token as (typeof tokens)[number]))).toEqual([]);
  });

  test("components and pages reference only defined tokens", () => {
    const allowed = new Set([...TOKEN_NAMES.map((name) => cssVar(name)), "--mc-face-display", "--mc-face-body"]);
    const referenced = new Set([...source.matchAll(/var\((--mc-[a-z0-9-]+)\)/g)].map((m) => m[1]));
    // Board and dialogue build brush and board token names from data, e.g. `--mc-brush-${brush}`.
    const unknown = [...referenced].filter((token) => !allowed.has(token));
    expect(unknown).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test tests/unit/theme-contract.test.ts`
Expected: FAIL with `ENOENT` for `docs/theming-hooks.md`.

- [ ] **Step 3: Create `docs/theming-hooks.md`**

```markdown
# Moechess theming hooks

This is the public styling contract. Themes, user skins and (one day) user CSS
may rely on everything listed here. Tailwind utility classes are **not** part of
the contract and can change at any time.

Rules:

- Removing or renaming a hook, token or data attribute is a breaking change.
  Bump the contract version below and note it in the changelog.
- Every `mc-` class in `app/` and `components/` must be listed here, and
  everything listed here must exist. `tests/unit/theme-contract.test.ts`
  enforces both directions.
- Never style a hook with a hard-coded colour, font, radius, border width or
  duration. Use the tokens.

Contract version: **1**

## Tokens

Set on `<html>` as CSS custom properties. The active theme id is on
`html[data-theme]`.

| Token | Role |
| --- | --- |
| `--mc-bg` | Page background |
| `--mc-surface` | Panels, dialogue box, inputs |
| `--mc-ink` | Text and strokes |
| `--mc-ink-muted` | Secondary text |
| `--mc-outline` | Panel and board outlines |
| `--mc-focus` | Keyboard focus ring |
| `--mc-board-light` | Light squares |
| `--mc-board-dark` | Dark squares |
| `--mc-accent-course` | The course's move: hints, learned routes, name tag |
| `--mc-on-accent` | Text on the accent |
| `--mc-correct` | Correct feedback |
| `--mc-on-correct` | Text on correct |
| `--mc-mistake` | Mistake feedback and due stations |
| `--mc-on-mistake` | Text on mistake |
| `--mc-brush-g` | PGN green arrows and highlights |
| `--mc-brush-r` | PGN red arrows and highlights |
| `--mc-brush-y` | PGN yellow arrows and highlights |
| `--mc-brush-b` | PGN blue arrows and highlights |
| `--mc-font-display` | Display type |
| `--mc-font-body` | Text and notation |
| `--mc-radius-panel` | Panel corners |
| `--mc-radius-button` | Button corners |
| `--mc-border-width` | Outline width |
| `--mc-duration-move` | Piece slides and small transitions |
| `--mc-duration-feedback` | Feedback flashes, route fill, learned stamp |

## App shell

| Hook | Element |
| --- | --- |
| `.mc-body` | `<body>` |
| `.mc-skip-link` | "Skip to content" link |
| `.mc-topbar` | Top bar |
| `.mc-wordmark` | Moechess wordmark link |
| `.mc-topbar-nav` | Main navigation |
| `.mc-side-toggle` | White / Black switch |
| `.mc-main` | Main content area |
| `.mc-storage-banner` | Storage warning. `[data-kind="unavailable\|recovered\|newer-schema"]` |
| `.mc-sr-only` | Visually hidden text |
| `.mc-muted` | Secondary text |
| `.mc-button` | Generic button style |
| `.mc-page-title` | Page heading |
| `.mc-page-intro` | Page introduction |

## Panels

| Hook | Element |
| --- | --- |
| `.mc-panel` | Outlined panel |
| `.mc-panel-title` | Panel heading |
| `.mc-panel-heading` | Section heading inside a panel |
| `.mc-button-row` | Row of actions |
| `.mc-notice` | Inline problem message |

## Workspace

| Hook | Element |
| --- | --- |
| `.mc-workspace` | Workspace grid. `[data-dock="open\|closed"]`, `[data-has-map]` |
| `.mc-workspace-map` | Lines column or drawer. `[data-open]` |
| `.mc-workspace-map-toggle` | "Show lines" button on small screens |
| `.mc-workspace-map-body` | Drawer content |
| `.mc-workspace-stage` | Board and dialogue column |
| `.mc-workspace-board` | Board slot |
| `.mc-workspace-dialogue` | Dialogue slot |
| `.mc-workspace-dock` | Companion dock. `[data-state="open\|closed"]` |
| `.mc-workspace-panel` | Side panel slot |

## Board

| Hook | Element |
| --- | --- |
| `.mc-board-wrap` | Board plus typed-move form |
| `.mc-board` | Board frame. `[data-orientation="white\|black"]`, `[data-interactive]`, `[data-state="correct\|mistake\|hint"]` |
| `.mc-board-svg` | Drawing layer |
| `.mc-square` | Square. `[data-square="e4"]`, `[data-color="light\|dark"]` |
| `.mc-square-mark` | Square marker. `[data-mark="last-move\|selected"]` |
| `.mc-highlight` | PGN square highlight. `[data-brush="G\|R\|Y\|B"]` |
| `.mc-feedback` | Feedback flash. `[data-state="correct\|mistake\|hint"]` |
| `.mc-target` | Legal move dot |
| `.mc-piece` | Piece image. `[data-piece="wN"]`, `[data-square]` |
| `.mc-arrow` | Arrow. `[data-brush="G\|R\|Y\|B"]` |
| `.mc-board-grid` | Invisible input grid of square buttons |
| `.mc-move-input` | Typed move form |
| `.mc-move-error` | Typed move error |

## Dialogue

| Hook | Element |
| --- | --- |
| `.mc-dialogue` | Dialogue box. `[data-state="typing\|complete"]` |
| `.mc-dialogue-nametag` | Speaker name tag |
| `.mc-dialogue-body` | Clickable text area |
| `.mc-dialogue-text` | Typed text |
| `.mc-dialogue-empty` | "No notes" text |
| `.mc-dialogue-footer` | Source and skip row |
| `.mc-dialogue-source` | Source credit |
| `.mc-dialogue-skip` | "Show all" button |

## Branch map

| Hook | Element |
| --- | --- |
| `.mc-branch-map` | Scrollable map |
| `.mc-branch-map-canvas` | Positioned canvas |
| `.mc-branch-map-svg` | Drawing layer |
| `.mc-branch` | Route segment. `[data-state="learned\|unlearned"]` |
| `.mc-station` | Station dot. `[data-kind="move\|collapsed"]`, `[data-role="stop\|pass"]`, `[data-state="current\|due\|learned\|unlearned"]` |
| `.mc-branch-leader` | Dotted line from a line's last station to its name |
| `.mc-branch-label` | Line name. `[data-state]` |
| `.mc-branch-station-button` | Station button. `[data-kind]` |
| `.mc-learned-stamp` | "Learned!" stamp |

## Modes

| Hook | Element |
| --- | --- |
| `.mc-explore-panel` | Explore side panel |
| `.mc-move-list` | Moves played |
| `.mc-next-moves` | Next course moves |
| `.mc-line-links` | Links to learn lines |
| `.mc-learn-panel` | Learn side panel |
| `.mc-learn-phase` | Learn step. `[data-phase="guided\|recall\|completed"]` |
| `.mc-learn-progress` | "Your move N of M" |
| `.mc-review-panel` | Review side panel |
| `.mc-review-progress` | Review count |
| `.mc-review-summary` | End-of-session or nothing-due panel |

## Home, settings and credits

| Hook | Element |
| --- | --- |
| `.mc-course-list` | Course list |
| `.mc-course` | One course |
| `.mc-course-name` | Course name |
| `.mc-course-stats` | Learned and due counts |
| `.mc-settings` | Settings form |
| `.mc-theme-options` | Theme choices |
| `.mc-theme-option` | One theme choice. `[data-theme-id]` |
| `.mc-theme-swatch` | Theme colour preview |
| `.mc-radio-row` | Row of radio options |
| `.mc-credits` | Credits list |
```

- [ ] **Step 4: Run the contract test to verify it passes**

Run: `pnpm test tests/unit/theme-contract.test.ts`
Expected: 4 tests pass. If a hook is reported as undocumented, add it to the doc. If a documented hook is reported missing, a component renamed a hook, which is a contract break: rename it back.

- [ ] **Step 5: Commit**

```bash
git add docs/theming-hooks.md tests/unit/theme-contract.test.ts
git commit -m "docs: publish theming hook contract with enforcement test"
```

---

### Task 22: End-to-end trainer test

**Files:**
- Create: `tests/e2e/trainer.spec.ts`

**Interfaces:**
- Consumes: the built app (Playwright's `webServer` from Task 1 runs `pnpm build && pnpm start --port 3100`).

The first test is the spec §12 loop: learn a line, reload, advance the mocked clock one day, review it, and check the saved grades. `page.clock.install` fakes `Date` and timers while letting time flow, so the opponent's auto-moves still happen. The second test checks that a saved theme is applied by the boot script before React loads.

- [ ] **Step 1: Write `tests/e2e/trainer.spec.ts`**

```ts
import { expect, test, type Page } from "@playwright/test";

const BERLIN_WHITE_MOVES = ["e4", "Nf3", "Bb5", "O-O", "d4", "Bxc6", "dxe5", "Qxd8+", "Nc3", "h3"];

async function play(page: Page, san: string) {
  const input = page.getByRole("textbox", { name: "Type a move" });
  await expect(input).toBeEnabled();
  await input.fill(san);
  await input.press("Enter");
}

test("learn the Berlin, reload, and review it the next day", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-03-01T09:00:00.000Z") });

  await page.goto("/course/ruy-lopez/learn/berlin");
  await expect(page.getByRole("heading", { name: "Berlin Defence" })).toBeVisible();

  await expect(page.getByText("Step 1 of 2: follow the highlighted moves")).toBeVisible();
  for (const san of BERLIN_WHITE_MOVES) await play(page, san);

  await expect(page.getByText("Step 2 of 2: play the line from memory")).toBeVisible();
  for (const san of BERLIN_WHITE_MOVES) await play(page, san);

  await expect(page.getByRole("status").filter({ hasText: "Learned!" })).toBeVisible();

  await page.reload();
  await page.goto("/review");
  await expect(page.getByRole("heading", { name: "Nothing is due right now" })).toBeVisible();

  await page.clock.fastForward("24:00:00");
  await page.goto("/review");
  await expect(page.getByRole("heading", { name: "Berlin Defence" })).toBeVisible();
  for (const san of BERLIN_WHITE_MOVES) await play(page, san);

  await expect(page.getByRole("heading", { name: "Review done" })).toBeVisible();
  await expect(page.getByText("10 remembered, 0 to practise again.")).toBeVisible();

  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("moechess:progress") ?? "{}"));
  const dues = Object.values(saved.cards as Record<string, { fsrs: { due: string } }>).map((card) => Date.parse(card.fsrs.due));
  expect(dues).toHaveLength(10);
  for (const due of dues) expect(due).toBeGreaterThan(Date.parse("2026-03-03T09:00:00.000Z"));
});

test("a saved theme is applied before the page paints", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("moechess:settings", JSON.stringify({ schemaVersion: 1, side: "white", sessionSize: 20, themeId: "night-shift" }));
  });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "night-shift");
  await expect(page.locator("html")).toHaveCSS("background-color", "rgb(26, 20, 51)");
});
```

- [ ] **Step 2: Run it**

Run: `pnpm e2e`
Expected: `2 passed`. Both tests passed against a production build while this plan was written. The first takes about 20 seconds because each of the 30 moves waits for the opponent's reply.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/trainer.spec.ts
git commit -m "test: add end-to-end learn and review flow"
```

---

### Task 23: Visual review

**Files:**
- Create: `scripts/screenshots.mjs`

**Interfaces:**
- Consumes: a running production server (`pnpm build && pnpm start`).
- Produces: PNGs in `test-results/screenshots/` (ignored by git) at 1440, 820 and 390 px in both themes, plus a warning for any page that scrolls sideways.

This covers spec §12's visual review. The review done while writing this plan found and fixed the issues listed in Task 20's design notes. Repeat it whenever styles change.

- [ ] **Step 1: Create `scripts/screenshots.mjs`**

```js
// Visual review: captures key pages at three widths in both built-in themes.
// Usage: pnpm build && pnpm start   (in one terminal)
//        node scripts/screenshots.mjs [baseUrl]   (in another; default http://localhost:3000)
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:3000";
const outDir = "test-results/screenshots";
mkdirSync(outDir, { recursive: true });

async function type(page, sans) {
  const input = page.getByRole("textbox", { name: "Type a move" });
  for (const san of sans) {
    await page.waitForFunction(() => !document.querySelector(".mc-move-input input")?.disabled);
    await input.fill(san);
    await input.press("Enter");
  }
}

const pages = [
  { name: "home", path: "/" },
  {
    name: "explore",
    path: "/course/ruy-lopez",
    setup: async (page) => {
      await type(page, ["e4", "e5", "Nf3", "Nc6", "Bb5"]);
      await page.waitForTimeout(2500);
    },
  },
  {
    name: "learn",
    path: "/course/ruy-lopez/learn/marshall",
    setup: async (page) => {
      await type(page, ["e4", "Nf3", "Bb5", "Ba4", "O-O", "Re1", "Bb3"]);
      await page.waitForTimeout(2500);
      await type(page, ["d4"]);
      await page.waitForTimeout(150);
    },
  },
  { name: "settings", path: "/settings" },
];

const viewports = [
  { width: 1440, height: 900 },
  { width: 820, height: 1180 },
  { width: 390, height: 844 },
];

const browser = await chromium.launch();
for (const theme of ["summer-sky", "night-shift"]) {
  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport });
    await context.addInitScript((themeId) => {
      localStorage.setItem("moechess:settings", JSON.stringify({ schemaVersion: 1, side: "white", sessionSize: 20, themeId }));
    }, theme);
    for (const shot of pages) {
      if (viewport.width === 820 && !["explore", "learn"].includes(shot.name)) continue;
      const page = await context.newPage();
      await page.goto(base + shot.path, { waitUntil: "networkidle" });
      if (shot.setup) await shot.setup(page);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (overflow > 0) console.warn(`horizontal scroll: ${shot.name} ${theme} ${viewport.width}px overflows by ${overflow}px`);
      const file = `${outDir}/${shot.name}-${theme}-${viewport.width}.png`;
      await page.screenshot({ path: file, fullPage: viewport.width === 390 });
      console.log(file);
      await page.close();
    }
    await context.close();
  }
}
await browser.close();
```

- [ ] **Step 2: Capture and review**

Run, in two terminals: `pnpm build && pnpm start`, then `node scripts/screenshots.mjs`
Expected: 20 file paths printed and no `horizontal scroll` warnings.

Open each image and check:
- **Explore at 1440:** no branch-map label overlaps; the map never runs under the board; the dialogue box is fully visible without scrolling.
- **Learn:** the sunflower hint arrow is visible; the mistake square flashes; the dialogue explains the move.
- **Night Shift:** every text is readable, including the wordmark, name tag and buttons on hover.
- **390:** the board is full width; the panel and "Show lines" follow; nothing is cut off.

- [ ] **Step 3: Fix what the review finds, re-run the unit tests, commit**

Run: `pnpm test && pnpm lint`

```bash
git add scripts/screenshots.mjs app/globals.css
git commit -m "chore: add screenshot script for visual review"
```

---

### Final verification

- [ ] Run `pnpm test && pnpm typecheck && pnpm lint && pnpm build && pnpm e2e`. Every command must pass.
- [ ] Walk the spec (`docs/superpowers/specs/2026-09-14-workspace-trainer-design.md`) sections 2–12 and tick each requirement against the running app.
