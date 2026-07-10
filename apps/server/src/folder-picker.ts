import { execFile } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";

export type FolderPickerPlatform = NodeJS.Platform;

type RunnerOptions = {
  env?: NodeJS.ProcessEnv;
  windowsHide?: boolean;
};

export type FolderPickerRunner = (
  command: string,
  args: string[],
  options?: RunnerOptions
) => Promise<{ stdout: string; stderr: string }>;

export type FolderPickerResult = {
  path: string | null;
  cancelled: boolean;
};

type ProcessError = Error & {
  code?: number | string;
  stderr?: string;
};

const pickerPrompt = "Choose a folder for Harness";

export async function selectFolder(
  options: {
    initialPath?: string;
    platform?: FolderPickerPlatform;
    runner?: FolderPickerRunner;
  } = {}
): Promise<FolderPickerResult> {
  const platform = options.platform || process.platform;
  const runner = options.runner || runFile;
  const initialPath = resolveExistingDirectory(options.initialPath);

  if (platform === "darwin") {
    return runMacPicker(runner, initialPath);
  }
  if (platform === "win32") {
    return runWindowsPicker(runner, initialPath);
  }
  if (platform === "linux") {
    return runLinuxPicker(runner, initialPath);
  }

  throw new Error(`Folder selection is not supported on ${platform}.`);
}

async function runMacPicker(runner: FolderPickerRunner, initialPath?: string): Promise<FolderPickerResult> {
  const args = initialPath
    ? [
        "-e",
        "on run argv",
        "-e",
        "set initialPath to item 1 of argv",
        "-e",
        "activate",
        "-e",
        `set selectedFolder to choose folder with prompt \"${pickerPrompt}\" default location POSIX file initialPath`,
        "-e",
        "return POSIX path of selectedFolder",
        "-e",
        "end run",
        initialPath
      ]
    : ["-e", "activate", "-e", `POSIX path of (choose folder with prompt \"${pickerPrompt}\")`];

  try {
    return selectedResult(await runner("osascript", args));
  } catch (error) {
    const processError = error as ProcessError;
    if (processError.stderr?.includes("-128") || /user canceled/i.test(processError.stderr || "")) {
      return { path: null, cancelled: true };
    }
    throw error;
  }
}

async function runWindowsPicker(runner: FolderPickerRunner, initialPath?: string): Promise<FolderPickerResult> {
  const script = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
    `$dialog.Description = '${pickerPrompt}'`,
    "$dialog.ShowNewFolderButton = $true",
    "$initialPath = $env:HARNESS_FOLDER_PICKER_INITIAL",
    "if ($initialPath -and (Test-Path -LiteralPath $initialPath -PathType Container)) { $dialog.SelectedPath = $initialPath }",
    "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {",
    "  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
    "  Write-Output $dialog.SelectedPath",
    "}"
  ].join("\n");
  const result = await runner("powershell.exe", ["-NoProfile", "-STA", "-Command", script], {
    env: {
      ...process.env,
      HARNESS_FOLDER_PICKER_INITIAL: initialPath || ""
    },
    windowsHide: false
  });
  return selectedResult(result);
}

async function runLinuxPicker(runner: FolderPickerRunner, initialPath?: string): Promise<FolderPickerResult> {
  const zenityArgs = ["--file-selection", "--directory", `--title=${pickerPrompt}`];
  if (initialPath) {
    zenityArgs.push(`--filename=${initialPath}${path.sep}`);
  }

  try {
    return selectedResult(await runner("zenity", zenityArgs));
  } catch (error) {
    if (isCancelledProcess(error)) {
      return { path: null, cancelled: true };
    }
    if (!isMissingCommand(error)) {
      throw error;
    }
  }

  const kdialogArgs = ["--getexistingdirectory"];
  if (initialPath) {
    kdialogArgs.push(initialPath);
  }
  kdialogArgs.push("--title", pickerPrompt);

  try {
    return selectedResult(await runner("kdialog", kdialogArgs));
  } catch (error) {
    if (isCancelledProcess(error)) {
      return { path: null, cancelled: true };
    }
    if (isMissingCommand(error)) {
      throw new Error("No Linux folder picker is available. Install zenity or kdialog and try again.");
    }
    throw error;
  }
}

function selectedResult(result: { stdout: string }): FolderPickerResult {
  const selectedPath = result.stdout.trim();
  if (!selectedPath) {
    return { path: null, cancelled: true };
  }
  const resolvedPath = path.resolve(selectedPath);
  if (!isDirectory(resolvedPath)) {
    throw new Error("The selected folder is not available on disk.");
  }
  return { path: resolvedPath, cancelled: false };
}

function resolveExistingDirectory(candidate?: string) {
  if (!candidate) {
    return undefined;
  }
  const resolvedPath = path.resolve(candidate);
  return isDirectory(resolvedPath) ? resolvedPath : undefined;
}

function isDirectory(candidate: string) {
  try {
    return existsSync(candidate) && statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

function isCancelledProcess(error: unknown) {
  return (error as ProcessError).code === 1;
}

function isMissingCommand(error: unknown) {
  return (error as ProcessError).code === "ENOENT";
}

function runFile(command: string, args: string[], options: RunnerOptions = {}) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    execFile(
      command,
      args,
      {
        encoding: "utf8",
        env: options.env,
        windowsHide: options.windowsHide
      },
      (error, stdout, stderr) => {
        if (error) {
          Object.assign(error, { stderr });
          reject(error);
          return;
        }
        resolve({ stdout, stderr });
      }
    );
  });
}
