import { describe, it, expect } from "vitest";
import {
  isClaudeCompatible,
  getConversionSuggestion,
  getMimeType,
  getFileExtension,
} from "@/core/transform/file-compatibility";

describe("file-compatibility", () => {
  describe("getFileExtension", () => {
    it("extracts extension from filename", () => {
      expect(getFileExtension("report.pdf")).toBe("pdf");
    });

    it("handles multiple dots", () => {
      expect(getFileExtension("my.file.name.txt")).toBe("txt");
    });

    it("returns empty string for no extension", () => {
      expect(getFileExtension("README")).toBe("");
    });

    it("lowercases the extension", () => {
      expect(getFileExtension("image.PNG")).toBe("png");
    });
  });

  describe("isClaudeCompatible", () => {
    it("PDF is compatible", () => {
      expect(isClaudeCompatible("report.pdf")).toBe(true);
    });

    it("DOCX is compatible", () => {
      expect(isClaudeCompatible("document.docx")).toBe(true);
    });

    it("TXT is compatible", () => {
      expect(isClaudeCompatible("notes.txt")).toBe(true);
    });

    it("CSV is compatible", () => {
      expect(isClaudeCompatible("data.csv")).toBe(true);
    });

    it("JSON is compatible", () => {
      expect(isClaudeCompatible("config.json")).toBe(true);
    });

    it("Python files are compatible", () => {
      expect(isClaudeCompatible("script.py")).toBe(true);
    });

    it("TypeScript files are compatible", () => {
      expect(isClaudeCompatible("app.tsx")).toBe(true);
    });

    it("XLSX is compatible", () => {
      expect(isClaudeCompatible("spreadsheet.xlsx")).toBe(true);
    });

    it("PPTX is not compatible", () => {
      expect(isClaudeCompatible("slides.pptx")).toBe(false);
    });

    it("DOC (legacy) is not compatible", () => {
      expect(isClaudeCompatible("old.doc")).toBe(false);
    });

    it("XLS (legacy) is not compatible", () => {
      expect(isClaudeCompatible("old.xls")).toBe(false);
    });

    it("PNG is not compatible", () => {
      expect(isClaudeCompatible("image.png")).toBe(false);
    });

    it("unknown extension is not compatible", () => {
      expect(isClaudeCompatible("data.xyz")).toBe(false);
    });

    it("no extension is not compatible", () => {
      expect(isClaudeCompatible("Makefile")).toBe(false);
    });
  });

  describe("getConversionSuggestion", () => {
    it("PPTX has conversion suggestion mentioning PDF", () => {
      expect(getConversionSuggestion("slides.pptx")).toContain("PDF");
    });

    it("DOC has conversion suggestion", () => {
      expect(getConversionSuggestion("old.doc")).toContain("DOCX");
    });

    it("XLS has conversion suggestion", () => {
      expect(getConversionSuggestion("old.xls")).toContain("XLSX");
    });

    it("PNG has image-specific suggestion", () => {
      expect(getConversionSuggestion("photo.png")).toContain("images");
    });

    it("ZIP has archive suggestion", () => {
      expect(getConversionSuggestion("files.zip")).toContain("Extract");
    });

    it("compatible files return undefined", () => {
      expect(getConversionSuggestion("report.pdf")).toBeUndefined();
    });

    it("unknown extension returns undefined", () => {
      expect(getConversionSuggestion("data.xyz")).toBeUndefined();
    });
  });

  describe("getMimeType", () => {
    it("returns correct type for PDF", () => {
      expect(getMimeType("doc.pdf")).toBe("application/pdf");
    });

    it("returns correct type for CSV", () => {
      expect(getMimeType("data.csv")).toBe("text/csv");
    });

    it("returns correct type for DOCX", () => {
      expect(getMimeType("file.docx")).toBe(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      );
    });

    it("returns correct type for Python", () => {
      expect(getMimeType("script.py")).toBe("text/x-python");
    });

    it("returns octet-stream for unknown extension", () => {
      expect(getMimeType("data.xyz")).toBe("application/octet-stream");
    });

    it("returns octet-stream for no extension", () => {
      expect(getMimeType("README")).toBe("application/octet-stream");
    });
  });
});
