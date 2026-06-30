/**
 * Curated documentation for the in-extension reference library.
 *
 * The operation list itself is built from package.json so every contributed
 * command is documented automatically. The curated material explains the
 * extension surfaces and the Git concepts behind those operations.
 */

export interface DocumentationManifest {
  version?: string;
  contributes?: {
    commands?: Array<{
      command: string;
      title: string;
      category?: string;
    }>;
    menus?: {
      commandPalette?: Array<{
        command: string;
        when?: string;
      }>;
    };
  };
}

export interface DocumentationEntry {
  name: string;
  definition: string;
  purpose: string;
  use: string;
  keywords?: string;
}

export interface OperationEntry {
  command: string;
  title: string;
  purpose: string;
  use: string;
  runnable: boolean;
}

export interface OperationCategory {
  id: string;
  name: string;
  purpose: string;
  workflow: string;
  caution?: string;
  operations: OperationEntry[];
}

export interface DocumentationData {
  version: string;
  components: DocumentationEntry[];
  glossary: DocumentationEntry[];
  operationCategories: OperationCategory[];
  operationCount: number;
  paletteOperationCount: number;
  added: string[];
  pending: string[];
}

const components: DocumentationEntry[] = [
  {
    name: "VsGit activity-bar container",
    definition:
      "The dedicated VsGit icon and sidebar container that groups the extension's repository tools.",
    purpose:
      "Keeps repository discovery, committing, advanced Git views, and documentation in one predictable location.",
    use:
      "Select the VsGit icon in the Activity Bar, then expand the view needed for the current task.",
    keywords: "sidebar container navigation activity bar",
  },
  {
    name: "Repositories",
    definition:
      "A compact, multi-root list of Git repositories detected in the open VS Code workspace.",
    purpose:
      "Selects the active repository and exposes frequent fetch, pull, push, history, clone, and refresh actions.",
    use:
      "Select a repository to make every other VsGit surface follow it. Use the title actions for common transport operations.",
    keywords: "active repository multi-root fetch pull push",
  },
  {
    name: "Commit",
    definition:
      "A persistent Source-Control-style webview containing the commit message, changed-file groups, and commit actions.",
    purpose:
      "Supports staging, hunk operations, amend, sign-off, GPG signing, Commit & Push, and Commit & Sync without leaving the sidebar.",
    use:
      "Stage the intended changes, enter a message, choose optional commit settings, then use the split commit button.",
    keywords: "staging message amend signoff gpg commit push sync",
  },
  {
    name: "Git Repositories",
    definition:
      "A detailed repository tree containing local and remote branches, tags, remotes, stashes, submodules, and worktrees.",
    purpose:
      "Provides object-oriented navigation and context menus for repository administration.",
    use:
      "Expand a repository and right-click the relevant object. Selecting a repository also changes the active repository.",
    keywords: "tree branches tags remotes stashes submodules",
  },
  {
    name: "Staging",
    definition:
      "An optional advanced tree that separates staged, unstaged, and conflicted files.",
    purpose:
      "Provides a compact alternative to the Commit webview for managing the index and reviewing diffs.",
    use:
      "Enable vsgit.showAdvancedViews, then use inline or context actions to stage, unstage, discard, diff, or commit.",
    keywords: "index stage unstage diff advanced",
  },
  {
    name: "Synchronize",
    definition:
      "An optional advanced view of commits ahead of and behind the configured upstream branch.",
    purpose:
      "Explains what will be pushed or pulled before synchronizing and provides commit-level actions.",
    use:
      "Configure an upstream branch, expand Incoming or Outgoing, and inspect or act on a commit.",
    keywords: "ahead behind upstream incoming outgoing",
  },
  {
    name: "Conflicts",
    definition:
      "An optional advanced list of files with unresolved merge states.",
    purpose:
      "Centralizes Use Ours, Use Theirs, Open Merge Editor, and Mark Resolved actions.",
    use:
      "Open the view during a merge, rebase, cherry-pick, or revert; resolve each file and continue the operation.",
    keywords: "merge conflict ours theirs resolve",
  },
  {
    name: "Reflog",
    definition:
      "An optional advanced view of local HEAD and reference movements recorded by Git.",
    purpose:
      "Recovers commits or branch positions that no longer appear in normal history.",
    use:
      "Find the last known good entry, inspect it, then checkout it or reset HEAD after confirming the target.",
    keywords: "recovery reset lost commit head",
  },
  {
    name: "Worktrees",
    definition:
      "An optional advanced view of linked working directories that share one repository.",
    purpose:
      "Lets multiple branches be checked out simultaneously without cloning the repository again.",
    use:
      "Create a worktree for a branch, open it in a window, and lock, move, remove, or prune it when needed.",
    keywords: "linked worktree branch directory",
  },
  {
    name: "Compare",
    definition:
      "An optional advanced tree showing commits and changed files between two refs.",
    purpose:
      "Makes branch, tag, or commit differences inspectable before merge, rebase, review, or release.",
    use:
      "Start a comparison, select both refs, then open commit details or file diffs; switch sides to reverse the perspective.",
    keywords: "diff refs branches symmetric comparison",
  },
  {
    name: "Git Graph",
    definition:
      "A full editor panel that renders the commit DAG, branch lanes, ref labels, metadata, changed files, and commit actions.",
    purpose:
      "Provides visual history exploration, ancestry tracing, tracking, searching, filtering, and ref or commit operations.",
    use:
      "Run VsGit: Show Git Graph. Select a row for details, Ctrl/Cmd-click two commits to compare, or right-click for actions.",
    keywords: "dag history graph lanes trace tracking",
  },
  {
    name: "History",
    definition:
      "A paginated commit log with graph lanes, filters, date ranges, and per-commit context menus.",
    purpose:
      "Supports focused history investigation when a full repository graph is not required.",
    use:
      "Run VsGit: Show History, choose a branch or filters, then inspect or act on matching commits.",
    keywords: "log commits author message date filter",
  },
  {
    name: "Native Source Control integration",
    definition:
      "VsGit-backed staged, working-tree, and merge resource groups published through VS Code's Source Control API.",
    purpose:
      "Makes VsGit diffs, quick-diff gutters, commit input, and resource actions available in the built-in Source Control panel.",
    use:
      "Open Source Control and use the VsGit repository groups or their file/group context menus.",
    keywords: "scm source control quick diff resource groups",
  },
  {
    name: "Git Config editor",
    definition:
      "A graphical editor for local, global, and read-only system Git configuration.",
    purpose:
      "Shows configuration origin and scope while avoiding manual key/value command entry for routine changes.",
    use:
      "Run VsGit: Open Git Config Panel, select a scope, then add, edit, or unset supported values.",
    keywords: "configuration local global system scope",
  },
  {
    name: "Inline blame",
    definition:
      "Editor decorations that identify the most recent commit responsible for the active line.",
    purpose:
      "Provides authorship and change context without opening a separate history panel.",
    use:
      "Run VsGit: Toggle Inline Blame or use the configured keyboard shortcut while a tracked file is open.",
    keywords: "author line annotation provenance",
  },
  {
    name: "Background services",
    definition:
      "Repository file watching, optional automatic fetch, notifications, and the Git Graph status-bar entry.",
    purpose:
      "Keeps views current when Git changes inside or outside VS Code and can discover remote updates periodically.",
    use:
      "Configure vsgit.autoRefresh, vsgit.autoFetch.*, and vsgit.graph.showStatusBarItem in Settings.",
    keywords: "watch auto fetch refresh status bar notification",
  },
  {
    name: "Documentation library",
    definition:
      "This searchable sidebar view and full-screen reference for VsGit components, Git terms, and every contributed operation.",
    purpose:
      "Explains what features do, why Git concepts matter, and where each operation is available.",
    use:
      "Open Documentation at the bottom of the VsGit sidebar, search by concept or command ID, or choose Open Full Library.",
    keywords: "help reference glossary operations library",
  },
];

