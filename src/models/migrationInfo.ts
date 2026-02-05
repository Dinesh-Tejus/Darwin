import * as vscode from 'vscode';

/**
 * Information about a migration suggestion
 */
export interface MigrationInfo {
  /** Original import info */
  originalPackage: string;

  /** Replacement package */
  replacementPackage: string;

  /** Original code that should be migrated */
  originalCode: string;

  /** Migrated code suggestion */
  migratedCode: string;

  /** Range in the document to replace */
  range: vscode.Range;

  /** File URI */
  fileUri: vscode.Uri;

  /** Migration documentation URLs */
  documentationUrls?: string[];

  /** Additional notes about the migration */
  notes?: string;

  /** Whether migration docs were found */
  hasMigrationDocs: boolean;
}

/**
 * State of a migration in progress
 */
export interface MigrationState {
  /** Unique ID for this migration */
  id: string;

  /** Migration info */
  migration: MigrationInfo;

  /** Current status */
  status: 'pending' | 'showing_diff' | 'accepted' | 'rejected';

  /** Virtual document URI for the diff */
  diffUri?: vscode.Uri;
}

/**
 * Result of searching for migration documentation
 */
export interface MigrationDocSearchResult {
  /** Whether documentation was found */
  found: boolean;

  /** Documentation URLs */
  urls: string[];

  /** Extracted migration steps or guide content */
  content: string;
}
