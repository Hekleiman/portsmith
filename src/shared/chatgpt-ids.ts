// ─── ChatGPT gizmo IDs ──────────────────────────────────────
// GPTs are "g-<9 chars>", projects are "g-p-<32 hex>". Sidebar URLs append a
// readable slug ("g-p-<hex>-trip-planning"), which must be stripped before
// calling the API or matching against the data export.

const PROJECT_ID = /^(g-p-[0-9a-f]{32})(?:-[\w-]*)?$/i;
const GPT_ID = /^(g-[A-Za-z0-9]{9})(?:-[\w-]*)?$/;
const ANY_GIZMO = /^g-[\w-]{1,120}$/;

/**
 * Normalize a gizmo ID taken from a URL. Returns the bare ID when the
 * format is recognized, the input unchanged when it merely looks like a
 * gizmo ID, and null for anything else (never put that into a URL).
 */
export function normalizeGizmoId(raw: string): string | null {
  const value = raw.trim();
  const project = PROJECT_ID.exec(value);
  if (project?.[1]) return project[1].toLowerCase();
  const gpt = GPT_ID.exec(value);
  if (gpt?.[1]) return gpt[1];
  return ANY_GIZMO.test(value) ? value : null;
}

/** Whether two gizmo IDs refer to the same GPT/project. */
export function sameGizmo(a: string | undefined | null, b: string | undefined | null): boolean {
  if (!a || !b) return false;
  const na = normalizeGizmoId(a);
  const nb = normalizeGizmoId(b);
  return na !== null && na === nb;
}
