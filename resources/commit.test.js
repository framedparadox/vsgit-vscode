'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

test('Commit advanced options are collapsed behind a disclosure by default', () => {
  const html = read('src/webviews/commit/CommitViewProvider.ts');

  // The disclosure toggle exists and is accessible.
  const toggle = html.match(/<button id="advanced-toggle"[\s\S]*?>/);
  assert.ok(toggle, 'advanced-toggle button exists');
  assert.ok(toggle[0].includes('aria-expanded="false"'), 'toggle starts collapsed');
  assert.ok(toggle[0].includes('aria-controls="commit-bar"'), 'toggle controls the options bar');

  // The options bar carries every advanced control and is hidden up front.
  const bar = html.match(/<div id="commit-bar"[^>]*>/);
  assert.ok(bar, 'commit-bar exists');
  assert.ok(bar[0].includes('hidden'), 'commit-bar is hidden by default');
  for (const id of ['opt-amend', 'opt-signoff', 'opt-gpg']) {
    assert.ok(html.includes(`id="${id}"`), `${id} checkbox lives inside the advanced bar`);
  }
});

test('Commit view loads the shared helpers module before the client script', () => {
  const html = read('src/webviews/commit/CommitViewProvider.ts');
  const helpersIdx = html.indexOf('"commitView.js"');
  const clientIdx = html.indexOf('"commit.js"');
  assert.ok(helpersIdx !== -1, 'commitView.js URI is created');
  assert.ok(clientIdx !== -1, 'commit.js URI is created');

  const helpersScript = html.indexOf('src="${helpersUri}"');
  const clientScript = html.indexOf('src="${jsUri}"');
  assert.ok(helpersScript !== -1 && clientScript !== -1, 'both scripts are injected');
  assert.ok(
    helpersScript < clientScript,
    'helpers load first so self.CommitView is defined before commit.js runs',
  );
});

test('commit.js toggles and persists the advanced disclosure state', () => {
  const js = read('resources/commit.js');

  assert.ok(js.includes('self.CommitView'), 'client consumes the shared helpers global');
  assert.ok(js.includes('commitAdvancedOpen'), 'advanced state has a persisted key');
  assert.ok(js.includes('function syncAdvanced'), 'advanced state is reflected into the DOM');
  assert.ok(js.includes('function setAdvancedOpen'), 'advanced state can be toggled');
  assert.ok(
    js.includes("el('advanced-toggle').addEventListener"),
    'the toggle button is wired up',
  );
  assert.ok(
    js.includes('bar.hidden = !advancedOpen'),
    'the options bar visibility follows the advanced state',
  );

  // The duplicated helpers must be gone now that they live in commitView.js.
  assert.ok(!/function fileExt\(/.test(js), 'fileExt is no longer redefined in commit.js');
  assert.ok(!/function escapeHtml\(/.test(js), 'escapeHtml is no longer redefined in commit.js');
  assert.ok(!/const STATUS_LABELS =/.test(js), 'STATUS_LABELS is no longer redefined in commit.js');
});

test('commit.css hides the bar by default and styles the disclosure', () => {
  const css = read('resources/commit.css');
  assert.ok(css.includes('#commit-bar[hidden]'), 'hidden commit-bar collapses');
  assert.ok(css.includes('.advanced-toggle'), 'disclosure toggle is styled');
  assert.ok(css.includes('.advanced-toggle.open .chev'), 'open state rotates the chevron');
});
