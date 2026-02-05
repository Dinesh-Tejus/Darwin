import * as vscode from 'vscode';
import { getConfig, logInfo, logWarning } from '../utils/index.js';

/**
 * Represents a single migration that was applied
 */
export interface MigrationHistoryEntry {
  /** Unique identifier for this migration */
  id: string;

  /** URI of the file that was migrated */
  fileUri: string;

  /** Original file content before migration */
  originalContent: string;

  /** Migrated file content after migration */
  migratedContent: string;

  /** Package that was migrated from */
  fromPackage: string;

  /** Package that was migrated to */
  toPackage: string;

  /** Timestamp when migration was applied */
  appliedAt: number;

  /** Whether this migration has been undone */
  undone: boolean;
}

// In-memory migration history (per session)
// For persistence across sessions, could use globalState
let migrationHistory: MigrationHistoryEntry[] = [];

// Extension context for persistent storage
let extensionContext: vscode.ExtensionContext | null = null;

/**
 * Initialize the migration history service
 */
export function initMigrationHistoryService(context: vscode.ExtensionContext): void {
  extensionContext = context;

  // Load history from persistent storage
  const savedHistory = context.globalState.get<MigrationHistoryEntry[]>('darwin.migrationHistory', []);
  migrationHistory = savedHistory;

  logInfo(`Loaded ${migrationHistory.length} migrations from history`);
}

/**
 * Record a migration in history
 */
export async function recordMigration(entry: Omit<MigrationHistoryEntry, 'id' | 'appliedAt' | 'undone'>): Promise<string> {
  const config = getConfig();
  const id = `migration-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  const historyEntry: MigrationHistoryEntry = {
    ...entry,
    id,
    appliedAt: Date.now(),
    undone: false,
  };

  // Add to beginning of array (most recent first)
  migrationHistory.unshift(historyEntry);

  // Trim to max size
  if (migrationHistory.length > config.maxMigrationHistorySize) {
    migrationHistory = migrationHistory.slice(0, config.maxMigrationHistorySize);
  }

  // Persist to storage
  await saveHistory();

  logInfo(`Recorded migration: ${entry.fromPackage} → ${entry.toPackage} in ${entry.fileUri}`);

  return id;
}

/**
 * Get the last undoable migration for a file
 */
export function getLastMigration(fileUri?: string): MigrationHistoryEntry | undefined {
  if (fileUri) {
    return migrationHistory.find((m) => m.fileUri === fileUri && !m.undone);
  }
  return migrationHistory.find((m) => !m.undone);
}

/**
 * Get all migrations for a file
 */
export function getMigrationsForFile(fileUri: string): MigrationHistoryEntry[] {
  return migrationHistory.filter((m) => m.fileUri === fileUri && !m.undone);
}

/**
 * Get all migration history
 */
export function getMigrationHistory(): MigrationHistoryEntry[] {
  return [...migrationHistory];
}

/**
 * Undo a specific migration
 */
export async function undoMigration(migrationId: string): Promise<boolean> {
  const entry = migrationHistory.find((m) => m.id === migrationId);

  if (!entry) {
    logWarning(`Migration ${migrationId} not found in history`);
    return false;
  }

  if (entry.undone) {
    logWarning(`Migration ${migrationId} has already been undone`);
    return false;
  }

  try {
    const uri = vscode.Uri.parse(entry.fileUri);
    const document = await vscode.workspace.openTextDocument(uri);

    // Check if current content matches what we migrated to
    const currentContent = document.getText();
    if (currentContent !== entry.migratedContent) {
      // File has been modified since migration, ask user
      const choice = await vscode.window.showWarningMessage(
        'The file has been modified since the migration. Undo anyway?',
        'Yes, Undo',
        'Cancel'
      );

      if (choice !== 'Yes, Undo') {
        return false;
      }
    }

    // Create a workspace edit to restore original content
    const edit = new vscode.WorkspaceEdit();
    const fullRange = new vscode.Range(
      new vscode.Position(0, 0),
      document.lineAt(document.lineCount - 1).range.end
    );
    edit.replace(uri, fullRange, entry.originalContent);

    const success = await vscode.workspace.applyEdit(edit);

    if (success) {
      entry.undone = true;
      await saveHistory();
      logInfo(`Undone migration: ${entry.fromPackage} → ${entry.toPackage}`);
      return true;
    }

    return false;
  } catch (error) {
    logWarning(`Failed to undo migration: ${(error as Error).message}`);
    return false;
  }
}

/**
 * Undo the last migration (optionally for a specific file)
 */
export async function undoLastMigration(fileUri?: string): Promise<boolean> {
  const lastMigration = getLastMigration(fileUri);

  if (!lastMigration) {
    return false;
  }

  return undoMigration(lastMigration.id);
}

/**
 * Clear all migration history
 */
export async function clearMigrationHistory(): Promise<void> {
  migrationHistory = [];
  await saveHistory();
  logInfo('Migration history cleared');
}

/**
 * Save history to persistent storage
 */
async function saveHistory(): Promise<void> {
  if (extensionContext) {
    await extensionContext.globalState.update('darwin.migrationHistory', migrationHistory);
  }
}

/**
 * Check if there are any undoable migrations
 */
export function hasUndoableMigrations(fileUri?: string): boolean {
  return getLastMigration(fileUri) !== undefined;
}

/**
 * Get count of undoable migrations
 */
export function getUndoableMigrationCount(): number {
  return migrationHistory.filter((m) => !m.undone).length;
}
