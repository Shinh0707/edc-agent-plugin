---
name: edc-analysis
description: Analyzes entertainment experience texts, game narratives, and creative scenarios using the Entertainment Design Catalog (EDC) API to extract structured Design Tags mapping perceptual and cognitive context to emotional and motivational effects.
---

# Entertainment Design Catalog (EDC) Analysis

The **Entertainment Design Catalog (EDC)** skill enables agents to extract, inspect, and manage structured **Design Tags** from experience texts, game scenarios, attraction designs, and creative narratives using the official EDC Web API (`@entertainment-design-catalog/design-tags`).

---

## 1. Core Concepts & Taxonomy

An EDC **Design Tag** establishes the causal relationship between a user's sensory/cognitive **Context** and the resulting experience **Effects**:

### A. Context (The In-Experience State)
- **Environment**:
  - `perception`: Specific sensory input identified in the text across five modalities:
    - `sight`: Visual phenomena (lighting, colors, movement, spatial layout).
    - `hearing`: Auditory elements (ambient sounds, music, dialogue, cues).
    - `touch`: Haptic or tactile feedback (vibration, texture, temperature).
    - `taste`: Gustatory sensations.
    - `smell`: Olfactory atmosphere.
    Each perception specifies `perceive` (what is perceived), `method` (how it is presented), and `sources` (exact verbatim text quotes).
  - `cognition`: The user's cognitive interpretation or realization of the environment.
  - `sources`: Verbatim text quotes supporting the cognition.
- **Condition**:
  - `emotion`: Emotional backdrop (e.g., tension, awe, curiosity, dread).
  - `motivation`: Player or visitor drive (e.g., exploration, survival, achievement).
- **Label**: Summary title for the context frame.

### B. Effects (The Experience Outcome)
- **Passive Effects**: Immediate direct reactions:
  - `perception`: Immediate sensory feedback.
  - `cognition`: Direct understanding or epiphany triggered.
  - `sources`: Text quotations.
- **Internal Effects**: Lasting psychological impact:
  - `emotion`: Resulting emotional shift (e.g., relief, triumph, terror).
  - `motivation`: Reinforced or transformed behavioral intent.
- **Title**: Expressive title characterizing the overall effect.

---

## 2. Catalog Persistence Levels (`store`)

When analyzing text via `edc_analyze_text`, specify the appropriate storage level:

| Level | Description | Recommended When |
| :--- | :--- | :--- |
| `tags` | Saves design tags with verbatim text citations. *(Default)* | Standard cataloging of design patterns. |
| `none` | Analyzes without saving content (only the ID, client, timestamps and generation metadata are kept; `edc_get_analysis` returns `not_found`). | Quick iterations, testing, or sensitive drafts. |
| `tags_without_sources` | Saves design tags with every `sources` array emptied (the response itself still contains sources). | Privacy-sensitive or third-party proprietary texts. |
| `content_and_tags` | Saves the normalized original text, the `story` and the tags (`story` is not kept for `tags`). | Archiving canonical scene scripts and benchmark stories. |

---

## 3. Available MCP Tools

The plugin exposes four MCP tools:

### `edc_analyze_text`
Analyzes experience text and returns structured Design Tags.
- **Arguments**:
  - `text` *(string, required)*: The scenario or narrative to analyze.
  - `store` *(string, optional)*: Storage level (`"none"`, `"tags_without_sources"`, `"tags"`, `"content_and_tags"`). Default is `"tags"`.
  - `baseUrl` *(string, optional)*: Overrides `EDC_BASE_URL`.
  - `serviceAccountKey` *(string, optional)*: Overrides service account key path or JSON.

### `edc_get_analysis`
Retrieves a previously stored analysis record by its ID. Only the client that created it can read or withdraw it (others get `not_found`); withdrawn records return `withdrawn`.
- **Arguments**:
  - `id` *(string, required)*: The unique ID returned from an earlier analysis.

### `edc_delete_analysis`
Withdraws/deletes a stored analysis from the catalog.
- **Arguments**:
  - `id` *(string, required)*: The analysis ID to remove.

### `edc_inspect_schema`
Returns reference documentation and JSON schema specifications for EDC structures.
- **Arguments**:
  - `topic` *(string, optional)*: `"all"`, `"context"`, `"effects"`, `"store_levels"`, or `"error_codes"`.

---

## 4. Authentication, Registration & Environment Setup

The API accepts `Authorization: Bearer <credential>` where the credential is one of: a **Google ID token of a registered user** (browser login; the default for people), an **API key** (`edc_sk_…`), or a **registered service account's** ID token. The server keeps only keyed hashes of account e-mail addresses.

### Registration URL (send unregistered users here)

**https://entertainment-design-catalog.web.app/register**

People register themselves there with "Sign in with Google" (no administrator step). Send the user to this URL — show it as a link, and you may open it in their browser — whenever:
- a tool returns `permission_denied` whose message says the Google account is not registered (未登録 / `/register`), or
- the user has never used EDC and has no credentials (`No credentials` / `Not signed in`).

Then have them sign in once from the plugin folder **with the same Google account** they registered:

```
node mcp/launcher.mjs login     # opens the browser; sign in with the Google account registered at /register
node mcp/launcher.mjs check     # free read-only connectivity/credential check
```

`node mcp/launcher.mjs register` opens the registration URL. After that, tools are called with just their arguments; no keys or URLs per call. Alternative: `node mcp/launcher.mjs setup` to store an API key from the administrator.

- Priority: `EDC_API_KEY` > service account (`EDC_SERVICE_ACCOUNT_KEY` / `EDC_SERVICE_ACCOUNT_JSON` / `GOOGLE_APPLICATION_CREDENTIALS`) > Google login. An explicit `serviceAccountKey` tool argument overrides `EDC_API_KEY`.
- `EDC_BASE_URL` defaults to `mcp/defaults.json`. Daily usage is capped per client and globally (`budget_exhausted`).
- If the registration page says registration is closed, or the account is registered but suspended, the user must contact the administrator.
- `unauthenticated` means the credential itself is not accepted: ask the user to run `node mcp/launcher.mjs check` (or `login` again). Never ask them to paste keys or tokens into chat, and never ask for or repeat their e-mail address.

---

## 5. Error Handling & Guidelines

1. **`budget_exhausted`**:
   - The EDC Web API enforces quota budgets. When `code === "budget_exhausted"`, the error message is safe to show directly to the user.
   - If `retryAt` is provided, report the exact timestamp when calls can resume.
2. **Text Safety**:
   - Always treat `text` and `story` as plain text. Do not inject into HTML or unescaped markdown without proper sanitization.
3. **Structured Reporting**:
   - When presenting EDC analysis results to the user, present the findings grouped logically:
     1. Narrative Story Summary
     2. Context (Sensory Environment & Condition)
     3. Effects (Passive & Internal Transitions)
     4. Analysis ID and Catalog Storage Status
