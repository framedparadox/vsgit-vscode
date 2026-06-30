'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('every TreeDataProvider supplies explicit screen-reader labels', () => {
  const viewDir = path.join(root, 'src', 'views');
  const providers = fs.readdirSync(viewDir)
    .filter((name) => name.endsWith('Provider.ts'))
    .map((name) => [`src/views/${name}`, read(`src/views/${name}`)])
    .filter(([, source]) => source.includes('TreeDataProvider<'));

  assert.ok(providers.length >= 7, 'expected the sidebar tree providers');
  for (const [file, source] of providers) {
    assert.ok(
      source.includes('accessibleTreeItem('),
      `${file} assigns accessibilityInformation through accessibleTreeItem`,
    );
  }
  assert.ok(
    read('src/views/treeAccessibility.ts').includes('item.accessibilityInformation = { label }'),
    'tree accessibility helper assigns the complete label',
  );
});

test('every webview surface has live announcements, keyboard focus, and high-contrast support', () => {
  const surfaces = [
    ['History', read('src/webviews/historyHtml.ts')],
    ['Config', read('src/webviews/configHtml.ts')],
    ['Interactive Rebase', read('src/webviews/rebaseTodoHtml.ts')],
    ['Commit Message Editor', read('src/webviews/editTextHtml.ts')],
    ['Commit Picker', read('src/webviews/commitPickerHtml.ts')],
    ['Ref Picker', read('src/webviews/refPickerHtml.ts')],
    ['Create Tag', read('src/webviews/CreateTagDialog.ts')],
    [
      'Git Graph',
      read('src/webviews/graph/GraphPanel.ts') + read('resources/graph.css'),
    ],
    [
      'Commit',
      read('src/webviews/commit/CommitViewProvider.ts') + read('resources/commit.css'),
    ],
    [
      'Documentation',
      read('src/webviews/documentation/DocumentationProvider.ts') +
        read('resources/documentation.css'),
    ],
  ];

  for (const [name, source] of surfaces) {
    assert.ok(source.includes('aria-live='), `${name} has a live region`);
    assert.ok(source.includes(':focus-visible'), `${name} has visible keyboard focus`);
    assert.ok(
      source.includes('forced-colors: active'),
      `${name} supports forced-colour/high-contrast mode`,
    );
  }
});

test('custom clickable rows and disclosures expose keyboard semantics', () => {
  const commit = read('resources/commit.js');
  const graph = read('resources/graph.js');
  const history = read('src/webviews/historyHtml.ts');
  const refs = read('src/webviews/refPickerHtml.ts');
  const config = read('src/webviews/configHtml.ts');
  const rebase = read('src/webviews/rebaseTodoHtml.ts');

  assert.ok(commit.includes('makeKeyboardClickable('), 'Commit rows use a keyboard helper');
  assert.ok(graph.includes("tr.addEventListener('keydown'"), 'Graph commits handle keyboard actions');
  assert.ok(graph.includes("role=\"option\" tabindex=\"-1\""), 'Graph dropdown options are keyboard focusable');
  assert.ok(history.includes("item.setAttribute('role', 'option')"), 'History commits expose option semantics');
  assert.ok(refs.includes("leaf.setAttribute('role', 'treeitem')"), 'Ref picker leaves expose tree semantics');
  assert.ok(config.includes('<button type="button" class="del"'), 'Config removal controls are buttons');
  assert.ok(rebase.includes('<button type="button" class="move"'), 'Rebase reorder controls are buttons');
});
