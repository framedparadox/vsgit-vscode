# Changelog

## [v0.0.5] - 2026-06-01

### Added
- A **Documentation** webview at the bottom of the VsGit sidebar, plus a
  full-screen **VsGit: Open Documentation** panel.
- A searchable component guide and Git glossary with definitions, purpose, and
  practical usage guidance.
- A manifest-driven catalog covering all contributed operations and
  distinguishing Command Palette entries from context-only actions.
- Extension Host integration tests for activation, complete command
  registration, repository refresh, and the full Documentation panel.
- Native Node coverage gates (80% lines, 80% branches, 70% functions), published
  in CI alongside the verified VSIX artifact.
- Contributor guidance and a repeatable Marketplace release checklist.

### Fixed
- **History graph rendering**: commit lanes now draw as continuous lines. The
  per-row `<canvas>` renderer drew pass-through branches in half-row segments, so
  vertical lines broke apart between rows. The History view now uses the same
  single-overlay-SVG model as the Git Graph panel, sourced from a shared,
  unit-tested layout module (`resources/graphLayout.js`).
- History commits are now fetched in `--topo-order` so a child always precedes
  its parents — required for correct lane layout.

### Changed
- New, distinctive activity-bar icon (a commit-graph DAG) so the container no
  longer reuses the built-in Source Control glyph.
- **Commit view**: the advanced commit options (Amend / Sign off / GPG) are now
  hidden by default behind an "Advanced" disclosure, keeping the panel focused on
  the message and changes. The disclosure state is remembered per webview. A
  small indicator dot stays on the collapsed toggle whenever amend/sign-off/GPG
  is checked, so an active option is never silently hidden. Checking Amend now
  prefills the previous commit's message (via the existing
  `Repository.headCommitMessage()`) when the message box is empty, restoring the
  prior draft if Amend is unchecked again untouched. The view's pure helpers
  (status labels, file-tree grouping, escaping) were extracted into a
  unit-tested module (`resources/commitView.js`).
- All tree providers now expose complete screen-reader labels. Custom webview
  rows, folders, menus, pickers, and rebase controls support keyboard operation,
  visible focus, live announcements, and forced-colour mode.
- Repository discovery now runs workspace probes concurrently, coalesces
  overlapping scans, records scan duration, and loads submodule metadata only
  when requested.
- CI and tag publishing now enforce type checks, unit tests, coverage,
  Extension Host integration, dependency audit, and inspection of the exact
  packaged VSIX.

### Security
- The askpass and editor IPC servers now require a per-session token (passed to
  the shim via its environment) before responding, preventing a local process
  from phishing credentials or injecting rebase/commit content over the
  enumerable socket/pipe. Credential prompts are masked conservatively, and the
  IPC read buffers are bounded.
- Added an argument-guard (`safeRef`/`safeRemoteUrl`) that rejects ref/SHA/branch
  values beginning with `-` (option injection) and the `ext::`/`fd::` remote
  transports, applied across the webview-reachable git operations and the diff
  content provider.
- Declared untrusted and virtual workspaces unsupported because VsGit requires a
  local checkout and executes repository Git configuration and hooks.
- Updated development tooling and pinned audited transitive test dependencies;
  `npm audit --audit-level=high` reports no vulnerabilities.

### Internal
- Extracted `parseWorktreeList` and the graph-log line parser into dedicated,
  unit-tested parser modules. Test suite grows from 36 to 60 cases.
- Added accessibility, Phase 10 contract, packaging, and integration coverage;
  the Node suite now contains 184 passing tests.

### Docs
- Rewrote the README with a detailed feature reference, settings table,
  architecture and security sections, and illustrated `docs/` diagrams of the
  Git Graph panel and the activity-bar trees.
- Added `CONTRIBUTING.md` and `docs/MARKETPLACE_CHECKLIST.md`.

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
