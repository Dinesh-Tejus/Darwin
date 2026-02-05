import * as vscode from 'vscode';
import { ImportInfo, UsageInfo, UsageLocation, UsageTrackingResult } from '../models/index.js';

/**
 * Tracks where Python imports are used in code
 */
export class PythonUsageTracker {
  private document: vscode.TextDocument;

  constructor(document: vscode.TextDocument) {
    this.document = document;
  }

  /**
   * Track all usages of the given imports in the document
   */
  trackUsages(imports: ImportInfo[]): UsageTrackingResult {
    const usages: UsageInfo[] = [];
    let totalUsageCount = 0;

    for (const importInfo of imports) {
      const usageLocations = this.findUsagesForImport(importInfo);
      if (usageLocations.length > 0) {
        usages.push({
          importInfo,
          usageLocations,
        });
        totalUsageCount += usageLocations.length;
      }
    }

    return { usages, totalUsageCount };
  }

  /**
   * Find all usages of a specific import
   */
  private findUsagesForImport(importInfo: ImportInfo): UsageLocation[] {
    const locations: UsageLocation[] = [];
    const text = this.document.getText();

    // Get identifiers to search for
    const identifiers = this.getIdentifiersFromImport(importInfo);

    for (const identifier of identifiers) {
      const foundLocations = this.findIdentifierUsages(identifier, text, importInfo);
      locations.push(...foundLocations);
    }

    return locations;
  }

  /**
   * Extract identifiers to track from an import
   * For 'import requests' -> ['requests']
   * For 'from flask import Flask, render_template' -> ['Flask', 'render_template']
   * For 'import numpy as np' -> ['np']
   */
  private getIdentifiersFromImport(importInfo: ImportInfo): string[] {
    const identifiers: string[] = [];

    // Check for alias in the import statement
    const aliasMatch = importInfo.importStatement.match(
      /import\s+[\w.]+\s+as\s+(\w+)/
    );

    if (aliasMatch) {
      // If there's an alias like 'import numpy as np', track the alias
      identifiers.push(aliasMatch[1]);
    } else if (importInfo.namedImports && importInfo.namedImports.length > 0) {
      // For 'from x import y, z' style - track named imports
      // Also check for aliases in named imports: 'from x import y as z'
      for (const namedImport of importInfo.namedImports) {
        // Check for alias in named import
        const namedAliasMatch = importInfo.importStatement.match(
          new RegExp(`\\b${this.escapeRegex(namedImport)}\\s+as\\s+(\\w+)`)
        );
        if (namedAliasMatch) {
          identifiers.push(namedAliasMatch[1]);
        } else {
          identifiers.push(namedImport);
        }
      }
    } else {
      // For simple 'import package' style
      // Use the last part of dotted imports (e.g., 'google.generativeai' -> 'generativeai')
      const parts = importInfo.packageName.split('.');
      identifiers.push(parts[parts.length - 1]);
    }

    return identifiers;
  }

  /**
   * Find all usages of an identifier in the text
   */
  private findIdentifierUsages(
    identifier: string,
    text: string,
    importInfo: ImportInfo
  ): UsageLocation[] {
    const locations: UsageLocation[] = [];

    // Skip if identifier is empty
    if (!identifier || identifier.length === 0) {
      return locations;
    }

    // Pattern to match the identifier as a word boundary
    // Matches: identifier.something, identifier(, identifier[, identifier in expressions
    // But not: _identifier, identifier_suffix, otheridentifier
    const pattern = new RegExp(
      `(?<!\\w)${this.escapeRegex(identifier)}(?=\\s*[.([\\s,)\\]:}=+\\-*/<>!&|^%@])`,
      'g'
    );

    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const startPos = this.document.positionAt(match.index);
      const endPos = this.document.positionAt(match.index + identifier.length);
      const range = new vscode.Range(startPos, endPos);

      // Skip if this is within the import statement itself
      if (this.isWithinImportStatement(range, importInfo)) {
        continue;
      }

      // Skip if this is within a comment or string
      if (this.isWithinCommentOrString(match.index, text)) {
        continue;
      }

      const usageType = this.determineUsageType(text, match.index + identifier.length);

      locations.push({
        range,
        identifier,
        usageType,
      });
    }

    return locations;
  }

  /**
   * Check if a range is within the import statement
   */
  private isWithinImportStatement(range: vscode.Range, importInfo: ImportInfo): boolean {
    return importInfo.range.contains(range);
  }

  /**
   * Check if position is within a comment or string
   */
  private isWithinCommentOrString(position: number, text: string): boolean {
    const lineStart = text.lastIndexOf('\n', position - 1) + 1;
    const lineEnd = text.indexOf('\n', position);
    const line = text.substring(lineStart, lineEnd === -1 ? text.length : lineEnd);
    const posInLine = position - lineStart;

    // Check for comment
    const commentStart = line.indexOf('#');
    if (commentStart !== -1 && posInLine > commentStart) {
      return true;
    }

    // Check for strings (simplified - doesn't handle all edge cases)
    const beforePos = line.substring(0, posInLine);
    const singleQuotes = (beforePos.match(/'/g) || []).length;
    const doubleQuotes = (beforePos.match(/"/g) || []).length;
    const tripleDoubleQuotes = (beforePos.match(/"""/g) || []).length;
    const tripleSingleQuotes = (beforePos.match(/'''/g) || []).length;

    // If odd number of quotes, we're inside a string
    if ((singleQuotes - tripleSingleQuotes * 3) % 2 !== 0) {
      return true;
    }
    if ((doubleQuotes - tripleDoubleQuotes * 3) % 2 !== 0) {
      return true;
    }

    return false;
  }

  /**
   * Determine the type of usage based on context
   */
  private determineUsageType(
    text: string,
    posAfterIdentifier: number
  ): UsageLocation['usageType'] {
    const nextChars = text.substring(posAfterIdentifier, posAfterIdentifier + 10).trim();

    if (nextChars.startsWith('(')) {
      // Check if it's likely a class instantiation (starts with capital letter)
      // by looking at the identifier before the position
      const prevText = text.substring(Math.max(0, posAfterIdentifier - 50), posAfterIdentifier);
      const identifierMatch = prevText.match(/(\w+)\s*$/);
      if (identifierMatch) {
        const name = identifierMatch[1];
        if (name[0] === name[0].toUpperCase() && name[0] !== name[0].toLowerCase()) {
          return 'class_instantiation';
        }
      }
      return 'function_call';
    }

    if (nextChars.startsWith('.')) {
      return 'attribute_access';
    }

    return 'reference';
  }

  /**
   * Escape special regex characters
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

/**
 * Track usages in a Python document
 */
export function trackPythonUsages(
  document: vscode.TextDocument,
  imports: ImportInfo[]
): UsageTrackingResult {
  const tracker = new PythonUsageTracker(document);
  return tracker.trackUsages(imports);
}
