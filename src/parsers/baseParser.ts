import * as vscode from 'vscode';
import { ImportInfo, ParseResult } from '../models/index.js';

/**
 * Base class for import parsers
 */
export abstract class BaseParser {
  protected document: vscode.TextDocument;

  constructor(document: vscode.TextDocument) {
    this.document = document;
  }

  /**
   * Parse imports from the document
   */
  abstract parse(): ParseResult;

  /**
   * Get the language identifier
   */
  abstract getLanguage(): 'python' | 'javascript' | 'typescript';

  /**
   * Check if a package name is a relative import
   */
  protected isRelativeImport(packageName: string): boolean {
    return packageName.startsWith('.') || packageName.startsWith('/');
  }

  /**
   * Extract the top-level package name from an import path
   * e.g., '@angular/core' -> '@angular/core', 'lodash/map' -> 'lodash'
   */
  protected getTopLevelPackage(importPath: string): string {
    // Handle scoped packages (@org/package)
    if (importPath.startsWith('@')) {
      const parts = importPath.split('/');
      if (parts.length >= 2) {
        return `${parts[0]}/${parts[1]}`;
      }
      return importPath;
    }

    // Regular packages - take the first part before any /
    const slashIndex = importPath.indexOf('/');
    if (slashIndex > 0) {
      return importPath.substring(0, slashIndex);
    }

    return importPath;
  }

  /**
   * Create a Range from line and character positions
   */
  protected createRange(
    startLine: number,
    startChar: number,
    endLine: number,
    endChar: number
  ): vscode.Range {
    return new vscode.Range(
      new vscode.Position(startLine, startChar),
      new vscode.Position(endLine, endChar)
    );
  }

  /**
   * Find the range of a match in the document
   */
  protected findMatchRange(match: RegExpExecArray, lineNumber: number): vscode.Range {
    const line = this.document.lineAt(lineNumber);
    const startChar = match.index;
    const endChar = match.index + match[0].length;
    return this.createRange(lineNumber, startChar, lineNumber, endChar);
  }
}
