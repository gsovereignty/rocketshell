# Navigate Problem Tree selection geometry audit

## Scope

- Target: selection-dependent tree-card layout reported after connector-path work.
- Compared: pre-path `3bb6732`, screenshot revision `552091a`, and current HEAD.
- Runtime: packaged napplet inside real shell, Navigate Problem Tree and View Problem both visible, production note intent with `{ focus: false, reuse: true }`.
- Trust boundaries: none relevant. This is a product-correctness defect, not a security finding.

## Method

Recorded shell iframe bounds and grid placement plus, on every animation frame, tree-pane client/scroll dimensions, scrollbar state, document and iframe dimensions, font state, computed grid/padding/font/line-height/transforms, connector transforms, and every tree-node DOMRect. Repeated at wide and single-grid-column placements in Chromium and WebKit. Verified window session restore before selection sampling.

## Finding 1: selection replaces the scrollable tree

- Category: correctness
- Severity: medium
- Location: `napplets/navigate-problem-tree/src/main.ts`, tree selection handler.
- Trigger: scroll the problem tree, then select a visible tree problem.
- Expected: selection changes palette, active path, actionable list, and adjacent viewer without moving tree cards.
- Actual: `renderApp()` replaces `#app.innerHTML`; the new `.tree-pane` starts at `scrollTop = 0`, shifting every descendant vertically.
- Reachability: ordinary pointer selection in the packaged napplet.
- Proof: failing real-shell regression held iframe and pane dimensions constant while `scrollTop` changed from `263` to `0`. Node widths, heights, fonts, grid columns, scrollbar state, and shell placement stayed constant.
- Coverage gap: prior standalone test compared settled node sizes at an unscrolled mocked boundary. It did not exercise the real shell, production intent reuse, animation frames, scroll position, or refresh restore.
- Status: CONFIRMED

## Rejected hypotheses

- Shell/window reflow during reuse: rejected. With target already visible, production `focus: false, reuse: true` calls show and does not change grid membership or geometry.
- Iframe resize: rejected by invariant iframe DOMRect across every sampled frame.
- Connector overflow or scrollbar recalculation: rejected by invariant tree-pane client/scroll dimensions and scrollbar state.
- GSAP transforms or inline styles changing cards: rejected. Only connector transform frames changed; node DOMRect sizes stayed fixed.
- Font loading or selected/path CSS specificity: rejected. Fonts remained loaded and computed card typography, padding, line-height, grid, and transforms stayed fixed.
- Security classification: MISCLASSIFIED if claimed; no security boundary, source, path, harm, or contract exists for this UI bug.

## Fix and regression

Tree DOM now remains mounted during selection. Code updates tree selection/path classes and `aria-current` in place, rerenders only the actionable list, then runs existing GSAP connector-path animation. Real-shell regression samples every animation frame, asserts stable node geometry and scroll state, verifies production intent behavior, keeps caller and target visible, and checks grid placement after refresh.

## Evidence ledger

| Finding | Category | Confirmation | Status | Fix | Regression | Prevention | Result |
|---:|---|---|---|---|---|---|---|
| 1 | correctness | Production tree click replaced `.tree-pane`; `scrollTop` changed `263` to `0` with invariant shell/iframe/card metrics | CONFIRMED | Update tree selection in place | Real-shell Playwright selection/intent/frame sampler | Node DOMRects, pane dimensions/scroll, fonts, visibility, grid, and refresh placement asserted | PASS |

