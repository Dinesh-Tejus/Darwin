import * as vscode from 'vscode';

let outputChannel: vscode.OutputChannel | undefined;

/**
 * Initialize the output channel for logging
 */
export function initLogger(): vscode.OutputChannel {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel('Darwin');
  }
  return outputChannel;
}

/**
 * Get the logger output channel
 */
export function getLogger(): vscode.OutputChannel {
  if (!outputChannel) {
    return initLogger();
  }
  return outputChannel;
}

/**
 * Log an info message
 */
export function logInfo(message: string): void {
  const logger = getLogger();
  const timestamp = new Date().toISOString();
  logger.appendLine(`[${timestamp}] INFO: ${message}`);
}

/**
 * Log a warning message
 */
export function logWarning(message: string): void {
  const logger = getLogger();
  const timestamp = new Date().toISOString();
  logger.appendLine(`[${timestamp}] WARN: ${message}`);
}

/**
 * Log an error message
 */
export function logError(message: string, error?: Error): void {
  const logger = getLogger();
  const timestamp = new Date().toISOString();
  logger.appendLine(`[${timestamp}] ERROR: ${message}`);
  if (error) {
    logger.appendLine(`  Stack: ${error.stack || error.message}`);
  }
}

/**
 * Log a debug message (only in development)
 */
export function logDebug(message: string): void {
  const logger = getLogger();
  const timestamp = new Date().toISOString();
  logger.appendLine(`[${timestamp}] DEBUG: ${message}`);
}

/**
 * Show the output channel
 */
export function showLog(): void {
  const logger = getLogger();
  logger.show();
}

/**
 * Dispose the output channel
 */
export function disposeLogger(): void {
  if (outputChannel) {
    outputChannel.dispose();
    outputChannel = undefined;
  }
}
