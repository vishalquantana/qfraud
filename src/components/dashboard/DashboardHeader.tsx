"use client";

import { useSession, signOut } from "next-auth/react";
import { useTheme } from "./DashboardShell";

const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Admin",
  UNDERWRITER: "Underwriter",
  SENIOR_UNDERWRITER: "Sr. Underwriter",
  SIU_INVESTIGATOR: "SIU Investigator",
  COMPLIANCE_OFFICER: "Compliance",
  BROKER: "Broker",
};

interface DashboardHeaderProps {
  tenantName: string;
  onOpenSidebar: () => void;
}

export default function DashboardHeader({
  tenantName,
  onOpenSidebar,
}: DashboardHeaderProps) {
  const { data: session } = useSession();
  const { theme, toggleTheme } = useTheme();
  const userRole = session?.user?.role ?? "";

  return (
    <header className="flex h-16 items-center justify-between border-b border-slate-200 bg-white px-6 dark:border-slate-700 dark:bg-slate-800">
      {/* Left: mobile menu button + tenant */}
      <div className="flex items-center gap-4">
        <button
          onClick={onOpenSidebar}
          className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-300 lg:hidden"
        >
          <svg
            className="h-6 w-6"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"
            />
          </svg>
        </button>

        <div className="hidden items-center gap-2 lg:flex">
          <span className="text-sm text-slate-500 dark:text-slate-400">
            {tenantName}
          </span>
          <span className="text-xs text-slate-300 dark:text-slate-600">|</span>
          <span className="text-xs text-slate-400 dark:text-slate-500">
            Powered by Quantana Shield
          </span>
        </div>
      </div>

      {/* Right: user info + theme toggle + sign out */}
      <div className="flex items-center gap-3">
        {/* Dark/Light mode toggle */}
        <button
          onClick={toggleTheme}
          className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-300"
          title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        >
          {theme === "dark" ? (
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z"
              />
            </svg>
          ) : (
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z"
              />
            </svg>
          )}
        </button>

        {session && (
          <>
            <div className="hidden items-center gap-2 sm:flex">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                {session.user.name}
              </span>
              <span className="rounded-full bg-primary-100 px-2 py-0.5 text-xs font-medium text-primary-700 dark:bg-primary-900/40 dark:text-primary-400">
                {ROLE_LABELS[userRole] ?? userRole}
              </span>
            </div>

            <button
              onClick={() => signOut({ callbackUrl: "/dashboard/login" })}
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200"
            >
              Sign Out
            </button>
          </>
        )}
      </div>
    </header>
  );
}