const glossary: DocumentationEntry[] = [
  term("Repository", "A Git database plus its checked-out project files and configuration.", "Stores project history, refs, and collaboration settings.", "Open its folder in VS Code or clone an existing remote."),
  term("Working tree", "The checked-out files you edit on disk.", "Represents the current editable project state before staging.", "Edit files normally; inspect Changes to see differences from the index."),
  term("Worktree", "An additional working directory linked to the same repository database.", "Allows simultaneous branch checkouts without another clone.", "Create one from the Worktrees view, then open it in another window."),
  term("Index / staging area", "The proposed snapshot Git will use for the next commit.", "Separates reviewed changes from other working-tree edits.", "Stage files or hunks, verify the staged diff, then commit."),
  term("Tracked file", "A file already known to Git through a commit or the index.", "Participates in status, diff, and commit workflows.", "Modify, stage, restore, or remove it through VsGit file actions."),
  term("Untracked file", "A working-tree file Git is not currently tracking.", "Keeps new content outside history until explicitly staged.", "Stage it to track it, ignore it, or clean it if it is disposable."),
  term("Ignored file", "A file matched by .gitignore, an exclude file, or a global ignore rule.", "Prevents generated, local, or sensitive files from appearing as normal changes.", "Add an appropriate pattern to .gitignore; never rely on ignore rules for an already tracked secret."),
  term("Modified", "A tracked file whose content differs from the index or HEAD.", "Signals that a file has uncommitted changes.", "Open its diff, then stage, discard, or continue editing."),
  term("Staged", "A change currently recorded in the index.", "Marks exactly what the next non-amend commit will include.", "Review Staged Changes and unstage anything that should not be committed."),
  term("Commit", "An immutable snapshot with metadata and one or more parent commits.", "Records a meaningful project change in history.", "Stage changes, write an explanatory message, then commit."),
  term("Amend", "Replacement of the current tip commit with a new commit.", "Corrects the last message or snapshot before sharing it.", "Enable Amend in the Commit view; avoid amending a shared commit unless history rewriting is coordinated."),
  term("HEAD", "The symbolic pointer to the currently checked-out branch or a directly checked-out commit.", "Defines the current history position and default comparison base.", "Checkout a branch to attach HEAD, or a commit for a detached inspection."),
  term("Detached HEAD", "A state where HEAD points directly to a commit instead of a branch.", "Supports temporary inspection or testing without moving a branch.", "Create a branch before committing work you want to retain."),
  term("Branch", "A movable ref that identifies the latest commit in a line of work.", "Provides a named place for independent development.", "Create or checkout a branch, commit work, then merge or rebase it."),
  term("Local branch", "A branch stored in the local repository.", "Tracks local work and may be connected to an upstream branch.", "Manage it in Git Repositories or the Git Graph."),
  term("Remote-tracking branch", "A local record such as origin/main of a branch last observed on a remote.", "Shows remote state without directly checking out the remote ref.", "Fetch to update it; create a local tracking branch to work on it."),
  term("Upstream", "The remote branch associated with a local branch for pull, push, ahead, and behind calculations.", "Enables concise synchronization and status reporting.", "Use Configure Upstream or set it on the first push."),
  term("Ahead / behind", "Counts of commits present only locally or only on the upstream.", "Summarizes synchronization state.", "Inspect Synchronize, pull behind commits, and push ahead commits."),
  term("Ref", "A named pointer to a commit, including branches, tags, and remote-tracking branches.", "Makes commits addressable with stable names.", "Select refs in history, compare, reset, archive, and graph operations."),
  term("Revision", "Any expression Git can resolve to an object, such as HEAD, a branch, a tag, a SHA, or HEAD~2.", "Provides a general way to identify historical states.", "Enter or select one when an operation asks for a ref or revision."),
  term("SHA / commit hash", "The hexadecimal object identifier for a commit.", "Uniquely identifies an exact historical object.", "Copy it from History or Graph and use it in compare, checkout, or recovery actions."),
  term("Tag", "A named ref commonly used to mark a release or milestone.", "Makes an important commit easy to find and share.", "Create it at the intended commit and push it if collaborators need it."),
  term("Lightweight tag", "A tag that is only a name pointing to a commit.", "Provides a simple local or shared marker.", "Create a tag without annotation or signing options."),
  term("Annotated tag", "A tag object with a message, tagger identity, date, and optional signature.", "Provides release metadata and supports verification.", "Enable annotation in the Create Tag dialog and provide a message."),
  term("Remote", "A named URL used to exchange refs and objects with another repository.", "Connects local history to GitHub, GitLab, Gerrit, or another Git server.", "Add, edit, remove, or prune remotes through VsGit."),
  term("Origin", "The conventional default remote name created by clone.", "Provides the usual fetch and push destination.", "Treat it as a convention, not a special Git keyword; other remote names work too."),
  term("Clone", "Creation of a new local repository from a remote repository.", "Copies history, configures a remote, and checks out an initial branch.", "Run VsGit: Clone Repository and choose a URL and destination."),
  term("Initialize", "Creation of a new .git database in an existing folder.", "Starts version control for a local project.", "Run VsGit: Initialize Repository, then stage and commit the initial files."),
  term("Stage / add", "Copy selected working-tree content into the index.", "Builds the next commit snapshot.", "Stage files, groups, or individual hunks from Commit, Staging, Explorer, or Source Control."),
  term("Unstage", "Remove selected changes from the index while normally preserving working-tree edits.", "Refines the next commit without losing work.", "Use Unstage on a file, group, or hunk."),
  term("Diff", "A line-level comparison between two file or tree states.", "Explains exactly what changed.", "Open a diff from a file row or compare refs, commits, the index, and HEAD."),
  term("Fetch", "Download remote objects and update remote-tracking refs without changing the working tree.", "Refreshes knowledge of remote history safely.", "Fetch before reviewing incoming work or comparing with a remote branch."),
  term("Pull", "Fetch followed by integration into the current branch.", "Brings upstream commits into local history.", "Choose merge or rebase strategy, resolve conflicts if any, then continue."),
  term("Push", "Send local objects and update refs on a remote.", "Publishes commits and tags for collaboration.", "Confirm the destination and upstream; use force only when coordinated."),
  term("Force push", "A push that permits replacing remote history.", "Publishes intentionally rewritten history.", "Use only after checking the expected remote tip and coordinating with collaborators."),
  term("Fast-forward", "A ref update where the old tip is an ancestor of the new tip.", "Integrates history without creating a merge commit or rewriting commits.", "Pull or merge when histories have not diverged."),
  term("Merge", "Combine another history line into the current branch.", "Preserves existing commits and records convergence when required.", "Select a source branch, review the result, resolve conflicts, and commit if Git does not fast-forward."),
  term("Merge commit", "A commit with two or more parents.", "Records that separate histories were combined.", "Created by a non-fast-forward merge after conflicts and staged results are complete."),
  term("Merge base", "A best common ancestor of two commits.", "Provides the baseline for three-way merge and many comparisons.", "Use branch comparison to understand changes since histories diverged."),
  term("Conflict", "A change Git cannot combine automatically.", "Requires a human decision about the final content.", "Use the Merge Editor or ours/theirs actions, stage the resolution, and continue."),
  term("Ours / theirs", "Labels for the two sides of a conflict relative to the operation being performed.", "Provides whole-file resolution shortcuts.", "Verify the current operation because the meaning can differ during rebase; then choose and review the result."),
  term("Rebase", "Replay commits onto a different base, creating new commit IDs.", "Produces a linearized history or updates a branch before integration.", "Select a new base, resolve conflicts per commit, and continue, skip, or abort."),
  term("Interactive rebase", "A rebase with an editable todo list of commit actions.", "Reorders, combines, edits, or removes local commits.", "Open Interactive Rebase, arrange actions, save the plan, and resolve any stops."),
  term("Pick", "The default interactive-rebase action that keeps a commit.", "Replays a commit unchanged in intent.", "Leave a todo item as pick when it should remain separate."),
  term("Reword", "An interactive-rebase action that changes a commit message.", "Improves history without changing the snapshot.", "Mark the commit reword and provide the replacement message when prompted."),
  term("Squash", "Combine a commit with the previous commit and edit the combined message.", "Consolidates related work into one history unit.", "Place it after the commit it should join in the rebase todo."),
  term("Fixup", "Combine a commit with the previous commit while discarding the fixup message.", "Absorbs small correction commits cleanly.", "Use it for a commit whose separate message is not useful."),
  term("Drop", "Remove a commit while rewriting history.", "Deletes an unwanted local history change.", "Use only after checking dependent commits and unshared-history assumptions."),
  term("Cherry-pick", "Apply the change introduced by selected commit(s) onto the current branch.", "Transfers specific work without merging the entire source branch.", "Choose commits in order, resolve conflicts, and continue or abort."),
  term("Revert", "Create a new commit that inverses an earlier commit.", "Safely undoes shared history without rewriting it.", "Select the commit, review the inverse changes, resolve conflicts, and commit."),
  term("Reset", "Move HEAD and optionally reset the index and working tree to another revision.", "Repositions a branch or discards selected state depending on mode.", "Choose soft, mixed, hard, keep, or merge only after understanding what each mode preserves."),
  term("Soft reset", "Move HEAD while leaving the index and working tree unchanged.", "Turns commits back into staged changes.", "Use when rebuilding recent commits without losing their content."),
  term("Mixed reset", "Move HEAD and reset the index while leaving working-tree files.", "Turns commits or staged changes back into unstaged edits.", "Use for recommitting with a different staging selection."),
  term("Hard reset", "Move HEAD and make the index and tracked working-tree files match the target.", "Discards tracked local changes and commits from the branch tip.", "Review status and reflog recovery options before confirming."),
  term("Restore / replace", "Make a file match a selected Git state such as HEAD, the index, or another ref.", "Discards or substitutes file content without moving the branch.", "Open the file's Replace With menu and verify the source revision."),
  term("Stash", "A commit-like saved snapshot of working-tree and index changes outside normal branch history.", "Temporarily clears work while preserving unfinished changes.", "Create a named stash, then apply, pop, inspect, branch from, or drop it."),
  term("Apply vs pop", "Apply restores stash changes and keeps the stash; pop restores them and removes it after success.", "Controls whether the saved fallback remains available.", "Use apply when testing or when extra recovery safety is useful."),
  term("Reflog", "A local log of recent ref and HEAD values.", "Recovers commits after reset, rebase, amend, or branch deletion.", "Find the old SHA in Reflog and create a branch or reset to it."),
  term("Blame", "A line-by-line attribution to the last modifying commit.", "Finds change provenance and relevant history.", "Toggle inline blame and inspect the referenced commit rather than treating attribution as ownership."),
  term("Bisect", "A binary search across commits using good and bad markers.", "Finds the first commit that introduced a reproducible problem.", "Start with known endpoints, test each checkout, mark it good or bad, then reset when finished."),
  term("Patch", "A portable text representation of changes or commits.", "Transfers or reviews changes outside normal remote exchange.", "Create from staged changes or commits, or apply a trusted patch file."),
  term("Archive", "A snapshot of tracked files from a ref without repository history.", "Creates release or distribution zip/tar files.", "Choose a ref, format, optional prefix, and output path."),
  term("Submodule", "A repository recorded as a specific commit inside another repository.", "Pins an independently versioned dependency or component.", "Add, initialize, update, and sync it while committing both the gitlink and .gitmodules changes."),
  term("Subtree", "Another repository's content integrated into a subdirectory of the main history.", "Vendors or exchanges a component without requiring submodule checkout behavior.", "Add it at a prefix, then pull, push, or split its history."),
  term("Git LFS", "An extension that stores pointer files in Git and large content in separate object storage.", "Reduces repository object growth for large binary files.", "Install git-lfs, track patterns, commit .gitattributes, and use lock/pull/prune operations."),
  term("Git notes", "Metadata attached to objects without changing commit IDs.", "Adds review, build, or contextual information outside commit messages.", "Add, show, edit, or remove a note and configure note sharing when collaboration requires it."),
  term("Hook", "An executable Git runs at defined client or server events.", "Automates validation, message changes, or workflow integration.", "Keep hooks trusted and executable; VsGit invokes the real Git CLI, so normal hooks run."),
  term(".gitignore", "A versioned pattern file controlling which untracked paths Git normally ignores.", "Keeps build products and machine-local files out of status and commits.", "Add narrow patterns and commit the file when the rules should be shared."),
  term("Assume unchanged", "An index performance hint telling Git to avoid checking a tracked path for worktree changes.", "Can reduce stat work for files expected not to change; it is not an ignore mechanism.", "Use sparingly and clear it with No Assume Unchanged before expecting normal status behavior."),
  term("Skip worktree", "An index flag used by sparse-checkout-style workflows to treat a tracked path as absent or unchanged locally.", "Supports partial working trees; it is not a safe general-purpose local-ignore feature.", "Use only when you understand sparse checkout, and clear it with No Skip Worktree."),
  term("Clean", "Permanent removal of untracked files, and optionally directories or ignored files.", "Returns the working tree to a known state.", "Preview what will be removed and confirm that no untracked work is needed."),
  term("Prune", "Removal of stale references or unreachable/obsolete data, depending on the command.", "Cleans remote-tracking refs, worktree metadata, LFS objects, or Git objects.", "Confirm which prune operation is selected; their scopes and recovery properties differ."),
  term("Garbage collection (gc)", "Repository maintenance that packs and optimizes objects and may expire unreachable data.", "Improves storage and access efficiency.", "Run during maintenance windows and avoid aggressive expiry when recovery may be needed."),
  term("fsck", "Git's object connectivity and validity check.", "Diagnoses missing, corrupt, dangling, or unreachable objects.", "Run Check Integrity and inspect the report before attempting repair."),
  term("Gerrit", "A code-review system where commits are pushed to special refs for review.", "Supports review-first integration controlled by Gerrit.", "Install the Change-Id hook when required, commit, then Push for Review."),
  term("Change-Id", "A Gerrit commit-message footer that links patch-set revisions to one review.", "Keeps amended or rebased versions associated with the same Gerrit change.", "Install the hook before committing or preserve the existing footer when amending."),
  term("Pull-request ref", "A hosting-provider ref exposing a pull request head outside normal branches.", "Allows local inspection of proposed changes.", "Use Fetch GitHub Pull Requests to create local refs for available PR heads."),
  term("Refspec", "A mapping describing which source refs are fetched or pushed to which destination refs.", "Controls remote namespace exchange.", "Use standard remote operations unless a workflow explicitly requires a custom refspec."),
  term("DAG", "The directed acyclic graph formed by commits and parent links.", "Models branching, merging, ancestry, and reachability.", "Use Git Graph trace and tracking controls to inspect paths through the DAG."),
  term("Author vs committer", "The author originally wrote a change; the committer created the current commit object.", "Explains why rebased or applied commits can have different identities and dates.", "Toggle both columns in Git Graph when auditing rewritten or imported history."),
  term("Signed-off-by / DCO", "A commit-message trailer asserting contribution under a project's Developer Certificate of Origin process.", "Supports policy attestation; it is not a cryptographic signature.", "Enable Sign off before committing when the project requires it."),
  term("GPG signature", "A cryptographic signature attached to a commit or annotated tag.", "Lets others verify signer identity and object integrity when trust is configured.", "Configure Git signing, enable GPG, and use Verify GPG Signature on commits."),
];

