# Git (VsGit) Extension - Implementation Plan

## Overview
Transform the git-vscode extension into a comprehensive VsGit-style Git client for VS Code, incorporating features from vscode-gitlens, vscode-git-graph, and eclipse-vsgit.

## Phase 1: Explorer Context Menu (Team Menu) ✅ COMPLETE

### Objectives
Implement the VsGit "Team" right-click menu on files/folders in the Explorer view.

### Completed Tasks
- ✅ Created `src/commands/fileContext.ts` with all Team menu operations
  - Stage/unstage files from Explorer
  - Add to .gitignore
  - Compare with HEAD, Index, Previous, Commit
  - Show file history
  - Assume unchanged / Skip worktree flags
  - Untrack files (remove from index)
  - Clean untracked files
- ✅ Created `src/commands/replace.ts` for Replace With submenu
  - Replace with HEAD/Index/Previous/Ref
- ✅ Created `src/commands/patch.ts` for patch operations
  - Create patch from staged changes
  - Create patch from commits (format-patch)
  - Apply patch files
- ✅ Created `src/commands/worktree.ts` for worktree management
  - Create, open, remove, prune worktrees
  - Reveal in OS explorer
- ✅ Created `src/commands/bisect.ts` for bisect workflow
  - Start, mark good/bad, reset, show log
  - Status bar indicator during bisect
- ✅ Created `src/views/WorktreesProvider.ts` for worktrees tree view
- ✅ Created `src/views/ConflictsProvider.ts` for conflicts tree view
- ✅ Updated `src/git/Repository.ts` with 14 new methods:
  - `createTagAt()` with force parameter
  - `deleteRemoteTag()`, `deleteRemoteBranch()`
  - `checkoutRemoteBranch()`, `replaceWithRef()`
  - `assumeUnchanged()`, `skipWorktree()`, `untrack()`
  - `cleanUntracked()`, `stashBranch()`
  - `worktreeList()`, `worktreeAdd()`, `worktreeRemove()`, `worktreePrune()`
  - `bisectStart()`, `bisectMark()`, `bisectReset()`, `bisectLog()`
- ✅ Updated `package.json` with:
  - 40+ new commands
  - 4 submenus (Team, Compare With, Replace With, Advanced)
  - Explorer context menu entries
  - 2 new views (Worktrees, Conflicts)
  - 9 new settings
  - View/item context menu entries for all new views
- ✅ Updated `src/extension.ts` to register all new modules and views
- ✅ Type checking passes (`npm run check-types`)
- ✅ Build succeeds (`npm run build`)

---

## Phase 2: Branch & Tag Enhancements ✅ COMPLETE

### Objectives
Add advanced branch and tag operations: reset, force re-tag, remote branch management.

### Completed Tasks
- ✅ Updated `src/commands/branch.ts` with `registerBranchExtraCommands()`:
  - `vsgit.branch.reset` — Soft/Mixed/Hard reset with confirmation
  - `vsgit.branch.compareTo` — Compare two branches and show commit differences
  - `vsgit.remoteBranch.checkout` — Checkout remote branch with local tracking
  - `vsgit.remoteBranch.delete` — Delete remote branch with confirmation
- ✅ Updated `src/commands/tag.ts`:
  - `vsgit.tag.forceCreate` — Force replace existing tag with confirmation
  - `vsgit.tag.deleteRemote` — Delete tag from remote repository
- ✅ Updated `src/commands/stash.ts`:
  - `vsgit.stash.branch` — Create new branch from stash
- ✅ Updated `package.json`:
  - Added commands to contributes.commands
  - Added view/item/context menu entries for remote branches and tags
  - Hidden context-only commands from palette
- ✅ Type checking passes

---

## Phase 3: History View Enhancements ✅ COMPLETE

### Objectives
Replace the 500-commit limit with proper pagination, add compare mode and filters.

