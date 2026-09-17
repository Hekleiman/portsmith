import { useCallback, useState } from "react";
import type { StepDownload } from "@/shared/messaging";
import { loadFile } from "@/core/storage/indexed-db";
import { base64ToBytes } from "@/shared/encoding";

export interface DownloadButtonProps {
  download: StepDownload;
}

async function toBlob(download: StepDownload): Promise<Blob> {
  if (download.content !== undefined) {
    return new Blob([download.content], {
      type: `${download.mimeType || "text/plain"};charset=utf-8`,
    });
  }
  if (download.contentRef) {
    const record = await loadFile(download.contentRef);
    if (!record) throw new Error("The copied file is no longer available");
    return new Blob([base64ToBytes(record.blob)], {
      type: download.mimeType || record.mimeType || "application/octet-stream",
    });
  }
  throw new Error("Nothing to download");
}

/** Saves a copied file (or generated text) so the user can upload it by hand. */
export default function DownloadButton({
  download,
}: DownloadButtonProps): React.JSX.Element {
  const [error, setError] = useState<string | null>(null);

  const handleClick = useCallback(async () => {
    setError(null);
    try {
      const blob = await toBlob(download);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = download.fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [download]);

  return (
    <div>
      <button
        type="button"
        onClick={() => void handleClick()}
        className="flex w-full items-center justify-between gap-2 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-left text-xs text-gray-700 hover:bg-gray-50"
      >
        <span className="truncate">{download.label}</span>
        <span className="shrink-0 font-medium text-blue-700">Download</span>
      </button>
      {error && (
        <p className="mt-0.5 text-[11px] text-red-700" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
