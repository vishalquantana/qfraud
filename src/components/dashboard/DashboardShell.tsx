"use client";

import { SessionProvider } from "next-auth/react";
import DashboardSidebar from "./DashboardSidebar";
import DashboardHeader from "./DashboardHeader";
import { useState, useEffect, useSyncExternalStore, createContext, useContext } from "react";

interface DashboardShellProps {
  tenantName: string;
  children: React.ReactNode;
}

type Theme = "light" | "dark";

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: "light",
  toggleTheme: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

function getInitialTheme(): Theme {
  if (typeof window === "undefined") return "light";
  const saved = localStorage.getItem("dashboard-theme");
  if (saved === "dark" || saved === "light") return saved;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function subscribeToTheme(callback: () => void) {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", callback);
  return () => mq.removeEventListener("change", callback);
}

function getThemeSnapshot(): Theme {
  const saved = localStorage.getItem("dashboard-theme");
  if (saved === "dark" || saved === "light") return saved;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function getThemeServerSnapshot(): Theme {
  return "light";
}

export default function DashboardShell({
  tenantName,
  children,
}: DashboardShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const systemTheme = useSyncExternalStore(
    subscribeToTheme,
    getThemeSnapshot,
    getThemeServerSnapshot,
  );
  const [theme, setTheme] = useState<Theme>(getInitialTheme);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("dashboard-theme", theme);
  }, [theme, systemTheme]);

  function toggleTheme() {
    setTheme((prev) => (prev === "light" ? "dark" : "light"));
  }

  return (
    <SessionProvider>
      <ThemeContext.Provider value={{ theme, toggleTheme }}>
        <div className="flex h-screen bg-slate-100 dark:bg-slate-900">
          {/* Mobile sidebar overlay */}
          {sidebarOpen && (
            <div
              className="fixed inset-0 z-40 bg-black/50 lg:hidden"
              onClick={() => setSidebarOpen(false)}
            />
          )}

          {/* Sidebar */}
          <DashboardSidebar
            tenantName={tenantName}
            isOpen={sidebarOpen}
            isCollapsed={sidebarCollapsed}
            onClose={() => setSidebarOpen(false)}
            onToggleCollapse={() => setSidebarCollapsed((prev) => !prev)}
          />

          {/* Main content area */}
          <div className="flex flex-1 flex-col overflow-hidden">
            <DashboardHeader
              tenantName={tenantName}
              onOpenSidebar={() => setSidebarOpen(true)}
            />

            <main className="flex-1 overflow-y-auto p-6">{children}</main>
          </div>
        </div>
      </ThemeContext.Provider>
    </SessionProvider>
  );
}
