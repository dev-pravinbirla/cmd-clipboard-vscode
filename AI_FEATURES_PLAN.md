# Command Clipboard — Improvements & AI Features Roadmap

## Priority 0 — Blockers / Bugs (Do Immediately)

### B1. Restore Extension Logo
- `package.json` references `resources/icon.png` and `resources/icon.svg`, but the `resources/` folder is empty (only a stray `.DS_Store`). The marketplace icon and the activity-bar icon are both broken.
- **Action:**
  - Design a clear, recognizable logo (clipboard + terminal/`>_` motif works well).
  - Export at **128×128 PNG** for `icon` (marketplace) and a **monochrome SVG** for the activity-bar (`viewsContainers.activitybar[].icon`). The activity-bar icon **must be a single-color SVG using `currentColor`** — otherwise VS Code hides/mutes it, which is the "hidden in side panel" symptom.
  - Verify by reloading the extension and checking both: (a) Extensions sidebar tile and (b) the Activity Bar icon visibility in light + dark themes.
- **Impact:** High | **Effort:** Low

### B2. Fix: Run-in-Terminal Appends Instead of Replaces
- Location: `src/extension.ts:349` and `src/extension.ts:391` — both call `terminal.sendText(cmd.snippet)`.
- Problem: `sendText` types into the terminal *as if the user typed it*. If the prompt already has half-typed text, the new command is concatenated.
- **Fix (recommended):** Prepend a line-clear control sequence before sending.
  ```ts
  // Clear any pending input on the current prompt (works in bash, zsh, fish, PowerShell readline).
  terminal.sendText('', false); // Ctrl+U
  terminal.sendText(cmd.snippet);
  ```
  - `` (Ctrl+U) clears the current line in most shells without executing anything.
  - The `false` arg on the first call prevents an extra newline.
  - For Windows `cmd.exe` (no readline), fall back to sending `` (ESC) or simply accept that cmd.exe will execute whatever was buffered — document the limitation.
- **Optional polish:** Add a setting `cmdClipboard.terminal.clearBeforeRun` (default `true`) so power users can opt out.
- **Impact:** High | **Effort:** Low

---

## Priority 1 — UX Improvements

### U1. Friendlier Edit Experience (name / command / description)
- **Current pain:** Editing fires three sequential `showInputBox` prompts (`extension.ts:215–230`). Cancelling any one aborts the whole edit, and you can't see all fields at once.
- **Proposal:** Replace with a single **webview-based edit form** showing all three fields together (`label`, `snippet`, `description`), plus Save / Cancel buttons. Pre-fill from the existing command.
- **Quick-win alternative (lower effort):** Add a context-menu action **"Rename"** that only edits the label (one prompt), and keep the full edit form for everything else. Most edits are renames.
- **Also add:**
  - Inline rename via F2 (VS Code tree convention) → bound to `cmdClipboard.editCommand` when only the label is changing.
  - Keep description visible in the tree item tooltip and as the `TreeItem.description` field so users don't have to open a form to read it.
- **Impact:** High | **Effort:** Medium (webview) / Low (rename-only shortcut)

