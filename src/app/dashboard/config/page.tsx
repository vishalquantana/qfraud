"use client";

import Link from "next/link";

const CONFIG_SECTIONS = [
  {
    title: "Threshold Configuration",
    description:
      "Configure auto-approve, escalation, and SIU referral thresholds for fraud detection routing.",
    href: "/dashboard/config/thresholds",
    icon: (
      <svg
        className="h-6 w-6 text-primary-600 dark:text-primary-400"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.5}
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M10.5 6h9.75M10.5 6a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-9.75 0h9.75"
        />
      </svg>
    ),
  },
  {
    title: "User Management",
    description: "Manage users, roles, and permissions within your organization.",
    href: "/dashboard/config/users",
    icon: (
      <svg
        className="h-6 w-6 text-primary-600 dark:text-primary-400"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.5}
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z"
        />
      </svg>
    ),
  },
  {
    title: "White-Label Settings",
    description: "Configure portal branding, colors, logo, and custom domain.",
    href: "/dashboard/config/white-label",
    icon: (
      <svg
        className="h-6 w-6 text-primary-600 dark:text-primary-400"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.5}
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9.53 16.122a3 3 0 0 0-5.78 1.128 2.25 2.25 0 0 1-2.4 2.245 4.5 4.5 0 0 0 8.4-2.245c0-.399-.078-.78-.22-1.128Zm0 0a15.998 15.998 0 0 0 3.388-1.62m-5.043-.025a15.994 15.994 0 0 1 1.622-3.395m3.42 3.42a15.995 15.995 0 0 0 4.764-4.648l3.876-5.814a1.151 1.151 0 0 0-1.597-1.597L14.146 6.32a15.996 15.996 0 0 0-4.649 4.763m3.42 3.42a6.776 6.776 0 0 0-3.42-3.42"
        />
      </svg>
    ),
  },
  {
    title: "API Keys",
    description: "Manage API keys and access API documentation.",
    href: "/dashboard/config/api",
    icon: (
      <svg
        className="h-6 w-6 text-primary-600 dark:text-primary-400"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.5}
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z"
        />
      </svg>
    ),
  },
];

export default function ConfigPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
          Configuration
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Manage system settings for your organization.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2" role="navigation" aria-label="Configuration sections">
        {CONFIG_SECTIONS.map((section) => (
          <Link
            key={section.href}
            href={section.href}
            className="group rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-colors hover:border-primary-300 hover:bg-primary-50/50 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-primary-700 dark:hover:bg-primary-900/20"
          >
            <div className="flex items-start gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-50 dark:bg-primary-900/30">
                {section.icon}
              </div>
              <div>
                <h2 className="font-semibold text-slate-900 group-hover:text-primary-700 dark:text-white dark:group-hover:text-primary-400">
                  {section.title}
                </h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  {section.description}
                </p>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
