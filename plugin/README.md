# Entertainment Design Catalog (EDC) Plugin

The **Entertainment Design Catalog (EDC)** plugin integrates Antigravity with the official EDC Web API via the [`@entertainment-design-catalog/design-tags`](https://www.npmjs.com/package/@entertainment-design-catalog/design-tags) npm package.

It empowers creators and game designers to analyze narrative copy, immersive scene descriptions, and attraction treatments into structured **Design Tags**—deconstructing how sensory stimuli and cognitive realizations trigger emotional and motivational effects.

---

## Features

- **Automated Design Tag Extraction**: Analyze experience text into structured `context` (environment perceptions across 5 senses, cognitions, conditions) and `effects` (passive feedback and internal emotional/motivational shifts).
- **Authentication**: Google login (browser, once), per-client API keys (`edc_sk_…`) or ID tokens of registered service accounts, sent as Bearer credentials to the EDC Web API (Firebase Functions behind Hosting `/v1/**`).
- **Full Catalog Lifecycle**: Create, retrieve (`GET`), and withdraw/delete (`DELETE`) analyses in the EDC catalog.
- **Granular Privacy & Storage Levels**: Choose between `none`, `tags_without_sources`, `tags` (default), and `content_and_tags`.
- **Pre-packaged MCP Server**: Pre-bundled server (`mcp/dist/index.mjs`) started via `mcp/launcher.mjs`, which handles Google login, key setup, config loading and connectivity checks.
- **Built-in Skill & Specialist Agent**: Includes the `edc-analysis` skill and the `edc-specialist` agent.

---

## Quick start

Install with one command (macOS / Linux), then follow the prompts to register and sign in:

```
curl -fsSL https://github.com/Shinh0707/edc-agent-plugin/releases/latest/download/install.sh | sh
```

Windows: `irm https://github.com/Shinh0707/edc-agent-plugin/releases/latest/download/install.ps1 | iex`. It installs to `~/.gemini/config/plugins/entertainment-design-catalog/` (Antigravity IDE / 2.0) and, if `agy` is present, registers it with the Antigravity CLI. Details and manual install: [`SETUP.md`](SETUP.md).

Manually: install Node.js, register yourself with Google at https://entertainment-design-catalog.web.app/register (`node mcp/launcher.mjs register` opens it), then run once with the same account:

```
node mcp/launcher.mjs login
```

After that, just use the `edc-analysis` skill. Alternatives: an API key (`node mcp/launcher.mjs setup`) or a registered service account. Priority: `EDC_API_KEY` > service account > Google login.

---

## Bundled Tools (MCP Server)

The plugin provides the `entertainment-design-catalog` MCP server with 4 tools:

1. **`edc_analyze_text`**:
   - Analyzes experience text and returns extracted Design Tags, story summary, and metadata.
   - Parameters:
     - `text` *(required)*: The story, scenario, or scene text to analyze.
     - `store` *(optional, default: "tags")*: Persistence tier (`"none"`, `"tags_without_sources"`, `"tags"`, `"content_and_tags"`).
     - `baseUrl` *(optional)*: Override target API endpoint.
     - `serviceAccountKey` *(optional)*: Override service account key path or JSON.

2. **`edc_get_analysis`**:
   - Retrieves a stored analysis record by ID.
   - Parameters:
     - `id` *(required)*: The analysis UUID.

3. **`edc_delete_analysis`**:
   - Deletes/withdraws an analysis record from the EDC catalog.
   - Parameters:
     - `id` *(required)*: The analysis UUID to delete.

4. **`edc_inspect_schema`**:
   - Returns schema definitions, sensory modalities, and error code references.
   - Parameters:
     - `topic` *(optional)*: `"all"`, `"context"`, `"effects"`, `"store_levels"`, `"error_codes"`.

---

## Schema Overview

```
DesignTag
├── context
│   ├── environment[]
│   │   ├── perception[]  (sight | hearing | touch | taste | smell)
│   │   ├── cognition     (realization of the sensory input)
│   │   └── sources[]     (verbatim quotes from text)
│   ├── condition[]       (emotion | motivation)
│   └── label             (descriptive context label)
└── effects[]
    ├── passive[]
    │   ├── perception[]  (immediate sensory reaction)
    │   ├── cognition     (immediate cognitive reaction)
    │   └── sources[]
    ├── internal_effects[] (emotion | motivation transitions)
    └── title             (effect title)
```

---

## License

MIT
