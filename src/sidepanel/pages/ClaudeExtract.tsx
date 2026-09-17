// ─── Claude Extraction Page ─────────────────────────────────
// Extracts Projects from the user's Claude account via the
// internal API (CLAUDE_EXTRACT_PROJECTS message to content script).

import { useState, useCallback, useEffect } from "react";
import { useMigrationStore } from "../store/migration-store";
import { generateClaudeManifest } from "@/core/transform/claude-manifest";
import { saveManifest } from "@/core/storage/indexed-db";
import { safeSendTabMessage } from "@/shared/messaging";
import type { TrackedStep } from "../components/ProgressTracker";
import ProgressTracker from "../components/ProgressTracker";

// ─── Tab Detection ──────────────────────────────────────────

type TabStatus = "checking" | "ready" | "not_found" | "not_responding";

async function findClaudeTab(): Promise<number> {
  const tabs = await chrome.tabs.query({
    url: "https://claude.ai/*",
  });
  const tabId = tabs[0]?.id;
  if (tabId === undefined) {
    throw new Error(
      "No Claude tab found. Please open claude.ai and sign in.",
    );
  }
  return tabId;
}

// ─── Component ──────────────────────────────────────────────

type Phase = "idle" | "running" | "complete" | "error";

export default function ClaudeExtract(): React.JSX.Element {
  const nextStep = useMigrationStore((s) => s.nextStep);
  const setManifestId = useMigrationStore((s) => s.setManifestId);

  const [phase, setPhase] = useState<Phase>("idle");
  const [steps, setSteps] = useState<TrackedStep[]>([
    { id: "projects", label: "Fetching your Projects...", status: "pending" },
    { id: "manifest", label: "Putting it all together...", status: "pending" },
  ]);
  const [error, setError] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);

  // Tab status
  const [tabStatus, setTabStatus] = useState<TabStatus>("checking");
  const [tabLocation, setTabLocation] = useState("");

  const markStep = useCallback(
    (index: number, status: TrackedStep["status"], detail?: string) => {
      setSteps((prev) =>
        prev.map((s, i) =>
          i === index
            ? { ...s, status, ...(detail !== undefined ? { detail } : {}) }
            : s,
        ),
      );
    },
    [],
  );

  // ─── Tab Check ──────────────────────────────────────────

  const checkForClaude = useCallback(async () => {
    setTabStatus("checking");
    try {
      const tabs = await chrome.tabs.query({
        url: "https://claude.ai/*",
      });
      if (tabs.length === 0) {
        setTabStatus("not_found");
        return;
      }

      const currentWindow = await chrome.windows.getCurrent();
      const sorted = [...tabs].sort((a, b) => {
        const aScore =
          (a.windowId === currentWindow.id ? 2 : 0) + (a.active ? 1 : 0);
        const bScore =
          (b.windowId === currentWindow.id ? 2 : 0) + (b.active ? 1 : 0);
        return bScore - aScore;
      });

      const bestTab = sorted[0];
      if (!bestTab?.id) {
        setTabStatus("not_found");
        return;
      }

      try {
        const response = await safeSendTabMessage(bestTab.id, "PING");
        if (response?.pong) {
          setTabStatus("ready");
          if (bestTab.windowId !== currentWindow.id) {
            setTabLocation("in another window");
          } else if (!bestTab.active) {
            setTabLocation("in another tab");
          } else {
            setTabLocation("");
          }
        } else {
          setTabStatus("not_responding");
        }
      } catch {
        setTabStatus("not_responding");
      }
    } catch {
      setTabStatus("not_found");
    }
  }, []);

  useEffect(() => {
    void checkForClaude();
  }, [checkForClaude]);

  // ─── Extraction ─────────────────────────────────────────

  const runExtraction = useCallback(async () => {
    setPhase("running");
    setStartedAt(Date.now());
    setError(null);
    setSteps([
      { id: "projects", label: "Fetching your Projects...", status: "pending" },
      { id: "manifest", label: "Putting it all together...", status: "pending" },
    ]);

    try {
      const tabId = await findClaudeTab();

      // Step 1: Extract projects
      markStep(0, "active");
      const result = await safeSendTabMessage(
        tabId,
        "CLAUDE_EXTRACT_PROJECTS",
      );

      if (!result.success && result.projects.length === 0) {
        const warning = result.warnings[0]?.message ?? "Extraction failed";
        throw new Error(warning);
      }

      const projectCount = result.projects.length;
      markStep(
        0,
        "complete",
        `Found ${projectCount} Project${projectCount === 1 ? "" : "s"}`,
      );

      // Step 2: Generate manifest
      markStep(1, "active");
      const manifest = generateClaudeManifest(result.projects);

      const manifestId = `manifest-${Date.now()}`;
      await saveManifest(manifestId, manifest);
      setManifestId(manifestId);

      markStep(1, "complete");
      setPhase("complete");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setPhase("error");
    }
  }, [markStep, setManifestId]);

  // ─── Auto-advance ───────────────────────────────────────

  useEffect(() => {
    if (phase === "complete") {
      const timer = setTimeout(() => nextStep(), 1500);
      return () => clearTimeout(timer);
    }
  }, [phase, nextStep]);

  // ─── Render: Idle ───────────────────────────────────────

  if (phase === "idle") {
    return (
      <div className="flex flex-1 flex-col">
        <h2 className="text-lg font-semibold text-gray-900">
          Reading from your Claude account
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          We'll fetch your Projects from Claude via its internal API.
        </p>

        <div className="mt-4">
          {tabStatus === "checking" && (
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <svg
                className="h-4 w-4 animate-spin text-slate-400"
                viewBox="0 0 24 24"
                fill="none"
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
              <span className="text-sm text-slate-500">
                Looking for Claude...
              </span>
            </div>
          )}

          {tabStatus === "ready" && (
            <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
              <svg
                className="h-4 w-4 shrink-0"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z"
                  clipRule="evenodd"
                />
              </svg>
              <span>
                {tabLocation
                  ? `Found Claude ${tabLocation} — ready to go`
                  : "Claude is open and ready"}
              </span>
            </div>
          )}

          {tabStatus === "not_found" && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm font-medium text-amber-800 mb-3">
                Claude isn't open yet
              </p>
              <div className="space-y-2">
                <button
                  onClick={async () => {
                    await chrome.tabs.create({
                      url: "https://claude.ai",
                      active: true,
                    });
                    setTimeout(() => void checkForClaude(), 3000);
                  }}
                  className="w-full rounded-md bg-amber-100 px-3 py-2 text-sm font-medium text-amber-800 transition-colors hover:bg-amber-200"
                >
                  Open Claude for me
                </button>
                <button
                  onClick={() => void checkForClaude()}
                  className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 transition-colors hover:bg-slate-50"
                >
                  I already opened it — check again
                </button>
              </div>
              <p className="mt-2 text-xs text-amber-600">
                Make sure you're logged in after it opens.
              </p>
            </div>
          )}

          {tabStatus === "not_responding" && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm font-medium text-amber-800 mb-2">
                Found Claude, but can't connect to it
              </p>
              <p className="mb-3 text-xs text-amber-600">
                Try refreshing your Claude tab, then click the button below.
              </p>
              <button
                onClick={() => void checkForClaude()}
                className="w-full rounded-md bg-amber-100 px-3 py-2 text-sm font-medium text-amber-800 transition-colors hover:bg-amber-200"
              >
                Check again
              </button>
            </div>
          )}
        </div>

        <button
          onClick={() => void runExtraction()}
          disabled={tabStatus !== "ready"}
          className={`mt-6 w-full rounded-lg px-4 py-2.5 text-sm font-medium transition-colors ${
            tabStatus === "ready"
              ? "bg-blue-600 text-white hover:bg-blue-700"
              : "cursor-not-allowed bg-slate-100 text-slate-400"
          }`}
        >
          {tabStatus === "ready" ? "Start Reading" : "Waiting for Claude..."}
        </button>
      </div>
    );
  }

  // ─── Render: Error ──────────────────────────────────────

  if (phase === "error") {
    let friendlyError = error;
    if (error?.includes("No Claude tab found")) {
      friendlyError =
        "We couldn't find Claude open in any of your tabs. Please open claude.ai, sign in, then try again.";
    } else if (error?.includes("no organization ID")) {
      friendlyError =
        "Couldn't authenticate with Claude. Please make sure you're logged in to claude.ai, then try again.";
    } else if (error?.includes("Session expired")) {
      friendlyError =
        "Your Claude session has expired. Please log in again at claude.ai, then try again.";
    }

    return (
      <div className="flex flex-1 flex-col">
        <h2 className="text-lg font-semibold text-gray-900">
          Something went wrong
        </h2>
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-700">{friendlyError}</p>
        </div>
        <div className="mt-4">
          <ProgressTracker steps={steps} startedAt={startedAt} />
        </div>
        <button
          onClick={() => {
            setPhase("idle");
            setSteps([
              { id: "projects", label: "Fetching your Projects...", status: "pending" },
              {
                id: "manifest",
                label: "Putting it all together...",
                status: "pending",
              },
            ]);
            setError(null);
            setStartedAt(null);
          }}
          className="mt-4 w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Try Again
        </button>
      </div>
    );
  }

  // ─── Render: Complete ───────────────────────────────────

  if (phase === "complete") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
          <svg
            className="h-6 w-6 text-green-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 13l4 4L19 7"
            />
          </svg>
        </div>
        <h2 className="mt-4 text-lg font-semibold text-gray-900">All done!</h2>
        <p className="mt-1 text-sm text-gray-500">
          Moving on to review your data...
        </p>
      </div>
    );
  }

  // ─── Render: Running ────────────────────────────────────

  return (
    <div className="flex flex-1 flex-col">
      <h2 className="text-lg font-semibold text-gray-900">
        Reading your Claude Projects
      </h2>
      <p className="mt-1 text-sm text-gray-500">
        Please keep this panel open — this will only take a moment.
      </p>
      <div className="mt-4">
        <ProgressTracker steps={steps} startedAt={startedAt} />
      </div>
    </div>
  );
}
