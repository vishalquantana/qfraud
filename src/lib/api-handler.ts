import { type NextRequest, NextResponse } from "next/server";
import {
  extractAuth,
  unauthorizedResponse,
  type AuthContext,
} from "@/lib/auth-middleware";

export interface ProtectedRequest {
  req: NextRequest;
  auth: AuthContext;
  tenantId: string;
}

type RouteHandler = (
  ctx: ProtectedRequest,
  params?: Record<string, string>,
) => Promise<NextResponse>;

/**
 * Wraps an API route handler with authentication.
 * Extracts the user from JWT or API key and injects tenantId.
 */
export function withAuth(handler: RouteHandler) {
  return async (
    req: NextRequest,
    context?: { params?: Promise<Record<string, string>> },
  ) => {
    const auth = await extractAuth(req);
    if (!auth) {
      return unauthorizedResponse();
    }

    const tenantId =
      auth.type === "user" ? auth.user.tenantId : auth.apiKey.tenantId;

    const params = context?.params ? await context.params : undefined;

    return handler({ req, auth, tenantId }, params);
  };
}

/**
 * Get the user ID from an auth context.
 * Returns null for API key auth (no specific user).
 */
export function getUserId(auth: AuthContext): string | null {
  return auth.type === "user" ? auth.user.id : null;
}

/**
 * Get the user role from an auth context.
 * Returns null for API key auth.
 */
export function getUserRole(auth: AuthContext): string | null {
  return auth.type === "user" ? auth.user.role : null;
}

/**
 * Helper to return a JSON error response.
 */
export function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * Helper to return a JSON success response.
 */
export function jsonResponse<T>(data: T, status = 200) {
  return NextResponse.json(data, { status });
}
