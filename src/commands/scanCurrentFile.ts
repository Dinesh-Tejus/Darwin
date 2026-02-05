import * as vscode from 'vscode';
import { parseImports, isSupportedLanguage, trackPythonUsages } from '../parsers/index.js';
import { checkMultipleDeprecations, getDeprecatedPackages } from '../services/deprecationService.js';
import { setDiagnostics, setDiagnosticsWithUsages } from '../providers/diagnosticsProvider.js';
import { applyDeprecationDecorations } from '../providers/decorationProvider.js';
import { validateApiKeys, isLanguageEnabled, logInfo, logWarning } from '../utils/index.js';
import { UsageInfo } from '../models/index.js';

/**
 * Scan the current file for deprecated packages
 */
export async function scanCurrentFile(): Promise<void> {
  const editor = vscode.window.activeTextEditor;

  if (!editor) {
    vscode.window.showWarningMessage('Darwin: No active file to scan');
    return;
  }

  const document = editor.document;

  // Check if language is supported
  if (!isSupportedLanguage(document)) {
    vscode.window.showWarningMessage(
      `Darwin: ${document.languageId} files are not supported. ` +
        'Supported languages: Python, JavaScript, TypeScript'
    );
    return;
  }

  // Check if language is enabled in settings
  if (!isLanguageEnabled(document.languageId)) {
    vscode.window.showWarningMessage(
      `Darwin: Scanning for ${document.languageId} is disabled in settings`
    );
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

  logInfo(`Scanning file: ${document.fileName}`);

  // Show progress
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Darwin: Scanning for deprecated packages',
      cancellable: true,
    },
    async (progress, token) => {
      // Parse imports
      progress.report({ message: 'Parsing imports...' });
      const parseResult = parseImports(document);

      if (parseResult.errors.length > 0) {
        logWarning(`Parse errors: ${parseResult.errors.join(', ')}`);
      }

      const imports = parseResult.imports;
      logInfo(`Found ${imports.length} imports`);

      if (imports.length === 0) {
        vscode.window.showInformationMessage(
          'Darwin: No external imports found in this file'
        );
        return;
      }

      // Check for cancellation
      if (token.isCancellationRequested) {
        return;
      }

      // Check deprecation status for each import
      progress.report({ message: `Checking ${imports.length} packages...` });
      const deprecations = await checkMultipleDeprecations(imports, progress);

      // Check for cancellation
      if (token.isCancellationRequested) {
        return;
      }

      // Get deprecated packages
      const deprecated = getDeprecatedPackages(deprecations);

      if (deprecated.length > 0) {
        // Track usages for deprecated packages (Python only for now)
        let usages: UsageInfo[] = [];
        if (document.languageId === 'python') {
          progress.report({ message: 'Tracking usages...' });
          const deprecatedImports = imports.filter((imp) =>
            deprecations.get(imp.packageName)?.isDeprecated
          );
          const trackingResult = trackPythonUsages(document, deprecatedImports);

          // Attach deprecation info to usages
          usages = trackingResult.usages.map((usage) => ({
            ...usage,
            deprecationInfo: deprecations.get(usage.importInfo.packageName),
          }));

          logInfo(
            `Tracked ${trackingResult.totalUsageCount} usages across ${usages.length} deprecated imports`
          );
        }

        // Set diagnostics with usage information
        if (usages.length > 0) {
          setDiagnosticsWithUsages(document.uri, usages);

          // Apply visual decorations
          applyDeprecationDecorations(editor, usages);
        } else {
          // Fallback to original diagnostics for non-Python or no usages
          setDiagnostics(document.uri, imports, deprecations);
        }

        const packageList = deprecated.map((d) => d.packageName).join(', ');
        vscode.window.showWarningMessage(
          `Darwin: Found ${deprecated.length} deprecated package(s): ${packageList}`
        );
      } else {
        // No deprecated packages - just set empty diagnostics
        setDiagnostics(document.uri, imports, deprecations);
        vscode.window.showInformationMessage(
          `Darwin: No deprecated packages found (checked ${imports.length} imports)`
        );
      }
    }
  );
}
