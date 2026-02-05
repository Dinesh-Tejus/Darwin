import * as vscode from 'vscode';
import { parseImports } from '../parsers/index.js';
import { trackPythonUsages } from '../parsers/pythonUsageTracker.js';
import { getDeprecationData, storeDeprecationData } from '../providers/diagnosticsProvider.js';
import { generateMigration, checkDeprecation } from '../services/deprecationService.js';
import { recordMigration } from '../services/migrationHistoryService.js';
import {
  logInfo,
  logError,
  logWarning,
  getCustomReplacement,
  meetsConfidenceThreshold,
  getConfidenceThreshold,
  getConfig,
} from '../utils/index.js';
import { MigrationInfo, DeprecationInfo, ImportInfo } from '../models/index.js';

/**
 * Command arguments for migrate package
 */
interface MigratePackageArgs {
  packageName?: string;
  uri?: string;
}

/**
 * Result of migration validation
 */
interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// Virtual document provider for showing migrated content in diff view
class MigratedContentProvider implements vscode.TextDocumentContentProvider {
  private content = new Map<string, string>();
  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();

  get onDidChange(): vscode.Event<vscode.Uri> {
    return this._onDidChange.event;
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.content.get(uri.toString()) || '';
  }

  setContent(uri: vscode.Uri, content: string): void {
    this.content.set(uri.toString(), content);
    this._onDidChange.fire(uri);
  }

  removeContent(uri: vscode.Uri): void {
    this.content.delete(uri.toString());
  }
}

const migratedContentProvider = new MigratedContentProvider();
let providerRegistered = false;

/**
 * Register the migrated content provider (call from extension activation)
 */
export function registerMigratedContentProvider(context: vscode.ExtensionContext): void {
  if (!providerRegistered) {
    const disposable = vscode.workspace.registerTextDocumentContentProvider(
      'darwin-migrated',
      migratedContentProvider
    );
    context.subscriptions.push(disposable);
    providerRegistered = true;
  }
}

/**
 * Migrate a deprecated package at cursor or from command args
 */
export async function migratePackage(args?: MigratePackageArgs): Promise<void> {
  const editor = vscode.window.activeTextEditor;

  if (!editor) {
    vscode.window.showWarningMessage('Darwin: No active editor');
    return;
  }

  const document = editor.document;
  let packageName = args?.packageName;
  let importInfo: ImportInfo | undefined;

  // Parse imports
  const parseResult = parseImports(document);

  if (!packageName) {
    // Try to detect package from cursor position
    const position = editor.selection.active;

    // Check if cursor is on an import line
    for (const imp of parseResult.imports) {
      if (imp.range.contains(position)) {
        packageName = imp.packageName;
        importInfo = imp;
        break;
      }
    }

    // Check if cursor is on a usage (Python only)
    if (!packageName && document.languageId === 'python') {
      const trackingResult = trackPythonUsages(document, parseResult.imports);
      for (const usage of trackingResult.usages) {
        for (const loc of usage.usageLocations) {
          if (loc.range.contains(position)) {
            packageName = usage.importInfo.packageName;
            importInfo = usage.importInfo;
            break;
          }
        }
        if (packageName) break;
      }
    }
  } else {
    // Find import for the given package name
    importInfo = parseResult.imports.find((i) => i.packageName === packageName);
  }

  if (!packageName || !importInfo) {
    vscode.window.showWarningMessage(
      'Darwin: Place cursor on a deprecated import or usage to migrate'
    );
    return;
  }

  await executeMigration(document, importInfo, packageName);
}

/**
 * Migrate all deprecated packages in the current file
 * Shows a multi-select dialog for user to choose which packages to migrate
 */
export async function migrateAllInFile(): Promise<void> {
  const editor = vscode.window.activeTextEditor;

  if (!editor) {
    vscode.window.showWarningMessage('Darwin: No active editor');
    return;
  }

  const document = editor.document;
  const parseResult = parseImports(document);

  if (parseResult.imports.length === 0) {
    vscode.window.showInformationMessage('Darwin: No imports found in this file');
    return;
  }

  // Find deprecated packages
  const deprecatedImports: Array<{ import: ImportInfo; deprecation: DeprecationInfo }> = [];

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Darwin: Checking packages...',
      cancellable: true,
    },
    async (progress, token) => {
      for (const imp of parseResult.imports) {
        if (token.isCancellationRequested) break;

        // Check for cached deprecation info
        let deprecationInfo = getDeprecationData(imp.packageName);

        if (!deprecationInfo) {
          progress.report({ message: `Checking ${imp.packageName}...` });
          const result = await checkDeprecation(imp);
          if (result) {
            deprecationInfo = result;
            storeDeprecationData(imp.packageName, deprecationInfo);
          }
        }

        if (deprecationInfo?.isDeprecated) {
          // Check custom replacement
          const customReplacement = getCustomReplacement(imp.packageName);
          if (customReplacement) {
            deprecationInfo = { ...deprecationInfo, replacement: customReplacement };
          }

          // Only include if meets confidence threshold or has custom replacement
          if (customReplacement || meetsConfidenceThreshold(deprecationInfo.confidence)) {
            if (deprecationInfo.replacement) {
              deprecatedImports.push({ import: imp, deprecation: deprecationInfo });
            }
          }
        }
      }
    }
  );

  if (deprecatedImports.length === 0) {
    vscode.window.showInformationMessage(
      'Darwin: No deprecated packages with known replacements found in this file'
    );
    return;
  }

  // Show multi-select QuickPick
  const items: vscode.QuickPickItem[] = deprecatedImports.map((item) => ({
    label: `${item.import.packageName}`,
    description: `→ ${item.deprecation.replacement}`,
    detail: item.deprecation.reason || 'Deprecated package',
    picked: true,
  }));

  const selected = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    placeHolder: 'Select packages to migrate',
    title: 'Darwin: Migrate Deprecated Packages',
  });

  if (!selected || selected.length === 0) {
    return;
  }

  // Migrate selected packages one by one
  for (const item of selected) {
    const packageName = item.label;
    const deprecatedImport = deprecatedImports.find(
      (d) => d.import.packageName === packageName
    );

    if (deprecatedImport) {
      await executeMigration(
        document,
        deprecatedImport.import,
        packageName,
        deprecatedImport.deprecation
      );
    }
  }
}

