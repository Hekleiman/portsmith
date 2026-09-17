import type { ExtractionMethod as TExtractionMethod } from "@/core/storage/migration-state";
import MethodCard from "../components/MethodCard";
import { useMigrationStore } from "../store/migration-store";

const METHODS: {
  id: TExtractionMethod;
  title: string;
  description: string;
  badge?: string;
  icon: React.ReactNode;
}[] = [
  {
    id: "browser",
    title: "Read from your ChatGPT account",
    description:
      "Reads your projects, custom GPTs, files, memory and custom instructions from ChatGPT in this browser. Keep the ChatGPT sidebar open.",
    badge: "Recommended",
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
    title: "Account + ChatGPT data export",
    description:
      "Also adds conversation titles from your ChatGPT data export (Settings, Data controls, Export). The export email can take up to a day to arrive.",
    badge: "Extra context",
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
          How should we get your stuff?
        </h2>
        <p className="mt-1 text-sm text-gray-600">
          GPT and project settings only come from your account. A data export
          adds conversation history context on top.
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
            badge={m.badge}
            onClick={() => setExtractionMethod(m.id)}
          />
        ))}
      </div>
    </div>
  );
}
