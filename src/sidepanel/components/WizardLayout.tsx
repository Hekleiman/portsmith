import StepProgress from "./StepProgress";
import { canProceed, useMigrationStore } from "../store/migration-store";

export interface WizardLayoutProps {
  children: React.ReactNode;
}

export default function WizardLayout({
  children,
}: WizardLayoutProps): React.JSX.Element {
  const phase = useMigrationStore((s) => s.phase);
  const nextStep = useMigrationStore((s) => s.nextStep);
  const prevStep = useMigrationStore((s) => s.prevStep);
  const reset = useMigrationStore((s) => s.reset);
  const canGo = useMigrationStore(canProceed);
  const selectedCount = useMigrationStore(
    (s) => s.selectedWorkspaceIds.length,
  );

  const isFirstPhase = phase === "idle";
  const isLastStep = phase === "complete";
  const isEditing = phase === "editing";
  const isMigrating = phase === "migrating" || phase === "verification";
  const isReview = phase === "review" || isEditing;
  const nextLabel = isReview
    ? `Migrate ${selectedCount} workspace${selectedCount !== 1 ? "s" : ""}`
    : "Next";

  // Hide Back on step 0 only when on the very first phase
  const showBack = !isFirstPhase;

  return (
    <div className="flex h-screen w-[400px] flex-col bg-white">
      {/* Header */}
      <header className="border-b border-gray-200 px-4 py-3">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold text-gray-900">Portsmith</h1>
          <button
            onClick={reset}
            className="text-xs text-gray-400 hover:text-gray-600"
          >
            Cancel
          </button>
        </div>
      </header>

      {/* Step Progress */}
      <div className="border-b border-gray-100 px-4 py-3">
        <StepProgress />
      </div>

      {/* Content */}
      <main className="flex-1 overflow-y-auto p-4">{children}</main>

      {/* Footer navigation — hidden during editing and migrating (they have own controls) */}
      {!isLastStep && !isEditing && !isMigrating && (
        <footer className="border-t border-gray-200 px-4 py-3">
          <div className="flex justify-between">
            <button
              onClick={prevStep}
              disabled={!showBack}
              className={`rounded-lg px-4 py-2 text-sm font-medium ${
                showBack
                  ? "text-gray-600 hover:bg-gray-100"
                  : "invisible"
              }`}
            >
              Back
            </button>
            <button
              onClick={nextStep}
              disabled={!canGo}
              className={`rounded-lg px-6 py-2 text-sm font-medium text-white ${
                canGo
                  ? "bg-blue-600 hover:bg-blue-700"
                  : "cursor-not-allowed bg-blue-300"
              }`}
            >
              {nextLabel}
            </button>
          </div>
        </footer>
      )}
    </div>
  );
}
