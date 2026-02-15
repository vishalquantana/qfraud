/**
 * Input sanitization utilities.
 *
 * Strips HTML tags and escapes dangerous characters to prevent XSS attacks
 * when user-provided data is rendered or stored.
 */

/**
 * Strip HTML tags from a string and escape dangerous characters.
 *
 * 1. Remove content inside `<script>` and `<style>` blocks (including the tags).
 * 2. Remove all remaining HTML tags.
 * 3. Escape `&`, `<`, `>`, `"`, `'` to their HTML entity equivalents.
 */
export function sanitizeHtml(input: string): string {
  if (input === "") return "";

  let result = input;

  // Remove <script>...</script> blocks (case-insensitive, including nested)
  result = result.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");

  // Remove <style>...</style> blocks
  result = result.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "");

  // Remove all remaining HTML tags (self-closing and paired)
  result = result.replace(/<[^>]*>/g, "");

  // Escape special HTML characters
  result = result
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");

  return result;
}

/**
 * Recursively sanitize all string values in an object or array.
 *
 * - Strings are passed through `sanitizeHtml`.
 * - Arrays are iterated element-by-element.
 * - Plain objects have each value sanitized recursively.
 * - Primitives (number, boolean, null, undefined) are returned unchanged.
 */
export function sanitizeObject<T>(obj: T): T {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === "string") {
    return sanitizeHtml(obj) as unknown as T;
  }

  if (typeof obj !== "object") {
    // number, boolean, etc.
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeObject(item)) as unknown as T;
  }

  // Plain object — recurse into each key
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    sanitized[key] = sanitizeObject(value);
  }
  return sanitized as T;
}
