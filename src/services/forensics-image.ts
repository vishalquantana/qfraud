import { prisma } from "@/lib/prisma";
import { getFromS3 } from "@/lib/s3";

// ─── Types ──────────────────────────────────────────────

interface ExifData {
  gpsLatitude: number | null;
  gpsLongitude: number | null;
  dateTimeOriginal: Date | null;
  dateTimeDigitized: Date | null;
  dateTime: Date | null;
  make: string | null;
  model: string | null;
  software: string | null;
  hasExif: boolean;
}

interface GpsCoordinate {
  latitude: number;
  longitude: number;
}

// ─── EXIF Extraction ────────────────────────────────────

/**
 * Find the EXIF APP1 marker in a JPEG/TIFF buffer and return the raw EXIF segment.
 * JPEG files embed EXIF in an APP1 marker (0xFFE1) with "Exif\0\0" header.
 * TIFF files start with the TIFF header directly (II or MM).
 */
function findExifSegment(buffer: Buffer): Buffer | null {
  // TIFF files: the entire file IS the TIFF data
  if (
    buffer.length >= 4 &&
    ((buffer[0] === 0x49 && buffer[1] === 0x49) ||
      (buffer[0] === 0x4d && buffer[1] === 0x4d))
  ) {
    return buffer;
  }

  // JPEG files: search for APP1 marker (0xFF 0xE1)
  if (buffer.length < 2 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return null; // Not a JPEG
  }

  let offset = 2;
  while (offset < buffer.length - 4) {
    if (buffer[offset] !== 0xff) {
      offset++;
      continue;
    }

    const marker = buffer[offset + 1];
    const segmentLength = buffer.readUInt16BE(offset + 2);

    // APP1 marker
    if (marker === 0xe1) {
      const segmentData = buffer.subarray(offset + 4, offset + 2 + segmentLength);
      // Check for "Exif\0\0" header
      if (
        segmentData.length >= 6 &&
        segmentData[0] === 0x45 &&
        segmentData[1] === 0x78 &&
        segmentData[2] === 0x69 &&
        segmentData[3] === 0x66 &&
        segmentData[4] === 0x00 &&
        segmentData[5] === 0x00
      ) {
        // Return the TIFF data (after "Exif\0\0" header)
        return Buffer.from(segmentData.subarray(6));
      }
    }

    // Move to next marker
    offset += 2 + segmentLength;
  }

  return null;
}

/**
 * Convert GPS DMS (degrees, minutes, seconds) array + ref to decimal degrees.
 */
function convertGpsDms(
  dms: number[],
  ref: string | undefined,
): number | null {
  if (!dms || dms.length < 3) return null;
  const [degrees, minutes, seconds] = dms;
  let decimal = degrees + minutes / 60 + seconds / 3600;
  if (ref === "S" || ref === "W") {
    decimal = -decimal;
  }
  return decimal;
}

/**
 * Extract EXIF data from an image buffer.
 * Supports JPEG, TIFF, and PNG files (PNG typically won't have EXIF).
 */
function extractExifData(buffer: Buffer): ExifData {
  const noExif: ExifData = {
    gpsLatitude: null,
    gpsLongitude: null,
    dateTimeOriginal: null,
    dateTimeDigitized: null,
    dateTime: null,
    make: null,
    model: null,
    software: null,
    hasExif: false,
  };

  try {
    const exifSegment = findExifSegment(buffer);
    if (!exifSegment) return noExif;

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const exifReader = require("exif-reader");
    const parsed = exifReader(exifSegment);

    const gps = parsed.GPSInfo;
    const photo = parsed.Photo;
    const image = parsed.Image;

    let gpsLatitude: number | null = null;
    let gpsLongitude: number | null = null;

    if (gps?.GPSLatitude && gps?.GPSLongitude) {
      gpsLatitude = convertGpsDms(gps.GPSLatitude, gps.GPSLatitudeRef);
      gpsLongitude = convertGpsDms(gps.GPSLongitude, gps.GPSLongitudeRef);
    }

    return {
      gpsLatitude,
      gpsLongitude,
      dateTimeOriginal: photo?.DateTimeOriginal instanceof Date ? photo.DateTimeOriginal : null,
      dateTimeDigitized: photo?.DateTimeDigitized instanceof Date ? photo.DateTimeDigitized : null,
      dateTime: image?.DateTime instanceof Date ? image.DateTime : null,
      make: typeof image?.Make === "string" ? image.Make : null,
      model: typeof image?.Model === "string" ? image.Model : null,
      software: typeof image?.Software === "string" ? image.Software : null,
      hasExif: true,
    };
  } catch {
    // EXIF parsing failed — not necessarily an error, some images don't have EXIF
    return noExif;
  }
}

