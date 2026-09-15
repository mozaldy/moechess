# Moechess — Workspace & Opening Trainer (Sub-project 1) Design

Date: 2026-09-14
Status: Draft, awaiting review

## 1. Product context

Moechess is a web platform for learning and drilling chess openings through structured
repertoires and personalized analysis of the player's own games. The launch course is the
Ruy Lopez, but the platform is built for an eventual library of all openings.

Audience: improving players with limited time, from anime and very-online internet culture,
who value expressive, heavily customizable interfaces (think Steam profiles).

### Roadmap and decomposition

| # | Sub-project | Depends on | Status |
|---|---|---|---|
| 1 | Workspace & trainer UI (this spec) | — | Designing |
| 2 | Content pipeline: explorer stats, Stockfish checks and Wikibooks commentary → annotated PGN | 1 (course format) | Later |
| 3 | Chess.com import & deviation analysis | 1, 2 | Later |
| 4 | 3D AI companion coach | 1 (dock slot, event bus, dialogue box) | Long horizon |
| 5 | Customization: theme gallery and editor, user piece sets and boards, possibly user CSS | 1 (tokens, hooks, skins) | Long horizon |

Each sub-project gets its own spec, plan and implementation cycle.

## 2. Scope of sub-project 1

### In scope
- App shell and workspace layout with a board, side panel, dialogue box, branch map and an empty companion dock slot.
- Custom SVG board supporting drag, click-to-move and keyboard move entry.
- Course format: annotated PGN parsed into a course tree at build time, for any opening.
- One course (`ruy-lopez`) with a small, hand-checked **sample** PGN: the main moves of the target
  lines with short factual notes. Full commentary comes from sub-project 2.
- Explore, Learn and Review modes.
- Spaced-repetition scheduling (FSRS).
- `ProgressStore` and `SettingsStore` interfaces with localStorage implementations.
- Typed workspace event bus.
- Theming foundation: design tokens, stable styling hooks, skin registry, and theme-as-data.
  Two built-in themes (Summer Sky and Night Shift) with a simple theme picker.

### Out of scope (explicitly)
- Accounts, server persistence, auth.
- Content pipeline, LLM rewriting, Wikibooks ingestion (sub-project 2).
- Chess.com import (sub-project 3). Only the `markDeviation` hook exists.
- The 3D companion (sub-project 4). Only the dock slot and events exist.
- Theme editor, user-uploaded skins, user CSS (sub-project 5).

## 3. Key decisions

| Decision | Choice | Reason |
|---|---|---|
| Persistence | Browser storage behind a `ProgressStore` interface | Works with no backend; accounts can replace it without touching the trainer |
| Content source | Lines from open data (Lichess `chess-openings` CC0, Lichess explorer stats, Stockfish checks). Commentary from Wikibooks *Chess Opening Theory* (CC BY-SA) with an LLM rewriting it for readability only (sub-project 2) | The owner isn't a course author; LLMs can't be trusted to invent chess facts |
| Commentary license | CC BY-SA for commentary files, credited in the app | Required by Wikibooks; code is unaffected |
| First course size | Compact: 6–8 main lines, 10–14 moves deep (Closed with Breyer and Chigorin, Berlin, Exchange, Marshall, Open) | Strongest Wikibooks coverage; verifiable |
| Side | Learner picks White or Black per session, from one shared tree | Chess.com games come from both sides |
| Drill model | Learn mode for new lines, then spaced-repetition review | Familiar Chessable-style flow |
| Board | Custom React/SVG, rules via `chess.js` | Full visual control, accessibility, clean event interface. Chessground's GPL rules it out |
| Piece art | cburnett set (CC BY-SA) as the first skin | Free and familiar; replaceable via skins |
| Default look | Expressive, from visual novel, gacha and manga UI | First impression for the target audience |

## 4. Architecture

Logic lives in plain TypeScript with no React, testable without a browser and reusable by later
sub-projects. React is a thin layer on top.

