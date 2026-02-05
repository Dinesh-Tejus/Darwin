import * as vscode from 'vscode';
import { UsageInfo, UsageTrackingResult } from '../models/index.js';
import { logInfo } from '../utils/index.js';

// Decoration type for deprecated code (faded/dimmed)
let deprecatedDecorationType: vscode.TextEditorDecorationType | null = null;

// Decoration type for deprecated imports (faded with underline)
let deprecatedImportDecorationType: vscode.TextEditorDecorationType | null = null;

// Store decorations per document
const documentDecorations = new Map<string, UsageInfo[]>();

/**
 * Initialize decoration types
 */
function initDecorationTypes(): void {
  if (!deprecatedDecorationType) {
    deprecatedDecorationType = vscode.window.createTextEditorDecorationType({
      opacity: '0.5',
      fontStyle: 'italic',
    });
  }

  if (!deprecatedImportDecorationType) {
    deprecatedImportDecorationType = vscode.window.createTextEditorDecorationType({
      opacity: '0.5',
      fontStyle: 'italic',
      textDecoration: 'line-through',
    });
  }
}

/**
 * Apply deprecation decorations to an editor
 */
export function applyDeprecationDecorations(
  editor: vscode.TextEditor,
  usages: UsageInfo[]
): void {
  initDecorationTypes();

  if (!deprecatedDecorationType || !deprecatedImportDecorationType) {
    return;
  }

  const importRanges: vscode.DecorationOptions[] = [];
  const usageRanges: vscode.DecorationOptions[] = [];

  for (const usage of usages) {
    // Add import line decoration
    importRanges.push({
      range: usage.importInfo.range,
      hoverMessage: createHoverMessage(usage),
    });

    // Add usage decorations
    for (const location of usage.usageLocations) {
      usageRanges.push({
        range: location.range,
        hoverMessage: createHoverMessage(usage),
      });
    }
  }

  // Apply decorations
  editor.setDecorations(deprecatedImportDecorationType, importRanges);
  editor.setDecorations(deprecatedDecorationType, usageRanges);

  // Store for later (reapplying when editor changes)
  documentDecorations.set(editor.document.uri.toString(), usages);

  logInfo(
    `Applied decorations: ${importRanges.length} imports, ${usageRanges.length} usages`
  );
}

/**
 * Create hover message for decoration
 */
function createHoverMessage(usage: UsageInfo): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.isTrusted = true;

  const packageName = usage.importInfo.packageName;
  const deprecationInfo = usage.deprecationInfo;

  md.appendMarkdown(`**⚠️ Deprecated Package: \`${packageName}\`**\n\n`);

  if (deprecationInfo?.reason) {
    md.appendMarkdown(`${deprecationInfo.reason}\n\n`);
  }

  if (deprecationInfo?.replacement) {
    md.appendMarkdown(`**Replacement:** \`${deprecationInfo.replacement}\`\n\n`);
  }

  // Add quick action link
  const migrateUri = vscode.Uri.parse(
    `command:darwin.migratePackage?${encodeURIComponent(
      JSON.stringify({ packageName })
    )}`
  );
  md.appendMarkdown(`[Migrate to ${deprecationInfo?.replacement || 'replacement'}](${migrateUri})`);

  return md;
}

/**
 * Clear decorations for an editor
 */
export function clearDecorations(editor: vscode.TextEditor): void {
  if (deprecatedDecorationType) {
    editor.setDecorations(deprecatedDecorationType, []);
  }
  if (deprecatedImportDecorationType) {
    editor.setDecorations(deprecatedImportDecorationType, []);
  }
  documentDecorations.delete(editor.document.uri.toString());
}

/**
 * Clear all decorations for a document URI
 */
export function clearDocumentDecorations(uri: vscode.Uri): void {
  documentDecorations.delete(uri.toString());

  // Clear from active editor if it matches
  const editor = vscode.window.activeTextEditor;
  if (editor && editor.document.uri.toString() === uri.toString()) {
    clearDecorations(editor);
  }
}

/**
 * Clear all decorations across all documents
 */
export function clearAllDecorations(): void {
  documentDecorations.clear();

  // Clear from all visible editors
  for (const editor of vscode.window.visibleTextEditors) {
    clearDecorations(editor);
  }
}

/**
 * Reapply decorations for an editor (called when editor becomes active)
 */
export function reapplyDecorations(editor: vscode.TextEditor): void {
  const usages = documentDecorations.get(editor.document.uri.toString());
  if (usages && usages.length > 0) {
    applyDeprecationDecorations(editor, usages);
  }
}

/**
 * Get stored usages for a document
 */
export function getStoredUsages(uri: vscode.Uri): UsageInfo[] | undefined {
  return documentDecorations.get(uri.toString());
}

/**
 * Register decoration provider listeners
 */
export function registerDecorationProvider(
  context: vscode.ExtensionContext
): void {
  initDecorationTypes();

  // Reapply decorations when active editor changes
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) {
        reapplyDecorations(editor);
      }
    })
  );

  // Clear decorations when document is closed
  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((document) => {
      documentDecorations.delete(document.uri.toString());
    })
  );

  // Reapply decorations when visible editors change
  context.subscriptions.push(
    vscode.window.onDidChangeVisibleTextEditors((editors) => {
      for (const editor of editors) {
        reapplyDecorations(editor);
      }
    })
  );

  // Dispose decoration types when extension deactivates
  context.subscriptions.push({
    dispose: () => {
      if (deprecatedDecorationType) {
        deprecatedDecorationType.dispose();
        deprecatedDecorationType = null;
      }
      if (deprecatedImportDecorationType) {
        deprecatedImportDecorationType.dispose();
        deprecatedImportDecorationType = null;
      }
    },
  });

  logInfo('Decoration provider registered');
}