// ─── GPS Distance Calculation ───────────────────────────

/**
 * Calculate the distance in miles between two GPS coordinates using the Haversine formula.
 */
function haversineDistanceMiles(a: GpsCoordinate, b: GpsCoordinate): number {
  const R = 3958.8; // Earth's radius in miles
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;

  const x =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  return R * c;
}

/**
 * Geocode an address to approximate GPS coordinates using a simple heuristic.
 * In production, this would call a geocoding API (Google Maps, Mapbox, etc.).
 * For MVP, returns null (we can only flag when GPS is present but can't compare without geocoding).
 */
function geocodeAddress(_address: string): GpsCoordinate | null {
  // MVP stub: real implementation would call a geocoding API
  // For now, return null — GPS vs address comparison requires a geocoding service
  return null;
}

// ─── Forensic Checks ───────────────────────────────────

/**
 * Analyze a single image for EXIF forensics.
 * Returns the EXIF data and any flags found.
 */
async function analyzeImageExif(
  documentId: string,
  submissionId: string,
  tenantId: string,
  fileName: string,
  buffer: Buffer,
  claimedAddress: string | null,
): Promise<void> {
  const exif = extractExifData(buffer);

  // ─── Check 1: GPS vs claimed property address ──────────
  if (exif.gpsLatitude !== null && exif.gpsLongitude !== null && claimedAddress) {
    const photoLocation: GpsCoordinate = {
      latitude: exif.gpsLatitude,
      longitude: exif.gpsLongitude,
    };

    const addressLocation = geocodeAddress(claimedAddress);
    if (addressLocation) {
      const distanceMiles = haversineDistanceMiles(photoLocation, addressLocation);

      if (distanceMiles > 1) {
        await prisma.fraudIndicator.create({
          data: {
            submissionId,
            tenantId,
            documentId,
            category: "VISUAL_AI",
            indicatorName: "PHOTO_GPS_MISMATCH",
            description: `Inspection photo GPS coordinates (${exif.gpsLatitude.toFixed(4)}, ${exif.gpsLongitude.toFixed(4)}) are ${distanceMiles.toFixed(1)} miles from the claimed property address. This may indicate photos were taken at a different location.`,
            severity: "CRITICAL",
            evidence: JSON.parse(
              JSON.stringify({
                photoLatitude: exif.gpsLatitude,
                photoLongitude: exif.gpsLongitude,
                claimedAddress,
                distanceMiles: Math.round(distanceMiles * 10) / 10,
                documentId,
                fileName,
              }),
            ),
            confidence: 0.9,
            recommendedAction:
              "Verify the property address and request new inspection photos with GPS metadata enabled. Consider on-site verification.",
          },
        });
      }
    }
  }

  // ─── Check 2: Stripped EXIF metadata ───────────────────
  if (!exif.hasExif) {
    await prisma.fraudIndicator.create({
      data: {
        submissionId,
        tenantId,
        documentId,
        category: "VISUAL_AI",
        indicatorName: "EXIF_DATA_STRIPPED",
        description: `Inspection photo "${fileName}" has no EXIF metadata. EXIF data is automatically embedded by cameras and phones; its absence may indicate the image was processed or manipulated to remove identifying information.`,
        severity: "HIGH",
        evidence: JSON.parse(
          JSON.stringify({
            hasExif: false,
            documentId,
            fileName,
          }),
        ),
        confidence: 0.7,
        recommendedAction:
          "Request original unmodified photos directly from the camera or phone used during inspection. Verify the inspector's identity and inspection date.",
      },
    });
    return; // No more EXIF checks possible without data
  }

  // ─── Check 3: Photo timestamp span analysis ───────────
  // (Handled at the submission level in analyzeTimestampSpan below)
}

/**
 * Analyze whether photo timestamps across a multi-photo inspection span a suspiciously short time.
 * If >3 photos were taken and >50% have timestamps within a few minutes of each other,
 * this suggests the photos may not be from a real multi-hour inspection.
 */
