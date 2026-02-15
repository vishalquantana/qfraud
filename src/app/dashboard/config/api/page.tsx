"use client";

import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";

// Lazy-load SwaggerUI to avoid SSR issues
const SwaggerUI = dynamic(() => import("swagger-ui-react"), { ssr: false });

// ─── Types ──────────────────────────────────────────────

interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  isActive: boolean;
  permissions: string[];
  createdAt: string;
  lastUsedAt: string | null;
}

// ─── Component ──────────────────────────────────────────

export default function ApiKeyManagementPage() {
  const [loading, setLoading] = useState(true);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Create modal state
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState("");
  const [creating, setCreating] = useState(false);

  // Newly created key (shown once)
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Active tab
  const [activeTab, setActiveTab] = useState<"keys" | "docs">("keys");

  // Sandbox toggle
  const [sandbox, setSandbox] = useState(false);

  // ─── Fetch ──────────────────────────────────────────

  const fetchKeys = useCallback(async () => {
    try {
      const res = await fetch("/api/config/api-keys");
      if (!res.ok) throw new Error("Failed to load API keys");
      const json = await res.json();
      setKeys(json.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  // Auto-dismiss notifications
  useEffect(() => {
    if (success) {
      const t = setTimeout(() => setSuccess(null), 5000);
      return () => clearTimeout(t);
    }
  }, [success]);

  useEffect(() => {
    if (error) {
      const t = setTimeout(() => setError(null), 5000);
      return () => clearTimeout(t);
    }
  }, [error]);

  // ─── Handlers ───────────────────────────────────────

  const handleCreate = async () => {
    if (!createName.trim()) return;
    setCreating(true);
    setError(null);

    try {
      const res = await fetch("/api/config/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: createName.trim() }),
      });

      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || "Failed to create API key");
      }

      const json = await res.json();
      setNewKey(json.data.key);
      setCopied(false);
      setShowCreate(false);
      setCreateName("");
      setSuccess(`API key "${json.data.name}" created successfully`);
      await fetchKeys();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create");
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (key: ApiKey) => {
    if (
      !window.confirm(
        `Are you sure you want to revoke "${key.name}"? This cannot be undone.`
      )
    )
      return;

    try {
      const res = await fetch(`/api/config/api-keys/${key.id}`, {
        method: "PATCH",
      });

      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || "Failed to revoke");
      }

      setSuccess(`API key "${key.name}" has been revoked`);
      await fetchKeys();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to revoke");
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const el = document.createElement("textarea");
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // ─── Render ─────────────────────────────────────────

  const activeKeys = keys.filter((k) => k.isActive);
  const revokedKeys = keys.filter((k) => !k.isActive);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            API Keys &amp; Documentation
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Manage API keys and access the API documentation.
          </p>
        </div>
      </div>

      {/* Notifications */}
      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </div>
      )}
      {success && (
        <div role="status" className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-400">
          {success}
        </div>
      )}

      {/* Newly created key banner */}
      {newKey && (
        <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-900/20">
          <div className="flex items-start gap-3">
            <svg
              className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
              />
            </svg>
            <div className="flex-1">
              <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                Save your API key now — it won&apos;t be shown again
              </p>
              <div className="mt-2 flex items-center gap-2">
                <code className="flex-1 rounded-md border border-amber-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 dark:border-amber-600 dark:bg-slate-800 dark:text-white">
                  {newKey}
                </code>
                <button
                  onClick={() => copyToClipboard(newKey)}
                  className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm font-medium text-amber-700 hover:bg-amber-100 dark:border-amber-600 dark:bg-slate-800 dark:text-amber-400 dark:hover:bg-slate-700"
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
              <button
                onClick={() => setNewKey(null)}
                className="mt-2 text-xs text-amber-600 underline hover:text-amber-800 dark:text-amber-400 dark:hover:text-amber-300"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-slate-200 dark:border-slate-700">
        <nav className="flex gap-6" role="tablist" aria-label="API management">
          <button
            onClick={() => setActiveTab("keys")}
            role="tab"
            aria-selected={activeTab === "keys"}
            className={`border-b-2 pb-3 text-sm font-medium transition-colors ${
              activeTab === "keys"
                ? "border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400"
                : "border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300"
            }`}
          >
            API Keys
            {activeKeys.length > 0 && (
              <span className="ml-2 rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-900/40 dark:text-blue-400">
                {activeKeys.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab("docs")}
            role="tab"
            aria-selected={activeTab === "docs"}
            className={`border-b-2 pb-3 text-sm font-medium transition-colors ${
              activeTab === "docs"
                ? "border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400"
                : "border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300"
            }`}
          >
            API Documentation
          </button>
        </nav>
      </div>

      {/* API Keys Tab */}
      {activeTab === "keys" && (
        <div className="space-y-6">
          {/* Sandbox toggle + Create button */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-sm text-slate-600 dark:text-slate-400">
                Environment:
              </span>
              <button
                onClick={() => setSandbox(!sandbox)}
                className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                  sandbox
                    ? "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-400"
                    : "border-green-300 bg-green-50 text-green-700 dark:border-green-700 dark:bg-green-900/20 dark:text-green-400"
                }`}
              >
                <span
                  className={`h-2 w-2 rounded-full ${sandbox ? "bg-amber-500" : "bg-green-500"}`}
                />
                {sandbox ? "Sandbox" : "Production"}
              </button>
            </div>
            <button
              onClick={() => setShowCreate(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
            >
              <svg
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 4.5v15m7.5-7.5h-15"
                />
              </svg>
              Create API Key
            </button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12" aria-busy="true">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
            </div>
          ) : (
            <>
              {/* Active Keys */}
              <div className="rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
                <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-700">
                  <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                    Active Keys ({activeKeys.length})
                  </h2>
                </div>
                {activeKeys.length === 0 ? (
                  <div className="px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400">
                    No active API keys. Create one to get started.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/50">
                        <tr>
                          <th className="px-4 py-3 text-left font-medium text-slate-600 dark:text-slate-400">
                            Name
                          </th>
                          <th className="px-4 py-3 text-left font-medium text-slate-600 dark:text-slate-400">
                            Key Prefix
                          </th>
                          <th className="px-4 py-3 text-left font-medium text-slate-600 dark:text-slate-400">
                            Created
                          </th>
                          <th className="px-4 py-3 text-left font-medium text-slate-600 dark:text-slate-400">
                            Last Used
                          </th>
                          <th className="px-4 py-3 text-left font-medium text-slate-600 dark:text-slate-400">
                            Status
                          </th>
                          <th className="px-4 py-3 text-right font-medium text-slate-600 dark:text-slate-400">
                            Actions
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                        {activeKeys.map((key) => (
                          <tr
                            key={key.id}
                            className="bg-white hover:bg-slate-50 dark:bg-slate-800 dark:hover:bg-slate-750"
                          >
                            <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">
                              {key.name}
                            </td>
                            <td className="px-4 py-3">
                              <code className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-700 dark:bg-slate-700 dark:text-slate-300">
                                {key.keyPrefix}...
                              </code>
                            </td>
                            <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                              {new Date(key.createdAt).toLocaleDateString()}
                            </td>
                            <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                              {key.lastUsedAt
                                ? new Date(key.lastUsedAt).toLocaleDateString()
                                : "Never"}
                            </td>
                            <td className="px-4 py-3">
                              <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/40 dark:text-green-400">
                                <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                                Active
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <button
                                onClick={() => handleRevoke(key)}
                                className="rounded-lg px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
                              >
                                Revoke
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Revoked Keys */}
              {revokedKeys.length > 0 && (
                <div className="rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
                  <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-700">
                    <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400">
                      Revoked Keys ({revokedKeys.length})
                    </h2>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/50">
                        <tr>
                          <th className="px-4 py-3 text-left font-medium text-slate-600 dark:text-slate-400">
                            Name
                          </th>
                          <th className="px-4 py-3 text-left font-medium text-slate-600 dark:text-slate-400">
                            Key Prefix
                          </th>
                          <th className="px-4 py-3 text-left font-medium text-slate-600 dark:text-slate-400">
                            Created
                          </th>
                          <th className="px-4 py-3 text-left font-medium text-slate-600 dark:text-slate-400">
                            Last Used
                          </th>
                          <th className="px-4 py-3 text-left font-medium text-slate-600 dark:text-slate-400">
                            Status
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                        {revokedKeys.map((key) => (
                          <tr
                            key={key.id}
                            className="bg-white opacity-60 dark:bg-slate-800"
                          >
                            <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">
                              {key.name}
                            </td>
                            <td className="px-4 py-3">
                              <code className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-700 dark:bg-slate-700 dark:text-slate-300">
                                {key.keyPrefix}...
                              </code>
                            </td>
                            <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                              {new Date(key.createdAt).toLocaleDateString()}
                            </td>
                            <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                              {key.lastUsedAt
                                ? new Date(key.lastUsedAt).toLocaleDateString()
                                : "Never"}
                            </td>
                            <td className="px-4 py-3">
                              <span className="inline-flex items-center gap-1.5 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/40 dark:text-red-400">
                                <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                                Revoked
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* API Documentation Tab */}
      {activeTab === "docs" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
            <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-700">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
                  OpenAPI Specification
                </h2>
                <a
                  href="/api/docs/openapi.json"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-600 hover:underline dark:text-blue-400"
                >
                  View raw JSON
                </a>
              </div>
            </div>
            <div className="swagger-ui-wrapper p-4">
              <SwaggerUI url="/api/docs/openapi.json" />
            </div>
          </div>
        </div>
      )}

      {/* Create API Key Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div role="dialog" aria-modal="true" aria-label="Create API key" className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl dark:bg-slate-800">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
              Create API Key
            </h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              The full API key will be shown only once after creation. Make sure
              to copy it.
            </p>

            <div className="mt-4">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                Key Name
              </label>
              <input
                type="text"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate();
                }}
                placeholder="e.g., Production API, Staging Integration"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none dark:border-slate-600 dark:bg-slate-700 dark:text-white"
                autoFocus
              />
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => {
                  setShowCreate(false);
                  setCreateName("");
                }}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={!createName.trim() || creating}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 dark:bg-blue-500 dark:hover:bg-blue-600"
              >
                {creating ? "Creating..." : "Create Key"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
