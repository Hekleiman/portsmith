import { useState, useRef, useCallback, useEffect } from "react";
import { useMigrationStore } from "../store/migration-store";
import { parseChatGPTExport } from "@/core/adapters/chatgpt-adapter";
import {
  generateManifest,
  type ChatGPTDOMData,
} from "@/core/transform/workspace-mapper";
import { saveManifest } from "@/core/storage/indexed-db";
import {
  safeSendTabMessage,
  onMessage,
} from "@/shared/messaging";
import type { SidebarItem } from "@/shared/messaging";
import type { RawChatGPTData } from "@/core/adapters/types";
import type { ExtractionMethod } from "@/core/storage/migration-state";
import type { TrackedStep } from "../components/ProgressTracker";
import FileUpload from "../components/FileUpload";
import ProgressTracker from "../components/ProgressTracker";
import ClaudeExtract from "./ClaudeExtract";
import GeminiExtract from "./GeminiExtract";

// ─── Step Definitions ────────────────────────────────────────

function buildSteps(method: ExtractionMethod): TrackedStep[] {
  const steps: TrackedStep[] = [];

  if (method === "upload" || method === "both") {
    steps.push({
      id: "parse",
      label: "Processing your backup file...",
      status: "pending",
    });
  }

  if (method === "browser" || method === "both") {
    steps.push(
      {
        id: "scan_sidebar",
        label: "Looking through your ChatGPT sidebar...",
        status: "pending",
      },
      {
        id: "projects",
        label: "Finding your projects...",
        status: "pending",
      },
      {
        id: "custom_gpts",
        label: "Finding your custom GPTs...",
        status: "pending",
      },
      { id: "memory", label: "Finding saved memories...", status: "pending" },
      {
        id: "instructions",
        label: "Finding your custom instructions...",
        status: "pending",
      },
    );
  }

  steps.push({
    id: "manifest",
    label: "Putting it all together...",
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
  const sourcePlatform = useMigrationStore((s) => s.sourcePlatform);

  // Delegate to platform-specific extraction page
  if (sourcePlatform === "claude") {
    return <ClaudeExtract />;
  }
  if (sourcePlatform === "gemini") {
    return <GeminiExtract />;
  }

  return <ChatGPTExtract />;
}

function ChatGPTExtract(): React.JSX.Element {
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
    (index: number, status: TrackedStep["status"], detail?: string) => {
      setSteps((prev) =>
        prev.map((s, i) =>
          i === index ? { ...s, status, ...(detail !== undefined ? { detail } : {}) } : s,
        ),
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

          // 1. Scan sidebar for projects and GPTs
          markStep(stepIdx, "active");
          let projectTargets: SidebarItem[] = [];
          try {
            const scanResult = await safeSendTabMessage(tabId, "SCAN_SIDEBAR");
            projectTargets = scanResult.projects;

            // Store sidebar-discovered GPTs directly in domDataRef.
            // extractCustomGPTs() only works on gpt_editor/gpt_list pages,
            // not the chat page we return to after project extraction.
            // Sidebar scan is the reliable source for GPT discovery.
            if (scanResult.gpts.length > 0) {
              domDataRef.current.customGPTs = scanResult.gpts.map((item) => ({
                id: item.id,
                name: item.name,
                description: "",
                instructions: "",
                conversationStarters: [],
                knowledgeFileNames: [],
              }));
            }

            console.log(
              `[PortSmith] Sidebar scan: ${scanResult.projects.length} projects, ${scanResult.gpts.length} GPTs`,
            );

            const detail =
              `Found ${scanResult.projects.length} project${scanResult.projects.length === 1 ? "" : "s"}, ` +
              `${scanResult.gpts.length} GPT${scanResult.gpts.length === 1 ? "" : "s"}`;
            markStep(stepIdx, "complete", detail);
          } catch {
            markStep(stepIdx, "complete", "Sidebar scan failed — continuing");
          }
          stepIdx++;

          // 2. Extract projects via API (no page navigation needed)
          markStep(stepIdx, "active");
          if (projectTargets.length > 0) {
            try {
              const projPromise = new Promise<void>((resolve) => {
                const unsub = onMessage("DOM_EXTRACT_RESULT", (payload) => {
                  if (payload.type === "projects") {
                    if (payload.data.projects.length > 0) {
                      domDataRef.current.projects = payload.data.projects;
                      console.log(
                        "[PortSmith] Extracted",
                        payload.data.projects.length,
                        "projects via API",
                      );
                    }
                    unsub();
                    resolve();
                  }
                });
                setTimeout(() => {
                  unsub();
                  resolve();
                }, DOM_TIMEOUT_MS);
              });
              await safeSendTabMessage(tabId, "DOM_EXTRACT", {
                target: "projects",
              });
              await projPromise;
            } catch {
              // Non-fatal
            }

            // Fallback: if API extraction returned nothing, use sidebar names
            if (!domDataRef.current.projects || domDataRef.current.projects.length === 0) {
              domDataRef.current.projects = projectTargets.map((item) => ({
                id: item.id,
                name: item.name,
                description: "",
                instructions: "",
                knowledgeFileNames: [],
                conversationCount: 0,
              }));
              console.log(
                "[PortSmith] API extraction returned no projects; using sidebar fallback for",
                projectTargets.length,
                "projects",
              );
            }

            const projCount = domDataRef.current.projects.length;
            markStep(
              stepIdx,
              "complete",
              `Extracted ${projCount} project${projCount === 1 ? "" : "s"}`,
            );
          } else {
            markStep(stepIdx, "complete", "No projects found");
          }
          stepIdx++;

          // 3. Custom GPTs
          // Sidebar scan (step 1) already stored GPTs in domDataRef.
          // DOM_EXTRACT only overrides if it finds richer data (e.g. on
          // the gpt_editor page), which won't happen after navigating
          // back to chatgpt.com. This prevents the empty DOM result
          // from wiping out the sidebar-discovered GPTs.
          markStep(stepIdx, "active");
          try {
            const gptPromise = new Promise<void>((resolve) => {
              const unsub = onMessage("DOM_EXTRACT_RESULT", (payload) => {
                if (payload.type === "custom_gpts") {
                  if (payload.data.gpts.length > 0) {
                    domDataRef.current.customGPTs = payload.data.gpts;
                  }
                  unsub();
                  resolve();
                }
              });
              setTimeout(() => {
                unsub();
                resolve();
              }, DOM_TIMEOUT_MS);
            });
            await safeSendTabMessage(tabId, "DOM_EXTRACT", {
              target: "custom_gpts",
            });
            await gptPromise;
          } catch {
            // Non-fatal: sidebar GPTs (if any) already in domDataRef
          }
          const gptCount = domDataRef.current.customGPTs?.length ?? 0;
          markStep(
            stepIdx,
            "complete",
            gptCount > 0
              ? `${gptCount} GPT${gptCount === 1 ? "" : "s"} found`
              : "No Custom GPTs found",
          );
          stepIdx++;

          // 4. Memory
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
            await safeSendTabMessage(tabId, "DOM_EXTRACT", { target: "memory" });
            await memPromise;
          } catch {
            // Non-fatal
          }
          markStep(stepIdx, "complete");
          stepIdx++;

          // 5. Custom Instructions
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
            await safeSendTabMessage(tabId, "DOM_EXTRACT", {
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
          domDataRef.current.projects ||
          domDataRef.current.memory ||
          domDataRef.current.customInstructions;

        console.log("[PortSmith] DOM data summary:", {
          customGPTs: domDataRef.current.customGPTs?.length ?? 0,
          projects: domDataRef.current.projects?.length ?? 0,
          memory: domDataRef.current.memory?.length ?? 0,
          customInstructions: !!domDataRef.current.customInstructions,
          hasDOMData: !!hasDOMData,
        });

        const manifest = generateManifest(
          rawData,
          hasDOMData ? domDataRef.current : undefined,
        );

        console.log(
          "[PortSmith] Manifest generated:",
          manifest.workspaces.length,
          "workspaces,",
          manifest.memory.length,
          "memory items",
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

  // ─── ChatGPT tab detection ────────────────────────────────

  const [chatgptStatus, setChatgptStatus] = useState<
    "checking" | "ready" | "not_found" | "not_responding"
  >("checking");
  const [chatgptTabLocation, setChatgptTabLocation] = useState("");

  const checkForChatGPT = useCallback(async () => {
    setChatgptStatus("checking");
    try {
      const tabs = await chrome.tabs.query({
        url: ["https://chatgpt.com/*", "https://chat.openai.com/*"],
      });
      if (tabs.length === 0) {
        setChatgptStatus("not_found");
        return;
      }

      // Prefer the active ChatGPT tab in the current window
      const currentWindow = await chrome.windows.getCurrent();
      const sorted = [...tabs].sort((a, b) => {
        const aScore =
          (a.windowId === currentWindow.id ? 2 : 0) + (a.active ? 1 : 0);
        const bScore =
          (b.windowId === currentWindow.id ? 2 : 0) + (b.active ? 1 : 0);
        return bScore - aScore;
      });

      const bestTab = sorted[0];
      if (!bestTab || bestTab.id == null) {
        setChatgptStatus("not_found");
        return;
      }

      const tabId = bestTab.id;

      try {
        const response = await safeSendTabMessage(tabId, "PING");
        if (response?.pong) {
          setChatgptStatus("ready");

          if (bestTab.windowId !== currentWindow.id) {
            setChatgptTabLocation("in another window");
          } else if (!bestTab.active) {
            setChatgptTabLocation("in another tab");
          } else {
            setChatgptTabLocation("");
          }
        } else {
          setChatgptStatus("not_responding");
        }
      } catch {
        setChatgptStatus("not_responding");
      }
    } catch {
      setChatgptStatus("not_found");
    }
  }, []);

  const needsBrowserCheck = method === "browser" || method === "both";

  useEffect(() => {
    if (needsBrowserCheck) {
      void checkForChatGPT();
    }
  }, [needsBrowserCheck, checkForChatGPT]);

  // ─── Render ─────────────────────────────────────────────

  if (phase === "idle") {
    if (method === "browser") {
      return (
        <div className="flex flex-1 flex-col">
          <h2 className="text-lg font-semibold text-gray-900">
            Reading from your ChatGPT account
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            We'll look through your ChatGPT account for projects, custom GPTs,
            memories, and settings.
          </p>

          <div className="mt-4">
            {chatgptStatus === "checking" && (
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
                  Looking for ChatGPT...
                </span>
              </div>
            )}

            {chatgptStatus === "ready" && (
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
                  {chatgptTabLocation
                    ? `Found ChatGPT ${chatgptTabLocation} — ready to go`
                    : "ChatGPT is open and ready"}
                </span>
              </div>
            )}

            {chatgptStatus === "not_found" && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                <p className="text-sm font-medium text-amber-800 mb-3">
                  ChatGPT isn't open yet
                </p>
                <div className="space-y-2">
                  <button
                    onClick={async () => {
                      await chrome.tabs.create({
                        url: "https://chatgpt.com",
                        active: true,
                      });
                      setTimeout(() => void checkForChatGPT(), 3000);
                    }}
                    className="w-full rounded-md bg-amber-100 px-3 py-2 text-sm font-medium text-amber-800 transition-colors hover:bg-amber-200"
                  >
                    Open ChatGPT for me
                  </button>
                  <button
                    onClick={() => void checkForChatGPT()}
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

            {chatgptStatus === "not_responding" && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                <p className="text-sm font-medium text-amber-800 mb-2">
                  Found ChatGPT, but can't connect to it
                </p>
                <p className="mb-3 text-xs text-amber-600">
                  Try refreshing your ChatGPT tab, then click the button below.
                </p>
                <button
                  onClick={() => void checkForChatGPT()}
                  className="w-full rounded-md bg-amber-100 px-3 py-2 text-sm font-medium text-amber-800 transition-colors hover:bg-amber-200"
                >
                  Check again
                </button>
              </div>
            )}
          </div>

          <button
            onClick={handleStartBrowser}
            disabled={chatgptStatus !== "ready"}
            className={`mt-6 w-full rounded-lg px-4 py-2.5 text-sm font-medium transition-colors ${
              chatgptStatus === "ready"
                ? "bg-blue-600 text-white hover:bg-blue-700"
                : "cursor-not-allowed bg-slate-100 text-slate-400"
            }`}
          >
            {chatgptStatus === "ready"
              ? "Start Reading"
              : "Waiting for ChatGPT..."}
          </button>
        </div>
      );
    }

    // "upload" or "both"
    return (
      <div className="flex flex-1 flex-col">
        <h2 className="text-lg font-semibold text-gray-900">
          {method === "both"
            ? "Step 1 of 2: Upload your backup file"
            : "Upload your backup file"}
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          {method === "both"
            ? "First, upload your ChatGPT backup. Then we'll read more from your account."
            : "Upload the backup file you downloaded from ChatGPT."}
        </p>

        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <h3 className="text-sm font-semibold text-slate-700 mb-3">
            How to get your ChatGPT backup file
          </h3>
          <ol className="space-y-2 text-sm text-slate-600">
            <li className="flex gap-2">
              <span className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-100 text-blue-700 text-xs flex items-center justify-center font-bold">1</span>
              <span>Open <a href="https://chatgpt.com/#settings/DataControls" target="_blank" rel="noopener" className="text-blue-600 underline">ChatGPT Settings &rarr; Data Controls</a></span>
            </li>
            <li className="flex gap-2">
              <span className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-100 text-blue-700 text-xs flex items-center justify-center font-bold">2</span>
              <span>Click <strong>&ldquo;Export data&rdquo;</strong>, then <strong>&ldquo;Confirm export&rdquo;</strong></span>
            </li>
            <li className="flex gap-2">
              <span className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-100 text-blue-700 text-xs flex items-center justify-center font-bold">3</span>
              <span>Check your email — OpenAI will send you a download link (usually within a few minutes, sometimes up to 24 hours)</span>
            </li>
            <li className="flex gap-2">
              <span className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-100 text-blue-700 text-xs flex items-center justify-center font-bold">4</span>
              <span>Click the link in the email to download a <strong>.zip file</strong></span>
            </li>
            <li className="flex gap-2">
              <span className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-100 text-blue-700 text-xs flex items-center justify-center font-bold">5</span>
              <span>Upload that file below &darr;</span>
            </li>
          </ol>
        </div>

        <div className="mt-4">
          <FileUpload onFileSelect={handleFileSelect} />
        </div>

        <p className="mt-3 text-xs text-slate-400 text-center">
          Still waiting for the email? You can close this and come back later —
          or go Back to choose &ldquo;Read from your ChatGPT account&rdquo; instead.
        </p>
      </div>
    );
  }

  if (phase === "error") {
    // Show a friendlier error message for common issues
    let friendlyError = error;
    if (error?.includes("No ChatGPT tab found")) {
      friendlyError =
        "We couldn't find ChatGPT open in any of your tabs. Please open chatgpt.com in another tab, make sure you're logged in, then try again.";
    } else if (error?.includes("No file selected")) {
      friendlyError = "No file was selected. Please try again.";
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
          onClick={handleRetry}
          className="mt-4 w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Try Again
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
          All done!
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          Moving on to review your data...
        </p>
      </div>
    );
  }

  // Running
  return (
    <div className="flex flex-1 flex-col">
      <h2 className="text-lg font-semibold text-gray-900">Reading your ChatGPT data</h2>
      <p className="mt-1 text-sm text-gray-500">
        Please keep this panel open — this will only take a moment.
      </p>
      <div className="mt-4">
        <ProgressTracker steps={steps} startedAt={startedAt} />
      </div>
    </div>
  );
}
