// ─── What already reached Gemini's saved info ────────────────
// Gemini rewrites the wording of the entries it saves ("Goes by Er, also
// Henry or Erik" comes back as "I go by both Henry and Erik."), so its list
// can't be compared with PortSmith's own text. A repeated run would send
// every memory again. This keeps the memory IDs PortSmith has already
// saved, per manifest and Google account, so a rerun skips them.

const KEY = "gemini:savedMemory";

type Store = Record<string, string[]>;

function scope(manifestId: string, account: string | null): string {
  return `${manifestId}@${account ?? "/u/0/"}`;
}

async function readStore(): Promise<Store> {
  try {
    const result = await chrome.storage.local.get(KEY);
    const store: unknown = result[KEY];
    return typeof store === "object" && store !== null ? (store as Store) : {};
  } catch {
    return {};
  }
}

/** Memory IDs PortSmith has saved to this account for this manifest. */
export async function loadSavedMemoryIds(
  manifestId: string,
  account: string | null,
): Promise<string[]> {
  const store = await readStore();
  const ids = store[scope(manifestId, account)];
  return Array.isArray(ids) ? ids.filter((id) => typeof id === "string") : [];
}

export async function saveSavedMemoryIds(
  manifestId: string,
  account: string | null,
  ids: string[],
): Promise<void> {
  try {
    const store = await readStore();
    store[scope(manifestId, account)] = [...new Set(ids)];
    await chrome.storage.local.set({ [KEY]: store });
  } catch {
    // Best effort: without it a rerun just re-sends, as before.
  }
}
