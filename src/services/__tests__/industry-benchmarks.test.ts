import {
  getBenchmark,
  DEFAULT_BENCHMARK,
  INDUSTRY_BENCHMARKS,
  type IndustryBenchmark,
} from "@/services/industry-benchmarks";

describe("industry-benchmarks", () => {
  // ─── getBenchmark ────────────────────────────────────────

  describe("getBenchmark", () => {
    it("returns Construction benchmark for NAICS code '23'", () => {
      const result = getBenchmark("23");
      expect(result.sectorName).toBe("Construction");
      expect(result.cogsMarginRange).toEqual([60, 85]);
      expect(result.payrollPerHeadRange).toEqual([35000, 75000]);
    });

    it("returns Information benchmark for NAICS code '51'", () => {
      const result = getBenchmark("51");
      expect(result.sectorName).toBe("Information");
      expect(result.cogsMarginRange).toEqual([25, 60]);
      expect(result.payrollPerHeadRange).toEqual([50000, 120000]);
    });

    it("returns Finance benchmark for NAICS code '52'", () => {
      const result = getBenchmark("52");
      expect(result.sectorName).toBe("Finance and Insurance");
    });

    it("uses first 2 digits of longer NAICS codes ('332710' -> '33')", () => {
      const result = getBenchmark("332710");
      expect(result.sectorName).toBe(
        "Manufacturing (Metal, Machinery, Electronics)"
      );
      expect(result.cogsMarginRange).toEqual([45, 75]);
    });

    it("uses first 2 digits of 4-digit NAICS code ('5112' -> '51')", () => {
      const result = getBenchmark("5112");
      expect(result.sectorName).toBe("Information");
    });

    it("returns DEFAULT_BENCHMARK for null naicsCode", () => {
      const result = getBenchmark(null);
      expect(result).toBe(DEFAULT_BENCHMARK);
      expect(result.sectorName).toBe("Unknown / Default");
    });

    it("returns DEFAULT_BENCHMARK for empty string", () => {
      const result = getBenchmark("");
      expect(result).toBe(DEFAULT_BENCHMARK);
    });

    it("returns DEFAULT_BENCHMARK for single character", () => {
      const result = getBenchmark("5");
      expect(result).toBe(DEFAULT_BENCHMARK);
    });

    it("returns DEFAULT_BENCHMARK for unknown sector codes", () => {
      const result = getBenchmark("99");
      expect(result).toBe(DEFAULT_BENCHMARK);
    });

    it("returns DEFAULT_BENCHMARK for '00'", () => {
      const result = getBenchmark("00");
      expect(result).toBe(DEFAULT_BENCHMARK);
    });
  });

  // ─── benchmark data integrity ────────────────────────────

  describe("benchmark data integrity", () => {
    it("all benchmarks have valid COGS ranges (min < max)", () => {
      for (const [code, benchmark] of Object.entries(INDUSTRY_BENCHMARKS)) {
        const [min, max] = benchmark.cogsMarginRange;
        expect(min).toBeLessThan(max);
      }
    });

    it("all benchmarks have valid payroll ranges (min < max)", () => {
      for (const [code, benchmark] of Object.entries(INDUSTRY_BENCHMARKS)) {
        const [min, max] = benchmark.payrollPerHeadRange;
        expect(min).toBeLessThan(max);
      }
    });

    it("all benchmarks have positive maxRevenueGrowthPercent", () => {
      for (const benchmark of Object.values(INDUSTRY_BENCHMARKS)) {
        expect(benchmark.maxRevenueGrowthPercent).toBeGreaterThan(0);
      }
    });

    it("DEFAULT_BENCHMARK has valid COGS range (min < max)", () => {
      const [min, max] = DEFAULT_BENCHMARK.cogsMarginRange;
      expect(min).toBeLessThan(max);
    });

    it("DEFAULT_BENCHMARK has valid payroll range (min < max)", () => {
      const [min, max] = DEFAULT_BENCHMARK.payrollPerHeadRange;
      expect(min).toBeLessThan(max);
    });

    it("INDUSTRY_BENCHMARKS covers major NAICS sectors", () => {
      const expectedSectors = [
        "11", // Agriculture
        "21", // Mining
        "22", // Utilities
        "23", // Construction
        "31", // Manufacturing
        "32", // Manufacturing
        "33", // Manufacturing
        "42", // Wholesale Trade
        "44", // Retail Trade
        "45", // Retail Trade
        "48", // Transportation
        "49", // Transportation
        "51", // Information
        "52", // Finance
        "53", // Real Estate
        "54", // Professional Services
        "55", // Management
        "56", // Administrative
        "61", // Education
        "62", // Health Care
        "71", // Arts/Entertainment
        "72", // Accommodation/Food
        "81", // Other Services
        "92", // Public Administration
      ];

      for (const sector of expectedSectors) {
        expect(INDUSTRY_BENCHMARKS).toHaveProperty(sector);
      }
    });

    it("all benchmarks have non-empty sectorName", () => {
      for (const benchmark of Object.values(INDUSTRY_BENCHMARKS)) {
        expect(benchmark.sectorName.length).toBeGreaterThan(0);
      }
    });
  });
});
