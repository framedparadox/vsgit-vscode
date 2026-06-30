# Contributing to VsGit

VsGit is a VS Code extension that delegates Git behavior to the installed
`git` executable. Changes must preserve that boundary: commands are passed as
argument arrays, repository output is parsed from machine-readable formats, and
webviews send intent rather than running Git directly.

## Prerequisites

- Node.js 22
- npm
- VS Code 1.85 or newer
- Git 2.20 or newer
- `unzip` for final VSIX inspection

Git LFS is optional unless the change exercises LFS operations.

## Set up the repository

```bash
npm ci
npm run check-types
npm test
npm run build
```

For live extension development, run `npm run watch`, then launch the Extension
Development Host with `F5`.

## Repository structure

- `src/git/` — Git execution, repository state, guards, and parsers.
- `src/commands/` — command registration grouped by workflow.
- `src/views/` — native VS Code tree and Source Control providers.
- `src/webviews/` — webview hosts and inline HTML generators.
- `resources/` — webview clients, styles, fonts, pure helpers, and static tests.
- `src/test/` — tests that run inside a real VS Code Extension Host.

All Git child processes must go through `GitExecutor`. Do not construct shell
command strings. Validate refs and remote URLs received from webviews or other
untrusted surfaces with the existing argument guards.

## Required verification

Run the checks that match the change, then run the complete local gate:

```bash
npm run verify
```

The gate includes type-checking, unit/contract tests, native Node coverage
thresholds, and a production build. Current minimums are:

- 80% lines
- 80% branches
- 70% functions

Changes to activation, commands, contributions, or VS Code API integration must
also pass:

```bash
npm run test:integration
```

This launches a clean Extension Development Host and verifies activation,
command registration, repository refresh, and the documentation panel.

Before release-related changes:

```bash
npm run package:verify
```

That command creates `artifacts/vsgit-vscode.vsix` and checks its identity,
version, required runtime files, size, and absence of source/test artifacts.

## Testing expectations

- Parser changes need focused input/output unit tests.
- Repository methods need argv and option-injection coverage.
- Manifest, menu, documentation, and resource contracts belong in
  `resources/*.test.js`.
- VS Code lifecycle and command-registration behavior belongs in
  `src/test/*.integration.test.ts`.
- A bug fix should include a test that fails without the fix.

Do not lower coverage thresholds to land a change. Add meaningful coverage or
document why code cannot be exercised and request review.

## Accessibility requirements

Every UI change must remain usable with keyboard-only navigation and across VS
Code light, dark, and high-contrast themes.

- Use native buttons, inputs, tables, and labels where possible.
- Custom interactive elements require a role, accessible name, focusability,
  Enter/Space behavior, and visible focus.
- Announce asynchronous state changes through a polite or assertive live region.
- Tree items must provide complete `accessibilityInformation` labels when visual
  icons, abbreviations, or secondary descriptions carry meaning.
- Preserve `prefers-reduced-motion` and forced-colour behavior.

## Pull requests

Keep changes focused and preserve unrelated worktree edits. A pull request
should explain:

1. The user-visible problem and chosen behavior.
2. Security or destructive-operation implications.
3. Tests added or updated.
4. Commands used for verification.
5. Screenshots or a short recording for material UI changes.

Update `README.md`, `CHANGELOG.md`, and
`docs/IMPLEMENTATION_PLAN.md` whenever implementation status or public behavior
changes.