### Completed Tasks
- ✅ **History View Pagination**
  - Replace `maxCommits` limit with page-based loading
  - Add "Load More" button/action in History view
  - Use `vsgit.graph.pageSize` setting (default 200)
  - Track current page offset per repository
  - Show loading indicator during fetch

- ✅ **Compare Mode**
  - Add toolbar button: "Compare Branches/Tags"
  - Prompt user to select two refs (branch, tag, SHA)
  - Show commits unique to each side in split view
  - Support A...B (symmetric difference) and A..B (range) notation
  - Add context menu on history commits: "Compare with..."

- ✅ **Branch Filter**
  - Add dropdown in History view toolbar to filter by branch
  - Options: "All branches", specific local/remote branches
  - Update history query to use `--first-parent` or specific ref
  - Persist last-used filter per repository

- ✅ **Search & Additional Filters**
  - Add search input in History view toolbar
  - Filter commits by:
    - Author name/email
    - Commit message (grep)
    - SHA prefix
    - Date range (since/until)
  - Add context menu: "Filter to this author"

- ✅ **Commit Node Context Menu**
  - Right-click on commit in History view:
    - Checkout commit (detached HEAD)
    - Create branch at commit
    - Create tag at commit
    - Cherry-pick commit
    - Revert commit
    - Reset branch to commit (soft/mixed/hard)
    - Copy SHA
    - Show commit details
    - Compare with HEAD
    - Compare with another commit

### Implementation Notes
- Update `src/commands/history.ts` and `src/views/HistoryProvider.ts`
- Add new setting `vsgit.history.defaultFilter` (all/current-branch)
- Use `git log --skip=N --max-count=M` for pagination
- Store pagination state in `HistoryProvider` class
- Add new node type `HistoryLoadMoreNode` to represent "Load More" button

---

## Phase 4: Compare View & Staging Panel Upgrade ✅ COMPLETE

### Objectives
Add a dedicated Compare view for side-by-side branch/ref comparison. Upgrade the Staging view to a persistent webview panel.

### Completed Tasks
- ✅ **Compare View (Tree)**
  - New tree view: `vsgit.compare`
  - Show current comparison (if active)
  - Display: "Comparing [RefA] ↔ [RefB]"
  - List commits unique to each side
  - List changed files (aggregate diff)
  - Context menu on files: Open diff, Open file
  - Toolbar actions: Switch sides, Clear comparison, Pick new refs

- ✅ **Staging Panel Enhanced**
  - Convert `vsgit.staging` from TreeView to Webview panel
  - Full-width commit message editor
  - Checkbox lists for staged/unstaged files
  - Inline diff preview (optional, toggle)
  - Amend last commit checkbox
  - Sign-off (DCO) checkbox
  - GPG sign checkbox
  - Template message support
  - Show current branch name and upstream status

- ✅ **Conflict Resolution in Staging Panel**
  - Highlight conflicted files in red
  - Show conflict markers count per file
  - Quick action buttons: Use Ours, Use Theirs, Open Merge Editor
  - Auto-refresh when conflicts resolved

### Implementation Notes
- Create `src/webviews/compare/` folder with React/Svelte component
- Use `vscode.window.createWebviewPanel` for Compare view
- Persist compare state across reloads (global state)
- Update `src/views/StagingProvider.ts` → `src/webviews/staging/`
- Use VS Code Webview Toolkit for UI components

---

## Phase 5: SCM View Menus & Safety Layer ✅ COMPLETE

### Objectives
Add context menus to VS Code's built-in SCM view (Source Control panel). Implement safety confirmations for destructive operations.

### Completed Tasks
- ✅ **SCM Resource State Context Menus**
  - Add to `contributes.menus.scm/resourceState/context`:
    - Stage/unstage (inline icons)
    - Discard changes (with confirmation)
    - Open diff
    - Open file
    - Blame file
    - Show history
    - Compare with HEAD
    - Compare with Index
    - Replace with HEAD
    - Conflict actions (if conflicted)

