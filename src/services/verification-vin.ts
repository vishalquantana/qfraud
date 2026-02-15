import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/logger";

const log = createLogger("verification-vin");

// ─── Types ──────────────────────────────────────────────

export interface NHTSADecodedVIN {
  vin: string;
  year: number | null;
  make: string | null;
  model: string | null;
  vehicleType: string | null;
  bodyClass: string | null;
  gvwr: string | null;
  errorCode: string | null;
  errorText: string | null;
}

export interface FleetScheduleExtractedData {
  vehicles: Array<{
    vin: string | null;
    year: number | null;
    make: string | null;
    model: string | null;
    vehicleType: string | null;
    driverName: string | null;
    driverLicenseState: string | null;
    driverLicenseNumber: string | null;
    driverLicenseClass: string | null;
  }>;
  totalVehicles: number | null;
}

// ─── NHTSA VIN Decoder API ──────────────────────────────

/**
 * Decode a VIN using the NHTSA VIN Decoder API.
 * This is a free public API that does not require authentication.
 *
 * @see https://vpic.nhtsa.dot.gov/api/
 */
export async function decodeVIN(vin: string): Promise<NHTSADecodedVIN> {
  const cleanVIN = vin.trim().toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, "");

  if (cleanVIN.length !== 17) {
    return {
      vin: cleanVIN,
      year: null,
      make: null,
      model: null,
      vehicleType: null,
      bodyClass: null,
      gvwr: null,
      errorCode: "INVALID_LENGTH",
      errorText: `VIN must be 17 characters, got ${cleanVIN.length}`,
    };
  }

  try {
    const response = await fetch(
      `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${cleanVIN}?format=json`,
      { signal: AbortSignal.timeout(10000) },
    );

    if (!response.ok) {
      throw new Error(`NHTSA API returned ${response.status}`);
    }

    const data = (await response.json()) as {
      Results: Array<Record<string, string | null>>;
    };

    if (!data.Results || data.Results.length === 0) {
      throw new Error("No results from NHTSA API");
    }

    const result = data.Results[0];

    const yearStr = result["ModelYear"];
    const year = yearStr ? parseInt(yearStr, 10) : null;

    return {
      vin: cleanVIN,
      year: year && !isNaN(year) ? year : null,
      make: result["Make"] || null,
      model: result["Model"] || null,
      vehicleType: result["VehicleType"] || null,
      bodyClass: result["BodyClass"] || null,
      gvwr: result["GVWR"] || null,
      errorCode: result["ErrorCode"] || null,
      errorText: result["ErrorText"] || null,
    };
  } catch (err) {
    // On API failure, return a result indicating failure
    return {
      vin: cleanVIN,
      year: null,
      make: null,
      model: null,
      vehicleType: null,
      bodyClass: null,
      gvwr: null,
      errorCode: "API_ERROR",
      errorText:
        err instanceof Error ? err.message : "NHTSA API call failed",
    };
  }
}

// ─── Helpers ────────────────────────────────────────────

async function findExtractedData<T>(
  submissionId: string,
  documentType: string,
): Promise<{ data: T; documentId: string } | null> {
  const doc = await prisma.document.findFirst({
    where: {
      submissionId,
      documentType: documentType as never,
      status: "ANALYZED",
    },
    orderBy: { createdAt: "desc" },
  });

  if (!doc || !doc.extractedData) return null;

  return {
    data: doc.extractedData as unknown as T,
    documentId: doc.id,
  };
}

/**
 * Retry wrapper for API calls with exponential backoff.
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
): Promise<T> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries - 1) {
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}

// ─── Commercial Vehicle Detection ───────────────────────

/**
 * Commercial vehicle types that require CDL.
 */
const COMMERCIAL_VEHICLE_TYPES = [
  "truck",
  "bus",
  "trailer",
  "motorcoach",
  "tractor",
  "semi",
  "heavy",
  "medium duty",
  "large",
];

/**
 * CDL license classes.
 */
