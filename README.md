# Darwin - Legacy Package Detector

A VS Code extension that scans your Python and JavaScript/TypeScript imports for deprecated or unmaintained packages, flags them with inline diagnostics, and provides AI-powered automated migration suggestions.

## Overview

Darwin watches your code for imports of deprecated, abandoned, or unmaintained packages. It combines web search (via Tavily) with AI analysis (via Google Gemini) to determine whether a package is still actively maintained and, if not, suggests modern replacements. Migrations can be applied with a single click and undone if needed.

## Features

- **Automatic deprecation detection** — Identifies deprecated, abandoned, and unmaintained packages in your imports
- **Python and JavaScript/TypeScript support** — Works with `.py`, `.js`, `.ts`, `.jsx`, and `.tsx` files
- **Web search verification** — Uses Tavily search agents to gather up-to-date information about package health
- **Inline diagnostics** — Deprecated imports are flagged with VS Code warning/info diagnostics
- **Hover information** — Hover over a flagged import to see deprecation details and suggested alternatives
- **Strikethrough decorations** — Visually marks deprecated imports with strikethrough text
- **AI-powered analysis** — Uses Google Gemini to evaluate package status and recommend replacements
- **One-click migration** — Apply AI-suggested replacements with a single command, with a diff preview before changes
- **Migration undo** — Revert any migration if the result isn't what you expected
- **Bulk migration** — Migrate all deprecated packages in a file at once
- **Caching** — Caches analysis results to minimize API calls and speed up repeated scans
- **Workspace-wide scanning** — Scan your entire workspace for deprecated packages in one go
- **Configurable confidence threshold** — Control how certain the AI must be before surfacing suggestions
- **Custom replacement mappings** — Override automatic suggestions with your own preferred replacements
- **Ignore list** — Suppress warnings for packages you intentionally keep

## Prerequisites

Darwin requires two API keys to function:

1. **Tavily API Key** — Used for web search to gather package status information
   - Get one at [https://tavily.com](https://tavily.com)

2. **Google Gemini API Key** — Used for AI-powered analysis of package deprecation status
   - Get one at [https://aistudio.google.com/apikey](https://aistudio.google.com/apikey)



## Getting Started

1. **Configure API keys** — Open VS Code Settings (`Ctrl+,` / `Cmd+,`) and search for "Darwin". Enter your Tavily and Gemini API keys.

2. **Open a supported file** — Open any Python or JavaScript/TypeScript file. Darwin activates automatically for supported languages.

3. **Scan for deprecated packages** — Open the Command Palette and run `Darwin: Scan Current File for Deprecated Packages`. Deprecated imports will be flagged with diagnostics, strikethrough decorations, and hover information.

4. **Migrate** — Place your cursor on a flagged import and run `Darwin: Migrate Deprecated Package` to apply the suggested replacement. Review the diff preview and confirm.

## Commands

| Command | Description |
|---------|-------------|
| `Darwin: Scan Current File for Deprecated Packages` | Scan the active file for deprecated imports |
| `Darwin: Scan Workspace for Deprecated Packages` | Scan all supported files in the workspace |
| `Darwin: Migrate Deprecated Package` | Apply the suggested migration for the package at the cursor |
| `Darwin: Migrate All Deprecated Packages in File` | Migrate all flagged packages in the active file |
| `Darwin: Undo Last Migration` | Revert the most recent migration |
| `Darwin: Ignore Package` | Add a package to the ignore list so it won't be flagged |
| `Darwin: Clear Deprecation Cache` | Clear all cached analysis results |

## Configuration

All settings are under the `darwin.*` namespace in VS Code Settings.

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `darwin.tavilyApiKey` | `string` | `""` | API key for Tavily search service |
| `darwin.geminiApiKey` | `string` | `""` | API key for Google Gemini AI |
| `darwin.geminiModel` | `string` | `"gemini-2.0-flash"` | Gemini model to use for analysis. Options: `gemini-2.5-flash`, `gemini-2.5-pro`, `gemini-2.0-flash`, `gemini-flash-latest` |
| `darwin.cacheTtlMonths` | `number` | `2` | Cache time-to-live in months (1-12) |
| `darwin.ignoredPackages` | `string[]` | `[]` | List of packages to ignore when scanning |
| `darwin.enabledLanguages` | `string[]` | `["python", "javascript", "typescript", "javascriptreact", "typescriptreact"]` | Languages to scan for deprecated packages |
| `darwin.confidenceThreshold` | `number` | `0.8` | Minimum confidence level (0-1) required to show migration suggestions |
| `darwin.customReplacements` | `object` | `{}` | Custom package replacement mappings, e.g. `{ "old-package": "new-package" }`. Overrides automatic suggestions |
| `darwin.showLowConfidenceWarnings` | `boolean` | `true` | Show warnings for packages with confidence below the threshold |
| `darwin.maxMigrationHistorySize` | `number` | `10` | Maximum number of migrations to keep in undo history (1-50) |

## How It Works

1. **Parse imports** — When a file is opened or scanned, Darwin extracts all import statements using language-specific parsers.
2. **Search the web** — Each package name is searched via Tavily to find current information about its maintenance status, deprecation notices, and known alternatives.
3. **AI analysis** — The search results are fed to Google Gemini, which evaluates whether the package is deprecated/unmaintained and suggests modern replacements with a confidence score.
4. **Show results** — Deprecated packages are highlighted with diagnostics (warnings/info), strikethrough decorations, and detailed hover information.
5. **Migrate** — When you trigger a migration, Darwin generates the replacement code and shows a diff preview. On confirmation, it updates the import statement and (where applicable) usage references.

Results are cached locally so subsequent scans of the same package are instant and don't consume API calls.

## Supported Languages

| Language | File Extensions |
|----------|----------------|
| Python | `.py` |
| JavaScript | `.js`, `.jsx` |
| TypeScript | `.ts`, `.tsx` |

