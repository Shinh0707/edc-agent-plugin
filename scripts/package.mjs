// 配布用の zip を作る。CI(.github/workflows/release.yml)と手元の両方で使う。
//   node scripts/package.mjs [--tag vX.Y.Z] [--allow-missing-secret]
// 前提: plugin/mcp で npm ci && npm run build 済み(mcp/dist/index.mjs がある)。
// - 入れるファイルは FILES に書いたものだけ(.env・auth.json・鍵・node_modules は入らない)
// - mcp/defaults.json の oauthClientSecret は、環境変数 EDC_OAUTH_CLIENT_SECRET から入れる(リポジトリには置かない)
//   デスクトップアプリの OAuth クライアントのシークレットは、Google の定義上は秘密でない値で、配布物には入ってよい
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
  ".env.example",
  ".gitignore",
  "agents/edc-specialist.md",
  "rules/AGENTS.md",
  "skills/edc-analysis/SKILL.md",
  "assets/logo.svg",
  "mcp/launcher.mjs",
  "mcp/package.json",
  "mcp/defaults.json",
  "mcp/src/server.ts",
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

const secret = process.env.EDC_OAUTH_CLIENT_SECRET ?? "";
if (secret === "" && !args.includes("--allow-missing-secret")) {
  fail("EDC_OAUTH_CLIENT_SECRET がない(手元で試すだけなら --allow-missing-secret)");
}

for (const file of FILES) if (!existsSync(join(plugin, file))) fail(`${file} がない(mcp/dist は npm run build で作る)`);

const stage = join(out, "stage");
rmSync(out, { recursive: true, force: true });
mkdirSync(join(stage, NAME), { recursive: true });
for (const file of FILES) {
  mkdirSync(dirname(join(stage, NAME, file)), { recursive: true });
  cpSync(join(plugin, file), join(stage, NAME, file));
}
const defaultsPath = join(stage, NAME, "mcp/defaults.json");
const defaults = JSON.parse(readFileSync(defaultsPath, "utf8"));
if (!defaults.oauthClientId) fail("mcp/defaults.json の oauthClientId が空");
writeFileSync(defaultsPath, JSON.stringify({ ...defaults, oauthClientSecret: secret }, null, 2) + "\n");

const zip = join(out, `${NAME}.zip`);
execFileSync("zip", ["-q", "-X", "-r", zip, NAME], { cwd: stage, stdio: "inherit" });
rmSync(stage, { recursive: true, force: true });
const sha256 = createHash("sha256").update(readFileSync(zip)).digest("hex");
writeFileSync(`${zip}.sha256`, `${sha256}  ${NAME}.zip\n`);
console.log(`dist/${NAME}.zip (v${version}, ${FILES.length} files, secret ${secret === "" ? "なし" : "あり"})\nsha256 ${sha256}`);
