# Changelog

All notable changes to the **Command Clipboard** extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Webview edit form** — Edit a command (name, command, description) in a single dedicated panel instead of three sequential prompts. Supports `Cmd/Ctrl+Enter` to save and `Esc` to cancel.
- **Rename shortcut** — `F2` on a selected command or folder renames it in place. Also available from the right-click context menu.
- **Run Selected in Terminal** — Select multiple commands in the tree (Cmd/Ctrl- or Shift-click) and run them chained with `&&` in selection order. Shows a confirmation modal with the joined command before execution.
- New `cmdClipboard.allowComplexChaining` setting — opt in to chaining commands that already contain `&&`, `||`, `;`, or newlines (off by default to prevent malformed chains).

## [0.5.3] - 2026-05-16

### Added

- New `cmdClipboard.terminal.clearBeforeRun` setting to clear any half-typed input on the terminal prompt before running a saved command (enabled by default, can be disabled for shells without readline support)

### Changed

- Redesigned extension logo with a distinctive clipboard-and-terminal-prompt mark, replacing the previous briefcase-style icon in both the activity bar and the marketplace listing
- Consistent terminal execution behavior across the "Run in Terminal" command and the "Search Commands → Run" action

### Fixed

- Smaller install size — development-only files (planning docs, tests, build artifacts) are no longer included in the published package

## [0.5.0] - 2026-04-08

### Added

- Save frequently used terminal commands for quick access
- Copy commands to clipboard with one click
- Run commands directly in the terminal
- Three storage scopes: Global, Workspace, and Project
- Pin/unpin commands for quick access
- Organize commands into folders
- Search across all scopes
- Duplicate existing commands
- Keyboard shortcut (`Cmd+Shift+Q` / `Ctrl+Shift+Q`) to toggle panel

[Unreleased]: https://github.com/dev-pravinbirla/cmd-clipboard-vscode/compare/v0.5.3...HEAD
[0.5.3]: https://github.com/dev-pravinbirla/cmd-clipboard-vscode/compare/v0.5.0...v0.5.3
[0.5.0]: https://github.com/dev-pravinbirla/cmd-clipboard-vscode/releases/tag/v0.5.0
