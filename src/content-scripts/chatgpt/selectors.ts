import type { SelectorStrategy } from "@/content-scripts/common/selector-engine";

// ─── ChatGPT DOM Selectors ──────────────────────────────────
// Each element uses SelectorStrategy[] with at least 2 strategies.
// Strategies are ordered by reliability: testid > aria > css > xpath > text.
//
// ChatGPT's UI changes frequently — lastVerified dates track when
// each selector was confirmed working. When selectors break, update
// the strategies and bump lastVerified.

const VERIFIED = "2026-02-28";

// ─── Login Detection ────────────────────────────────────────
// Used by: extractor.ts → checkLoggedIn()

export const LOGIN_AVATAR: SelectorStrategy[] = [
  {
    priority: 1,
    type: "testid",
    value: "profile-button",
    lastVerified: VERIFIED,
  },
  {
    priority: 2,
    type: "css",
    value: "[data-testid='profile-button'], button[aria-label='Open Profile Menu']",
    lastVerified: VERIFIED,
  },
  {
    priority: 3,
    type: "xpath",
    value: "//button[contains(@class, 'rounded-full')]//img[contains(@alt, '')]",
    lastVerified: VERIFIED,
  },
];

// ─── GPT Editor Page ────────────────────────────────────────
// URL: chatgpt.com/gpts/editor/* or chatgpt.com/gpts/editor/new
// Used by: extractor.ts → extractSingleGPT()
//
// NOTE: The GPT editor page (/gpts/editor/<id>) requires navigating
// to each GPT individually. The /gpts/mine list page shows cards
// but full config (instructions, files) is only on the editor page.
// These selectors target the "Configure" tab view of the editor.

export const GPT_EDITOR = {
  /** GPT name input field */
  name: [
    {
      priority: 1,
      type: "css",
      value: "input[placeholder='Name your GPT']",
      lastVerified: VERIFIED,
    },
    {
      priority: 2,
      type: "css",
      value: ".gizmo-editor input[type='text']:first-of-type",
      lastVerified: VERIFIED,
    },
    {
      priority: 3,
      type: "xpath",
      value: "//input[contains(@placeholder, 'Name')]",
      lastVerified: VERIFIED,
    },
  ] satisfies SelectorStrategy[],

  /** GPT description textarea */
  description: [
    {
      priority: 1,
      type: "css",
      value: "textarea[placeholder*='description']",
      lastVerified: VERIFIED,
    },
    {
      priority: 2,
      type: "xpath",
      value: "//textarea[contains(@placeholder, 'description') or contains(@placeholder, 'Description')]",
      lastVerified: VERIFIED,
    },
    {
      priority: 3,
      type: "css",
      value: ".gizmo-editor textarea:first-of-type",
      lastVerified: VERIFIED,
    },
  ] satisfies SelectorStrategy[],

  /** GPT instructions textarea */
  instructions: [
    {
      priority: 1,
      type: "css",
      value: "textarea[placeholder*='nstructions']",
      lastVerified: VERIFIED,
    },
    {
      priority: 2,
      type: "xpath",
      value: "//label[contains(text(),'Instructions')]/following::textarea[1]",
      lastVerified: VERIFIED,
    },
    {
      priority: 3,
      type: "css",
      value: "[data-testid='gpt-instructions-textarea']",
      lastVerified: VERIFIED,
    },
  ] satisfies SelectorStrategy[],

  /** Conversation starter inputs (there are typically 4) */
  conversationStarters: [
    {
      priority: 1,
      type: "css",
      value: "input[placeholder*='onversation starter']",
      lastVerified: VERIFIED,
    },
    {
      priority: 2,
      type: "xpath",
      value: "//label[contains(text(),'Conversation starters')]/following::input",
      lastVerified: VERIFIED,
    },
    {
      priority: 3,
      type: "css",
      value: "[data-testid='conversation-starters'] input",
      lastVerified: VERIFIED,
    },
  ] satisfies SelectorStrategy[],

  /** Knowledge files list items */
  knowledgeFiles: [
    {
      priority: 1,
      type: "xpath",
      value: "//label[contains(text(),'Knowledge')]/following::div[contains(@class,'file')]//span",
      lastVerified: VERIFIED,
    },
    {
      priority: 2,
      type: "css",
      value: "[data-testid='knowledge-files'] .file-name, [data-testid='knowledge-files'] span",
      lastVerified: VERIFIED,
    },
    {
      priority: 3,
      type: "css",
      value: ".knowledge-section .uploaded-file span:first-child",
      lastVerified: VERIFIED,
    },
  ] satisfies SelectorStrategy[],

  /** The "Configure" tab to switch to manual configuration */
  configureTab: [
    {
      priority: 1,
      type: "text",
      value: "Configure",
      lastVerified: VERIFIED,
    },
    {
      priority: 2,
      type: "css",
      value: "[role='tab'][data-state]:nth-child(2)",
      lastVerified: VERIFIED,
    },
    {
      priority: 3,
      type: "xpath",
      value: "//button[@role='tab' and contains(text(),'Configure')]",
      lastVerified: VERIFIED,
    },
  ] satisfies SelectorStrategy[],
};