function term(
  name: string,
  definition: string,
  purpose: string,
  use: string,
): DocumentationEntry {
  return { name, definition, purpose, use };
}

const categoryDefinitions = [
  category(
    "repository",
    "Repository setup & discovery",
    "Create, clone, initialize, select, and refresh repositories.",
    "Start here when bringing a project under Git or choosing the active repository.",
  ),
  category(
    "transport",
    "Remotes & synchronization",
    "Exchange refs and objects with remotes and inspect synchronization state.",
    "Fetch first when you only need remote awareness; pull integrates; push publishes.",
    "Push, remote removal, and cleaning stale refs can affect shared workflows.",
  ),
  category(
    "changes",
    "Staging & working-tree changes",
    "Move changes between the working tree and index, inspect diffs, and discard or ignore content.",
    "Review a diff, stage the intended files or hunks, and verify the index before committing.",
    "Discard, delete, clean, and replace operations can remove local work.",
  ),
  category(
    "commits",
    "Commits & commit-level actions",
    "Create, amend, inspect, verify, transfer, undo, or combine commits.",
    "Use immutable follow-up operations such as revert for shared history; rewrite only local history.",
    "Amend, squash, and some cherry-pick workflows create new commit IDs.",
  ),
  category(
    "refs",
    "Branches & tags",
    "Create and manage movable branches, remote-tracking branches, upstreams, and release tags.",
    "Choose a ref in the repository tree or graph, then use its context actions.",
    "Deleting refs or force-replacing tags can make commits harder to find.",
  ),
  category(
    "history",
    "History, graph & comparison",
    "Explore ancestry, search commits, compare refs or files, inspect reflog entries, and attribute lines.",
    "Open Graph for repository topology, History for focused logs, and Compare for two-ref differences.",
  ),
  category(
    "integration",
    "Merge, rebase & conflicts",
    "Integrate histories and complete or abort in-progress sequencer operations.",
    "Inspect source and target refs, integrate, resolve every conflict, stage resolutions, then continue.",
    "Rebase rewrites commit IDs; abort or reflog can recover an unwanted result.",
  ),
  category(
    "stash",
    "Stashes",
    "Temporarily save unfinished index and working-tree changes outside branch history.",
    "Create a stash before switching tasks, inspect it, then apply, pop, or create a branch from it.",
    "Dropping or clearing stashes removes their normal recovery entry.",
  ),
  category(
    "worktrees",
    "Worktrees",
    "Manage multiple linked working directories for one repository.",
    "Create a worktree per simultaneous branch task and remove it after the work is integrated.",
    "Removing a worktree with uncommitted changes can lose work.",
  ),
  category(
    "recovery",
    "Recovery, diagnosis & maintenance",
    "Find regressions, reset repository state, inspect integrity, and optimize object storage.",
    "Prefer read-only logs and checks first; capture a recovery ref before destructive maintenance.",
    "Hard reset, prune, and aggressive maintenance can discard recoverable state.",
  ),
  category(
    "exchange",
    "Patches & archives",
    "Export changes or tracked snapshots to files and apply portable patches.",
    "Use patches for change exchange and archives for history-free release artifacts.",
    "Review patch contents and paths before applying files from another source.",
  ),
  category(
    "composition",
    "LFS, submodules & subtrees",
    "Manage large-file storage and repositories composed from other repositories.",
    "Choose the model that matches the project, then commit its metadata alongside content changes.",
    "These workflows may require extra tools, server support, or coordinated remote configuration.",
  ),
  category(
    "collaboration",
    "Notes & Gerrit",
    "Attach metadata to commits and publish Gerrit review changes.",
    "Use notes for separate metadata and Gerrit Change-Ids for review patch-set continuity.",
  ),
  category(
    "configuration",
    "Configuration",
    "Inspect or edit Git configuration at local, global, and system scopes.",
    "Prefer local scope for repository-specific policy and global scope for personal defaults.",
    "Configuration can change authentication, signing, transport, merge, and hook behavior.",
  ),
] as const;