### U2. Multi-Select → Run Chained Commands (`&&`)
- **Goal:** User selects multiple commands in the tree and runs them in selection order, joined with `&&` (stop on first failure).
- **Why `&&`:** Safer default than `;` — if `npm install` fails, you don't want `npm run build` to proceed.
- **Implementation notes (handle carefully):**
  1. VS Code's `TreeView` supports multi-select via `canSelectMany: true` on the `createTreeView` options. Currently the extension likely uses `registerTreeDataProvider` — switch to `createTreeView` to get access to `treeView.selection`.
  2. Add a new command `cmdClipboard.runSelectedInTerminal` (palette + context menu, shown when `viewItem == command` and `selection.length > 1`).
  3. **Preserve user's selection order**, not tree order. VS Code's `treeView.selection` returns items in the order they were selected — confirm with a quick test; if not, track selection order manually via `onDidChangeSelection`.
  4. **Show a confirmation modal** before running, displaying the joined command exactly as it will be sent. Example:
     ```
     Run 3 commands in order?
     > npm install && npm run build && npm test
     [Run] [Cancel]
     ```
     This prevents accidental destructive chains.
  5. **Escape / safety:**
     - Skip non-command items (folders) if selected.
     - Refuse to chain if any snippet itself contains `&&`, `||`, `;`, or a newline *unless* the user opts in via a setting (`cmdClipboard.allowComplexChaining`). Otherwise a malformed snippet breaks the chain.
     - Reuse the Ctrl+U line-clear fix from B2.
  6. **Operator choice:** Default `&&`. Optionally let user pick at confirmation time: `&&` (stop on fail), `;` (always continue), `||` (run next only on fail). Don't expose `|` (pipe) — different semantics.
- **Impact:** High | **Effort:** Medium-High

### U3. Easier Discovery of Edit / Rename / Delete
- Today edit is an inline icon only. Add:
  - Right-click context menu items for **Rename**, **Edit**, **Duplicate**, **Delete** (some already exist — audit which are missing).
  - Tooltip on hover showing full command + description (use `TreeItem.tooltip` with a `MarkdownString`).
  - Click-to-copy on the command itself (single click = copy), with explicit Run / Edit icons on the side — reduces "which icon does what" confusion.
- **Impact:** Medium | **Effort:** Low

---

## Priority 2 — AI Features

### A1. AI-Powered Project Scan → Suggest Important Commands

#### Trigger
- First time the extension opens a workspace with no project-scope commands yet, OR via palette command `Command Clipboard: Scan Project for Commands`.
- Palette command accepts an optional directory; otherwise shows a folder picker so the user can scan any folder (not just workspace root).

#### Flow (strictly sequential — each step waits for explicit user action)

**Step 1 — Consent / Access Prompt (blocking)**
- Before reading any files or calling the AI, show a modal explaining exactly what will happen:
  ```
  Command Clipboard wants to scan this project:
    • Read file names in: <selected folder> (depth 2)
    • Read these config files if present: package.json, Makefile,
      Dockerfile, docker-compose.yml, .github/workflows/*, justfile,
      Taskfile.yml, pyproject.toml, Cargo.toml
    • Send the parsed command names to AI (no file contents)

  [Allow Once]  [Allow Always]  [Cancel]
  ```
- Implementation:
  - Use `vscode.window.showInformationMessage(msg, { modal: true }, ...buttons)` so the dialog blocks until the user clicks.
  - If the user clicks **Cancel** or closes the modal: abort the entire flow, do nothing.
  - If **Allow Always**: persist consent in workspace state (`cmdClipboard.scanConsent = 'always'`) so future scans of this workspace skip the prompt. Show a toast: "You can revoke this in settings."
  - If **Allow Once**: proceed for this run only; ask again next time.
  - Add setting `cmdClipboard.ai.scanConsent` with values `always` / `ask` / `never` so users can change their mind. Honor `never` by short-circuiting the palette command with a helpful message.
- If the AI call requires sending data to a remote service, surface that clearly in the modal — separate "scan files" consent from "send to AI" consent if the privacy bar is higher.

**Step 2 — Run the Scan**
- Show a progress notification (`vscode.window.withProgress`) so the user knows something is happening:
  - "Scanning project files…"
  - "Asking AI to rank commands…"
- **Two-stage detection:**
  1. **Deterministic parse first (no AI):** `package.json` `scripts`, `Makefile` targets, `Dockerfile` / `docker-compose.yml` services, `.github/workflows/*.yml` jobs, `pyproject.toml` `[tool.poetry.scripts]`, `Cargo.toml` `[[bin]]`, `justfile`, `Taskfile.yml`. Covers ~80% of real projects with zero AI cost.
  2. **AI layer on top:** send the parsed command list + a shallow file tree (names only, depth 2) and ask:
     - Rank the top 5–10 most likely "daily-use" commands.
     - Suggest stack-inferred extras (e.g., `prisma/schema.prisma` detected → suggest `npx prisma migrate dev`).
     - For each suggestion: return a short human-friendly **name** and a one-line **description**.

