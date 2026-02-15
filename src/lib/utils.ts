/**
 * A JSON-serializable value compatible with Prisma's InputJsonValue.
 */
export type JsonValue =
  | string
  | number
  | boolean
  | JsonValue[]
  | { [key: string]: JsonValue | null };

/**
 * Convert a typed object to a plain JSON-serializable value.
 * Suitable for Prisma Json columns (InputJsonValue).
 *
 * Equivalent to JSON.parse(JSON.stringify(value)) but
 * centralised for consistency and easy replacement.
 */
export function toJsonValue<T>(value: T): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue;
}
