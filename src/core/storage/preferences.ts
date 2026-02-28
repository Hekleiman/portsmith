// ─── Typed preference keys ───────────────────────────────────

export interface PreferenceMap {
  llmMode: "none" | "local" | "cloud" | "byok";
  lastSourcePlatform: string;
  lastTargetPlatform: string;
  sidebarState: "expanded" | "collapsed";
}

type PreferenceKey = keyof PreferenceMap;

// ─── chrome.storage.local wrapper ────────────────────────────

function storageKey(key: PreferenceKey): string {
  return `pref:${key}`;
}

export async function getPreference<K extends PreferenceKey>(
  key: K,
): Promise<PreferenceMap[K] | undefined> {
  const k = storageKey(key);
  const result = await chrome.storage.local.get(k);
  return result[k] as PreferenceMap[K] | undefined;
}

export async function setPreference<K extends PreferenceKey>(
  key: K,
  value: PreferenceMap[K],
): Promise<void> {
  await chrome.storage.local.set({ [storageKey(key)]: value });
}

export async function removePreference(key: PreferenceKey): Promise<void> {
  await chrome.storage.local.remove(storageKey(key));
}

export async function getAllPreferences(): Promise<Partial<PreferenceMap>> {
  const keys = [
    "llmMode",
    "lastSourcePlatform",
    "lastTargetPlatform",
    "sidebarState",
  ] as const;
  const storageKeys = keys.map(storageKey);
  const result = await chrome.storage.local.get(storageKeys);
  const prefs: Partial<PreferenceMap> = {};
  for (const key of keys) {
    const val = result[storageKey(key)];
    if (val !== undefined) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (prefs as any)[key] = val;
    }
  }
  return prefs;
}
