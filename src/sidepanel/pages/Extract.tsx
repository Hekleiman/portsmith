import { useState, useRef, useCallback, useEffect } from "react";
import { useMigrationStore } from "../store/migration-store";
import { parseChatGPTExport } from "@/core/adapters/chatgpt-adapter";
import {
  generateManifest,
  type ChatGPTDOMData,
} from "@/core/transform/workspace-mapper";
import { saveManifest } from "@/core/storage/indexed-db";
import { sendTabMessage, onMessage } from "@/shared/messaging";
import type { RawChatGPTData } from "@/core/adapters/types";
import type { ExtractionMethod } from "@/core/storage/migration-state";
import type { TrackedStep } from "../components/ProgressTracker";
import FileUpload from "../components/FileUpload";
import ProgressTracker from "../components/ProgressTracker";

// ─── Step Definitions ────────────────────────────────────────

function buildSteps(method: ExtractionMethod): TrackedStep[] {
  const steps: TrackedStep[] = [];

  if (method === "upload" || method === "both") {
    steps.push({
      id: "parse",
      label: "Parsing export file...",
      status: "pending",
    });
  }

  if (method === "browser" || method === "both") {
    steps.push(
      {
        id: "custom_gpts",
        label: "Reading Custom GPTs...",
        status: "pending",
      },
      { id: "memory", label: "Reading memory...", status: "pending" },
      {
        id: "instructions",
        label: "Reading custom instructions...",
        status: "pending",
      },
    );
  }

  steps.push({
    id: "manifest",
    label: "Generating manifest...",
    status: "pending",
  });

  return steps;
}

// ─── DOM Helpers ─────────────────────────────────────────────

const DOM_TIMEOUT_MS = 30_000;

async function findChatGPTTab(): Promise<number> {
  const tabs = await chrome.tabs.query({
    url: ["https://chatgpt.com/*", "https://chat.openai.com/*"],
  });
  const tabId = tabs[0]?.id;
  if (tabId === undefined) {
    throw new Error(
      "No ChatGPT tab found. Please open chatgpt.com in another tab and make sure you're logged in.",
    );
  }
  return tabId;
}

// ─── Component ───────────────────────────────────────────────

type Phase = "idle" | "running" | "complete" | "error";

