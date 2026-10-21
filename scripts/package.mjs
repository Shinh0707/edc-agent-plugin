// 配布用の zip を作る。CI(.github/workflows/release.yml)と手元の両方で使う。
//   node scripts/package.mjs [--tag vX.Y.Z]
// 前提: plugin/mcp で npm ci && npm run build 済み(mcp/dist/index.mjs がある)。
// - 入れるファイルは FILES に書いたものだけ(.env・auth.json・token.json・鍵・node_modules・test は入らない)
// - 秘密は入れない(EDC アカウントの edc-cli は公開クライアント。issuer・宛先は mcp/edc-auth.mjs の定数)
// 出力: dist/entertainment-design-catalog.zip と .sha256(インストーラが確かめる)
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const NAME = "entertainment-design-catalog";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const plugin = join(root, "plugin");
const out = join(root, "dist");
const FILES = [
  "plugin.json",
  "mcp_config.json",
  "README.md",
  "SETUP.md",
  ".gitignore",
  "agents/edc-specialist.md",
  "rules/AGENTS.md",
  "skills/edc-analysis/SKILL.md",
  "assets/logo.svg",
  "mcp/launcher.mjs",
  "mcp/edc-auth.mjs",
  "mcp/token-store.mjs",
  "mcp/package.json",
  "mcp/src/server.ts",
  "mcp/src/apiCall.ts",
  "mcp/dist/index.mjs",
];

const args = process.argv.slice(2);
const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const version = JSON.parse(readFileSync(join(plugin, "plugin.json"), "utf8")).version;
const mcpVersion = JSON.parse(readFileSync(join(plugin, "mcp/package.json"), "utf8")).version;
if (version !== mcpVersion) fail(`plugin.json (${version}) と mcp/package.json (${mcpVersion}) の版が違う`);
const tagAt = args.indexOf("--tag");
if (tagAt >= 0 && args[tagAt + 1] !== `v${version}`) fail(`タグ ${args[tagAt + 1]} が plugin.json の版 v${version} と違う`);

for (const file of FILES) if (!existsSync(join(plugin, file))) fail(`${file} がない(mcp/dist は npm run build で作る)`);

const stage = join(out, "stage");
rmSync(out, { recursive: true, force: true });
mkdirSync(join(stage, NAME), { recursive: true });
for (const file of FILES) {
  mkdirSync(dirname(join(stage, NAME, file)), { recursive: true });
  cpSync(join(plugin, file), join(stage, NAME, file));
}
const zip = join(out, `${NAME}.zip`);
execFileSync("zip", ["-q", "-X", "-r", zip, NAME], { cwd: stage, stdio: "inherit" });
rmSync(stage, { recursive: true, force: true });
const sha256 = createHash("sha256").update(readFileSync(zip)).digest("hex");
writeFileSync(`${zip}.sha256`, `${sha256}  ${NAME}.zip\n`);
console.log(`dist/${NAME}.zip (v${version}, ${FILES.length} files)\nsha256 ${sha256}`);
