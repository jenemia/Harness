import { api } from "../api/client";
import type { FolderPickerResult } from "../api/contracts";

export const systemService = {
  selectFolder: (initialPath: string) =>
    api<FolderPickerResult>("/api/system/select-folder", {
      method: "POST",
      body: JSON.stringify({ initialPath: initialPath || undefined }),
    }),
};