// ─── GPT Management/List Page ───────────────────────────────
// URL: chatgpt.com/gpts/mine
// Used by: extractor.ts → extractCustomGPTs() for list-page discovery
//
// NOTE: This page lists GPTs as cards linking to /gpts/editor/<id>.
// Only name and ID can be read from the list; full config requires
// navigating into each editor page.

export const GPT_LIST = {
  /** GPT links in the sidebar. Each is a nav <a> with href /g/g-<id>.
   *  Excludes project links (href ending in /project).
   *  Example: /g/g-1Z8uzeu5R-resume-wizard */
  gptCards: [
    {
      priority: 1,
      type: "css",
      value: 'nav a[href*="/g/g-"]:not([href$="/project"])',
      lastVerified: VERIFIED,
    },
    {
      priority: 2,
      type: "css",
      value: 'a[href*="/g/g-"]:not([href$="/project"])',
      lastVerified: VERIFIED,
    },
    {
      priority: 3,
      type: "css",
      value: "a[href*='/gpts/editor/']",
      lastVerified: VERIFIED,
    },
  ] satisfies SelectorStrategy[],

  /** GPT name within a sidebar link */
  gptCardName: [
    {
      priority: 1,
      type: "css",
      value: "a[href*=\"/g/g-\"]:not([href$=\"/project\"]) [class*='truncate'], a[href*=\"/g/g-\"]:not([href$=\"/project\"]) span",
      lastVerified: VERIFIED,
    },
    {
      priority: 2,
      type: "xpath",
      value: ".//span | .//div[contains(@class, 'truncate')]",
      lastVerified: VERIFIED,
    },
  ] satisfies SelectorStrategy[],
};

// ─── ChatGPT Projects ──────────────────────────────────────
// ChatGPT Projects appear in the sidebar and at chatgpt.com/project/<id>.
// Projects contain: name, instructions, knowledge files, scoped conversations.
// They map directly to Claude Projects — higher fidelity than Custom GPTs.
//
// Used by: extractor.ts → extractProjects()

export const PROJECT_SIDEBAR = {
  /** Project links in the sidebar. Each is a nav <a> whose href ends with /project.
   *  Example: /g/g-p-68fbd0de40248191a303c2a93435081a-japan-china-korea-trip/project */
  projectLinks: [
    {
      priority: 1,
      type: "css",
      value: 'nav a[href$="/project"]',
      lastVerified: VERIFIED,
    },
    {
      priority: 2,
      type: "css",
      value: 'a[href$="/project"]',
      lastVerified: VERIFIED,
    },
    {
      priority: 3,
      type: "xpath",
      value: "//nav//a[substring(@href, string-length(@href) - 7) = '/project']",
      lastVerified: VERIFIED,
    },
  ] satisfies SelectorStrategy[],

  /** Project name text within a sidebar link */
  projectLinkName: [
    {
      priority: 1,
      type: "css",
      value: "a[href$=\"/project\"] [class*='truncate'], a[href$=\"/project\"] span",
      lastVerified: VERIFIED,
    },
    {
      priority: 2,
      type: "xpath",
      value: ".//span | .//div[contains(@class, 'truncate')]",
      lastVerified: VERIFIED,
    },
  ] satisfies SelectorStrategy[],
};

