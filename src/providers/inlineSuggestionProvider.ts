import * as vscode from 'vscode';
import { MigrationInfo, MigrationState, ImportInfo, UsageInfo } from '../models/index.js';
import { generateMigration, findMigrationDocs } from '../services/deprecationService.js';
import { getDeprecationData, clearDiagnostics } from './diagnosticsProvider.js';
import { getStoredUsages, clearDocumentDecorations } from './decorationProvider.js';
import { logInfo, logWarning, logError } from '../utils/index.js';
import { parseImports } from '../parsers/index.js';

// Store active migrations
const activeMigrations = new Map<string, MigrationState>();

// Virtual document content provider for diff view
class MigrationContentProvider implements vscode.TextDocumentContentProvider {
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

const migrationContentProvider = new MigrationContentProvider();

/**
 * Register the migration content provider
 */
export function registerMigrationContentProvider(
  context: vscode.ExtensionContext
): vscode.Disposable {
  const disposable = vscode.workspace.registerTextDocumentContentProvider(
    'darwin-migration',
    migrationContentProvider
  );
  context.subscriptions.push(disposable);
  return disposable;
}

/**
 * Show migration diff for a package
 */
export async function showMigration(
  documentUri: vscode.Uri,
  packageName: string,
  replacement: string,
  range: vscode.Range
): Promise<void> {
  const deprecationInfo = getDeprecationData(packageName);
  if (!deprecationInfo) {
    vscode.window.showErrorMessage(`No deprecation info found for ${packageName}`);
    return;
  }

  // Get the document
  const document = await vscode.workspace.openTextDocument(documentUri);

  // Parse imports to find the specific one
  const parseResult = parseImports(document);
  const importInfo = parseResult.imports.find(
    (i) => i.packageName === packageName
  );

  if (!importInfo) {
    vscode.window.showErrorMessage(`Import for ${packageName} not found`);
    return;
  }

  // Show progress while generating migration
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Darwin: Generating migration for ${packageName}`,
      cancellable: false,
    },
    async (progress) => {
      try {
        progress.report({ message: 'Searching migration documentation...' });

        // Generate migration
        const migration = await generateMigration(
          importInfo,
          deprecationInfo,
          document
        );

        if (!migration) {
          if (!deprecationInfo.replacement) {
            vscode.window.showWarningMessage(
              `Darwin: No replacement package known for "${packageName}". ` +
                'Manual migration may be required.'
            );
          } else {
            vscode.window.showErrorMessage(
              `Darwin: Failed to generate migration for ${packageName}`
            );
          }
          return;
        }

        // Show warning if no migration docs found
        if (!migration.hasMigrationDocs) {
          vscode.window.showWarningMessage(
            `Darwin: No official migration documentation found for ` +
              `${packageName} → ${replacement}. The suggested migration may need review.`
          );
        }

        progress.report({ message: 'Showing diff...' });

        // Show the diff
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
 * Show a diff between original and migrated code
 */
async function showMigrationDiff(
  document: vscode.TextDocument,
  migration: MigrationInfo
): Promise<void> {
  const migrationId = `${migration.originalPackage}-${Date.now()}`;

  // Create URIs for diff
  const originalUri = document.uri;
  const migratedUri = vscode.Uri.parse(
    `darwin-migration:/${migrationId}/migrated-${document.uri.path.split('/').pop()}`
  );

  // Create the migrated document content
  const originalText = document.getText();
  const migratedText = applyMigration(originalText, migration);

  // Set the content for the virtual document
  migrationContentProvider.setContent(migratedUri, migratedText);

  // Store migration state
  const state: MigrationState = {
    id: migrationId,
    migration,
    status: 'showing_diff',
    diffUri: migratedUri,
  };
  activeMigrations.set(migrationId, state);

  // Open diff editor
  const title = `${migration.originalPackage} → ${migration.replacementPackage}`;
  await vscode.commands.executeCommand(
    'vscode.diff',
    originalUri,
    migratedUri,
    `Darwin Migration: ${title}`
  );

  // Show accept/reject options
  const choice = await vscode.window.showInformationMessage(
    `Migration: ${migration.originalPackage} → ${migration.replacementPackage}`,
    { modal: false },
    'Accept Migration',
    'Reject'
  );

  if (choice === 'Accept Migration') {
    await acceptMigration(migrationId, document);
  } else {
    await rejectMigration(migrationId);
  }
}

/**
 * Apply migration to the document text
 */
function applyMigration(originalText: string, migration: MigrationInfo): string {
  const lines = originalText.split('\n');
  const startLine = migration.range.start.line;
  const endLine = migration.range.end.line;

  // Replace the import lines with migrated code
  const before = lines.slice(0, startLine);
  const after = lines.slice(endLine + 1);
  const migratedLines = migration.migratedCode.split('\n');

  return [...before, ...migratedLines, ...after].join('\n');
}

/**
 * Accept a migration and apply changes
 */
async function acceptMigration(
  migrationId: string,
  document: vscode.TextDocument
): Promise<void> {
  const state = activeMigrations.get(migrationId);
  if (!state) {
    return;
  }

  const migration = state.migration;

  try {
    // Create workspace edit
    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      document.uri,
      migration.range,
      migration.migratedCode
    );

    // Apply the edit (doesn't auto-save)
    const success = await vscode.workspace.applyEdit(edit);

    if (success) {
      logInfo(`Applied migration: ${migration.originalPackage} → ${migration.replacementPackage}`);
      vscode.window.showInformationMessage(
        `Darwin: Migration applied. Review and save the file when ready.`
      );

      // Update state
      state.status = 'accepted';

      // Clear stale decorations and diagnostics for the migrated file
      clearDocumentDecorations(document.uri);
      clearDiagnostics(document.uri);
    } else {
      vscode.window.showErrorMessage('Darwin: Failed to apply migration');
    }
  } finally {
    // Cleanup
    cleanupMigration(migrationId);
  }
}

/**
 * Reject a migration
 */
async function rejectMigration(migrationId: string): Promise<void> {
  const state = activeMigrations.get(migrationId);
  if (!state) {
    return;
  }

  logInfo(`Rejected migration: ${state.migration.originalPackage}`);
  state.status = 'rejected';

  cleanupMigration(migrationId);
}

/**
 * Cleanup migration state
 */
function cleanupMigration(migrationId: string): void {
  const state = activeMigrations.get(migrationId);
  if (state?.diffUri) {
    migrationContentProvider.removeContent(state.diffUri);
  }
  activeMigrations.delete(migrationId);
}

/**
 * Get active migration count
 */
export function getActiveMigrationCount(): number {
  return activeMigrations.size;
}

/**
 * Inline completion provider for migration suggestions
 * Shows ghost text with replacement code when cursor is on deprecated code
 */
export class DarwinInlineCompletionProvider implements vscode.InlineCompletionItemProvider {
  private cachedCompletions = new Map<string, vscode.InlineCompletionItem[]>();

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken
  ): Promise<vscode.InlineCompletionList | null> {
    // Only show suggestions when explicitly triggered or on deprecated code
    if (context.triggerKind !== vscode.InlineCompletionTriggerKind.Invoke) {
      // Check if we're on deprecated code
      const usages = getStoredUsages(document.uri);
      if (!usages || usages.length === 0) {
        return null;
      }

      // Check if position is within any deprecated usage
      let matchedUsage: UsageInfo | null = null;
      let matchedRange: vscode.Range | null = null;

      for (const usage of usages) {
        // Check import range
        if (usage.importInfo.range.contains(position)) {
          matchedUsage = usage;
          matchedRange = usage.importInfo.range;
          break;
        }

        // Check usage locations
        for (const location of usage.usageLocations) {
          if (location.range.contains(position)) {
            matchedUsage = usage;
            matchedRange = location.range;
            break;
          }
        }
        if (matchedUsage) break;
      }

      if (!matchedUsage || !matchedRange) {
        return null;
      }
    }

    // Get stored usages
    const usages = getStoredUsages(document.uri);
    if (!usages || usages.length === 0) {
      return null;
    }

    // Find if cursor is on a deprecated import or usage
    for (const usage of usages) {
      const deprecationInfo = usage.deprecationInfo;
      if (!deprecationInfo?.replacement) {
        continue;
      }

      // Check if on import line
      if (usage.importInfo.range.contains(position)) {
        const completion = await this.createImportCompletion(
          document,
          usage,
          deprecationInfo.replacement
        );
        if (completion) {
          return new vscode.InlineCompletionList([completion]);
        }
      }

      // Check if on usage
      for (const location of usage.usageLocations) {
        if (location.range.contains(position)) {
          const completion = this.createUsageCompletion(
            document,
            location.range,
            usage.importInfo.packageName,
            deprecationInfo.replacement
          );
          if (completion) {
            return new vscode.InlineCompletionList([completion]);
          }
        }
      }
    }

    return null;
  }

  /**
   * Create inline completion for an import statement
   */
  private async createImportCompletion(
    document: vscode.TextDocument,
    usage: UsageInfo,
    replacement: string
  ): Promise<vscode.InlineCompletionItem | null> {
    const importInfo = usage.importInfo;
    const originalText = document.getText(importInfo.range);

    // Create simple replacement (just swap package name)
    let replacementText: string;

    if (importInfo.namedImports && importInfo.namedImports.length > 0) {
      // from package import x, y -> from replacement import x, y
      replacementText = originalText.replace(
        new RegExp(`\\b${this.escapeRegex(importInfo.packageName)}\\b`),
        replacement
      );
    } else {
      // import package -> import replacement
      replacementText = originalText.replace(
        new RegExp(`\\b${this.escapeRegex(importInfo.packageName)}\\b`),
        replacement
      );
    }

    // Only show if different
    if (replacementText === originalText) {
      return null;
    }

    return new vscode.InlineCompletionItem(
      replacementText,
      importInfo.range
    );
  }

  /**
   * Create inline completion for a usage
   */
  private createUsageCompletion(
    document: vscode.TextDocument,
    range: vscode.Range,
    packageName: string,
    replacement: string
  ): vscode.InlineCompletionItem | null {
    const originalText = document.getText(range);

    // Get the identifier part of the package (last part of dotted name)
    const originalId = packageName.split('.').pop() || packageName;
    const replacementId = replacement.split('.').pop() || replacement;

    // Simple text replacement
    const replacementText = originalText.replace(
      new RegExp(`\\b${this.escapeRegex(originalId)}\\b`, 'g'),
      replacementId
    );

    if (replacementText === originalText) {
      return null;
    }

    return new vscode.InlineCompletionItem(
      replacementText,
      range
    );
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

/**
 * Register the inline completion provider
 */
export function registerInlineCompletionProvider(
  context: vscode.ExtensionContext
): vscode.Disposable {
  const provider = vscode.languages.registerInlineCompletionItemProvider(
    [
      { language: 'python' },
      { language: 'javascript' },
      { language: 'typescript' },
      { language: 'javascriptreact' },
      { language: 'typescriptreact' },
    ],
    new DarwinInlineCompletionProvider()
  );

  context.subscriptions.push(provider);
  logInfo('Inline completion provider registered');
  return provider;
}
