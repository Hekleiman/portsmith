import type { ExtractionMethod as TExtractionMethod } from "@/core/storage/migration-state";
import MethodCard from "../components/MethodCard";
import { useMigrationStore } from "../store/migration-store";

const METHODS: {
  id: TExtractionMethod;
  title: string;
  description: string;
  recommended?: boolean;
  icon: React.ReactNode;
}[] = [
  {
    id: "upload",
    title: "Upload Data Export",
    description:
      "Upload your ChatGPT data export ZIP file. Includes conversations, custom GPTs, and more.",
    icon: (
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-100">
        <svg
          className="h-5 w-5 text-violet-600"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
      </div>
    ),
  },
  {
    id: "browser",
    title: "Extract from Browser",
    description:
      "Read data directly from chatgpt.com. You must be logged in to your ChatGPT account.",
    icon: (
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-sky-100">
        <svg
          className="h-5 w-5 text-sky-600"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="2" y1="12" x2="22" y2="12" />
          <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
        </svg>
      </div>
    ),
  },
  {
    id: "both",
    title: "Both",
    description:
      "Combines file export and browser extraction for the richest, most complete data.",
    recommended: true,
    icon: (
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100">
        <svg
          className="h-5 w-5 text-amber-600"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
        </svg>
      </div>
    ),
  },
];

export default function ExtractionMethod(): React.JSX.Element {
  const extractionMethod = useMigrationStore((s) => s.extractionMethod);
  const setExtractionMethod = useMigrationStore((s) => s.setExtractionMethod);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">
          How should we get your data?
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          Choose how to extract data from ChatGPT.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        {METHODS.map((m) => (
          <MethodCard
            key={m.id}
            title={m.title}
            description={m.description}
            icon={m.icon}
            selected={extractionMethod === m.id}
            recommended={m.recommended}
            onClick={() => setExtractionMethod(m.id)}
          />
        ))}
      </div>
    </div>
  );
}