/**
 * Execute migration for a single package
 */
async function executeMigration(
  document: vscode.TextDocument,
  importInfo: ImportInfo,
  packageName: string,
  existingDeprecation?: DeprecationInfo
): Promise<void> {
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Darwin: Migrating ${packageName}`,
      cancellable: false,
    },
    async (progress) => {
      try {
        // Get deprecation info
        let deprecationInfo = existingDeprecation || getDeprecationData(packageName);

        if (!deprecationInfo) {
          progress.report({ message: 'Searching for deprecation info...' });
          const result = await checkDeprecation(importInfo, progress);

          if (result) {
            deprecationInfo = result;
            storeDeprecationData(packageName, deprecationInfo);
          }
        }

        if (!deprecationInfo) {
          vscode.window.showWarningMessage(
            `Darwin: Could not find deprecation info for "${packageName}".`
          );
          return;
        }

        // Check for custom replacement (overrides auto-detected)
        const customReplacement = getCustomReplacement(packageName);
        if (customReplacement) {
          deprecationInfo = { ...deprecationInfo, replacement: customReplacement };
          logInfo(`Using custom replacement for ${packageName}: ${customReplacement}`);
        }

        if (!deprecationInfo.isDeprecated) {
          vscode.window.showInformationMessage(
            `Darwin: "${packageName}" is not deprecated according to our search.`
          );
          return;
        }

        // Check confidence threshold
        const config = getConfig();
        if (!customReplacement && !meetsConfidenceThreshold(deprecationInfo.confidence)) {
          const confidencePercent = Math.round(deprecationInfo.confidence * 100);
          const thresholdPercent = Math.round(config.confidenceThreshold * 100);

          if (config.showLowConfidenceWarnings) {
            const proceed = await vscode.window.showWarningMessage(
              `Darwin: Low confidence (${confidencePercent}%) for "${packageName}" deprecation. ` +
              `Threshold is ${thresholdPercent}%. Proceed anyway?`,
              'Yes, Migrate',
              'Cancel'
            );

            if (proceed !== 'Yes, Migrate') {
              return;
            }
          } else {
            logWarning(
              `Skipping ${packageName}: confidence ${confidencePercent}% below threshold ${thresholdPercent}%`
            );
            return;
          }
        }

        if (!deprecationInfo.replacement) {
          vscode.window.showWarningMessage(
            `Darwin: No replacement package known for "${packageName}". Manual migration required.`
          );
          return;
        }

        progress.report({ message: 'Searching migration documentation...' });

        const migration = await generateMigration(importInfo, deprecationInfo, document);

        if (!migration) {
          vscode.window.showErrorMessage(
            `Darwin: Failed to generate migration for ${packageName}`
          );
          return;
        }

        // Validate the generated code
        progress.report({ message: 'Validating generated code...' });
        const validation = validateMigratedCode(migration, document.languageId);

        if (!validation.valid) {
          await handleValidationFailure(document, migration, validation);
          return;
        }

        if (validation.warnings.length > 0) {
          logWarning(`Migration warnings: ${validation.warnings.join(', ')}`);
        }

        // Show warning if no migration docs found
        if (!migration.hasMigrationDocs) {
          vscode.window.showWarningMessage(
            `Darwin: No official migration docs found for ${packageName} → ${deprecationInfo.replacement}. Review carefully.`
          );
        }

        progress.report({ message: 'Showing diff...' });

        // Show side-by-side diff view
        await showMigrationDiff(document, migration);
      } catch (error) {
        logError('Migration failed', error as Error);
        vscode.window.showErrorMessage(
          `Darwin: Migration failed: ${(error as Error).message}`
        );
      }
    }
  );
}

/**
 * Validate the migrated code for basic syntax errors
 */
function validateMigratedCode(
  migration: MigrationInfo,
  languageId: string
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const code = migration.migratedCode;

  // Basic validation - check for common issues
  if (!code || code.trim().length === 0) {
    errors.push('Generated code is empty');
    return { valid: false, errors, warnings };
  }

  // Check for JSON parsing artifacts
  if (code.includes('```') || code.includes('\\n')) {
    warnings.push('Code may contain formatting artifacts');
  }

  // Language-specific validation
  if (languageId === 'python') {
    // Check for balanced parentheses, brackets, braces
    const openParens = (code.match(/\(/g) || []).length;
    const closeParens = (code.match(/\)/g) || []).length;
    if (openParens !== closeParens) {
      errors.push('Unbalanced parentheses in generated code');
    }

    const openBrackets = (code.match(/\[/g) || []).length;
    const closeBrackets = (code.match(/\]/g) || []).length;
    if (openBrackets !== closeBrackets) {
      errors.push('Unbalanced brackets in generated code');
    }

    const openBraces = (code.match(/\{/g) || []).length;
    const closeBraces = (code.match(/\}/g) || []).length;
    if (openBraces !== closeBraces) {
      errors.push('Unbalanced braces in generated code');
    }

    // Check for incomplete statements
    if (code.includes('...') && !code.includes("'...'") && !code.includes('"..."')) {
      warnings.push('Code may contain placeholder text (...)');
    }

    // Check that the new import is present
    if (migration.replacementPackage && !code.includes(migration.replacementPackage)) {
      warnings.push(`New import for ${migration.replacementPackage} may be missing`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Handle validation failure - show error and offer manual edit
 */
async function handleValidationFailure(
  document: vscode.TextDocument,
  migration: MigrationInfo,
  validation: ValidationResult
): Promise<void> {
  const errorMessage = `Generated code has issues:\n${validation.errors.join('\n')}`;
  logError(errorMessage, new Error('Validation failed'));

  const choice = await vscode.window.showErrorMessage(
    `Darwin: Migration generated invalid code. ${validation.errors[0]}`,
    'Open Original File',
    'Show Generated Code Anyway',
    'Cancel'
  );

  if (choice === 'Open Original File') {
    await vscode.window.showTextDocument(document);
    vscode.window.showInformationMessage(
      'Darwin: File opened for manual editing. Check the Output panel for details.'
    );
  } else if (choice === 'Show Generated Code Anyway') {
    // Show the diff anyway with a warning
    await showMigrationDiff(document, migration, true);
  }
}

/**
 * Show side-by-side diff view with accept/reject options
 */
async function showMigrationDiff(
  document: vscode.TextDocument,
  migration: MigrationInfo,
  hasValidationWarnings = false
): Promise<void> {
  const migrationId = `${migration.originalPackage.replace(/[^a-zA-Z0-9]/g, '-')}-${Date.now()}`;

  // Create URI for the migrated version
  const fileName = document.uri.path.split('/').pop() || 'file';
  const migratedUri = vscode.Uri.parse(
    `darwin-migrated:/${migrationId}/${fileName}`
  );

  // Set the migrated content
  migratedContentProvider.setContent(migratedUri, migration.migratedCode);

  // Open diff editor
  let title = `Migration: ${migration.originalPackage} → ${migration.replacementPackage}`;
  if (hasValidationWarnings) {
    title += ' ⚠️';
  }

  await vscode.commands.executeCommand(
    'vscode.diff',
    document.uri,
    migratedUri,
    title,
    { preview: true }
  );

  // Build info message
  let infoMessage = `Apply migration: ${migration.originalPackage} → ${migration.replacementPackage}?`;
  if (migration.notes) {
    infoMessage += `\n\nChanges: ${migration.notes}`;
  }
  if (hasValidationWarnings) {
    infoMessage += '\n\n⚠️ Warning: Code validation detected potential issues. Review carefully.';
  }

  // Show accept/reject dialog
  const choice = await vscode.window.showInformationMessage(
    infoMessage,
    { modal: false },
    'Apply Changes',
    'Cancel'
  );

  if (choice === 'Apply Changes') {
    await applyMigration(document, migration);
  }

  // Cleanup virtual document
  migratedContentProvider.removeContent(migratedUri);
}

/**
 * Apply the migration to the document
 */
async function applyMigration(
  document: vscode.TextDocument,
  migration: MigrationInfo
): Promise<void> {
  // Store original content for undo
  const originalContent = document.getText();

  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, migration.range, migration.migratedCode);

  const success = await vscode.workspace.applyEdit(edit);

  if (success) {
    // Record in migration history for undo support
    await recordMigration({
      fileUri: document.uri.toString(),
      originalContent,
      migratedContent: migration.migratedCode,
      fromPackage: migration.originalPackage,
      toPackage: migration.replacementPackage,
    });

    logInfo(
      `Applied migration: ${migration.originalPackage} → ${migration.replacementPackage}`
    );

    vscode.window.showInformationMessage(
      `Darwin: Migration applied! Use "Darwin: Undo Last Migration" to revert if needed.`
    );

    // Close the diff view and show the original document
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    await vscode.window.showTextDocument(document);
  } else {
    vscode.window.showErrorMessage('Darwin: Failed to apply migration');
  }
}
