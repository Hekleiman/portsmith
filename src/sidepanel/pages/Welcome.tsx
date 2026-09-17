import { useCallback, useEffect, useState } from "react";
import PlatformCard from "../components/PlatformCard";
import ConfirmButton from "../components/ConfirmButton";
import { useMigrationStore } from "../store/migration-store";
import {
  clearAllData,
  getStorageSummary,
  type StorageSummary,
} from "@/core/storage/indexed-db";
import { sendMessage } from "@/shared/messaging";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/**
 * Shows what PortSmith keeps in this browser (extracted setups, file
 * copies, progress) and lets the user delete all of it.
 */
function SavedData(): React.JSX.Element | null {
  const reset = useMigrationStore((s) => s.reset);
  const [summary, setSummary] = useState<StorageSummary | null>(null);
  const [status, setStatus] = useState<"idle" | "deleting" | "deleted" | "error">("idle");

  useEffect(() => {
    let cancelled = false;
    getStorageSummary()
      .then((s) => {
        if (!cancelled) setSummary(s);
      })
      .catch(() => {
        // Storage unavailable: nothing to show
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleDelete = useCallback(async () => {
    setStatus("deleting");
    try {
      await sendMessage("MIGRATION_CANCEL").catch(() => undefined);
      await clearAllData();
      reset();
      setSummary({ manifests: 0, files: 0, checkpoints: 0, fileBytes: 0 });
      setStatus("deleted");
    } catch {
      setStatus("error");
    }
  }, [reset]);

  if (status === "deleted") {
    return (
      <p className="text-xs text-gray-600" role="status">
        Deleted everything PortSmith had saved in this browser.
      </p>
    );
  }
  if (!summary || (summary.manifests === 0 && summary.files === 0)) return null;

  const parts = [plural(summary.manifests, "extracted setup")];
  if (summary.files > 0) {
    parts.push(`${plural(summary.files, "file")} (${formatBytes(summary.fileBytes)})`);
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
      <p className="text-xs text-gray-700">
        Saved in this browser: {parts.join(" and ")}. Nothing leaves your
        computer, but you can delete it once you&apos;re done.
      </p>
      <div className="mt-1.5">
        <ConfirmButton
          label="Delete saved data"
          question="Delete everything PortSmith saved in this browser?"
          confirmLabel="Delete"
          cancelLabel="Keep it"
          disabled={status === "deleting"}
          onConfirm={() => void handleDelete()}
          className="text-xs font-medium text-red-800 underline hover:text-red-900 disabled:opacity-60"
        />
      </div>
      {status === "error" && (
        <p className="mt-1 text-xs text-red-800" role="alert">
          Couldn&apos;t delete the saved data. Try again, or remove the extension
          to clear it.
        </p>
      )}
    </div>
  );
}

const PLATFORMS = [
  {
    id: "chatgpt",
    name: "ChatGPT",
    description: "Projects, custom GPTs, memory and custom instructions",
    enabled: true,
    color: "bg-emerald-100 text-emerald-600",
    letter: "G",
  },
  {
    id: "claude",
    name: "Claude",
    description: "Projects, instructions, knowledge docs and project memory",
    enabled: true,
    color: "bg-orange-100 text-orange-600",
    letter: "C",
  },
  {
    id: "gemini",
    name: "Gemini",
    description: "Gems (name, description and instructions)",
    enabled: true,
    color: "bg-blue-100 text-blue-600",
    letter: "G",
  },
] as const;

export default function SourceSelect(): React.JSX.Element {
  const sourcePlatform = useMigrationStore((s) => s.sourcePlatform);
  const setSourcePlatform = useMigrationStore((s) => s.setSourcePlatform);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">
          Where are you migrating from?
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          Select the platform you want to export data from.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        {PLATFORMS.map((p) => (
          <PlatformCard
            key={p.id}
            name={p.name}
            description={p.description}
            selected={sourcePlatform === p.id}
            disabled={!p.enabled}
            onClick={() => setSourcePlatform(p.id)}
            icon={
              <div
                className={`flex h-10 w-10 items-center justify-center rounded-lg ${p.color}`}
              >
                <span className="text-lg font-bold">{p.letter}</span>
              </div>
            }
          />
        ))}
      </div>
      <SavedData />
    </div>
  );
}
