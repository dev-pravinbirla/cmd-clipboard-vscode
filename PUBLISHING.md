# Publishing Command Clipboard to VS Code Marketplace

## Prerequisites

### 1. Microsoft Account
- Required to access the marketplace and Azure DevOps
- Create one at https://account.microsoft.com if you don't have one

### 2. Publisher Account
1. Go to https://marketplace.visualstudio.com/manage
2. Sign in with your Microsoft account
3. Click **Create Publisher**
4. Set publisher ID to `pravinbirla` (must match `publisher` field in `package.json`)
5. Fill in display name, email, and optional website

### 3. Personal Access Token (PAT)
1. Go to https://dev.azure.com
2. Sign in with the **same** Microsoft account used for the publisher
3. If prompted, create a default organization (any name works)
4. Click your **profile icon** (top right) → **Personal Access Tokens**
5. Click **+ New Token**
   - **Name:** `vscode-marketplace` (or any name you prefer)
   - **Organization:** Select **All accessible organizations**
   - **Expiration:** Choose a duration (max 1 year — you'll need to renew it after expiry)
   - **Scopes:** Click **Custom defined** → scroll to **Marketplace** → check **Manage**
6. Click **Create**
7. **Copy the token immediately** — it will not be shown again
8. Store it somewhere safe (password manager, etc.)

### 4. Extension Icon
- The marketplace requires a **PNG** icon (minimum 128x128 pixels, recommended 256x256)
- The current icon is at `resources/icon.svg`
- Convert it to PNG and save as `resources/icon.png`
- You can use any tool: Figma, GIMP, Inkscape, or an online SVG-to-PNG converter

---

## Required Files Checklist

| File | Purpose | Status |
|------|---------|--------|
| `package.json` | Extension metadata, must include `publisher`, `repository`, `license`, `icon` | Done |
| `README.md` | Becomes the marketplace listing page — describe features, usage, screenshots | Done |
| `LICENSE` | License file (MIT) | Done |
| `resources/icon.png` | Marketplace icon (128x128+ PNG) | **Needs creation from SVG** |
| `.vscodeignore` | Excludes unnecessary files from the packaged `.vsix` | Done |

---

## Publishing Steps

### First-Time Setup

```bash
# Login to the marketplace (one-time per machine)
npx vsce login pravinbirla

# When prompted, paste your Personal Access Token
```

### Publish

```bash
# Option 1: Publish the current version as-is
npx vsce publish

# Option 2: Bump version and publish in one step
npx vsce publish patch   # 0.5.0 → 0.5.1 (bug fixes)
npx vsce publish minor   # 0.5.0 → 0.6.0 (new features)
npx vsce publish major   # 0.5.0 → 1.0.0 (breaking changes)
```

The extension will be live on the marketplace within **5–10 minutes** after publishing.

### Verify

- Check your listing at: `https://marketplace.visualstudio.com/items?itemName=pravinbirla.cmd-clipboard`
- Search "Command Clipboard" in the VS Code Extensions tab to confirm it appears

---

## Updating the Extension

### Standard Update Process

1. Make your code changes
2. Run tests: `npm test`
3. Bump version and publish:
   ```bash
   npx vsce publish patch   # or minor/major
   ```
4. Users with the extension installed will get the update automatically

### If PAT Has Expired

1. Go to https://dev.azure.com → Profile → Personal Access Tokens
2. Create a new token (same steps as above)
3. Re-login:
   ```bash
   npx vsce login pravinbirla
   ```
4. Then publish as normal

---

## Pre-Publish Validation

Before publishing, you can validate and preview the package locally:

```bash
# Package without publishing (creates a .vsix file)
npx vsce package

# Install locally to test
code --install-extension cmd-clipboard-<version>.vsix

# Check for packaging warnings/errors
npx vsce ls
```

---

## Unpublishing / Deprecating

```bash
# Remove a specific version
npx vsce unpublish pravinbirla.cmd-clipboard

# Or deprecate via the marketplace dashboard:
# https://marketplace.visualstudio.com/manage/publishers/pravinbirla
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `Error: Missing publisher name` | Ensure `"publisher": "pravinbirla"` is in `package.json` |
| `Error: Personal Access Token not valid` | PAT may have expired — create a new one at Azure DevOps |
| `Error: Missing repository` | Add `"repository"` field to `package.json` |
| `Error: Missing icon` | Ensure `resources/icon.png` exists and `"icon"` points to it in `package.json` |
| `Extension not showing in search` | Wait 10–15 minutes after publish; marketplace indexing takes time |
| `README not showing on listing` | Ensure `README.md` is in root and not listed in `.vscodeignore` |

---

## Useful Links

- Marketplace Management: https://marketplace.visualstudio.com/manage
- Azure DevOps (for PAT): https://dev.azure.com
- Publishing Docs: https://code.visualstudio.com/api/working-with-extensions/publishing-extension
- vsce CLI Reference: https://github.com/microsoft/vscode-vsce
