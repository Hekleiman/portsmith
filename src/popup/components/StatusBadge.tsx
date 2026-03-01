export type StatusVariant = "idle" | "in-progress" | "complete";

export interface StatusBadgeProps {
  variant: StatusVariant;
  label: string;
}

const styles: Record<StatusVariant, string> = {
  idle: "bg-gray-100 text-gray-600",
  "in-progress": "bg-blue-100 text-blue-700 animate-pulse",
  complete: "bg-green-100 text-green-700",
};

const dots: Record<StatusVariant, string> = {
  idle: "bg-gray-400",
  "in-progress": "bg-blue-500",
  complete: "bg-green-500",
};

export default function StatusBadge({
  variant,
  label,
}: StatusBadgeProps): React.JSX.Element {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[variant]}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dots[variant]}`} />
      {label}
    </span>
  );
}