async function analyzeTimestampSpan(
  submissionId: string,
  tenantId: string,
  photoExifData: Array<{
    documentId: string;
    fileName: string;
    dateTimeOriginal: Date | null;
  }>,
): Promise<void> {
  // Only photos with valid timestamps
  const photosWithTimestamps = photoExifData.filter(
    (p) => p.dateTimeOriginal !== null,
  );

  if (photosWithTimestamps.length < 3) return; // Need at least 3 timestamped photos

  // Sort by timestamp
  const sorted = [...photosWithTimestamps].sort(
    (a, b) => a.dateTimeOriginal!.getTime() - b.dateTimeOriginal!.getTime(),
  );

  const earliest = sorted[0].dateTimeOriginal!;
  const latest = sorted[sorted.length - 1].dateTimeOriginal!;
  const spanMinutes = (latest.getTime() - earliest.getTime()) / (1000 * 60);

  // Flag if all photos were taken within 10 minutes for a multi-photo inspection
  if (spanMinutes < 10 && sorted.length >= 3) {
    await prisma.fraudIndicator.create({
      data: {
        submissionId,
        tenantId,
        documentId: null,
        category: "VISUAL_AI",
        indicatorName: "INSPECTION_PHOTO_TIMESTAMP_CLUSTER",
        description: `${sorted.length} inspection photos were all taken within ${Math.round(spanMinutes)} minutes. A thorough property inspection typically requires more time, suggesting photos may be from a cursory or staged inspection.`,
        severity: "MEDIUM",
        evidence: JSON.parse(
          JSON.stringify({
            photoCount: sorted.length,
            spanMinutes: Math.round(spanMinutes * 10) / 10,
            earliestPhoto: {
              fileName: sorted[0].fileName,
              timestamp: earliest.toISOString(),
            },
            latestPhoto: {
              fileName: sorted[sorted.length - 1].fileName,
              timestamp: latest.toISOString(),
            },
          }),
        ),
        confidence: 0.6,
        recommendedAction:
          "Review inspection photos for completeness. Request additional photos with timestamps from the inspector.",
      },
    });
  }
}

/**
 * Error Level Analysis (ELA) stub.
 * In production, this would re-compress the image at a known quality level
 * and compare differences to detect localized modifications.
 * Returns low-confidence placeholder results ready for ML model integration.
 */
async function analyzeELA(
  _documentId: string,
  _buffer: Buffer,
): Promise<{ isManipulated: boolean; confidence: number; regions: string[] }> {
  // Stub: returns no manipulation detected with low confidence
  // Real implementation would:
  // 1. Re-save JPEG at 95% quality
  // 2. Compute pixel-level difference with original
  // 3. Detect regions with abnormally high error levels (indicating manipulation)
  return {
    isManipulated: false,
    confidence: 0.1, // Very low confidence — this is a stub
    regions: [],
  };
}

/**
 * Copy-move detection stub.
 * In production, this would use keypoint matching (e.g., SIFT/SURF features)
 * to detect duplicated regions within an image.
 * Returns placeholder results ready for ML model integration.
 */
async function detectCopyMove(
  _documentId: string,
  _buffer: Buffer,
): Promise<{ detected: boolean; confidence: number; matchedRegions: number }> {
  // Stub: returns no copy-move detected with low confidence
  // Real implementation would:
  // 1. Extract keypoints (SIFT, SURF, ORB)
  // 2. Match keypoints within the same image
  // 3. Detect clusters of matching keypoints indicating copied regions
  return {
    detected: false,
    confidence: 0.1, // Very low confidence — this is a stub
    matchedRegions: 0,
  };
}

// ─── Main Service ──────────────────────────────────────

/**
 * Analyze submitted images for forensic indicators.
 *
 * Checks:
 * 1. EXIF GPS coordinates vs claimed property address (>1 mile = CRITICAL)
 * 2. Stripped EXIF metadata (no EXIF data = HIGH)
 * 3. Photo timestamp cluster (>50% within minutes for multi-hour inspection = MEDIUM)
 * 4. Error Level Analysis placeholder (stub for ML integration)
 * 5. Copy-move detection placeholder (stub for ML integration)
 *
 * Creates FraudIndicator records with category VISUAL_AI.
 */