- ✅ **SCM Resource Group Context Menus**
  - Add to `contributes.menus.scm/resourceGroup/context`:
    - Stage All
    - Unstage All
    - Discard All (with confirmation)

- ✅ **Safety Confirmation Layer**
  - Implement `vsgit.confirmDestructiveActions` setting check
  - Destructive operations requiring confirmation:
    - Hard reset
    - Discard changes
    - Clean untracked files
    - Force push
    - Delete branch (force)
    - Delete remote branch
    - Rebase --skip / --abort
  - Add "Don't ask again for this session" checkbox
  - Store session-level bypass flag

- ✅ **Command Preview (Optional)**
  - Implement `vsgit.showCommandPreview` setting
  - Show exact git command in a preview modal before execution
  - Allow editing command arguments
  - "Execute" / "Cancel" buttons

### Implementation Notes
- Update `package.json` with `scm/resourceState/context` and `scm/resourceGroup/context` menus
- Create `src/util/confirmation.ts` with shared confirmation logic
- Use `vscode.window.showWarningMessage()` with modal option
- Track bypass flags in extension context global state

---

## Phase 6: Advanced Operations (LFS, Notes, Archive) ✅ COMPLETE

### Objectives
Implement less-common but powerful git operations: LFS management, git notes, worktree advanced features, git archive.

### Completed Tasks
- ✅ **Git LFS Extended**
  - Current: `vsgit.lfs.info` shows tracked files
  - Add:
    - `vsgit.lfs.track` — Track new file patterns
    - `vsgit.lfs.untrack` — Untrack patterns
    - `vsgit.lfs.lock` — Lock files on remote
    - `vsgit.lfs.unlock` — Unlock files
    - `vsgit.lfs.locks` — Show all locks
    - `vsgit.lfs.pull` — Pull LFS objects
    - `vsgit.lfs.prune` — Prune old LFS objects

- ✅ **Git Notes**
  - `vsgit.notes.add` — Add note to commit
  - `vsgit.notes.edit` — Edit existing note
  - `vsgit.notes.remove` — Remove note
  - `vsgit.notes.show` — Show notes in commit details
  - Display notes in History view (optional column)

- ✅ **Worktree Lock/Unlock**
  - `vsgit.worktree.lock` — Lock worktree (prevent pruning)
  - `vsgit.worktree.unlock` — Unlock worktree
  - Show lock status in Worktrees view

- ✅ **Git Archive**
  - `vsgit.archive.create` — Create archive (zip/tar) from ref
  - Prompt for ref, format, output location
  - Support `--prefix` option

- ✅ **Subtree Operations**
  - `vsgit.subtree.add` — Add subtree
  - `vsgit.subtree.pull` — Pull subtree updates
  - `vsgit.subtree.push` — Push subtree changes
  - `vsgit.subtree.split` — Split subtree into separate history

### Implementation Notes
- Create `src/commands/lfs.ts` (extend existing)
- Create `src/commands/notes.ts`
- Create `src/commands/archive.ts`
- Add new commands to `package.json`
- Register in `extension.ts`

---

## Phase 7: Git Graph Interactive Visualization ✅ COMPLETE

### Objectives
Implement an interactive, visual git graph similar to git-graph extension and Sourcetree.

### Completed Tasks
- ✅ **Webview Graph Panel**
  - Create `src/webviews/graph/` with canvas-based graph rendering
  - Use `git log --graph --all --format=...` to get graph structure
  - Parse ASCII graph characters into node positions
  - Render commits as dots, branches as colored lines
  - Show commit message, author, date on hover
  - Click commit to show details panel

- ✅ **Graph Interactions**
  - Pan and zoom (mouse wheel, drag)
  - Click commit → show details sidebar
  - Right-click commit → context menu (checkout, branch, tag, cherry-pick, etc.)
  - Hover branch name → highlight all commits on branch
  - Filter by branch/author/date
  - Search commits

