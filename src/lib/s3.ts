import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";

const s3Client = new S3Client({
  region: process.env.AWS_REGION ?? "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? "",
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? "",
  },
});

const BUCKET = process.env.S3_BUCKET ?? "quantana-shield-documents";

/**
 * Upload a file buffer to S3.
 * Path format: {tenantId}/{submissionId}/{documentId}/{filename}
 */
export async function uploadToS3(
  tenantId: string,
  submissionId: string,
  documentId: string,
  fileName: string,
  body: Buffer,
  contentType: string,
): Promise<string> {
  const s3Key = `${tenantId}/${submissionId}/${documentId}/${fileName}`;

  await s3Client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: s3Key,
      Body: body,
      ContentType: contentType,
    }),
  );

  return s3Key;
}

/**
 * Download a file from S3 by its key.
 * Returns a Buffer of the file contents.
 */
export async function getFromS3(s3Key: string): Promise<Buffer> {
  const response = await s3Client.send(
    new GetObjectCommand({
      Bucket: BUCKET,
      Key: s3Key,
    }),
  );

  const stream = response.Body;
  if (!stream) {
    throw new Error(`Empty response body for S3 key: ${s3Key}`);
  }

  // Convert the readable stream to a Buffer
  const chunks: Uint8Array[] = [];
  const reader = stream.transformToWebStream().getReader();
  let done = false;
  while (!done) {
    const result = await reader.read();
    if (result.value) chunks.push(result.value);
    done = result.done;
  }
  return Buffer.concat(chunks);
}

export { s3Client, BUCKET };
