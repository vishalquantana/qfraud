"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";

// ─── Types ──────────────────────────────────────────────

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  createdAt: string;
}

interface UserSummary {
  total: number;
  active: number;
  activeUnderwriters: number;
}

// ─── Constants ──────────────────────────────────────────

const ROLE_OPTIONS = [
  { value: "ADMIN", label: "Admin" },
  { value: "UNDERWRITER", label: "Underwriter" },
  { value: "SENIOR_UNDERWRITER", label: "Senior Underwriter" },
  { value: "SIU_INVESTIGATOR", label: "SIU Investigator" },
  { value: "COMPLIANCE_OFFICER", label: "Compliance Officer" },
  { value: "BROKER", label: "Broker" },
];

const ROLE_LABELS: Record<string, string> = {
  ADMIN: "Admin",
  UNDERWRITER: "Underwriter",
  SENIOR_UNDERWRITER: "Senior UW",
  SIU_INVESTIGATOR: "SIU",
  COMPLIANCE_OFFICER: "Compliance",
  BROKER: "Broker",
};

const ROLE_COLORS: Record<string, string> = {
  ADMIN:
    "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-400",
  UNDERWRITER:
    "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-400",
  SENIOR_UNDERWRITER:
    "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-400",
  SIU_INVESTIGATOR:
    "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-400",
  COMPLIANCE_OFFICER:
    "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-400",
  BROKER:
    "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-400",
};

// ─── Component ──────────────────────────────────────────