- ✅ **Graph Layout Algorithm**
  - Use Sugiyama layered graph drawing
  - Or simpler: parse `git log --graph` ASCII art
  - Assign lanes (colors) to branches
  - Minimize edge crossings

- ✅ **Performance Optimization**
  - Virtual scrolling for large histories
  - Render only visible commits
  - Use Web Workers for layout calculation
  - Cache graph data per repository

### Implementation Notes
- Use HTML Canvas or SVG for rendering
- Consider using `gitgraph.js` library or implement custom
- Add setting `vsgit.graph.layout` (compact/detailed)
- Add toolbar: Refresh, Fetch, Branch filter, Search

---

## Phase 8: Auto-Fetch & Background Operations ✅ COMPLETE

### Objectives
Implement automatic background fetching and repository monitoring.

### Completed Tasks
- ✅ **Auto-Fetch Service**
  - Created `src/services/AutoFetchService.ts`
  - Reads `vsgit.autoFetch.enabled`, `vsgit.autoFetch.intervalMinutes`, and `vsgit.autoFetch.notify`
  - Starts/stops the interval from extension activation and config changes
  - Fetches all remotes for all repositories
  - Skips repositories with merge/rebase/cherry-pick/revert operations in progress
  - Shows optional notifications with a "Pull Now" action when new incoming commits are found

- ✅ **File System Watcher**
  - Created `src/services/GitWatcherService.ts`
  - Watches `.git` sentinel files for branch switches, merge/rebase/cherry-pick/revert state, and external commits
  - Debounces refreshes and respects `vsgit.autoRefresh`

- ✅ **Ahead/Behind Indicators**
  - Refreshes ahead/behind state after fetch
  - Shows pull/push badges in the Git Graph toolbar
  - Shows last-fetch time in the auto-fetch status bar item

- ✅ **Pull Notifications**
  - Shows notifications when remote commits arrive
  - Supports the "Pull Now" action
  - Respects `vsgit.autoFetch.notify`

### Implementation Notes
- Use `vscode.workspace.createFileSystemWatcher()` for `.git/**` changes
- Debounce rapid file changes (500ms)
- Use `setInterval()` for auto-fetch timer
- Clear timer on extension deactivation
- Status bar item shows last fetch time and can trigger `vsgit.autoFetch.fetchNow`

---

## Phase 9: Configuration & Settings UI ✅ COMPLETE

### Objectives
Provide in-app configuration UI for common git settings.

### Completed Tasks
- ✅ **Git Config Editor**
  - `src/commands/config.ts` opens a webview panel for local, global, and system scopes
  - Local/global scopes support add, edit, and unset
  - System scope is displayed as read-only
  - Advanced key/value entries are loaded from `git config --list --show-origin --show-scope`

- ✅ **Repository Settings Panel**
  - Remotes tab lists fetch/push URLs
  - Supports adding and removing remotes
  - Per-repository config can be edited through local scope

- ✅ **Extension Settings Integration**
  - Extension tab shows common `vsgit.*` settings
  - Supports toggles for auto refresh, auto fetch, auto-fetch notifications, and destructive-action confirmations
  - Supports auto-fetch interval and default pull-mode edits

### Implementation Notes
- Uses `src/webviews/configHtml.ts`
- Use `git config --list --show-origin --show-scope` to read
- Use `git config --local/--global --add/--unset` to write
- Command `vsgit.config.openPanel` is registered as the keybinding/palette alias

---

## Phase 10: Integration & Polish 🔄 IN PROGRESS

### Objectives
Final integration, performance optimization, accessibility, and testing.

### Tasks
- [x] **Keyboard Shortcuts**
  - Default keybindings are contributed in `package.json`
  - Covered commands include Commit, Push, History, Fetch, Switch To, Inline Blame, Git Graph, Cherry-Pick, and Git Config

- [ ] **Accessibility (a11y)**
  - Ensure all tree views have proper ARIA labels
  - Keyboard navigation for all webviews
  - High contrast theme support
  - Screen reader announcements for operations