export async function analyzeImage(documentId: string): Promise<void> {
  const document = await prisma.document.findUniqueOrThrow({
    where: { id: documentId },
    include: { submission: true },
  });

  // Only analyze image documents
  const imageTypes = ["image/jpeg", "image/jpg", "image/png", "image/tiff"];
  const imageExtensions = [".jpg", ".jpeg", ".png", ".tiff", ".tif"];

  const isImage =
    imageTypes.some((t) => document.fileType.includes(t)) ||
    imageExtensions.some((ext) => document.fileName.toLowerCase().endsWith(ext));

  if (!isImage) return;

  // Download the image from S3
  const buffer = await getFromS3(document.s3Key);

  // Get claimed property address from ACORD 125 or 140
  const claimedAddress = await getClaimedAddress(document.submissionId);

  // Run EXIF analysis
  await analyzeImageExif(
    document.id,
    document.submissionId,
    document.tenantId,
    document.fileName,
    buffer,
    claimedAddress,
  );

  // Run ELA stub
  const elaResult = await analyzeELA(document.id, buffer);
  if (elaResult.isManipulated && elaResult.confidence > 0.7) {
    await prisma.fraudIndicator.create({
      data: {
        submissionId: document.submissionId,
        tenantId: document.tenantId,
        documentId: document.id,
        category: "VISUAL_AI",
        indicatorName: "IMAGE_MANIPULATION_ELA",
        description: `Error Level Analysis detected potential manipulation in "${document.fileName}". Regions with abnormal compression artifacts suggest the image may have been digitally altered.`,
        severity: "CRITICAL",
        evidence: JSON.parse(
          JSON.stringify({
            confidence: elaResult.confidence,
            regions: elaResult.regions,
            documentId: document.id,
            fileName: document.fileName,
          }),
        ),
        confidence: elaResult.confidence,
        recommendedAction:
          "Request original unmodified photos. Conduct independent property inspection to verify conditions.",
      },
    });
  }

  // Run copy-move stub
  const copyMoveResult = await detectCopyMove(document.id, buffer);
  if (copyMoveResult.detected && copyMoveResult.confidence > 0.7) {
    await prisma.fraudIndicator.create({
      data: {
        submissionId: document.submissionId,
        tenantId: document.tenantId,
        documentId: document.id,
        category: "VISUAL_AI",
        indicatorName: "IMAGE_COPY_MOVE_DETECTED",
        description: `Copy-move analysis detected ${copyMoveResult.matchedRegions} duplicated region(s) in "${document.fileName}". This may indicate cloned or repeated elements used to conceal or fabricate image content.`,
        severity: "CRITICAL",
        evidence: JSON.parse(
          JSON.stringify({
            confidence: copyMoveResult.confidence,
            matchedRegions: copyMoveResult.matchedRegions,
            documentId: document.id,
            fileName: document.fileName,
          }),
        ),
        confidence: copyMoveResult.confidence,
        recommendedAction:
          "Request original unmodified photos. Conduct independent property inspection to verify conditions.",
      },
    });
  }
}

/**
 * Analyze all inspection photos in a submission for cross-photo timestamp anomalies.
 * Called once per submission (not per document) for the timestamp span check.
 */
export async function analyzeSubmissionImages(
  submissionId: string,
): Promise<void> {
  // Find all image documents in the submission
  const documents = await prisma.document.findMany({
    where: {
      submissionId,
      documentType: "INSPECTION_PHOTO",
    },
  });

  if (documents.length === 0) return;

  const submission = await prisma.submission.findUniqueOrThrow({
    where: { id: submissionId },
  });

  // Download each image and extract EXIF
  const photoExifData: Array<{
    documentId: string;
    fileName: string;
    dateTimeOriginal: Date | null;
  }> = [];

  const analysisPromises = documents.map(async (doc) => {
    try {
      const buffer = await getFromS3(doc.s3Key);
      const exif = extractExifData(buffer);

      photoExifData.push({
        documentId: doc.id,
        fileName: doc.fileName,
        dateTimeOriginal: exif.dateTimeOriginal ?? exif.dateTimeDigitized ?? exif.dateTime,
      });
    } catch {
      // Skip documents that can't be downloaded or parsed
    }
  });

  await Promise.allSettled(analysisPromises);

  // Run timestamp span analysis across all photos
  await analyzeTimestampSpan(submission.id, submission.tenantId, photoExifData);
}

// ─── Helpers ────────────────────────────────────────────

/**
 * Get the claimed property address from ACORD 125 or ACORD 140 extracted data.
 */
async function getClaimedAddress(
  submissionId: string,
): Promise<string | null> {
  // Try ACORD 125 physical address first
  const acord125 = await prisma.document.findFirst({
    where: {
      submissionId,
      documentType: "ACORD_125",
      status: "ANALYZED",
    },
  });

  if (acord125?.extractedData) {
    const data = acord125.extractedData as Record<string, unknown>;
    if (typeof data.physicalAddress === "string" && data.physicalAddress.length > 5) {
      return data.physicalAddress;
    }
    if (typeof data.mailingAddress === "string" && data.mailingAddress.length > 5) {
      return data.mailingAddress;
    }
  }

  // Fallback: ACORD 140 first property location
  const acord140 = await prisma.document.findFirst({
    where: {
      submissionId,
      documentType: "ACORD_140",
      status: "ANALYZED",
    },
  });

  if (acord140?.extractedData) {
    const data = acord140.extractedData as Record<string, unknown>;
    const locations = data.propertyLocations as
      | Array<{ address?: string }>
      | undefined;
    if (locations && locations.length > 0 && locations[0].address) {
      return locations[0].address;
    }
  }

  return null;
}
