'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const pkg = JSON.parse(read('package.json'));

test('Phase 10 verification scripts enforce coverage, integration, audit, and packaging', () => {
  assert.ok(pkg.scripts['test:coverage'].includes('--test-coverage-lines=80'));
  assert.ok(pkg.scripts['test:coverage'].includes('--test-coverage-branches=80'));
  assert.ok(pkg.scripts['test:coverage'].includes('--test-coverage-functions=70'));
  assert.ok(pkg.scripts['test:integration'].includes('vscode-test'));
  assert.ok(pkg.scripts['package:verify'].includes('verify-vsix.mjs'));

  const integrationConfig = read('.vscode-test.mjs');
  const integrationTest = read('src/test/extension.integration.test.ts');
  assert.ok(integrationConfig.includes('out-integration/**/*.test.js'));
  assert.ok(integrationTest.includes('await extension.activate()'));
  assert.ok(integrationTest.includes('vsgit.repositories.refresh'));
  assert.ok(integrationTest.includes('vsgit.documentation.open'));
});

test('CI and publish workflows run the complete quality gate', () => {
  const ci = read('.github/workflows/ci.yml');
  const publish = read('.github/workflows/publish.yml');
  for (const required of [
    'npm run test:coverage',
    'npm run test:integration',
    'npm audit --audit-level=high',
    'npm run package:verify',
  ]) {
    assert.ok(ci.includes(required), `CI includes ${required}`);
  }
  for (const required of [
    'npm run test:coverage',
    'npm run test:integration',
    'npm audit --audit-level=high',
    'verify-vsix.mjs',
  ]) {
    assert.ok(publish.includes(required), `publish includes ${required}`);
  }
});

test('repository discovery is concurrent, coalesced, and measured', () => {
  const manager = read('src/git/RepositoryManager.ts');
  assert.ok(manager.includes('private scanInFlight: Promise<void> | undefined'));
  assert.ok(manager.includes('folders.map((folder) => this.discoverRoot'));
  assert.ok(manager.includes('await Promise.all(newRoots.map((root) => this.watch(root)))'));
  assert.ok(manager.includes('getPerformanceSnapshot()'));
  assert.ok(manager.includes('performance.now() - startedAt'));
  const repository = read('src/git/Repository.ts');
  assert.ok(repository.includes('async ensureSubmodules()'));
  assert.ok(repository.includes('if (this.submodulesLoaded)'));
});

test('contributor and release documentation covers Phase 10 gates', () => {
  const contributing = read('CONTRIBUTING.md');
  const marketplace = read('docs/MARKETPLACE_CHECKLIST.md');
  for (const command of [
    'npm run verify',
    'npm run test:integration',
    'npm run package:verify',
  ]) {
    assert.ok(contributing.includes(command), `CONTRIBUTING includes ${command}`);
  }
  assert.ok(contributing.includes('Accessibility requirements'));
  assert.ok(marketplace.includes('npm run test:coverage'));
  assert.ok(marketplace.includes('VSCE_PAT'));
  assert.ok(marketplace.includes('Rollback'));
});

test('package and lockfile versions remain aligned', () => {
  const lock = JSON.parse(read('package-lock.json'));
  assert.strictEqual(lock.version, pkg.version);
  assert.strictEqual(lock.packages[''].version, pkg.version);
  assert.strictEqual(pkg.capabilities.untrustedWorkspaces.supported, false);
  assert.strictEqual(pkg.capabilities.virtualWorkspaces.supported, false);
});
