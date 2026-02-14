"use client";

import { SessionProvider } from "next-auth/react";
import PortalHeader from "./PortalHeader";

export interface PortalConfig {
  tenantId: string;
  tenantName: string;
  slug: string;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  footerText: string | null;
  termsUrl: string | null;
  privacyUrl: string | null;
  supportEmail: string | null;
  supportPhone: string | null;
}

interface PortalShellProps {
  config: PortalConfig;
  children: React.ReactNode;
}

export default function PortalShell({ config, children }: PortalShellProps) {
  return (
    <SessionProvider>
      <div
        className="flex min-h-screen flex-col bg-slate-50"
        style={
          {
            "--portal-primary": config.primaryColor,
            "--portal-secondary": config.secondaryColor,
            "--portal-accent": config.accentColor,
          } as React.CSSProperties
        }
      >
        <PortalHeader
          tenantName={config.tenantName}
          logoUrl={config.logoUrl}
        />

        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 lg:px-8">
          {children}
        </main>

        <footer className="border-t border-slate-200 bg-white">
          <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
            <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
              <p className="text-sm text-slate-500">
                {config.footerText ??
                  `\u00A9 ${new Date().getFullYear()} ${config.tenantName}. All rights reserved.`}
              </p>
              <div className="flex items-center gap-4">
                {config.termsUrl && (
                  <a
                    href={config.termsUrl}
                    className="text-sm text-slate-500 hover:text-slate-700"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Terms of Use
                  </a>
                )}
                {config.privacyUrl && (
                  <a
                    href={config.privacyUrl}
                    className="text-sm text-slate-500 hover:text-slate-700"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Privacy Policy
                  </a>
                )}
                {config.supportEmail && (
                  <a
                    href={`mailto:${config.supportEmail}`}
                    className="text-sm text-slate-500 hover:text-slate-700"
                  >
                    Support
                  </a>
                )}
              </div>
            </div>
          </div>
        </footer>
      </div>
    </SessionProvider>
  );
}
