# Gemini API Analysis — Gem CRUD Operations

Source: [HanaokaYuzu/Gemini-API](https://github.com/HanaokaYuzu/Gemini-API) (Python reverse-engineering of gemini.google.com internal API)

---

## 1. Base URL and Query Parameters

### Endpoint

```
POST https://gemini.google.com/_/BardChatUi/data/batchexecute
```

### Query Parameters

| Parameter     | Value                          | Notes                                           |
|---------------|--------------------------------|--------------------------------------------------|
| `rpcids`      | Comma-separated RPC IDs        | e.g. `"CNgdBe"` or `"CNgdBe,CNgdBe"` for batch |
| `hl`          | Language code                  | e.g. `"en"` — extracted from init page           |
| `_reqid`      | Integer                        | Random 10000–99999, incremented by 100000 per call |
| `rt`          | `"c"`                          | Response format (length-prefixed framing)        |
| `source-path` | `"/app"`                       | Fixed value                                      |
| `bl`          | Build label string             | Optional — extracted from init page as `cfb2h`   |
| `f.sid`       | Session ID string              | Optional — extracted from init page as `FdrFJe`  |

---

## 2. RPC Method Identifiers (GRPC IDs)

| Operation    | RPC ID     | Constant Name |
|-------------|------------|---------------|
| List Gems   | `CNgdBe`   | `LIST_GEMS`   |
| Create Gem  | `oMH3Zd`   | `CREATE_GEM`  |
| Update Gem  | `kHv0Vd`   | `UPDATE_GEM`  |
| Delete Gem  | `UXcSJb`   | `DELETE_GEM`  |

---

## 3. Request Payload Structure

### Form Data

Every batchexecute request sends `application/x-www-form-urlencoded` form data:

```
at=<SNlM0e_access_token>&f.req=<serialized_payload>
```

- `at`: The SNlM0e CSRF/access token (extracted from init page HTML)
- `f.req`: JSON string of the form `[[rpc1, rpc2, ...]]`

### RPC Serialization

Each RPC call is an array: `[rpcid, payload_json_string, null, identifier]`

- `rpcid`: The GRPC string ID
- `payload_json_string`: A **JSON string** (not object) containing the operation-specific payload
- `null`: Reserved/unused
- `identifier`: String tag to match responses in batch (e.g. `"system"`, `"custom"`, `"generic"`)

The full `f.req` value is: `JSON.stringify([[rpc1_array, rpc2_array, ...]])`

---

### 3a. List Gems

Two RPCs in a single batch — one for system/predefined gems, one for custom gems:

```json
[
  ["CNgdBe", "[3,[\"en\"],0]", null, "system"],
  ["CNgdBe", "[2,[\"en\"],0]", null, "custom"]
]
```

**Payload variants:**
- `[2,["en"],0]` — Custom (user-created) gems only
- `[3,["en"],0]` — System (predefined) gems, excluding hidden
- `[4,["en"],0]` — System gems, including hidden ones

Replace `"en"` with the user's language code.

**Response parsing:**
```
response_json[i] → [rpcid, ???, body_json_string, ..., identifier]
```
- `body_json_string` is at index `[2]` of each response part
- Parse it as JSON → gem list is at index `[2]`
- Each gem in the list: `[gem_id, [name, description], [prompt] | null, ...]`

**Gem field extraction:**
```
gem[0]       → id (string)
gem[1][0]    → name (string)
gem[1][1]    → description (string)
gem[2][0]    → prompt/instructions (string, or null if gem[2] is null)
```

---

### 3b. Create Gem

```json
[
  ["oMH3Zd", "[[\"My Gem\",\"A helpful assistant\",\"You are...\",null,null,null,null,null,0,null,1,null,null,null,[]]]", null, "generic"]
]
```

**Payload structure (inner JSON):**
```json
[
  [
    name,           // [0] string — gem name
    description,    // [1] string — gem description
    prompt,         // [2] string — system instructions
    null,           // [3] reserved
    null,           // [4] reserved
    null,           // [5] reserved
    null,           // [6] reserved
    null,           // [7] reserved
    0,              // [8] unknown flag
    null,           // [9] reserved
    1,              // [10] unknown flag (possibly "enabled")
    null,           // [11] reserved
    null,           // [12] reserved
    null,           // [13] reserved
    []              // [14] empty array (possibly for knowledge files/extensions)
  ]
]
```

**Response parsing:**
```
response_json[0][2] → JSON string
parse → [gem_id, ...]
gem_id is at index [0]
```

---

### 3c. Update Gem

Recorded from the Gem editor's "Update" button (gemini.google.com, Sep 2026). The record has 18 elements; the old 16-element form in the Python client is out of date.

```json
[
  ["kHv0Vd", "[\"gem_id\",[\"Name\",\"Desc\",\"Prompt\",null,null,null,null,null,0,null,1,null,null,null,[[[null,null,null,null,null,\"$AX...1\"],[null,null,null,null,null,\"$AX...2\"]]],null,null,0]]", null, "generic"]
]
```

- `[14]` is the Gem's knowledge: `[[file, file, ...]]`, each file `[null×5, handle]`.
- The list **replaces** the Gem's knowledge. Send every handle the Gem should keep; an empty list removes all files.
- Saved Gems get new handles (the editor sent a different handle for a file that was already saved), so keeping existing files means reading the Gem first.

---

### 3c-bis. Knowledge files

Adding a file takes two requests before the update above.

1. **Upload** to `https://content-push.googleapis.com/upload` from the Gemini page (cookies included), with headers `Push-ID` (the page's `qKIAYe` value, default `feeds/mcudyrk2a4khkz`) and `X-Tenant-Id: bard-storage`. The reply body is a temporary reference such as `/contrib_service/ttl_1d/...`. PortSmith sends one multipart request (field `file`, as in the Gemini-API Python client) and falls back to Google's resumable protocol (`X-Goog-Upload-Protocol: resumable`, `start`, then `upload, finalize` at `X-Goog-Upload-Url`).
2. **ProcessFile**: `POST /_/BardChatUi/data/assistant.lamda.BardFrontendService/ProcessFile?bl=…&f.sid=…&hl=en&_reqid=…&rt=c`, form fields `f.req` and `at`:

```json
[null, "[[[\"/contrib_service/ttl_1d/...\",null,1,\"text/markdown\"],\"file-name.md\",null,null,null,null,null,null,[1]],null,1,[\"en\"]]"]
```

The reply streams the file record (usually twice) in `wrb.fr` frames with no RPC id: `[[null,16,name,null,null,handle,null,[thumb,download,viewer],1,[secs,nanos],null,mime,null,[true]], …]`. The handle (`$AX...`) is at `[0][5]`.

After uploading, the editor also calls `ESY5D`; PortSmith doesn't need it.

---

### 3c-ter. Saved info ("Your instructions for Gemini")

Recorded on `gemini.google.com/saved-info` (Sep 2026). The page loads with `GPRiHf` (returned `[]` even with entries saved), `maGuAc`, `Te6DCf` and `L5adhe`. The "Add" button sends `xVRQX`, one entry per call:

```json
[["xVRQX", "[[null,\"i prefer short concise responses\"]]", null, "generic"]]
```

Reply body: `[null,null,null,[[[id,"I prefer short concise responses.",[secs,nanos],null,[secs,nanos],null,null,null,null,2,1]]]]`. Gemini tidies the wording (capitals, final period) before saving. The call takes about four seconds. The page also calls `ESY5D` before and after.

The Gemini-API Python client names `ZKcapf` (list), `gSnMcd` (update), `Ok9j9b` (delete) and `YgU2Cc` (delete all) for memories, but has no payloads for them. `Ok9j9b` takes `[id]` and was exercised against a live account (Sep 2026).

**Length limit.** `xVRQX` accepts at most **1500 characters**, which is not the 10,000 the editor's `maxlength` allows. Measured by binary search on a live account: 1500 saves, 1501 does not. Over-length text comes back as HTTP 200 with a body-less frame carrying error code 13, in 120 to 240 ms rather than the 2 to 5 seconds a real save takes:

```json
["wrb.fr","xVRQX",null,null,null,[13],"generic"]
```

No content category was refused: phone numbers, email addresses, named third parties, cannabis products, emoji, markdown, newlines, quotes and backslashes all saved. Duplicates are not rejected either, so the same text can be saved twice.

Some refusals are transient and carry the same code 13, but arrive slowly (around 10 s); the identical text saves on a retry. Only slow refusals are worth retrying. See docs/gemini-saved-info-probe.md.

---

### 3d. Delete Gem

```json
[
  ["UXcSJb", "[\"gem_id_here\"]", null, "generic"]
]
```

**Payload structure (inner JSON):**
```json
[gem_id]   // single-element array with the gem ID string
```

**Response:** Not parsed — the operation either succeeds (HTTP 200) or fails.

---

## 4. Response Decoding (batchexecute format)

### Step 1: Strip security prefix

Responses start with `)]}'` followed by a newline. Strip this prefix:

```typescript
let content = responseText;
if (content.startsWith(")]}'")) {
  content = content.slice(4);
}
content = content.trimStart();
```

### Step 2: Parse length-prefixed frames

Google uses a **length-prefixed framing protocol**. Each frame:

```
[byte_length_in_UTF16_units]\n[json_payload]
```

**Algorithm:**
1. Read digits until newline → this is the frame length in **UTF-16 code units** (not bytes, not characters)
2. Read that many UTF-16 code units of content
3. Parse as JSON
4. Repeat until end of response

```typescript
function parseFramedResponse(content: string): unknown[] {
  const frames: unknown[] = [];
  let pos = 0;

  while (pos < content.length) {
    // Skip whitespace
    while (pos < content.length && /\s/.test(content[pos])) pos++;
    if (pos >= content.length) break;

    // Read length marker (digits followed by newline)
    const match = content.slice(pos).match(/^(\d+)\n/);
    if (!match) break;

    const lengthInUtf16Units = parseInt(match[1], 10);
    const contentStart = pos + match[0].length - 1; // -1 because \n is counted in length

    // Calculate character count for the given UTF-16 units
    let charCount = 0;
    let units = 0;
    while (units < lengthInUtf16Units && (contentStart + charCount) < content.length) {
      const codePoint = content.codePointAt(contentStart + charCount)!;
      const unitSize = codePoint > 0xFFFF ? 2 : 1;
      if (units + unitSize > lengthInUtf16Units) break;
      units += unitSize;
      charCount++;
    }

    const chunk = content.slice(contentStart, contentStart + charCount).trim();
    pos = contentStart + charCount;

    if (chunk) {
      try {
        const parsed = JSON.parse(chunk);
        if (Array.isArray(parsed)) {
          frames.push(...parsed);
        } else {
          frames.push(parsed);
        }
      } catch { /* skip malformed frames */ }
    }
  }

  return frames;
}
```

### Step 3: Extract RPC responses

Each frame/element in the parsed result is an RPC response envelope:

```
[rpcid, some_data, body_json_string, ..., identifier]
```

- Index `[2]` → JSON string containing the actual response body
- Index `[-1]` → The identifier string matching what was sent in the request
- Parse `body_json_string` with `JSON.parse()` to get the structured response

---

## 5. Authentication

### Required Cookies

| Cookie              | Domain         | Purpose                                      |
|---------------------|----------------|----------------------------------------------|
| `__Secure-1PSID`   | `.google.com`  | Primary Google session identifier             |
| `__Secure-1PSIDTS` | `.google.com`  | Session timestamp — **expires frequently**    |

These are HttpOnly, Secure cookies set by Google's auth flow. In a Chrome extension, retrieve them via:

```typescript
const psid = await chrome.cookies.get({
  url: "https://gemini.google.com",
  name: "__Secure-1PSID"
});
const psidts = await chrome.cookies.get({
  url: "https://gemini.google.com",
  name: "__Secure-1PSIDTS"
});
```

**Manifest permissions required:**
```json
{
  "permissions": ["cookies"],
  "host_permissions": ["https://gemini.google.com/*", "https://*.google.com/*"]
}
```

### Access Token (SNlM0e — CSRF Token)

Before any batchexecute call, fetch the Gemini app page and extract the SNlM0e token:

1. **GET** `https://gemini.google.com/app` (with cookies)
2. Regex-extract from HTML response:

```typescript
const snlm0eMatch = html.match(/"SNlM0e":\s*"(.*?)"/);
const accessToken = snlm0eMatch?.[1]; // This is the "at" parameter
```

Additional session values (optional but recommended):

```typescript
const buildLabel = html.match(/"cfb2h":\s*"(.*?)"/)?.[1];   // bl param
const sessionId  = html.match(/"FdrFJe":\s*"(.*?)"/)?.[1];  // f.sid param
const language   = html.match(/"TuX5cc":\s*"(.*?)"/)?.[1];  // hl param
```

### Cookie Rotation

`__Secure-1PSIDTS` expires frequently. The Python client rotates it via:

```
POST https://accounts.google.com/RotateCookies
Content-Type: application/json
Body: [000,"-0000000000000000000"]
```

**For a Chrome extension:** This is less relevant since the browser handles cookie lifecycle. As long as the user is logged into their Google account, the cookies are automatically refreshed by the browser. The extension just reads current cookies via `chrome.cookies` API.

---

## 6. Required Headers for batchexecute

```http
POST https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=...&hl=en&_reqid=12345&rt=c&source-path=/app
Content-Type: application/x-www-form-urlencoded;charset=utf-8
Origin: https://gemini.google.com
Referer: https://gemini.google.com/
X-Same-Domain: 1
x-goog-ext-525001261-jspb: [1,null,null,null,null,null,null,null,[4]]
x-goog-ext-73010989-jspb: [0]
```

**Note for Chrome extension:** Some of these headers may be blocked by Chrome's `fetch()` due to forbidden header restrictions. In that case, send the request from the **background service worker** or use `declarativeNetRequest` to modify headers. The `X-Same-Domain: 1` header is critical — without it, Google may reject the request.

---

## 7. Full Request Example — Create Gem

```http
POST https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=oMH3Zd&hl=en&_reqid=54321&rt=c&source-path=/app HTTP/1.1
Content-Type: application/x-www-form-urlencoded;charset=utf-8
Origin: https://gemini.google.com
Referer: https://gemini.google.com/
X-Same-Domain: 1
x-goog-ext-525001261-jspb: [1,null,null,null,null,null,null,null,[4]]
x-goog-ext-73010989-jspb: [0]
Cookie: __Secure-1PSID=...; __Secure-1PSIDTS=...

at=SNlM0e_token_here&f.req=%5B%5B%5B%22oMH3Zd%22%2C%22%5B%5B%5C%22My+Gem%5C%22%2C%5C%22Description%5C%22%2C%5C%22You+are+a+helpful+assistant%5C%22%2Cnull%2Cnull%2Cnull%2Cnull%2Cnull%2C0%2Cnull%2C1%2Cnull%2Cnull%2Cnull%2C%5B%5D%5D%5D%22%2Cnull%2C%22generic%22%5D%5D%5D
```

**Decoded `f.req`:**
```json
[[["oMH3Zd","[[\"My Gem\",\"Description\",\"You are a helpful assistant\",null,null,null,null,null,0,null,1,null,null,null,[]]]",null,"generic"]]]
```

---

## 8. Chrome Extension Implementation Notes

### Approach: Content Script + Service Worker

Since batchexecute requests require cookies and specific headers, the recommended approach is:

1. **Content script** on `gemini.google.com` can make `fetch()` calls that automatically include cookies (same-origin)
2. Alternatively, the **service worker** can read cookies via `chrome.cookies` API and set them manually

**Content script approach** (simpler — cookies are automatic):
```typescript
// Content script running on gemini.google.com
const response = await fetch(
  "https://gemini.google.com/_/BardChatUi/data/batchexecute?" + params.toString(),
  {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
      "X-Same-Domain": "1",
    },
    body: formData,
    credentials: "include",
  }
);
```

### SNlM0e Token Extraction

Since the content script runs on the Gemini page, it can extract the token from the page's HTML:
- Either read it from `document.documentElement.innerHTML` (if the page is already loaded)
- Or make a separate `fetch("https://gemini.google.com/app")` and regex-match from the response

### Request ID Management

The `_reqid` should start as a random integer (10000-99999) and increment by 100000 per request. This can be managed in the content script or service worker as a simple counter.