- [ ] **Performance Profiling**
  - Profile startup time
  - Optimize repository scanning
  - Lazy-load views
  - Cache git output where possible

- [x] **Error Handling**
  - `src/commands/shared.ts` humanizes common git failures
  - Command flows use shared progress/error wrappers where practical
  - Conflict and destructive-operation paths surface explicit confirmations or follow-up actions

- [ ] **Testing**
  - ✅ Unit tests for parsers (status, log, blame, refs, reflog, config, diff, worktree, etc.)
  - ✅ Mock-git Repository security/argv tests
  - ✅ Static manifest/docs regression tests
  - [ ] Integration tests for command flows inside VS Code
  - [ ] Coverage threshold / report

- [ ] **Documentation**
  - ✅ README with feature overview, screenshots, settings, architecture, and keyboard shortcuts
  - ✅ CHANGELOG and LICENSE
  - [ ] CONTRIBUTING guide
  - [ ] GIFs or updated live screenshots for key workflows

- [ ] **Marketplace Preparation**
  - ✅ Extension icon, banner, categories, keywords, and license metadata
  - ✅ Detailed README description
  - [ ] Final VSIX inspection and marketplace publish checklist

### Implementation Notes
- `contributes.keybindings` is present in `package.json`
- Use `@axe-core/playwright` for a11y testing
- Current tests use Node's built-in test runner
- Create `.github/workflows/ci.yml` for CI/CD
- Use `vsce package` to create `.vsix` for manual testing

---

## Settings Reference

### Existing Settings
- `vsgit.commit.gpgSign` — Sign commits with GPG
- `vsgit.commit.signOff` — Add Signed-off-by trailer
- `vsgit.fetch.pruneOnFetch` — Prune on fetch
- `vsgit.history.maxCommits` — Max commits in history (deprecated in Phase 3)
- `vsgit.blame.enabledByDefault` — Auto-enable blame

### New Settings (Phase 1)
- `vsgit.git.path` — Custom git executable path
- `vsgit.autoRefresh` — Auto-refresh views on change
- `vsgit.autoFetch.enabled` — Enable auto-fetch
- `vsgit.autoFetch.intervalMinutes` — Fetch interval
- `vsgit.autoFetch.notify` — Notify when auto-fetch discovers incoming commits
- `vsgit.graph.pageSize` — History page size (Phase 3)
- `vsgit.graph.sortOrder` — Commit sort order
- `vsgit.confirmDestructiveActions` — Confirm destructive ops
- `vsgit.showCommandPreview` — Preview git commands
- `vsgit.defaultPullMode` — Pull strategy (merge/rebase)

---

## Current Status

### ✅ Completed (~90%)
- Phase 1: Explorer context menu (Team menu) — 100%
- Phase 2: Branch & tag enhancements — 100%
- Phase 3: History view enhancements — 100%
- Phase 4: Compare view & conflict resolution — 100%
- Phase 5: SCM view menus & safety layer — 100%
- Phase 6: Advanced operations (LFS, Notes, Archive, Subtree) — 100%
- Phase 7: Git graph interactive visualization — 100%
- Phase 8: Auto-fetch & background operations — 100%
- Phase 9: Configuration & settings UI — 100%

### 🔄 In Progress
- Phase 10: Integration & polish

### 📋 Remaining
- Phase 10: Accessibility audit, deeper command integration tests, CI workflow, CONTRIBUTING guide, and marketplace packaging polish

---

## Extension Statistics (Current)

- **Total Commands**: 167 contributed commands
- **Total Views**: 8 sidebar views + 1 Commit webview + 1 Git Graph panel
- **Command Files**: 29+ modules
- **Repository Methods**: 92+ git operations
- **Lines of Code**: ~11,500+ lines

---

## Next Steps

1. **Immediate**: Phase 10 — add CI and higher-level command integration tests
2. **High Priority**: Accessibility and keyboard-navigation audit for webviews
3. **Final**: Marketplace packaging polish and release preparation
