# AI Features Roadmap — Command Clipboard

## Priority 1 (Do First)

### 1. Auto-Detect Commands from Project Files
- Scan `package.json` scripts, `Makefile`, `Dockerfile`, `docker-compose.yml`, `.github/workflows`
- Prompt user: "Found 8 commands in your project. Import them?"
- Gives instant value on first install — no manual entry needed
- **Impact:** High | **Effort:** Low

### 2. Natural Language to Command
- User types in plain English: "find all large files over 100MB"
- AI generates the command: `find . -type f -size +100M`
- User can save it directly to their clipboard
- **Impact:** High | **Effort:** Medium

### 3. Explain Command
- Right-click any saved command → "Explain this command"
- AI breaks down what each part of the command does
- Example: `docker compose up -d --build` → "Starts containers in detached mode, rebuilding images first"
- **Impact:** Medium | **Effort:** Low

## Priority 2 (Later)

### 4. Smart Suggestions
- AI analyzes saved commands and suggests related ones
- Example: user has `git stash` → suggests `git stash pop`, `git stash list`
- **Impact:** Medium | **Effort:** Medium

### 5. Fix / Improve Command
- User pastes a broken command → AI fixes syntax errors
- Suggests safer or better alternatives
- Example: `rm -rf ./dist` → suggests adding confirmation or using `trash`
- **Impact:** Low | **Effort:** Medium

---

## Pre-Publish Improvements

- [ ] Add screenshots/GIFs to README for marketplace listing
- [ ] Add export/import (JSON) so users don't fear data loss
- [ ] Add drag-and-drop reordering
- [ ] Convert `resources/icon.svg` to PNG (128x128+)
