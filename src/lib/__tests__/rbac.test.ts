import { describe, it, expect } from "vitest";
import { hasRole, hasAnyRole, isBrokerAllowedPath, withTenantFilter } from "@/lib/rbac";
import { USERS, TENANT } from "@/test/fixtures";

// ─── hasRole() ───────────────────────────────────────────

describe("hasRole", () => {
  describe("ADMIN access", () => {
    it("should grant ADMIN access to the ADMIN role", () => {
      expect(hasRole("ADMIN", "ADMIN")).toBe(true);
    });

    it("should grant ADMIN access to UNDERWRITER", () => {
      expect(hasRole("ADMIN", "UNDERWRITER")).toBe(true);
    });

    it("should grant ADMIN access to SENIOR_UNDERWRITER", () => {
      expect(hasRole("ADMIN", "SENIOR_UNDERWRITER")).toBe(true);
    });

    it("should grant ADMIN access to SIU_INVESTIGATOR", () => {
      expect(hasRole("ADMIN", "SIU_INVESTIGATOR")).toBe(true);
    });

    it("should grant ADMIN access to COMPLIANCE_OFFICER", () => {
      expect(hasRole("ADMIN", "COMPLIANCE_OFFICER")).toBe(true);
    });

    it("should grant ADMIN access to BROKER", () => {
      expect(hasRole("ADMIN", "BROKER")).toBe(true);
    });

    it("should grant ADMIN access to any unknown role", () => {
      expect(hasRole("ADMIN", "SOME_FUTURE_ROLE")).toBe(true);
    });
  });

  describe("exact match", () => {
    it("should allow UNDERWRITER for UNDERWRITER", () => {
      expect(hasRole("UNDERWRITER", "UNDERWRITER")).toBe(true);
    });

    it("should allow SENIOR_UNDERWRITER for SENIOR_UNDERWRITER", () => {
      expect(hasRole("SENIOR_UNDERWRITER", "SENIOR_UNDERWRITER")).toBe(true);
    });

    it("should allow SIU_INVESTIGATOR for SIU_INVESTIGATOR", () => {
      expect(hasRole("SIU_INVESTIGATOR", "SIU_INVESTIGATOR")).toBe(true);
    });

    it("should allow COMPLIANCE_OFFICER for COMPLIANCE_OFFICER", () => {
      expect(hasRole("COMPLIANCE_OFFICER", "COMPLIANCE_OFFICER")).toBe(true);
    });

    it("should allow BROKER for BROKER", () => {
      expect(hasRole("BROKER", "BROKER")).toBe(true);
    });
  });

  describe("underwriting hierarchy (SENIOR_UNDERWRITER > UNDERWRITER)", () => {
    it("should allow SENIOR_UNDERWRITER to perform UNDERWRITER tasks", () => {
      expect(hasRole("SENIOR_UNDERWRITER", "UNDERWRITER")).toBe(true);
    });

    it("should deny UNDERWRITER from performing SENIOR_UNDERWRITER tasks", () => {
      expect(hasRole("UNDERWRITER", "SENIOR_UNDERWRITER")).toBe(false);
    });
  });

  describe("independent roles (SIU_INVESTIGATOR, COMPLIANCE_OFFICER)", () => {
    it("should deny SIU_INVESTIGATOR access to UNDERWRITER", () => {
      expect(hasRole("SIU_INVESTIGATOR", "UNDERWRITER")).toBe(false);
    });

    it("should deny SIU_INVESTIGATOR access to SENIOR_UNDERWRITER", () => {
      expect(hasRole("SIU_INVESTIGATOR", "SENIOR_UNDERWRITER")).toBe(false);
    });

    it("should deny SIU_INVESTIGATOR access to COMPLIANCE_OFFICER", () => {
      expect(hasRole("SIU_INVESTIGATOR", "COMPLIANCE_OFFICER")).toBe(false);
    });

    it("should deny SIU_INVESTIGATOR access to BROKER", () => {
      expect(hasRole("SIU_INVESTIGATOR", "BROKER")).toBe(false);
    });

    it("should deny COMPLIANCE_OFFICER access to UNDERWRITER", () => {
      expect(hasRole("COMPLIANCE_OFFICER", "UNDERWRITER")).toBe(false);
    });

    it("should deny COMPLIANCE_OFFICER access to SENIOR_UNDERWRITER", () => {
      expect(hasRole("COMPLIANCE_OFFICER", "SENIOR_UNDERWRITER")).toBe(false);
    });

    it("should deny COMPLIANCE_OFFICER access to SIU_INVESTIGATOR", () => {
      expect(hasRole("COMPLIANCE_OFFICER", "SIU_INVESTIGATOR")).toBe(false);
    });

    it("should deny COMPLIANCE_OFFICER access to BROKER", () => {
      expect(hasRole("COMPLIANCE_OFFICER", "BROKER")).toBe(false);
    });
  });

  describe("BROKER restrictions", () => {
    it("should allow BROKER for BROKER (exact match)", () => {
      expect(hasRole("BROKER", "BROKER")).toBe(true);
    });

    it("should deny BROKER access to UNDERWRITER", () => {
      expect(hasRole("BROKER", "UNDERWRITER")).toBe(false);
    });

    it("should deny BROKER access to SENIOR_UNDERWRITER", () => {
      expect(hasRole("BROKER", "SENIOR_UNDERWRITER")).toBe(false);
    });

    it("should deny BROKER access to SIU_INVESTIGATOR", () => {
      expect(hasRole("BROKER", "SIU_INVESTIGATOR")).toBe(false);
    });

    it("should deny BROKER access to COMPLIANCE_OFFICER", () => {
      expect(hasRole("BROKER", "COMPLIANCE_OFFICER")).toBe(false);
    });

    it("should deny BROKER access to ADMIN", () => {
      expect(hasRole("BROKER", "ADMIN")).toBe(false);
    });
  });

  describe("cross-hierarchy denial", () => {
    it("should deny UNDERWRITER access to SIU_INVESTIGATOR", () => {
      expect(hasRole("UNDERWRITER", "SIU_INVESTIGATOR")).toBe(false);
    });

    it("should deny UNDERWRITER access to COMPLIANCE_OFFICER", () => {
      expect(hasRole("UNDERWRITER", "COMPLIANCE_OFFICER")).toBe(false);
    });

    it("should deny UNDERWRITER access to BROKER", () => {
      expect(hasRole("UNDERWRITER", "BROKER")).toBe(false);
    });

    it("should deny SENIOR_UNDERWRITER access to SIU_INVESTIGATOR", () => {
      expect(hasRole("SENIOR_UNDERWRITER", "SIU_INVESTIGATOR")).toBe(false);
    });

    it("should deny SENIOR_UNDERWRITER access to COMPLIANCE_OFFICER", () => {
      expect(hasRole("SENIOR_UNDERWRITER", "COMPLIANCE_OFFICER")).toBe(false);
    });

    it("should deny SENIOR_UNDERWRITER access to BROKER", () => {
      expect(hasRole("SENIOR_UNDERWRITER", "BROKER")).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("should deny unknown user role against known required role", () => {
      expect(hasRole("UNKNOWN_ROLE", "UNDERWRITER")).toBe(false);
    });

    it("should deny known user role against unknown required role", () => {
      expect(hasRole("UNDERWRITER", "UNKNOWN_ROLE")).toBe(false);
    });

    it("should allow exact match for unknown roles", () => {
      expect(hasRole("CUSTOM_ROLE", "CUSTOM_ROLE")).toBe(true);
    });

    it("should deny two different unknown roles", () => {
      expect(hasRole("ROLE_A", "ROLE_B")).toBe(false);
    });

    it("should handle empty string user role", () => {
      expect(hasRole("", "UNDERWRITER")).toBe(false);
    });

    it("should handle empty string required role", () => {
      expect(hasRole("UNDERWRITER", "")).toBe(false);
    });

    it("should handle both empty strings (exact match)", () => {
      expect(hasRole("", "")).toBe(true);
    });
  });

  describe("using fixture user roles", () => {
    it("should grant admin fixture user access to UNDERWRITER", () => {
      expect(hasRole(USERS.admin.role, "UNDERWRITER")).toBe(true);
    });

    it("should grant seniorUnderwriter fixture user access to UNDERWRITER", () => {
      expect(hasRole(USERS.seniorUnderwriter.role, "UNDERWRITER")).toBe(true);
    });

    it("should deny underwriter fixture user access to SENIOR_UNDERWRITER", () => {
      expect(hasRole(USERS.underwriter.role, "SENIOR_UNDERWRITER")).toBe(false);
    });

    it("should deny broker fixture user access to UNDERWRITER", () => {
      expect(hasRole(USERS.broker.role, "UNDERWRITER")).toBe(false);
    });

    it("should deny siuInvestigator fixture user access to UNDERWRITER", () => {
      expect(hasRole(USERS.siuInvestigator.role, "UNDERWRITER")).toBe(false);
    });

    it("should deny complianceOfficer fixture user access to UNDERWRITER", () => {
      expect(hasRole(USERS.complianceOfficer.role, "UNDERWRITER")).toBe(false);
    });
  });
});

// ─── hasAnyRole() ────────────────────────────────────────

describe("hasAnyRole", () => {
  it("should return true when user role matches one of the allowed roles", () => {
    expect(hasAnyRole("UNDERWRITER", ["UNDERWRITER", "SENIOR_UNDERWRITER"])).toBe(true);
  });

  it("should return true when ADMIN is the user role regardless of allowed roles", () => {
    expect(hasAnyRole("ADMIN", ["UNDERWRITER", "BROKER"])).toBe(true);
  });

  it("should return true when SENIOR_UNDERWRITER checks against UNDERWRITER in allowed list", () => {
    expect(hasAnyRole("SENIOR_UNDERWRITER", ["UNDERWRITER"])).toBe(true);
  });

  it("should return false when user role does not match any allowed role", () => {
    expect(hasAnyRole("BROKER", ["UNDERWRITER", "SENIOR_UNDERWRITER"])).toBe(false);
  });

  it("should return false when allowed roles list is empty", () => {
    expect(hasAnyRole("ADMIN", [])).toBe(false);
  });

  it("should return true when user role exactly matches one among many", () => {
    expect(
      hasAnyRole("SIU_INVESTIGATOR", [
        "UNDERWRITER",
        "SENIOR_UNDERWRITER",
        "SIU_INVESTIGATOR",
      ])
    ).toBe(true);
  });

  it("should return false when SIU_INVESTIGATOR checks against unrelated roles", () => {
    expect(
      hasAnyRole("SIU_INVESTIGATOR", ["UNDERWRITER", "BROKER", "COMPLIANCE_OFFICER"])
    ).toBe(false);
  });

  it("should return true when BROKER is in the allowed roles list", () => {
    expect(hasAnyRole("BROKER", ["BROKER", "UNDERWRITER"])).toBe(true);
  });

  it("should return false for COMPLIANCE_OFFICER against only hierarchy roles", () => {
    expect(
      hasAnyRole("COMPLIANCE_OFFICER", ["UNDERWRITER", "SENIOR_UNDERWRITER"])
    ).toBe(false);
  });

  it("should work with fixture user roles", () => {
    const allowedRoles = ["ADMIN", "SENIOR_UNDERWRITER", "UNDERWRITER"];
    expect(hasAnyRole(USERS.admin.role, allowedRoles)).toBe(true);
    expect(hasAnyRole(USERS.seniorUnderwriter.role, allowedRoles)).toBe(true);
    expect(hasAnyRole(USERS.underwriter.role, allowedRoles)).toBe(true);
    expect(hasAnyRole(USERS.broker.role, allowedRoles)).toBe(false);
    expect(hasAnyRole(USERS.siuInvestigator.role, allowedRoles)).toBe(false);
    expect(hasAnyRole(USERS.complianceOfficer.role, allowedRoles)).toBe(false);
  });

  it("should return true for single-element allowed roles with exact match", () => {
    expect(hasAnyRole("COMPLIANCE_OFFICER", ["COMPLIANCE_OFFICER"])).toBe(true);
  });
});

// ─── isBrokerAllowedPath() ───────────────────────────────

describe("isBrokerAllowedPath", () => {
  describe("allowed paths", () => {
    it("should allow /api/submissions", () => {
      expect(isBrokerAllowedPath("/api/submissions")).toBe(true);
    });

    it("should allow /api/submissions/{id} (view own submission)", () => {
      expect(isBrokerAllowedPath("/api/submissions/sub-clean")).toBe(true);
    });

    it("should allow /api/submissions/{id} with UUID-style id", () => {
      expect(
        isBrokerAllowedPath("/api/submissions/550e8400-e29b-41d4-a716-446655440000")
      ).toBe(true);
    });

    it("should allow /api/submissions/{id}/documents", () => {
      expect(isBrokerAllowedPath("/api/submissions/sub-clean/documents")).toBe(true);
    });

    it("should allow /api/submissions/{id}/documents/{docId}", () => {
      expect(
        isBrokerAllowedPath("/api/submissions/sub-clean/documents/doc-acord125")
      ).toBe(true);
    });

    it("should allow /api/submissions/{id}/documents/upload", () => {
      expect(
        isBrokerAllowedPath("/api/submissions/sub-clean/documents/upload")
      ).toBe(true);
    });

    it("should allow /api/submissions/{id}/confirm", () => {
      expect(isBrokerAllowedPath("/api/submissions/sub-clean/confirm")).toBe(true);
    });

    it("should allow /api/auth/ endpoints", () => {
      expect(isBrokerAllowedPath("/api/auth/signin")).toBe(true);
    });

    it("should allow /api/auth/signout", () => {
      expect(isBrokerAllowedPath("/api/auth/signout")).toBe(true);
    });

    it("should allow /api/auth/session", () => {
      expect(isBrokerAllowedPath("/api/auth/session")).toBe(true);
    });

    it("should allow /api/auth/callback/credentials", () => {
      expect(isBrokerAllowedPath("/api/auth/callback/credentials")).toBe(true);
    });
  });

  describe("denied paths", () => {
    it("should deny /api/admin", () => {
      expect(isBrokerAllowedPath("/api/admin")).toBe(false);
    });

    it("should deny /api/admin/users", () => {
      expect(isBrokerAllowedPath("/api/admin/users")).toBe(false);
    });

    it("should deny /api/fraud-indicators", () => {
      expect(isBrokerAllowedPath("/api/fraud-indicators")).toBe(false);
    });

    it("should deny /api/siu-cases", () => {
      expect(isBrokerAllowedPath("/api/siu-cases")).toBe(false);
    });

    it("should deny /api/audit-logs", () => {
      expect(isBrokerAllowedPath("/api/audit-logs")).toBe(false);
    });

    it("should deny /api/thresholds", () => {
      expect(isBrokerAllowedPath("/api/thresholds")).toBe(false);
    });

    it("should deny /api/webhooks", () => {
      expect(isBrokerAllowedPath("/api/webhooks")).toBe(false);
    });

    it("should deny /api/dashboard", () => {
      expect(isBrokerAllowedPath("/api/dashboard")).toBe(false);
    });

    it("should deny /api/users", () => {
      expect(isBrokerAllowedPath("/api/users")).toBe(false);
    });

    it("should deny root /api path", () => {
      expect(isBrokerAllowedPath("/api")).toBe(false);
    });

    it("should deny /api/submissions with trailing path not in patterns", () => {
      expect(isBrokerAllowedPath("/api/submissions/sub-1/fraud-indicators")).toBe(false);
    });

    it("should deny /api/submissions with nested subpath beyond allowed", () => {
      expect(isBrokerAllowedPath("/api/submissions/sub-1/review")).toBe(false);
    });

    it("should deny empty string", () => {
      expect(isBrokerAllowedPath("")).toBe(false);
    });

    it("should deny /submissions (missing /api prefix)", () => {
      expect(isBrokerAllowedPath("/submissions")).toBe(false);
    });
  });
});

// ─── withTenantFilter() ──────────────────────────────────

describe("withTenantFilter", () => {
  const tenantId = TENANT.id;

  describe("adding tenantId to empty where clause", () => {
    it("should return an object with only tenantId when where is undefined", () => {
      const result = withTenantFilter(tenantId);
      expect(result).toEqual({ tenantId });
    });

    it("should return an object with only tenantId when where is an empty object", () => {
      const result = withTenantFilter(tenantId, {});
      expect(result).toEqual({ tenantId });
    });
  });

  describe("adding tenantId to existing where clause", () => {
    it("should merge tenantId with existing status filter", () => {
      const result = withTenantFilter(tenantId, { status: "UNDER_REVIEW" });
      expect(result).toEqual({ tenantId, status: "UNDER_REVIEW" });
    });

    it("should merge tenantId with multiple existing filters", () => {
      const result = withTenantFilter(tenantId, {
        status: "PROCESSING",
        submitterId: USERS.broker.id,
      });
      expect(result).toEqual({
        tenantId,
        status: "PROCESSING",
        submitterId: USERS.broker.id,
      });
    });

    it("should override an existing tenantId in the where clause", () => {
      const result = withTenantFilter(tenantId, {
        tenantId: "other-tenant",
        status: "UNDER_REVIEW",
      });
      // The spread puts where first, then tenantId overrides
      expect(result.tenantId).toBe(tenantId);
    });

    it("should preserve nested object filters", () => {
      const result = withTenantFilter(tenantId, {
        riskScore: { gte: 50 },
        status: "UNDER_REVIEW",
      });
      expect(result).toEqual({
        tenantId,
        riskScore: { gte: 50 },
        status: "UNDER_REVIEW",
      });
    });

    it("should preserve array filters", () => {
      const result = withTenantFilter(tenantId, {
        status: { in: ["PROCESSING", "UNDER_REVIEW"] },
      });
      expect(result).toEqual({
        tenantId,
        status: { in: ["PROCESSING", "UNDER_REVIEW"] },
      });
    });

    it("should preserve null values in the where clause", () => {
      const result = withTenantFilter(tenantId, {
        assignedUnderwriterId: null,
      });
      expect(result).toEqual({
        tenantId,
        assignedUnderwriterId: null,
      });
    });

    it("should preserve boolean values in the where clause", () => {
      const result = withTenantFilter(tenantId, {
        isActive: true,
      });
      expect(result).toEqual({
        tenantId,
        isActive: true,
      });
    });
  });

  describe("type safety", () => {
    it("should produce a result that includes the tenantId property", () => {
      const result = withTenantFilter(tenantId, { status: "PROCESSING" });
      // TypeScript guarantees tenantId exists on result
      const id: string = result.tenantId;
      expect(id).toBe(tenantId);
    });

    it("should produce a result that includes original where properties", () => {
      const result = withTenantFilter(tenantId, { status: "PROCESSING" });
      expect(result.status).toBe("PROCESSING");
    });
  });
});
