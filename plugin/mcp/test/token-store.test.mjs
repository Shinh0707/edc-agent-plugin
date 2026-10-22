// token-store.mjs のテスト(design.md 10 節の TEST-P09・P10)
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync, writeFileSync, utimesSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { keychainStore, secretServiceStore, dpapiStore, fileStore, openStore, createLock, SERVICE, ACCOUNT } from "../token-store.mjs";

const VALUE = { v: 1, refreshToken: "rt-secretsecretsecret", accessToken: "at-secretsecretsecret", expiresAt: 1, scope: "s", savedAt: 1 };
const isPosix = process.platform !== "win32";

let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "edc-store-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** 子プロセスの代わり。引数を記録し、秘密が引数に入らないことを確かめる */
function fakeExec(handler) {
  const calls = [];
  const exec = async (cmd, args, opts = {}) => {
    calls.push({ cmd, args, input: opts.input });
    return handler(cmd, args, opts);
  };
  return { exec, calls };
}
const noSecretInArgs = (calls) => {
  for (const c of calls) assert.ok(!c.args.some((a) => /secret/.test(a) || /^[A-Za-z0-9_-]{60,}$/.test(a)), `引数に秘密: ${c.cmd} ${c.args.join(" ")}`);
};

test("TEST-P09 キーチェーン: 値は security -i の標準入力で渡し、引数に出さない", async () => {
  let kept = null;
  const { exec, calls } = fakeExec((cmd, args, { input }) => {
    assert.equal(cmd, "security");
    if (args[0] === "-i") { kept = input.match(/-w (\S+)\n$/)[1]; return { code: 0, stdout: "" }; }
    if (args[0] === "find-generic-password") return kept ? { code: 0, stdout: `${kept}\n` } : { code: 44, stdout: "" };
    if (args[0] === "delete-generic-password") { kept = null; return { code: 0, stdout: "" }; }
    throw new Error("unexpected");
  });
  const store = keychainStore({ exec });
  assert.equal(store.kind, "keychain");
  assert.equal(await store.read(), null);
  await store.write(VALUE);
  assert.deepEqual(await store.read(), VALUE);
  assert.match(calls[1].input, new RegExp(`^add-generic-password -U -s ${SERVICE} -a ${ACCOUNT} -w [A-Za-z0-9_-]+\\n$`));
  assert.deepEqual(calls[2].args, ["find-generic-password", "-s", SERVICE, "-a", ACCOUNT, "-w"]);
  await store.remove();
  assert.equal(await store.read(), null);
  noSecretInArgs(calls);
});

test("TEST-P09 キーチェーン: 書けなければ誤り", async () => {
  const { exec } = fakeExec(() => ({ code: 1, stdout: "" }));
  await assert.rejects(keychainStore({ exec }).write(VALUE), /キーチェーン/);
});

test("TEST-P09 Secret Service: 値は secret-tool store の標準入力で渡す", async () => {
  let kept = null;
  const { exec, calls } = fakeExec((cmd, args, { input }) => {
    assert.equal(cmd, "secret-tool");
    if (args[0] === "store") { kept = input; return { code: 0, stdout: "" }; }
    if (args[0] === "lookup") return kept ? { code: 0, stdout: kept } : { code: 1, stdout: "" };
    if (args[0] === "clear") { kept = null; return { code: 0, stdout: "" }; }
    throw new Error("unexpected");
  });
  const store = secretServiceStore({ exec });
  await store.write(VALUE);
  assert.deepEqual(await store.read(), VALUE);
  assert.deepEqual(calls[0].args, ["store", "--label=EDC Agent Plugin", "service", SERVICE, "account", ACCOUNT]);
  await store.remove();
  assert.equal(await store.read(), null);
  noSecretInArgs(calls);
});

test("TEST-P09 DPAPI: PowerShell に標準入力で渡し、暗号文だけをファイルに置く", async () => {
  const file = join(dir, "token.dpapi");
  const { exec, calls } = fakeExec((cmd, args, opts) => {
    const { input } = opts;
    assert.equal(cmd, "powershell.exe");
    assert.deepEqual(args.slice(0, 2), ["-NoProfile", "-NonInteractive"]);
    const script = args.at(-1);
    // 暗号化の代わりに base64 にする(実物も ProtectedData の結果を base64 で出す)。PowerShell 7 の PSModulePath は渡さない
    assert.ok(!Object.keys(opts.env ?? {}).some((k) => k.toLowerCase() === "psmodulepath"));
    if (script.includes("::Protect(")) return { code: 0, stdout: `\uFEFF${Buffer.from(input.trim()).toString("base64")}\r\n` };
    return { code: 0, stdout: Buffer.from(input.trim(), "base64").toString("utf8") };
  });
  const store = dpapiStore({ exec, file });
  assert.equal(await store.read(), null);
  await store.write(VALUE);
  assert.match(readFileSync(file, "utf8"), /^[A-Za-z0-9+/]+={0,2}$/);
  assert.ok(!readFileSync(file, "utf8").includes("rt-secret"));
  if (isPosix) assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(await store.read(), VALUE);
  await store.remove();
  assert.equal(existsSync(file), false);
  noSecretInArgs(calls);
});

