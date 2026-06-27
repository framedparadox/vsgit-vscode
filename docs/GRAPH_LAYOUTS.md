# Git Graph — Layout Representations

Design exploration of alternative ways to draw the commit DAG in VsGit. The
shipping layout is a **vertical DAG** (vscode-git-graph style); this document
captures horizontal, railway, and compact alternatives, what each costs to
build, and which parts of the existing engine they reuse.

The layout engine is [resources/graphLayout.js](../resources/graphLayout.js)
(`GraphLayout.buildLayout`), shared by the Git Graph panel
([resources/graph.js](../resources/graph.js)) and the History view. It is
DOM-free and unit-tested in
[resources/graphLayout.test.js](../resources/graphLayout.test.js). Every option
below is described in terms of what it changes there.

---

## 0. Current — Vertical DAG (shipping)

```
        ●  main (HEAD)
        │
        ●
        │╲
        │ ●  feature
        │ │
        ● │
        │╱
        ●
```

- **Axes:** Y = commit order (`--topo-order`, child above parents), X = lane index.
- **Engine:** `buildLayout` returns one row per commit: `{ commit, col, colorIdx,
  incoming[], outgoing[], maxCols }`. The col is the lane; the row index is time.
- **Render:** one overlay `<svg>` over a commit table — each table row is one
  commit, dots positioned at the measured vertical centre of the row, edges drawn
  as paths flowing downward through lane columns (`commitToParentPath`).
- **Why it works:** the graph and the metadata table (Author / Date / Message)
  share the same row, so they scroll and align as one unit.

The axis assignment (X=lane, Y=time) is the only thing the alternatives below
change. Everything downstream — lane colouring, edge routing, ref pills — is
reusable to varying degrees.

---

## 1. Horizontal DAG — **lead candidate**

```
main      ●──────●──────●────────●
                  \              /
feature            ●────●──────●
```

The current vertical graph rotated 90°: **X = commit order, Y = lane.**

- **Engine reuse: ~80%.** `buildLayout` is axis-agnostic — `col` (lane) and row
  index (time) are just integers. The transpose lives entirely in the *geometry*
  layer ([graphLayout.js](../resources/graphLayout.js#L125-L170)):
  - `cx` becomes `rowIndex → X` (time advances rightward).
  - `cyOf` becomes `lane → Y` (each branch is a horizontal track).
  - `commitToParentPath` / `transition` swap their X/Y roles; the smooth-curve
    math is identical, just mirrored across the diagonal.
- **The real work is the table, not the graph.** The shipping design fuses the
  graph with a *vertical* commit table (one row per commit). Horizontal mode
  breaks that marriage — time now runs left-to-right, so a per-commit row no
  longer maps to a graph position. Two ways out:
  1. **Detached strip + synchronized timeline.** A horizontal graph strip on
     top, a scrollable metadata lane below it, X-scroll locked between them.
  2. **Cards on demand.** Drop the always-on table; commit metadata shows in a
     hover tooltip or the existing expand-at-selection details panel.
- **Trade-offs:** reads naturally as "time flows right" and suits wide monitors,
  but vertical space is cheap (you can scroll a thousand commits) while
  horizontal space is not — long histories need aggressive horizontal scroll or
  pairing with the Compact pass (§3).
- **Toggle cost:** add a `layout: 'vertical' | 'horizontal'` to `CONFIG`, branch
  the geometry, and persist via `vscode.setState` like `traceMode` already does.

---

## 2. Railway / Metro-map

```
main      ●━━━━━━━━●━━━━━━━━━━━━●━━━━━━━━●
                   ┗━━━━●━━━━●━━┛
                        feature/auth
```

Horizontal DAG (§1) plus styling — branches drawn as colored transit lines.

- **Engine reuse:** the full §1 transpose. The difference is purely visual:
  - **Persistent rails.** Draw each lane as a continuous track across its whole
    lifespan, not just commit-to-commit segments, so empty stretches still read
    as "the branch exists here."
  - **Thicker, capped strokes.** `stroke-width` up from 2; rounded caps/joins
    are already set in [graph.js:466-467](../resources/graph.js#L466-L467).
  - **Riding labels.** A branch name pinned along each rail instead of (or in
    addition to) the inline ref pills.
  - One color per lane — the existing palette rule
    ([COLOR_PALETTE.md](COLOR_PALETTE.md)) maps straight onto transit lines.
- **Trade-offs:** highest visual payoff for the lowest *algorithmic* cost, but
  legibility falls off a cliff past ~6 concurrent lanes — metro maps assume few
  lines. Best for feature-branch workflows, poor for busy mainlines.

```
Conceptually:
                 ╭──── F1 ─── F2 ─── F3 ───╮
M1 ─── M2 ─── M3                           M4 ─── M5
                 ╰──────────────────────────╯
```

---

## 3. Compact / Collapsed

```
main    A────B────C──────────G────H
             \              /
feature       D────E──────F
```

Not a new engine — a **pre-pass on the commit list** before `buildLayout`.

- **Engine reuse: 100% of the renderer.** Collapse runs of first-parent-only,
  single-child, ref-less commits into one labeled edge ("+4 commits"); only
  break out lanes at actual branch and merge points. The renderer (vertical or
  horizontal) draws the reduced list unchanged.
- **Where it slots in:** rewrite `commits` before the
  [`buildLayout(commits)`](../resources/graph.js#L375-L377) call. Each collapsed
  edge carries a count so the path can render a "+N" badge; clicking it expands
  that run back to full commits.
- **Trade-offs:** the best ROI for *large* histories — turns thousand-commit
  walls into a readable skeleton of branch topology. Pairs with either §1 or §2.
  Cost is the expand/collapse interaction state, not the math.

---

## At a glance

| Option | Axes | Engine reuse | Build cost | Best for |
|:---|:---|:---:|:---|:---|
| Vertical (shipping) | Y=time, X=lane | — | — | General use, long histories |
| **Horizontal DAG** | X=time, Y=lane | ~80% | Decouple graph from vertical table | Wide monitors, few lanes |
| Railway / metro | X=time, Y=lane | ~80% + styling | Persistent rails, labels | Feature-branch workflows |
| Compact / collapsed | either | 100% (pre-pass) | Expand/collapse state | Huge histories |

**Recommended first build:** Horizontal DAG. It is the cleanest reuse of the
existing layout math — the transpose is confined to the geometry layer, leaving
`buildLayout` and its tests untouched — and it is the prerequisite for Railway
(§2). The Compact pass (§3) is orthogonal and can layer onto whichever axis
ships.

---

_Design notes only — no implementation has been done. If a layout is built,
update this doc and link the toggle in `CONFIG` (resources/graph.js)._