export const PROJECT_PAGE = {
  /** Project name heading on the /project/<id> page */
  name: [
    {
      priority: 1,
      type: "css",
      value: "h1, [data-testid='project-name']",
      lastVerified: VERIFIED,
    },
    {
      priority: 2,
      type: "xpath",
      value: "//h1 | //div[@data-testid='project-name']",
      lastVerified: VERIFIED,
    },
    {
      priority: 3,
      type: "css",
      value: "main h1, [role='heading'][aria-level='1']",
      lastVerified: VERIFIED,
    },
  ] satisfies SelectorStrategy[],

  /** Project instructions/custom instructions area.
   *  On the project page, instructions may be in a textarea, a
   *  contenteditable div, or a read-only display block. */
  instructions: [
    {
      priority: 1,
      type: "css",
      value: "[data-testid='project-instructions'] textarea, [data-testid='project-instructions']",
      lastVerified: VERIFIED,
    },
    {
      priority: 2,
      type: "xpath",
      value: "//label[contains(text(),'nstructions')]/following::textarea[1] | //span[contains(text(),'nstructions')]/ancestor::div[1]/following-sibling::div//textarea",
      lastVerified: VERIFIED,
    },
    {
      priority: 3,
      type: "css",
      value: "textarea[placeholder*='nstructions'], textarea[placeholder*='project']",
      lastVerified: VERIFIED,
    },
  ] satisfies SelectorStrategy[],

  /** Button that opens the "Project settings" modal (Radix dialog) */
  settingsModalTrigger: [
    {
      priority: 1,
      type: "testid",
      value: "project-modal-trigger",
      lastVerified: VERIFIED,
    },
    {
      priority: 2,
      type: "css",
      value: "button[data-testid='project-modal-trigger']",
      lastVerified: VERIFIED,
    },
    {
      priority: 3,
      type: "xpath",
      value: "//button[@data-testid='project-modal-trigger']",
      lastVerified: VERIFIED,
    },
  ] satisfies SelectorStrategy[],

  /** The "Project settings" modal dialog (Radix portal) */
  settingsModal: [
    {
      priority: 1,
      type: "aria",
      value: "Project settings",
      lastVerified: VERIFIED,
    },
    {
      priority: 2,
      type: "css",
      value: "form[aria-label='Project settings']",
      lastVerified: VERIFIED,
    },
    {
      priority: 3,
      type: "css",
      value: "[role='dialog']",
      lastVerified: VERIFIED,
    },
  ] satisfies SelectorStrategy[],

  /** Instructions textarea inside the "Project settings" modal form.
   *  Must be scoped to the form to avoid matching the chat input textarea. */
  modalInstructions: [
    {
      priority: 1,
      type: "css",
      value: "form[aria-label='Project settings'] textarea",
      lastVerified: VERIFIED,
    },
    {
      priority: 2,
      type: "xpath",
      value: "//form[@aria-label='Project settings']//textarea",
      lastVerified: VERIFIED,
    },
    {
      priority: 3,
      type: "css",
      value: "[role='dialog'] form textarea",
      lastVerified: VERIFIED,
    },
  ] satisfies SelectorStrategy[],

  /** Knowledge/uploaded files in the project settings panel */
  knowledgeFiles: [
    {
      priority: 1,
      type: "css",
      value: "[data-testid='project-files'] span, [data-testid='project-files'] [class*='file-name']",
      lastVerified: VERIFIED,
    },
    {
      priority: 2,
      type: "xpath",
      value: "//span[contains(text(),'Files') or contains(text(),'files')]/ancestor::div[1]/following-sibling::div//span[contains(@class,'truncate')] | //div[contains(@class,'file')]//span",
      lastVerified: VERIFIED,
    },
    {
      priority: 3,
      type: "css",
      value: "[class*='file-list'] span, [class*='uploaded'] span:first-child",
      lastVerified: VERIFIED,
    },
  ] satisfies SelectorStrategy[],

  /** Conversation items scoped to this project (visible in project view) */
  conversations: [
    {
      priority: 1,
      type: "css",
      value: "a[href*='/c/'], [data-testid='conversation-item']",
      lastVerified: VERIFIED,
    },
    {
      priority: 2,
      type: "xpath",
      value: "//a[contains(@href, '/c/')]",
      lastVerified: VERIFIED,
    },
  ] satisfies SelectorStrategy[],
};

// ─── Settings > Personalization > Memory ────────────────────
// URL: chatgpt.com/#settings (navigated to Memory tab)

