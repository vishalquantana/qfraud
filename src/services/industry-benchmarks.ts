/**
 * Industry benchmark lookup table by NAICS code.
 *
 * Maps 2-digit NAICS sector codes to expected financial ranges.
 * Used by statistical anomaly detection to flag deviations.
 */

export interface IndustryBenchmark {
  sectorName: string;
  /** Expected COGS as % of revenue [min, max] */
  cogsMarginRange: [number, number];
  /** Expected annual payroll per employee [min, max] in USD */
  payrollPerHeadRange: [number, number];
  /** Expected annual revenue growth % ceiling (flagged above this) */
  maxRevenueGrowthPercent: number;
}

/**
 * Lookup table keyed by 2-digit NAICS sector code.
 * Values represent typical ranges for that industry sector.
 */
export const INDUSTRY_BENCHMARKS: Record<string, IndustryBenchmark> = {
  "11": {
    sectorName: "Agriculture, Forestry, Fishing and Hunting",
    cogsMarginRange: [50, 80],
    payrollPerHeadRange: [25000, 55000],
    maxRevenueGrowthPercent: 30,
  },
  "21": {
    sectorName: "Mining, Quarrying, and Oil and Gas Extraction",
    cogsMarginRange: [40, 75],
    payrollPerHeadRange: [45000, 90000],
    maxRevenueGrowthPercent: 30,
  },
  "22": {
    sectorName: "Utilities",
    cogsMarginRange: [40, 70],
    payrollPerHeadRange: [50000, 100000],
    maxRevenueGrowthPercent: 30,
  },
  "23": {
    sectorName: "Construction",
    cogsMarginRange: [60, 85],
    payrollPerHeadRange: [35000, 75000],
    maxRevenueGrowthPercent: 30,
  },
  "31": {
    sectorName: "Manufacturing (Food, Beverage, Textile)",
    cogsMarginRange: [50, 80],
    payrollPerHeadRange: [30000, 70000],
    maxRevenueGrowthPercent: 30,
  },
  "32": {
    sectorName: "Manufacturing (Wood, Paper, Chemical, Plastics)",
    cogsMarginRange: [50, 80],
    payrollPerHeadRange: [35000, 75000],
    maxRevenueGrowthPercent: 30,
  },
  "33": {
    sectorName: "Manufacturing (Metal, Machinery, Electronics)",
    cogsMarginRange: [45, 75],
    payrollPerHeadRange: [40000, 85000],
    maxRevenueGrowthPercent: 30,
  },
  "42": {
    sectorName: "Wholesale Trade",
    cogsMarginRange: [65, 85],
    payrollPerHeadRange: [35000, 75000],
    maxRevenueGrowthPercent: 30,
  },
  "44": {
    sectorName: "Retail Trade (Motor Vehicle, Furniture, Electronics)",
    cogsMarginRange: [55, 80],
    payrollPerHeadRange: [25000, 50000],
    maxRevenueGrowthPercent: 30,
  },
  "45": {
    sectorName: "Retail Trade (Clothing, Sporting, General)",
    cogsMarginRange: [50, 75],
    payrollPerHeadRange: [25000, 50000],
    maxRevenueGrowthPercent: 30,
  },
  "48": {
    sectorName: "Transportation and Warehousing",
    cogsMarginRange: [55, 80],
    payrollPerHeadRange: [30000, 65000],
    maxRevenueGrowthPercent: 30,
  },
  "49": {
    sectorName: "Transportation and Warehousing (Postal, Courier)",
    cogsMarginRange: [55, 80],
    payrollPerHeadRange: [30000, 65000],
    maxRevenueGrowthPercent: 30,
  },
  "51": {
    sectorName: "Information",
    cogsMarginRange: [25, 60],
    payrollPerHeadRange: [50000, 120000],
    maxRevenueGrowthPercent: 30,
  },
  "52": {
    sectorName: "Finance and Insurance",
    cogsMarginRange: [20, 55],
    payrollPerHeadRange: [45000, 110000],
    maxRevenueGrowthPercent: 30,
  },
  "53": {
    sectorName: "Real Estate and Rental and Leasing",
    cogsMarginRange: [30, 65],
    payrollPerHeadRange: [35000, 75000],
    maxRevenueGrowthPercent: 30,
  },
  "54": {
    sectorName: "Professional, Scientific, and Technical Services",
    cogsMarginRange: [25, 60],
    payrollPerHeadRange: [45000, 110000],
    maxRevenueGrowthPercent: 30,
  },
  "55": {
    sectorName: "Management of Companies and Enterprises",
    cogsMarginRange: [30, 60],
    payrollPerHeadRange: [50000, 120000],
    maxRevenueGrowthPercent: 30,
  },
  "56": {
    sectorName: "Administrative and Support Services",
    cogsMarginRange: [50, 80],
    payrollPerHeadRange: [25000, 55000],
    maxRevenueGrowthPercent: 30,
  },
  "61": {
    sectorName: "Educational Services",
    cogsMarginRange: [35, 65],
    payrollPerHeadRange: [30000, 70000],
    maxRevenueGrowthPercent: 30,
  },
  "62": {
    sectorName: "Health Care and Social Assistance",
    cogsMarginRange: [35, 65],
    payrollPerHeadRange: [30000, 80000],
    maxRevenueGrowthPercent: 30,
  },
  "71": {
    sectorName: "Arts, Entertainment, and Recreation",
    cogsMarginRange: [35, 70],
    payrollPerHeadRange: [25000, 55000],
    maxRevenueGrowthPercent: 30,
  },
  "72": {
    sectorName: "Accommodation and Food Services",
    cogsMarginRange: [55, 80],
    payrollPerHeadRange: [20000, 45000],
    maxRevenueGrowthPercent: 30,
  },
  "81": {
    sectorName: "Other Services (except Public Administration)",
    cogsMarginRange: [35, 70],
    payrollPerHeadRange: [25000, 60000],
    maxRevenueGrowthPercent: 30,
  },
  "92": {
    sectorName: "Public Administration",
    cogsMarginRange: [40, 70],
    payrollPerHeadRange: [35000, 80000],
    maxRevenueGrowthPercent: 30,
  },
};

/** Default benchmark used when NAICS code is unknown or not in lookup table. */
export const DEFAULT_BENCHMARK: IndustryBenchmark = {
  sectorName: "Unknown / Default",
  cogsMarginRange: [30, 75],
  payrollPerHeadRange: [25000, 80000],
  maxRevenueGrowthPercent: 30,
};

/**
 * Look up the industry benchmark for a NAICS code.
 * Uses the first 2 digits (sector code) for matching.
 */
export function getBenchmark(naicsCode: string | null): IndustryBenchmark {
  if (!naicsCode || naicsCode.length < 2) return DEFAULT_BENCHMARK;
  const sectorCode = naicsCode.substring(0, 2);
  return INDUSTRY_BENCHMARKS[sectorCode] ?? DEFAULT_BENCHMARK;
}
