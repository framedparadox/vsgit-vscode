# Git (EGit) Extension - Implementation Plan

## Overview
Transform the git-vscode extension into a comprehensive EGit-style Git client for VS Code, incorporating features from vscode-gitlens, vscode-git-graph, and eclipse-egit.

## Phase 1: Explorer Context Menu (Team Menu) ✅ COMPLETE

### Objectives
Implement the EGit "Team" right-click menu on files/folders in the Explorer view.

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
  - `egit.branch.reset` — Soft/Mixed/Hard reset with confirmation
  - `egit.branch.compareTo` — Compare two branches and show commit differences
  - `egit.remoteBranch.checkout` — Checkout remote branch with local tracking
  - `egit.remoteBranch.delete` — Delete remote branch with confirmation
- ✅ Updated `src/commands/tag.ts`:
  - `egit.tag.forceCreate` — Force replace existing tag with confirmation
  - `egit.tag.deleteRemote` — Delete tag from remote repository
- ✅ Updated `src/commands/stash.ts`:
  - `egit.stash.branch` — Create new branch from stash
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
  - Use `egit.graph.pageSize` setting (default 200)
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
- Add new setting `egit.history.defaultFilter` (all/current-branch)
- Use `git log --skip=N --max-count=M` for pagination
- Store pagination state in `HistoryProvider` class
- Add new node type `HistoryLoadMoreNode` to represent "Load More" button

---

## Phase 4: Compare View & Staging Panel Upgrade ✅ COMPLETE

### Objectives
Add a dedicated Compare view for side-by-side branch/ref comparison. Upgrade the Staging view to a persistent webview panel.

### Completed Tasks
- ✅ **Compare View (Tree)**
  - New tree view: `egit.compare`
  - Show current comparison (if active)
  - Display: "Comparing [RefA] ↔ [RefB]"
  - List commits unique to each side
  - List changed files (aggregate diff)
  - Context menu on files: Open diff, Open file
  - Toolbar actions: Switch sides, Clear comparison, Pick new refs

- ✅ **Staging Panel Enhanced**
  - Convert `egit.staging` from TreeView to Webview panel
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
  - Implement `egit.confirmDestructiveActions` setting check
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
  - Implement `egit.showCommandPreview` setting
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
  - Current: `egit.lfs.info` shows tracked files
  - Add:
    - `egit.lfs.track` — Track new file patterns
    - `egit.lfs.untrack` — Untrack patterns
    - `egit.lfs.lock` — Lock files on remote
    - `egit.lfs.unlock` — Unlock files
    - `egit.lfs.locks` — Show all locks
    - `egit.lfs.pull` — Pull LFS objects
    - `egit.lfs.prune` — Prune old LFS objects

- ✅ **Git Notes**
  - `egit.notes.add` — Add note to commit
  - `egit.notes.edit` — Edit existing note
  - `egit.notes.remove` — Remove note
  - `egit.notes.show` — Show notes in commit details
  - Display notes in History view (optional column)

- ✅ **Worktree Lock/Unlock**
  - `egit.worktree.lock` — Lock worktree (prevent pruning)
  - `egit.worktree.unlock` — Unlock worktree
  - Show lock status in Worktrees view

- ✅ **Git Archive**
  - `egit.archive.create` — Create archive (zip/tar) from ref
  - Prompt for ref, format, output location
  - Support `--prefix` option

- ✅ **Subtree Operations**
  - `egit.subtree.add` — Add subtree
  - `egit.subtree.pull` — Pull subtree updates
  - `egit.subtree.push` — Push subtree changes
  - `egit.subtree.split` — Split subtree into separate history

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
- Add setting `egit.graph.layout` (compact/detailed)
- Add toolbar: Refresh, Fetch, Branch filter, Search

---

## Phase 8: Auto-Fetch & Background Operations ⏰ TODO

### Objectives
Implement automatic background fetching and repository monitoring.

### Tasks
- [ ] **Auto-Fetch Service**
  - Create `src/services/AutoFetchService.ts`
  - Read `egit.autoFetch.enabled` and `egit.autoFetch.intervalMinutes`
  - Start timer on extension activation
  - Fetch all remotes for all repositories
  - Show subtle notification on new commits
  - Pause during active operations (merge, rebase, etc.)

- [ ] **File System Watcher**
  - Watch `.git/` folder for external changes
  - Detect:
    - External commits (from command line)
    - Branch switches
    - Merge/rebase progress
  - Auto-refresh views on change

- [ ] **Ahead/Behind Indicators**
  - Show ahead/behind count in Repositories view
  - Update after fetch
  - Show in status bar (optional setting)

- [ ] **Pull Notifications**
  - Show notification when remote has new commits
  - Quick action: "Pull Now" button
  - Respect `egit.autoFetch.notify` setting

### Implementation Notes
- Use `vscode.workspace.createFileSystemWatcher()` for `.git/**` changes
- Debounce rapid file changes (500ms)
- Use `setInterval()` for auto-fetch timer
- Clear timer on extension deactivation
- Add status bar item showing last fetch time