function category(
  id: string,
  name: string,
  purpose: string,
  workflow: string,
  caution?: string,
) {
  return { id, name, purpose, workflow, caution };
}

const namespaceCategory: Record<string, string> = {
  archive: "exchange",
  autoFetch: "transport",
  bisect: "recovery",
  blame: "history",
  branch: "refs",
  commit: "commits",
  compare: "history",
  config: "configuration",
  conflict: "integration",
  file: "changes",
  gerrit: "collaboration",
  graph: "history",
  history: "history",
  lfs: "composition",
  maintenance: "recovery",
  merge: "integration",
  notes: "collaboration",
  patch: "exchange",
  rebase: "integration",
  reflog: "history",
  remote: "transport",
  remoteBranch: "refs",
  replace: "changes",
  repo: "recovery",
  repositories: "repository",
  scm: "changes",
  staging: "changes",
  stash: "stash",
  submodule: "composition",
  subtree: "composition",
  sync: "transport",
  tag: "refs",
  worktree: "worktrees",
};

const exactCategory: Record<string, string> = {
  "vsgit.clone": "repository",
  "vsgit.init": "repository",
  "vsgit.clean": "changes",
  "vsgit.fetch": "transport",
  "vsgit.pull": "transport",
  "vsgit.push": "transport",
  "vsgit.fetchGithubPrs": "transport",
  "vsgit.switchTo": "refs",
  "vsgit.merge": "integration",
  "vsgit.rebase": "integration",
  "vsgit.mergeTool": "integration",
  "vsgit.showCommitDetails": "commits",
};

