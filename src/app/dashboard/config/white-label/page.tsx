"use client";

import { useState, useEffect, useCallback, useRef } from "react";

// ─── Types ──────────────────────────────────────────────

interface WhiteLabelConfig {
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  customDomain: string | null;
  customEmailDomain: string | null;
  termsUrl: string | null;
  privacyUrl: string | null;
  footerText: string | null;
  supportEmail: string | null;
  supportPhone: string | null;
}

const DEFAULT_CONFIG: WhiteLabelConfig = {
  logoUrl: null,
  primaryColor: "#1e40af",
  secondaryColor: "#3b82f6",
  accentColor: "#f59e0b",
  customDomain: null,
  customEmailDomain: null,
  termsUrl: null,
  privacyUrl: null,
  footerText: null,
  supportEmail: null,
  supportPhone: null,
};

// ─── Component ──────────────────────────────────────────

export default function WhiteLabelSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [config, setConfig] = useState<WhiteLabelConfig>(DEFAULT_CONFIG);
  const [originalConfig, setOriginalConfig] =
    useState<WhiteLabelConfig>(DEFAULT_CONFIG);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ─── Fetch config ───────────────────────────────────────

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch("/api/config/white-label");
      if (!res.ok) throw new Error("Failed to load configuration");
      const json = await res.json();
      setConfig(json.data);
      setOriginalConfig(json.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  // ─── Auto-dismiss notifications ─────────────────────────

  useEffect(() => {
    if (success) {
      const t = setTimeout(() => setSuccess(null), 4000);
      return () => clearTimeout(t);
    }
  }, [success]);

  useEffect(() => {
    if (error) {
      const t = setTimeout(() => setError(null), 6000);
      return () => clearTimeout(t);
    }
  }, [error]);

  // ─── Has changes check ─────────────────────────────────

  const hasChanges =
    config.primaryColor !== originalConfig.primaryColor ||
    config.secondaryColor !== originalConfig.secondaryColor ||
    config.accentColor !== originalConfig.accentColor ||
    (config.customDomain ?? "") !== (originalConfig.customDomain ?? "") ||
    (config.customEmailDomain ?? "") !==
      (originalConfig.customEmailDomain ?? "") ||
    (config.termsUrl ?? "") !== (originalConfig.termsUrl ?? "") ||
    (config.privacyUrl ?? "") !== (originalConfig.privacyUrl ?? "") ||
    (config.footerText ?? "") !== (originalConfig.footerText ?? "") ||
    (config.supportEmail ?? "") !== (originalConfig.supportEmail ?? "") ||
    (config.supportPhone ?? "") !== (originalConfig.supportPhone ?? "");

  // ─── Logo upload ────────────────────────────────────────

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingLogo(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("logo", file);

      const res = await fetch("/api/config/white-label/logo", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? "Upload failed");
      }

      const json = await res.json();
      setConfig((prev) => ({ ...prev, logoUrl: json.data.logoUrl }));
      setOriginalConfig((prev) => ({ ...prev, logoUrl: json.data.logoUrl }));
      setSuccess("Logo uploaded successfully");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploadingLogo(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // ─── Save config ────────────────────────────────────────

  const handleSave = async () => {
    setSaving(true);
    setError(null);

    try {
      const res = await fetch("/api/config/white-label", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          primaryColor: config.primaryColor,
          secondaryColor: config.secondaryColor,
          accentColor: config.accentColor,
          customDomain: config.customDomain,
          customEmailDomain: config.customEmailDomain,
          termsUrl: config.termsUrl,
          privacyUrl: config.privacyUrl,
          footerText: config.footerText,
          supportEmail: config.supportEmail,
          supportPhone: config.supportPhone,
        }),
      });

      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? "Save failed");
      }

      const json = await res.json();
      setConfig(json.data);
      setOriginalConfig(json.data);
      setSuccess("White-label settings saved successfully");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  // ─── Loading state ──────────────────────────────────────

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
        <div className="animate-pulse space-y-4" aria-busy="true">
          <div className="h-8 w-48 rounded bg-slate-200 dark:bg-slate-700" />
          <div className="h-64 rounded-xl bg-slate-200 dark:bg-slate-700" />
          <div className="h-48 rounded-xl bg-slate-200 dark:bg-slate-700" />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
          White-Label Settings
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Configure the submission portal&apos;s branding, colors, and contact
          information.
        </p>
      </div>

      {/* Notifications */}
      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">
          {error}
        </div>
      )}
      {success && (
        <div role="status" className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-700 dark:border-green-800 dark:bg-green-900/30 dark:text-green-400">
          {success}
        </div>
      )}

      {/* Logo Upload */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
          Logo
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Upload your organization&apos;s logo for the submission portal.
          Recommended size: 200x48px. Supported formats: PNG, JPEG, SVG, WebP
          (max 5MB).
        </p>
        <div className="mt-4 flex items-center gap-6">
          <div className="flex h-20 w-48 items-center justify-center rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 dark:border-slate-600 dark:bg-slate-700/50">
            {config.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={config.logoUrl}
                alt="Tenant logo"
                className="max-h-16 max-w-40 object-contain"
              />
            ) : (
              <span className="text-sm text-slate-400 dark:text-slate-500">
                No logo uploaded
              </span>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingLogo}
              className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-primary-500 dark:hover:bg-primary-600"
            >
              {uploadingLogo ? (
                <>
                  <svg
                    className="h-4 w-4 animate-spin"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    />
                  </svg>
                  Uploading...
                </>
              ) : (
                <>
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={1.5}
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
                    />
                  </svg>
                  Upload Logo
                </>
              )}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/svg+xml,image/webp"
              className="hidden"
              aria-label="Upload logo file"
              onChange={handleLogoUpload}
            />
          </div>
        </div>
      </div>

      {/* Color Configuration */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
          Brand Colors
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Set the primary, secondary, and accent colors for the broker
          submission portal.
        </p>
        <div className="mt-4 grid gap-6 sm:grid-cols-3">
          <ColorPicker
            label="Primary Color"
            description="Headers, buttons, and key UI elements"
            value={config.primaryColor}
            onChange={(v) => setConfig((prev) => ({ ...prev, primaryColor: v }))}
          />
          <ColorPicker
            label="Secondary Color"
            description="Secondary buttons and accents"
            value={config.secondaryColor}
            onChange={(v) =>
              setConfig((prev) => ({ ...prev, secondaryColor: v }))
            }
          />
          <ColorPicker
            label="Accent Color"
            description="Highlights and call-to-action elements"
            value={config.accentColor}
            onChange={(v) => setConfig((prev) => ({ ...prev, accentColor: v }))}
          />
        </div>

        {/* Live Preview */}
        <div className="mt-6">
          <h3 className="text-sm font-medium text-slate-700 dark:text-slate-300">
            Portal Header Preview
          </h3>
          <div className="mt-2 overflow-hidden rounded-lg border border-slate-200 dark:border-slate-600">
            <div
              className="flex h-14 items-center justify-between px-6"
              style={{ backgroundColor: config.primaryColor }}
            >
              <div className="flex items-center gap-3">
                {config.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={config.logoUrl}
                    alt="Logo preview"
                    className="max-h-8 object-contain"
                  />
                ) : (
                  <div className="text-lg font-bold text-white">
                    Your Organization
                  </div>
                )}
              </div>
              <div className="flex items-center gap-4 text-sm text-white/80">
                <span>New Submission</span>
                <span>My Submissions</span>
                <span>Profile</span>
              </div>
            </div>
            <div className="bg-slate-50 p-4 dark:bg-slate-700">
              <div className="flex items-center gap-3">
                <button
                  className="rounded-lg px-4 py-2 text-sm font-medium text-white"
                  style={{ backgroundColor: config.primaryColor }}
                >
                  Primary Button
                </button>
                <button
                  className="rounded-lg px-4 py-2 text-sm font-medium text-white"
                  style={{ backgroundColor: config.secondaryColor }}
                >
                  Secondary Button
                </button>
                <button
                  className="rounded-lg px-4 py-2 text-sm font-medium text-white"
                  style={{ backgroundColor: config.accentColor }}
                >
                  Accent Button
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Custom Domain */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
          Custom Domain
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Use your own domain for the submission portal.
        </p>
        <div className="mt-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              Portal Domain
            </label>
            <input
              type="text"
              placeholder="submissions.your-company.com"
              value={config.customDomain ?? ""}
              onChange={(e) =>
                setConfig((prev) => ({ ...prev, customDomain: e.target.value }))
              }
              className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 dark:border-slate-600 dark:bg-slate-700 dark:text-white dark:focus:border-primary-400"
            />
            <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
              Point a CNAME record from your domain to{" "}
              <code className="rounded bg-slate-100 px-1 py-0.5 dark:bg-slate-700">
                portal.quantanashield.com
              </code>
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              Email Sender Domain
            </label>
            <input
              type="text"
              placeholder="mail.your-company.com"
              value={config.customEmailDomain ?? ""}
              onChange={(e) =>
                setConfig((prev) => ({
                  ...prev,
                  customEmailDomain: e.target.value,
                }))
              }
              className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 dark:border-slate-600 dark:bg-slate-700 dark:text-white dark:focus:border-primary-400"
            />
            <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
              Configure SPF and DKIM records for your custom email domain. Add
              the following DNS records:
            </p>
            <div className="mt-2 space-y-1.5 rounded-lg bg-slate-50 p-3 text-xs font-mono dark:bg-slate-700/50">
              <p className="text-slate-600 dark:text-slate-400">
                <span className="font-semibold">SPF:</span> v=spf1
                include:quantanashield.com ~all
              </p>
              <p className="text-slate-600 dark:text-slate-400">
                <span className="font-semibold">DKIM:</span>{" "}
                qs._domainkey.your-domain.com → CNAME →
                qs._domainkey.quantanashield.com
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Legal & Contact */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
          Legal & Contact Information
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Links and contact details shown in the portal footer and emails.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              Terms of Use URL
            </label>
            <input
              type="url"
              placeholder="https://your-company.com/terms"
              value={config.termsUrl ?? ""}
              onChange={(e) =>
                setConfig((prev) => ({ ...prev, termsUrl: e.target.value }))
              }
              className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 dark:border-slate-600 dark:bg-slate-700 dark:text-white dark:focus:border-primary-400"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              Privacy Policy URL
            </label>
            <input
              type="url"
              placeholder="https://your-company.com/privacy"
              value={config.privacyUrl ?? ""}
              onChange={(e) =>
                setConfig((prev) => ({ ...prev, privacyUrl: e.target.value }))
              }
              className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 dark:border-slate-600 dark:bg-slate-700 dark:text-white dark:focus:border-primary-400"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              Footer Text
            </label>
            <input
              type="text"
              placeholder="© 2026 Your Company. All rights reserved."
              value={config.footerText ?? ""}
              onChange={(e) =>
                setConfig((prev) => ({ ...prev, footerText: e.target.value }))
              }
              className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 dark:border-slate-600 dark:bg-slate-700 dark:text-white dark:focus:border-primary-400"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              Support Email
            </label>
            <input
              type="email"
              placeholder="support@your-company.com"
              value={config.supportEmail ?? ""}
              onChange={(e) =>
                setConfig((prev) => ({
                  ...prev,
                  supportEmail: e.target.value,
                }))
              }
              className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 dark:border-slate-600 dark:bg-slate-700 dark:text-white dark:focus:border-primary-400"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              Support Phone
            </label>
            <input
              type="tel"
              placeholder="+1 (555) 123-4567"
              value={config.supportPhone ?? ""}
              onChange={(e) =>
                setConfig((prev) => ({
                  ...prev,
                  supportPhone: e.target.value,
                }))
              }
              className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 dark:border-slate-600 dark:bg-slate-700 dark:text-white dark:focus:border-primary-400"
            />
          </div>
        </div>
      </div>

      {/* Save Button */}
      <div className="sticky bottom-0 z-10 flex items-center justify-between rounded-xl border border-slate-200 bg-white/95 p-4 shadow-sm backdrop-blur-sm dark:border-slate-700 dark:bg-slate-800/95">
        <div className="text-sm text-slate-500 dark:text-slate-400">
          {hasChanges ? (
            <span className="text-amber-600 dark:text-amber-400">
              You have unsaved changes
            </span>
          ) : (
            "All changes saved"
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              setConfig(originalConfig);
            }}
            disabled={!hasChanges || saving}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
          >
            Discard
          </button>
          <button
            onClick={handleSave}
            disabled={!hasChanges || saving}
            className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-primary-500 dark:hover:bg-primary-600"
          >
            {saving ? (
              <>
                <svg
                  className="h-4 w-4 animate-spin"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
                Saving...
              </>
            ) : (
              "Save Changes"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Color Picker Component ─────────────────────────────

function ColorPicker({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
        {label}
      </label>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        {description}
      </p>
      <div className="mt-2 flex items-center gap-3">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`${label} color picker`}
          className="h-10 w-10 cursor-pointer rounded-lg border border-slate-300 p-0.5 dark:border-slate-600"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => {
            const v = e.target.value;
            if (/^#[0-9a-fA-F]{0,6}$/.test(v)) onChange(v);
          }}
          aria-label={`${label} hex value`}
          className="block w-28 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-mono shadow-sm focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 dark:border-slate-600 dark:bg-slate-700 dark:text-white dark:focus:border-primary-400"
          maxLength={7}
        />
        <div
          className="h-8 w-8 rounded-full border border-slate-200 shadow-sm dark:border-slate-600"
          style={{ backgroundColor: value }}
        />
      </div>
    </div>
  );
}
