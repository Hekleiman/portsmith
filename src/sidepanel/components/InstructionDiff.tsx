export interface InstructionDiffProps {
  original: string;
  translated: string;
  onTranslatedChange: (value: string) => void;
  sourceLabel: string;
  targetLabel: string;
}

export default function InstructionDiff({
  original,
  translated,
  onTranslatedChange,
  sourceLabel,
  targetLabel,
}: InstructionDiffProps): React.JSX.Element {
  const changed = original !== translated;

  return (
    <div className="space-y-3">
      {/* Original (read-only) */}
      <div>
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-gray-600">
            Original ({sourceLabel})
          </span>
          <span className="text-xs text-gray-600">
            {original.length.toLocaleString()} chars
          </span>
        </div>
        <div className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-gray-200 bg-gray-50 p-3">
          <p className="whitespace-pre-wrap text-sm text-gray-700">
            {original || "No instructions"}
          </p>
        </div>
      </div>

      {/* Target version (editable) */}
      <div>
        <div className="flex items-center justify-between">
          <label
            htmlFor="translated-instructions"
            className="text-xs font-medium text-gray-600"
          >
            What {targetLabel} will get{changed ? " (edited or adapted)" : ""}
          </label>
          <span className="text-xs text-gray-600">
            {translated.length.toLocaleString()} chars
          </span>
        </div>
        <textarea
          id="translated-instructions"
          value={translated}
          onChange={(e) => onTranslatedChange(e.target.value)}
          rows={8}
          className="mt-1 w-full resize-y rounded-lg border border-blue-200 bg-white p-3 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        {changed && (
          <button
            type="button"
            onClick={() => onTranslatedChange(original)}
            className="mt-1 text-xs font-medium text-blue-800 hover:underline"
          >
            Use the original instead
          </button>
        )}
      </div>
    </div>
  );
}
