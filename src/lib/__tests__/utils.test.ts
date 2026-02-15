import { describe, it, expect } from "vitest";
import { toJsonValue } from "@/lib/utils";

describe("toJsonValue", () => {
  it("returns a plain object from a typed object", () => {
    const input = { foo: "bar", count: 42 };
    const result = toJsonValue(input);
    expect(result).toEqual({ foo: "bar", count: 42 });
  });

  it("deep clones nested objects (no shared references)", () => {
    const inner = { a: 1 };
    const input = { nested: inner };
    const result = toJsonValue(input) as Record<string, unknown>;
    expect(result).toEqual({ nested: { a: 1 } });
    // Mutating original should not affect clone
    inner.a = 999;
    expect((result.nested as Record<string, unknown>).a).toBe(1);
  });

  it("converts Date objects to ISO strings", () => {
    const date = new Date("2025-01-15T10:30:00Z");
    const result = toJsonValue({ createdAt: date }) as Record<string, unknown>;
    expect(result.createdAt).toBe("2025-01-15T10:30:00.000Z");
  });

  it("drops undefined values", () => {
    const input = { a: 1, b: undefined, c: "hello" };
    const result = toJsonValue(input) as Record<string, unknown>;
    expect(result).toEqual({ a: 1, c: "hello" });
    expect("b" in result).toBe(false);
  });

  it("handles arrays", () => {
    const input = [1, "two", { three: 3 }];
    const result = toJsonValue(input);
    expect(result).toEqual([1, "two", { three: 3 }]);
  });

  it("handles null", () => {
    expect(toJsonValue(null)).toBeNull();
  });

  it("handles primitive values", () => {
    expect(toJsonValue(42)).toBe(42);
    expect(toJsonValue("hello")).toBe("hello");
    expect(toJsonValue(true)).toBe(true);
  });

  it("handles deeply nested structures", () => {
    const input = {
      level1: {
        level2: {
          level3: {
            value: "deep",
            items: [1, 2, { nested: true }],
          },
        },
      },
    };
    const result = toJsonValue(input);
    expect(result).toEqual(input);
  });

  it("strips class instances to plain objects", () => {
    class Custom {
      value = 42;
      method() {
        return this.value;
      }
    }
    const result = toJsonValue(new Custom()) as Record<string, unknown>;
    expect(result).toEqual({ value: 42 });
    expect(result).not.toHaveProperty("method");
  });
});
