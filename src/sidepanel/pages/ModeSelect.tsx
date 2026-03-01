import { useEffect } from "react";
import type { DeliveryMode } from "@/core/storage/migration-state";
import ModeCard from "../components/ModeCard";
import { useMigrationStore } from "../store/migration-store";

const MODES: {
  id: DeliveryMode;
  title: string;
  description: string;
  badge: string;
  pros: string[];
  cons: string[];
  icon: React.ReactNode;
}[] = [
  {
    id: "autofill",
    title: "Autofill",
    description:
      "Extension does it for you. Fastest, but depends on Claude's UI not changing.",
    badge: "Fastest",
    pros: ["Hands-free", "Bulk import"],
    cons: ["May break if UI changes"],
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
          <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
        </svg>
      </div>
    ),
  },
  {
    id: "guided",
    title: "Guided",
    description:
      "Step-by-step instructions you follow manually. Always works.",
    badge: "Most Reliable",
    pros: ["Always works", "Full control"],
    cons: ["Manual effort", "Slower"],
    icon: (
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100">
        <svg
          className="h-5 w-5 text-emerald-600"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M9 18l6-6-6-6" />
        </svg>
      </div>
    ),
  },
  {
    id: "hybrid",
    title: "Hybrid",
    description:
      "Auto-fills with your confirmation at each step.",
    badge: "Recommended",
    pros: ["Fast with safety net", "Confirm each step"],
    cons: ["Slightly slower than Autofill"],
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
          <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
          <path d="M9 12l2 2 4-4" />
        </svg>
      </div>
    ),
  },
];

export default function ModeSelect(): React.JSX.Element {
  const deliveryMode = useMigrationStore((s) => s.deliveryMode);
  const setDeliveryMode = useMigrationStore((s) => s.setDeliveryMode);

  // Pre-select Hybrid as default
  useEffect(() => {
    if (deliveryMode === null) {
      setDeliveryMode("hybrid");
    }
  }, [deliveryMode, setDeliveryMode]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">
          How should we import?
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          Choose how PortSmith delivers your data into Claude.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        {MODES.map((m) => (
          <ModeCard
            key={m.id}
            title={m.title}
            description={m.description}
            icon={m.icon}
            badge={m.badge}
            pros={m.pros}
            cons={m.cons}
            selected={deliveryMode === m.id}
            onClick={() => setDeliveryMode(m.id)}
          />
        ))}
      </div>
    </div>
  );
}
