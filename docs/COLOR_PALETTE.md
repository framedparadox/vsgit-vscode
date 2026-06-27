# Color Palette

Reference for all colors hard-coded in the VsGit extension. Most UI chrome uses
VS Code theme variables (`var(--vscode-*)`) and is **not** listed here, since
those follow the user's active theme. This document covers only the fixed,
literal color values the extension defines itself.

---

## 1. Git Graph — branch lane palette

Lane colors are cycled by lane index: `laneColor(idx) = palette[idx % palette.length]`.
The same color is used for a branch's line, its commit dot, and its ref badge.

Defined in two places that must stay in sync:
- [resources/graph.js](../resources/graph.js) — `CONFIG.palette` (webview default)
- [package.json](../package.json) — `vsgit.graph.colours` setting default (what ships; user-overridable)

| Order (colorIdx) | Hex | Color |
|:---:|:---|:---|
| 0  | `#0085d9` | Blue |
| 1  | `#d9008f` | Magenta / pink |
| 2  | `#00d90a` | Green |
| 3  | `#d98500` | Orange |
| 4  | `#a300d9` | Purple |
| 5  | `#ff0000` | Red |
| 6  | `#00d9cc` | Teal / cyan |
| 7  | `#e138e8` | Bright purple-pink |
| 8  | `#85d900` | Lime / yellow-green |
| 9  | `#dc5b23` | Burnt orange |
| 10 | `#6f24d6` | Indigo / violet |
| 11 | `#ffcc00` | Yellow / gold |

> Lane 0 (blue) is assigned to the first lane; each new branch lane takes the
> next index, wrapping back to 0 after index 11. Users can reorder or replace
> these via the `vsgit.graph.colours` setting.

---

## 2. Commit view — file status colors

Applied to the file-type badge (`.file-ext`) and the single-letter change code
(`.file-change`) in the Commit view. Defined in [resources/commit.css](../resources/commit.css).

| Status code | Meaning | Hex | Color |
|:---:|:---|:---|:---|
| `A` | Added | `#4ec94e` | Green |
| `M` | Modified | `#e2c08d` | Tan / amber |
| `D` | Deleted | `#f14c4c` | Red |
| `R` | Renamed | `#4daafc` | Blue |
| `U` | Conflicted (unmerged) | `#e2c08d` | Tan / amber |
| `C` | Conflicted | `#f14c4c` | Red |

---

## 3. Misc fixed fallbacks

These appear as the **fallback** value of theme variables (used only when a theme
does not define the variable). Listed for completeness — they are not primary colors.

| Where | Variable (fallback) | Hex |
|:---|:---|:---|
| Commit view advanced badge | `--vscode-notificationsWarningIcon-foreground` | `#cca700` |
| Graph hover/menu background | `--vscode-menu-background` | `#252526` |
| Graph menu foreground | `--vscode-menu-foreground` | `#ccc` |
| Graph menu selection bg | `--vscode-menu-selectionBackground` | `#094771` |
| Graph button background | `--vscode-button-background` | `#0e639c` |

---

_Generated as a snapshot of the codebase. If the graph palette or status colors
change, update this file alongside `resources/graph.js`, `package.json`, and
`resources/commit.css`._
