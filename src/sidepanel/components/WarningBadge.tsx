export interface WarningBadgeProps {
  count: number;
}

export default function WarningBadge({
  count,
}: WarningBadgeProps): React.JSX.Element {
  if (count === 0) return <></>;

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
      <svg
        className="h-3 w-3"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M12 9v2m0 4h.01M10.29 3.86l-8.3 14.58A1 1 0 003 20h18a1 1 0 00.87-1.5l-8.3-14.58a1.04 1.04 0 00-1.74 0z"
        />
      </svg>
      {count}
    </span>
  );
}
