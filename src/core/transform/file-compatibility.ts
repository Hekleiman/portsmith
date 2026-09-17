/**
 * Claude-compatible file formats and conversion suggestions.
 * Used during extraction to populate KnowledgeFile.compatible and
 * KnowledgeFile.conversionNeeded fields.
 */

const CLAUDE_SUPPORTED_EXTENSIONS = new Set([
  // Documents
  "pdf", "docx", "txt", "rtf", "odt", "html", "htm", "epub",
  // Data
  "json", "csv", "xlsx",
  // Code
  "py", "js", "ts", "tsx", "jsx", "css",
  "java", "c", "cpp", "h", "hpp", "cs", "rb", "go",
  "rs", "swift", "kt", "php", "sh", "bash", "yaml", "yml",
  "toml", "xml", "sql", "md", "markdown", "r", "scala",
]);

const CONVERSION_SUGGESTIONS: Record<string, string> = {
  pptx: "Save as PDF before uploading to Claude",
  ppt: "Save as PDF before uploading to Claude",
  doc: "Save as DOCX or PDF before uploading to Claude",
  xls: "Save as XLSX or CSV before uploading to Claude",
  png: "Claude can view images in chat but not as project knowledge files",
  jpg: "Claude can view images in chat but not as project knowledge files",
  jpeg: "Claude can view images in chat but not as project knowledge files",
  gif: "Claude can view images in chat but not as project knowledge files",
  webp: "Claude can view images in chat but not as project knowledge files",
  svg: "Claude can view images in chat but not as project knowledge files",
  mp3: "Audio files are not supported as project knowledge",
  mp4: "Video files are not supported as project knowledge",
  zip: "Extract the archive contents and upload individual files",
  rar: "Extract the archive contents and upload individual files",
};

const MIME_MAP: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  csv: "text/csv",
  json: "application/json",
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  html: "text/html",
  htm: "text/html",
  xml: "application/xml",
  rtf: "application/rtf",
  odt: "application/vnd.oasis.opendocument.text",
  epub: "application/epub+zip",
  py: "text/x-python",
  js: "text/javascript",
  ts: "text/typescript",
  tsx: "text/typescript",
  jsx: "text/javascript",
  css: "text/css",
  java: "text/x-java",
  c: "text/x-c",
  cpp: "text/x-c++",
  h: "text/x-c",
  hpp: "text/x-c++",
  cs: "text/x-csharp",
  rb: "text/x-ruby",
  go: "text/x-go",
  rs: "text/x-rust",
  swift: "text/x-swift",
  kt: "text/x-kotlin",
  php: "text/x-php",
  sh: "text/x-shellscript",
  bash: "text/x-shellscript",
  yaml: "text/yaml",
  yml: "text/yaml",
  toml: "text/toml",
  sql: "text/x-sql",
  r: "text/x-r",
  scala: "text/x-scala",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
};

export function getFileExtension(filename: string): string {
  const parts = filename.split(".");
  if (parts.length <= 1) return "";
  const ext = parts[parts.length - 1];
  return ext ? ext.toLowerCase() : "";
}

export function isClaudeCompatible(filename: string): boolean {
  return CLAUDE_SUPPORTED_EXTENSIONS.has(getFileExtension(filename));
}

export function getConversionSuggestion(filename: string): string | undefined {
  return CONVERSION_SUGGESTIONS[getFileExtension(filename)];
}

export function getMimeType(filename: string): string {
  return MIME_MAP[getFileExtension(filename)] ?? "application/octet-stream";
}