const exactPurpose: Record<string, string> = {
  "vsgit.file.assumeUnchanged":
    "Set Git's assume-unchanged performance hint for the selected tracked file.",
  "vsgit.file.noAssumeUnchanged":
    "Clear the assume-unchanged flag so normal status detection resumes.",
  "vsgit.file.skipWorktree":
    "Set the skip-worktree index flag used by partial working-tree workflows.",
  "vsgit.file.noSkipWorktree":
    "Clear the skip-worktree flag so the path participates normally in the working tree.",
  "vsgit.compare.withClipboard":
    "Compare the active editor content with text currently stored on the clipboard.",
  "vsgit.compare.withLocalHistory":
    "Compare a file with a snapshot maintained by VS Code Local History.",
  "vsgit.repo.reset.soft":
    "Move HEAD to a selected ref while preserving both the index and working tree.",
  "vsgit.repo.reset.mixed":
    "Move HEAD and reset the index while preserving working-tree content.",
  "vsgit.repo.reset.hard":
    "Move HEAD and make the index and tracked working tree match the selected ref.",
  "vsgit.repo.reset.keep":
    "Move HEAD while preserving compatible local working-tree changes.",
  "vsgit.repo.reset.merge":
    "Reset using merge-style index handling while preserving qualifying unmerged changes.",
  "vsgit.stash.apply":
    "Restore a stash into the working tree while keeping the stash entry.",
  "vsgit.stash.pop":
    "Restore a stash and remove its entry after a successful application.",
  "vsgit.conflict.useOurs":
    "Replace the conflicted file with the current operation's ours side.",
  "vsgit.conflict.useTheirs":
    "Replace the conflicted file with the current operation's theirs side.",
  "vsgit.gerrit.installHook":
    "Install Gerrit's commit-msg hook so new commits receive a Change-Id footer.",
  "vsgit.lfs.prune":
    "Remove old local Git LFS objects that are no longer required by recent refs.",
  "vsgit.maintenance.fsck":
    "Check object validity and repository connectivity with git fsck.",
};