const CDL_CLASSES = ["A", "B", "C", "CDL-A", "CDL-B", "CDL-C", "CDL", "CLASS A", "CLASS B", "CLASS C"];

function isCommercialVehicle(decoded: NHTSADecodedVIN): boolean {
  const vehicleType = (decoded.vehicleType || "").toLowerCase();
  const bodyClass = (decoded.bodyClass || "").toLowerCase();
  const gvwr = (decoded.gvwr || "").toLowerCase();

  // Check vehicle type
  if (COMMERCIAL_VEHICLE_TYPES.some((t) => vehicleType.includes(t))) {
    return true;
  }

  // Check body class
  if (COMMERCIAL_VEHICLE_TYPES.some((t) => bodyClass.includes(t))) {
    return true;
  }

  // Check GVWR > 26,001 lbs (CDL threshold)
  const gvwrMatch = gvwr.match(/(\d[\d,]*)/);
  if (gvwrMatch) {
    const weight = parseInt(gvwrMatch[1].replace(/,/g, ""), 10);
    if (!isNaN(weight) && weight > 26001) {
      return true;
    }
  }

  return false;
}

function isCDLLicense(licenseClass: string | null): boolean {
  if (!licenseClass) return false;
  const upper = licenseClass.toUpperCase().trim();
  return CDL_CLASSES.some((c) => upper === c || upper.includes(c));
}

// ─── VIN Mismatch Check ────────────────────────────────

async function checkVINMismatch(
  submissionId: string,
  tenantId: string,
  documentId: string,
  vehicle: FleetScheduleExtractedData["vehicles"][0],
  decoded: NHTSADecodedVIN,
): Promise<void> {
  const mismatches: string[] = [];

  // Check year mismatch
  if (vehicle.year && decoded.year && vehicle.year !== decoded.year) {
    mismatches.push(
      `Year: stated ${vehicle.year}, VIN decodes to ${decoded.year}`,
    );
  }

  // Check make mismatch (case-insensitive comparison)
  if (vehicle.make && decoded.make) {
    const statedMake = vehicle.make.toUpperCase().trim();
    const decodedMake = decoded.make.toUpperCase().trim();
    if (
      statedMake !== decodedMake &&
      !statedMake.includes(decodedMake) &&
      !decodedMake.includes(statedMake)
    ) {
      mismatches.push(
        `Make: stated "${vehicle.make}", VIN decodes to "${decoded.make}"`,
      );
    }
  }

  // Check model mismatch (case-insensitive comparison)
  if (vehicle.model && decoded.model) {
    const statedModel = vehicle.model.toUpperCase().trim();
    const decodedModel = decoded.model.toUpperCase().trim();
    if (
      statedModel !== decodedModel &&
      !statedModel.includes(decodedModel) &&
      !decodedModel.includes(statedModel)
    ) {
      mismatches.push(
        `Model: stated "${vehicle.model}", VIN decodes to "${decoded.model}"`,
      );
    }
  }

  if (mismatches.length === 0) return;

  await prisma.fraudIndicator.create({
    data: {
      submissionId,
      tenantId,
      documentId,
      category: "API_VERIFY",
      indicatorName: "VIN Does Not Match Stated Vehicle Info",
      description: `Vehicle with VIN ${decoded.vin} has ${mismatches.length} mismatch(es) between stated and NHTSA-decoded information: ${mismatches.join("; ")}.`,
      severity: "CRITICAL",
      evidence: JSON.parse(
        JSON.stringify({
          vin: decoded.vin,
          statedYear: vehicle.year,
          decodedYear: decoded.year,
          statedMake: vehicle.make,
          decodedMake: decoded.make,
          statedModel: vehicle.model,
          decodedModel: decoded.model,
          mismatches,
          verificationSource: "NHTSA VIN Decoder API",
        }),
      ),
      confidence: 0.9,
      recommendedAction:
        "Verify the VIN is correct. Request updated fleet schedule with corrected vehicle information. Check if the vehicle was intentionally misrepresented.",
    },
  });
}