**Step 3 — Review & Select Modal (blocking on user choice)**
- After scanning, **do not auto-import anything**. Open a dedicated review UI (webview is best; quick-pick with checkboxes is the lower-effort fallback):
  ```
  Found 12 commands. Select which to add:

  [✓] Install dependencies
      cmd:  npm install
      desc: Install all npm packages from package.json
      source: package.json (scripts.install)

  [✓] Run dev server
      cmd:  npm run dev
      desc: Start the local development server on port 3000
      source: package.json (scripts.dev)

  [ ] Clean build artifacts
      cmd:  rm -rf dist node_modules
      desc: ⚠ Destructive — removes build output and dependencies
      source: AI suggestion

  ...

  [Select All]  [Deselect All]    [Add Selected]  [Cancel]
  ```
- **Each row shows:** checkbox, **name**, **command (cmd)**, **description**, and a small source indicator (which config file or "AI suggestion").
- Pre-check sensible defaults (AI-ranked top commands); leave destructive ones (`rm -rf`, `git push --force`, etc.) **unchecked by default** and visually flagged.
- Allow inline edit of name and description before adding — users often want to tweak AI-generated text.
- **Nothing is saved until the user clicks Add Selected.** Cancel / close = no changes written.
- After import, show a confirmation toast: "Added 7 commands to Project scope." and refresh the tree.

#### Implementation choice: webview vs. quick-pick
- **Webview (recommended):** lets you show name + cmd + description per row clearly, with inline editing. More effort but much better UX.
- **Quick-pick with `canPickMany: true` (fallback):** faster to build; use `label` for the name, `description` for the command, `detail` for the description text. Loses inline editing.

