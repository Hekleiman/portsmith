export interface InstructionDiffProps {
  original: string;
  translated: string;
  onTranslatedChange: (value: string) => void;
}

export default function InstructionDiff({
  original,
  translated,
  onTranslatedChange,
}: InstructionDiffProps): React.JSX.Element {
  return (
    <div className="space-y-3">
      {/* Original (read-only) */}
      <div>
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-gray-500">
            Original (ChatGPT)
          </label>
          <span className="text-xs text-gray-400">
            {original.length} chars
          </span>
        </div>
        <div className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-gray-200 bg-gray-50 p-3">
          <p className="whitespace-pre-wrap text-sm text-gray-600">
            {original || "No instructions"}
          </p>
        </div>
      </div>

      {/* Translated (editable) */}
      <div>
        <div className="flex items-center justify-between">
          <label
            htmlFor="translated-instructions"
            className="text-xs font-medium text-gray-500"
          >
            Translated (Claude)
          </label>
          <span className="text-xs text-gray-400">
            {translated.length} chars
          </span>
        </div>
        <textarea
          id="translated-instructions"
          value={translated}
          onChange={(e) => onTranslatedChange(e.target.value)}
          rows={8}
          className="mt-1 w-full resize-y rounded-lg border border-blue-200 bg-white p-3 text-sm text-gray-800 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
        />
      </div>
    </div>
  );
}
