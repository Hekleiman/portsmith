import { describe, it, expect } from "vitest";
import { APP_NAME, APP_VERSION } from "@/shared/constants";

describe("constants", () => {
  it("exports correct app name and version", () => {
    expect(APP_NAME).toBe("PortSmith");
    expect(APP_VERSION).toBe("0.1.0");
  });
});
