# Tactical assessment fixtures

The fixture corpus in `tests/fixtures/tactics.ts` is a hand-labeled chess record. Its
labels do not come from the detector. `findCandidates` only proposes legal hypotheses;
Task 6 must still prove the consequence and may reject any geometric pattern.

All listed histories, played moves, tactical moves, checks, mates, recaptures,
promotions, and en-passant rights were replayed with chess.js 1.4.0. Positions use UCI
moves so the evidence can be replayed without SAN ambiguity.

## Required six positive cases

| Fixture | Hand-checked reasoning |
| --- | --- |
| Missed mate in one | From `7k/8/5KQ1/8/8/8/8/8 w - - 0 1`, `g6g7` is checkmate. The played `g6h7` is legal, but the black king can capture the queen. |
| Allowed mate in one | From the standard start after `f2f3 e7e5`, `g2g4` permits `d8h4#`. |
| Missed hanging queen | In `q5k1/8/8/8/8/8/8/R5K1 w - - 0 1`, `a1a8` legally captures the undefended queen. White instead plays `g1h2`. |
| Allowed hanging queen | In `r5k1/8/8/8/8/8/8/1Q4K1 w - - 0 1`, `b1a1` puts the queen on the rook's open file and permits `a8a1`. |
| Missed knight fork | In `8/4k3/1q6/8/8/2N5/8/4K3 w - - 0 1`, `c3d5+` attacks the king on e7 and queen on b6. The played `c3b1` declines it. |
| Allowed knight fork | In `4k3/8/2n5/8/8/8/4K3/1Q6 w - - 0 1`, `b1b3` permits `c6d4+`, which attacks the king on e2 and queen on b3. The queen cannot capture d4. |

## Black-to-move equivalents

These six positions rotate the corresponding positive case by 180 degrees and swap
the colors. They ensure candidate direction is based on the recorded decision side,
rather than assuming White moves first.

| Fixture | Hand-checked reasoning |
| --- | --- |
| Black missed mate | In `8/8/8/8/8/1qk5/8/K7 b - - 0 1`, `b3b2#` mates; `b3a2+` loses the queen to the king. |
| Black allowed mate | In `rnbkqbnr/pp1ppppp/2p5/8/3P4/8/PPP1PPPP/RNBKQBNR b - - 0 1`, `b7b5` permits `e1a5#`. |
| Black missed hanging queen | In `1k5r/8/8/8/8/8/8/1K5Q b - - 0 1`, `h8h1` captures White's queen; `b8a7` declines it. |
| Black allowed hanging queen | In `1k4q1/8/8/8/8/8/8/1K5R b - - 0 1`, `g8h8` permits `h1h8`. |
| Black missed knight fork | In `3k4/8/5n2/8/8/6Q1/3K4/8 b - - 0 1`, `f6e4+` attacks the king on d2 and queen on g3; `f6g8` declines it. |
| Black allowed knight fork | In `6q1/3k4/8/8/8/5N2/8/3K4 b - - 0 1`, `g8g6` permits `f3e5+`, attacking the king on d7 and queen on g6. |

## Special-move coverage

| Fixture | Hand-checked reasoning |
| --- | --- |
| Promotion capture | In `1q5k/P7/8/8/8/8/8/7K w - - 0 1`, `a7b8q` captures the queen and promotes. The candidate must retain the `q` UCI suffix. |
| Promotion fork | In `k7/1r1P1r2/8/8/8/8/8/7K w - - 0 1`, `d7d8n` underpromotes and the new knight attacks both rooks on b7 and f7. |
| En-passant fork hypothesis | In `7k/2q1r3/8/3pP3/8/8/8/K7 w - d6 0 1`, `e5d6` is a legal en-passant capture. The pawn lands on d6 and geometrically attacks the queen on c7 and rook on e7, but this fixture is rejected after the legal refutation below. |

## Rejected cases

These fixtures deliberately contain a tempting move or pattern. A candidate can exist
without becoming evidence; the verifier must account for the full legal consequence.

| Fixture | Why it is rejected |
| --- | --- |
| Already played immediate mate | In the first mate position, the played move is `g6g7#`. The same move cannot be reported as a missed opportunity. |
| Capturing attacker is recaptured | In `r5k1/1b6/8/8/8/8/8/Q5K1 w - - 0 1`, `a1a8+` captures a rook, but `b7a8` immediately captures White's queen. The net exchange is bad for White. |
| Pinned apparent attacker | In `4r1k1/8/8/8/8/8/q3R3/4K3 w - - 0 1`, the rook on e2 geometrically sees a2. `e2a2` is illegal because moving the rook exposes the white king to the rook on e8. |
| Hanging capture permits mate | In `1r6/8/8/8/8/5kq1/1R6/7K w - - 0 1`, `b2b8` wins a rook but abandons the second rank, allowing `g3g2#`. The played `b2c2` keeps g2 covered. |
| Pre-existing unavoidable loss | In `r5r1/1k6/8/8/8/8/8/Q5K1 w - - 0 1`, White is already in check. Each king reply permits `a8a1`; the blocking `a1g7` loses the queen to `g8g7`. The played `g1h2` does not newly cause the forced queen loss. |
| Another forced mate remains | In the mate position, `g6h6+ h8g8 h6g7#` is forced. Declining the immediate `g6g7#` therefore does not lose the mating outcome. |
| Harmless fork geometry | In `8/4k3/1qp5/8/8/2N5/8/4K3 w - - 0 1`, `c3d5+` attacks the king and queen, but `c6d5` removes the checking knight. No target is won. |
| Refuted en-passant fork | After `e5d6` in `7k/2q1r3/8/3pP3/8/8/8/K7 w - d6 0 1`, Black plays `c7d6`. The queen captures the forking pawn immediately, so White wins neither the queen nor the rook. |

## History-sensitive boundaries

Candidate enumeration replays the complete move list. The test corpus repeats
`g1f3 g8f6 f3g1 f6g8` twice from the standard starting position, reaching the same
position for the third time. chess.js reports a threefold repetition, so mate and
tactical candidate enumeration stop. Rebuilding only the final FEN would lose that
terminal-state evidence.
