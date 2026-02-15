import {
  PrismaClient,
  Role,
  SubmissionStatus,
  Severity,
  Channel,
  DocumentType,
  DocumentStatus,
  FraudIndicatorCategory,
  SIUCaseStatus,
} from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createHash, randomBytes } from "crypto";

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = createHash("sha256")
    .update(salt + password)
    .digest("hex");
  return `${salt}:${hash}`;
}

function daysAgo(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

function jsonClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

async function main() {
  const connectionString =
    process.env.DATABASE_URL ??
    "postgresql://user:password@localhost:5432/quantana_shield";
  const adapter = new PrismaPg({ connectionString });
  const prisma = new PrismaClient({ adapter });

  // ─── Tenant ──────────────────────────────────────────────
  const tenant = await prisma.tenant.upsert({
    where: { slug: "acme-insurance" },
    update: {},
    create: {
      name: "Acme Insurance MGA",
      slug: "acme-insurance",
      domain: "acme-insurance.quantanashield.com",
      logoUrl: null,
      primaryColor: "#1e40af",
      secondaryColor: "#3b82f6",
    },
  });
  console.log(`Tenant created/found: ${tenant.name} (${tenant.id})`);

  // ─── Users ───────────────────────────────────────────────
  const userDefs: { name: string; email: string; role: Role }[] = [
    { name: "Alice Admin", email: "admin@acme-insurance.com", role: "ADMIN" },
    { name: "Uma Underwriter", email: "underwriter@acme-insurance.com", role: "UNDERWRITER" },
    { name: "Sam Senior", email: "senior.underwriter@acme-insurance.com", role: "SENIOR_UNDERWRITER" },
    { name: "Ian Investigator", email: "siu@acme-insurance.com", role: "SIU_INVESTIGATOR" },
    { name: "Carla Compliance", email: "compliance@acme-insurance.com", role: "COMPLIANCE_OFFICER" },
    { name: "Bob Broker", email: "broker@acme-insurance.com", role: "BROKER" },
    { name: "Diana Broker", email: "diana.broker@acme-insurance.com", role: "BROKER" },
    { name: "Eric Broker", email: "eric.broker@acme-insurance.com", role: "BROKER" },
  ];

  const userMap: Record<string, string> = {};
  for (const userData of userDefs) {
    const user = await prisma.user.upsert({
      where: { tenantId_email: { tenantId: tenant.id, email: userData.email } },
      update: {},
      create: {
        tenantId: tenant.id,
        name: userData.name,
        email: userData.email,
        role: userData.role,
        passwordHash: hashPassword("Password123!"),
        isActive: true,
      },
    });
    userMap[userData.role + "_" + userData.name.split(" ")[0]] = user.id;
    console.log(`  User: ${user.name} (${user.role})`);
  }

  // Convenience references
  const underwriterId = userMap["UNDERWRITER_Uma"];
  const seniorUwId = userMap["SENIOR_UNDERWRITER_Sam"];
  const siuId = userMap["SIU_INVESTIGATOR_Ian"];
  const bobId = userMap["BROKER_Bob"];
  const dianaId = userMap["BROKER_Diana"];
  const ericId = userMap["BROKER_Eric"];

  // ─── Threshold Config ────────────────────────────────────
  const existingThreshold = await prisma.thresholdConfig.findFirst({
    where: { tenantId: tenant.id, lineOfBusiness: null },
  });
  if (!existingThreshold) {
    await prisma.thresholdConfig.create({
      data: { tenantId: tenant.id, lineOfBusiness: null, autoApproveBelow: 20, autoEscalateAbove: 70, siuReferralOnCritical: true },
    });
    console.log("  Default ThresholdConfig created (global)");
  } else {
    console.log("  Default ThresholdConfig already exists (global)");
  }

  // ─── Compliance Config ───────────────────────────────────
  await prisma.complianceConfig.upsert({
    where: { tenantId: tenant.id },
    update: {},
    create: { tenantId: tenant.id, retentionYears: 5 },
  });
  console.log("  Default ComplianceConfig created (5-year retention)");

  // ─── White Label Config ──────────────────────────────────
  await prisma.whiteLabelConfig.upsert({
    where: { tenantId: tenant.id },
    update: {},
    create: {
      tenantId: tenant.id,
      primaryColor: "#1e40af",
      secondaryColor: "#3b82f6",
      accentColor: "#f59e0b",
      footerText: "Acme Insurance MGA - All rights reserved",
      supportEmail: "support@acme-insurance.com",
      supportPhone: "1-800-555-0100",
    },
  });
  console.log("  WhiteLabelConfig created");

  // ─── Clean previous seed submissions ─────────────────────
  // Delete in correct FK order for idempotency
  const existingSeedSubs = await prisma.submission.findMany({
    where: { tenantId: tenant.id, insuredName: { startsWith: "SEED:" } },
    select: { id: true },
  });
  const existingSeedIds = existingSeedSubs.map((s) => s.id);

  if (existingSeedIds.length > 0) {
    await prisma.sIUCase.deleteMany({ where: { submissionId: { in: existingSeedIds } } });
    await prisma.fraudIndicator.deleteMany({ where: { submissionId: { in: existingSeedIds } } });
    await prisma.auditLog.deleteMany({ where: { submissionId: { in: existingSeedIds } } });
    await prisma.document.deleteMany({ where: { submissionId: { in: existingSeedIds } } });
    await prisma.submission.deleteMany({ where: { id: { in: existingSeedIds } } });
    console.log(`  Cleaned ${existingSeedIds.length} previous seed submissions`);
  }

  // ─── Submission Definitions ──────────────────────────────
  // 8 APPROVED, 5 UNDER_REVIEW, 4 DECLINED, 3 REFERRED_TO_SIU
  interface SubDef {
    idx: number;
    insuredName: string;
    lob: string;
    status: SubmissionStatus;
    riskScore: number;
    severity: Severity;
    channel: Channel;
    brokerId: string;
    assignedUwId: string | null;
    daysAgo: number;
    docs: DocDef[];
    indicators: IndicatorDef[];
  }
  interface DocDef {
    fileName: string;
    fileType: string;
    fileSize: number;
    documentType: DocumentType;
    confidence: number;
    extractedData: Record<string, unknown>;
  }
  interface IndicatorDef {
    category: FraudIndicatorCategory;
    indicatorName: string;
    description: string;
    severity: Severity;
    evidence: Record<string, unknown>;
    confidence: number;
    recommendedAction: string;
    docIdx?: number; // index into docs array
  }

  const submissions: SubDef[] = [
    // ── 1-8: APPROVED (clean, auto-approved) ────────────────
    {
      idx: 1, insuredName: "SEED: Riverside Coffee Co", lob: "General Liability", status: "APPROVED" as SubmissionStatus,
      riskScore: 5, severity: "CLEAN" as Severity, channel: "PORTAL" as Channel, brokerId: bobId, assignedUwId: null, daysAgo: 28,
      docs: [
        { fileName: "acord125_riverside.pdf", fileType: "application/pdf", fileSize: 245000, documentType: "ACORD_125" as DocumentType, confidence: 0.95, extractedData: { applicantName: "Riverside Coffee Co", businessName: "Riverside Coffee Co", naicsCode: "722515", yearEstablished: "2018", annualRevenue: "$850,000", numberOfEmployees: "12", effectiveDate: "03/01/2026", state: "CA" } },
        { fileName: "financial_stmt_2025.pdf", fileType: "application/pdf", fileSize: 180000, documentType: "FINANCIAL_STATEMENT" as DocumentType, confidence: 0.88, extractedData: { fiscalYear: "2025", revenue: 850000, netIncome: 85000, totalAssets: 420000, totalLiabilities: 180000 } },
        { fileName: "loss_runs_riverside.pdf", fileType: "application/pdf", fileSize: 120000, documentType: "LOSS_RUN" as DocumentType, confidence: 0.92, extractedData: { carrier: "Hartford", totalClaimCount: 0, totalIncurred: 0, claims: [] } },
      ],
      indicators: [],
    },
    {
      idx: 2, insuredName: "SEED: Summit Tech Solutions", lob: "Professional Liability", status: "APPROVED" as SubmissionStatus,
      riskScore: 8, severity: "CLEAN" as Severity, channel: "PORTAL" as Channel, brokerId: dianaId, assignedUwId: null, daysAgo: 25,
      docs: [
        { fileName: "acord125_summit.pdf", fileType: "application/pdf", fileSize: 260000, documentType: "ACORD_125" as DocumentType, confidence: 0.97, extractedData: { applicantName: "Summit Tech Solutions LLC", businessName: "Summit Tech Solutions", naicsCode: "541512", yearEstablished: "2015", annualRevenue: "$2,400,000", numberOfEmployees: "28", effectiveDate: "04/01/2026", state: "TX" } },
        { fileName: "coi_summit.pdf", fileType: "application/pdf", fileSize: 95000, documentType: "COI" as DocumentType, confidence: 0.91, extractedData: { insuredName: "Summit Tech Solutions LLC", policyNumber: "GL-2025-44891", effectiveDate: "04/01/2025", expirationDate: "04/01/2026", generalLiabilityLimit: "$1,000,000" } },
        { fileName: "entity_docs_summit.pdf", fileType: "application/pdf", fileSize: 78000, documentType: "ENTITY_DOC" as DocumentType, confidence: 0.85, extractedData: { entityName: "Summit Tech Solutions LLC", entityType: "LLC", stateOfIncorporation: "TX", incorporationDate: "2015-03-12" } },
      ],
      indicators: [],
    },
    {
      idx: 3, insuredName: "SEED: Green Valley Landscaping", lob: "Workers Compensation", status: "APPROVED" as SubmissionStatus,
      riskScore: 12, severity: "LOW" as Severity, channel: "EMAIL" as Channel, brokerId: bobId, assignedUwId: null, daysAgo: 22,
      docs: [
        { fileName: "acord125_greenvalley.pdf", fileType: "application/pdf", fileSize: 230000, documentType: "ACORD_125" as DocumentType, confidence: 0.94, extractedData: { applicantName: "Green Valley Landscaping", naicsCode: "561730", yearEstablished: "2012", annualRevenue: "$1,200,000", numberOfEmployees: "18", effectiveDate: "03/15/2026", state: "FL" } },
        { fileName: "acord130_greenvalley.pdf", fileType: "application/pdf", fileSize: 195000, documentType: "ACORD_130" as DocumentType, confidence: 0.93, extractedData: { totalPayroll: 680000, eModRate: 0.95, payrollByClassification: [{ classCode: "0042", description: "Landscaping", payroll: 680000, employeeCount: 18 }] } },
        { fileName: "payroll_tax_2025.pdf", fileType: "application/pdf", fileSize: 145000, documentType: "PAYROLL_TAX" as DocumentType, confidence: 0.87, extractedData: { totalPayroll: 675000, employeeCount: 18 } },
      ],
      indicators: [],
    },
    {
      idx: 4, insuredName: "SEED: Pacific Dental Group", lob: "Professional Liability", status: "APPROVED" as SubmissionStatus,
      riskScore: 0, severity: "CLEAN" as Severity, channel: "PORTAL" as Channel, brokerId: ericId, assignedUwId: null, daysAgo: 20,
      docs: [
        { fileName: "acord125_pacific_dental.pdf", fileType: "application/pdf", fileSize: 240000, documentType: "ACORD_125" as DocumentType, confidence: 0.96, extractedData: { applicantName: "Pacific Dental Group", naicsCode: "621210", yearEstablished: "2010", annualRevenue: "$3,500,000", numberOfEmployees: "35", effectiveDate: "05/01/2026", state: "CA" } },
        { fileName: "professional_license.pdf", fileType: "application/pdf", fileSize: 55000, documentType: "PROFESSIONAL_LICENSE" as DocumentType, confidence: 0.90, extractedData: { licenseNumber: "DDS-12345", licenseType: "Dentistry", state: "CA", status: "Active", expirationDate: "12/31/2026" } },
      ],
      indicators: [],
    },
    {
      idx: 5, insuredName: "SEED: Maple Street Bakery", lob: "General Liability", status: "APPROVED" as SubmissionStatus,
      riskScore: 3, severity: "CLEAN" as Severity, channel: "PORTAL" as Channel, brokerId: dianaId, assignedUwId: null, daysAgo: 18,
      docs: [
        { fileName: "acord125_maple.pdf", fileType: "application/pdf", fileSize: 220000, documentType: "ACORD_125" as DocumentType, confidence: 0.93, extractedData: { applicantName: "Maple Street Bakery Inc", naicsCode: "311812", yearEstablished: "2016", annualRevenue: "$620,000", numberOfEmployees: "8", effectiveDate: "04/15/2026", state: "OR" } },
        { fileName: "loss_run_maple.pdf", fileType: "application/pdf", fileSize: 100000, documentType: "LOSS_RUN" as DocumentType, confidence: 0.89, extractedData: { carrier: "Travelers", totalClaimCount: 1, totalIncurred: 3500, claims: [{ claimNumber: "CL-99812", dateOfLoss: "06/15/2024", claimType: "Slip and Fall", status: "Closed", paidAmount: 3500, reserveAmount: 0, totalIncurred: 3500 }] } },
      ],
      indicators: [],
    },
    {
      idx: 6, insuredName: "SEED: Oakridge Plumbing", lob: "General Liability", status: "APPROVED" as SubmissionStatus,
      riskScore: 10, severity: "LOW" as Severity, channel: "API" as Channel, brokerId: bobId, assignedUwId: null, daysAgo: 15,
      docs: [
        { fileName: "acord125_oakridge.pdf", fileType: "application/pdf", fileSize: 235000, documentType: "ACORD_125" as DocumentType, confidence: 0.94, extractedData: { applicantName: "Oakridge Plumbing LLC", naicsCode: "238220", yearEstablished: "2009", annualRevenue: "$980,000", numberOfEmployees: "14", effectiveDate: "05/01/2026", state: "WA" } },
        { fileName: "coi_oakridge.pdf", fileType: "application/pdf", fileSize: 88000, documentType: "COI" as DocumentType, confidence: 0.92, extractedData: { insuredName: "Oakridge Plumbing LLC", policyNumber: "GL-2025-33210", effectiveDate: "05/01/2025", expirationDate: "05/01/2026", generalLiabilityLimit: "$1,000,000" } },
        { fileName: "loss_runs_oakridge.pdf", fileType: "application/pdf", fileSize: 115000, documentType: "LOSS_RUN" as DocumentType, confidence: 0.90, extractedData: { carrier: "Liberty Mutual", totalClaimCount: 2, totalIncurred: 12000, claims: [{ claimNumber: "CL-44521", dateOfLoss: "03/10/2024", claimType: "Property Damage", status: "Closed", paidAmount: 8000, reserveAmount: 0, totalIncurred: 8000 }, { claimNumber: "CL-44890", dateOfLoss: "09/22/2024", claimType: "Bodily Injury", status: "Closed", paidAmount: 4000, reserveAmount: 0, totalIncurred: 4000 }] } },
      ],
      indicators: [],
    },
    {
      idx: 7, insuredName: "SEED: Harmony Yoga Studio", lob: "General Liability", status: "APPROVED" as SubmissionStatus,
      riskScore: 0, severity: "CLEAN" as Severity, channel: "PORTAL" as Channel, brokerId: dianaId, assignedUwId: null, daysAgo: 12,
      docs: [
        { fileName: "acord125_harmony.pdf", fileType: "application/pdf", fileSize: 210000, documentType: "ACORD_125" as DocumentType, confidence: 0.95, extractedData: { applicantName: "Harmony Yoga Studio", naicsCode: "713940", yearEstablished: "2019", annualRevenue: "$320,000", numberOfEmployees: "5", effectiveDate: "06/01/2026", state: "CO" } },
        { fileName: "entity_doc_harmony.pdf", fileType: "application/pdf", fileSize: 65000, documentType: "ENTITY_DOC" as DocumentType, confidence: 0.86, extractedData: { entityName: "Harmony Yoga Studio LLC", entityType: "LLC", stateOfIncorporation: "CO", incorporationDate: "2019-01-15" } },
      ],
      indicators: [],
    },
    {
      idx: 8, insuredName: "SEED: Brightside Electric", lob: "General Liability", status: "APPROVED" as SubmissionStatus,
      riskScore: 15, severity: "LOW" as Severity, channel: "EMAIL" as Channel, brokerId: ericId, assignedUwId: null, daysAgo: 10,
      docs: [
        { fileName: "acord125_brightside.pdf", fileType: "application/pdf", fileSize: 250000, documentType: "ACORD_125" as DocumentType, confidence: 0.96, extractedData: { applicantName: "Brightside Electric Inc", naicsCode: "238210", yearEstablished: "2011", annualRevenue: "$1,800,000", numberOfEmployees: "22", effectiveDate: "06/01/2026", state: "AZ" } },
        { fileName: "financial_stmt_brightside.pdf", fileType: "application/pdf", fileSize: 190000, documentType: "FINANCIAL_STATEMENT" as DocumentType, confidence: 0.90, extractedData: { fiscalYear: "2025", revenue: 1800000, netIncome: 198000, totalAssets: 850000, totalLiabilities: 380000, accountsReceivable: 220000 } },
        { fileName: "loss_runs_brightside.pdf", fileType: "application/pdf", fileSize: 130000, documentType: "LOSS_RUN" as DocumentType, confidence: 0.88, extractedData: { carrier: "Zurich", totalClaimCount: 1, totalIncurred: 5200, claims: [{ claimNumber: "CL-77432", dateOfLoss: "07/20/2024", claimType: "Property Damage", status: "Closed", paidAmount: 5200, reserveAmount: 0, totalIncurred: 5200 }] } },
        { fileName: "coi_brightside.pdf", fileType: "application/pdf", fileSize: 90000, documentType: "COI" as DocumentType, confidence: 0.91, extractedData: { insuredName: "Brightside Electric Inc", policyNumber: "GL-2025-88921", effectiveDate: "06/01/2025", expirationDate: "06/01/2026", generalLiabilityLimit: "$2,000,000" } },
      ],
      indicators: [],
    },

    // ── 9-13: UNDER_REVIEW (medium risk) ────────────────────
    {
      idx: 9, insuredName: "SEED: Metro Construction Group", lob: "Workers Compensation", status: "UNDER_REVIEW" as SubmissionStatus,
      riskScore: 45, severity: "MEDIUM" as Severity, channel: "PORTAL" as Channel, brokerId: bobId, assignedUwId: underwriterId, daysAgo: 14,
      docs: [
        { fileName: "acord125_metro.pdf", fileType: "application/pdf", fileSize: 270000, documentType: "ACORD_125" as DocumentType, confidence: 0.95, extractedData: { applicantName: "Metro Construction Group LLC", naicsCode: "236220", yearEstablished: "2017", annualRevenue: "$4,500,000", numberOfEmployees: "45", effectiveDate: "04/01/2026", state: "NY" } },
        { fileName: "acord130_metro.pdf", fileType: "application/pdf", fileSize: 200000, documentType: "ACORD_130" as DocumentType, confidence: 0.93, extractedData: { totalPayroll: 2100000, eModRate: 1.15, payrollByClassification: [{ classCode: "5403", description: "Carpentry", payroll: 900000, employeeCount: 18 }, { classCode: "5022", description: "Masonry", payroll: 1200000, employeeCount: 27 }] } },
        { fileName: "financial_stmt_metro.pdf", fileType: "application/pdf", fileSize: 185000, documentType: "FINANCIAL_STATEMENT" as DocumentType, confidence: 0.89, extractedData: { fiscalYear: "2025", revenue: 4200000, netIncome: 500000, totalAssets: 2800000, totalLiabilities: 1500000, accountsReceivable: 1900000 } },
        { fileName: "loss_runs_metro.pdf", fileType: "application/pdf", fileSize: 160000, documentType: "LOSS_RUN" as DocumentType, confidence: 0.91, extractedData: { carrier: "CNA", totalClaimCount: 4, totalIncurred: 85000, claims: [{ claimNumber: "CL-20001", dateOfLoss: "01/15/2025", claimType: "Fall", status: "Open", paidAmount: 25000, reserveAmount: 20000, totalIncurred: 45000 }, { claimNumber: "CL-20002", dateOfLoss: "05/20/2025", claimType: "Strain", status: "Closed", paidAmount: 15000, reserveAmount: 0, totalIncurred: 15000 }, { claimNumber: "CL-20003", dateOfLoss: "08/10/2025", claimType: "Cut", status: "Closed", paidAmount: 8000, reserveAmount: 0, totalIncurred: 8000 }, { claimNumber: "CL-20004", dateOfLoss: "11/05/2025", claimType: "Fall", status: "Open", paidAmount: 7000, reserveAmount: 10000, totalIncurred: 17000 }] } },
      ],
      indicators: [
        { category: "CROSS_DOC" as FraudIndicatorCategory, indicatorName: "Revenue Mismatch", description: "Revenue on ACORD 125 ($4,500,000) differs from financial statement ($4,200,000) by 7.1%", severity: "MEDIUM" as Severity, evidence: { acord125Revenue: "$4,500,000", financialRevenue: "$4,200,000", variance: "7.1%" }, confidence: 0.85, recommendedAction: "Request clarification on revenue discrepancy" },
        { category: "RATIO" as FraudIndicatorCategory, indicatorName: "High A/R Ratio", description: "Accounts receivable ($1,900,000) is 45.2% of revenue, exceeding 40% threshold", severity: "HIGH" as Severity, evidence: { accountsReceivable: 1900000, revenue: 4200000, ratio: "45.2%", threshold: "40%" }, confidence: 0.92, recommendedAction: "Review A/R aging report for potential fictitious revenue" },
        { category: "STATISTICAL" as FraudIndicatorCategory, indicatorName: "Round Number Revenue", description: "Multiple financial figures are exact round numbers ($4,500,000 revenue, $500,000 net income)", severity: "MEDIUM" as Severity, evidence: { roundValues: ["$4,500,000", "$500,000"] }, confidence: 0.6, recommendedAction: "Verify financial figures against source documents" },
      ],
    },
    {
      idx: 10, insuredName: "SEED: Lakeside Property Management", lob: "Commercial Property", status: "UNDER_REVIEW" as SubmissionStatus,
      riskScore: 40, severity: "MEDIUM" as Severity, channel: "PORTAL" as Channel, brokerId: dianaId, assignedUwId: underwriterId, daysAgo: 11,
      docs: [
        { fileName: "acord125_lakeside.pdf", fileType: "application/pdf", fileSize: 255000, documentType: "ACORD_125" as DocumentType, confidence: 0.94, extractedData: { applicantName: "Lakeside Property Management", naicsCode: "531311", yearEstablished: "2014", annualRevenue: "$2,800,000", numberOfEmployees: "20", effectiveDate: "05/15/2026", state: "MI" } },
        { fileName: "acord140_lakeside.pdf", fileType: "application/pdf", fileSize: 210000, documentType: "ACORD_140" as DocumentType, confidence: 0.92, extractedData: { totalInsuredValue: 8500000, deductible: 5000, propertyLocations: [{ address: "100 Lake Dr, Ann Arbor MI", buildingValue: 3200000, contentsValue: 1800000, constructionType: "Masonry", yearBuilt: 1998, squareFootage: 25000, occupancy: "Office", condition: "Good" }, { address: "250 Harbor Rd, Ann Arbor MI", buildingValue: 2100000, contentsValue: 1400000, constructionType: "Frame", yearBuilt: 2005, squareFootage: 18000, occupancy: "Retail", condition: "Fair" }] } },
        { fileName: "inspection_photo_1.jpg", fileType: "image/jpeg", fileSize: 3200000, documentType: "INSPECTION_PHOTO" as DocumentType, confidence: 0.75, extractedData: { gpsCoordinates: null, timestamp: "2025-08-15T10:30:00Z" } },
        { fileName: "inspection_photo_2.jpg", fileType: "image/jpeg", fileSize: 2800000, documentType: "INSPECTION_PHOTO" as DocumentType, confidence: 0.75, extractedData: { gpsCoordinates: null, timestamp: "2025-08-15T10:32:00Z" } },
      ],
      indicators: [
        { category: "CROSS_DOC" as FraudIndicatorCategory, indicatorName: "High Contents-to-Building Ratio", description: "Office location contents value ($1,800,000) is 56.3% of building value, exceeding typical office range (10-30%)", severity: "HIGH" as Severity, evidence: { buildingValue: 3200000, contentsValue: 1800000, ratio: "56.3%", expectedRange: "10-30%", occupancy: "Office" }, confidence: 0.88, recommendedAction: "Request detailed contents inventory", docIdx: 1 },
        { category: "VISUAL_AI" as FraudIndicatorCategory, indicatorName: "EXIF Data Stripped", description: "Inspection photos have no GPS coordinates in EXIF data", severity: "MEDIUM" as Severity, evidence: { photosWithoutGPS: 2, totalPhotos: 2 }, confidence: 0.7, recommendedAction: "Request new inspection photos with geolocation enabled", docIdx: 2 },
        { category: "TEMPORAL" as FraudIndicatorCategory, indicatorName: "Stale Inspection Report", description: "Inspection photos dated 2025-08-15, over 6 months old", severity: "MEDIUM" as Severity, evidence: { photoDate: "2025-08-15", submissionDate: "2026-02-04", ageMonths: 6 }, confidence: 0.85, recommendedAction: "Request updated inspection photos" },
      ],
    },
    {
      idx: 11, insuredName: "SEED: Apex Auto Transport", lob: "Commercial Auto", status: "UNDER_REVIEW" as SubmissionStatus,
      riskScore: 55, severity: "MEDIUM" as Severity, channel: "EMAIL" as Channel, brokerId: ericId, assignedUwId: seniorUwId, daysAgo: 9,
      docs: [
        { fileName: "acord125_apex.pdf", fileType: "application/pdf", fileSize: 265000, documentType: "ACORD_125" as DocumentType, confidence: 0.95, extractedData: { applicantName: "Apex Auto Transport Inc", naicsCode: "484110", yearEstablished: "2020", annualRevenue: "$3,200,000", numberOfEmployees: "25", effectiveDate: "05/01/2026", state: "GA" } },
        { fileName: "fleet_schedule_apex.xlsx", fileType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", fileSize: 85000, documentType: "FLEET_SCHEDULE" as DocumentType, confidence: 0.88, extractedData: { vehicles: [{ vin: "1HGCM82633A004352", year: "2022", make: "Freightliner", model: "Cascadia" }, { vin: "3AKJHHDR5LSLU6244", year: "2021", make: "Peterbilt", model: "579" }, { vin: "INVALID_VIN_CHECK", year: "2023", make: "Kenworth", model: "T680" }], totalVehicles: 3 } },
        { fileName: "mvr_report_apex.pdf", fileType: "application/pdf", fileSize: 110000, documentType: "MVR" as DocumentType, confidence: 0.86, extractedData: { drivers: [{ name: "John Smith", licenseType: "CDL-A", violations: 0 }, { name: "Mike Johnson", licenseType: "Class D", violations: 1 }] } },
        { fileName: "broker_letter_apex.pdf", fileType: "application/pdf", fileSize: 45000, documentType: "BROKER_SUBMISSION" as DocumentType, confidence: 0.82, extractedData: { text: "Attached please find the submission for Apex Auto Transport. This is an urgent request as the current policy is expiring this week. Please provide a quick turnaround." } },
      ],
      indicators: [
        { category: "API_VERIFY" as FraudIndicatorCategory, indicatorName: "Invalid VIN", description: "VIN 'INVALID_VIN_CHECK' does not decode to a valid vehicle", severity: "CRITICAL" as Severity, evidence: { vin: "INVALID_VIN_CHECK", statedVehicle: "2023 Kenworth T680", nhtsaResult: "Invalid VIN" }, confidence: 0.99, recommendedAction: "Request corrected fleet schedule with valid VINs", docIdx: 1 },
        { category: "API_VERIFY" as FraudIndicatorCategory, indicatorName: "Non-CDL Driver on Commercial Vehicle", description: "Driver Mike Johnson holds Class D license but is assigned to commercial vehicle", severity: "HIGH" as Severity, evidence: { driverName: "Mike Johnson", licenseType: "Class D", assignedVehicle: "2021 Peterbilt 579" }, confidence: 0.95, recommendedAction: "Verify driver licensing and vehicle assignments", docIdx: 2 },
        { category: "NLP" as FraudIndicatorCategory, indicatorName: "Pressure Language Detected", description: "Broker letter contains urgency phrases: 'urgent request', 'expiring this week', 'quick turnaround'", severity: "MEDIUM" as Severity, evidence: { matchedPhrases: ["urgent request", "expiring this week", "quick turnaround"], context: "This is an urgent request as the current policy is expiring this week." }, confidence: 0.78, recommendedAction: "Review submission with standard timeline regardless of pressure", docIdx: 3 },
      ],
    },
    {
      idx: 12, insuredName: "SEED: Coastal Marine Services", lob: "Marine", status: "UNDER_REVIEW" as SubmissionStatus,
      riskScore: 50, severity: "MEDIUM" as Severity, channel: "PORTAL" as Channel, brokerId: bobId, assignedUwId: underwriterId, daysAgo: 7,
      docs: [
        { fileName: "acord125_coastal.pdf", fileType: "application/pdf", fileSize: 248000, documentType: "ACORD_125" as DocumentType, confidence: 0.93, extractedData: { applicantName: "Coastal Marine Services LLC", naicsCode: "336611", yearEstablished: "2019", annualRevenue: "$5,000,000", numberOfEmployees: "30", effectiveDate: "06/01/2026", state: "FL" } },
        { fileName: "financial_stmt_coastal.pdf", fileType: "application/pdf", fileSize: 195000, documentType: "FINANCIAL_STATEMENT" as DocumentType, confidence: 0.91, extractedData: { fiscalYear: "2025", revenue: 5000000, costOfGoodsSold: 2000000, grossProfit: 3000000, netIncome: 1200000, totalAssets: 3800000, totalLiabilities: 1600000, accountsReceivable: 800000 } },
        { fileName: "loss_run_coastal.pdf", fileType: "application/pdf", fileSize: 140000, documentType: "LOSS_RUN" as DocumentType, confidence: 0.90, extractedData: { carrier: "Great American", totalClaimCount: 3, totalIncurred: 120000, policyPeriod: "06/01/2024 - 06/01/2025", claims: [{ claimNumber: "CL-55001", dateOfLoss: "06/15/2024", claimType: "Hull Damage", status: "Closed", paidAmount: 45000, reserveAmount: 0, totalIncurred: 45000 }, { claimNumber: "CL-55002", dateOfLoss: "06/28/2024", claimType: "Equipment Loss", status: "Closed", paidAmount: 35000, reserveAmount: 0, totalIncurred: 35000 }, { claimNumber: "CL-55003", dateOfLoss: "07/10/2024", claimType: "Hull Damage", status: "Open", paidAmount: 20000, reserveAmount: 20000, totalIncurred: 40000 }] } },
      ],
      indicators: [
        { category: "STATISTICAL" as FraudIndicatorCategory, indicatorName: "Round Number Revenue", description: "Revenue is exactly $5,000,000 — suspicious round figure", severity: "MEDIUM" as Severity, evidence: { roundValues: ["$5,000,000"] }, confidence: 0.6, recommendedAction: "Request detailed revenue breakdown" },
        { category: "RATIO" as FraudIndicatorCategory, indicatorName: "Unusually High Profit Margin", description: "Net profit margin (24%) exceeds marine services industry average (8-12%) by >50%", severity: "MEDIUM" as Severity, evidence: { netIncome: 1200000, revenue: 5000000, margin: "24%", industryAvg: "8-12%" }, confidence: 0.8, recommendedAction: "Review financial statements for accuracy" },
        { category: "TEMPORAL" as FraudIndicatorCategory, indicatorName: "Claim Timing Cluster", description: "66.7% of claims occurred within 45 days of policy inception (3 of 3 claims in first 45 days)", severity: "HIGH" as Severity, evidence: { claimsInWindow: 3, totalClaims: 3, windowDays: 45, percentInWindow: "66.7%" }, confidence: 0.88, recommendedAction: "Investigate if pre-existing conditions were concealed" },
      ],
    },
    {
      idx: 13, insuredName: "SEED: Pinnacle Health Clinic", lob: "Medical Malpractice", status: "UNDER_REVIEW" as SubmissionStatus,
      riskScore: 38, severity: "MEDIUM" as Severity, channel: "PORTAL" as Channel, brokerId: dianaId, assignedUwId: underwriterId, daysAgo: 5,
      docs: [
        { fileName: "acord125_pinnacle.pdf", fileType: "application/pdf", fileSize: 260000, documentType: "ACORD_125" as DocumentType, confidence: 0.96, extractedData: { applicantName: "Pinnacle Health Clinic", naicsCode: "621111", yearEstablished: "2016", annualRevenue: "$4,200,000", numberOfEmployees: "32", effectiveDate: "07/01/2026", state: "IL" } },
        { fileName: "professional_license_pinnacle.pdf", fileType: "application/pdf", fileSize: 60000, documentType: "PROFESSIONAL_LICENSE" as DocumentType, confidence: 0.89, extractedData: { licenseNumber: "MD-67890", licenseType: "Medical", state: "IL", status: "Active", expirationDate: "06/30/2027" } },
        { fileName: "loss_run_pinnacle.pdf", fileType: "application/pdf", fileSize: 155000, documentType: "LOSS_RUN" as DocumentType, confidence: 0.91, extractedData: { carrier: "ProAssurance", totalClaimCount: 2, totalIncurred: 75000, claims: [{ claimNumber: "CL-MED-001", dateOfLoss: "03/10/2024", claimType: "Malpractice", status: "Open", paidAmount: 25000, reserveAmount: 50000, totalIncurred: 75000 }, { claimNumber: "CL-MED-002", dateOfLoss: "09/15/2024", claimType: "Negligence", status: "Closed", paidAmount: 0, reserveAmount: 0, totalIncurred: 0 }] } },
        { fileName: "entity_doc_pinnacle.pdf", fileType: "application/pdf", fileSize: 72000, documentType: "ENTITY_DOC" as DocumentType, confidence: 0.87, extractedData: { entityName: "Pinnacle Health Clinic P.C.", entityType: "Professional Corporation", stateOfIncorporation: "IL", incorporationDate: "2016-06-01", officers: [{ name: "Dr. Sarah Chen", title: "President" }] } },
      ],
      indicators: [
        { category: "FORENSIC" as FraudIndicatorCategory, indicatorName: "Personal PDF Author", description: "Loss run PDF author field shows 'John Smith' instead of expected carrier/software name", severity: "MEDIUM" as Severity, evidence: { pdfAuthor: "John Smith", expectedAuthor: "ProAssurance Claims System", documentType: "LOSS_RUN" }, confidence: 0.65, recommendedAction: "Request loss runs directly from carrier", docIdx: 2 },
        { category: "STATISTICAL" as FraudIndicatorCategory, indicatorName: "Round Number Claim", description: "Malpractice claim reserve is exactly $50,000 — suspicious round figure", severity: "MEDIUM" as Severity, evidence: { roundValues: ["$50,000"], field: "reserveAmount" }, confidence: 0.55, recommendedAction: "Verify claim details with carrier" },
      ],
    },

    // ── 14-17: DECLINED (high risk) ────────────────────────
    {
      idx: 14, insuredName: "SEED: Ironclad Security Services", lob: "General Liability", status: "DECLINED" as SubmissionStatus,
      riskScore: 78, severity: "HIGH" as Severity, channel: "PORTAL" as Channel, brokerId: ericId, assignedUwId: seniorUwId, daysAgo: 21,
      docs: [
        { fileName: "acord125_ironclad.pdf", fileType: "application/pdf", fileSize: 245000, documentType: "ACORD_125" as DocumentType, confidence: 0.94, extractedData: { applicantName: "Ironclad Security Services", naicsCode: "561612", yearEstablished: "2022", annualRevenue: "$1,500,000", numberOfEmployees: "20", lossDisclosure: false, effectiveDate: "04/01/2026", state: "NV" } },
        { fileName: "financial_stmt_ironclad.pdf", fileType: "application/pdf", fileSize: 175000, documentType: "FINANCIAL_STATEMENT" as DocumentType, confidence: 0.88, extractedData: { fiscalYear: "2025", revenue: 1200000, netIncome: 180000, totalAssets: 450000, totalLiabilities: 280000, accountsReceivable: 520000 } },
        { fileName: "loss_run_ironclad.pdf", fileType: "application/pdf", fileSize: 135000, documentType: "LOSS_RUN" as DocumentType, confidence: 0.90, extractedData: { carrier: "Markel", totalClaimCount: 3, totalIncurred: 95000, claims: [{ claimNumber: "CL-IR-001", dateOfLoss: "02/20/2025", claimType: "Assault", status: "Open", paidAmount: 40000, reserveAmount: 30000, totalIncurred: 70000 }, { claimNumber: "CL-IR-002", dateOfLoss: "06/15/2025", claimType: "Property Damage", status: "Closed", paidAmount: 15000, reserveAmount: 0, totalIncurred: 15000 }, { claimNumber: "CL-IR-003", dateOfLoss: "10/01/2025", claimType: "Assault", status: "Open", paidAmount: 5000, reserveAmount: 5000, totalIncurred: 10000 }] } },
        { fileName: "coi_ironclad.pdf", fileType: "application/pdf", fileSize: 92000, documentType: "COI" as DocumentType, confidence: 0.91, extractedData: { insuredName: "Ironclad Security Services", policyNumber: "GL-2024-99321", effectiveDate: "04/01/2024", expirationDate: "04/01/2025", generalLiabilityLimit: "$1,000,000" } },
      ],
      indicators: [
        { category: "CROSS_DOC" as FraudIndicatorCategory, indicatorName: "Revenue Mismatch", description: "Revenue on ACORD 125 ($1,500,000) differs from financial statement ($1,200,000) by 25%", severity: "CRITICAL" as Severity, evidence: { acord125Revenue: "$1,500,000", financialRevenue: "$1,200,000", variance: "25%" }, confidence: 0.95, recommendedAction: "Decline — significant revenue discrepancy indicates potential misrepresentation" },
        { category: "CROSS_DOC" as FraudIndicatorCategory, indicatorName: "Omitted Loss History", description: "ACORD 125 indicates no loss disclosure but loss runs show 3 claims totaling $95,000", severity: "CRITICAL" as Severity, evidence: { lossDisclosure: false, actualClaims: 3, totalIncurred: 95000 }, confidence: 0.99, recommendedAction: "Decline — deliberate concealment of loss history" },
        { category: "RATIO" as FraudIndicatorCategory, indicatorName: "High A/R Ratio", description: "A/R ($520,000) is 43.3% of revenue, exceeding 40% threshold", severity: "HIGH" as Severity, evidence: { accountsReceivable: 520000, revenue: 1200000, ratio: "43.3%" }, confidence: 0.9, recommendedAction: "Possible fictitious revenue — request A/R aging" },
        { category: "TEMPORAL" as FraudIndicatorCategory, indicatorName: "Coverage Gap", description: "Prior COI expired 04/01/2025, new policy requested effective 04/01/2026 — 365-day gap", severity: "HIGH" as Severity, evidence: { priorExpiration: "04/01/2025", requestedEffective: "04/01/2026", gapDays: 365 }, confidence: 0.92, recommendedAction: "Investigate reason for coverage lapse" },
      ],
    },
    {
      idx: 15, insuredName: "SEED: Prestige Consulting Group", lob: "Professional Liability", status: "DECLINED" as SubmissionStatus,
      riskScore: 72, severity: "HIGH" as Severity, channel: "EMAIL" as Channel, brokerId: bobId, assignedUwId: seniorUwId, daysAgo: 17,
      docs: [
        { fileName: "acord125_prestige.pdf", fileType: "application/pdf", fileSize: 240000, documentType: "ACORD_125" as DocumentType, confidence: 0.95, extractedData: { applicantName: "Prestige Consulting Group LLC", naicsCode: "541611", yearEstablished: "2024", annualRevenue: "$2,000,000", numberOfEmployees: "15", effectiveDate: "05/01/2026", state: "DE" } },
        { fileName: "financial_stmt_prestige.pdf", fileType: "application/pdf", fileSize: 170000, documentType: "FINANCIAL_STATEMENT" as DocumentType, confidence: 0.87, extractedData: { fiscalYear: "2025", revenue: 2000000, costOfGoodsSold: 600000, grossProfit: 1400000, netIncome: 800000, totalAssets: 1200000, totalLiabilities: 300000, accountsReceivable: 950000 } },
        { fileName: "entity_doc_prestige.pdf", fileType: "application/pdf", fileSize: 68000, documentType: "ENTITY_DOC" as DocumentType, confidence: 0.86, extractedData: { entityName: "Prestige Consulting Group LLC", entityType: "LLC", stateOfIncorporation: "DE", incorporationDate: "2024-01-10", ein: "99-1234567" } },
      ],
      indicators: [
        { category: "ENTITY_INTEL" as FraudIndicatorCategory, indicatorName: "Recently Incorporated Entity", description: "Entity incorporated 2024-01-10, less than 2 years ago, but claims mature operations with $2M revenue", severity: "HIGH" as Severity, evidence: { incorporationDate: "2024-01-10", claimedRevenue: "$2,000,000", entityAge: "1.1 years" }, confidence: 0.9, recommendedAction: "Request business plan and client references" },
        { category: "RATIO" as FraudIndicatorCategory, indicatorName: "High A/R Ratio", description: "A/R ($950,000) is 47.5% of revenue — critical threshold for potential fictitious revenue", severity: "HIGH" as Severity, evidence: { accountsReceivable: 950000, revenue: 2000000, ratio: "47.5%" }, confidence: 0.92, recommendedAction: "Decline — very high A/R ratio on young entity is a strong fraud signal" },
        { category: "RATIO" as FraudIndicatorCategory, indicatorName: "Unusually High Profit Margin", description: "Net profit margin (40%) vastly exceeds consulting industry average (15-20%)", severity: "HIGH" as Severity, evidence: { netIncome: 800000, revenue: 2000000, margin: "40%", industryAvg: "15-20%" }, confidence: 0.88, recommendedAction: "Verify financial statements with CPA" },
        { category: "STATISTICAL" as FraudIndicatorCategory, indicatorName: "Round Number Revenue", description: "Revenue exactly $2,000,000 — suspicious round figure", severity: "MEDIUM" as Severity, evidence: { roundValues: ["$2,000,000", "$800,000"] }, confidence: 0.6, recommendedAction: "Request detailed revenue records" },
        { category: "ENTITY_INTEL" as FraudIndicatorCategory, indicatorName: "Recent EIN Filing", description: "EIN filed within 6 months of application date", severity: "HIGH" as Severity, evidence: { einFilingEstimate: "2024-01-10", applicationDate: "2026-01-29" }, confidence: 0.75, recommendedAction: "Verify business legitimacy" },
      ],
    },
    {
      idx: 16, insuredName: "SEED: Falcon Trucking Co", lob: "Commercial Auto", status: "DECLINED" as SubmissionStatus,
      riskScore: 68, severity: "HIGH" as Severity, channel: "PORTAL" as Channel, brokerId: dianaId, assignedUwId: seniorUwId, daysAgo: 13,
      docs: [
        { fileName: "acord125_falcon.pdf", fileType: "application/pdf", fileSize: 258000, documentType: "ACORD_125" as DocumentType, confidence: 0.95, extractedData: { applicantName: "Falcon Trucking Co", naicsCode: "484121", yearEstablished: "2018", annualRevenue: "$3,800,000", numberOfEmployees: "30", effectiveDate: "05/15/2026", state: "TX" } },
        { fileName: "fleet_schedule_falcon.xlsx", fileType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", fileSize: 92000, documentType: "FLEET_SCHEDULE" as DocumentType, confidence: 0.87, extractedData: { vehicles: [{ vin: "1FUJGHDV0CLBP8834", year: "2019", make: "Freightliner", model: "Cascadia" }, { vin: "3AKJHHDR8LSLU0091", year: "2020", make: "Peterbilt", model: "389" }], totalVehicles: 2 } },
        { fileName: "loss_run_falcon.pdf", fileType: "application/pdf", fileSize: 148000, documentType: "LOSS_RUN" as DocumentType, confidence: 0.89, extractedData: { carrier: "Progressive Commercial", totalClaimCount: 6, totalIncurred: 280000, claims: [{ claimNumber: "FA-001", dateOfLoss: "01/05/2025", claimType: "Collision", status: "Closed", paidAmount: 45000, reserveAmount: 0, totalIncurred: 45000 }, { claimNumber: "FA-002", dateOfLoss: "03/18/2025", claimType: "Collision", status: "Open", paidAmount: 60000, reserveAmount: 25000, totalIncurred: 85000 }, { claimNumber: "FA-003", dateOfLoss: "05/22/2025", claimType: "Cargo Damage", status: "Closed", paidAmount: 30000, reserveAmount: 0, totalIncurred: 30000 }, { claimNumber: "FA-004", dateOfLoss: "07/10/2025", claimType: "Collision", status: "Open", paidAmount: 35000, reserveAmount: 20000, totalIncurred: 55000 }, { claimNumber: "FA-005", dateOfLoss: "09/01/2025", claimType: "Bodily Injury", status: "Open", paidAmount: 40000, reserveAmount: 25000, totalIncurred: 65000 }, { claimNumber: "FA-006", dateOfLoss: "11/15/2025", claimType: "Property Damage", status: "Closed", paidAmount: 0, reserveAmount: 0, totalIncurred: 0 }] } },
        { fileName: "broker_letter_falcon.pdf", fileType: "application/pdf", fileSize: 48000, documentType: "BROKER_SUBMISSION" as DocumentType, confidence: 0.80, extractedData: { text: "Please disregard the loss history as these were minor incidents. The insured has taken corrective action and this is a time-sensitive renewal. Don't worry about the prior claims." } },
      ],
      indicators: [
        { category: "NLP" as FraudIndicatorCategory, indicatorName: "Manipulation Language Detected", description: "Broker letter contains manipulation phrases: 'disregard the loss history', 'don't worry about the prior claims'", severity: "HIGH" as Severity, evidence: { matchedPhrases: ["disregard the loss history", "don't worry about the prior claims"], context: "Please disregard the loss history..." }, confidence: 0.92, recommendedAction: "Review with extra scrutiny — broker attempting to minimize loss history", docIdx: 3 },
        { category: "NLP" as FraudIndicatorCategory, indicatorName: "Pressure Language Detected", description: "Broker letter uses urgency: 'time-sensitive renewal'", severity: "MEDIUM" as Severity, evidence: { matchedPhrases: ["time-sensitive renewal"] }, confidence: 0.75, recommendedAction: "Apply standard review timeline", docIdx: 3 },
        { category: "STATISTICAL" as FraudIndicatorCategory, indicatorName: "Excessive Claim Frequency", description: "6 claims in 12-month period for 2-vehicle fleet is extremely high frequency", severity: "HIGH" as Severity, evidence: { claimCount: 6, vehicleCount: 2, claimsPerVehicle: 3, periodMonths: 12 }, confidence: 0.95, recommendedAction: "Decline — unacceptable loss ratio" },
        { category: "NLP" as FraudIndicatorCategory, indicatorName: "Loss Concealment Attempt", description: "Broker letter explicitly asks to disregard significant loss history ($280,000 in claims)", severity: "CRITICAL" as Severity, evidence: { brokerInstruction: "disregard the loss history", actualTotalIncurred: 280000, actualClaimCount: 6 }, confidence: 0.97, recommendedAction: "Decline — broker attempting to conceal material losses" },
      ],
    },
    {
      idx: 17, insuredName: "SEED: Diamond Jewelers Exchange", lob: "Inland Marine", status: "DECLINED" as SubmissionStatus,
      riskScore: 65, severity: "HIGH" as Severity, channel: "API" as Channel, brokerId: ericId, assignedUwId: seniorUwId, daysAgo: 8,
      docs: [
        { fileName: "acord125_diamond.pdf", fileType: "application/pdf", fileSize: 252000, documentType: "ACORD_125" as DocumentType, confidence: 0.94, extractedData: { applicantName: "Diamond Jewelers Exchange", naicsCode: "423940", yearEstablished: "2021", annualRevenue: "$6,500,000", numberOfEmployees: "8", effectiveDate: "06/01/2026", state: "NY" } },
        { fileName: "financial_stmt_diamond.pdf", fileType: "application/pdf", fileSize: 185000, documentType: "FINANCIAL_STATEMENT" as DocumentType, confidence: 0.89, extractedData: { fiscalYear: "2025", revenue: 4800000, costOfGoodsSold: 3600000, grossProfit: 1200000, netIncome: 400000, totalAssets: 5200000, totalLiabilities: 3800000 } },
        { fileName: "entity_doc_diamond.pdf", fileType: "application/pdf", fileSize: 70000, documentType: "ENTITY_DOC" as DocumentType, confidence: 0.85, extractedData: { entityName: "Diamond Jewelers Exchange LLC", entityType: "LLC", stateOfIncorporation: "NY", incorporationDate: "2021-06-15" } },
      ],
      indicators: [
        { category: "CROSS_DOC" as FraudIndicatorCategory, indicatorName: "Revenue Mismatch", description: "Revenue on ACORD 125 ($6,500,000) differs from financial statement ($4,800,000) by 35.4%", severity: "CRITICAL" as Severity, evidence: { acord125Revenue: "$6,500,000", financialRevenue: "$4,800,000", variance: "35.4%" }, confidence: 0.97, recommendedAction: "Decline — extreme revenue discrepancy" },
        { category: "STATISTICAL" as FraudIndicatorCategory, indicatorName: "Revenue Per Employee Anomaly", description: "Revenue per employee ($812,500) is extremely high for 8-person operation", severity: "HIGH" as Severity, evidence: { revenue: 6500000, employees: 8, revenuePerEmployee: "$812,500" }, confidence: 0.82, recommendedAction: "Verify employee count and revenue figures" },
        { category: "STATISTICAL" as FraudIndicatorCategory, indicatorName: "Revenue Growth Anomaly", description: "Claimed revenue growth exceeds 30% YoY for a 3-year-old business", severity: "HIGH" as Severity, evidence: { currentRevenue: 6500000, businessAge: "3 years" }, confidence: 0.75, recommendedAction: "Request prior year financial statements" },
      ],
    },

    // ── 18-20: REFERRED_TO_SIU (critical) ──────────────────
    {
      idx: 18, insuredName: "SEED: Phoenix Property Holdings", lob: "Commercial Property", status: "REFERRED_TO_SIU" as SubmissionStatus,
      riskScore: 92, severity: "CRITICAL" as Severity, channel: "PORTAL" as Channel, brokerId: bobId, assignedUwId: seniorUwId, daysAgo: 19,
      docs: [
        { fileName: "acord125_phoenix.pdf", fileType: "application/pdf", fileSize: 275000, documentType: "ACORD_125" as DocumentType, confidence: 0.95, extractedData: { applicantName: "Phoenix Property Holdings LLC", naicsCode: "531110", yearEstablished: "2023", annualRevenue: "$8,000,000", numberOfEmployees: "5", effectiveDate: "04/15/2026", state: "AZ" } },
        { fileName: "acord140_phoenix.pdf", fileType: "application/pdf", fileSize: 220000, documentType: "ACORD_140" as DocumentType, confidence: 0.93, extractedData: { totalInsuredValue: 25000000, deductible: 10000, propertyLocations: [{ address: "4500 E Camelback Rd, Phoenix AZ", buildingValue: 8000000, contentsValue: 5000000, constructionType: "Non-Combustible", yearBuilt: 2005, squareFootage: 45000, occupancy: "Warehouse", condition: "Good" }, { address: "1200 W Van Buren St, Phoenix AZ", buildingValue: 7000000, contentsValue: 5000000, constructionType: "Masonry", yearBuilt: 1995, squareFootage: 38000, occupancy: "Retail", condition: "Fair" }] } },
        { fileName: "financial_stmt_phoenix.pdf", fileType: "application/pdf", fileSize: 190000, documentType: "FINANCIAL_STATEMENT" as DocumentType, confidence: 0.90, extractedData: { fiscalYear: "2025", revenue: 8000000, costOfGoodsSold: 3200000, grossProfit: 4800000, netIncome: 2400000, totalAssets: 18000000, totalLiabilities: 14000000, accountsReceivable: 4800000 } },
        { fileName: "loss_run_phoenix.pdf", fileType: "application/pdf", fileSize: 145000, documentType: "LOSS_RUN" as DocumentType, confidence: 0.89, extractedData: { carrier: "Scottsdale Insurance", totalClaimCount: 2, totalIncurred: 450000, claims: [{ claimNumber: "PH-001", dateOfLoss: "08/01/2025", claimType: "Fire", status: "Open", paidAmount: 200000, reserveAmount: 150000, totalIncurred: 350000 }, { claimNumber: "PH-002", dateOfLoss: "11/20/2025", claimType: "Water Damage", status: "Open", paidAmount: 50000, reserveAmount: 50000, totalIncurred: 100000 }] } },
        { fileName: "entity_doc_phoenix.pdf", fileType: "application/pdf", fileSize: 74000, documentType: "ENTITY_DOC" as DocumentType, confidence: 0.86, extractedData: { entityName: "Phoenix Property Holdings LLC", entityType: "LLC", stateOfIncorporation: "AZ", incorporationDate: "2023-04-01", registeredAgent: "Regus Virtual Office", registeredAgentAddress: "2999 N 44th St Suite 100, Phoenix AZ 85018", officers: [{ name: "James Kessler", title: "Managing Member" }], ein: "88-5551234" } },
        { fileName: "inspection_photo_phoenix.jpg", fileType: "image/jpeg", fileSize: 3500000, documentType: "INSPECTION_PHOTO" as DocumentType, confidence: 0.72, extractedData: { gpsCoordinates: { lat: 34.0522, lng: -118.2437 }, timestamp: "2025-05-10T14:00:00Z" } },
      ],
      indicators: [
        { category: "CROSS_DOC" as FraudIndicatorCategory, indicatorName: "Revenue Mismatch", description: "Revenue on ACORD 125 ($8,000,000) matches financial statement but only 5 employees — $1.6M revenue per employee", severity: "HIGH" as Severity, evidence: { revenue: 8000000, employees: 5, revenuePerEmployee: "$1,600,000" }, confidence: 0.88, recommendedAction: "Investigate shell company possibility" },
        { category: "RATIO" as FraudIndicatorCategory, indicatorName: "Critical A/R Ratio", description: "A/R ($4,800,000) is 60% of revenue — extreme level suggesting fictitious revenue", severity: "CRITICAL" as Severity, evidence: { accountsReceivable: 4800000, revenue: 8000000, ratio: "60%" }, confidence: 0.95, recommendedAction: "Refer to SIU — strong fictitious revenue indicator" },
        { category: "ENTITY_INTEL" as FraudIndicatorCategory, indicatorName: "Virtual Office Address", description: "Registered agent address 'Regus Virtual Office' is a known virtual office provider", severity: "MEDIUM" as Severity, evidence: { address: "2999 N 44th St Suite 100, Phoenix AZ", provider: "Regus", classification: "VIRTUAL_OFFICE" }, confidence: 0.9, recommendedAction: "Verify physical business location" },
        { category: "ENTITY_INTEL" as FraudIndicatorCategory, indicatorName: "Recently Incorporated Entity", description: "Entity incorporated 2023-04-01 (< 2 years) but claims $8M revenue and $25M TIV", severity: "CRITICAL" as Severity, evidence: { incorporationDate: "2023-04-01", claimedRevenue: "$8,000,000", claimedTIV: "$25,000,000", entityAge: "2.9 years" }, confidence: 0.92, recommendedAction: "Investigate entity legitimacy" },
        { category: "VISUAL_AI" as FraudIndicatorCategory, indicatorName: "GPS Location Mismatch", description: "Inspection photo GPS coordinates (34.05°N, 118.24°W) are in Los Angeles, not Phoenix", severity: "CRITICAL" as Severity, evidence: { photoGPS: { lat: 34.0522, lng: -118.2437 }, claimedLocation: "Phoenix, AZ", distance: "370 miles" }, confidence: 0.98, recommendedAction: "Refer to SIU — photos are from wrong location", docIdx: 5 },
        { category: "CROSS_DOC" as FraudIndicatorCategory, indicatorName: "High Contents-to-Building Ratio", description: "Warehouse contents value ($5,000,000) is 62.5% of building value, well above warehouse range (15-50%)", severity: "HIGH" as Severity, evidence: { buildingValue: 8000000, contentsValue: 5000000, ratio: "62.5%", expectedRange: "15-50%", occupancy: "Warehouse" }, confidence: 0.87, recommendedAction: "Request detailed contents inventory" },
      ],
    },
    {
      idx: 19, insuredName: "SEED: Sterling Manufacturing Inc", lob: "Workers Compensation", status: "REFERRED_TO_SIU" as SubmissionStatus,
      riskScore: 88, severity: "CRITICAL" as Severity, channel: "EMAIL" as Channel, brokerId: dianaId, assignedUwId: seniorUwId, daysAgo: 16,
      docs: [
        { fileName: "acord125_sterling.pdf", fileType: "application/pdf", fileSize: 260000, documentType: "ACORD_125" as DocumentType, confidence: 0.94, extractedData: { applicantName: "Sterling Manufacturing Inc", naicsCode: "332710", yearEstablished: "2015", annualRevenue: "$12,000,000", numberOfEmployees: "85", lossDisclosure: true, effectiveDate: "04/01/2026", state: "OH" } },
        { fileName: "acord130_sterling.pdf", fileType: "application/pdf", fileSize: 205000, documentType: "ACORD_130" as DocumentType, confidence: 0.93, extractedData: { totalPayroll: 3200000, eModRate: 1.35, payrollByClassification: [{ classCode: "3632", description: "Machine Shop", payroll: 2000000, employeeCount: 50 }, { classCode: "8810", description: "Clerical", payroll: 1200000, employeeCount: 35 }] } },
        { fileName: "financial_stmt_sterling.pdf", fileType: "application/pdf", fileSize: 200000, documentType: "FINANCIAL_STATEMENT" as DocumentType, confidence: 0.91, extractedData: { fiscalYear: "2025", revenue: 12000000, costOfGoodsSold: 9600000, grossProfit: 2400000, netIncome: 600000, totalAssets: 8500000, totalLiabilities: 6200000, accountsReceivable: 5500000 } },
        { fileName: "payroll_tax_sterling.pdf", fileType: "application/pdf", fileSize: 155000, documentType: "PAYROLL_TAX" as DocumentType, confidence: 0.88, extractedData: { totalPayroll: 4800000, employeeCount: 95 } },
        { fileName: "loss_run_sterling.pdf", fileType: "application/pdf", fileSize: 165000, documentType: "LOSS_RUN" as DocumentType, confidence: 0.90, extractedData: { carrier: "Zurich", totalClaimCount: 8, totalIncurred: 520000, policyPeriod: "04/01/2024 - 04/01/2025", claims: [{ claimNumber: "ST-001", dateOfLoss: "04/15/2024", claimType: "Machine Injury", status: "Open", paidAmount: 120000, reserveAmount: 80000, totalIncurred: 200000 }, { claimNumber: "ST-002", dateOfLoss: "04/28/2024", claimType: "Laceration", status: "Closed", paidAmount: 35000, reserveAmount: 0, totalIncurred: 35000 }, { claimNumber: "ST-003", dateOfLoss: "05/10/2024", claimType: "Fall", status: "Closed", paidAmount: 25000, reserveAmount: 0, totalIncurred: 25000 }, { claimNumber: "ST-004", dateOfLoss: "05/25/2024", claimType: "Strain", status: "Closed", paidAmount: 15000, reserveAmount: 0, totalIncurred: 15000 }, { claimNumber: "ST-005", dateOfLoss: "06/05/2024", claimType: "Burn", status: "Open", paidAmount: 60000, reserveAmount: 40000, totalIncurred: 100000 }, { claimNumber: "ST-006", dateOfLoss: "08/20/2024", claimType: "Repetitive Motion", status: "Closed", paidAmount: 20000, reserveAmount: 0, totalIncurred: 20000 }, { claimNumber: "ST-007", dateOfLoss: "11/10/2024", claimType: "Machine Injury", status: "Open", paidAmount: 45000, reserveAmount: 30000, totalIncurred: 75000 }, { claimNumber: "ST-008", dateOfLoss: "02/01/2025", claimType: "Fall", status: "Open", paidAmount: 30000, reserveAmount: 20000, totalIncurred: 50000 }] } },
      ],
      indicators: [
        { category: "CROSS_DOC" as FraudIndicatorCategory, indicatorName: "Payroll Mismatch", description: "ACORD 130 payroll ($3,200,000) differs from payroll tax records ($4,800,000) by $1,600,000 (50%)", severity: "CRITICAL" as Severity, evidence: { acord130Payroll: 3200000, taxPayroll: 4800000, variance: "$1,600,000", variancePct: "50%" }, confidence: 0.97, recommendedAction: "Refer to SIU — massive payroll underreporting" },
        { category: "CROSS_DOC" as FraudIndicatorCategory, indicatorName: "Employee Count Mismatch", description: "ACORD 125 shows 85 employees, ACORD 130 totals 85, but payroll tax shows 95 employees", severity: "HIGH" as Severity, evidence: { acord125Count: 85, acord130Count: 85, taxCount: 95, difference: 10 }, confidence: 0.93, recommendedAction: "Investigate unreported employees" },
        { category: "RATIO" as FraudIndicatorCategory, indicatorName: "Critical A/R Ratio", description: "A/R ($5,500,000) is 45.8% of revenue — above critical threshold", severity: "HIGH" as Severity, evidence: { accountsReceivable: 5500000, revenue: 12000000, ratio: "45.8%" }, confidence: 0.91, recommendedAction: "Request A/R aging report" },
        { category: "TEMPORAL" as FraudIndicatorCategory, indicatorName: "Claim Timing Cluster", description: "62.5% of claims (5 of 8) occurred within 60 days of policy inception", severity: "HIGH" as Severity, evidence: { claimsInWindow: 5, totalClaims: 8, windowDays: 60, percentInWindow: "62.5%" }, confidence: 0.9, recommendedAction: "Investigate pre-existing injuries" },
        { category: "STATISTICAL" as FraudIndicatorCategory, indicatorName: "Round Number Revenue", description: "Revenue exactly $12,000,000 — suspicious round figure", severity: "MEDIUM" as Severity, evidence: { roundValues: ["$12,000,000"] }, confidence: 0.6, recommendedAction: "Verify revenue figures" },
      ],
    },
    {
      idx: 20, insuredName: "SEED: Nexus Development Corp", lob: "Commercial Property", status: "REFERRED_TO_SIU" as SubmissionStatus,
      riskScore: 95, severity: "CRITICAL" as Severity, channel: "PORTAL" as Channel, brokerId: ericId, assignedUwId: seniorUwId, daysAgo: 6,
      docs: [
        { fileName: "acord125_nexus.pdf", fileType: "application/pdf", fileSize: 280000, documentType: "ACORD_125" as DocumentType, confidence: 0.96, extractedData: { applicantName: "Nexus Development Corp", naicsCode: "236220", yearEstablished: "2024", annualRevenue: "$15,000,000", numberOfEmployees: "12", lossDisclosure: false, effectiveDate: "06/15/2026", state: "FL" } },
        { fileName: "acord140_nexus.pdf", fileType: "application/pdf", fileSize: 225000, documentType: "ACORD_140" as DocumentType, confidence: 0.92, extractedData: { totalInsuredValue: 42000000, deductible: 25000, propertyLocations: [{ address: "9900 Collins Ave, Bal Harbour FL", buildingValue: 22000000, contentsValue: 8000000, constructionType: "Fire Resistive", yearBuilt: 2023, squareFootage: 65000, occupancy: "Mixed Use", condition: "Excellent" }, { address: "500 Brickell Ave, Miami FL", buildingValue: 12000000, contentsValue: 0, constructionType: "Non-Combustible", yearBuilt: 2024, squareFootage: 40000, occupancy: "Office", condition: "Excellent" }] } },
        { fileName: "financial_stmt_nexus.pdf", fileType: "application/pdf", fileSize: 195000, documentType: "FINANCIAL_STATEMENT" as DocumentType, confidence: 0.88, extractedData: { fiscalYear: "2025", revenue: 15000000, costOfGoodsSold: 10500000, grossProfit: 4500000, netIncome: 3000000, totalAssets: 35000000, totalLiabilities: 28000000, accountsReceivable: 9000000 } },
        { fileName: "entity_doc_nexus.pdf", fileType: "application/pdf", fileSize: 72000, documentType: "ENTITY_DOC" as DocumentType, confidence: 0.85, extractedData: { entityName: "Nexus Development Corp", entityType: "Corporation", stateOfIncorporation: "FL", incorporationDate: "2024-03-15", registeredAgent: "Virtual Business Solutions", registeredAgentAddress: "PO Box 44921, Miami FL 33101", officers: [{ name: "James Kessler", title: "CEO" }, { name: "Robert Chen", title: "CFO" }], ein: "92-8765432" } },
        { fileName: "broker_letter_nexus.pdf", fileType: "application/pdf", fileSize: 50000, documentType: "BROKER_SUBMISSION" as DocumentType, confidence: 0.81, extractedData: { text: "Nexus Development is a fast-growing real estate firm. Please ignore any issues with the loss history — the prior carrier was difficult to work with. We need this bound urgently as the closing is this Friday." } },
        { fileName: "inspection_nexus.jpg", fileType: "image/jpeg", fileSize: 4200000, documentType: "INSPECTION_PHOTO" as DocumentType, confidence: 0.70, extractedData: { gpsCoordinates: null, timestamp: null } },
      ],
      indicators: [
        { category: "ENTITY_INTEL" as FraudIndicatorCategory, indicatorName: "Cross-Submission Entity Match", description: "Officer 'James Kessler' also appears as Managing Member of Phoenix Property Holdings LLC (submission #18)", severity: "CRITICAL" as Severity, evidence: { matchedName: "James Kessler", currentSubmission: "Nexus Development Corp", priorSubmission: "Phoenix Property Holdings LLC", matchType: "exact_name" }, confidence: 0.97, recommendedAction: "Refer to SIU — potential fraud ring" },
        { category: "ENTITY_INTEL" as FraudIndicatorCategory, indicatorName: "Virtual Office / PO Box Address", description: "Registered agent address is a PO Box (PO Box 44921, Miami FL)", severity: "MEDIUM" as Severity, evidence: { address: "PO Box 44921, Miami FL 33101", classification: "PO_BOX" }, confidence: 0.95, recommendedAction: "Verify physical business location" },
        { category: "ENTITY_INTEL" as FraudIndicatorCategory, indicatorName: "Recently Incorporated Entity", description: "Entity incorporated 2024-03-15 (< 2 years) but claims $15M revenue and $42M TIV", severity: "CRITICAL" as Severity, evidence: { incorporationDate: "2024-03-15", claimedRevenue: "$15,000,000", claimedTIV: "$42,000,000" }, confidence: 0.93, recommendedAction: "Investigate shell company" },
        { category: "CROSS_DOC" as FraudIndicatorCategory, indicatorName: "Omitted Loss History", description: "ACORD 125 indicates no loss disclosure but broker letter references 'issues with loss history'", severity: "CRITICAL" as Severity, evidence: { lossDisclosure: false, brokerLetterReference: "ignore any issues with the loss history" }, confidence: 0.96, recommendedAction: "Refer to SIU — deliberate concealment" },
        { category: "NLP" as FraudIndicatorCategory, indicatorName: "Manipulation Language Detected", description: "Broker letter: 'ignore any issues with the loss history'", severity: "HIGH" as Severity, evidence: { matchedPhrases: ["ignore any issues", "urgently"], context: "Please ignore any issues with the loss history" }, confidence: 0.9, recommendedAction: "Flag broker for pattern review", docIdx: 4 },
        { category: "RATIO" as FraudIndicatorCategory, indicatorName: "Critical A/R Ratio", description: "A/R ($9,000,000) is 60% of revenue", severity: "CRITICAL" as Severity, evidence: { accountsReceivable: 9000000, revenue: 15000000, ratio: "60%" }, confidence: 0.95, recommendedAction: "Strong fictitious revenue indicator" },
        { category: "VISUAL_AI" as FraudIndicatorCategory, indicatorName: "EXIF Data Stripped", description: "Inspection photo has no GPS or timestamp data", severity: "HIGH" as Severity, evidence: { hasGPS: false, hasTimestamp: false }, confidence: 0.75, recommendedAction: "Request geotagged inspection photos", docIdx: 5 },
      ],
    },
  ];

  // ─── Create Submissions, Documents, Indicators, Audit Logs ─
  console.log("\nCreating 20 seed submissions...");

  const submissionIds: string[] = [];

  for (const sub of submissions) {
    // Create submission
    const submission = await prisma.submission.create({
      data: {
        tenantId: tenant.id,
        submitterId: sub.brokerId,
        insuredName: sub.insuredName,
        lineOfBusiness: sub.lob,
        status: sub.status,
        riskScore: sub.riskScore,
        severity: sub.severity,
        channel: sub.channel,
        assignedUnderwriterId: sub.assignedUwId,
        createdAt: daysAgo(sub.daysAgo),
        updatedAt: daysAgo(sub.daysAgo),
      },
    });
    submissionIds.push(submission.id);

    // Create documents
    const docIds: string[] = [];
    for (const doc of sub.docs) {
      const document = await prisma.document.create({
        data: {
          submissionId: submission.id,
          tenantId: tenant.id,
          fileName: doc.fileName,
          fileType: doc.fileType,
          fileSize: doc.fileSize,
          s3Key: `${tenant.id}/${submission.id}/seed/${doc.fileName}`,
          documentType: doc.documentType,
          classificationConfidence: doc.confidence,
          extractedData: jsonClone(doc.extractedData) as object,
          status: "ANALYZED" as DocumentStatus,
          createdAt: daysAgo(sub.daysAgo),
        },
      });
      docIds.push(document.id);
    }

    // Create fraud indicators
    for (const ind of sub.indicators) {
      await prisma.fraudIndicator.create({
        data: {
          submissionId: submission.id,
          tenantId: tenant.id,
          documentId: ind.docIdx !== undefined ? docIds[ind.docIdx] : null,
          category: ind.category,
          indicatorName: ind.indicatorName,
          description: ind.description,
          severity: ind.severity,
          evidence: jsonClone(ind.evidence) as object,
          confidence: ind.confidence,
          recommendedAction: ind.recommendedAction,
          createdAt: daysAgo(sub.daysAgo),
        },
      });
    }

    // Create audit log for submission creation
    await prisma.auditLog.create({
      data: {
        tenantId: tenant.id,
        submissionId: submission.id,
        userId: sub.brokerId,
        action: "SUBMISSION_CREATED",
        details: jsonClone({ insuredName: sub.insuredName, lineOfBusiness: sub.lob, channel: sub.channel }),
        createdAt: daysAgo(sub.daysAgo),
      },
    });

    // Create processing audit logs
    await prisma.auditLog.create({
      data: {
        tenantId: tenant.id,
        submissionId: submission.id,
        action: "PROCESSING_STARTED",
        details: jsonClone({ documentCount: sub.docs.length }),
        createdAt: daysAgo(sub.daysAgo),
      },
    });

    await prisma.auditLog.create({
      data: {
        tenantId: tenant.id,
        submissionId: submission.id,
        action: "PROCESSING_COMPLETED",
        details: jsonClone({ riskScore: sub.riskScore, severity: sub.severity, indicatorCount: sub.indicators.length }),
        createdAt: daysAgo(sub.daysAgo),
      },
    });

    // Create routing audit log based on status
    if (sub.status === "APPROVED") {
      await prisma.auditLog.create({
        data: {
          tenantId: tenant.id,
          submissionId: submission.id,
          action: "SUBMISSION_APPROVED",
          details: jsonClone({ reason: "Auto-approved: risk score below threshold", riskScore: sub.riskScore }),
          createdAt: daysAgo(sub.daysAgo),
        },
      });
    } else if (sub.status === "DECLINED") {
      await prisma.auditLog.create({
        data: {
          tenantId: tenant.id,
          submissionId: submission.id,
          userId: sub.assignedUwId,
          action: "SUBMISSION_DECLINED",
          details: jsonClone({ reason: "Declined by underwriter after review", riskScore: sub.riskScore, severity: sub.severity }),
          createdAt: daysAgo(sub.daysAgo - 1),
        },
      });
    } else if (sub.status === "REFERRED_TO_SIU") {
      await prisma.auditLog.create({
        data: {
          tenantId: tenant.id,
          submissionId: submission.id,
          action: "SIU_REFERRAL",
          details: jsonClone({ reason: "Auto-referred: CRITICAL fraud indicators detected", riskScore: sub.riskScore, severity: sub.severity }),
          createdAt: daysAgo(sub.daysAgo),
        },
      });
    } else if (sub.status === "UNDER_REVIEW") {
      await prisma.auditLog.create({
        data: {
          tenantId: tenant.id,
          submissionId: submission.id,
          action: "SUBMISSION_ESCALATED",
          details: jsonClone({ reason: "Escalated for review: risk score above threshold", riskScore: sub.riskScore, assignedTo: sub.assignedUwId }),
          createdAt: daysAgo(sub.daysAgo),
        },
      });
    }

    // Fraud flag raised audit logs
    for (const ind of sub.indicators) {
      if (ind.severity === "CRITICAL" || ind.severity === "HIGH") {
        await prisma.auditLog.create({
          data: {
            tenantId: tenant.id,
            submissionId: submission.id,
            action: "FRAUD_FLAG_RAISED",
            details: jsonClone({ indicatorName: ind.indicatorName, severity: ind.severity, category: ind.category }),
            createdAt: daysAgo(sub.daysAgo),
          },
        });
      }
    }

    console.log(`  [${sub.idx}/20] ${sub.insuredName} — ${sub.status} (score: ${sub.riskScore})`);
  }

  // ─── SIU Cases ───────────────────────────────────────────
  console.log("\nCreating SIU cases...");

  // SIU Case 1: Phoenix Property Holdings (submission 18) — INVESTIGATING
  const phoenixSubId = submissionIds[17]; // index 17 = submission 18
  await prisma.sIUCase.create({
    data: {
      tenantId: tenant.id,
      submissionId: phoenixSubId,
      status: "INVESTIGATING" as SIUCaseStatus,
      assignedToId: siuId,
      notes: jsonClone([
        { userId: siuId, text: "Case opened automatically due to CRITICAL fraud indicators. GPS mismatch on inspection photos is particularly concerning — photos appear to be from Los Angeles, not Phoenix.", timestamp: daysAgo(19).toISOString() },
        { userId: siuId, text: "Cross-referenced James Kessler against public records. Found multiple LLCs registered in AZ and FL in the past 2 years, all with virtual office addresses.", timestamp: daysAgo(15).toISOString() },
        { userId: siuId, text: "Requested property tax records from Maricopa County. A/R ratio at 60% strongly suggests fictitious revenue. Beginning deeper financial analysis.", timestamp: daysAgo(10).toISOString() },
      ]),
      evidence: jsonClone([
        { type: "document", url: "internal://investigation/phoenix-public-records.pdf", description: "Public records search for James Kessler — 4 LLCs in 24 months", timestamp: daysAgo(15).toISOString() },
        { type: "screenshot", url: "internal://investigation/phoenix-maps-comparison.png", description: "Google Maps comparison of GPS coordinates vs claimed property location", timestamp: daysAgo(14).toISOString() },
      ]),
      createdAt: daysAgo(19),
      updatedAt: daysAgo(10),
    },
  });
  console.log("  SIU Case 1: Phoenix Property Holdings (INVESTIGATING)");

  // SIU Case 2: Nexus Development Corp (submission 20) — OPEN
  const nexusSubId = submissionIds[19]; // index 19 = submission 20
  await prisma.sIUCase.create({
    data: {
      tenantId: tenant.id,
      submissionId: nexusSubId,
      status: "OPEN" as SIUCaseStatus,
      assignedToId: siuId,
      notes: jsonClone([
        { userId: siuId, text: "Case opened automatically due to CRITICAL fraud indicators. James Kessler also appears in Phoenix Property Holdings case — potential fraud ring. Same pattern: new LLC, virtual office, inflated TIV, stripped inspection photos.", timestamp: daysAgo(6).toISOString() },
      ]),
      evidence: jsonClone([]),
      createdAt: daysAgo(6),
      updatedAt: daysAgo(6),
    },
  });
  console.log("  SIU Case 2: Nexus Development Corp (OPEN)");

  console.log("\nSeed completed successfully.");
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
