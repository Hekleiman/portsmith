import PlatformCard from "../components/PlatformCard";
import { useMigrationStore } from "../store/migration-store";

const PLATFORMS = [
  {
    id: "chatgpt",
    name: "ChatGPT",
    description: "Projects, custom GPTs, memory, and instructions",
    enabled: true,
    color: "bg-emerald-100 text-emerald-600",
    letter: "G",
  },
  {
    id: "claude",
    name: "Claude",
    description: "Projects, artifacts, and custom instructions",
    enabled: false,
    color: "bg-orange-100 text-orange-600",
    letter: "C",
  },
  {
    id: "gemini",
    name: "Gemini",
    description: "Gems, saved conversations, and preferences",
    enabled: false,
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
            id={p.id}
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
    </div>
  );
}
