export const APP_NAME = "PortSmith";
export const APP_VERSION = "0.4.1";

/** Version of the PortsmithManifest format written by this build. */
export const MANIFEST_VERSION = APP_VERSION;
export const GENERATED_BY = `portsmith/${APP_VERSION}`;

/**
 * Largest file PortSmith passes to a content script. Files travel as
 * base64 inside one chrome.tabs.sendMessage, which Chrome caps at 64 MiB,
 * and base64 adds a third. One more MiB of bytes would be exactly 64 MiB
 * of text, so the JSON envelope (type, file name, mime type) would push it
 * over the cap. 47 MiB is about 62.7 MiB of text, leaving over 1 MiB for
 * the envelope. A larger file can never arrive, so it is left for the user
 * to add by hand.
 */
export const MAX_MESSAGE_FILE_BYTES = 47 * 1024 * 1024;

/** Why a file over `MAX_MESSAGE_FILE_BYTES` was left for the user. */
export const TOO_LARGE_FOR_MESSAGE =
  "too large to pass through the extension (over 47 MB): add it by hand";
