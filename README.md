# Git (EGit) for VS Code

A full-featured, EGit-style Git client for VS Code. Spawns `git` directly — no libgit2, no JS overhead — with 135+ commands across every Git workflow.

## Features

### Repositories View
- Multi-root workspace support with ahead/behind indicators
- Full branch, remote, tag, stash, submodule, and worktree tree
- Inline checkout, push, pull, fetch, merge, rebase from tree nodes
- **Switch To** quick picker (`⌘⇧G B`) across all branches and tags
- Sequencer controls (Continue / Skip / Abort) surface automatically during rebase or merge

### Staging View
- Staged / Unstaged / Conflicted file groups
- Hunk-level stage and unstage
- Commit with GPG sign and DCO sign-off options
- Amend last commit

### History View
- Paginated commit log with graph lanes
- Filter by branch, author, message, date range
- Per-commit context menu: checkout, branch, tag, cherry-pick, revert, reset (soft/mixed/hard), compare
- Compare Branches mode (symmetric diff A↔B)

### Git Graph
- Canvas-rendered commit graph with colour-coded branch lanes
- Right-click any commit: checkout, branch, tag, cherry-pick, revert, reset, compare with HEAD or another commit, copy SHA

### Compare View
- Side-by-side branch/ref comparison tree
- Lists commits unique to each side and all changed files
- Click any file to open a diff

### Synchronize View
- Incoming (behind) and outgoing (ahead) commits vs upstream
- Right-click to cherry-pick or checkout any incoming commit

### Conflict Resolution
- Conflicts view lists all conflicted files
- Use Ours / Use Theirs / Open Merge Editor / Mark Resolved
- Merge editor uses VS Code's built-in 3-way diff

### Advanced Operations
| Feature | Commands |
|---|---|
| Interactive Rebase | Drag-drop todo editor, reword/squash/fixup |
| Worktrees | Create, open, lock, unlock, remove, prune |
| Git LFS | Track, untrack, lock, unlock, pull, prune |
| Git Notes | Add, edit, remove, show per-commit notes |
| Bisect | Start, mark good/bad, reset, show log |
| Subtree | Add, pull, push, split |
| Archive | Create zip/tar from any ref |
| Patch | Create from staged or commits, apply |
| Gerrit | Push for review, install Change-Id hook |

### GitHub Integration
- **Fetch GitHub Pull Requests** — fetches `refs/pull/*/head` as local refs

### Configuration
- Git Config editor (local / global / system scopes)
- Remotes manager
- Extension settings panel (auto-fetch, pull mode, confirmations)

## Keyboard Shortcuts

| Shortcut | Command |
|---|---|
| `⌘⇧G C` | Commit |
| `⌘⇧G P` | Push |
| `⌘⇧G L` | Show History |
| `⌘⇧G F` | Fetch |
| `⌘⇧G B` | Switch To Branch/Tag |
| `⌘⇧G A` | Toggle Inline Blame |
| `⌘⇧G G` | Show Git Graph |
| `⌘⇧G K` | Cherry-Pick Commit |
| `⌘⇧G ,` | Open Git Config Panel |

## Requirements

- VS Code 1.85+
- `git` 2.20+ on `$PATH` (or configured via `egit.git.path`)
- `git-lfs` for LFS commands (optional)

## Extension Settings

| Setting | Default | Description |
|---|---|---|
| `egit.autoFetch.enabled` | `false` | Fetch all remotes automatically |
| `egit.autoFetch.intervalMinutes` | `3` | Auto-fetch interval |
| `egit.confirmDestructiveActions` | `true` | Confirmation dialogs for hard reset, force push, etc. |
| `egit.defaultPullMode` | `merge` | Pull strategy: merge or rebase |
| `egit.blame.enabledByDefault` | `false` | Show blame on file open |
| `egit.graph.pageSize` | `200` | Commits per history page |
| `egit.git.path` | `""` | Custom git executable path |

## License

MIT
