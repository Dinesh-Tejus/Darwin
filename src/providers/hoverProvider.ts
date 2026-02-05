import * as vscode from 'vscode';
import { getStoredUsages } from './decorationProvider.js';
import { getDeprecationData } from './diagnosticsProvider.js';
import { logInfo } from '../utils/index.js';

/**
 * Hover provider for deprecated packages
 * Shows detailed deprecation info when hovering over deprecated code
 */
export class DarwinHoverProvider implements vscode.HoverProvider {
  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.Hover> {
    // Get stored usages for this document
    const usages = getStoredUsages(document.uri);
    if (!usages || usages.length === 0) {
      return null;
    }

    // Check if position is within any deprecated import or usage
    for (const usage of usages) {
      // Check import range
      if (usage.importInfo.range.contains(position)) {
        return this.createHover(usage.importInfo.packageName, document.uri);
      }

      // Check usage locations
      for (const location of usage.usageLocations) {
        if (location.range.contains(position)) {
          return this.createHover(usage.importInfo.packageName, document.uri);
        }
      }
    }

    return null;
  }

  /**
   * Create a rich hover with deprecation information
   */
  private createHover(
    packageName: string,
    documentUri: vscode.Uri
  ): vscode.Hover | null {
    const deprecationInfo = getDeprecationData(packageName);
    if (!deprecationInfo) {
      return null;
    }

    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    md.supportHtml = true;

    // Header
    md.appendMarkdown(`## ⚠️ Deprecated Package\n\n`);
    md.appendMarkdown(`**Package:** \`${packageName}\`\n\n`);

    // Deprecation reason
    if (deprecationInfo.reason) {
      md.appendMarkdown(`**Reason:** ${deprecationInfo.reason}\n\n`);
    }

    // Replacement
    if (deprecationInfo.replacement) {
      md.appendMarkdown(`**Recommended Replacement:** \`${deprecationInfo.replacement}\`\n\n`);
    }

    // Confidence
    if (deprecationInfo.confidence) {
      const confidencePercent = Math.round(deprecationInfo.confidence * 100);
      md.appendMarkdown(`**Confidence:** ${confidencePercent}%\n\n`);
    }

    // Sources
    if (deprecationInfo.sources && deprecationInfo.sources.length > 0) {
      md.appendMarkdown(`---\n\n`);
      md.appendMarkdown(`**Sources:**\n`);
      for (const source of deprecationInfo.sources.slice(0, 3)) {
        md.appendMarkdown(`- [${this.getDomainFromUrl(source)}](${source})\n`);
      }
      md.appendMarkdown(`\n`);
    }

    // Action buttons
    md.appendMarkdown(`---\n\n`);

    if (deprecationInfo.replacement) {
      // Migrate action
      const migrateArgs = encodeURIComponent(
        JSON.stringify({
          packageName,
          uri: documentUri.toString(),
        })
      );
      md.appendMarkdown(
        `[$(play) Migrate to ${deprecationInfo.replacement}](command:darwin.migratePackage?${migrateArgs}) | `
      );
    }

    // Ignore action
    const ignoreArgs = encodeURIComponent(JSON.stringify(packageName));
    md.appendMarkdown(
      `[$(x) Ignore this package](command:darwin.ignorePackage?${ignoreArgs})`
    );

    return new vscode.Hover(md);
  }

  /**
   * Extract domain from URL for display
   */
  private getDomainFromUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.replace('www.', '');
    } catch {
      return url;
    }
  }
}

/**
 * Register the hover provider
 */
export function registerHoverProvider(
  context: vscode.ExtensionContext
): vscode.Disposable {
  const provider = vscode.languages.registerHoverProvider(
    [
      { language: 'python' },
      { language: 'javascript' },
      { language: 'typescript' },
      { language: 'javascriptreact' },
      { language: 'typescriptreact' },
    ],
    new DarwinHoverProvider()
  );

  context.subscriptions.push(provider);
  logInfo('Hover provider registered');
  return provider;
}
