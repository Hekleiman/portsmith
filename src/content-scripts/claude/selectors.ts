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
      value: "textarea[placeholder*='Describe your project'], textarea[placeholder*='description' i], input[placeholder*='description' i], textarea[aria-label*='description' i]",
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

// ─── Project Dashboard (post-creation) ──────────────────────
// URL: claude.ai/project/:id
// After clicking "Create project" on the modal, the SPA navigates
// to the project dashboard where instructions, files, and chat live.

export const PROJECT_DASHBOARD = {
  /**
   * "Set project instructions" or "+" button in the Instructions section.
   * NOTE: The primary instructions flow now uses FILL_PROJECT_INSTRUCTIONS
   * compound handler which finds this button contextually. These selectors
   * serve as fallback only.
   */
  addInstructionsButton: [
    {
      priority: 1,
      type: "testid",
      value: "add-project-instructions-button",
      lastVerified: VERIFIED,
    },
    {
      priority: 2,
      type: "text",
      value: "Set project instructions",
      lastVerified: VERIFIED,
    },
    {
      priority: 3,
      type: "css",
      value:
        "button[aria-label*='instruction' i], button[aria-label*='Add instructions' i]",
      lastVerified: VERIFIED,
    },
    {
      priority: 4,
      type: "xpath",
      value:
        "//*[text()='Instructions']/ancestor::*[position()<=3]//button | //button[contains(text(),'instruction')] | //div[contains(text(),'nstruction')]/ancestor::button",
      lastVerified: VERIFIED,
    },
  ] satisfies SelectorStrategy[],

  /**
   * Instructions textarea on the project dashboard.
   * NOTE: The primary instructions flow now uses FILL_PROJECT_INSTRUCTIONS
   * compound handler which finds the editor contextually. These selectors
   * serve as fallback only. NEVER use a generic [contenteditable] here —
   * it matches the chat input ("Reply...") at the top of the page.
   */
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
      value:
        "textarea[placeholder*='instruction' i], textarea[aria-label*='instruction' i]",
      lastVerified: VERIFIED,
    },
    {
      priority: 3,
      type: "xpath",
      value:
        "//div[contains(@class,'instruction')]//textarea | //div[contains(@class,'instruction')]//div[@contenteditable='true'] | //*[text()='Instructions']/ancestor::div[position()<=3]//textarea",
      lastVerified: VERIFIED,
    },
  ] satisfies SelectorStrategy[],

  /** Save/confirm button for instructions */
  saveInstructionsButton: [
    {
      priority: 1,
      type: "testid",
      value: "save-instructions-button",
      lastVerified: VERIFIED,
    },
    {
      priority: 2,
      type: "text",
      value: "Save",
      lastVerified: VERIFIED,
    },
    {
      priority: 3,
      type: "css",
      value:
        "button[type='submit'], button[aria-label*='Save' i]",
      lastVerified: VERIFIED,
    },
  ] satisfies SelectorStrategy[],

  /** Indicator element proving we're on the project dashboard */
  projectPageIndicator: [
    {
      priority: 1,
      type: "testid",
      value: "project-dashboard",
      lastVerified: VERIFIED,
    },
    {
      priority: 2,
      type: "css",
      value: "[data-testid='project-name'], h1[class*='project']",
      lastVerified: VERIFIED,
    },
    {
      priority: 3,
      type: "xpath",
      value:
        "//div[contains(@class,'project')]//h1 | //div[@data-testid='project-dashboard']",
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
  "dashboard.addInstructionsButton": PROJECT_DASHBOARD.addInstructionsButton,
  "dashboard.instructionsTextarea": PROJECT_DASHBOARD.instructionsTextarea,
  "dashboard.saveInstructionsButton": PROJECT_DASHBOARD.saveInstructionsButton,
  "dashboard.projectPageIndicator": PROJECT_DASHBOARD.projectPageIndicator,
} as const;
