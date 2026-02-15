import { prisma } from "@/lib/prisma";
import DashboardShell from "@/components/dashboard/DashboardShell";

export const dynamic = "force-dynamic";

async function getTenantName(): Promise<string> {
  const slug = process.env.DEFAULT_TENANT_SLUG ?? "test-mga";
  const tenant = await prisma.tenant.findUnique({
    where: { slug },
    select: { name: true },
  });
  return tenant?.name ?? "Quantana Shield";
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const tenantName = await getTenantName();

  return <DashboardShell tenantName={tenantName}>{children}</DashboardShell>;
}
