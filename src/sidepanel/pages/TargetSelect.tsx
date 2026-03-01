import PlatformCard from "../components/PlatformCard";
import { useMigrationStore } from "../store/migration-store";

const PLATFORMS = [
  {
    id: "chatgpt",
    name: "ChatGPT",
    description: "Projects, custom GPTs, memory, and instructions",
    color: "bg-emerald-100 text-emerald-600",
    letter: "G",
  },
  {
    id: "claude",
    name: "Claude",
    description: "Projects, artifacts, and custom instructions",
    color: "bg-orange-100 text-orange-600",
    letter: "C",
  },
  {
    id: "gemini",
    name: "Gemini",
    description: "Gems, saved conversations, and preferences",
    color: "bg-blue-100 text-blue-600",
    letter: "G",
  },
] as const;

/** Only Claude is enabled as a target in V1. */
const V1_ENABLED_TARGETS = new Set(["claude"]);

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
        <p className="mt-1 text-sm text-gray-500">
          Select the target platform for your data.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        {available.map((p) => {
          const enabled = V1_ENABLED_TARGETS.has(p.id);
          return (
            <PlatformCard
              key={p.id}
              id={p.id}
              name={p.name}
              description={p.description}
              selected={targetPlatform === p.id}
              disabled={!enabled}
              onClick={() => setTargetPlatform(p.id)}
              icon={
                <div
                  className={`flex h-10 w-10 items-center justify-center rounded-lg ${p.color}`}
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
