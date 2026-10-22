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

### `edc_get_analysis`
Retrieves a previously stored analysis record by its ID. Only the EDC account that created it can read or withdraw it (others get `not_found`); withdrawn records return `withdrawn`.
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

## 4. Authentication & Registration

The plugin calls the EDC Web API with an **EDC account access token** (client `edc-cli`; scopes `analyses:read analyses:write cases:read`). The launcher refreshes it automatically and keeps the sign-in in the OS keychain. The API endpoint and the EDC account are fixed in the plugin; tools take no URL or credential arguments.

When a tool says the user is not signed in (`サインインしていません` / `Not signed in`), the sign-in expired (`サインインが切れました`), or the user has never used EDC, have them run once from the plugin folder:

```
node mcp/launcher.mjs login          # opens the EDC account screen; new users register there
node mcp/launcher.mjs login --device # no browser on this machine: open the shown URL on another device
node mcp/launcher.mjs check          # free read-only connectivity/sign-in check
```

- Registration happens inside the EDC account sign-in. Do **not** send users to `/register` (removed in EDC Web API 1.3.0).
- If the EDC account screen says the user is on the waiting list or suspended, follow that screen; the plugin cannot change it.
- Never ask the user to paste tokens into chat, never read the keychain item or `~/.config/edc/` files, and never ask for or repeat their e-mail address.

## 5. Error Handling & Guidelines

1. **`budget_exhausted`** (429):
   - The EDC Web API enforces daily quotas per user. When `code === "budget_exhausted"`, the error message is safe to show directly to the user.
   - If `retryAt` is provided, report the exact timestamp when calls can resume. Do not retry before it.
2. **`permission_denied`** (403): the sign-in lacks the needed permission. Do not retry; ask the user to run `node mcp/launcher.mjs login` again and allow access on the consent screen.
3. **`unauthenticated`** (401): the tool already refreshed the token and retried once. Ask the user to run `login` again.
4. **`internal`** (500, retryable): a temporary server-side failure (the tool already retried once after 2 seconds). Suggest trying again later.
5. **Text Safety**:
   - Always treat `text` and `story` as plain text. Do not inject into HTML or unescaped markdown without proper sanitization.
6. **Structured Reporting**:
   - When presenting EDC analysis results to the user, present the findings grouped logically:
     1. Narrative Story Summary
     2. Context (Sensory Environment & Condition)
     3. Effects (Passive & Internal Transitions)
     4. Analysis ID and Catalog Storage Status
