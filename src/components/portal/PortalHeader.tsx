"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";

interface PortalHeaderProps {
  tenantName: string;
  logoUrl: string | null;
}

export default function PortalHeader({
  tenantName,
  logoUrl,
}: PortalHeaderProps) {
  const pathname = usePathname();
  const { data: session } = useSession();

  const navLinks = [
    { href: "/portal/submissions/new", label: "New Submission" },
    { href: "/portal/submissions", label: "My Submissions" },
  ];

  return (
    <header className="border-b border-[var(--portal-secondary)]/20 bg-white shadow-sm">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-8">
          <Link href="/portal" className="flex items-center gap-3">
            {logoUrl ? (
              <Image
                src={logoUrl}
                alt={tenantName}
                width={120}
                height={32}
                className="h-8 w-auto object-contain"
              />
            ) : (
              <span
                className="text-xl font-bold"
                style={{ color: "var(--portal-primary)" }}
              >
                {tenantName}
              </span>
            )}
          </Link>

          {session && (
            <nav className="hidden items-center gap-1 md:flex">
              {navLinks.map((link) => {
                const isActive = pathname === link.href;
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                      isActive
                        ? "text-[var(--portal-primary)] bg-[var(--portal-primary)]/5"
                        : "text-slate-600 hover:text-[var(--portal-primary)] hover:bg-slate-50"
                    }`}
                  >
                    {link.label}
                  </Link>
                );
              })}
            </nav>
          )}
        </div>

        {session && (
          <div className="flex items-center gap-4">
            <span className="hidden text-sm text-slate-500 sm:block">
              {session.user.name}
            </span>
            <button
              onClick={() => signOut({ callbackUrl: "/portal/login" })}
              className="rounded-md px-3 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
            >
              Sign Out
            </button>
          </div>
        )}
      </div>

      {/* Mobile navigation */}
      {session && (
        <nav className="border-t border-slate-100 md:hidden">
          <div className="mx-auto flex max-w-7xl gap-1 px-4 py-2">
            {navLinks.map((link) => {
              const isActive = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? "text-[var(--portal-primary)] bg-[var(--portal-primary)]/5"
                      : "text-slate-600 hover:text-[var(--portal-primary)]"
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </div>
        </nav>
      )}
    </header>
  );
}
