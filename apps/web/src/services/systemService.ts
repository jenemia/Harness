import { api } from "../api/client";
import type { FolderPickerResult } from "../api/contracts";
import { desktopOrHttp } from "../api/desktop";

export const systemService = {
  selectFolder: (initialPath: string) => desktopOrHttp("system:select-folder", { initialPath: initialPath || undefined }, () =>
    api<FolderPickerResult>("/api/system/select-folder", {
      method: "POST",
      body: JSON.stringify({ initialPath: initialPath || undefined }),
    })),
};
