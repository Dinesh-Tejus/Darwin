import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import { getConfig, logInfo, logError, logDebug, logWarning } from '../utils/index.js';
import { GeminiDeprecationAnalysis, TavilySearchResult } from '../models/index.js';

let genAI: GoogleGenerativeAI | null = null;

/**
 * Initialize the Gemini client
 */
function getClient(): GoogleGenerativeAI {
  if (!genAI) {
    const config = getConfig();
    if (!config.geminiApiKey) {
      throw new Error('Gemini API key not configured');
    }
    genAI = new GoogleGenerativeAI(config.geminiApiKey);
  }
  return genAI;
}

/**
 * Get the generative model
 */
function getModel(): GenerativeModel {
  const client = getClient();
  const config = getConfig();
  return client.getGenerativeModel({ model: config.geminiModel });
}

/**
 * Reset the client (useful when API key changes)
 */
export function resetGeminiClient(): void {
  genAI = null;
}

/**
 * Analyze deprecation status using Gemini
 */
export async function analyzeDeprecationStatus(
  packageName: string,
  language: string,
  searchResults: TavilySearchResult[]
): Promise<GeminiDeprecationAnalysis> {
  const model = getModel();

  const searchContent = searchResults
    .map((r) => `Source: ${r.url}\nTitle: ${r.title}\nContent: ${r.content}`)
    .join('\n\n---\n\n');

  const prompt = `Analyze whether the ${language} package "${packageName}" is deprecated, unmaintained, or legacy based on the following search results.

Search Results:
${searchContent}

Please analyze and respond with a JSON object containing:
- isDeprecated: boolean - true if the package is clearly deprecated, unmaintained, or legacy
- reason: string - brief explanation of why it's deprecated (or why it's not)
- replacement: string or null - recommended replacement package if one exists
- confidence: number between 0 and 1 - how confident you are in this assessment

Only mark a package as deprecated if there is clear evidence. Being old or having fewer updates is NOT enough - look for explicit deprecation notices, archived repositories, or official recommendations to use alternatives.

Respond ONLY with the JSON object, no additional text.`;

  logInfo(`Analyzing deprecation status for ${packageName} with Gemini`);
  const config = getConfig();
  logDebug(`Using model: ${config.geminiModel}`);

  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text().trim();

    // Extract JSON from response (handle markdown code blocks)
    let jsonStr = text;
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    const analysis = JSON.parse(jsonStr) as GeminiDeprecationAnalysis;
    logDebug(`Analysis result: ${JSON.stringify(analysis)}`);

    return analysis;
  } catch (error) {
    logError(`Gemini analysis failed for ${packageName}`, error as Error);
    // Return a safe default on error
    return {
      isDeprecated: false,
      reason: 'Unable to determine deprecation status',
      replacement: null,
      confidence: 0,
    };
  }
}

/**
 * Generate migrated code using Gemini
 */
export async function generateMigratedCode(
  originalCode: string,
  fromPackage: string,
  toPackage: string,
  language: string,
  migrationDocs: string
): Promise<{ migratedCode: string; notes: string }> {
  const model = getModel();

  const prompt = `You are a code migration expert. Migrate the following ENTIRE ${language} file from using "${fromPackage}" to "${toPackage}".

IMPORTANT: You must migrate ALL occurrences in the file:
1. Update the import statement(s)
2. Update ALL usages of the package throughout the code (function calls, method calls, class instantiations, attribute access, etc.)
3. Update any type hints or annotations if applicable

Original Code:
\`\`\`${language}
${originalCode}
\`\`\`

Migration Documentation:
${migrationDocs}

Please provide:
1. The COMPLETE migrated file that uses ${toPackage} instead of ${fromPackage}
2. Brief notes about all the changes made

Respond with a JSON object:
{
  "migratedCode": "the COMPLETE migrated file content",
  "notes": "brief notes about what changed (imports, function calls, etc.)"
}

Important:
- Return the ENTIRE file content, not just the changed parts
- Migrate ALL usages of ${fromPackage}, not just the import
- Maintain the same functionality
- Keep the same code style, formatting, and indentation
- Only change what's necessary for the migration
- If APIs differ between packages, use the equivalent ${toPackage} API
- If you're unsure about a specific migration, add a comment like # TODO: verify this migration

Respond ONLY with the JSON object, no additional text.`;

  logInfo(`Generating migrated code: ${fromPackage} -> ${toPackage}`);

  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text().trim();

    // Extract JSON from response - handle multiple formats
    let jsonStr = text;

    // Try to find JSON in code blocks first
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    // Try to find JSON object directly
    if (!jsonStr.startsWith('{')) {
      const objectMatch = text.match(/\{[\s\S]*"migratedCode"[\s\S]*\}/);
      if (objectMatch) {
        jsonStr = objectMatch[0];
      }
    }

    // Parse JSON
    let migrationResult: { migratedCode: string; notes: string };
    try {
      migrationResult = JSON.parse(jsonStr);
    } catch (parseError) {
      // If JSON parsing fails, try to extract code directly
      logWarning(`JSON parsing failed, attempting to extract code directly`);

      // Look for code blocks in the response
      const codeMatch = text.match(/```(?:python|javascript|typescript)?\s*([\s\S]*?)```/);
      if (codeMatch) {
        migrationResult = {
          migratedCode: codeMatch[1].trim(),
          notes: 'Code extracted from response (JSON parsing failed)',
        };
      } else {
        throw parseError;
      }
    }

    // Clean up the migrated code - remove any escaped newlines
    if (migrationResult.migratedCode) {
      migrationResult.migratedCode = migrationResult.migratedCode
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t')
        .replace(/\\"/g, '"');
    }

    return migrationResult;
  } catch (error) {
    logError(`Gemini code generation failed`, error as Error);
    throw new Error(`Failed to generate migrated code: ${(error as Error).message}`);
  }
}
