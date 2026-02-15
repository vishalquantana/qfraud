"use client";

import { useState, useEffect, useCallback } from "react";

interface ServiceStatus {
  status: "healthy" | "degraded" | "unhealthy";
  latencyMs?: number;
  error?: string;
  details?: Record<string, unknown>;
}

interface HealthData {
  status: "healthy" | "unhealthy";
  timestamp: string;
  version: string;
  services: Record<string, ServiceStatus>;
}

const STATUS_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  healthy: {
    bg: "bg-green-50 dark:bg-green-900/20",
    text: "text-green-700 dark:text-green-400",
    dot: "bg-green-500",
  },
  degraded: {
    bg: "bg-yellow-50 dark:bg-yellow-900/20",
    text: "text-yellow-700 dark:text-yellow-400",
    dot: "bg-yellow-500",
  },
  unhealthy: {
    bg: "bg-red-50 dark:bg-red-900/20",
    text: "text-red-700 dark:text-red-400",
    dot: "bg-red-500",
  },
};

const SERVICE_LABELS: Record<string, { name: string; description: string }> = {
  database: { name: "PostgreSQL", description: "Primary database" },
  queue: { name: "BullMQ / Redis", description: "Job processing queue" },
  storage: { name: "S3 Storage", description: "Document file storage" },
  gemini: { name: "Gemini AI", description: "AI analysis engine" },
  email: { name: "Email Service", description: "Notification delivery" },
};

function StatusBadge({ status }: { status: string }) {
  const colors = STATUS_COLORS[status] ?? STATUS_COLORS.unhealthy;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${colors.bg} ${colors.text}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${colors.dot}`} />
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

function ServiceCard({ name, service }: { name: string; service: ServiceStatus }) {
  const label = SERVICE_LABELS[name] ?? { name, description: "" };
  const colors = STATUS_COLORS[service.status] ?? STATUS_COLORS.unhealthy;

  return (
    <div
      className={`rounded-lg border p-4 ${colors.bg} border-current/10`}
      role="listitem"
      aria-label={`${label.name}: ${service.status}`}
    >
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-medium text-gray-900 dark:text-gray-100">
            {label.name}
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {label.description}
          </p>
        </div>
        <StatusBadge status={service.status} />
      </div>

      {service.latencyMs !== undefined && (
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          Latency: {service.latencyMs}ms
        </p>
      )}

      {service.error && (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">
          {service.error}
        </p>
      )}

      {service.details && (
        <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          {Object.entries(service.details).map(([key, value]) => (
            <span key={key} className="mr-3">
              {key}: {String(value)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function HealthPage() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchHealth = useCallback(async () => {
    try {
      const res = await fetch("/api/health");
      const data = await res.json();
      setHealth(data);
      setError(null);
      setLastChecked(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch health status");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHealth();
  }, [fetchHealth]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchHealth, 30000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchHealth]);

  const overallColors = health
    ? STATUS_COLORS[health.status] ?? STATUS_COLORS.unhealthy
    : STATUS_COLORS.unhealthy;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            System Health
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Real-time status of all platform services
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300"
              aria-label="Auto-refresh every 30 seconds"
            />
            Auto-refresh
          </label>
          <button
            onClick={fetchHealth}
            disabled={loading}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            aria-label="Refresh health status"
          >
            {loading ? "Checking..." : "Refresh"}
          </button>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400"
        >
          {error}
        </div>
      )}

      {/* Overall Status Banner */}
      {health && (
        <div
          className={`rounded-lg border p-6 ${overallColors.bg} border-current/10`}
          role="status"
          aria-label={`Overall system status: ${health.status}`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className={`h-4 w-4 rounded-full ${overallColors.dot}`} />
              <div>
                <h2 className={`text-lg font-semibold ${overallColors.text}`}>
                  System {health.status === "healthy" ? "Operational" : "Degraded"}
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Version {health.version}
                </p>
              </div>
            </div>
            {lastChecked && (
              <p className="text-xs text-gray-400">
                Last checked: {lastChecked.toLocaleTimeString()}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && !health && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="h-28 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800"
            />
          ))}
        </div>
      )}

      {/* Service Cards */}
      {health && (
        <div
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          role="list"
          aria-label="Service health status"
        >
          {Object.entries(health.services).map(([name, service]) => (
            <ServiceCard key={name} name={name} service={service} />
          ))}
        </div>
      )}

      {/* Uptime info */}
      {health && (
        <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Service Summary
          </h3>
          <div className="mt-2 grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-2xl font-bold text-green-600">
                {Object.values(health.services).filter((s) => s.status === "healthy").length}
              </p>
              <p className="text-xs text-gray-500">Healthy</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-yellow-600">
                {Object.values(health.services).filter((s) => s.status === "degraded").length}
              </p>
              <p className="text-xs text-gray-500">Degraded</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-red-600">
                {Object.values(health.services).filter((s) => s.status === "unhealthy").length}
              </p>
              <p className="text-xs text-gray-500">Unhealthy</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
