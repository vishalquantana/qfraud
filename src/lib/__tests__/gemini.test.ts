import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock: @google/generative-ai
// ---------------------------------------------------------------------------
const mockGenerateContent = vi.fn();
const mockGetGenerativeModel = vi.fn(() => ({
  generateContent: mockGenerateContent,
}));

vi.mock("@google/generative-ai", () => {
  class MockGoogleGenerativeAI {
    constructor() {
      // intentionally empty
    }
    getGenerativeModel = mockGetGenerativeModel;
  }

  class GoogleGenerativeAIFetchError extends Error {
    status?: number;
    statusText?: string;
    constructor(message: string, status?: number, statusText?: string) {
      super(message);
      this.name = "GoogleGenerativeAIFetchError";
      this.status = status;
      this.statusText = statusText;
    }
  }

  return {
    GoogleGenerativeAI: MockGoogleGenerativeAI,
    GoogleGenerativeAIFetchError,
  };
});

// ---------------------------------------------------------------------------
// Import module under test (after mocks are declared)
// ---------------------------------------------------------------------------
import {
  geminiAnalyze,
  geminiAnalyzeWithImage,
  geminiStructuredAnalysis,
  resetGeminiClient,
  _setDelay,
} from "@/lib/gemini";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a mock GenerateContentResult with the given text */
function mockTextResponse(text: string) {
  return {
    response: {
      text: () => text,
    },
  };
}

import { createLogger } from "@/lib/logger";

const mockLog = (createLogger as ReturnType<typeof vi.fn>).mock.results[0]
  ?.value ?? createLogger("gemini");

const originalEnv = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  // Default: API key is set
  process.env.GEMINI_API_KEY = "test-api-key";
  // Reset the singleton so each test starts fresh
  resetGeminiClient();
  // Eliminate retry delays in tests
  _setDelay(() => Promise.resolve());
});

afterEach(() => {
  process.env = { ...originalEnv };
});

