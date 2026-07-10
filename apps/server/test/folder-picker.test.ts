import assert from "node:assert/strict";
import test from "node:test";
import { selectFolder, type FolderPickerRunner } from "../src/folder-picker.js";

test("macOS picker passes an existing initial folder as an AppleScript argument", async () => {
  let receivedCommand = "";
  let receivedArgs: string[] = [];
  const runner: FolderPickerRunner = async (command, args) => {
    receivedCommand = command;
    receivedArgs = args;
    return { stdout: `${process.cwd()}\n`, stderr: "" };
  };

  const result = await selectFolder({ initialPath: process.cwd(), platform: "darwin", runner });

  assert.equal(receivedCommand, "osascript");
  assert.ok(receivedArgs.includes("activate"));
  assert.equal(receivedArgs.at(-1), process.cwd());
  assert.deepEqual(result, { path: process.cwd(), cancelled: false });
});

test("macOS picker treats the standard AppleScript cancel error as cancellation", async () => {
  const runner: FolderPickerRunner = async () => {
    throw Object.assign(new Error("cancelled"), { code: 1, stderr: "execution error: User canceled. (-128)" });
  };

  const result = await selectFolder({ platform: "darwin", runner });

  assert.deepEqual(result, { path: null, cancelled: true });
});

test("Windows picker uses the STA PowerShell folder dialog", async () => {
  let receivedCommand = "";
  let receivedArgs: string[] = [];
  let receivedInitialPath = "";
  const runner: FolderPickerRunner = async (command, args, options) => {
    receivedCommand = command;
    receivedArgs = args;
    receivedInitialPath = options?.env?.HARNESS_FOLDER_PICKER_INITIAL || "";
    return { stdout: process.cwd(), stderr: "" };
  };

  const result = await selectFolder({ initialPath: process.cwd(), platform: "win32", runner });

  assert.equal(receivedCommand, "powershell.exe");
  assert.ok(receivedArgs.includes("-STA"));
  assert.equal(receivedInitialPath, process.cwd());
  assert.deepEqual(result, { path: process.cwd(), cancelled: false });
});

test("Linux picker falls back from zenity to kdialog", async () => {
  const commands: string[] = [];
  const runner: FolderPickerRunner = async (command) => {
    commands.push(command);
    if (command === "zenity") {
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    }
    return { stdout: process.cwd(), stderr: "" };
  };

  const result = await selectFolder({ platform: "linux", runner });

  assert.deepEqual(commands, ["zenity", "kdialog"]);
  assert.deepEqual(result, { path: process.cwd(), cancelled: false });
});

test("Linux picker preserves cancellation without opening a second dialog", async () => {
  const commands: string[] = [];
  const runner: FolderPickerRunner = async (command) => {
    commands.push(command);
    throw Object.assign(new Error("cancelled"), { code: 1 });
  };

  const result = await selectFolder({ platform: "linux", runner });

  assert.deepEqual(commands, ["zenity"]);
  assert.deepEqual(result, { path: null, cancelled: true });
});
