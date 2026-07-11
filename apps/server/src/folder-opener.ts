import { existsSync, statSync } from "node:fs";
import { spawn } from "node:child_process";

export type FolderOpenRunner = (executable: string, args: string[]) => Promise<number | null>;

export async function openLocalFolder(
  folderPath: string,
  platform: NodeJS.Platform = process.platform,
  runner: FolderOpenRunner = runFolderOpenCommand
) {
  if (!existsSync(folderPath) || !statSync(folderPath).isDirectory()) throw new Error("Agent folder does not exist.");
  const command = platform === "darwin"
    ? { executable: "open", args: [folderPath] }
    : platform === "win32"
      ? { executable: "explorer.exe", args: [folderPath] }
      : platform === "linux"
        ? { executable: "xdg-open", args: [folderPath] }
        : null;
  if (!command) throw new Error(`Opening agent folders is unavailable on ${platform}.`);
  const code = await runner(command.executable, command.args);
  if (code !== 0) throw new Error("The operating system could not open the agent folder.");
  return { opened: true, folderPath };
}

function runFolderOpenCommand(executable: string, args: string[]) {
  return new Promise<number | null>((resolve, reject) => {
    const child = spawn(executable, args, { detached: true, stdio: "ignore", windowsHide: true });
    child.once("error", () => reject(new Error("The operating system folder opener is unavailable.")));
    child.once("spawn", () => {
      child.unref();
      resolve(0);
    });
  });
}