```
content/courses/<slug>/course.json   course metadata (name, ECO, main side, credits, license)
content/courses/<slug>/*.pgn         annotated PGN
        │  parsed and validated at build time
        ▼
lib/chess/       wrapper over chess.js: legal moves, apply move, SAN parsing, position keys
lib/course/      PGN → CourseTree; validation; line enumeration
lib/training/    card generation, learn-mode state machine, review selection and grading (ts-fsrs)
lib/progress/    ProgressStore interface, LocalStorageProgressStore, MemoryProgressStore, migrations
lib/settings/    SettingsStore interface (side, session size, active theme)
lib/events/      typed workspace event bus
lib/theme/       theme schema, built-in themes, skin registry, token → CSS variable application
        ▼
components/board/       SVG board: renders a position and skin, emits move intents
components/branch-map/  transit-map course tree
components/dialogue/    visual-novel dialogue box
components/workspace/   layout: board, dialogue, side panel, branch map, dock slot
app/                    routes
```

Before writing any Next.js code, read the relevant guides in `node_modules/next/dist/docs/`.
This project uses Next 16, whose APIs may differ from earlier versions (see `AGENTS.md`).

### Routes
- `/` lists courses with due counts and has the side toggle.
- `/course/[slug]` is Explore.
- `/course/[slug]/learn/[line]` is Learn mode for one line.
- `/review` is spaced-repetition review of due cards across all courses.
- `/settings` has the theme picker, side and session size.

