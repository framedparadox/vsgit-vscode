'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function listCommandSource() {
  const commandDir = path.join(root, 'src', 'commands');
  return [
    read('src/extension.ts'),
    ...fs.readdirSync(commandDir)
      .filter((name) => name.endsWith('.ts'))
      .map((name) => fs.readFileSync(path.join(commandDir, name), 'utf8')),
  ].join('\n');
}

function registeredCommands() {
  const source = listCommandSource();
  const ids = new Set();
  for (const re of [
    /\bregisterCommand\(\s*[`'"]([^`'"]+)/g,
    /\breg\(\s*[`'"]([^`'"]+)/g,
  ]) {
    for (const match of source.matchAll(re)) {
      ids.add(match[1]);
    }
  }
  return ids;
}

function menuCommands(pkg) {
  const ids = new Set();
  for (const entries of Object.values(pkg.contributes?.menus ?? {})) {
    for (const item of entries) {
      if (item.command) {
        ids.add(item.command);
      }
    }
  }
  return ids;
}

test('all contributed commands and menu entries are registered', () => {
  const pkg = JSON.parse(read('package.json'));
  const registered = registeredCommands();
  const required = new Set([
    ...(pkg.contributes?.commands ?? []).map((cmd) => cmd.command),
    ...menuCommands(pkg),
    ...(pkg.contributes?.keybindings ?? []).map((binding) => binding.command),
  ]);

  const missing = [...required].filter((id) => !registered.has(id)).sort();
  assert.deepStrictEqual(missing, []);
});

test('README settings table matches contributed settings', () => {
  const pkg = JSON.parse(read('package.json'));
  const contributed = new Set(Object.keys(pkg.contributes?.configuration?.properties ?? {}));
  const readme = read('README.md');
  const documented = new Set(
    [...readme.matchAll(/^\| `(vsgit\.[^`]+)` \|/gm)].map((match) => match[1]),
  );

  const undocumented = [...contributed].filter((key) => !documented.has(key)).sort();
  const stale = [...documented].filter((key) => !contributed.has(key)).sort();

  assert.deepStrictEqual(undocumented, []);
  assert.deepStrictEqual(stale, []);
});

test('Git Graph column settings are contributed, sent, and rendered', () => {
  const pkg = JSON.parse(read('package.json'));
  const settingsObject = pkg.contributes?.configuration?.properties ?? {};
  const settings = new Set(Object.keys(settingsObject));
  const graphPanel = read('src/webviews/graph/GraphPanel.ts');
  const graphJs = read('resources/graph.js');

  const columns = [
    ['vsgit.graph.showIdColumn', 'graph.showIdColumn', 'id', 'col-id', true],
    ['vsgit.graph.showAuthorColumn', 'graph.showAuthorColumn', 'author', 'col-author', true],
    ['vsgit.graph.showAuthoredDateColumn', 'graph.showAuthoredDateColumn', 'authoredDate', 'col-adate', false],
    ['vsgit.graph.showCommitterColumn', 'graph.showCommitterColumn', 'committer', 'col-committer', false],
    ['vsgit.graph.showCommittedDateColumn', 'graph.showCommittedDateColumn', 'committedDate', 'col-cdate', true],
  ];

  for (const [setting, configKey, payloadKey, cssClass, defaultValue] of columns) {
    assert.ok(settings.has(setting), `${setting} is contributed`);
    assert.strictEqual(settingsObject[setting].default, defaultValue, `${setting} default`);
    assert.ok(graphPanel.includes(`"${configKey}"`), `${configKey} is read by GraphPanel`);
    assert.ok(graphJs.includes(payloadKey), `${payloadKey} is handled by graph.js`);
    assert.ok(graphJs.includes(cssClass), `${cssClass} is rendered by graph.js`);
  }

  assert.ok(graphPanel.includes('case "setColumnVisibility"'), 'GraphPanel handles column updates');
  assert.ok(graphPanel.includes('vscode.ConfigurationTarget.Global'), 'column updates persist globally');
  assert.ok(graphJs.includes("type: 'setColumnVisibility'"), 'graph.js sends column updates');
  assert.ok(graphJs.includes('COLUMN_OPTIONS'), 'graph.js renders the Columns menu');
  assert.ok(graphJs.includes('tb-columns'), 'graph.js wires the Columns toolbar button');
});

test('native SCM provider is registered and menu actions target resource groups', () => {
  const pkg = JSON.parse(read('package.json'));
  const extension = read('src/extension.ts');
  const scmProvider = read('src/views/ScmProvider.ts');
  const scmCommands = read('src/commands/scm.ts');
  const resourceStateMenus = pkg.contributes?.menus?.['scm/resourceState/context'] ?? [];
  const resourceGroupMenus = pkg.contributes?.menus?.['scm/resourceGroup/context'] ?? [];

  assert.ok(extension.includes('new VsgitScmProvider(manager)'), 'SCM provider is activated');
  assert.ok(scmProvider.includes('vscode.scm.createSourceControl('), 'SCM provider creates source controls');
  assert.ok(scmProvider.includes('"index", "Staged Changes"'), 'SCM provider exposes staged group');
  assert.ok(scmProvider.includes('"workingTree", "Changes"'), 'SCM provider exposes working tree group');
  assert.ok(scmProvider.includes('"merge", "Merge Changes"'), 'SCM provider exposes merge group');
  assert.ok(scmProvider.includes('vsgitChange: change'), 'SCM resources carry parsed status metadata');
  assert.ok(scmProvider.includes('quickDiffProvider'), 'native SCM uses VsGit quick diff');
  assert.ok(scmProvider.includes('new VsgitQuickDiffProvider(this.manager, repo.root)'), 'SCM provider reuses quick diff provider');
  assert.ok(scmProvider.includes('acceptInputCommand'), 'native SCM input box can commit');
  assert.ok(!extension.includes('vscode.scm.createSourceControl("vsgit", "VsGit")'), 'old empty SCM provider was removed');
  assert.ok(scmCommands.includes('resourceGroup('), 'SCM commands inspect resource group metadata');
  assert.ok(scmCommands.includes('resourceChange('), 'SCM commands inspect status metadata');
  assert.ok(scmCommands.includes('discardPathSets('), 'SCM discard separates tracked and untracked paths');
  assert.ok(scmCommands.includes('repo.discard(discard.tracked, discard.untracked)'), 'SCM discard cleans untracked paths');
  assert.ok(scmCommands.includes('VSGIT_EMPTY_REF'), 'SCM diff can render deleted working-tree files');
  assert.ok(scmCommands.includes('Index ↔ Working Tree'), 'SCM working-tree diffs compare index to working tree');
  assert.ok(scmCommands.includes('manager.findByUri'), 'SCM commands resolve repos by URI containment');

  assert.strictEqual(
    resourceStateMenus.find((item) => item.command === 'vsgit.scm.stage')?.when,
    'scmProvider == vsgit && scmResourceGroup != index',
  );
  assert.strictEqual(
    resourceStateMenus.find((item) => item.command === 'vsgit.scm.unstage')?.when,
    'scmProvider == vsgit && scmResourceGroup == index',
  );
  assert.strictEqual(
    resourceStateMenus.find((item) => item.command === 'vsgit.scm.discard')?.when,
    'scmProvider == vsgit && scmResourceGroup != index',
  );
  assert.strictEqual(
    resourceGroupMenus.find((item) => item.command === 'vsgit.scm.stageAll')?.when,
    'scmProvider == vsgit && scmResourceGroup != index',
  );
  assert.strictEqual(
    resourceGroupMenus.find((item) => item.command === 'vsgit.scm.unstageAll')?.when,
    'scmProvider == vsgit && scmResourceGroup == index',
  );
  assert.strictEqual(
    resourceGroupMenus.find((item) => item.command === 'vsgit.scm.discardAll')?.when,
    'scmProvider == vsgit && scmResourceGroup != index',
  );
});

test('configured git path and command preview are wired through the shared executor', () => {
  const executor = read('src/git/GitExecutor.ts');
  const manager = read('src/git/RepositoryManager.ts');
  const extension = read('src/extension.ts');
  const contentProvider = read('src/git/GitContentProvider.ts');
  const commandPreview = read('src/util/commandPreview.ts');

  assert.ok(executor.includes('private gitPath: string = "git"'), 'GitExecutor stores the configured path');
  assert.ok(executor.includes('spawn(this.gitPath, args'), 'GitExecutor spawns the configured path');
  assert.ok(executor.includes('this.preview(args, options.cwd, this.gitPath)'), 'preview sees the executable path');
  assert.ok(manager.includes('new GitExecutor(configuredGitPath(), shouldRunGitCommand)'), 'manager creates shared configured executor');
  assert.ok(manager.includes('updateGitPathFromConfiguration()'), 'manager can update git path after configuration changes');
  assert.ok(extension.includes('e.affectsConfiguration("vsgit.git.path")'), 'extension listens for git path changes');
  assert.ok(extension.includes('manager.updateGitPathFromConfiguration()'), 'extension applies git path changes');
  assert.ok(extension.includes('new GitContentProvider(manager.getGitExecutor())'), 'diff content provider uses shared executor');
  assert.ok(contentProvider.includes('constructor(private readonly git: GitExecutor)'), 'content provider receives executor');
  assert.ok(contentProvider.includes('export const VSGIT_EMPTY_REF'), 'content provider has explicit empty-side ref');
  assert.ok(contentProvider.includes('vscode.Uri.from({'), 'content provider encodes virtual URI paths structurally');
  assert.ok(commandPreview.includes('get<boolean>("showCommandPreview", false)'), 'preview setting is read');
  assert.ok(commandPreview.includes('[gitPath || "git", ...args]'), 'preview renders configured executable');
  assert.ok(commandPreview.includes('isReadOnlyGitCommand(args)'), 'background read-only commands are not previewed');
});

test('repository routing uses active repo and containment-aware URI lookup', () => {
  const manager = read('src/git/RepositoryManager.ts');
  const staging = read('src/views/StagingProvider.ts');
  const sync = read('src/views/SynchronizeProvider.ts');
  const reflog = read('src/views/ReflogProvider.ts');
  const history = read('src/webviews/HistoryView.ts');
  const graph = read('src/webviews/graph/GraphPanel.ts');
  const quickDiff = read('src/git/QuickDiffProvider.ts');
  const blame = read('src/decorations/BlameController.ts');
  const compare = read('src/commands/compare.ts');

  assert.ok(manager.includes('getActive(): Repository | undefined'), 'manager exposes active repo');
  assert.ok(manager.includes('setActive(root: string): void'), 'manager can set active repo');
  assert.ok(manager.includes('findByUri(uri: vscode.Uri): Repository | undefined'), 'manager resolves repo by URI');
  assert.ok(manager.includes('sort((a, b) => b.root.length - a.root.length)'), 'nested repos prefer deepest root');
  assert.ok(manager.includes('relativePath(repo: Repository, uri: vscode.Uri): string'), 'manager owns git-relative path conversion');
  assert.ok(manager.includes('"--absolute-git-dir"'), 'manager resolves linked-worktree git dirs');
  assert.ok(manager.includes('"--git-common-dir"'), 'manager resolves common git dirs for refs');
  assert.ok(manager.includes('watchGitPath(root, watchPath)'), 'manager watches resolved git paths');
  assert.ok(staging.includes('return this.manager.getActive();'), 'staging view uses active repo');
  assert.ok(sync.includes('this.repo = this.manager.getActive();'), 'synchronize view uses active repo');
  assert.ok(reflog.includes('this.repo = this.manager.getActive();'), 'reflog view uses active repo');
  assert.ok(history.includes('repo ?? this.manager.getActive()'), 'history fallback uses active repo');
  assert.ok(graph.includes('initialRepo ?? manager.getActive()'), 'graph fallback uses active repo');
  assert.ok(quickDiff.includes('this.manager.findByUri(uri)'), 'quick diff uses containment lookup');
  assert.ok(blame.includes('this.manager.findByUri(editor.document.uri)'), 'blame uses containment lookup');
  assert.ok(compare.includes('manager.findByUri(uri)'), 'compare uses containment lookup');
});

test('Git Graph trace defaults to explicit toolbar control', () => {
  const graphJs = read('resources/graph.js');

  assert.ok(
    graphJs.includes("return p.traceMode || 'off';"),
    'trace mode defaults to off',
  );
  assert.ok(
    graphJs.includes("if (traceMode !== 'off' && commit.kind !== 'uncommitted') setTraceRoot(commit.sha);"),
    'normal commit selection does not force tracing while trace is off',
  );
  assert.ok(
    graphJs.includes('clearTraceRoot();'),
    'selection reset clears trace root',
  );
  assert.ok(
    graphJs.includes("const order = ['off', 'ancestors', 'both'];"),
    'trace toolbar cycles from off to explicit trace modes',
  );
});

test('Git Graph tracking is separate webview state', () => {
  const graphPanel = read('src/webviews/graph/GraphPanel.ts');
  const graphJs = read('resources/graph.js');

  assert.ok(graphPanel.includes('id="tb-tracking"'), 'Tracking toolbar button exists');
  assert.ok(graphPanel.includes('data-label="Tracking"'), 'Tracking button has hover label');
  assert.ok(graphPanel.includes('aria-label="Tracking"'), 'Tracking button has accessible label');
  assert.ok(graphPanel.includes('data-icon="tracking"'), 'Tracking button uses tracking icon');
  assert.ok(graphJs.includes('trackingEnabled'), 'tracking state is explicit');
  assert.ok(graphJs.includes('trackedSha'), 'tracked commit state is explicit');
  assert.ok(graphJs.includes('trackedRef'), 'tracked ref state is explicit');
  assert.ok(graphJs.includes('function setTrackingEnabled'), 'tracking can be toggled');
  assert.ok(graphJs.includes('function trackCommit'), 'commits can be tracked');
  assert.ok(graphJs.includes('function trackRef'), 'refs can be tracked');
  assert.ok(graphJs.includes('function applyTrackingSelection'), 'tracked item is restored');
  assert.ok(graphJs.includes('vscode.setState({'), 'tracking persists in webview state');
  assert.ok(graphJs.includes('traceMode') && graphJs.includes('trackingEnabled'), 'trace and tracking are separate states');
});

test('Git Graph top bar buttons expose labels and table fills available width', () => {
  const graphPanel = read('src/webviews/graph/GraphPanel.ts');
  const graphJs = read('resources/graph.js');
  const graphCss = read('resources/graph.css');
  const buttonIds = [
    'tb-pull',
    'tb-push',
    'tb-fetch',
    'tb-commit',
    'tb-branch',
    'tb-merge',
    'tb-stash',
    'tb-find',
    'tb-columns',
    'tb-tracking',
    'tb-trace',
    'tb-refresh',
  ];

  for (const id of buttonIds) {
    const button = graphPanel.match(new RegExp(`<button[^>]+id="${id}"[^>]+>`));
    assert.ok(button, `${id} exists`);
    assert.ok(button[0].includes('data-label='), `${id} has data-label`);
    assert.ok(button[0].includes('aria-label='), `${id} has aria-label`);
  }

  assert.ok(graphCss.includes('.tb-btn.icon-only[data-label]::after'), 'toolbar labels use CSS tooltip');
  assert.ok(graphCss.includes('#main') && graphCss.includes('width: 100%;'), '#main spans width');
  assert.ok(graphCss.includes('#graph-table') && graphCss.includes('min-width: 100%;'), 'table spans width');
  assert.ok(graphCss.includes('#col-desc { width: 100%; }'), 'Description column remains flexible');
  assert.ok(graphJs.includes('function updateDescriptionColumnWidth'), 'Description width is recalculated');
  assert.ok(graphJs.includes("CONFIG.columns[key] === false ? 0"), 'hidden columns free width for Description');
});

test('Git Graph trace keeps the graph overlay bright', () => {
  const graphCss = read('resources/graph.css');

  assert.ok(
    graphCss.includes('tr.commit-row.dimmed td:not(.col-graph)'),
    'row dimming skips the graph cell that hosts the overlay SVG',
  );
  assert.ok(
    graphCss.includes('#graph-svg .graph-line:not(.dim)'),
    'active traced graph lines are visually emphasized',
  );
  assert.ok(
    graphCss.includes('#graph-svg .graph-node:not(.dim)'),
    'active traced graph nodes are visually emphasized',
  );
});
