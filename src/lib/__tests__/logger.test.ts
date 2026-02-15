import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Undo the global @/lib/logger mock from setup.ts so we test the real module
vi.unmock("@/lib/logger");

// ---------------------------------------------------------------------------
// Mock pino before importing the module under test
// ---------------------------------------------------------------------------
const mockChild = vi.fn();
const mockInfo = vi.fn();
const mockWarn = vi.fn();
const mockError = vi.fn();
const mockDebug = vi.fn();
const mockFatal = vi.fn();

const mockPinoInstance = {
  info: mockInfo,
  warn: mockWarn,
  error: mockError,
  debug: mockDebug,
  fatal: mockFatal,
  child: mockChild.mockReturnValue({
    info: mockInfo,
    warn: mockWarn,
    error: mockError,
    debug: mockDebug,
    fatal: mockFatal,
    child: mockChild,
  }),
};

vi.mock("pino", () => ({
  default: vi.fn(() => mockPinoInstance),
}));

import { logger, createLogger, resetLogger } from "@/lib/logger";

// ---------------------------------------------------------------------------
describe("logger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetLogger();
  });

  afterEach(() => {
    delete process.env.LOG_LEVEL;
  });

  it("exports a root pino logger instance", () => {
    expect(logger).toBeDefined();
    expect(logger.info).toBeDefined();
    expect(logger.warn).toBeDefined();
    expect(logger.error).toBeDefined();
    expect(logger.debug).toBeDefined();
  });

  it("supports standard log levels", () => {
    logger.info("test info");
    logger.warn("test warn");
    logger.error("test error");
    logger.debug("test debug");

    expect(mockInfo).toHaveBeenCalledWith("test info");
    expect(mockWarn).toHaveBeenCalledWith("test warn");
    expect(mockError).toHaveBeenCalledWith("test error");
    expect(mockDebug).toHaveBeenCalledWith("test debug");
  });

  it("supports structured data objects", () => {
    logger.info({ submissionId: "sub-123", tenantId: "t-001" }, "processing submission");
    expect(mockInfo).toHaveBeenCalledWith(
      { submissionId: "sub-123", tenantId: "t-001" },
      "processing submission",
    );
  });

  it("supports error objects", () => {
    const err = new Error("DB timeout");
    logger.error({ err }, "pipeline failed");
    expect(mockError).toHaveBeenCalledWith({ err }, "pipeline failed");
  });
});

// ---------------------------------------------------------------------------
describe("createLogger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetLogger();
  });

  it("creates a child logger with the given module name", () => {
    const child = createLogger("pipeline");

    expect(mockChild).toHaveBeenCalledWith({ module: "pipeline" });
    expect(child).toBeDefined();
    expect(child.info).toBeDefined();
  });

  it("creates a child logger with additional context", () => {
    createLogger("worker", { submissionId: "sub-456" });

    expect(mockChild).toHaveBeenCalledWith({
      module: "worker",
      submissionId: "sub-456",
    });
  });

  it("each call creates a separate child logger", () => {
    createLogger("pipeline");
    createLogger("cache");

    expect(mockChild).toHaveBeenCalledTimes(2);
    expect(mockChild).toHaveBeenNthCalledWith(1, { module: "pipeline" });
    expect(mockChild).toHaveBeenNthCalledWith(2, { module: "cache" });
  });
});