// ─── Non-CDL Driver on Commercial Vehicle Check ─────────

async function checkNonCDLDriver(
  submissionId: string,
  tenantId: string,
  documentId: string,
  vehicle: FleetScheduleExtractedData["vehicles"][0],
  decoded: NHTSADecodedVIN,
): Promise<void> {
  if (!isCommercialVehicle(decoded)) return;

  // Check if driver license class is CDL
  if (isCDLLicense(vehicle.driverLicenseClass)) return;

  // If no license class info, skip — can't verify
  if (!vehicle.driverName && !vehicle.driverLicenseNumber) return;

  await prisma.fraudIndicator.create({
    data: {
      submissionId,
      tenantId,
      documentId,
      category: "API_VERIFY",
      indicatorName: "Non-CDL Driver Assigned to Commercial Vehicle",
      description: `Driver "${vehicle.driverName || "Unknown"}" is assigned to a commercial vehicle (${decoded.vehicleType || decoded.bodyClass || "commercial type"}) with VIN ${decoded.vin}, but does not have a CDL license class on file${vehicle.driverLicenseClass ? ` (license class: ${vehicle.driverLicenseClass})` : ""}.`,
      severity: "HIGH",
      evidence: JSON.parse(
        JSON.stringify({
          vin: decoded.vin,
          vehicleType: decoded.vehicleType,
          bodyClass: decoded.bodyClass,
          gvwr: decoded.gvwr,
          driverName: vehicle.driverName,
          driverLicenseState: vehicle.driverLicenseState,
          driverLicenseNumber: vehicle.driverLicenseNumber,
          driverLicenseClass: vehicle.driverLicenseClass,
          isCommercialVehicle: true,
          hasCDL: false,
          verificationSource: "NHTSA VIN Decoder API + Fleet Schedule",
        }),
      ),
      confidence: 0.75,
      recommendedAction:
        "Verify driver's license class. Request updated MVR or CDL documentation for the assigned driver. Ensure all commercial vehicle operators hold appropriate CDL endorsements.",
    },
  });
}

// ─── Main Functions ─────────────────────────────────────

/**
 * Validate all VINs in fleet schedule documents for a submission.
 *
 * For each VIN found in fleet schedule extracted data:
 * 1. Decode the VIN using NHTSA API
 * 2. Check if decoded year/make/model matches stated values (CRITICAL if mismatch)
 * 3. Check if non-CDL driver is assigned to a commercial vehicle (HIGH)
 *
 * Creates FraudIndicator records with category API_VERIFY.
 */
export async function validateFleetVINs(submissionId: string): Promise<void> {
  const submission = await prisma.submission.findUniqueOrThrow({
    where: { id: submissionId },
    select: { tenantId: true },
  });

  const tenantId = submission.tenantId;

  // Find fleet schedule documents
  const fleetData = await findExtractedData<FleetScheduleExtractedData>(
    submissionId,
    "FLEET_SCHEDULE",
  );

  if (!fleetData) return; // Skip gracefully if no fleet schedule

  const { data, documentId } = fleetData;

  if (!data.vehicles || data.vehicles.length === 0) return;

  // Decode and validate each VIN
  for (const vehicle of data.vehicles) {
    if (!vehicle.vin) continue;

    let decoded: NHTSADecodedVIN;
    try {
      decoded = await withRetry(() => decodeVIN(vehicle.vin!));
    } catch {
      log.error(
        { vin: vehicle.vin, submissionId },
        "VIN decode failed, skipping"
      );
      continue;
    }

    // Skip if API returned an error (invalid VIN, etc.)
    if (decoded.errorCode === "API_ERROR") continue;

    // Run checks in parallel for this vehicle
    await Promise.all([
      checkVINMismatch(submissionId, tenantId, documentId, vehicle, decoded),
      checkNonCDLDriver(submissionId, tenantId, documentId, vehicle, decoded),
    ]);
  }
}
