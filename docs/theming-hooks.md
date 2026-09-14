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