export default function UserManagementPage() {
  const { data: session } = useSession();
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<User[]>([]);
  const [summary, setSummary] = useState<UserSummary>({
    total: 0,
    active: 0,
    activeUnderwriters: 0,
  });
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Invite modal state
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState("UNDERWRITER");
  const [inviting, setInviting] = useState(false);

  // Edit modal state
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [editRole, setEditRole] = useState("");
  const [editActive, setEditActive] = useState(true);
  const [saving, setSaving] = useState(false);

  // ─── Fetch users ────────────────────────────────────────

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch("/api/config/users");
      if (!res.ok) throw new Error("Failed to load users");
      const json = await res.json();
      setUsers(json.data.users);
      setSummary(json.data.summary);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  // ─── Invite user ──────────────────────────────────────

  const handleInvite = async () => {
    if (!inviteEmail || !inviteName) return;
    setInviting(true);
    setError(null);
    try {
      const res = await fetch("/api/config/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: inviteEmail,
          name: inviteName,
          role: inviteRole,
        }),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || "Failed to invite user");
      }
      setShowInvite(false);
      setInviteEmail("");
      setInviteName("");
      setInviteRole("UNDERWRITER");
      setSuccess("User invited successfully");
      setTimeout(() => setSuccess(null), 3000);
      await fetchUsers();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to invite");
    } finally {
      setInviting(false);
    }
  };

  // ─── Edit user ────────────────────────────────────────

  const openEdit = (user: User) => {
    setEditingUser(user);
    setEditRole(user.role);
    setEditActive(user.isActive);
  };

  const handleEdit = async () => {
    if (!editingUser) return;
    setSaving(true);
    setError(null);

    const changes: Record<string, unknown> = {};
    if (editRole !== editingUser.role) changes.role = editRole;
    if (editActive !== editingUser.isActive) changes.isActive = editActive;

    if (Object.keys(changes).length === 0) {
      setEditingUser(null);
      setSaving(false);
      return;
    }

    try {
      const res = await fetch(`/api/config/users/${editingUser.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(changes),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || "Failed to update user");
      }
      setEditingUser(null);
      setSuccess("User updated successfully");
      setTimeout(() => setSuccess(null), 3000);
      await fetchUsers();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update");
    } finally {
      setSaving(false);
    }
  };

  // ─── Render ──────────────────────────────────────────

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl p-4 sm:p-6">
        <div className="flex items-center gap-3" aria-busy="true">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary-600 border-t-transparent" />
          <span className="text-slate-500 dark:text-slate-400">
            Loading users...
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      {/* ─── Header ──────────────────────────────────────── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            User Management
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {summary.total} users, {summary.active} active
            {summary.activeUnderwriters > 0 &&
              `, ${summary.activeUnderwriters} active underwriters`}
          </p>
        </div>
        <button
          onClick={() => setShowInvite(true)}
          className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700"
        >
          + Invite User
        </button>
      </div>

      {/* ─── Alerts ──────────────────────────────────────── */}
      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-400">
          {error}
          <button
            onClick={() => setError(null)}
            className="ml-2 font-medium underline"
          >
            Dismiss
          </button>
        </div>
      )}
      {success && (
        <div role="status" className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700 dark:border-green-800 dark:bg-green-900/30 dark:text-green-400">
          {success}
        </div>
      )}

      {/* ─── Users Table ────────────────────────────────── */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm" aria-label="Users">
            <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/50">
              <tr>
                <th scope="col" className="px-4 py-3 text-left font-medium text-slate-600 dark:text-slate-400">
                  Name
                </th>
                <th className="px-4 py-3 text-left font-medium text-slate-600 dark:text-slate-400">
                  Email
                </th>
                <th className="px-4 py-3 text-left font-medium text-slate-600 dark:text-slate-400">
                  Role
                </th>
                <th className="px-4 py-3 text-left font-medium text-slate-600 dark:text-slate-400">
                  Status
                </th>
                <th className="px-4 py-3 text-left font-medium text-slate-600 dark:text-slate-400">
                  Created
                </th>
                <th className="px-4 py-3 text-right font-medium text-slate-600 dark:text-slate-400">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
              {users.map((user) => (
                <tr
                  key={user.id}
                  className="bg-white hover:bg-slate-50 dark:bg-slate-800 dark:hover:bg-slate-750"
                >
                  <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">
                    {user.name}
                    {session?.user?.email === user.email && (
                      <span className="ml-1.5 text-xs text-slate-400">
                        (you)
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                    {user.email}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${ROLE_COLORS[user.role] ?? "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400"}`}
                    >
                      {ROLE_LABELS[user.role] ?? user.role}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {user.isActive ? (
                      <span className="inline-flex items-center gap-1 text-green-600 dark:text-green-400">
                        <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                        Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-slate-400 dark:text-slate-500">
                        <span className="h-1.5 w-1.5 rounded-full bg-slate-300 dark:bg-slate-600" />
                        Inactive
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-500 dark:text-slate-400">
                    {new Date(user.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => openEdit(user)}
                      className="text-sm font-medium text-primary-600 hover:text-primary-800 dark:text-primary-400 dark:hover:text-primary-300"
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {users.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-slate-400 dark:text-slate-500">
            No users found. Invite someone to get started.
          </div>
        )}
      </div>

      {/* ─── Invite User Modal ──────────────────────────── */}
      {showInvite && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div role="dialog" aria-modal="true" aria-label="Invite user" className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl dark:bg-slate-800">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
              Invite User
            </h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Send an invitation to add a new user to your organization.
            </p>

            <div className="mt-4 space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                  Email
                </label>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="user@company.com"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                  Name
                </label>
                <input
                  type="text"
                  value={inviteName}
                  onChange={(e) => setInviteName(e.target.value)}
                  placeholder="John Smith"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                  Role
                </label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                >
                  {ROLE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => {
                  setShowInvite(false);
                  setInviteEmail("");
                  setInviteName("");
                  setInviteRole("UNDERWRITER");
                  setError(null);
                }}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-400 dark:hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                onClick={handleInvite}
                disabled={inviting || !inviteEmail || !inviteName}
                className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
              >
                {inviting ? "Inviting..." : "Send Invitation"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Edit User Modal ────────────────────────────── */}
      {editingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div role="dialog" aria-modal="true" aria-label="Edit user" className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl dark:bg-slate-800">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
              Edit User
            </h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {editingUser.name} ({editingUser.email})
            </p>

            <div className="mt-4 space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
                  Role
                </label>
                <select
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-slate-600 dark:bg-slate-900 dark:text-white"
                >
                  {ROLE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-slate-200 p-4 dark:border-slate-600">
                <div>
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    Active
                  </label>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    {session?.user?.email === editingUser.email
                      ? "You cannot deactivate yourself."
                      : "Inactive users cannot log in."}
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={editActive}
                  disabled={session?.user?.email === editingUser.email}
                  onClick={() => setEditActive((prev) => !prev)}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50 ${
                    editActive
                      ? "bg-green-600"
                      : "bg-slate-300 dark:bg-slate-600"
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm ring-0 transition-transform duration-200 ${
                      editActive ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => {
                  setEditingUser(null);
                  setError(null);
                }}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-400 dark:hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                onClick={handleEdit}
                disabled={saving}
                className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
