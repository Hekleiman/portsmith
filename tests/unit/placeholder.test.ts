import { describe, it, expect } from "vitest";
import { APP_NAME, APP_VERSION } from "@/shared/constants";
import manifest from "../../manifest.json";
import pkg from "../../package.json";

describe("constants", () => {
  it("keeps the app version in sync with manifest.json and package.json", () => {
    expect(APP_NAME).toBe("PortSmith");
    expect(APP_VERSION).toBe(manifest.version);
    expect(APP_VERSION).toBe(pkg.version);
  });
});
