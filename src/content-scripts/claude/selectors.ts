import type { SelectorStrategy } from "@/content-scripts/common/selector-engine";

// ─── Claude DOM Selectors ───────────────────────────────────
// Each element uses SelectorStrategy[] with at least 2 strategies.
// Strategies are ordered by reliability: testid > aria > css > xpath > text.
//
// Claude's UI changes frequently — lastVerified dates track when
// each selector was confirmed working. When selectors break, update
// the strategies and bump lastVerified.

const VERIFIED = "2026-02-28";

// ─── Projects Page ──────────────────────────────────────────
// URL: claude.ai/projects

export const PROJECTS = {
  /** "Create a project" button on the projects listing page */
  createButton: [
    {
      priority: 1,
      type: "testid",
      value: "create-project-button",
      lastVerified: VERIFIED,
    },
    {
      priority: 2,
      type: "text",
      value: "Create a project",
      lastVerified: VERIFIED,
    },
    {
      priority: 3,
      type: "css",
      value: "a[href='/projects/create'], button[aria-label*='Create']",
      lastVerified: VERIFIED,
    },
    {
      priority: 4,
      type: "xpath",
      value: "//button[contains(text(),'Create')] | //a[contains(text(),'Create a project')]",
      lastVerified: VERIFIED,
    },
  ] satisfies SelectorStrategy[],
} as const;

// ─── Project Creation / Edit Form ───────────────────────────
// URL: claude.ai/projects/create or claude.ai/projects/:id

export const PROJECT_FORM = {
  /** Project name input */
  nameInput: [
    {
      priority: 1,
      type: "testid",
      value: "project-name-input",
      lastVerified: VERIFIED,
    },
    {
      priority: 2,
      type: "css",
      value: "input[placeholder*='name' i], input[aria-label*='project name' i]",
      lastVerified: VERIFIED,
    },
    {
      priority: 3,
      type: "xpath",
      value: "//label[contains(text(),'Name')]/following::input[1] | //input[contains(@placeholder,'name')]",
      lastVerified: VERIFIED,
    },
  ] satisfies SelectorStrategy[],

  /** Project description input/textarea */
  descriptionInput: [
    {
      priority: 1,
      type: "testid",
      value: "project-description-input",
      lastVerified: VERIFIED,
    },
    {
      priority: 2,
      type: "css",
      value: "textarea[placeholder*='description' i], input[placeholder*='description' i], textarea[aria-label*='description' i]",
      lastVerified: VERIFIED,
    },
    {
      priority: 3,
      type: "xpath",
      value: "//label[contains(text(),'Description')]/following::textarea[1] | //label[contains(text(),'Description')]/following::input[1]",
      lastVerified: VERIFIED,
    },
  ] satisfies SelectorStrategy[],

  /** Project instructions textarea (custom instructions / system prompt) */
  instructionsTextarea: [
    {
      priority: 1,
      type: "testid",
      value: "project-instructions-textarea",
      lastVerified: VERIFIED,
    },
    {
      priority: 2,
      type: "css",
      value: "textarea[placeholder*='instruction' i], textarea[aria-label*='instruction' i]",
      lastVerified: VERIFIED,
    },
    {
      priority: 3,
      type: "xpath",
      value: "//label[contains(text(),'nstruction')]/following::textarea[1] | //div[contains(text(),'nstruction')]/following::textarea[1]",
      lastVerified: VERIFIED,
    },
    {
      priority: 4,
      type: "css",
      value: "[contenteditable='true'][role='textbox']",
      lastVerified: VERIFIED,
    },
  ] satisfies SelectorStrategy[],

  /** File upload input (hidden file input for knowledge base uploads) */
  fileUploadInput: [
    {
      priority: 1,
      type: "testid",
      value: "project-file-upload",
      lastVerified: VERIFIED,
    },
    {
      priority: 2,
      type: "css",
      value: "input[type='file'][accept]",
      lastVerified: VERIFIED,
    },
    {
      priority: 3,
      type: "xpath",
      value: "//input[@type='file']",
      lastVerified: VERIFIED,
    },
  ] satisfies SelectorStrategy[],

  /** Save / Create project button */
  saveButton: [
    {
      priority: 1,
      type: "testid",
      value: "project-save-button",
      lastVerified: VERIFIED,
    },
    {
      priority: 2,
      type: "text",
      value: "Create project",
      lastVerified: VERIFIED,
    },
    {
      priority: 3,
      type: "css",
      value: "button[type='submit'], button[aria-label*='Save'], button[aria-label*='Create']",
      lastVerified: VERIFIED,
    },
    {
      priority: 4,
      type: "xpath",
      value: "//button[contains(text(),'Create project')] | //button[contains(text(),'Save')]",
      lastVerified: VERIFIED,
    },
  ] satisfies SelectorStrategy[],
} as const;

// ─── Selector Key Map ───────────────────────────────────────
// Flat lookup used by the importer content script to resolve
// selector keys sent via messaging.

export type ClaudeSelectorKey = keyof typeof SELECTOR_MAP;

export const SELECTOR_MAP = {
  "projects.createButton": PROJECTS.createButton,
  "form.nameInput": PROJECT_FORM.nameInput,
  "form.descriptionInput": PROJECT_FORM.descriptionInput,
  "form.instructionsTextarea": PROJECT_FORM.instructionsTextarea,
  "form.fileUploadInput": PROJECT_FORM.fileUploadInput,
  "form.saveButton": PROJECT_FORM.saveButton,
} as const;