export function buildDocumentationData(
  manifest: DocumentationManifest,
): DocumentationData {
  const commands = manifest.contributes?.commands ?? [];
  const hidden = new Set(
    (manifest.contributes?.menus?.commandPalette ?? [])
      .filter((entry) => entry.when === "false")
      .map((entry) => entry.command),
  );

  const operationCategories: OperationCategory[] = categoryDefinitions.map(
    (definition) => ({
      ...definition,
      operations: [],
    }),
  );
  const categoryMap = new Map(
    operationCategories.map((entry) => [entry.id, entry]),
  );

  for (const command of commands) {
    const namespace = command.command.replace(/^vsgit\./, "").split(".")[0];
    const categoryId =
      exactCategory[command.command] ?? namespaceCategory[namespace] ?? "repository";
    const destination = categoryMap.get(categoryId);
    if (!destination) continue;
    const runnable = !hidden.has(command.command);
    destination.operations.push({
      command: command.command,
      title: command.title,
      purpose:
        exactPurpose[command.command] ??
        inferPurpose(command.command, command.title, destination.name),
      use: runnable
        ? `Open the Command Palette and run “${command.category ?? "VsGit"}: ${command.title}”, then follow any picker or confirmation.`
        : "Use this contextual action from the relevant repository, file, group, branch, tag, commit, graph, or history menu.",
      runnable,
    });
  }

  for (const operationCategory of operationCategories) {
    operationCategory.operations.sort((a, b) =>
      a.title.localeCompare(b.title),
    );
  }

  return {
    version: manifest.version ?? "development",
    components,
    glossary,
    operationCategories: operationCategories.filter(
      (entry) => entry.operations.length > 0,
    ),
    operationCount: commands.length,
    paletteOperationCount: commands.length - hidden.size,
    added: [
      "Searchable Documentation view at the bottom of the VsGit sidebar.",
      "Full-screen documentation library opened from the sidebar or Command Palette.",
      "Detailed guide to every VsGit component and when to use it.",
      "Git glossary covering daily workflows, history rewriting, recovery, collaboration, and repository composition.",
      "Manifest-driven operation catalog that includes every contributed command and identifies contextual actions.",
      "Phase 10 accessibility semantics, high-contrast support, performance instrumentation, Extension Host tests, coverage thresholds, CI gates, and verified VSIX packaging.",
    ],
    pending: [
      "Multi-platform Extension Host runs beyond the current macOS development and Ubuntu CI coverage.",
      "Larger synthetic-repository benchmarks and further on-demand loading for rarely used metadata.",
      "Localization of documentation and command descriptions.",
      "Current live workflow recordings for the Marketplace listing.",
      "Signed release provenance and automated post-publish Marketplace smoke tests.",
    ],
  };
}

