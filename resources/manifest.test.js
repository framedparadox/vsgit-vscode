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
  const settings = new Set(Object.keys(pkg.contributes?.configuration?.properties ?? {}));
  const graphPanel = read('src/webviews/graph/GraphPanel.ts');
  const graphJs = read('resources/graph.js');

  const columns = [
    ['vsgit.graph.showIdColumn', 'graph.showIdColumn', 'id', 'col-id'],
    ['vsgit.graph.showAuthorColumn', 'graph.showAuthorColumn', 'author', 'col-author'],
    ['vsgit.graph.showAuthoredDateColumn', 'graph.showAuthoredDateColumn', 'authoredDate', 'col-adate'],
    ['vsgit.graph.showCommitterColumn', 'graph.showCommitterColumn', 'committer', 'col-committer'],
    ['vsgit.graph.showCommittedDateColumn', 'graph.showCommittedDateColumn', 'committedDate', 'col-cdate'],
  ];

  for (const [setting, configKey, payloadKey, cssClass] of columns) {
    assert.ok(settings.has(setting), `${setting} is contributed`);
    assert.ok(graphPanel.includes(`"${configKey}"`), `${configKey} is read by GraphPanel`);
    assert.ok(graphJs.includes(payloadKey), `${payloadKey} is handled by graph.js`);
    assert.ok(graphJs.includes(cssClass), `${cssClass} is rendered by graph.js`);
  }
});
