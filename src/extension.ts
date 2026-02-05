import * as vscode from 'vscode';
import { registerCommands, registerMigratedContentProvider } from './commands/index.js';
import { initCacheService, cleanupExpiredEntries } from './services/cacheService.js';
import { initMigrationHistoryService } from './services/migrationHistoryService.js';
import { initDiagnosticsProvider } from './providers/diagnosticsProvider.js';
import { registerCodeActionProvider } from './providers/codeActionProvider.js';
import { registerMigrationContentProvider, registerInlineCompletionProvider } from './providers/inlineSuggestionProvider.js';
import { registerDecorationProvider } from './providers/decorationProvider.js';
import { registerHoverProvider } from './providers/hoverProvider.js';
import { initLogger, logInfo, disposeLogger } from './utils/logger.js';

/**
 * Extension activation
 */
export function activate(context: vscode.ExtensionContext): void {
  // Initialize logger
  initLogger();
  logInfo('Darwin extension activating...');

  // Initialize services
  initCacheService(context);
  initMigrationHistoryService(context);

  // Initialize providers
  initDiagnosticsProvider(context);
  registerCodeActionProvider(context);
  registerMigrationContentProvider(context);
  registerMigratedContentProvider(context);
  registerDecorationProvider(context);
  registerHoverProvider(context);
  registerInlineCompletionProvider(context);

  // Register commands
  registerCommands(context);

  // Clean up expired cache entries on startup
  cleanupExpiredEntries().catch((err) => {
    logInfo(`Cache cleanup error: ${err.message}`);
  });

  // Listen for configuration changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('darwin')) {
        logInfo('Darwin configuration changed');
        // Could reset API clients here if needed
      }
    })
  );

  logInfo('Darwin extension activated');

  // Show welcome message on first activation
  const hasShownWelcome = context.globalState.get<boolean>('darwin.welcomeShown');
  if (!hasShownWelcome) {
    showWelcomeMessage(context);
  }
}

/**
 * Extension deactivation
 */
export function deactivate(): void {
  logInfo('Darwin extension deactivating...');
  disposeLogger();
}

/**
 * Show welcome message on first activation
 */
async function showWelcomeMessage(context: vscode.ExtensionContext): Promise<void> {
  const configure = await vscode.window.showInformationMessage(
    'Darwin: Welcome! Configure your API keys to start scanning for deprecated packages.',
    'Configure Now',
    'Later'
  );

  if (configure === 'Configure Now') {
    vscode.commands.executeCommand('workbench.action.openSettings', 'darwin');
  }

  await context.globalState.update('darwin.welcomeShown', true);
}
