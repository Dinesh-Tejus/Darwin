import * as vscode from 'vscode';
import { parseImports, isSupportedLanguage, trackPythonUsages } from '../parsers/index.js';
import { checkMultipleDeprecations, getDeprecatedPackages } from '../services/deprecationService.js';
import { setDiagnostics, setDiagnosticsWithUsages } from '../providers/diagnosticsProvider.js';
import { applyDeprecationDecorations } from '../providers/decorationProvider.js';
import { validateApiKeys, isLanguageEnabled, logInfo, logWarning, logError } from '../utils/index.js';
import { ImportInfo, UsageInfo, DeprecationInfo } from '../models/index.js';

// File patterns to scan
const FILE_PATTERNS = [
  '**/*.py',
  '**/*.js',
  '**/*.ts',
  '**/*.jsx',
  '**/*.tsx',
];

// Directories to exclude
const EXCLUDE_PATTERNS = [
  '**/node_modules/**',
  '**/.venv/**',
  '**/venv/**',
  '**/__pycache__/**',
  '**/dist/**',
  '**/build/**',
  '**/.git/**',
];

/**
 * Scan the entire workspace for deprecated packages
 */
export async function scanWorkspace(): Promise<void> {
  // Check if workspace is open
  if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
    vscode.window.showWarningMessage('Darwin: No workspace folder open');
    return;
  }

  // Validate API keys
  const apiValidation = validateApiKeys();
  if (!apiValidation.valid) {
    const configure = await vscode.window.showErrorMessage(
      `Darwin: Missing API keys: ${apiValidation.missing.join(', ')}`,
      'Open Settings'
    );
    if (configure === 'Open Settings') {
      vscode.commands.executeCommand(
        'workbench.action.openSettings',
        'darwin'
      );
    }
    return;
  }

  logInfo('Starting workspace scan');

  // Show progress
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Darwin: Scanning workspace',
      cancellable: true,
    },
    async (progress, token) => {
      try {
        // Find all matching files
        progress.report({ message: 'Finding files...' });
        const files = await findFiles(token);

        if (token.isCancellationRequested) {
          return;
        }

        logInfo(`Found ${files.length} files to scan`);

        if (files.length === 0) {
          vscode.window.showInformationMessage(
            'Darwin: No supported files found in workspace'
          );
          return;
        }

        // Collect all unique packages across files
        progress.report({ message: `Parsing ${files.length} files...` });
        const { allImports, fileImportsMap } = await parseAllFiles(files, progress, token);

        if (token.isCancellationRequested) {
          return;
        }

        // Get unique packages
        const uniquePackages = deduplicateImports(allImports);
        logInfo(`Found ${uniquePackages.length} unique packages`);

        if (uniquePackages.length === 0) {
          vscode.window.showInformationMessage(
            'Darwin: No external imports found in workspace'
          );
          return;
        }

        // Check deprecation status
        progress.report({ message: `Checking ${uniquePackages.length} packages...` });
        const deprecations = await checkMultipleDeprecations(uniquePackages, progress);

        if (token.isCancellationRequested) {
          return;
        }

        // Set diagnostics for each file with usage tracking
        progress.report({ message: 'Setting diagnostics and tracking usages...' });
        await setDiagnosticsForFiles(fileImportsMap, deprecations);

        // Show summary
        const deprecated = getDeprecatedPackages(deprecations);
        showWorkspaceSummary(deprecated, files.length, uniquePackages.length);
      } catch (error) {
        logError('Workspace scan failed', error as Error);
        vscode.window.showErrorMessage(
          `Darwin: Scan failed: ${(error as Error).message}`
        );
      }
    }
  );
}

/**
 * Find all files matching our patterns
 */
async function findFiles(token: vscode.CancellationToken): Promise<vscode.Uri[]> {
  const allFiles: vscode.Uri[] = [];

  for (const pattern of FILE_PATTERNS) {
    if (token.isCancellationRequested) {
      break;
    }

    const excludePattern = `{${EXCLUDE_PATTERNS.join(',')}}`;
    const files = await vscode.workspace.findFiles(pattern, excludePattern, 1000);
    allFiles.push(...files);
  }

  return allFiles;
}

/**
 * Parse imports from all files
 */
