export interface ConfidenceBadgeProps {
  confidence: number;
}

export default function ConfidenceBadge({
  confidence,
}: ConfidenceBadgeProps): React.JSX.Element {
  const pct = Math.round(confidence * 100);

  let bg: string;
  let text: string;
  if (confidence >= 0.8) {
    bg = "bg-green-100";
    text = "text-green-700";
  } else if (confidence >= 0.5) {
    bg = "bg-yellow-100";
    text = "text-yellow-700";
  } else {
    bg = "bg-red-100";
    text = "text-red-700";
  }

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${bg} ${text}`}
    >
      {pct}%
    </span>
  );
}