// ---------------------------------------------------------------------------
// geminiAnalyze — text-only prompt
// ---------------------------------------------------------------------------
describe("geminiAnalyze", () => {
  it("sends prompt to Gemini and returns text response", async () => {
    mockGenerateContent.mockResolvedValueOnce(
      mockTextResponse("This claim shows signs of fraud."),
    );

    const result = await geminiAnalyze("Analyze this claim for fraud.");

    expect(mockGetGenerativeModel).toHaveBeenCalledWith({
      model: "gemini-2.0-flash",
    });
    expect(mockGenerateContent).toHaveBeenCalledWith(
      "Analyze this claim for fraud.",
    );
    expect(result).toBe("This claim shows signs of fraud.");
  });

  it("includes context in prompt when provided", async () => {
    mockGenerateContent.mockResolvedValueOnce(
      mockTextResponse("Analysis complete."),
    );

    const result = await geminiAnalyze("Analyze this.", "Prior claim data...");

    expect(mockGenerateContent).toHaveBeenCalledWith(
      "Analyze this.\n\nContext:\nPrior claim data...",
    );
    expect(result).toBe("Analysis complete.");
  });

  it("returns null and logs warning when GEMINI_API_KEY is not set", async () => {
    delete process.env.GEMINI_API_KEY;
    resetGeminiClient();

    const result = await geminiAnalyze("Analyze this.");

    expect(result).toBeNull();
    expect(mockLog.warn).toHaveBeenCalledWith(
      expect.stringContaining("GEMINI_API_KEY"),
    );
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  it("returns null and logs error when API call fails", async () => {
    mockGenerateContent.mockRejectedValueOnce(new Error("Network error"));

    const result = await geminiAnalyze("Analyze this.");

    expect(result).toBeNull();
    expect(mockLog.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      expect.stringContaining("analysis failed"),
    );
  });
});

// ---------------------------------------------------------------------------
// geminiAnalyzeWithImage — vision (image + prompt)
// ---------------------------------------------------------------------------
describe("geminiAnalyzeWithImage", () => {
  it("sends image buffer and prompt to Gemini and returns text", async () => {
    mockGenerateContent.mockResolvedValueOnce(
      mockTextResponse("Document appears altered."),
    );

    const imageBuffer = Buffer.from("fake-image-data");
    const result = await geminiAnalyzeWithImage(
      "Check this document image.",
      imageBuffer,
      "image/png",
    );

    expect(mockGenerateContent).toHaveBeenCalledWith([
      { text: "Check this document image." },
      {
        inlineData: {
          mimeType: "image/png",
          data: imageBuffer.toString("base64"),
        },
      },
    ]);
    expect(result).toBe("Document appears altered.");
  });

  it("returns null when GEMINI_API_KEY is not set", async () => {
    delete process.env.GEMINI_API_KEY;
    resetGeminiClient();

    const result = await geminiAnalyzeWithImage(
      "Check this.",
      Buffer.from("img"),
      "image/jpeg",
    );

    expect(result).toBeNull();
  });

  it("returns null on API error", async () => {
    mockGenerateContent.mockRejectedValueOnce(new Error("Vision API error"));

    const result = await geminiAnalyzeWithImage(
      "Check this.",
      Buffer.from("img"),
      "image/jpeg",
    );

    expect(result).toBeNull();
    expect(mockLog.error).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// geminiStructuredAnalysis — JSON parsing
// ---------------------------------------------------------------------------
describe("geminiStructuredAnalysis", () => {
  interface FraudScore {
    score: number;
    confidence: string;
    indicators: string[];
  }

  it("parses JSON response into typed object", async () => {
    const jsonPayload: FraudScore = {
      score: 85,
      confidence: "high",
      indicators: ["duplicate-vin", "altered-timestamp"],
    };
    mockGenerateContent.mockResolvedValueOnce(
      mockTextResponse(JSON.stringify(jsonPayload)),
    );

    const result = await geminiStructuredAnalysis<FraudScore>(
      "Score this claim.",
    );

    expect(result).toEqual(jsonPayload);
  });

  it("strips markdown code fences before parsing JSON", async () => {
    const jsonPayload: FraudScore = {
      score: 42,
      confidence: "low",
      indicators: [],
    };
    const wrappedResponse =
      "```json\n" + JSON.stringify(jsonPayload) + "\n```";
    mockGenerateContent.mockResolvedValueOnce(
      mockTextResponse(wrappedResponse),
    );

    const result = await geminiStructuredAnalysis<FraudScore>(
      "Score this claim.",
    );

    expect(result).toEqual(jsonPayload);
  });

  it("includes context in prompt when provided", async () => {
    mockGenerateContent.mockResolvedValueOnce(
      mockTextResponse('{"score": 10}'),
    );

    await geminiStructuredAnalysis<{ score: number }>(
      "Score this.",
      "Claim context...",
    );

    expect(mockGenerateContent).toHaveBeenCalledWith(
      "Score this.\n\nContext:\nClaim context...",
    );
  });

  it("returns null when response is not valid JSON", async () => {
    mockGenerateContent.mockResolvedValueOnce(
      mockTextResponse("This is not JSON at all."),
    );

    const result = await geminiStructuredAnalysis<FraudScore>(
      "Score this claim.",
    );

    expect(result).toBeNull();
    expect(mockLog.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      expect.stringContaining("parse"),
    );
  });

  it("returns null when GEMINI_API_KEY is not set", async () => {
    delete process.env.GEMINI_API_KEY;
    resetGeminiClient();

    const result = await geminiStructuredAnalysis<FraudScore>(
      "Score this claim.",
    );

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Retry with exponential backoff on 429 errors
// ---------------------------------------------------------------------------
describe("retry on transient errors", () => {
  it("retries on 429 and succeeds on subsequent attempt", async () => {
    const { GoogleGenerativeAIFetchError } = await import(
      "@google/generative-ai"
    );
    const rateLimitError = new GoogleGenerativeAIFetchError(
      "Resource exhausted",
      429,
      "Too Many Requests",
    );

    mockGenerateContent
      .mockRejectedValueOnce(rateLimitError)
      .mockResolvedValueOnce(mockTextResponse("Success after retry."));

    const result = await geminiAnalyze("Analyze this.");

    expect(result).toBe("Success after retry.");
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
  });

  it("retries on 500 server error and succeeds", async () => {
    const { GoogleGenerativeAIFetchError } = await import(
      "@google/generative-ai"
    );
    const serverError = new GoogleGenerativeAIFetchError(
      "Internal server error",
      500,
      "Internal Server Error",
    );

    mockGenerateContent
      .mockRejectedValueOnce(serverError)
      .mockResolvedValueOnce(mockTextResponse("Recovered."));

    const result = await geminiAnalyze("Analyze this.");

    expect(result).toBe("Recovered.");
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
  });

  it("gives up after max retries and returns null", async () => {
    const { GoogleGenerativeAIFetchError } = await import(
      "@google/generative-ai"
    );
    const rateLimitError = new GoogleGenerativeAIFetchError(
      "Resource exhausted",
      429,
      "Too Many Requests",
    );

    mockGenerateContent
      .mockRejectedValueOnce(rateLimitError)
      .mockRejectedValueOnce(rateLimitError)
      .mockRejectedValueOnce(rateLimitError);

    const result = await geminiAnalyze("Analyze this.");

    expect(result).toBeNull();
    expect(mockGenerateContent).toHaveBeenCalledTimes(3);
  });

  it("does NOT retry on non-transient errors (e.g., 400 Bad Request)", async () => {
    const { GoogleGenerativeAIFetchError } = await import(
      "@google/generative-ai"
    );
    const badRequest = new GoogleGenerativeAIFetchError(
      "Bad request",
      400,
      "Bad Request",
    );

    mockGenerateContent.mockRejectedValueOnce(badRequest);

    const result = await geminiAnalyze("Analyze this.");

    expect(result).toBeNull();
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry on generic (non-fetch) errors", async () => {
    mockGenerateContent.mockRejectedValueOnce(
      new Error("Some random error"),
    );

    const result = await geminiAnalyze("Analyze this.");

    expect(result).toBeNull();
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
  });
});
