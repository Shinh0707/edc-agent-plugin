// MCP サーバーと launcher のテスト(design.md 10 節の TEST-P12)。npm test は先に dist をビルドする
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const launcher = join(dirname(fileURLToPath(import.meta.url)), "..", "launcher.mjs");

/** 手元の鍵束・設定に触れないよう、HOME を空のフォルダにして動かす(macOS のキーチェーンは読むだけ) */
function run(args, input) {
  const home = mkdtempSync(join(tmpdir(), "edc-home-"));
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [launcher, ...args], { env: { ...process.env, HOME: home, USERPROFILE: home }, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (c) => {
      stdout += c;
      if (input && stdout.includes('"id":2')) child.kill();
    });
    child.stderr.on("data", (c) => (stderr += c));
    child.on("error", reject);
    child.on("close", (code) => { rmSync(home, { recursive: true, force: true }); resolve({ code, stdout, stderr }); });
    if (input) child.stdin.write(input); else child.stdin.end();
    setTimeout(() => child.kill(), 15000).unref();
  });
}

test("TEST-P12 MCP サーバーが 4 つのツールを出し、引数に宛先・資格情報がない", async () => {
  const input = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } } },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
  ].map((m) => JSON.stringify(m)).join("\n") + "\n";
  const { stdout } = await run([], input);
  const list = stdout.trim().split("\n").map((l) => JSON.parse(l)).find((m) => m.id === 2);
  const tools = list.result.tools;
  assert.deepEqual(tools.map((t) => t.name).sort(), ["edc_analyze_text", "edc_delete_analysis", "edc_get_analysis", "edc_inspect_schema"]);
  for (const t of tools) {
    const props = Object.keys(t.inputSchema.properties ?? {});
    assert.ok(!props.includes("baseUrl") && !props.includes("serviceAccountKey"), `${t.name}: ${props}`);
  }
});

test("TEST-P12 status は秘密を出さず、宛先は定数", async () => {
  const { code, stdout } = await run(["status"]);
  assert.equal(code, 0);
  const s = JSON.parse(stdout);
  assert.equal(s.issuer, "https://edc-account-366057354766.asia-east1.run.app");
  assert.equal(s.apiBase, "https://entertainment-design-catalog.web.app");
  assert.ok(["edc-account", "none"].includes(s.authMode));
  assert.equal(typeof s.signedIn, "boolean");
});

test("TEST-P12 register・setup は login へ案内して失敗する", async () => {
  for (const cmd of ["register", "setup"]) {
    const { code, stderr } = await run([cmd]);
    assert.equal(code, 1);
    assert.match(stderr, /launcher\.mjs login/);
  }
});