#### Privacy
- **Default:** send only parsed command names + shallow file tree (names only) to AI. Never send file *contents*.
- Setting `cmdClipboard.ai.allowFileContent` (default `false`) opts in to deeper analysis (e.g., reading a Dockerfile's `RUN` lines) for users who want it.
- All consent and privacy choices surfaced in the Step 1 modal — no hidden network calls.

- **Impact:** High | **Effort:** Medium-High (webview review UI is the bulk of the work)

### A2. Natural Language → Command
- User types plain English: "find all files over 100MB" → AI returns `find . -type f -size +100M`.
- Add a palette command `Command Clipboard: Generate Command from Description`.
- Preview the generated command, let user edit before saving.
- **Impact:** High | **Effort:** Medium

### A3. Explain Command
- Right-click any saved command → "Explain this command".
- AI breaks down each flag/argument; show in a webview or hover.
- **Impact:** Medium | **Effort:** Low

### A4. Smart Suggestions (Later)
- Analyze saved commands → suggest related ones (`git stash` → `git stash pop`, `git stash list`).
- **Impact:** Medium | **Effort:** Medium

### A5. Fix / Improve Command (Later)
- Paste broken command → AI fixes syntax / suggests safer alternative.
- Example: `rm -rf ./dist` → suggest `trash ./dist` or add confirmation flag.
- **Impact:** Low | **Effort:** Medium

---

## Priority 3 — Final / Pre-Publish Polish

### F1. Add Screenshots & Images to the Extension (Last Task)
- Must be the **final step before publishing** so the visuals show the finished product, not work-in-progress.
- **What to capture:**
  1. **Hero shot** — Activity Bar icon visible + the four tree views (Pinned / Global / Workspace / Project) populated with example commands.
  2. **Copy-to-clipboard in action** — short GIF: click command → "Copied" toast appears.
  3. **Run in Terminal** — GIF showing the terminal-replace fix (B2): a half-typed line gets cleared, then the saved command runs cleanly.
  4. **Multi-select chained run (U2)** — GIF: select 3 commands → confirmation modal showing `cmd1 && cmd2 && cmd3` → executes in order.
  5. **Edit form (U1)** — screenshot of the new webview edit form with name / command / description visible.
  6. **AI Project Scan (A1)** — two screenshots: the consent modal, then the review/select dialog with checkboxes, names, commands, and descriptions.
  7. **Search / palette command** — quick screenshot of the search quick-pick.
- **Where they go:**
  - `README.md` — embed near the top for the marketplace listing (marketplace renders the README).
  - `resources/screenshots/` — keep the raw PNG/GIF files versioned here.
  - Use **relative paths** in README so they render both on GitHub and on the VS Code Marketplace: `![Run in terminal](resources/screenshots/run-in-terminal.gif)`.
- **Specs:**
  - Screenshots: PNG, 1280×800 minimum, light **and** dark theme variants if practical.
  - GIFs: ≤ 5 MB each, ~10s loop, use a recorder like Kap or LICEcap; trim aggressively.
  - Add short captions under each image.
- **Don't forget:**
  - Update `.vscodeignore` so screenshots ship in the `.vsix` only if README references them via local paths (otherwise exclude `resources/screenshots/` to keep package size down — marketplace will still fetch them from the repo for the listing page if the README uses GitHub raw URLs).
  - Update CHANGELOG entry: "Added screenshots and GIFs to README."

---

## Priority 4 — Tooling (Lowest Priority)

### T1. `update-changelog` Skill
- **Goal:** A reusable Claude Code skill that updates `CHANGELOG.md` correctly every time, so we stop hand-writing release notes and never drift from convention.
- **Standards it must enforce:**
  - **Keep a Changelog 1.1.0** format — sections `Added` / `Changed` / `Deprecated` / `Removed` / `Fixed` / `Security`, in that order, omitting empty ones.
  - **Semantic Versioning 2.0.0** — PATCH for fixes, MINOR for backwards-compatible features, MAJOR for breaking changes (with the pre-1.0 caveat noted).
  - ISO-8601 dates, `## [X.Y.Z] - YYYY-MM-DD` release header format.
  - Persistent `## [Unreleased]` section at the top, reset to empty subsections after each cut.
  - Compare-link footer kept in sync (`[X.Y.Z]: https://github.com/.../compare/vA...vB`).
  - `package.json` `version` must stay in lockstep — skill updates both and shows diff before saving.
- **Workflow the skill follows:**
  1. Read `CHANGELOG.md`, `package.json`, and `git log` since last tag.
  2. Propose the next version with one-line reasoning; wait for user confirmation.
  3. Categorize commits into Keep-a-Changelog sections, rewriting messages into user-facing voice (no internal jargon, file paths, or function names).
  4. Move existing `[Unreleased]` entries into the new release, then reset `[Unreleased]` to empty.
  5. Update compare links; bump `package.json`.
  6. Show diff. **Do not commit, tag, or publish** — user actions only.
- **Location:** `.claude/skills/update-changelog/SKILL.md` (project-scoped, ships with the repo so teammates get it too).
- **Invocation:** `/update-changelog` from inside this repo, ideally right before bumping the version for publish.
- **Impact:** Medium (workflow quality) | **Effort:** Low

---

---

## Execution Plan — Action Points by Priority

### P0 — Ship This Week (Blockers)
- **B1. Restore logo**
  1. Design a 128×128 logo (clipboard + `>_` terminal motif).
  2. Export `resources/icon.png` (marketplace) and `resources/icon.svg` (activity bar, **monochrome using `currentColor`**).
  3. Reload extension, verify icon visible in light + dark themes + marketplace tile.
- **B2. Fix terminal append bug** (`src/extension.ts:349` and `:391`)
  1. Prepend `terminal.sendText('', false);` before each `terminal.sendText(cmd.snippet);`.
  2. Add setting `cmdClipboard.terminal.clearBeforeRun` (default `true`).
  3. Test on zsh, bash, PowerShell.

### P1 — Next (UX)
- **U1. Edit form rewrite**
  1. Quick-win: `cmdClipboard.renameCommand` (label-only, F2 binding).
  2. Then: webview edit form (name + cmd + description in one view).
- **U2. Multi-select chained run**
  1. Switch to `createTreeView({ canSelectMany: true })`.
  2. Add `cmdClipboard.runSelectedInTerminal`.
  3. Track selection order via `onDidChangeSelection`.
  4. Confirmation modal showing joined command.
  5. Refuse snippets containing `&&`/`||`/`;`/newline unless opt-in.
  6. Apply B2 line-clear fix.
- **U3. Discoverability polish**
  1. `TreeItem.tooltip` as `MarkdownString` (full cmd + description).
  2. Audit context menu — add missing Rename/Edit/Duplicate/Delete.
  3. Consider single-click = copy.

### P2 — AI (after P0/P1)
- **A1. Project scan** (strictly sequential)
  1. Deterministic parser for `package.json`, `Makefile`, `Dockerfile`, `docker-compose.yml`, `.github/workflows/*`, `justfile`, `Taskfile.yml`, `pyproject.toml`, `Cargo.toml`.
  2. Consent modal (Allow Once / Allow Always / Cancel) → `cmdClipboard.ai.scanConsent`.
  3. AI ranking layer (names + shallow tree only).
  4. Review webview: checkbox + name + cmd + description + source. Destructive unchecked + flagged.
  5. Persist only on "Add Selected".
- **A2–A5.** NL→command, Explain, Smart Suggestions, Fix/Improve — separate releases.

### P3 — Pre-Publish Polish
- **F1. Screenshots & GIFs** (do *last*)
  1. Capture: hero, copy GIF, terminal-fix GIF, multi-select GIF, edit form, scan consent, scan review, search.
  2. Save to `resources/screenshots/`.
  3. Embed in README with relative paths.
  4. Update `.vscodeignore`.

### P4 — Tooling (Anytime)
- **T1. `update-changelog` skill** — already created at `.claude/skills/update-changelog/SKILL.md`. Use `/update-changelog` at every release boundary.

### Recommended Execution Order
1. **Day 1:** B1 + B2 → release `0.5.1` (patch).
2. **Day 2–3:** U1 + U3.
3. **Day 4–5:** U2.
4. **Week 2:** A1.
5. **Week 3:** F1 → release `0.6.0` (minor).
6. **Later:** A2–A5 as separate minor releases.

`T1` (`/update-changelog`) is used at every release boundary, not as a standalone phase.

---

### Pre-Publish Checklist (verify before `vsce publish`)

- [ ] **B1:** Logo restored — PNG marketplace icon + monochrome SVG activity-bar icon using `currentColor`. Verified visible in light + dark themes.
- [ ] **B2:** Terminal replace fix verified on bash, zsh, PowerShell, and (best-effort) cmd.exe.
- [ ] **U1:** Edit form / Rename shortcut shipped.
- [ ] **U2:** Multi-select chain run with confirmation modal shipped.
- [ ] **U3:** Tooltips + context menu polish done.
- [ ] **A1:** Project scan with consent modal + review/select UI shipped.
- [ ] Export / import (JSON) for command lists — protects against data loss.
- [ ] Drag-and-drop reordering within and between folders.
- [ ] **F1:** All screenshots + GIFs added to README and committed under `resources/screenshots/`.
- [ ] **T1:** `update-changelog` skill in place and used to write the release notes.
- [ ] CHANGELOG entry for each item shipped.
- [ ] Test on Windows (cmd.exe + PowerShell).
- [ ] Bump version in `package.json`, run `vsce package`, smoke-test the `.vsix` locally, then `vsce publish`.