async function parseAllFiles(
  files: vscode.Uri[],
  progress: vscode.Progress<{ message?: string; increment?: number }>,
  token: vscode.CancellationToken
): Promise<{
  allImports: ImportInfo[];
  fileImportsMap: Map<vscode.Uri, ImportInfo[]>;
}> {
  const allImports: ImportInfo[] = [];
  const fileImportsMap = new Map<vscode.Uri, ImportInfo[]>();
  const increment = 50 / files.length; // Use 50% of progress for parsing

  for (const uri of files) {
    if (token.isCancellationRequested) {
      break;
    }

    try {
      const document = await vscode.workspace.openTextDocument(uri);

      if (!isSupportedLanguage(document) || !isLanguageEnabled(document.languageId)) {
        continue;
      }

      const parseResult = parseImports(document);

      if (parseResult.imports.length > 0) {
        allImports.push(...parseResult.imports);
        fileImportsMap.set(uri, parseResult.imports);
      }

      if (parseResult.errors.length > 0) {
        logWarning(`Parse errors in ${uri.fsPath}: ${parseResult.errors.join(', ')}`);
      }
    } catch (error) {
      logWarning(`Failed to parse ${uri.fsPath}: ${(error as Error).message}`);
    }

    progress.report({ increment });
  }

  return { allImports, fileImportsMap };
}

/**
 * Deduplicate imports by package name
 */
function deduplicateImports(imports: ImportInfo[]): ImportInfo[] {
  const seen = new Map<string, ImportInfo>();

  for (const imp of imports) {
    const key = `${imp.language}:${imp.packageName}`;
    if (!seen.has(key)) {
      seen.set(key, imp);
    }
  }

  return Array.from(seen.values());
}

/**
 * Set diagnostics for all files with usage tracking
 */
async function setDiagnosticsForFiles(
  fileImportsMap: Map<vscode.Uri, ImportInfo[]>,
  deprecations: Map<string, DeprecationInfo>
): Promise<void> {
  for (const [uri, imports] of fileImportsMap) {
    try {
      const document = await vscode.workspace.openTextDocument(uri);

      // Filter to deprecated imports
      const deprecatedImports = imports.filter(
        (imp) => deprecations.get(imp.packageName)?.isDeprecated
      );

      if (deprecatedImports.length > 0 && document.languageId === 'python') {
        // Track usages for Python files
        const trackingResult = trackPythonUsages(document, deprecatedImports);

        // Attach deprecation info to usages
        const usages: UsageInfo[] = trackingResult.usages.map((usage) => ({
          ...usage,
          deprecationInfo: deprecations.get(usage.importInfo.packageName),
        }));

        if (usages.length > 0) {
          setDiagnosticsWithUsages(uri, usages);

          // Apply decorations to active editor if it matches
          const activeEditor = vscode.window.activeTextEditor;
          if (activeEditor && activeEditor.document.uri.toString() === uri.toString()) {
            applyDeprecationDecorations(activeEditor, usages);
          }
          continue;
        }
      }

      // Fallback for non-Python or no usages
      setDiagnostics(uri, imports, deprecations);
    } catch (error) {
      logWarning(`Failed to set diagnostics for ${uri.fsPath}: ${(error as Error).message}`);
      // Still try to set basic diagnostics
      setDiagnostics(uri, imports, deprecations);
    }
  }
}

/**
 * Show workspace scan summary
 */
function showWorkspaceSummary(
  deprecated: { packageName: string; replacement?: string }[],
  filesScanned: number,
  packagesChecked: number
): void {
  if (deprecated.length === 0) {
    vscode.window.showInformationMessage(
      `Darwin: No deprecated packages found. ` +
        `Scanned ${filesScanned} files, checked ${packagesChecked} packages.`
    );
  } else {
    const summaryItems = deprecated.slice(0, 5).map((d) => {
      if (d.replacement) {
        return `${d.packageName} → ${d.replacement}`;
      }
      return d.packageName;
    });

    let message = `Darwin: Found ${deprecated.length} deprecated package(s): ${summaryItems.join(', ')}`;

    if (deprecated.length > 5) {
      message += ` and ${deprecated.length - 5} more`;
    }

    message += `. Check the Problems panel for details.`;

    vscode.window.showWarningMessage(message);
  }
}
