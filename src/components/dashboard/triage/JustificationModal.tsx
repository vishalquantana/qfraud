"use client";

import { useState } from "react";

interface JustificationModalProps {
  open: boolean;
  onConfirm: (justification: string) => void;
  onCancel: () => void;
}

export default function JustificationModal({
  open,
  onConfirm,
  onCancel,
}: JustificationModalProps) {
  const [justification, setJustification] = useState("");

  if (!open) return null;

  function handleConfirm() {
    onConfirm(justification);
    setJustification("");
  }

  function handleCancel() {
    onCancel();
    setJustification("");
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="decline-modal-title"
    >
      <div className="mx-4 w-full max-w-md rounded-xl bg-white p-6 shadow-xl dark:bg-slate-800">
        <h3
          id="decline-modal-title"
          className="text-lg font-semibold text-slate-900 dark:text-white"
        >
          Decline Submission
        </h3>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Please provide a justification for declining this submission.
        </p>
        <textarea
          value={justification}
          onChange={(e) => setJustification(e.target.value)}
          rows={3}
          placeholder="Enter justification..."
          className="mt-4 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-slate-600 dark:bg-slate-700 dark:text-white"
          aria-label="Decline justification"
          autoFocus
        />
        <div className="mt-4 flex justify-end gap-3">
          <button
            onClick={handleCancel}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!justification.trim()}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-50"
          >
            Decline
          </button>
        </div>
      </div>
    </div>
  );
}
