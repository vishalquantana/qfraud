/**
 * Convert a typed object to a plain JSON-serializable value.
 * Suitable for Prisma Json columns (InputJsonValue).
 *
 * Equivalent to JSON.parse(JSON.stringify(value)) but
 * centralised for consistency and easy replacement.
 */
export function toJsonValue<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value));
}