test("TEST-P09 ファイル: フォルダ 700・ファイル 600", async () => {
  const file = join(dir, "edc", "token.json");
  const store = fileStore({ file });
  assert.equal(await store.read(), null);
  await store.write(VALUE);
  assert.deepEqual(await store.read(), VALUE);
  if (isPosix) {
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.equal(statSync(join(dir, "edc")).mode & 0o777, 0o700);
  }
  await store.remove();
  assert.equal(existsSync(file), false);
  await store.remove(); // ないものを消しても誤りにしない
});

test("TEST-P09 ファイル: 壊れた中身は無いものとして扱う", async () => {
  const file = join(dir, "token.json");
  writeFileSync(file, "not json");
  assert.equal(await fileStore({ file }).read(), null);
});

test("TEST-P09 保存先の選び方", async () => {
  const ok = fakeExec(() => ({ code: 1, stdout: "", stderr: "" }));
  assert.equal((await openStore({ platform: "darwin", dir, exec: ok.exec })).kind, "keychain");
  assert.equal((await openStore({ platform: "win32", dir, exec: ok.exec })).kind, "dpapi");
  assert.equal((await openStore({ platform: "linux", dir, exec: ok.exec })).kind, "secret-service");
  // secret-tool がない・D-Bus がない → ファイル
  const missing = fakeExec(() => { throw Object.assign(new Error("spawn secret-tool ENOENT"), { code: "ENOENT" }); });
  assert.equal((await openStore({ platform: "linux", dir, exec: missing.exec })).kind, "file");
  const noBus = fakeExec(() => ({ code: 1, stdout: "", stderr: "Cannot autolaunch D-Bus without X11 $DISPLAY" }));
  assert.equal((await openStore({ platform: "linux", dir, exec: noBus.exec })).kind, "file");
});

test("TEST-P10 錠: 同時には 1 つだけが中に入る", async () => {
  const lock = createLock({ file: join(dir, "token.lock"), intervalMs: 5 });
  let inside = 0, max = 0;
  const work = () => lock.withLock(async () => {
    inside++; max = Math.max(max, inside);
    await new Promise((r) => setTimeout(r, 20));
    inside--;
  });
  await Promise.all([work(), work(), work()]);
  assert.equal(max, 1);
  assert.equal(existsSync(join(dir, "token.lock")), false);
});

test("TEST-P10 錠: 中で失敗しても外す", async () => {
  const lock = createLock({ file: join(dir, "token.lock") });
  await assert.rejects(lock.withLock(async () => { throw new Error("boom"); }), /boom/);
  assert.equal(existsSync(join(dir, "token.lock")), false);
});

test("TEST-P10 錠: 古い錠(持ち主が落ちた)は消して入る", async () => {
  const file = join(dir, "token.lock");
  writeFileSync(file, "999999");
  const old = new Date(Date.now() - 60_000);
  utimesSync(file, old, old);
  const lock = createLock({ file, staleMs: 30_000, intervalMs: 5 });
  assert.equal(await lock.withLock(async () => "ok"), "ok");
});

test("TEST-P10 錠: 待ち切れなければ誤り", async () => {
  const file = join(dir, "token.lock");
  writeFileSync(file, "1");
  const lock = createLock({ file, staleMs: 60_000, timeoutMs: 50, intervalMs: 5 });
  await assert.rejects(lock.withLock(async () => "never"), /錠/);
});

// 実物の鍵束の往復(CI の各 OS で EDC_TEST_REAL_STORE=1)。手元のキーチェーンに試しの項目を作らないよう、既定では飛ばす
test("TEST-P09 実物の保存先の往復", { skip: process.env.EDC_TEST_REAL_STORE !== "1" }, async () => {
  const store = await openStore({ dir, service: `${SERVICE}-test` });
  console.log(`store: ${store.kind}`);
  await store.write(VALUE);
  assert.deepEqual(await store.read(), VALUE);
  await store.write({ ...VALUE, accessToken: "at-second" });
  assert.equal((await store.read()).accessToken, "at-second");
  await store.remove();
  assert.equal(await store.read(), null);
});
