# VsGit Marketplace Release Checklist

Use this checklist for every release or pre-release. A tag starts the publish
workflow only when the tagged commit is contained in `main` and the tag's
numeric version matches `package.json`.

## Product and listing

- [ ] Confirm `name`, `displayName`, `publisher`, `version`, repository, bugs,
      homepage, license, categories, keywords, banner, and icon in `package.json`.
- [ ] Confirm README screenshots, commands, settings, requirements, privacy, and
      roadmap statements match the packaged implementation.
- [ ] Move relevant entries from `[Unreleased]` into a dated changelog section.
- [ ] Verify every public command has an understandable title and category.
- [ ] Review the extension in VS Code dark, light, and high-contrast themes.
- [ ] Run a keyboard-only and screen-reader smoke test of changed surfaces.

## Engineering gate

```bash
npm ci
npm run check-types
npm test
npm run test:coverage
npm run test:integration
npm audit --audit-level=high
npm run package:verify
```

- [ ] All commands above pass on the release commit.
- [ ] Inspect `artifacts/vsgit-vscode.vsix` from a clean checkout.
- [ ] Install that exact VSIX into a clean VS Code profile.
- [ ] Smoke-test repository discovery, staging, commit, fetch/pull/push, Graph,
      History, Compare, conflict handling, and Documentation.
- [ ] Confirm no credentials, repository data, source maps, tests, source files,
      archives, or development-only scripts are packaged.

## Version and tag

- [ ] Update both `package.json` and `package-lock.json`.
- [ ] Commit the version and release notes on `main`.
- [ ] Use `vX.Y.Z` for a stable release or `vX.Y.Z-beta.N` for a pre-release.
- [ ] Push `main`, then push the annotated tag.
- [ ] Confirm the publish workflow validates that the tag is contained in
      `main`.

## Marketplace and GitHub

- [ ] Confirm the `VSCE_PAT` repository secret belongs to the configured
      publisher and has Marketplace Manage scope.
- [ ] Confirm GitHub Actions has `contents: write` only for the release job.
- [ ] Verify the workflow publishes the inspected VSIX, not a separately rebuilt
      artifact.
- [ ] Confirm the GitHub release contains the same VSIX and generated notes.
- [ ] Open the Marketplace listing and verify the version, pre-release status,
      README rendering, icon, and install action.

## Rollback

- [ ] Keep the previous known-good VSIX and tag available.
- [ ] If validation fails after publication, unpublish only after assessing
      installed-user impact; prefer a corrected patch release.
- [ ] Record the failure and add a regression check before republishing.
