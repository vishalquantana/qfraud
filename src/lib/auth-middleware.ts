import { getToken } from "next-auth/jwt";
import { type NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import crypto from "crypto";

export interface AuthUser {
  id: string;
  tenantId: string;
  role: string;
  name: string;
  email: string;
}

export interface ApiKeyAuth {
  tenantId: string;
  apiKeyId: string;
  permissions: string[];
}

export type AuthContext =
  | { type: "user"; user: AuthUser }
  | { type: "apikey"; apiKey: ApiKeyAuth };

/**
 * Hash an API key for storage/lookup comparison.
 */
export function hashApiKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

/**
 * Extract authentication from a request.
 * Checks for JWT session first, then falls back to X-API-Key header.
 */
export async function extractAuth(
  req: NextRequest,
): Promise<AuthContext | null> {
  // Try JWT first
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (token?.id && token?.tenantId && token?.role) {
    return {
      type: "user",
      user: {
        id: token.id as string,
        tenantId: token.tenantId as string,
        role: token.role as string,
        name: (token.name as string) ?? "",
        email: (token.email as string) ?? "",
      },
    };
  }

  // Try API key
  const apiKeyHeader = req.headers.get("x-api-key");
  if (apiKeyHeader) {
    const hashedKey = hashApiKey(apiKeyHeader);
    const apiKey = await prisma.apiKey.findUnique({
      where: { key: hashedKey, isActive: true },
    });

    if (apiKey) {
      // Update lastUsedAt (fire and forget)
      prisma.apiKey
        .update({
          where: { id: apiKey.id },
          data: { lastUsedAt: new Date() },
        })
        .catch(() => {
          // Silently ignore update errors
        });

      return {
        type: "apikey",
        apiKey: {
          tenantId: apiKey.tenantId,
          apiKeyId: apiKey.id,
          permissions: apiKey.permissions as string[],
        },
      };
    }
  }

  return null;
}

/**
 * Create an unauthorized JSON response.
 */
export function unauthorizedResponse(message = "Unauthorized") {
  return NextResponse.json({ error: message }, { status: 401 });
}

/**
 * Create a forbidden JSON response.
 */
export function forbiddenResponse(message = "Forbidden") {
  return NextResponse.json({ error: message }, { status: 403 });
}
