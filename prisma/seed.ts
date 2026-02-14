import { PrismaClient, Role } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createHash, randomBytes } from "crypto";

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = createHash("sha256")
    .update(salt + password)
    .digest("hex");
  return `${salt}:${hash}`;
}

async function main() {
  const connectionString =
    process.env.DATABASE_URL ??
    "postgresql://user:password@localhost:5432/quantana_shield";
  const adapter = new PrismaPg({ connectionString });
  const prisma = new PrismaClient({ adapter });

  // Upsert test tenant
  const tenant = await prisma.tenant.upsert({
    where: { slug: "acme-insurance" },
    update: {},
    create: {
      name: "Acme Insurance MGA",
      slug: "acme-insurance",
      domain: "acme-insurance.quantanashield.com",
      logoUrl: null,
      primaryColor: "#1e40af",
      secondaryColor: "#3b82f6",
    },
  });

  console.log(`Tenant created/found: ${tenant.name} (${tenant.id})`);

  // Create one user per role
  const users: { name: string; email: string; role: Role }[] = [
    { name: "Alice Admin", email: "admin@acme-insurance.com", role: "ADMIN" },
    {
      name: "Uma Underwriter",
      email: "underwriter@acme-insurance.com",
      role: "UNDERWRITER",
    },
    {
      name: "Sam Senior",
      email: "senior.underwriter@acme-insurance.com",
      role: "SENIOR_UNDERWRITER",
    },
    {
      name: "Ian Investigator",
      email: "siu@acme-insurance.com",
      role: "SIU_INVESTIGATOR",
    },
    {
      name: "Carla Compliance",
      email: "compliance@acme-insurance.com",
      role: "COMPLIANCE_OFFICER",
    },
    {
      name: "Bob Broker",
      email: "broker@acme-insurance.com",
      role: "BROKER",
    },
  ];

  for (const userData of users) {
    const user = await prisma.user.upsert({
      where: {
        tenantId_email: {
          tenantId: tenant.id,
          email: userData.email,
        },
      },
      update: {},
      create: {
        tenantId: tenant.id,
        name: userData.name,
        email: userData.email,
        role: userData.role,
        passwordHash: hashPassword("Password123!"),
        isActive: true,
      },
    });
    console.log(`  User: ${user.name} (${user.role})`);
  }

  console.log("Seed completed successfully.");
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
