import { NextResponse } from "next/server";

const OPENAPI_SPEC = {
  openapi: "3.0.3",
  info: {
    title: "Quantana Shield API",
    version: "1.0.0",
    description:
      "AI-powered insurance fraud detection platform API. Authenticate using JWT (via /api/auth/login) or API key (X-API-Key header).",
    contact: { email: "support@quantanashield.com" },
  },
  servers: [{ url: "/api", description: "Current environment" }],
  security: [{ BearerAuth: [] }, { ApiKeyAuth: [] }],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description: "JWT token from POST /api/auth/login",
      },
      ApiKeyAuth: {
        type: "apiKey",
        in: "header",
        name: "X-API-Key",
        description: "API key from dashboard configuration",
      },
    },
    schemas: {
      Submission: {
        type: "object",
        properties: {
          id: { type: "string" },
          tenantId: { type: "string" },
          insuredName: { type: "string" },
          lineOfBusiness: { type: "string", nullable: true },
          status: {
            type: "string",
            enum: [
              "PROCESSING",
              "UNDER_REVIEW",
              "APPROVED",
              "DECLINED",
              "INFO_NEEDED",
              "REFERRED_TO_SIU",
            ],
          },
          riskScore: {
            type: "integer",
            minimum: 0,
            maximum: 100,
            nullable: true,
          },
          severity: {
            type: "string",
            enum: ["CRITICAL", "HIGH", "MEDIUM", "LOW", "CLEAN"],
            nullable: true,
          },
          channel: { type: "string", enum: ["PORTAL", "EMAIL", "API"] },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
      Document: {
        type: "object",
        properties: {
          id: { type: "string" },
          fileName: { type: "string" },
          fileType: { type: "string" },
          fileSize: { type: "integer" },
          documentType: {
            type: "string",
            enum: [
              "ACORD_125",
              "ACORD_130",
              "ACORD_140",
              "LOSS_RUN",
              "FINANCIAL_STATEMENT",
              "COI",
              "ENTITY_DOC",
              "INSPECTION_PHOTO",
              "MVR",
              "SOV",
              "SURPLUS_LINES",
              "PROFESSIONAL_LICENSE",
              "ENVIRONMENTAL_REPORT",
              "PAYROLL_TAX",
              "BROKER_SUBMISSION",
              "FLEET_SCHEDULE",
              "UNKNOWN",
            ],
          },
          classificationConfidence: { type: "number", nullable: true },
          status: {
            type: "string",
            enum: [
              "UPLOADED",
              "CLASSIFYING",
              "EXTRACTING",
              "ANALYZED",
              "ERROR",
            ],
          },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      FraudIndicator: {
        type: "object",
        properties: {
          id: { type: "string" },
          category: {
            type: "string",
            enum: [
              "CROSS_DOC",
              "FORENSIC",
              "STATISTICAL",
              "TEMPORAL",
              "RATIO",
              "ENTITY_INTEL",
              "VISUAL_AI",
              "NLP",
              "API_VERIFY",
              "RULES",
            ],
          },
          indicatorName: { type: "string" },
          description: { type: "string" },
          severity: {
            type: "string",
            enum: ["CRITICAL", "HIGH", "MEDIUM", "LOW"],
          },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          evidence: { type: "object" },
          isOverridden: { type: "boolean" },
        },
      },
      RiskReport: {
        type: "object",
        properties: {
          submission: { $ref: "#/components/schemas/Submission" },
          totalScore: { type: "integer" },
          severity: { type: "string" },
          breakdown: {
            type: "object",
            additionalProperties: {
              type: "object",
              properties: {
                count: { type: "integer" },
                points: { type: "integer" },
              },
            },
          },
          indicators: {
            type: "array",
            items: { $ref: "#/components/schemas/FraudIndicator" },
          },
          explainability: { type: "string" },
        },
      },
      WebhookSubscription: {
        type: "object",
        properties: {
          id: { type: "string" },
          url: { type: "string", format: "uri" },
          events: {
            type: "array",
            items: {
              type: "string",
              enum: [
                "submission.processed",
                "submission.approved",
                "submission.declined",
                "submission.escalated",
                "fraud.flag_raised",
                "siu.case_created",
              ],
            },
          },
          isActive: { type: "boolean" },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      Error: {
        type: "object",
        properties: {
          error: { type: "string" },
        },
      },
      Pagination: {
        type: "object",
        properties: {
          page: { type: "integer" },
          limit: { type: "integer" },
          total: { type: "integer" },
          totalPages: { type: "integer" },
        },
      },
    },
  },
  paths: {
    "/auth/login": {
      post: {
        tags: ["Authentication"],
        summary: "Login with email and password",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["email", "password"],
                properties: {
                  email: { type: "string", format: "email" },
                  password: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "JWT token",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { token: { type: "string" } },
                },
              },
            },
          },
          "401": {
            description: "Invalid credentials",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
              },
            },
          },
        },
      },
    },
    "/submissions": {
      get: {
        tags: ["Submissions"],
        summary: "List submissions",
        parameters: [
          {
            name: "page",
            in: "query",
            schema: { type: "integer", default: 1 },
          },
          {
            name: "limit",
            in: "query",
            schema: { type: "integer", default: 20, maximum: 100 },
          },
          {
            name: "status",
            in: "query",
            schema: {
              type: "string",
              enum: [
                "PROCESSING",
                "UNDER_REVIEW",
                "APPROVED",
                "DECLINED",
                "INFO_NEEDED",
                "REFERRED_TO_SIU",
              ],
            },
          },
          {
            name: "severity",
            in: "query",
            schema: {
              type: "string",
              enum: ["CRITICAL", "HIGH", "MEDIUM", "LOW", "CLEAN"],
            },
          },
          {
            name: "dateFrom",
            in: "query",
            schema: { type: "string", format: "date" },
          },
          {
            name: "dateTo",
            in: "query",
            schema: { type: "string", format: "date" },
          },
          { name: "broker", in: "query", schema: { type: "string" } },
        ],
        responses: {
          "200": {
            description: "Paginated submissions list",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: {
                      type: "array",
                      items: { $ref: "#/components/schemas/Submission" },
                    },
                    pagination: { $ref: "#/components/schemas/Pagination" },
                  },
                },
              },
            },
          },
        },
      },
      post: {
        tags: ["Submissions"],
        summary: "Create a new submission with file uploads",
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                required: ["insuredName"],
                properties: {
                  insuredName: { type: "string" },
                  lineOfBusiness: { type: "string" },
                  channel: { type: "string", enum: ["PORTAL", "EMAIL", "API"] },
                  files: {
                    type: "array",
                    items: { type: "string", format: "binary" },
                    maxItems: 50,
                  },
                },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Submission created",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    submissionId: { type: "string" },
                    status: { type: "string" },
                    documents: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          documentId: { type: "string" },
                          fileName: { type: "string" },
                          status: { type: "string" },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/submissions/{id}": {
      get: {
        tags: ["Submissions"],
        summary: "Get submission detail",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "Submission detail",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: { $ref: "#/components/schemas/Submission" },
                  },
                },
              },
            },
          },
          "404": {
            description: "Not found",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" },
              },
            },
          },
        },
      },
    },
    "/submissions/{id}/status": {
      patch: {
        tags: ["Submissions"],
        summary: "Update submission status",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["action"],
                properties: {
                  action: {
                    type: "string",
                    enum: [
                      "approve",
                      "decline",
                      "request-info",
                      "refer-to-siu",
                    ],
                  },
                  justification: { type: "string" },
                  details: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Status updated",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: { $ref: "#/components/schemas/Submission" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/submissions/{id}/indicators": {
      get: {
        tags: ["Submissions"],
        summary: "List fraud indicators for a submission",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
          { name: "category", in: "query", schema: { type: "string" } },
          { name: "severity", in: "query", schema: { type: "string" } },
        ],
        responses: {
          "200": {
            description: "Fraud indicators",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: {
                      type: "array",
                      items: { $ref: "#/components/schemas/FraudIndicator" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/submissions/{id}/risk-report": {
      get: {
        tags: ["Submissions"],
        summary: "Get full risk report with score breakdown",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "Risk report",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/RiskReport" },
              },
            },
          },
        },
      },
    },
    "/intake/email": {
      post: {
        tags: ["Email Intake"],
        summary: "Inbound email webhook for submission via email",
        description:
          "Receives parsed email data from email providers (SendGrid Inbound Parse). Creates a submission from attachments.",
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                properties: {
                  from: { type: "string" },
                  to: { type: "string" },
                  subject: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Email processed",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    submissionId: { type: "string" },
                    documentsCreated: { type: "integer" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/webhooks": {
      get: {
        tags: ["Webhooks"],
        summary: "List active webhook subscriptions",
        responses: {
          "200": {
            description: "Webhook subscriptions",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: {
                      type: "array",
                      items: {
                        $ref: "#/components/schemas/WebhookSubscription",
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      post: {
        tags: ["Webhooks"],
        summary: "Create a webhook subscription",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["url", "events"],
                properties: {
                  url: { type: "string", format: "uri" },
                  events: {
                    type: "array",
                    items: { type: "string" },
                  },
                },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Subscription created with secret (shown once)",
            content: {
              "application/json": {
                schema: {
                  allOf: [
                    { $ref: "#/components/schemas/WebhookSubscription" },
                    {
                      type: "object",
                      properties: { secret: { type: "string" } },
                    },
                  ],
                },
              },
            },
          },
        },
      },
    },
    "/webhooks/{id}": {
      delete: {
        tags: ["Webhooks"],
        summary: "Deactivate a webhook subscription",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": { description: "Subscription deactivated" },
        },
      },
    },
    "/config/thresholds": {
      get: {
        tags: ["Configuration"],
        summary: "Get threshold configuration",
        responses: {
          "200": {
            description: "Threshold config with global and per-LOB overrides",
          },
        },
      },
      put: {
        tags: ["Configuration"],
        summary: "Update global thresholds (ADMIN only)",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  autoApproveBelow: {
                    type: "integer",
                    minimum: 0,
                    maximum: 100,
                  },
                  autoEscalateAbove: {
                    type: "integer",
                    minimum: 0,
                    maximum: 100,
                  },
                  siuReferralOnCritical: { type: "boolean" },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Thresholds updated" },
        },
      },
    },
    "/config/api-keys": {
      get: {
        tags: ["Configuration"],
        summary: "List API keys (ADMIN only)",
        responses: {
          "200": {
            description: "API keys list (key prefix only)",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          id: { type: "string" },
                          name: { type: "string" },
                          keyPrefix: { type: "string" },
                          isActive: { type: "boolean" },
                          createdAt: { type: "string", format: "date-time" },
                          lastUsedAt: {
                            type: "string",
                            format: "date-time",
                            nullable: true,
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      post: {
        tags: ["Configuration"],
        summary: "Create API key (ADMIN only). Returns full key once.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name"],
                properties: {
                  name: { type: "string" },
                  permissions: {
                    type: "array",
                    items: { type: "string" },
                  },
                },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "API key created. The key field is shown only once.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: {
                      type: "object",
                      properties: {
                        id: { type: "string" },
                        name: { type: "string" },
                        key: {
                          type: "string",
                          description: "Full API key - shown only once",
                        },
                        isActive: { type: "boolean" },
                        createdAt: { type: "string", format: "date-time" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/config/api-keys/{id}": {
      patch: {
        tags: ["Configuration"],
        summary: "Revoke an API key (ADMIN only)",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "API key revoked",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    data: {
                      type: "object",
                      properties: {
                        id: { type: "string" },
                        isActive: { type: "boolean" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/audit-logs": {
      get: {
        tags: ["Audit"],
        summary: "List audit logs (ADMIN/COMPLIANCE_OFFICER only)",
        parameters: [
          {
            name: "page",
            in: "query",
            schema: { type: "integer", default: 1 },
          },
          {
            name: "limit",
            in: "query",
            schema: { type: "integer", default: 50 },
          },
          { name: "action", in: "query", schema: { type: "string" } },
          { name: "submissionId", in: "query", schema: { type: "string" } },
          { name: "userId", in: "query", schema: { type: "string" } },
          {
            name: "dateFrom",
            in: "query",
            schema: { type: "string", format: "date" },
          },
          {
            name: "dateTo",
            in: "query",
            schema: { type: "string", format: "date" },
          },
          { name: "search", in: "query", schema: { type: "string" } },
        ],
        responses: {
          "200": {
            description: "Paginated audit logs",
          },
        },
      },
    },
    "/siu-cases": {
      get: {
        tags: ["SIU Cases"],
        summary: "List SIU cases (SIU_INVESTIGATOR/ADMIN only)",
        parameters: [
          { name: "status", in: "query", schema: { type: "string" } },
          { name: "page", in: "query", schema: { type: "integer" } },
          { name: "limit", in: "query", schema: { type: "integer" } },
        ],
        responses: {
          "200": { description: "SIU cases list" },
        },
      },
    },
    "/siu-cases/{id}": {
      get: {
        tags: ["SIU Cases"],
        summary: "Get SIU case detail",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": { description: "SIU case detail" },
        },
      },
      patch: {
        tags: ["SIU Cases"],
        summary: "Update SIU case status, add notes/evidence",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": { description: "SIU case updated" },
        },
      },
    },
    "/analytics/summary": {
      get: {
        tags: ["Analytics"],
        summary: "Get submission analytics summary",
        parameters: [
          {
            name: "range",
            in: "query",
            schema: { type: "string", enum: ["7d", "30d", "90d", "ytd"] },
          },
        ],
        responses: {
          "200": { description: "Analytics summary with KPIs" },
        },
      },
    },
    "/analytics/trends": {
      get: {
        tags: ["Analytics"],
        summary: "Get submission trends over time",
        parameters: [
          {
            name: "range",
            in: "query",
            schema: { type: "string", enum: ["7d", "30d", "90d", "ytd"] },
          },
        ],
        responses: {
          "200": { description: "Trend data with daily/weekly data points" },
        },
      },
    },
  },
  tags: [
    { name: "Authentication", description: "Login and token management" },
    { name: "Submissions", description: "Submission lifecycle management" },
    { name: "Email Intake", description: "Inbound email processing" },
    { name: "Webhooks", description: "Webhook subscription management" },
    { name: "Configuration", description: "Tenant configuration (ADMIN)" },
    { name: "Audit", description: "Compliance audit trail" },
    { name: "SIU Cases", description: "SIU investigation management" },
    { name: "Analytics", description: "Portfolio analytics and reporting" },
  ],
};

// ─── GET /api/docs/openapi.json ────────────────────────
// Serves the OpenAPI specification.

export async function GET() {
  return NextResponse.json(OPENAPI_SPEC, {
    headers: {
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
