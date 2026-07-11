import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { openLocalFolder } from "../src/folder-opener.js";

test("agent folder opener uses the platform command without shell interpolation", async () => {
  const folder = mkdtempSync(path.join(tmpdir(), "harness-open-folder-"));
  try {
    for (const [platform, executable] of [["darwin", "open"], ["win32", "explorer.exe"], ["linux", "xdg-open"]] as const) {
      const calls: Array<{ executable: string; args: string[] }> = [];
      const result = await openLocalFolder(folder, platform, async (command, args) => {
        calls.push({ executable: command, args });
        return 0;
      });
      assert.equal(result.opened, true);
      assert.deepEqual(calls, [{ executable, args: [folder] }]);
    }
    await assert.rejects(() => openLocalFolder(path.join(folder, "missing"), "darwin", async () => 0), /does not exist/);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
