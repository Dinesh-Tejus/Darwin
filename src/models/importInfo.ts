import * as vscode from 'vscode';

/**
 * Represents an import statement found in a source file
 */
export interface ImportInfo {
  /** The package name (e.g., 'moment', 'requests') */
  packageName: string;

  /** Full import statement text */
  importStatement: string;

  /** Language of the source file */
  language: 'python' | 'javascript' | 'typescript';

  /** Range in the document where the import is located */
  range: vscode.Range;

  /** The file URI where this import was found */
  fileUri: vscode.Uri;

  /** Specific imports from the package (for 'from x import y' style) */
  namedImports?: string[];

  /** Whether this is a default import */
  isDefaultImport?: boolean;

  /** Whether this is a CommonJS require */
  isRequire?: boolean;
}

/**
 * Result of parsing imports from a file
 */
export interface ParseResult {
  /** All imports found in the file */
  imports: ImportInfo[];

  /** Any parsing errors encountered */
  errors: string[];
}
