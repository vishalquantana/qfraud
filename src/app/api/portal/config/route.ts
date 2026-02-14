import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("slug");

  if (!slug) {
    return NextResponse.json(
      { error: "Missing slug parameter" },
      { status: 400 },
    );
  }

  const tenant = await prisma.tenant.findUnique({
    where: { slug },
    include: { whiteLabelConfig: true },
  });

  if (!tenant) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  }

  const config = tenant.whiteLabelConfig;

  return NextResponse.json({
    tenantId: tenant.id,
    tenantName: tenant.name,
    slug: tenant.slug,
    logoUrl: config?.logoUrl ?? tenant.logoUrl ?? null,
    primaryColor: config?.primaryColor ?? "#1e40af",
    secondaryColor: config?.secondaryColor ?? "#3b82f6",
    accentColor: config?.accentColor ?? "#f59e0b",
    footerText: config?.footerText ?? null,
    termsUrl: config?.termsUrl ?? null,
    privacyUrl: config?.privacyUrl ?? null,
    supportEmail: config?.supportEmail ?? null,
    supportPhone: config?.supportPhone ?? null,
  });
}
