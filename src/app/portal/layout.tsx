import { prisma } from "@/lib/prisma";
import PortalShell from "@/components/portal/PortalShell";
import type { PortalConfig } from "@/components/portal/PortalShell";

const DEFAULT_TENANT_SLUG = process.env.DEFAULT_TENANT_SLUG ?? "test-mga";

async function getPortalConfig(): Promise<PortalConfig> {
  const tenant = await prisma.tenant.findUnique({
    where: { slug: DEFAULT_TENANT_SLUG },
    include: { whiteLabelConfig: true },
  });

  if (!tenant) {
    return {
      tenantId: "",
      tenantName: "Insurance Portal",
      slug: DEFAULT_TENANT_SLUG,
      logoUrl: null,
      primaryColor: "#1e40af",
      secondaryColor: "#3b82f6",
      accentColor: "#f59e0b",
      footerText: null,
      termsUrl: null,
      privacyUrl: null,
      supportEmail: null,
      supportPhone: null,
    };
  }

  const config = tenant.whiteLabelConfig;

  return {
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
  };
}

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const config = await getPortalConfig();

  return <PortalShell config={config}>{children}</PortalShell>;
}
