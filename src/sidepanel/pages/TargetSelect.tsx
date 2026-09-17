import PlatformCard from "../components/PlatformCard";
import { useMigrationStore } from "../store/migration-store";
import { supportedModesForTarget } from "@/core/platforms";

const PLATFORMS = [
  {
    id: "claude",
    name: "Claude",
    description:
      "Creates Projects with instructions, files and project memory",
    color: "bg-orange-100 text-orange-800",
    letter: "C",
  },
  {
    id: "gemini",
    name: "Gemini",
    description:
      "Creates Gems; files and memory are added with guided steps",
    color: "bg-blue-100 text-blue-800",
    letter: "G",
  },
  {
    id: "chatgpt",
    name: "ChatGPT",
    description:
      "Step-by-step guide to set up Projects (no automatic import yet)",
    color: "bg-emerald-100 text-emerald-800",
    letter: "G",
  },
] as const;

export default function TargetSelect(): React.JSX.Element {
  const sourcePlatform = useMigrationStore((s) => s.sourcePlatform);
  const targetPlatform = useMigrationStore((s) => s.targetPlatform);
  const setTargetPlatform = useMigrationStore((s) => s.setTargetPlatform);

  const available = PLATFORMS.filter((p) => p.id !== sourcePlatform);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">
          Where are you migrating to?
        </h2>
        <p className="mt-1 text-sm text-gray-600">
          Select the target platform for your data.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        {available.map((p) => {
          const guidedOnly = supportedModesForTarget(p.id).length === 1;
          return (
            <PlatformCard
              key={p.id}
              name={p.name}
              description={p.description}
              selected={targetPlatform === p.id}
              disabled={false}
              badge={guidedOnly ? "Guided only" : undefined}
              onClick={() => setTargetPlatform(p.id)}
              icon={
                <div
                  className={`flex h-10 w-10 items-center justify-center rounded-lg ${p.color}`}
                  aria-hidden="true"
                >
                  <span className="text-lg font-bold">{p.letter}</span>
                </div>
              }
            />
          );
        })}
      </div>
    </div>
  );
}
