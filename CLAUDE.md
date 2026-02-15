# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
npm run dev              # Start Next.js dev server (localhost:3000)
npm run build            # Production build
npm run lint             # ESLint (flat config, ESLint 9)
npm run format           # Prettier
npm run typecheck        # tsc --noEmit
npm test                 # vitest run (all unit tests)
npm run test:watch       # vitest in watch mode
npm run test:coverage    # vitest with v8 coverage
npm run test:e2e         # Playwright E2E tests (chromium)
npm run test:e2e:ui      # Playwright with interactive UI
```

### Single test file
```bash
npx vitest run src/services/__tests__/scoring-engine.test.ts
```

### Prisma
```bash
DATABASE_URL="..." npx prisma generate        # Generate client (needs DATABASE_URL)
npx prisma migrate deploy                     # Apply migrations
npx prisma db seed                            # Run seed script
npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script  # Generate SQL without DB
```

## Architecture

**Quantana Shield** is an insurance fraud detection platform with a multi-tenant, role-based architecture.

### Tech Stack
- Next.js 16 (App Router) + TypeScript strict mode
- Prisma 7 with `@prisma/adapter-pg` (PrismaPg driver adapter, not direct DB URL)
- Tailwind CSS v4 (`@theme inline` in CSS, no tailwind.config.js)
- Vitest 4 (unit tests) + Playwright (E2E)
- BullMQ + ioredis (job queue, caching, rate limiting)
- `@google/generative-ai` (Gemini SDK for AI extraction/analysis)
- pino for structured logging

### Directory Layout
```
src/
  app/                  # Next.js App Router
    api/                # REST API routes
    dashboard/          # Admin/underwriter dashboard pages
    portal/             # Broker submission portal pages
  components/
    dashboard/          # Dashboard React components
    portal/             # Portal React components
  lib/                  # Shared utilities (auth, prisma, redis, s3, queue, etc.)
  services/             # Business logic (extraction, detection, scoring, routing)
  test/                 # Test setup and fixtures
  generated/prisma/     # Prisma generated client (import from @/generated/prisma/client)
prisma/                 # Schema, migrations, seed
e2e/                    # Playwright E2E specs + helpers
```

### Key Patterns

**Multi-tenancy**: Every DB query must scope by tenant. Use `withTenantFilter(tenantId, { ...where })` from `src/lib/rbac.ts`.

**Auth**: Dual auth via `extractAuth()` in `src/lib/auth-middleware.ts`:
- JWT (NextAuth v4) for dashboard/portal users
- API key (SHA-256 hashed, `X-API-Key` header) for programmatic access

**RBAC**: Role hierarchy in `src/lib/rbac.ts`:
- ADMIN > SENIOR_UNDERWRITER > UNDERWRITER (hierarchical)
- SIU_INVESTIGATOR, COMPLIANCE_OFFICER (independent, match self or ADMIN)
- BROKER (restricted to portal endpoints only)

**API route pattern**: Use `withAuth()` / `withTenant()` / `withRole()` wrappers from `src/lib/rbac.ts` and `src/lib/api-handler.ts`.

**Prisma singleton**: `src/lib/prisma.ts` — uses `PrismaPg` adapter with `pg.PoolConfig`. Import: `import { PrismaClient } from "@/generated/prisma/client"`.

**Processing pipeline** (`src/services/pipeline.ts`): classify -> extract -> Phase 1 detect -> Phase 2 detect -> score -> route.

**Extraction**: Dual pipeline (regex + Gemini AI) with cross-validation. OCR fallback via Tesseract.js for scanned PDFs.

**Fraud detection categories**: CROSS_DOC, FORENSIC, STATISTICAL, TEMPORAL, RATIO, ENTITY_INTEL, VISUAL_AI, NLP, API_VERIFY, RULES.

**Scoring**: `calculateRiskScore()` aggregates non-overridden FraudIndicators with severity weights.

**Routing**: `routeSubmission()` uses tenant ThresholdConfig to auto-approve, escalate, or refer to SIU.

### Testing

**Unit tests** (`vitest`): Files in `src/services/__tests__/` and `src/lib/__tests__/`. Global mocks for logger and Prisma in `src/test/setup.ts`. Fixtures in `src/test/fixtures.ts`.

**E2E tests** (`playwright`): Files in `e2e/`. Login helpers and assertion utils in `e2e/helpers.ts`.

**pdf-parse v2 mocking**: Use class-based mock — `new PDFParse({ data })` then `.getText()` then `.destroy()`.

### Notification
`sendNotification(type, recipientEmail, tenantId, data)` — tenantId is the required 3rd argument.

### Webhooks
`dispatchWebhookEvent(tenantId, event, data)` — HMAC-SHA256 signature in `X-Webhook-Signature` header.

### UI Patterns
- Dark mode: `useSyncExternalStore` (not useState+useEffect), localStorage key `dashboard-theme`
- Drag-and-drop: @dnd-kit with useDroppable/useDraggable
- Charts: Recharts with ResponsiveContainer
- White-label CSS vars: `--portal-primary`, `--portal-secondary`, `--portal-accent`