function inferPurpose(
  command: string,
  title: string,
  categoryName: string,
): string {
  const action = command.split(".").at(-1) ?? "";
  const object = title.replace(/\.\.\.$/, "");
  const purposes: Record<string, string> = {
    refresh: `Reload ${categoryName.toLowerCase()} data from the active repository.`,
    show: `Display ${object.toLowerCase()} for the selected repository object.`,
    open: `Open ${object.toLowerCase()} in the appropriate VS Code surface.`,
    create: `Create ${object.toLowerCase()} after collecting the required Git inputs.`,
    add: `Add ${object.toLowerCase()} to the active repository workflow.`,
    edit: `Update ${object.toLowerCase()} after showing its current value.`,
    remove: `Remove ${object.toLowerCase()} after confirmation where the action is destructive.`,
    delete: `Delete ${object.toLowerCase()} after confirming the selected target.`,
    checkout: `Check out the selected target and update HEAD or the working tree as appropriate.`,
    stage: "Copy the selected working-tree change into the Git index.",
    unstage: "Remove the selected change from the index while preserving working-tree content.",
    stageAll: "Stage all eligible changes in the active repository.",
    unstageAll: "Remove all staged changes from the index while preserving working-tree content.",
    discard: "Discard the selected local working-tree changes after confirmation.",
    discardAll: "Discard all eligible local working-tree changes after confirmation.",
    commit: "Create a commit from the current index using the supplied message and options.",
    commitAmend: "Replace the current tip commit with an updated snapshot or message.",
    fetch: "Download remote objects and refresh remote-tracking refs without integrating them.",
    pull: "Fetch and integrate the configured upstream into the current branch.",
    push: "Publish local refs and objects to the selected remote.",
    reset: `Reset ${categoryName.toLowerCase()} state for the selected target.`,
    prune: `Remove stale or obsolete ${categoryName.toLowerCase()} data for the selected scope.`,
    apply: `Apply ${object.toLowerCase()} to the active repository.`,
    lock: `Lock ${object.toLowerCase()} to prevent conflicting or automatic changes.`,
    unlock: `Unlock ${object.toLowerCase()} so normal changes can resume.`,
    toggle: `Toggle ${object.toLowerCase()} for the active editor or repository.`,
  };
  return (
    purposes[action] ??
    `Perform “${object}” as part of the ${categoryName.toLowerCase()} workflow.`
  );
}
