import { spawn } from "node:child_process";

export type CredentialCommandResult = {
  code: number | null;
  stdout: string;
};

export type CredentialCommandRunner = (
  executable: string,
  args: string[],
  input?: string
) => Promise<CredentialCommandResult>;

export type OsCredentialStore = {
  platform: NodeJS.Platform;
  set(reference: string, secret: string): Promise<void>;
  get(reference: string): Promise<string | null>;
  delete(reference: string): Promise<void>;
};

const serviceName = "Harness OAuth";

export function createOsCredentialStore(
  platform: NodeJS.Platform = process.platform,
  runner: CredentialCommandRunner = runCredentialCommand
): OsCredentialStore {
  if (platform === "darwin") return createMacOsCredentialStore(runner);
  if (platform === "win32") return createWindowsCredentialStore(runner);
  if (platform === "linux") return createLinuxCredentialStore(runner);
  throw new Error(`Harness OAuth credential storage is unavailable on ${platform}.`);
}

function createMacOsCredentialStore(runner: CredentialCommandRunner): OsCredentialStore {
  return {
    platform: "darwin",
    async set(reference, secret) {
      assertCredentialReference(reference);
      const result = await runner("/bin/sh", [
        "-c",
        'secret=$(cat); exec /usr/bin/security add-generic-password -a "$1" -s "$2" -U -w "$secret"',
        "harness-keychain",
        reference,
        serviceName
      ], secret);
      assertCredentialCommandSucceeded(result);
    },
    async get(reference) {
      assertCredentialReference(reference);
      const result = await runner("/usr/bin/security", ["find-generic-password", "-a", reference, "-s", serviceName, "-w"]);
      return result.code === 0 ? result.stdout.replace(/\r?\n$/, "") : null;
    },
    async delete(reference) {
      assertCredentialReference(reference);
      const result = await runner("/usr/bin/security", ["delete-generic-password", "-a", reference, "-s", serviceName]);
      if (result.code !== 0 && result.code !== 44) assertCredentialCommandSucceeded(result);
    }
  };
}

function createWindowsCredentialStore(runner: CredentialCommandRunner): OsCredentialStore {
  const prefix = '[Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime] > $null; $vault = New-Object Windows.Security.Credentials.PasswordVault; ';
  return {
    platform: "win32",
    async set(reference, secret) {
      assertCredentialReference(reference);
      const script = `${prefix}$secret = [Console]::In.ReadToEnd(); $credential = New-Object Windows.Security.Credentials.PasswordCredential($args[0], $args[1], $secret); $vault.Add($credential);`;
      assertCredentialCommandSucceeded(await runner("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script, serviceName, reference], secret));
    },
    async get(reference) {
      assertCredentialReference(reference);
      const script = `${prefix}try { $credential = $vault.Retrieve($args[0], $args[1]); $credential.RetrievePassword(); [Console]::Out.Write($credential.Password) } catch { exit 1 }`;
      const result = await runner("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script, serviceName, reference]);
      return result.code === 0 ? result.stdout : null;
    },
    async delete(reference) {
      assertCredentialReference(reference);
      const script = `${prefix}try { $credential = $vault.Retrieve($args[0], $args[1]); $vault.Remove($credential) } catch { exit 0 }`;
      assertCredentialCommandSucceeded(await runner("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script, serviceName, reference]));
    }
  };
}

function createLinuxCredentialStore(runner: CredentialCommandRunner): OsCredentialStore {
  return {
    platform: "linux",
    async set(reference, secret) {
      assertCredentialReference(reference);
      assertCredentialCommandSucceeded(await runner("secret-tool", ["store", "--label=Harness OAuth", "service", serviceName, "account", reference], secret));
    },
    async get(reference) {
      assertCredentialReference(reference);
      const result = await runner("secret-tool", ["lookup", "service", serviceName, "account", reference]);
      return result.code === 0 ? result.stdout.replace(/\r?\n$/, "") : null;
    },
    async delete(reference) {
      assertCredentialReference(reference);
      const result = await runner("secret-tool", ["clear", "service", serviceName, "account", reference]);
      if (result.code !== 0 && result.code !== 1) assertCredentialCommandSucceeded(result);
    }
  };
}

function assertCredentialReference(reference: string) {
  if (!/^[A-Za-z0-9._:-]{1,200}$/.test(reference)) throw new Error("Invalid OAuth credential reference.");
}

function assertCredentialCommandSucceeded(result: CredentialCommandResult) {
  if (result.code !== 0) throw new Error("The operating system credential store operation failed.");
}

function runCredentialCommand(executable: string, args: string[], input = "") {
  return new Promise<CredentialCommandResult>((resolve, reject) => {
    const child = spawn(executable, args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout = `${stdout}${chunk}`.slice(0, 1_000_000); });
    child.stderr.resume();
    child.once("error", () => reject(new Error("The operating system credential store is unavailable.")));
    child.once("close", (code) => resolve({ code, stdout }));
    child.stdin.end(input);
  });
}
