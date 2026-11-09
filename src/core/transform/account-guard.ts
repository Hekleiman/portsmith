// ─── Account guard (Claude to Claude) ───────────────────────
// A move between two Claude accounts must never write into the account
// the data was copied from. Pure helpers, shared by the extractor (to
// record the source) and the orchestrator (to check the target).

/**
 * Shortened email for display and storage: first character, "***", then
 * the domain ("e***@gmail.com"). The full address is never kept.
 */
export function maskEmail(email: string): string {
  const trimmed = email.trim();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0) return trimmed ? `${Array.from(trimmed)[0] ?? ""}***` : "";
  const first = Array.from(trimmed)[0] ?? "";
  return `${first}***${trimmed.slice(at)}`;
}

export type TargetAccountCheck =
  | "ok"
  | "same-account"
  | "unknown-current"
  | "unknown-source";

/**
 * Whether it's safe to write into the signed-in account. Fails closed:
 * anything other than "ok" means nothing may be written.
 */
export function checkTargetAccount(
  source: { accountId?: string },
  current: { uuid: string } | null,
): TargetAccountCheck {
  const sourceId = source.accountId?.trim().toLowerCase();
  if (!sourceId) return "unknown-source";
  const currentId = current?.uuid.trim().toLowerCase();
  if (!currentId) return "unknown-current";
  return sourceId === currentId ? "same-account" : "ok";
}
