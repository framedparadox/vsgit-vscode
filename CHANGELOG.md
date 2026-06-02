# Changelog

## [0.1.0] - 2026-06-01

### Added
- **135+ commands** covering the full Git workflow
- Repositories view with ahead/behind indicators, multi-root workspace support
- Staging view with hunk-level stage/unstage, GPG sign, DCO sign-off, amend
- History webview with paginated commit log, graph lanes, branch filter, search, compare mode
- Git Graph webview with canvas rendering, context menu (checkout, branch, tag, cherry-pick, revert, reset, compare)
- Compare view: side-by-side branch comparison with commit and file lists
- Synchronize view: incoming/outgoing commits vs upstream with cherry-pick action
- Conflicts view: Use Ours / Use Theirs / Open Merge Editor / Mark Resolved
- Worktrees view: create, open, lock/unlock, remove, prune
- Reflog view: checkout and reset to any entry
- Interactive Rebase editor: drag-drop reorder, reword/squash/fixup/drop
- Git LFS: track, untrack, lock, unlock, locks, pull, prune
- Git Notes: add, edit, remove, show per-commit notes
- Bisect: start, mark good/bad, reset, show log
- Subtree: add, pull, push, split
- Archive: create zip/tar from any ref
- Patch: create from staged changes or commits, apply patch files
- Gerrit: push for review, install Change-Id hook
- Fetch GitHub Pull Requests (`refs/pull/*/head`)
- Switch To quick picker across all branches and tags (`⌘⇧G B`)
- Cherry-pick, revert, squash, GPG signature verification
- Sequencer toolbar (Continue/Skip/Abort) for rebase and merge
- Auto-fetch service with status bar indicator and pull notifications
- File system watcher for external git changes
- Git Config editor (local/global/system), remote manager, extension settings panel
- Inline blame annotations with toggle
- SCM view context menus (stage, unstage, discard, diff, blame, history)
- Explorer Team menu (compare, replace, stage, history, assume-unchanged, skip-worktree)
- 9 keyboard shortcuts
- Confirmation dialogs for all destructive operations with session-level bypass
