import { useEffect } from "react";
import WizardLayout from "./components/WizardLayout";
import { useMigrationStore } from "./store/migration-store";
import type { MigrationPhase } from "@/core/storage/migration-state";
import SourceSelect from "./pages/Welcome";
import TargetSelect from "./pages/TargetSelect";
import ExtractionMethod from "./pages/ExtractionMethod";
import Extract from "./pages/Extract";
import Review from "./pages/Review";
import WorkspaceEditor from "./pages/WorkspaceEditor";
import ModeSelect from "./pages/ModeSelect";
import Migrate from "./pages/Migrate";
import Complete from "./pages/Complete";

function getPageForPhase(phase: MigrationPhase): React.ComponentType {
  switch (phase) {
    case "idle":
    case "source_selection":
      return SourceSelect;
    case "target_selection":
      return TargetSelect;
    case "extraction_method":
      return ExtractionMethod;
    case "extracting":
      return Extract;
    case "review":
      return Review;
    case "editing":
      return WorkspaceEditor;
    case "mode_selection":
      return ModeSelect;
    case "migrating":
    case "verification":
      return Migrate;
    case "complete":
      return Complete;
  }
}

export default function App(): React.JSX.Element {
  const phase = useMigrationStore((s) => s.phase);
  const pendingResume = useMigrationStore((s) => s.pendingResume);
  const resumeChecked = useMigrationStore((s) => s.resumeChecked);
  const checkForResume = useMigrationStore((s) => s.checkForResume);
  const acceptResume = useMigrationStore((s) => s.acceptResume);
  const declineResume = useMigrationStore((s) => s.declineResume);

  useEffect(() => {
    void checkForResume();
  }, [checkForResume]);

  // Loading while checking for a checkpoint
  if (!resumeChecked) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-white">
        <p className="text-sm text-gray-400">Loading...</p>
      </div>
    );
  }

  // Resume prompt
  if (pendingResume) {
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center bg-white p-6">
        <h2 className="text-lg font-semibold text-gray-900">
          Resume Migration?
        </h2>
        <p className="mt-2 text-center text-sm text-gray-500">
          A previous migration was in progress. Would you like to continue where
          you left off?
        </p>
        <div className="mt-6 flex gap-3">
          <button
            onClick={() => void declineResume()}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Start Fresh
          </button>
          <button
            onClick={acceptResume}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Resume
          </button>
        </div>
      </div>
    );
  }

  // Wizard
  const Page = getPageForPhase(phase);

  return (
    <WizardLayout>
      <Page />
    </WizardLayout>
  );
}