export const SETTINGS_MEMORY = {
  /** Settings button in sidebar/nav */
  settingsButton: [
    {
      priority: 1,
      type: "testid",
      value: "nav-settings-button",
      lastVerified: VERIFIED,
    },
    {
      priority: 2,
      type: "text",
      value: "Settings",
      lastVerified: VERIFIED,
    },
    {
      priority: 3,
      type: "css",
      value: "nav a[href*='settings'], button[aria-label='Settings']",
      lastVerified: VERIFIED,
    },
  ] satisfies SelectorStrategy[],

  /** Personalization nav item within settings */
  personalizationTab: [
    {
      priority: 1,
      type: "text",
      value: "Personalization",
      lastVerified: VERIFIED,
    },
    {
      priority: 2,
      type: "css",
      value: "[data-testid='settings-personalization'], [role='tab'][id*='personalization']",
      lastVerified: VERIFIED,
    },
    {
      priority: 3,
      type: "xpath",
      value: "//button[contains(text(),'Personalization')] | //a[contains(text(),'Personalization')]",
      lastVerified: VERIFIED,
    },
  ] satisfies SelectorStrategy[],

  /** "Manage" link/button next to Memory heading */
  manageMemoryButton: [
    {
      priority: 1,
      type: "text",
      value: "Manage",
      lastVerified: VERIFIED,
    },
    {
      priority: 2,
      type: "css",
      value: "button[aria-label*='Manage'], a[href*='memory']",
      lastVerified: VERIFIED,
    },
    {
      priority: 3,
      type: "xpath",
      value: "//button[contains(text(),'Manage')] | //a[contains(text(),'Manage')]",
      lastVerified: VERIFIED,
    },
  ] satisfies SelectorStrategy[],

  /** Container holding memory items list */
  memoryListContainer: [
    {
      priority: 1,
      type: "css",
      value: "[data-testid='memory-list'], [role='list'][aria-label*='memory' i]",
      lastVerified: VERIFIED,
    },
    {
      priority: 2,
      type: "xpath",
      value: "//div[contains(@class, 'memory')]//ul | //div[contains(@class, 'memory')]//div[@role='list']",
      lastVerified: VERIFIED,
    },
    {
      priority: 3,
      type: "css",
      value: ".memory-list, .memories-container",
      lastVerified: VERIFIED,
    },
  ] satisfies SelectorStrategy[],

  /** Individual memory item text within the list */
  memoryItem: [
    {
      priority: 1,
      type: "css",
      value: "[data-testid='memory-item'], [role='listitem']",
      lastVerified: VERIFIED,
    },
    {
      priority: 2,
      type: "css",
      value: ".memory-list > div, .memories-container > div",
      lastVerified: VERIFIED,
    },
    {
      priority: 3,
      type: "xpath",
      value: "//div[contains(@class,'memory')]//div[contains(@class,'item')] | //div[@role='listitem']",
      lastVerified: VERIFIED,
    },
  ] satisfies SelectorStrategy[],
};

// ─── Settings > Personalization > Custom Instructions ───────
// URL: chatgpt.com/#settings (navigated to Custom Instructions modal)

export const SETTINGS_CUSTOM_INSTRUCTIONS = {
  /** "Custom instructions" button/link */
  customInstructionsButton: [
    {
      priority: 1,
      type: "text",
      value: "Custom instructions",
      lastVerified: VERIFIED,
    },
    {
      priority: 2,
      type: "css",
      value: "[data-testid='custom-instructions-button'], button[aria-label*='Custom instructions']",
      lastVerified: VERIFIED,
    },
    {
      priority: 3,
      type: "xpath",
      value: "//button[contains(text(),'Custom instructions')] | //a[contains(text(),'Custom instructions')]",
      lastVerified: VERIFIED,
    },
  ] satisfies SelectorStrategy[],

  /** "What would you like ChatGPT to know about you?" textarea */
  aboutUserTextarea: [
    {
      priority: 1,
      type: "css",
      value: "textarea[placeholder*='know about you'], textarea[placeholder*='What would you like']",
      lastVerified: VERIFIED,
    },
    {
      priority: 2,
      type: "xpath",
      value: "//label[contains(text(),'know about you')]/following::textarea[1] | //label[contains(text(),'What would you like')]/following::textarea[1]",
      lastVerified: VERIFIED,
    },
    {
      priority: 3,
      type: "css",
      value: "[data-testid='custom-instructions-about'] textarea, .custom-instructions textarea:first-of-type",
      lastVerified: VERIFIED,
    },
  ] satisfies SelectorStrategy[],

  /** "How would you like ChatGPT to respond?" textarea */
  responsePreferencesTextarea: [
    {
      priority: 1,
      type: "css",
      value: "textarea[placeholder*='respond'], textarea[placeholder*='How would you like']",
      lastVerified: VERIFIED,
    },
    {
      priority: 2,
      type: "xpath",
      value: "//label[contains(text(),'respond')]/following::textarea[1] | //label[contains(text(),'How would you like')]/following::textarea[1]",
      lastVerified: VERIFIED,
    },
    {
      priority: 3,
      type: "css",
      value: "[data-testid='custom-instructions-response'] textarea, .custom-instructions textarea:last-of-type",
      lastVerified: VERIFIED,
    },
  ] satisfies SelectorStrategy[],
};
