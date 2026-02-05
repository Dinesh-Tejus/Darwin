import * as vscode from 'vscode';
import { scanCurrentFile } from './scanCurrentFile.js';
import { scanWorkspace } from './scanWorkspace.js';
import { migratePackage, migrateAllInFile, registerMigratedContentProvider } from './migratePackage.js';
import { clearCache } from '../services/cacheService.js';
import { clearAllDiagnostics } from '../providers/diagnosticsProvider.js';
import { clearAllDecorations } from '../providers/decorationProvider.js';
import {
  handleIgnorePackage,
  SHOW_MIGRATION_COMMAND,
  IGNORE_PACKAGE_COMMAND,
} from '../providers/codeActionProvider.js';
import { showMigration } from '../providers/inlineSuggestionProvider.js';
import {
  undoLastMigration,
  hasUndoableMigrations,
  getLastMigration,
} from '../services/migrationHistoryService.js';
import { logInfo } from '../utils/index.js';

export { scanCurrentFile } from './scanCurrentFile.js';
export { scanWorkspace } from './scanWorkspace.js';
export { migratePackage, migrateAllInFile, registerMigratedContentProvider } from './migratePackage.js';

export const MIGRATE_PACKAGE_COMMAND = 'darwin.migratePackage';
export const UNDO_MIGRATION_COMMAND = 'darwin.undoMigration';
export const MIGRATE_ALL_COMMAND = 'darwin.migrateAllInFile';

/**
 * Register all commands
 */
export function registerCommands(context: vscode.ExtensionContext): void {
  // Scan current file command
  context.subscriptions.push(
    vscode.commands.registerCommand('darwin.scanCurrentFile', async () => {
      await scanCurrentFile();
    })
  );

  // Scan workspace command
  context.subscriptions.push(
    vscode.commands.registerCommand('darwin.scanWorkspace', async () => {
      await scanWorkspace();
    })
  );

  // Clear cache command
  context.subscriptions.push(
    vscode.commands.registerCommand('darwin.clearCache', async () => {
      const count = await clearCache();
      clearAllDiagnostics();
      clearAllDecorations();
      vscode.window.showInformationMessage(
        `Darwin: Cleared ${count} cached entries. Run a new scan to refresh results.`
      );
      logInfo(`Cache cleared: ${count} entries`);
    })
  );

  // Migrate package command
  context.subscriptions.push(
    vscode.commands.registerCommand(MIGRATE_PACKAGE_COMMAND, async (args?: unknown) => {
      await migratePackage(args as { packageName?: string; uri?: string });
    })
  );

  // Ignore package command (from code action)
  context.subscriptions.push(
    vscode.commands.registerCommand(IGNORE_PACKAGE_COMMAND, async (packageName: string) => {
      await handleIgnorePackage(packageName);
    })
  );

  // Show migration command (from code action)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      SHOW_MIGRATION_COMMAND,
      async (
        documentUri: vscode.Uri,
        packageName: string,
        replacement: string,
        range: vscode.Range
      ) => {
        await showMigration(documentUri, packageName, replacement, range);
      }
    )
  );

  // Undo last migration command
  context.subscriptions.push(
    vscode.commands.registerCommand(UNDO_MIGRATION_COMMAND, async () => {
      const editor = vscode.window.activeTextEditor;
      const fileUri = editor?.document.uri.toString();

      if (!hasUndoableMigrations(fileUri)) {
        vscode.window.showInformationMessage('Darwin: No migrations to undo');
        return;
      }

      const lastMigration = getLastMigration(fileUri);
      if (!lastMigration) {
        vscode.window.showInformationMessage('Darwin: No migrations to undo');
        return;
      }

      const confirm = await vscode.window.showWarningMessage(
        `Undo migration: ${lastMigration.fromPackage} → ${lastMigration.toPackage}?`,
        'Yes, Undo',
        'Cancel'
      );

      if (confirm === 'Yes, Undo') {
        const success = await undoLastMigration(fileUri);
        if (success) {
          vscode.window.showInformationMessage(
            `Darwin: Migration undone. Reverted ${lastMigration.toPackage} back to ${lastMigration.fromPackage}`
          );
        } else {
          vscode.window.showErrorMessage('Darwin: Failed to undo migration');
        }
      }
    })
  );

  // Migrate all deprecated packages in file
  context.subscriptions.push(
    vscode.commands.registerCommand(MIGRATE_ALL_COMMAND, async () => {
      await migrateAllInFile();
    })
  );

  logInfo('Commands registered');
}