### Dependencies to add
`chess.js` (BSD-2), `ts-fsrs` (MIT), a PGN parser (e.g. `@mliebelt/pgn-parser`, MIT, or a small in-house parser if the library's variation/comment output is inadequate; decided in the plan), `vitest`, `@testing-library/react`, `@playwright/test`. No state library: React `useReducer` and context.

## 5. Data model

```ts
// Position key: FEN without halfmove/fullmove counters, so transpositions merge.
type PositionKey = string;

interface CourseMeta {
  slug: string;            // "ruy-lopez"
  name: string;            // "Ruy Lopez"
  eco: string[];           // ["C60", ..., "C99"]
  mainSide: "white" | "black";
  credits: Credit[];       // Wikibooks, piece set, etc.
  contentLicense: string;  // "CC BY-SA 4.0"
}

interface CourseNode {
  id: string;              // stable within the course
  position: PositionKey;   // position after this move
  san: string | null;      // null for the root
  parentId: string | null;
  children: string[];      // ordered; first = main move
  comment?: Commentary;
  arrows?: Arrow[];        // from [%cal]
  highlights?: Highlight[];// from [%csl]
}

interface Commentary {
  text: string;
  source: "wikibooks" | "generated" | "sample";
  sourceRef?: string;      // URL or ID of original text
}

interface Line {           // a named root-to-leaf path used by Learn mode and the branch map
  id: string;              // "closed-breyer"
  name: string;            // "Closed, Breyer Defence"
  nodeIds: string[];
}

// A card = position where the learner is to move + the accepted course moves.
// Card ID is course-independent so shared positions are learned once.
type CardId = `${"w" | "b"}:${PositionKey}`;

interface CardState {
  id: CardId;
  expected: string[];      // SANs; [0] is the main move, others accepted
  fsrs: FsrsCard;          // from ts-fsrs
  status: "new" | "learning" | "review";
}

interface ProgressSnapshotV1 {
  schemaVersion: 1;
  cards: Record<CardId, CardState>;
  learnedLines: Record<string, { learnedAt: string }>; // key: `${slug}:${side}:${lineId}`
  explore: Record<string, { lastNodeId: string }>;     // key: slug
}

interface ProgressStore {
  load(): Promise<ProgressSnapshot>;
  saveCards(cards: CardState[]): Promise<void>;
  markLineLearned(key: string): Promise<void>;
  setExplorePosition(slug: string, nodeId: string): Promise<void>;
}
```

Store methods are async even for localStorage so a server-backed store fits the same interface.

## 6. Training behaviour

### Cards
Cards are generated for the chosen side only, from every course node where that side is to move
and the node has children. If a node has several children, the first is the main move and the
others are also accepted. Playing an accepted alternative shows "that's fine, but the course
plays X" and isn't graded as a mistake.

### Learn mode (one line)
1. **Guided pass:** the line is shown move by move with commentary in the dialogue box. The
   learner plays each of their moves while the course move is highlighted with a sunflower arrow.
   The opponent's moves auto-play.
2. **Recall pass:** the same line with no hints.
3. **Mistake:** the wrong move slides back, the square flashes strawberry, a sunflower arrow and
   commentary show the answer, and the learner plays it. The recall pass then restarts from move 1.
4. **Completed:** a mistake-free recall pass marks the line learned. Its cards are scheduled as
   FSRS "good" (first review about a day later), and the learned celebration plays.

### Review
- **Due cards:** those whose FSRS due date is now or earlier, across all courses, for the chosen side.
- **Line choice:** pick a learned line containing due cards. At opponent branch points, choose the
  reply leading to the most due cards.
- **Auto-play:** the learner's moves that aren't due play quickly. Play stops only on due cards.
- **Grading:** correct first try is `Good`. Correct after one wrong attempt is `Again`. A second
  wrong attempt shows the answer and is `Again`.
- **Session end:** when nothing is due, or at the session size (default 20).
- **Hook for sub-project 3:** `markDeviation(cardId)` sets a card due now.

### Explore
Free navigation of the tree through the board, move list or branch map. Both sides' moves are
available, commentary follows the current node, and there's no grading. Only the last position
is saved.

## 7. Events

```ts
type WorkspaceEvent =
  | { type: "moveMade"; san: string; by: "learner" | "opponent"; nodeId: string }
  | { type: "mistake"; played: string; expected: string; cardId?: CardId }
  | { type: "cardReviewed"; cardId: CardId; rating: "again" | "good" }
  | { type: "lineLearned"; courseSlug: string; lineId: string; side: "white" | "black" }
  | { type: "commentaryShown"; nodeId: string; commentary: Commentary }
  | { type: "sessionEnded"; mode: "learn" | "review"; stats: SessionStats };
```

The event bus is a small typed publish/subscribe interface with no consumers in sub-project 1
besides the celebration and tests. The companion subscribes to it later.

## 8. Visual design

### Direction
Expressive by default, drawing on visual novel dialogue boxes, gacha menus and manga panels:
ink outlines, confident colour, chunky display type. It avoids the templated "anime site" look
of pastel pink, sparkles and bubbly type everywhere.

### Summer Sky (default theme)

| Token | Hex | Role |
|---|---|---|
| `--mc-bg` | `#DDEBFF` | page ground |
| `--mc-ink` | `#25184A` | text, outlines |
| `--mc-surface` | `#FFFFFF` | panels |
| `--mc-board-light` | `#FFF4DC` | light squares |
| `--mc-board-dark` | `#8E7CC3` | dark squares |
| `--mc-accent-course` | `#FFC63D` | the course's move: hint arrows, due dots, learned lines |
| `--mc-correct` | `#1FB88A` | correct feedback |
| `--mc-mistake` | `#FF4F7B` | mistake feedback (ink text on top, never white) |

Night Shift (dark theme) defines the same tokens with its own values. Every text/background pair
in both themes must meet WCAG AA, checked in tests.

### Type
- **Dela Gothic One:** display only (course names, mode titles, the "LEARNED" stamp).
- **Atkinson Hyperlegible Next:** everything else, including notation (tabular figures).
Both are loaded via `next/font`, and their families are exposed as tokens (`--mc-font-display`, `--mc-font-body`).

### Shape
- Panels have 2px ink outlines and flat colour, with no soft drop shadows.
- Radius depends on importance: the board is square, panels slightly rounded, buttons pill-shaped.

### Signature element: the dialogue box
Commentary appears in a visual-novel dialogue box under the board. A name tag shows the speaker
("Course" for now, with source credit available) and text types in; a click completes it. In
sub-project 4 the companion takes over the name tag and delivers the same lines.

### Branch map
The course tree is drawn as a transit map. The trunk is the shared moves, and each line branches
off. Unlearned routes are thin ink strokes, learned routes are filled sunflower, and due positions
get dots. Clicking a point jumps the board there. Branches beyond a depth threshold collapse and
expand on demand, and the current line stays expanded, so large future courses fit.

### Layout
- **Desktop:** branch map on the left; board with the dialogue box below it in the centre; move
  list and session status on the right. The dock slot sits between the board column and the right
  panel, collapsed with zero width.
- **Tablet:** the branch map becomes a drawer.
- **Phone:** board, dialogue and status stacked; the branch map is a bottom sheet.
- All text is left-aligned.

### Motion
All motion responds to the learner's actions, except the single celebration:
- **Moves:** pieces slide.
- **Mistake:** the piece slides back and the square flashes strawberry.
- **Correct:** a brief mint pulse on the square.
- **Line learned:** the route fills sunflower and a "LEARNED" stamp lands on it.

`prefers-reduced-motion` disables the slides, pulses and stamp animation, and state changes still show.

### Accessibility
- **Keyboard entry:** type SAN (`Nf3`) or move a square cursor with the arrow keys and Enter.
- **Screen readers:** squares expose names and pieces; moves and feedback are announced through a live region.
- **Focus:** visible on every interactive element.
- **Feedback:** correct and mistake are never shown by colour alone; each has an icon and text.

## 9. Customization foundation

This is the contract future customization depends on. It's cheap now and expensive to retrofit.

1. **Tokens only.** Components never hard-code colour, font, radius, border width, shadow or
   sizing. Everything comes from `--mc-*` custom properties, mapped into Tailwind 4 `@theme`.
2. **Stable styling hooks.** Meaningful elements carry stable class names and data attributes
   separate from Tailwind utilities, for example `.mc-board`, `.mc-square[data-color][data-square]`,
   `.mc-piece[data-piece="wN"]`, `.mc-dialogue`, `.mc-dialogue-nametag`, `.mc-branch-map`,
   `.mc-branch[data-state="learned|unlearned"]`, and `[data-state="mistake|correct|hint"]`. They are
   listed in `docs/theming-hooks.md` and versioned; removing or renaming one is a breaking change.
3. **Skins.**
   - A `PieceSet` is a manifest `{ id, name, credit, license, pieces: Record<PieceCode, url> }`.
   - A `BoardSkin` is `{ id, name, light, dark } | { id, name, lightTexture, darkTexture }`.
   - Both live in a registry; missing piece images fall back to the default set.
4. **Theme as data.**
   - Shape: `Theme = { schemaVersion, id, name, tokens: Record<TokenName, string>, pieceSetId, boardSkinId }`.
   - Built-in themes are plain objects that pass the same validation a user theme will.
   - The active theme ID is saved in `SettingsStore`.
5. **User CSS is deferred to sub-project 5** and needs its own security design (scoping,
   no external `url()`, CSP) before shipping. Nothing in sub-project 1 depends on it.

## 10. Content and licensing (sub-project 1)

- The sample Ruy Lopez PGN contains the main moves of the target lines, checked by `chess.js` and
  against the Lichess `chess-openings` names, with short factual notes marked `source: "sample"`.
- A credits page (`/credits`) lists content sources and licenses, the piece set (cburnett,
  CC BY-SA), and the fonts (OFL).

## 11. Error handling

| Case | Behaviour |
|---|---|
| Invalid PGN or metadata | Build fails with file, line number and move |
| Corrupt or invalid progress record | Record moved to a backup key, rest kept, notice shown |
| Storage unavailable or full | `MemoryProgressStore` fallback plus a "Progress won't be saved in this browser" banner |
| Older schema | Migrations run on load |
| Newer schema (from a future app version) | Kept read-only; app works in memory and never overwrites it |
| Course update removes a position | Card silently dropped from review |
| Course update changes a card's main move or removes an accepted move | Card reset to `new` (moves added by another course are merged and keep the schedule) |
| Missing skin asset | Fall back to the default skin per piece or square |
| Unknown theme ID | Fall back to Summer Sky |

## 12. Testing

- **Unit (Vitest):** PGN parsing and transposition merging, validation errors, card generation
  per side, the learn-mode state machine, review selection and grading, `markDeviation`, storage
  migrations and corrupt-record recovery, theme validation.
- **Component (React Testing Library):** board click-to-move, drag, keyboard SAN entry, cursor
  entry, emitted events, the dialogue box skip-to-complete.
- **End-to-end (Playwright):** learn a line, reload, advance the mocked clock one day, review it,
  and check the grade was saved.
- **Theme contract:**
  - every token is defined in every built-in theme
  - documented hooks exist in the rendered markup
  - the AA contrast pairs pass
- **Visual review:** screenshots at 390px, 820px and 1440px in both themes during development.

## 13. Open items for the implementation plan

- Choose the PGN parser after testing variation and comment output.
- Pick the exact sample lines and their move depth (within 10–14 moves).
- Night Shift palette values (same token set, AA-checked).
- Branch map layout algorithm (a simple custom layered layout is expected to be enough for compact trees).
