# Rules for Entertainment Design Catalog (EDC)

When working with entertainment experiences, game design documents, visitor attractions, or media narratives using EDC:

1. **Security & Credential Protection**:
   - Never read, log, print, or leak EDC account access/refresh tokens, the OS keychain item `edc-agent-plugin`, `~/.config/edc/token.json`, `token.dpapi` or `auth.json` in chat responses, artifacts, or transcripts.
   - If the user is not signed in or not registered, have them run `node mcp/launcher.mjs login` in the plugin folder (new users register on that EDC account screen; `login --device` without a browser). Do not send them to `/register`.
   - If authentication fails otherwise, guide the user to run `node mcp/launcher.mjs check` (or `login` to sign in again), without asking them to paste tokens into chat.

2. **EDC Taxonomy Precision**:
   - Always map experiential elements to their exact EDC constructs:
     - Sensory Modalities: Restrict to `sight`, `hearing`, `touch`, `taste`, and `smell`.
     - Internal States: Clearly distinguish between `emotion` (affective state) and `motivation` (behavioral intent).
     - Structure: Clearly separate pre-interaction `context` from post-interaction `effects`.

3. **Storage Sensitivity**:
   - When analyzing confidential design documents, proprietary IP, or unreleased scripts, recommend using `store: "none"` or `store: "tags_without_sources"` to prevent full text retention.
   - Default to `store: "tags"` for standard public or internal shared cataloging.

4. **Error Handling**:
   - If an `EdcApiError` with `budget_exhausted` is encountered, present the server message verbatim and inform the user of `retryAt` if available.
