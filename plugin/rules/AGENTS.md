# Rules for Entertainment Design Catalog (EDC)

When working with entertainment experiences, game design documents, visitor attractions, or media narratives using EDC:

1. **Security & Credential Protection**:
   - Never log, print, or leak the contents of `EDC_API_KEY`, `EDC_SERVICE_ACCOUNT_KEY`, `.env`, `~/.config/edc/auth.json`, Google ID/refresh tokens, service account JSON, or API tokens in chat responses, artifacts, or transcripts.
   - If the Google account is not registered (`permission_denied` mentioning `/register`) or the user has no credentials yet, send them to https://entertainment-design-catalog.web.app/register to register with Google, then `node mcp/launcher.mjs login` with the same account.
   - If authentication fails otherwise, guide the user to run `node mcp/launcher.mjs check` (or `login` to sign in again) and verify `EDC_BASE_URL`, without asking them to paste secret credentials into public chat.

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
