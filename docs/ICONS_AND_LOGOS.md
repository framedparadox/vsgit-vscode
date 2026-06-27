# Icons & Logos

Inventory of every icon and logo used in the VsGit extension, grouped by source.
The extension uses **four** icon mechanisms:

1. **Bundled logo** — the extension's own brand mark (`resources/icon.svg`).
2. **VS Code codicons** — referenced as `$(name)` in `package.json` or
   `new vscode.ThemeIcon("name")` in TypeScript. These render from VS Code's
   built-in [codicon](https://microsoft.github.io/vscode-codicons/) font and
   follow the active theme.
3. **Inline SVG glyphs (Git Graph)** — self-contained `<svg>` strings in
   `resources/graph.js` (GitHub Octicon-derived shapes) for the graph toolbar.
4. **Inline SVG glyphs (Commit view)** — codicon path data in
   `resources/commit.js` rendered as SVG for the stage / unstage / discard
   action buttons.

---

## 1. Brand logo

| Asset | Path | Used for |
|:---|:---|:---|
| VsGit mark | [resources/icon.svg](../resources/icon.svg) | Activity-bar container icon (`viewsContainers.activitybar`) |

A single-color (`fill="currentColor"`) 16×16 SVG depicting a stylized branch/node
graph. This is the only bundled raster/vector brand asset.

### Documentation screenshots (not UI icons)

These live in `docs/` and are referenced by the README, not shipped as UI:

| Asset | Path |
|:---|:---|
| Git Graph screenshot | [docs/git-graph.png](git-graph.png) / [docs/git-graph.svg](git-graph.svg) |
| Sidebar screenshot | [docs/sidebar.png](sidebar.png) / [docs/sidebar.svg](sidebar.svg) |

---

## 2. VS Code codicons

Built-in theme icons. They adapt to the user's theme automatically.

### 2a. Used in `package.json` (view, command, menu icons)

| Codicon | Typical use |
|:---|:---|
| `$(add)` | Stage / create / add actions |
| `$(archive)` | Create archive |
| `$(arrow-down)` | Pull / down |
| `$(arrow-swap)` | Swap refs |
| `$(arrow-up)` | Push / up |
| `$(check)` | Checkout / confirm |
| `$(clear-all)` | Clear |
| `$(close)` | Close / dismiss |
| `$(cloud-download)` | Fetch |
| `$(discard)` | Discard changes |
| `$(edit)` | Edit / rename |
| `$(file-zip)` | Archive / zip |
| `$(filter)` | Filter |
| `$(folder-library)` | Worktrees view |
| `$(git-branch)` | Branch |
| `$(git-commit)` | Commit view / commit |
| `$(git-compare)` | Compare view |
| `$(git-merge)` | Merge |
| `$(git-pull-request)` | Pull request / Gerrit |
| `$(go-to-file)` | Open file |
| `$(history)` | History / reflog |
| `$(info)` | Info |
| `$(list-ordered)` | Ordered list / sequencer |
| `$(lock)` | Lock (assume-unchanged) |
| `$(merge)` | Merge |
| `$(move)` | Move |
| `$(person)` | Author / committer |
| `$(refresh)` | Refresh |
| `$(remove)` | Unstage / remove |
| `$(repo)` | Repository node |
| `$(repo-clone)` | Clone repository |
| `$(repo-create)` | Initialize repository |
| `$(settings-gear)` | Config / settings |
| `$(source-control)` | Git Repositories view |
| `$(sync)` | Synchronize |
| `$(tag)` | Tag |
| `$(trash)` | Delete |
| `$(unlock)` | Unlock (no-assume-unchanged) |
| `$(warning)` | Conflicts / warnings |

### 2b. Used in TypeScript (`ThemeIcon` / `$()` in tree items & status bar)

| Codicon | Where |
|:---|:---|
| `archive` | Tree item icon |
| `arrow-left` / `arrow-right` | Ahead/behind, compare direction |
| `cloud` / `$(cloud)` | Remote indicators |
| `file` / `$(file)` | File nodes |
| `file-submodule` | Submodule nodes |
| `files` | File group nodes |
| `folder-opened` / `$(folder-opened)` | Folder nodes |
| `git-branch` / `$(git-branch)` | Branch nodes / status bar |
| `git-commit` / `$(git-commit)` | Commit nodes / status bar |
| `git-compare` | Compare nodes |
| `info` / `$(info)` | Info rows |
| `merge` | Merge nodes |
| `repo` | Repository nodes |
| `sync` / `$(sync)` | Sync status |
| `tag` / `$(tag)` | Tag nodes |
| `verified` / `unverified` | GPG signature status |
| `warning` / `$(warning)` | Conflict / warning rows |

---

## 3. Inline SVG glyphs — Git Graph toolbar

Self-contained `<svg>` strings defined in [resources/graph.js](../resources/graph.js)
(`SVG_ICONS` map, around line 107). Most are GitHub Octicon-derived shapes (from
`mhutchie/vscode-git-graph`, under `licenses/LICENSE_OCTICONS`); `merge` / `commit`
/ `close` are custom. Used in the graph webview where codicons aren't available
(the webview can't reference the codicon font).

| Key | Glyph | Used for |
|:---|:---|:---|
| `branch` | branch | Branch refs |
| `tag` | tag | Tag refs |
| `stash` | inbox/stash | Stash entries |
| `commit` | commit dot | Commit marker |
| `download` | pull-down | Fetch / download |
| `refresh` | circular arrow | Refresh |
| `search` | magnifier | Search |
| `check` | checkmark | Checked state |
| `info` | info circle | Info |
| `close` | X | Close |
| `fileList` | list rows | List view toggle |
| `fileTree` | tree | Tree view toggle |
| `chevron` | ▶ | Expand/collapse |
| `pull` | down arrow + bar | Pull |
| `push` | up arrow + bar | Push |

---

## 4. Inline SVG glyphs — Commit view actions

Codicon path data defined in [resources/commit.js](../resources/commit.js)
(`ICON_PATHS`, around line 29), rendered as 16×16 SVG to match VS Code's native
Source Control inline action buttons.

| Key | Codicon equivalent | Used for |
|:---|:---|:---|
| `add` | codicon-add (plus) | Stage changes / Stage all |
| `remove` | codicon-remove (minus) | Unstage changes / Unstage all |
| `discard` | codicon-discard (counter-clockwise arrow) | Discard changes |

---

## File-type badges (not icons — text)

The Commit view's left-hand file badges are **2-character text codes**, not icons
(e.g. `JS`, `TS`, `{}` for JSON, `#` for CSS). See `fileTypeBadge()` in
[resources/commitView.js](../resources/commitView.js) for the full mapping. They
are colored by file status (see [COLOR_PALETTE.md](COLOR_PALETTE.md)).

---

_Generated as a snapshot of the codebase. Update this file when adding new
codicons, graph glyphs, or commit-view action icons._
