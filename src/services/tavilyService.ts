import { tavily, TavilyClient } from '@tavily/core';
import { getConfig, logInfo, logError, logDebug } from '../utils/index.js';
import { TavilySearchResult } from '../models/index.js';

let tavilyClient: TavilyClient | null = null;

/**
 * Initialize the Tavily client
 */
function getClient(): TavilyClient {
  if (!tavilyClient) {
    const config = getConfig();
    if (!config.tavilyApiKey) {
      throw new Error('Tavily API key not configured');
    }
    tavilyClient = tavily({ apiKey: config.tavilyApiKey });
  }
  return tavilyClient;
}

/**
 * Reset the client (useful when API key changes)
 */
export function resetTavilyClient(): void {
  tavilyClient = null;
}

/**
 * Search for deprecation status of a package
 */
export async function searchDeprecationStatus(
  packageName: string,
  language: string
): Promise<TavilySearchResult[]> {
  const client = getClient();

  // Construct search query
  const languageContext = language === 'python' ? 'Python pip' : 'npm JavaScript';
  const query = `${packageName} ${languageContext} package deprecated OR legacy OR unmaintained OR archived`;

  logInfo(`Searching deprecation status for ${packageName}`);
  logDebug(`Query: ${query}`);

  try {
    const response = await client.search(query, {
      searchDepth: 'basic',
      maxResults: 5,
      includeAnswer: false,
    });

    const results: TavilySearchResult[] = response.results.map((r) => ({
      title: r.title,
      url: r.url,
      content: r.content,
      score: r.score,
    }));

    logDebug(`Found ${results.length} results for ${packageName}`);
    return results;
  } catch (error) {
    logError(`Tavily search failed for ${packageName}`, error as Error);
    throw error;
  }
}

/**
 * Search for migration documentation between two packages
 */
export async function searchMigrationDocs(
  fromPackage: string,
  toPackage: string,
  language: string
): Promise<TavilySearchResult[]> {
  const client = getClient();

  // Construct search query
  const languageContext = language === 'python' ? 'Python' : 'JavaScript TypeScript';
  const query = `${fromPackage} to ${toPackage} migration guide ${languageContext}`;

  logInfo(`Searching migration docs: ${fromPackage} -> ${toPackage}`);
  logDebug(`Query: ${query}`);

  try {
    const response = await client.search(query, {
      searchDepth: 'advanced',
      maxResults: 5,
      includeAnswer: true,
    });

    const results: TavilySearchResult[] = response.results.map((r) => ({
      title: r.title,
      url: r.url,
      content: r.content,
      score: r.score,
    }));

    logDebug(`Found ${results.length} migration docs`);
    return results;
  } catch (error) {
    logError(`Tavily migration search failed`, error as Error);
    throw error;
  }
}

/**
 * Extract relevant content from search results
 */
export function extractSearchContent(results: TavilySearchResult[]): string {
  return results
    .map((r) => `Source: ${r.url}\n${r.content}`)
    .join('\n\n---\n\n');
}
