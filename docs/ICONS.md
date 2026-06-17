# Icon Reference

This document inventories every icon used by the extension: where it comes from,
what it represents, and how it is wired up. VS Code contribution points still use
**VS Code [codicons](https://microsoft.github.io/vscode-codicons/dist/codicon.html)**
(referenced via `vscode.ThemeIcon("name")` in TypeScript, or `$(name)` in
`package.json`) because those are the native icon contract for commands, menus,
and TreeViews. Owned webview chrome uses shared Windows 11 Fluent-style SVGs.

There are three exceptions to codicons:

1. **File-type icons** — resolved from the user's active *File Icon Theme*
   (e.g. Seti, Material Icon Theme) via `vscode.ThemeIcon.File` + `resourceUri`.
   These give language-specific, color-coded glyphs (TS, JS, JSON, CSS, …).
2. **Webview chrome icons** — local Fluent-style SVGs from
   [`resources/fluentIcons.js`](../resources/fluentIcons.js), injected into the
   Git Graph and Commit webviews. These are 16px, monochrome, and inherit
   `currentColor` so they follow the active VS Code theme.
3. **Git status badges** — colored letter overlays from the
   `FileDecorationProvider`.

> Codicons are monochrome and inherit the editor foreground color unless a
> `ThemeColor` is supplied as the second argument to `ThemeIcon`.

---

## 1. File-type icons (icon theme)

Files listed in the changes / compare views use the proper language icon from
the active File Icon Theme. The git status is shown separately as a colored
badge (see §5) — never baked into the icon.

| Where | Code |
| --- | --- |
| [StagingProvider.ts:77](../src/views/StagingProvider.ts#L77) | `item.iconPath = vscode.ThemeIcon.File` |
| [CompareProvider.ts:117](../src/views/CompareProvider.ts#L117) | `item.iconPath = vscode.ThemeIcon.File` |

Requires `item.resourceUri` to be set so VS Code can map the extension to an
icon (e.g. `*.ts` → TypeScript glyph).

---

## 2. Tree-view icons (codicons in TypeScript)

### Staging view — [StagingProvider.ts](../src/views/StagingProvider.ts)

| Node | Icon | Meaning |
| --- | --- | --- |
| Conflicted Files group | `warning` | Group has merge conflicts |
| Staged Changes group | `check-all` | Files staged for commit |
| Unstaged Changes group | `list-unordered` | Working-tree changes |
| File leaf | *file-type icon* (§1) | Individual changed file |

### Repositories view — [RepositoriesProvider.ts](../src/views/RepositoriesProvider.ts)

| Node | Icon | Meaning |
| --- | --- | --- |
| Repository root | `repo` | A git repository |
| Local Branches group | `git-branch` | Local branches |
| Remote Branches group | `cloud` | Remote-tracking branches |
| Tags group | `tag` | Tags |
| Remotes group | `broadcast` | Configured remotes |
| Stashes group | `archive` | Stash entries |
| Submodules group | `file-submodule` | Submodules |
| Tag item | `tag` | A single tag |
| Remote item | `cloud` | A single remote |
| Stash item | `archive` | A single stash |
| Submodule item | `file-submodule` | A single submodule |

### Worktrees view — [WorktreesProvider.ts](../src/views/WorktreesProvider.ts)

| Node | Icon | Meaning |
| --- | --- | --- |
| Worktree (default/header) | `repo` | A worktree |
| Main worktree | `repo` | The primary worktree |
| Linked worktree | `git-branch` | A linked worktree |

### Compare view — [CompareProvider.ts](../src/views/CompareProvider.ts)

| Node | Icon | Meaning |
| --- | --- | --- |
| Compare root | `git-compare` | Comparison context |
| Left / "ours" side | `arrow-left` | Base ref |
| Right / "theirs" side | `arrow-right` | Target ref |
| Files group | `files` | Changed files in the comparison |
| Commit | `git-commit` | A commit in the range |
| File leaf | *file-type icon* (§1) | A changed file |

### Synchronize view — [SynchronizeProvider.ts](../src/views/SynchronizeProvider.ts)

| Node | Icon | Meaning |
| --- | --- | --- |
| Incoming group | `arrow-down` | Commits to pull |
| Outgoing group | `arrow-up` | Commits to push |
| Commit | `git-commit` | A single commit |

### Conflicts view — [ConflictsProvider.ts](../src/views/ConflictsProvider.ts)

| Node | Icon | Meaning |
| --- | --- | --- |
| Conflicts root | `warning` | There are conflicts |
| Conflicted file | `merge` | A file with merge conflicts |

### Reflog view — [ReflogProvider.ts](../src/views/ReflogProvider.ts)

Icon chosen dynamically per reflog action by `actionIcon()`:

| Reflog action | Icon | Meaning |
| --- | --- | --- |
| `commit*` | `git-commit` | Commit / amend |
| `checkout` | `arrow-swap` | Switched ref |
| `reset` | `discard` | Reset |
| `rebase*` | `git-merge` | Rebase |
| `merge`, `pull` | `git-merge` | Merge / pull |
| *(any other)* | `circle-small` | Generic reflog entry |

---

## 3. Command & view-title icons (codicons in `package.json`)

Declared as `"icon": "$(name)"` on commands, menus, and view titles in
[package.json](../package.json). Grouped by purpose:

| Icon | Used for |
| --- | --- |
| `add` | Stage / add (8×) |
| `remove` | Unstage / remove (4×) |
| `trash` | Discard / delete (6×) |
| `discard` | Discard changes / reset (4×) |
| `clear-all` | Clear / discard all |
| `check` | Commit confirm / done (4×) |
| `git-commit` | Commit actions (4×) |
| `git-compare` | Compare actions (6×) |
| `git-branch` | Branch actions (3×) |
| `git-merge` | Merge / rebase |
| `git-pull-request` | Pull request actions (2×) |
| `merge` | Resolve merge |
| `sync` | Sync (2×) |
| `arrow-up` | Push |
| `arrow-down` | Pull |
| `arrow-swap` | Checkout / switch |
| `cloud-download` | Fetch |
| `refresh` | Refresh views (4×) |
| `history` | History / log (3×) |
| `list-ordered` | Ordered listing |
| `filter` | Filter |
| `tag` | Tag actions |
| `repo` | Repository |
| `repo-create` | Init repository |
| `repo-clone` | Clone repository |
| `source-control` | SCM entry point |
| `archive` | Stash |
| `file-zip` | Archive / zip |
| `folder-library` | Worktrees / library |
| `go-to-file` | Open file |
| `edit` | Edit / rename |
| `move` | Move |
| `person` | Author / user (2×) |
| `settings-gear` | Settings (2×) |
| `lock` | Lock |
| `unlock` | Unlock |
| `info` | Info |
| `warning` | Warning |
| `close` | Close |

---

## 4. Webview icons (Fluent-style SVGs)

Declared once in [`resources/fluentIcons.js`](../resources/fluentIcons.js) and
loaded by:

| Webview | Uses |
| --- | --- |
| [GraphPanel.ts](../src/webviews/graph/GraphPanel.ts) + [graph.js](../resources/graph.js) | toolbar actions, ref pills, dropdown check/info icons, file tree/list toggles, close, find navigation |
| [CommitViewProvider.ts](../src/webviews/commit/CommitViewProvider.ts) + [commit.js](../resources/commit.js) | tree/list toggle, stage/unstage/discard actions, folder chevrons |
| [CreateTagDialog.ts](../src/webviews/CreateTagDialog.ts) | modal close button |
| [HistoryView.ts](../src/webviews/HistoryView.ts) + [historyHtml.ts](../src/webviews/historyHtml.ts) | compare, branch filter, and refresh toolbar actions |

Available icon names: `add`, `branch`, `check`, `chevron`, `chevronDown`,
`chevronUp`, `close`, `columns`, `commit`, `compare`, `discard`, `fetch`,
`fileList`, `fileTree`, `info`, `merge`, `pull`, `push`, `refresh`, `remove`,
`search`, `stash`, `tag`, `trace`, and `tracking`.

## 5. Git status badges (file decorations)

Provided by [VsgitFileDecorationProvider](../src/decorations/FileDecorations.ts).
These are **not** icons but a single-letter badge plus a theme color, overlaid
on the file-type icon — exactly how VS Code's built-in SCM view conveys status.

| State | Badge | Theme color |
| --- | --- | --- |
| Modified | `M` | `gitDecoration.modifiedResourceForeground` |
| Added | `A` | `gitDecoration.addedResourceForeground` |
| Deleted | `D` | `gitDecoration.deletedResourceForeground` |
| Renamed | `R` | `gitDecoration.renamedResourceForeground` |
| Copied | `C` | `gitDecoration.renamedResourceForeground` |
| Untracked | `U` | `gitDecoration.untrackedResourceForeground` |
| Ignored | `I` | `gitDecoration.ignoredResourceForeground` |
| Conflicted | `!` | `gitDecoration.conflictingResourceForeground` |

---

## Conventions

- **Prefer the icon theme** for files (`ThemeIcon.File` + `resourceUri`) — never
  override a file's icon with a status codicon, or you lose the language glyph.
- **Convey git status via decorations** (§5), not by swapping the file icon.
- **Use semantic codicons** for TreeView groups and manifest commands so they
  track the user's product icon theme automatically.
- **Use `resources/fluentIcons.js`** for custom webview toolbar/actions instead
  of hard-coded text glyphs or per-file SVG literals.
- Browse available codicons:
  https://microsoft.github.io/vscode-codicons/dist/codicon.html
