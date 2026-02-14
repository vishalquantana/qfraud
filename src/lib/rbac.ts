import { type NextRequest, NextResponse } from "next/server";
import {
  extractAuth,
  unauthorizedResponse,
  forbiddenResponse,
  type AuthContext,
  type AuthUser,
} from "@/lib/auth-middleware";

// ─── Role Hierarchy ─────────────────────────────────────

/**
 * Role hierarchy for underwriting line:
 * ADMIN > SENIOR_UNDERWRITER > UNDERWRITER
 *
 * SIU_INVESTIGATOR and COMPLIANCE_OFFICER are independent roles
 * (not part of the hierarchy - they only match themselves or ADMIN).
 *
 * BROKER is the most restricted role.
 */
const ROLE_HIERARCHY: Record<string, number> = {
  ADMIN: 100,
  SENIOR_UNDERWRITER: 50,
  UNDERWRITER: 30,
  SIU_INVESTIGATOR: 0, // Independent
  COMPLIANCE_OFFICER: 0, // Independent
  BROKER: 0, // Restricted
};

/**
 * Check if a user's role satisfies a required role.
 * ADMIN always has access to everything.
 * For the underwriting hierarchy, higher roles include lower ones.
 * Independent roles (SIU_INVESTIGATOR, COMPLIANCE_OFFICER) only match themselves or ADMIN.
 * BROKER only matches BROKER.
 */
export function hasRole(userRole: string, requiredRole: string): boolean {
  // ADMIN has access to everything
  if (userRole === "ADMIN") return true;

  // Exact match always works
  if (userRole === requiredRole) return true;

  // Underwriting hierarchy: SENIOR_UNDERWRITER can do UNDERWRITER tasks
  const hierarchyRoles = ["UNDERWRITER", "SENIOR_UNDERWRITER"];
  if (
    hierarchyRoles.includes(userRole) &&
    hierarchyRoles.includes(requiredRole)
  ) {
    return (
      (ROLE_HIERARCHY[userRole] ?? 0) >= (ROLE_HIERARCHY[requiredRole] ?? 0)
    );
  }

  // No other cross-role access
  return false;
}

/**
 * Check if a user's role matches any of the allowed roles.
 */
export function hasAnyRole(userRole: string, allowedRoles: string[]): boolean {
  return allowedRoles.some((role) => hasRole(userRole, role));
}

// ─── Broker Endpoint Restrictions ───────────────────────

/**
 * Broker-allowed path patterns.
 * Brokers can only access submission portal endpoints.
 */
const BROKER_ALLOWED_PATTERNS = [
  /^\/api\/submissions$/, // POST (submit), GET (list own)
  /^\/api\/submissions\/[^/]+$/, // GET (view own submission detail)
  /^\/api\/submissions\/[^/]+\/documents/, // Document operations on own submissions
  /^\/api\/auth\//, // Auth endpoints
];

/**
 * Check if a path is allowed for the BROKER role.
 */
export function isBrokerAllowedPath(pathname: string): boolean {
  return BROKER_ALLOWED_PATTERNS.some((pattern) => pattern.test(pathname));
}

// ─── Tenant Scoping ─────────────────────────────────────

export interface TenantScopedRequest {
  req: NextRequest;
  auth: AuthContext;
  tenantId: string;
}

/**
 * Creates a tenant-scoped where clause by adding tenantId to any existing filter.
 * Use this to ensure all Prisma queries are automatically scoped to the current tenant.
 *
 * Usage:
 *   const submissions = await prisma.submission.findMany({
 *     where: withTenantFilter(tenantId, { status: "UNDER_REVIEW" }),
 *   });
 */
export function withTenantFilter<T extends Record<string, unknown>>(
  tenantId: string,
  where?: T
): T & { tenantId: string } {
  return { ...where, tenantId } as T & { tenantId: string };
}

// ─── Middleware Wrappers ─────────────────────────────────

type TenantScopedHandler = (
  ctx: TenantScopedRequest,
  params?: Record<string, string>
) => Promise<NextResponse>;

/**
 * Wraps a route handler with authentication and tenant scoping.
 * All queries in the handler should use withTenantFilter() to scope data.
 */
export function withTenant(handler: TenantScopedHandler) {
  return async (
    req: NextRequest,
    context?: { params?: Promise<Record<string, string>> }
  ) => {
    const auth = await extractAuth(req);
    if (!auth) {
      return unauthorizedResponse();
    }

    const tenantId =
      auth.type === "user" ? auth.user.tenantId : auth.apiKey.tenantId;

    // Enforce broker path restrictions
    if (auth.type === "user" && auth.user.role === "BROKER") {
      const pathname = new URL(req.url).pathname;
      if (!isBrokerAllowedPath(pathname)) {
        return forbiddenResponse(
          "Broker role can only access submission portal endpoints"
        );
      }
    }

    const params = context?.params ? await context.params : undefined;

    return handler({ req, auth, tenantId }, params);
  };
}

/**
 * Wraps a route handler with authentication, tenant scoping, AND role checking.
 * Checks the user's role against the list of allowed roles.
 * Returns 403 if the user doesn't have any of the required roles.
 *
 * Usage:
 *   export const GET = withRole(["ADMIN", "UNDERWRITER"], async (ctx) => { ... });
 */
export function withRole(allowedRoles: string[], handler: TenantScopedHandler) {
  return withTenant(async (ctx, params) => {
    // API key auth bypasses role checks (permissions are checked separately)
    if (ctx.auth.type === "apikey") {
      return handler(ctx, params);
    }

    const user = ctx.auth.user as AuthUser;
    if (!hasAnyRole(user.role, allowedRoles)) {
      return forbiddenResponse(
        `Access denied. Required role: ${allowedRoles.join(" or ")}`
      );
    }

    return handler(ctx, params);
  });
}
