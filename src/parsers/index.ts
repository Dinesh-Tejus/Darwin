import * as vscode from 'vscode';
import { BaseParser } from './baseParser.js';
import { PythonParser } from './pythonParser.js';
import { JsTsParser } from './jstsParser.js';
import { ParseResult } from '../models/index.js';

export { BaseParser } from './baseParser.js';
export { PythonParser } from './pythonParser.js';
export { JsTsParser } from './jstsParser.js';
export { PythonUsageTracker, trackPythonUsages } from './pythonUsageTracker.js';

/**
 * Get the appropriate parser for a document
 */
export function getParser(document: vscode.TextDocument): BaseParser | null {
  const languageId = document.languageId;

  switch (languageId) {
    case 'python':
      return new PythonParser(document);
    case 'javascript':
    case 'typescript':
    case 'javascriptreact':
    case 'typescriptreact':
      return new JsTsParser(document);
    default:
      return null;
  }
}

/**
 * Parse imports from a document
 */
export function parseImports(document: vscode.TextDocument): ParseResult {
  const parser = getParser(document);

  if (!parser) {
    return {
      imports: [],
      errors: [`Unsupported language: ${document.languageId}`],
    };
  }

  return parser.parse();
}

/**
 * Check if a document's language is supported
 */
export function isSupportedLanguage(document: vscode.TextDocument): boolean {
  const supportedLanguages = [
    'python',
    'javascript',
    'typescript',
    'javascriptreact',
    'typescriptreact',
  ];
  return supportedLanguages.includes(document.languageId);
}
