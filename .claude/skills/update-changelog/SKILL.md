---
name: update-changelog
description: Update CHANGELOG.md for the Command Clipboard extension following Keep a Changelog conventions and Semantic Versioning. Use when the user asks to update / generate / write the changelog, or after shipping a feature/fix and before publishing a new version.
---

# Update Changelog Skill

You are updating `CHANGELOG.md` at the project root. Follow the **Keep a Changelog 1.1.0** format and **Semantic Versioning 2.0.0** strictly.

## Step 1 — Gather Inputs

Read these in parallel before writing anything:

1. `CHANGELOG.md` — current state, last released version, any existing `## [Unreleased]` section.
2. `package.json` — current `version` field (the value here is the **last published** version unless the user is mid-bump).
3. `git log` since the last tagged release (or since the last entry in the changelog):
   ```bash
   git log --no-merges --pretty=format:'%h%x09%s%x09%b%x1e' <last-tag>..HEAD
   ```
   If no tags exist, use the last commit referenced in the changelog or fall back to `git log` since the date of the last changelog entry.
4. Staged + unstaged diff (`git status`, `git diff`) — un-committed work the user may want to include.

Ask the user **only when ambiguous**:
- Which version are we cutting? (See "Picking the version" below — propose one, don't just ask.)
- Are there in-flight changes to include or exclude?

## Step 2 — Pick the Version (SemVer)

Given the current version `MAJOR.MINOR.PATCH`:

- **PATCH** bump (`0.5.0 → 0.5.1`): only bug fixes, internal refactors, doc tweaks, dependency bumps with no API change.
- **MINOR** bump (`0.5.0 → 0.6.0`): new user-visible features, new commands, new settings — all backwards-compatible.
- **MAJOR** bump (`0.5.0 → 1.0.0`): breaking changes — removed commands, renamed settings, changed default behavior in a way users must adapt to. **Pre-1.0 caveat:** while the extension is `0.x.y`, breaking changes typically bump MINOR (not MAJOR) by SemVer convention. Confirm with the user before going to `1.0.0` — that signals "this is the stable API."

Propose the version to the user with one-line reasoning ("Bumping to 0.6.0 because we added multi-select run, which is a new feature"). Wait for confirmation before writing.

## Step 3 — Categorize Changes

Use exactly these section headings, in this order, and **omit any that have no entries** for the release:

- `### Added` — new features.
- `### Changed` — changes to existing functionality (non-breaking).
- `### Deprecated` — features marked for removal in a future version.
- `### Removed` — features removed in this release.
- `### Fixed` — bug fixes.
- `### Security` — vulnerability fixes (call out CVEs if any).

Do **not** invent other section names ("Improved", "Misc", "Other"). If something doesn't fit, it's almost always `Changed` or `Fixed`.

## Step 4 — Write the Entries

Rules for each bullet:

1. **User-facing voice.** Write what the user gets, not what you changed in the code.
   - Bad: `Refactored treeProvider.ts to use createTreeView`
   - Good: `Multi-select commands in the tree and run them chained with &&`
2. **Start with a verb in the past tense or imperative — be consistent** (Keep a Changelog uses imperative: "Add", "Fix", "Change"). Match what already exists in this CHANGELOG. Current style in this repo is the **bulleted feature-noun** form (e.g. "Save frequently used terminal commands…") — keep it consistent.
3. **One bullet per discrete change.** Don't batch unrelated fixes into one line.
4. **Link to issues / PRs** if the project tracks them: `Fix terminal appending instead of replacing typed text (#42)`.
5. **No internal jargon.** Avoid file paths, function names, and ticket IDs that mean nothing to a user reading the marketplace listing.
6. **Mark breaking changes explicitly** with `**BREAKING:**` prefix inside `### Changed` or `### Removed`.
7. **Keep order stable:** within a section, list the most user-visible items first.

## Step 5 — Format the Release Header

```
## [X.Y.Z] - YYYY-MM-DD
```

- Use ISO 8601 date (UTC is fine; today's date when shipping).
- Square brackets around the version are part of the spec — they enable linking to a compare view at the bottom of the file.
- Keep an **`## [Unreleased]`** section at the top for in-flight work. When cutting a release, rename the existing `[Unreleased]` to `[X.Y.Z] - <date>` and create a fresh empty `[Unreleased]` above it.

## Step 6 — Compare Links (footer)

At the bottom of `CHANGELOG.md`, maintain a block of compare links:

```
[Unreleased]: https://github.com/dev-pravinbirla/cmd-clipboard-vscode/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/dev-pravinbirla/cmd-clipboard-vscode/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/dev-pravinbirla/cmd-clipboard-vscode/releases/tag/v0.5.0
```

Update these every release. The oldest release uses `/releases/tag/...`, all others use `/compare/...`.

## Step 7 — Sync `package.json`

After writing the CHANGELOG entry, update `package.json` `version` to match. **Do not do this silently** — show the user the diff and confirm before saving. These two files must always agree, because `vsce publish` uses `package.json`.

## Step 8 — Verify Before Commit

Run a final check:

- [ ] New version appears in `CHANGELOG.md` header **and** `package.json`.
- [ ] Date is today (ISO format).
- [ ] No empty subsections (omit them, don't leave blank).
- [ ] No duplicate entries from `Unreleased` (entries moved, not copied).
- [ ] Compare-link block at the bottom updated.
- [ ] `## [Unreleased]` empty section preserved at the top for next cycle.

Do **not** commit, tag, or push automatically. Print the diff and ask the user how they want to proceed.

## Template Skeleton

When the file is empty or malformed, regenerate from this skeleton:

```markdown
# Changelog

All notable changes to the **Command Clipboard** extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

### Changed

### Fixed

## [X.Y.Z] - YYYY-MM-DD

### Added
- ...

[Unreleased]: https://github.com/dev-pravinbirla/cmd-clipboard-vscode/compare/vX.Y.Z...HEAD
[X.Y.Z]: https://github.com/dev-pravinbirla/cmd-clipboard-vscode/releases/tag/vX.Y.Z
```

## What NOT to do

- Don't reorder or rewrite past release entries — they are historical record.
- Don't delete the `## [Unreleased]` section after a release; reset it to empty subsections instead.
- Don't include merge commits in the bullet list.
- Don't auto-bump `package.json` without showing the user.
- Don't run `git tag`, `git push`, or `vsce publish` — those are user actions.
