'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const {
  STATUS_LABELS,
  statusLabel,
  statusCode,
  fileExt,
  fileTypeBadge,
  escapeHtml,
  buildFileTree,
} = require('./commitView.js');

// ─── statusLabel ─────────────────────────────────────────────────────────────
test('statusLabel maps known status codes to full labels', () => {
  assert.strictEqual(statusLabel('A'), 'Added');
  assert.strictEqual(statusLabel('M'), 'Modified');
  assert.strictEqual(statusLabel('D'), 'Deleted');
  assert.strictEqual(statusLabel('R'), 'Renamed');
  assert.strictEqual(statusLabel('C'), 'Conflicted');
  assert.strictEqual(statusLabel('U'), 'Conflicted');
  assert.strictEqual(statusLabel('?'), 'Untracked');
});

test('statusLabel falls back to Modified for unknown codes', () => {
  assert.strictEqual(statusLabel('X'), 'Modified');
  assert.strictEqual(statusLabel(''), 'Modified');
  assert.strictEqual(statusLabel(undefined), 'Modified');
});

// ─── statusCode ──────────────────────────────────────────────────────────────
test('statusCode derives the upper-cased first letter of the state', () => {
  assert.strictEqual(statusCode({ state: 'modified' }), 'M');
  assert.strictEqual(statusCode({ state: 'added' }), 'A');
  assert.strictEqual(statusCode({ state: 'A' }), 'A');
});

test('statusCode prefers conflict over the raw state', () => {
  assert.strictEqual(statusCode({ state: 'modified', conflicted: true }), 'C');
  assert.strictEqual(statusCode({ conflicted: true }), 'C');
});

test('statusCode defaults to Modified for missing/empty input', () => {
  assert.strictEqual(statusCode(undefined), 'M');
  assert.strictEqual(statusCode({}), 'M');
  assert.strictEqual(statusCode({ state: '' }), 'M');
});

// ─── fileExt ─────────────────────────────────────────────────────────────────
test('fileExt returns the lower-cased extension without the dot', () => {
  assert.strictEqual(fileExt('Component.TSX'), 'tsx');
  assert.strictEqual(fileExt('archive.tar.gz'), 'gz');
  assert.strictEqual(fileExt('README.md'), 'md');
});

test('fileExt returns a bullet when there is no usable extension', () => {
  assert.strictEqual(fileExt('Makefile'), '•');
  assert.strictEqual(fileExt('.gitignore'), '•'); // leading dot is not an ext
  assert.strictEqual(fileExt('trailingdot.'), '•');
  assert.strictEqual(fileExt(''), '•');
  assert.strictEqual(fileExt(undefined), '•');
});

// ─── fileTypeBadge ───────────────────────────────────────────────────────────
test('fileTypeBadge maps known languages to a short ≤2-char badge', () => {
  assert.strictEqual(fileTypeBadge('app.js'), 'JS');
  assert.strictEqual(fileTypeBadge('Component.tsx'), 'TS');
  assert.strictEqual(fileTypeBadge('package.json'), '{}');
  assert.strictEqual(fileTypeBadge('main.py'), 'PY');
  assert.strictEqual(fileTypeBadge('styles.scss'), '#');
});

test('fileTypeBadge handles extensionless/dotfile config names', () => {
  assert.strictEqual(fileTypeBadge('.gitignore'), 'GI');
  assert.strictEqual(fileTypeBadge('Dockerfile'), 'DK');
  assert.strictEqual(fileTypeBadge('yarn.lock'), 'LK');
});

test('fileTypeBadge falls back to the first two letters, then a bullet', () => {
  // Unknown extension → upper-cased first two letters.
  assert.strictEqual(fileTypeBadge('data.xyz'), 'XY');
  // No usable extension and no whole-name rule → bullet.
  assert.strictEqual(fileTypeBadge('Makefile'), 'MK'); // whole-name rule
  assert.strictEqual(fileTypeBadge('NOTES'), '•');
  assert.strictEqual(fileTypeBadge(''), '•');
});

test('fileTypeBadge never returns more than two characters', () => {
  for (const name of ['a.markdown', 'b.dockerfile', 'c.graphql', 'd.unknownext']) {
    assert.ok(fileTypeBadge(name).length <= 2, name + ' badge ≤ 2 chars');
  }
});

// ─── escapeHtml ──────────────────────────────────────────────────────────────
test('escapeHtml neutralises HTML-significant characters', () => {
  assert.strictEqual(
    escapeHtml('<img src="x" onerror="alert(1)">'),
    '&lt;img src=&quot;x&quot; onerror=&quot;alert(1)&quot;&gt;',
  );
  assert.strictEqual(escapeHtml('a & b'), 'a &amp; b');
});

test('escapeHtml renders null/undefined as an empty string', () => {
  assert.strictEqual(escapeHtml(null), '');
  assert.strictEqual(escapeHtml(undefined), '');
});

// ─── buildFileTree ───────────────────────────────────────────────────────────
test('buildFileTree returns an empty root for no files', () => {
  const root = buildFileTree([]);
  assert.strictEqual(root.dirs.size, 0);
  assert.deepStrictEqual(root.files, []);
  assert.deepStrictEqual(buildFileTree(undefined).files, []);
});

test('buildFileTree keeps top-level files at the root', () => {
  const a = { path: 'a.txt' };
  const root = buildFileTree([a]);
  assert.strictEqual(root.dirs.size, 0);
  assert.strictEqual(root.files.length, 1);
  assert.strictEqual(root.files[0].file, a);
  assert.strictEqual(root.files[0].name, 'a.txt');
});

test('buildFileTree nests files under their directory segments', () => {
  const f = { path: 'src/git/Repository.ts' };
  const root = buildFileTree([f]);
  const src = root.dirs.get('src');
  assert.ok(src, 'src directory exists');
  const git = src.dirs.get('git');
  assert.ok(git, 'src/git directory exists');
  assert.strictEqual(git.files.length, 1);
  assert.strictEqual(git.files[0].name, 'Repository.ts');
  assert.strictEqual(git.files[0].file, f);
});

test('buildFileTree groups siblings and merges shared directories', () => {
  const root = buildFileTree([
    { path: 'src/a.ts' },
    { path: 'src/b.ts' },
    { path: 'src/sub/c.ts' },
    { path: 'top.txt' },
  ]);
  // One shared "src" dir plus a root-level file.
  assert.deepStrictEqual([...root.dirs.keys()], ['src']);
  assert.strictEqual(root.files.length, 1);
  const src = root.dirs.get('src');
  assert.deepStrictEqual(
    src.files.map((e) => e.name).sort(),
    ['a.ts', 'b.ts'],
  );
  assert.deepStrictEqual([...src.dirs.keys()], ['sub']);
  assert.strictEqual(src.dirs.get('sub').files[0].name, 'c.ts');
});

test('buildFileTree tolerates odd paths by falling back to name', () => {
  const root = buildFileTree([{ path: '', name: 'orphan' }]);
  assert.strictEqual(root.files[0].name, 'orphan');
});

// STATUS_LABELS is exported so the webview and tests share one source of truth.
test('STATUS_LABELS is the table backing statusLabel', () => {
  for (const code of Object.keys(STATUS_LABELS)) {
    assert.strictEqual(statusLabel(code), STATUS_LABELS[code]);
  }
});
