import {
  GoogleGenerativeAI,
  GoogleGenerativeAIFetchError,
} from "@google/generative-ai";
import { createLogger } from "@/lib/logger";

const log = createLogger("gemini");

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const MODEL = "gemini-2.0-flash";
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;

/** HTTP status codes that are considered transient / retryable. */
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503]);

// ---------------------------------------------------------------------------
// Singleton client
// ---------------------------------------------------------------------------
let genAI: GoogleGenerativeAI | null = null;

function getClient(): GoogleGenerativeAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return null;
  }
  if (!genAI) {
    genAI = new GoogleGenerativeAI(apiKey);
  }
  return genAI;
}

/** Reset the singleton — primarily for testing. */
export function resetGeminiClient(): void {
  genAI = null;
}

// ---------------------------------------------------------------------------
// Retry helper
// ---------------------------------------------------------------------------
function isRetryable(error: unknown): boolean {
  if (
    error instanceof GoogleGenerativeAIFetchError &&
    error.status !== undefined
  ) {
    return RETRYABLE_STATUS_CODES.has(error.status);
  }
  return false;
}

/** Delay function — replaceable for testing via `_setDelay`. */
let delayFn: (ms: number) => Promise<void> = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Override the delay function (for tests). */
export function _setDelay(fn: (ms: number) => Promise<void>): void {
  delayFn = fn;
}

/**
 * Execute `fn` with retry + exponential back-off for transient errors.
 * Non-retryable errors are thrown immediately.
 */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === MAX_RETRIES) {
        throw error;
      }
      // Exponential back-off: 500ms, 1000ms, ...
      await delayFn(BASE_DELAY_MS * Math.pow(2, attempt - 1));
    }
  }
  // Should never reach here, but satisfy TS
  throw lastError;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Send a text-only prompt to Gemini and return the text response.
 * Returns `null` if the API key is missing or if an error occurs.
 */
export async function geminiAnalyze(
  prompt: string,
  context?: string,
): Promise<string | null> {
  const client = getClient();
  if (!client) {
    log.warn("GEMINI_API_KEY is not set — skipping analysis");
    return null;
  }

  try {
    const model = client.getGenerativeModel({ model: MODEL });
    const fullPrompt = context
      ? `${prompt}\n\nContext:\n${context}`
      : prompt;

    const result = await withRetry(() => model.generateContent(fullPrompt));
    return result.response.text();
  } catch (error) {
    log.error({ err: error }, "analysis failed");
    return null;
  }
}

/**
 * Send an image + prompt to Gemini (vision) and return the text response.
 * Returns `null` if the API key is missing or if an error occurs.
 */
export async function geminiAnalyzeWithImage(
  prompt: string,
  imageBuffer: Buffer,
  mimeType: string,
): Promise<string | null> {
  const client = getClient();
  if (!client) {
    log.warn("GEMINI_API_KEY is not set — skipping analysis");
    return null;
  }

  try {
    const model = client.getGenerativeModel({ model: MODEL });

    const result = await withRetry(() =>
      model.generateContent([
        { text: prompt },
        {
          inlineData: {
            mimeType,
            data: imageBuffer.toString("base64"),
          },
        },
      ]),
    );
    return result.response.text();
  } catch (error) {
    log.error({ err: error }, "image analysis failed");
    return null;
  }
}

/**
 * Send a prompt to Gemini and parse the response as JSON into type `T`.
 * Strips markdown code fences (```json ... ```) if present.
 * Returns `null` if the API key is missing, on API error, or on JSON parse failure.
 */
export async function geminiStructuredAnalysis<T>(
  prompt: string,
  context?: string,
): Promise<T | null> {
  const text = await geminiAnalyze(prompt, context);
  if (text === null) {
    return null;
  }

  try {
    // Strip markdown code fences that Gemini sometimes wraps JSON in
    const cleaned = text
      .replace(/^```(?:json)?\s*\n?/i, "")
      .replace(/\n?```\s*$/i, "")
      .trim();

    return JSON.parse(cleaned) as T;
  } catch (error) {
    log.error({ err: error }, "failed to parse structured response");
    return null;
  }
}