export default function Extract(): React.JSX.Element {
  const extractionMethod = useMigrationStore((s) => s.extractionMethod);
  const nextStep = useMigrationStore((s) => s.nextStep);
  const setManifestId = useMigrationStore((s) => s.setManifestId);

  const method: ExtractionMethod = extractionMethod ?? "upload";

  const [phase, setPhase] = useState<Phase>("idle");
  const [steps, setSteps] = useState<TrackedStep[]>(() => buildSteps(method));
  const [error, setError] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);

  // Accumulated data (refs to avoid re-renders)
  const rawDataRef = useRef<RawChatGPTData | null>(null);
  const domDataRef = useRef<ChatGPTDOMData>({});
  const runningRef = useRef(false);

  // ─── Step status helpers ─────────────────────────────────

  const markStep = useCallback(
    (index: number, status: TrackedStep["status"]) => {
      setSteps((prev) =>
        prev.map((s, i) => (i === index ? { ...s, status } : s)),
      );
    },
    [],
  );

  // ─── Core extraction logic ──────────────────────────────

  const runExtraction = useCallback(
    async (file?: File) => {
      if (runningRef.current) return;
      runningRef.current = true;

      const freshSteps = buildSteps(method);
      setSteps(freshSteps);
      setPhase("running");
      setStartedAt(Date.now());
      setError(null);

      // Reset accumulated data
      rawDataRef.current = null;
      domDataRef.current = {};

      let stepIdx = 0;

      try {
        // ── File upload step ─────────────────────────────
        if (method === "upload" || method === "both") {
          if (!file) throw new Error("No file selected");

          markStep(stepIdx, "active");
          const rawData = await parseChatGPTExport(file);
          rawDataRef.current = rawData;
          markStep(stepIdx, "complete");
          stepIdx++;
        }

        // ── DOM extraction steps ─────────────────────────
        if (method === "browser" || method === "both") {
          const tabId = await findChatGPTTab();

          // Custom GPTs
          markStep(stepIdx, "active");
          try {
            // Set up a one-shot listener to collect results
            const gptPromise = new Promise<void>((resolve) => {
              const unsub = onMessage("DOM_EXTRACT_RESULT", (payload) => {
                if (payload.type === "custom_gpts") {
                  domDataRef.current.customGPTs = payload.data.gpts;
                  unsub();
                  resolve();
                }
              });
              // Fallback timeout so we don't hang forever
              setTimeout(() => {
                unsub();
                resolve();
              }, DOM_TIMEOUT_MS);
            });
            await sendTabMessage(tabId, "DOM_EXTRACT", {
              target: "custom_gpts",
            });
            await gptPromise;
          } catch {
            // Non-fatal: continue with remaining extractions
          }
          markStep(stepIdx, "complete");
          stepIdx++;

          // Memory
          markStep(stepIdx, "active");
          try {
            const memPromise = new Promise<void>((resolve) => {
              const unsub = onMessage("DOM_EXTRACT_RESULT", (payload) => {
                if (payload.type === "memory") {
                  domDataRef.current.memory = payload.data.items;
                  unsub();
                  resolve();
                }
              });
              setTimeout(() => {
                unsub();
                resolve();
              }, DOM_TIMEOUT_MS);
            });
            await sendTabMessage(tabId, "DOM_EXTRACT", { target: "memory" });
            await memPromise;
          } catch {
            // Non-fatal
          }
          markStep(stepIdx, "complete");
          stepIdx++;

          // Custom Instructions
          markStep(stepIdx, "active");
          try {
            const instrPromise = new Promise<void>((resolve) => {
              const unsub = onMessage("DOM_EXTRACT_RESULT", (payload) => {
                if (payload.type === "custom_instructions") {
                  domDataRef.current.customInstructions =
                    payload.data.instructions;
                  unsub();
                  resolve();
                }
              });
              setTimeout(() => {
                unsub();
                resolve();
              }, DOM_TIMEOUT_MS);
            });
            await sendTabMessage(tabId, "DOM_EXTRACT", {
              target: "custom_instructions",
            });
            await instrPromise;
          } catch {
            // Non-fatal
          }
          markStep(stepIdx, "complete");
          stepIdx++;
        }

        // ── Generate manifest ────────────────────────────
        markStep(stepIdx, "active");

        const rawData: RawChatGPTData = rawDataRef.current ?? {
          conversations: [],
          customGPTIds: [],
          stats: { totalConversations: 0, dateRange: null, topGPTs: [] },
          warnings: [],
        };

        const hasDOMData =
          domDataRef.current.customGPTs ||
          domDataRef.current.memory ||
          domDataRef.current.customInstructions;

        const manifest = generateManifest(
          rawData,
          hasDOMData ? domDataRef.current : undefined,
        );

        // Save to IndexedDB
        const manifestId = `manifest-${Date.now()}`;
        await saveManifest(manifestId, manifest);
        setManifestId(manifestId);

        markStep(stepIdx, "complete");
        setPhase("complete");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        setPhase("error");
        // Mark active step as error
        markStep(stepIdx, "error");
      } finally {
        runningRef.current = false;
      }
    },
    [method, markStep, setManifestId],
  );

  // ─── Auto-advance on completion ─────────────────────────

  useEffect(() => {
    if (phase === "complete") {
      const timer = setTimeout(() => {
        nextStep();
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [phase, nextStep]);

  // ─── Handlers ───────────────────────────────────────────

  const handleFileSelect = useCallback(
    (file: File) => {
      void runExtraction(file);
    },
    [runExtraction],
  );

  const handleStartBrowser = useCallback(() => {
    void runExtraction();
  }, [runExtraction]);

  const handleRetry = useCallback(() => {
    rawDataRef.current = null;
    domDataRef.current = {};
    runningRef.current = false;
    setPhase("idle");
    setSteps(buildSteps(method));
    setError(null);
    setStartedAt(null);
  }, [method]);

  // ─── Render ─────────────────────────────────────────────

  if (phase === "idle") {
    if (method === "browser") {
      return (
        <div className="flex flex-1 flex-col">
          <h2 className="text-lg font-semibold text-gray-900">
            Extract from Browser
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            We'll read your Custom GPTs, memory, and custom instructions
            directly from chatgpt.com.
          </p>

          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <h3 className="text-sm font-medium text-amber-800">
              Before starting:
            </h3>
            <ul className="mt-2 space-y-1 text-sm text-amber-700">
              <li>1. Open chatgpt.com in another tab</li>
              <li>2. Make sure you're logged in</li>
              <li>3. Navigate to your GPTs page</li>
            </ul>
          </div>

          <button
            onClick={handleStartBrowser}
            className="mt-6 w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            Start Extraction
          </button>
        </div>
      );
    }

    // "upload" or "both"
    return (
      <div className="flex flex-1 flex-col">
        <h2 className="text-lg font-semibold text-gray-900">
          {method === "both" ? "Upload & Extract" : "Upload Export File"}
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          {method === "both"
            ? "Start by uploading your ChatGPT export ZIP. We'll then extract additional data from the browser."
            : "Upload your ChatGPT data export ZIP file to begin extraction."}
        </p>
        <div className="mt-4">
          <FileUpload onFileSelect={handleFileSelect} />
        </div>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="flex flex-1 flex-col">
        <h2 className="text-lg font-semibold text-gray-900">
          Extraction Failed
        </h2>
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-700">{error}</p>
        </div>
        <div className="mt-4">
          <ProgressTracker steps={steps} startedAt={startedAt} />
        </div>
        <button
          onClick={handleRetry}
          className="mt-4 w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Retry
        </button>
      </div>
    );
  }

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
        <h2 className="mt-4 text-lg font-semibold text-gray-900">
          Extraction Complete
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          Proceeding to review...
        </p>
      </div>
    );
  }

  // Running
  return (
    <div className="flex flex-1 flex-col">
      <h2 className="text-lg font-semibold text-gray-900">Extracting Data</h2>
      <p className="mt-1 text-sm text-gray-500">
        Please keep this panel open while extraction is in progress.
      </p>
      <div className="mt-4">
        <ProgressTracker steps={steps} startedAt={startedAt} />
      </div>
    </div>
  );
}
