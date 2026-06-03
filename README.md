# Git (VsGit) for VS Code

A full-featured, Git client for VS Code. VsGit spawns the `git`
binary directly — no libgit2, no reimplementation of git in JavaScript — and
surfaces **160+ commands** across every Git workflow through dedicated views,
webviews, and an interactive commit graph.

![VsGit Git Graph](docs/git-graph.png)

> The images in this README are static **illustrations** of the interface (the
> graph is rendered exactly this way from live repository data); they are not
> live photographs of a running editor.

---

## Table of contents

- [Why VsGit](#why-vsgit)
- [Highlights](#highlights)
- [Screenshots](#screenshots)
- [Views & features](#views--features)
- [Advanced operations](#advanced-operations)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Getting started](#getting-started)
- [Settings](#settings)
- [Architecture](#architecture)
- [Security model](#security-model)
- [Development](#development)
- [Requirements](#requirements)
- [License](#license)

---

## Why VsGit

VS Code ships with a capable Source Control panel, but power users coming from
Eclipse's EGit, `gitk`, `git-cola`, or standalone graph tools often want more:
a real commit graph, worktrees, interactive rebase, LFS, notes, bisect, subtree,
Gerrit, and per-commit operations without dropping to a terminal.

VsGit fills that gap by driving the real `git` CLI. Because every operation is a
genuine `git` invocation, behaviour matches your shell exactly — the same
config, hooks, credential helpers, and aliases apply.

## Highlights

- 🌳 **Interactive commit graph** — an SVG-rendered DAG with colour-coded branch
  lanes, inline ref pills, an expand-in-place commit-details row, flow tracing,
  fuzzy find, and a full right-click action menu.
- 📜 **History view** — paginated log with the same robust graph renderer,
  branch/author/message/date filtering, and a Compare-Branches mode.
- 🗂️ **Rich sidebar** — Repositories, Staging, Synchronize, Conflicts, Reflog,
  Worktrees, and Compare trees, all multi-root aware.
- ✍️ **Commit webview** — stage by hunk, GPG-sign, DCO sign-off, amend.
- 🔧 **Everything else** — interactive rebase, LFS, notes, bisect, subtree,
  archive, patch, Gerrit, submodules, and a built-in git-config editor.
- 🔒 **Safe by construction** — git is always spawned with an argv array (never a
  shell), refs are guarded against option injection, and the credential/editor
  IPC channels are authenticated with a per-session token.

## Screenshots

### Git Graph

![Git Graph panel](docs/git-graph.png)

Colour-coded lanes, `HEAD → main` / remote / tag ref pills, a selected-row
commit-details panel (metadata on the left, changed files on the right), and
Eclipse Git-style columns: **Graph · Description · Author · Authored Date · Committer ·
Committed Date** (each toggleable).

### Activity bar & trees

![Sidebar views](docs/sidebar.png)

The VsGit container uses its own commit-graph logo (distinct from the built-in
Source Control icon) and hosts the Repositories and Staging trees, among others.

---

## Views & features

### Repositories view
- Multi-root workspace support with per-repo ahead/behind indicators.
- Full tree of branches, remotes, tags, stashes, submodules, and worktrees.
- Inline checkout, push, pull, fetch, merge, and rebase from tree nodes.
- **Switch To** quick picker (`⌘⇧G B` / `Ctrl+Shift+G B`) across all branches and tags.
- Sequencer controls (Continue / Skip / Abort) appear automatically during an
  in-progress rebase, merge, cherry-pick, or revert.

### Staging view & Commit webview
- Staged / Changes / Conflicts groups.
- Hunk-level stage and unstage (forward/reverse patch apply to the index).
- Commit with **GPG sign** (`-S`) and **DCO sign-off** options, or **amend** the
  last commit (message prefilled).

### History view
- Paginated commit log (page size configurable) rendered with the shared,
  unit-tested graph layout — branch lanes stay connected across rows.
- Filter by branch, author, or message; restrict by date range.
- Per-commit context menu: checkout (detached), create branch/tag, cherry-pick,
  revert, reset (soft / mixed / hard), compare with HEAD or another commit,
  copy SHA, and show full details.
- **Compare Branches** mode for a symmetric `A...B` diff.
- Commits are loaded in `--topo-order` so a child always precedes its parents,
  which is what the lane layout needs to draw a correct graph.

### Git Graph
- SVG-rendered commit graph: one overlay path system spanning every row, so
  edges never break apart between rows.
- Inline ref labels, an expand-at-selection commit-details row, and
  `Ctrl/Cmd-click` to compare any two commits.
- **Flow tracing**: highlight ancestors / descendants of the selected commit.
- **Find** (`Ctrl/Cmd+F`) across message, author, hash, and ref names.
- Toolbar: per-repo Pull / Push / Fetch / Commit / Branch / Merge / Stash with
  ahead/behind badges, plus an in-progress operation banner.
- Right-click any commit or ref pill for the full action menu (checkout, branch,
  tag, merge, rebase, cherry-pick, revert, drop, reset, compare, copy SHA;
  branch/tag/stash management on ref pills).

### Compare view
- Side-by-side branch/ref comparison tree listing commits unique to each side
  and all changed files; click a file to open a diff.

### Synchronize view
- Incoming (behind) and outgoing (ahead) commits vs the configured upstream;
  right-click to cherry-pick or checkout any incoming commit.

### Conflict resolution
- Conflicts view lists every conflicted file with **Use Ours / Use Theirs /
  Open Merge Editor / Mark Resolved**, backed by VS Code's built-in 3-way merge.

### Reflog view
- Browse `git reflog` and checkout or reset to any entry.

---

## Advanced operations

| Feature | What you get |
|---|---|
| **Interactive Rebase** | Drag-and-drop todo editor with reword / squash / fixup / drop, edited entirely inside VS Code |
| **Worktrees** | Create, open, lock, unlock, remove, prune |
| **Git LFS** | Track, untrack, lock, unlock, list locks, pull, prune |
| **Git Notes** | Add, edit, remove, show per-commit notes |
| **Bisect** | Start, mark good/bad, reset, show log |
| **Subtree** | Add, pull, push, split |
| **Archive** | Create a zip/tar from any ref |
| **Patch** | Create from staged changes or commits, and apply patch files |
| **Gerrit** | Push for review, install the `Change-Id` commit-msg hook |
| **Submodules** | Add, update, sync, deinit |
| **Maintenance** | `git gc`, prune, fsck, and repo maintenance helpers |
| **Blame** | Toggleable inline blame annotations (`⌘⇧G A`) |
| **GitHub** | Fetch Pull Requests — pulls `refs/pull/*/head` as local refs |

Interactive rebase and commit-message editing are routed back into VS Code via a
small editor shim wired to `GIT_SEQUENCE_EDITOR` / `GIT_EDITOR`, so `git
rebase -i` opens a native editor instead of a terminal vi session.

---

## Keyboard shortcuts

| macOS | Windows / Linux | Command |
|---|---|---|
| `⌘⇧G C` | `Ctrl+Shift+G C` | Commit |
| `⌘⇧G P` | `Ctrl+Shift+G P` | Push |
| `⌘⇧G L` | `Ctrl+Shift+G L` | Show History |
| `⌘⇧G F` | `Ctrl+Shift+G F` | Fetch |
| `⌘⇧G B` | `Ctrl+Shift+G B` | Switch To Branch/Tag |
| `⌘⇧G A` | `Ctrl+Shift+G A` | Toggle Inline Blame |
| `⌘⇧G G` | `Ctrl+Shift+G G` | Show Git Graph |
| `⌘⇧G K` | `Ctrl+Shift+G K` | Cherry-Pick Commit |
| `⌘⇧G ,` | `Ctrl+Shift+G ,` | Open Git Config Panel |

All 160+ commands are also available from the Command Palette under the
**Git (VsGit)** category.

---

## Getting started

VsGit isn't published to the Marketplace yet; build and install it from source.

```bash
git clone https://github.com/ajaykontham/git-vscode
cd git-vscode
npm install
npm run build                 # bundle the extension into dist/
npx vsce package --no-dependencies -o vsgit.vsix
code --install-extension vsgit.vsix
```

Or run it live in the **Extension Development Host**: open the folder in VS Code,
run `npm run watch`, then press `F5`.

Once installed, click the VsGit icon in the activity bar, or run **Git (VsGit):
Show Git Graph** from the Command Palette.

---

## Settings

All settings live under the `vsgit.*` namespace.

| Setting | Default | Description |
|---|---|---|
| `vsgit.git.path` | `""` | Custom path to the `git` executable; empty uses `$PATH`. |
| `vsgit.autoRefresh` | `true` | Refresh views automatically when the repo changes. |
| `vsgit.autoFetch.enabled` | `false` | Periodically fetch from all remotes. |
| `vsgit.autoFetch.intervalMinutes` | `3` | Minutes between automatic fetches. |
| `vsgit.fetch.pruneOnFetch` | `true` | Prune deleted remote-tracking branches on fetch. |
| `vsgit.defaultPullMode` | `merge` | Pull strategy: `merge` or `rebase`. |
| `vsgit.confirmDestructiveActions` | `true` | Confirm hard reset, clean, force-push, etc. |
| `vsgit.showCommandPreview` | `false` | Preview the exact git command before running it. |
| `vsgit.commit.gpgSign` | `false` | Sign commits with GPG by default (`-S`). |
| `vsgit.commit.signOff` | `false` | Add a `Signed-off-by` trailer by default (DCO). |
| `vsgit.blame.enabledByDefault` | `false` | Show inline blame when opening files. |
| `vsgit.history.maxCommits` | `500` | Max commits to load in the History view. |
| `vsgit.graph.pageSize` | `200` | Commits loaded per page in the History view. |
| `vsgit.graph.maxCommits` | `500` | Max commits to load in the Git Graph. |
| `vsgit.graph.sortOrder` | `date` | Commit sort order for the History view. |
| `vsgit.graph.style` | `rounded` | Branch line style: `rounded` curves or `angular` elbows. |
| `vsgit.graph.colours` | 12-colour palette | Branch lane colours cycled through in the graph. |
| `vsgit.graph.dateFormat` | `relative` | Date format in the graph (`relative` / `iso` / `standard`). |
| `vsgit.graph.showRemoteBranches` | `true` | Show remote branches in the graph by default. |
| `vsgit.graph.showSidebar` | `true` | Show the graph's left sidebar tree. |
| `vsgit.graph.showStatusBarItem` | `true` | Show a *Git Graph* button in the status bar. |
| `vsgit.graph.bottomPanelMode` | `editor` | How the graph opens a changed file's diff. |
| `vsgit.graph.showIdColumn` | `true` | Show the Id (hash) column. |
| `vsgit.graph.showAuthorColumn` | `true` | Show the Author column. |
| `vsgit.graph.showAuthoredDateColumn` | `true` | Show the Authored Date column. |
| `vsgit.graph.showCommitterColumn` | `true` | Show the Committer column. |
| `vsgit.graph.showCommittedDateColumn` | `true` | Show the Committed Date column. |

There's also a graphical **Git Config editor** (`⌘⇧G ,`) for editing local /
global / system git config, and a Remotes manager.

---

## Architecture

```
src/
  extension.ts            activation: registers commands, views, providers
  git/
    GitExecutor.ts        the ONLY place git is spawned (argv array, no shell)
    Repository.ts         per-repo cached state + all git operations
    RepositoryManager.ts  multi-root discovery + change notifications
    GitContentProvider.ts vsgit: URIs that feed VS Code's diff editor
    argGuard.ts           option-injection guards (safeRef / safeRemoteUrl)
    parsers/              pure, unit-tested output parsers
                          (log, graphLog, status, refs, diff, blame, config,
                           reflog, rebaseTodo, worktree)
  views/                  tree data providers (Repositories, Staging, …)
  webviews/               webview panels (Graph, History, Commit, pickers)
  services/               auto-fetch, file-system watcher, status bar
  util/                   IPC servers (askpass / editor) + helpers
resources/
  graphLayout.js          shared, unit-tested commit-graph layout (UMD)
  graph.js / graph.css    Git Graph panel client
  askpass.js              GIT_ASKPASS shim
  sequence-editor.js      GIT_SEQUENCE_EDITOR / GIT_EDITOR shim
  icon.svg                activity-bar logo
```

Key design points:

- **One spawn site.** Every git call funnels through `GitExecutor`, which uses
  `child_process.spawn(gitPath, args)` with an argv array — never a shell string.
- **Machine-readable output.** Operations request NUL-/porcelain-formatted output
  and parse it in small, pure functions under `git/parsers/`, each with tests.
- **One graph layout.** Both the Git Graph panel and the History view import the
  same `resources/graphLayout.js` (a UMD module that also loads in Node), so
  there is a single, verified implementation of lane layout and edge geometry.
- **Live refresh.** A file-system watcher plus `RepositoryManager.onDidChange`
  keep every view in sync after internal or external git changes.

## Security model

- **No shell.** Git is spawned with an argv array, so shell metacharacters
  (`;`, `|`, `$()`, backticks) are inert.
- **Option-injection guards.** Refs, SHAs, branch names, and remote URLs coming
  from webview messages or rendered commit data are validated by `safeRef` /
  `safeRemoteUrl`: values beginning with `-` (which git would parse as options)
  are rejected, as are the `ext::` / `fd::` remote-helper transports that can run
  arbitrary commands.
- **Authenticated IPC.** Credential prompts (`GIT_ASKPASS`) and rebase/commit
  editing run over a unix socket / named pipe whose name is enumerable by other
  local processes. Each session generates a random token, passed to the shim
  only via its environment; the server rejects any connection that doesn't echo
  it — preventing local credential phishing or edit injection. Credential
  prompts are masked unless they explicitly ask for a username.

## Development

```bash
npm install
npm run watch        # esbuild in watch mode; F5 launches the dev host
npm run check-types  # tsc --noEmit
npm run build        # production bundle into dist/
npm test             # compile + run the unit-test suite
```

### Testing

Tests run on Node's built-in test runner (`node --test`) — no VS Code instance
required. They cover the pure logic that's most worth pinning down:

- every output parser under `src/git/parsers/` (log, graph-log, status, refs,
  diff, blame, config, reflog, rebase-todo, worktree),
- the shared commit-graph layout (`resources/graphLayout.test.js`),
- the argument guards and the IPC token comparison.

```bash
npm test     # 60 tests
```

CI (GitHub Actions) runs type-check, build, the test suite, and packages the
VSIX on every push and pull request.

---

## Requirements

- VS Code **1.85+**
- `git` **2.20+** on `$PATH` (or set `vsgit.git.path`)
- `git-lfs` for the LFS commands (optional)

## License

[MIT](LICENSE)
