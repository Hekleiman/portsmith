export interface MethodCardProps {
  title: string;
  description: string;
  icon: React.ReactNode;
  selected: boolean;
  recommended?: boolean;
  onClick: () => void;
}

export default function MethodCard({
  title,
  description,
  icon,
  selected,
  recommended,
  onClick,
}: MethodCardProps): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-lg border-2 p-3 text-left transition-colors ${
        selected
          ? "border-blue-600 bg-blue-50"
          : "border-gray-200 hover:border-blue-300 hover:bg-gray-50"
      }`}
    >
      <div className="shrink-0">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-900">{title}</span>
          {recommended && (
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
              Recommended
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-gray-500">{description}</p>
      </div>
      {selected && (
        <svg
          className="h-5 w-5 shrink-0 text-blue-600"
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z"
            clipRule="evenodd"
          />
        </svg>
      )}
    </button>
  );
}