---

## Phase 9: Configuration & Settings UI 🎨 TODO

### Objectives
Provide in-app configuration UI for common git settings.

### Tasks
- [ ] **Git Config Editor**
  - Webview panel showing user.name, user.email, etc.
  - Three levels: Local (repo), Global (user), System
  - Edit common settings:
    - User identity (name, email)
    - Default branch name
    - Pull strategy (merge/rebase)
    - Push default (simple/matching/current)
    - GPG signing
  - Show all settings in advanced mode (key-value list)

- [ ] **Repository Settings Panel**
  - Per-repository configuration
  - Quick actions:
    - Set upstream branch
    - Configure remote URLs
    - Set pull strategy
    - Enable/disable GPG signing
    - Set commit template path

- [ ] **Extension Settings Integration**
  - Show current `egit.*` settings
  - Quick toggle buttons for boolean settings
  - Link to VS Code settings editor

### Implementation Notes
- Create `src/webviews/config/` folder
- Use `git config --list --show-origin --show-scope` to read
- Use `git config --local/--global --add/--unset` to write
- Add command `egit.config.openPanel`

---

## Phase 10: Integration & Polish 🎯 TODO

### Objectives
Final integration, performance optimization, accessibility, and testing.

### Tasks
- [ ] **Keyboard Shortcuts**
  - Define default keybindings for common operations
  - Examples:
    - `Cmd+Shift+G C` — Commit
    - `Cmd+Shift+G P` — Push
    - `Cmd+Shift+G L` — Show History
    - `Cmd+Shift+G F` — Fetch

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

- [ ] **Error Handling**
  - Graceful degradation when git not found
  - Clear error messages for common git failures
  - Suggest fixes for common issues (e.g., merge conflicts)

- [ ] **Testing**
  - Unit tests for parsers (status, log, blame, etc.)
  - Integration tests for commands
  - Mock git execution for tests
  - Test coverage > 70%

- [ ] **Documentation**
  - README with feature overview
  - GIFs/screenshots for key features
  - CHANGELOG tracking all releases
  - CONTRIBUTING guide
  - Keyboard shortcuts reference

- [ ] **Marketplace Preparation**
  - Extension icon and banner
  - Detailed description
  - Categories and keywords
  - Pricing (free/paid features)
  - License file (MIT)

### Implementation Notes
- Add `contributes.keybindings` to `package.json`
- Use `@axe-core/playwright` for a11y testing
- Add `test/` folder with `mocha` or `vitest`
- Create `.github/workflows/ci.yml` for CI/CD
- Use `vsce package` to create `.vsix` for manual testing

---

## Settings Reference

### Existing Settings
- `egit.commit.gpgSign` — Sign commits with GPG
- `egit.commit.signOff` — Add Signed-off-by trailer
- `egit.fetch.pruneOnFetch` — Prune on fetch
- `egit.history.maxCommits` — Max commits in history (deprecated in Phase 3)
- `egit.blame.enabledByDefault` — Auto-enable blame

### New Settings (Phase 1)
- `egit.git.path` — Custom git executable path
- `egit.autoRefresh` — Auto-refresh views on change
- `egit.autoFetch.enabled` — Enable auto-fetch
- `egit.autoFetch.intervalMinutes` — Fetch interval
- `egit.graph.pageSize` — History page size (Phase 3)
- `egit.graph.sortOrder` — Commit sort order
- `egit.confirmDestructiveActions` — Confirm destructive ops
- `egit.showCommandPreview` — Preview git commands
- `egit.defaultPullMode` — Pull strategy (merge/rebase)

---

## Current Status

### ✅ Completed (70%)
- Phase 1: Explorer context menu (Team menu) — 100%
- Phase 2: Branch & tag enhancements — 100%
- Phase 3: History view enhancements — 100%
- Phase 4: Compare view & conflict resolution — 100%
- Phase 5: SCM view menus & safety layer — 100%
- Phase 6: Advanced operations (LFS, Notes, Archive, Subtree) — 100%
- Phase 7: Git graph interactive visualization — 100%

### 🔄 In Progress
- None

### 📋 Remaining (30%)
- Phase 8: Auto-fetch & background operations — 0%
- Phase 9: Configuration & settings UI — 0%
- Phase 10: Integration & polish — 0%

---

## Extension Statistics (After Phase 7)

- **Total Commands**: 125+ commands
- **Total Views**: 7 tree views + 1 webview panel (Git Graph)
- **Command Files**: 27+ modules
- **Repository Methods**: 92+ git operations
- **Lines of Code**: ~11,500+ lines

---

## Next Steps

1. **Immediate**: Phase 8 — Auto-fetch & background operations
2. **High Priority**: Phase 9 — Configuration & settings UI
3. **Final**: Phase 10 — Integration, polish, and release preparation
