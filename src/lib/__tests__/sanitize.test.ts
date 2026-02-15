import { describe, it, expect } from "vitest";

import { sanitizeHtml, sanitizeObject } from "@/lib/sanitize";

describe("sanitizeHtml", () => {
  it("strips <script> tags and their content", () => {
    const input = 'Hello<script>alert("xss")</script>World';
    const result = sanitizeHtml(input);

    expect(result).not.toContain("<script>");
    expect(result).not.toContain("</script>");
    expect(result).not.toContain("alert");
    expect(result).toContain("Hello");
    expect(result).toContain("World");
  });

  it("strips <img onerror> tags", () => {
    const input = 'Before<img src="x" onerror="alert(1)">After';
    const result = sanitizeHtml(input);

    expect(result).not.toContain("<img");
    expect(result).not.toContain("onerror");
    expect(result).toContain("Before");
    expect(result).toContain("After");
  });

  it('strips <a href="javascript:"> tags', () => {
    const input = '<a href="javascript:alert(1)">Click me</a>';
    const result = sanitizeHtml(input);

    expect(result).not.toContain("<a");
    expect(result).not.toContain("javascript:");
    expect(result).toContain("Click me");
  });

  it("handles empty strings", () => {
    expect(sanitizeHtml("")).toBe("");
  });

  it("preserves plain text without HTML", () => {
    const input = "Hello, this is a normal string";
    expect(sanitizeHtml(input)).toBe("Hello, this is a normal string");
  });

  it("escapes & character", () => {
    const result = sanitizeHtml("Tom & Jerry");
    expect(result).toContain("&amp;");
    expect(result).not.toContain("Tom & Jerry");
  });

  it("escapes < character", () => {
    // After tag stripping, lone < should be escaped
    const result = sanitizeHtml("5 < 10");
    expect(result).toContain("&lt;");
  });

  it("escapes > character", () => {
    const result = sanitizeHtml("10 > 5");
    expect(result).toContain("&gt;");
  });

  it('escapes " character', () => {
    const result = sanitizeHtml('He said "hello"');
    expect(result).toContain("&quot;");
  });

  it("escapes ' character", () => {
    const result = sanitizeHtml("It's fine");
    expect(result).toContain("&#x27;");
  });

  it("strips nested/malformed tags", () => {
    const input = "<<script>script>alert(1)<</script>/script>";
    const result = sanitizeHtml(input);

    expect(result).not.toContain("<script>");
    expect(result).not.toContain("</script>");
  });

  it("strips style tags and their content", () => {
    const input = "Hello<style>body{display:none}</style>World";
    const result = sanitizeHtml(input);

    expect(result).not.toContain("<style>");
    expect(result).not.toContain("display:none");
  });
});

describe("sanitizeObject", () => {
  it("sanitizes string properties in a flat object", () => {
    const input = {
      name: '<script>alert("xss")</script>John',
      email: "john@example.com",
    };
    const result = sanitizeObject(input);

    expect(result.name).not.toContain("<script>");
    expect(result.name).toContain("John");
    expect(result.email).toBe("john@example.com");
  });

  it("handles nested objects", () => {
    const input = {
      user: {
        name: '<img onerror="alert(1)">Alice',
        profile: {
          bio: '<a href="javascript:void(0)">Link</a>',
        },
      },
    };
    const result = sanitizeObject(input);

    expect(result.user.name).not.toContain("<img");
    expect(result.user.name).toContain("Alice");
    expect(result.user.profile.bio).not.toContain("<a");
    expect(result.user.profile.bio).toContain("Link");
  });

  it("handles arrays of strings", () => {
    const input = {
      tags: ["<script>xss</script>safe", "normal", "<b>bold</b>"],
    };
    const result = sanitizeObject(input);

    expect(result.tags[0]).not.toContain("<script>");
    expect(result.tags[0]).toContain("safe");
    expect(result.tags[1]).toBe("normal");
    expect(result.tags[2]).not.toContain("<b>");
    expect(result.tags[2]).toContain("bold");
  });

  it("preserves non-string values (numbers, booleans, null)", () => {
    const input = {
      count: 42,
      active: true,
      deleted: false,
      metadata: null,
    };
    const result = sanitizeObject(input);

    expect(result.count).toBe(42);
    expect(result.active).toBe(true);
    expect(result.deleted).toBe(false);
    expect(result.metadata).toBeNull();
  });

  it("handles arrays with mixed types", () => {
    const input = {
      items: ["<b>text</b>", 123, true, null],
    };
    const result = sanitizeObject(input);

    expect(result.items[0]).not.toContain("<b>");
    expect(result.items[1]).toBe(123);
    expect(result.items[2]).toBe(true);
    expect(result.items[3]).toBeNull();
  });

  it("returns primitive values unchanged", () => {
    expect(sanitizeObject(42 as unknown as Record<string, unknown>)).toBe(42);
    expect(sanitizeObject(true as unknown as Record<string, unknown>)).toBe(
      true
    );
    expect(sanitizeObject(null as unknown as Record<string, unknown>)).toBeNull();
  });

  it("sanitizes a string passed directly", () => {
    const result = sanitizeObject("<script>xss</script>hello" as unknown as Record<string, unknown>);
    expect(result).not.toContain("<script>");
  });
});
