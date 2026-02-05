import * as vscode from 'vscode';
import { getPackageNameFromDiagnostic, getDeprecationData } from './diagnosticsProvider.js';
import { addToIgnoreList, logInfo, meetsConfidenceThreshold, getCustomReplacement } from '../utils/index.js';

export const SHOW_MIGRATION_COMMAND = 'darwin.showMigration';
export const IGNORE_PACKAGE_COMMAND = 'darwin.ignorePackage';
export const MIGRATE_PACKAGE_COMMAND = 'darwin.migratePackage';

/**
 * Code action provider for Darwin diagnostics
 */
export class DarwinCodeActionProvider implements vscode.CodeActionProvider {
  public static readonly providedCodeActionKinds = [
    vscode.CodeActionKind.QuickFix,
  ];

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];

    // Filter for Darwin diagnostics
    const darwinDiagnostics = context.diagnostics.filter(
      (d) => d.source === 'Darwin'
    );

    for (const diagnostic of darwinDiagnostics) {
      const packageName = getPackageNameFromDiagnostic(diagnostic);
      if (!packageName) {
        continue;
      }

      const deprecationInfo = getDeprecationData(packageName);

      // Check for custom replacement first
      const customReplacement = getCustomReplacement(packageName);
      const replacement = customReplacement || deprecationInfo?.replacement;
      const hasHighConfidence = deprecationInfo && meetsConfidenceThreshold(deprecationInfo.confidence);

      // Add migration actions if replacement is available
      if (replacement) {
        // Quick migrate action - only as preferred if high confidence or custom
        const quickMigrateAction = this.createQuickMigrateAction(
          packageName,
          replacement,
          diagnostic,
          hasHighConfidence || !!customReplacement
        );
        actions.push(quickMigrateAction);

        // Show migration diff action
        const showMigrateAction = this.createMigrateAction(
          packageName,
          replacement,
          document,
          diagnostic
        );
        actions.push(showMigrateAction);

        // Add confidence warning if low confidence
        if (!hasHighConfidence && !customReplacement) {
          const confidencePercent = Math.round((deprecationInfo?.confidence || 0) * 100);
          showMigrateAction.diagnostics = [diagnostic];
        }
      }

      // Add "Ignore Package" action
      const ignoreAction = this.createIgnoreAction(packageName, diagnostic);
      actions.push(ignoreAction);
    }

    return actions;
  }

  private createQuickMigrateAction(
    packageName: string,
    replacement: string,
    diagnostic: vscode.Diagnostic,
    isPreferred: boolean
  ): vscode.CodeAction {
    const action = new vscode.CodeAction(
      `Migrate: ${packageName} → ${replacement}`,
      vscode.CodeActionKind.QuickFix
    );

    action.command = {
      title: 'Migrate Package',
      command: MIGRATE_PACKAGE_COMMAND,
      arguments: [{ packageName }],
    };

    action.diagnostics = [diagnostic];
    action.isPreferred = isPreferred;

    return action;
  }

  private createMigrateAction(
    packageName: string,
    replacement: string,
    document: vscode.TextDocument,
    diagnostic: vscode.Diagnostic
  ): vscode.CodeAction {
    const action = new vscode.CodeAction(
      `Show migration diff: ${packageName} → ${replacement}`,
      vscode.CodeActionKind.QuickFix
    );

    action.command = {
      title: 'Show Migration',
      command: SHOW_MIGRATION_COMMAND,
      arguments: [document.uri, packageName, replacement, diagnostic.range],
    };

    action.diagnostics = [diagnostic];

    return action;
  }

  private createIgnoreAction(
    packageName: string,
    diagnostic: vscode.Diagnostic
  ): vscode.CodeAction {
    const action = new vscode.CodeAction(
      `Ignore "${packageName}" in future scans`,
      vscode.CodeActionKind.QuickFix
    );

    action.command = {
      title: 'Ignore Package',
      command: IGNORE_PACKAGE_COMMAND,
      arguments: [packageName],
    };

    action.diagnostics = [diagnostic];

    return action;
  }
}

/**
 * Register the code action provider
 */
export function registerCodeActionProvider(
  context: vscode.ExtensionContext
): vscode.Disposable {
  const provider = vscode.languages.registerCodeActionsProvider(
    [
      { language: 'python' },
      { language: 'javascript' },
      { language: 'typescript' },
      { language: 'javascriptreact' },
      { language: 'typescriptreact' },
    ],
    new DarwinCodeActionProvider(),
    {
      providedCodeActionKinds: DarwinCodeActionProvider.providedCodeActionKinds,
    }
  );

  context.subscriptions.push(provider);
  return provider;
}

/**
 * Handle the ignore package command
 */
export async function handleIgnorePackage(packageName: string): Promise<void> {
  await addToIgnoreList(packageName);
  logInfo(`Added ${packageName} to ignore list`);
  vscode.window.showInformationMessage(
    `Darwin: "${packageName}" will be ignored in future scans.`
  );
}
