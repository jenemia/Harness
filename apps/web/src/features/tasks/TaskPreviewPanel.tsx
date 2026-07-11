import { ExternalLink, FolderOpen, Monitor, Play, Plus, RefreshCw, Square, Trash2 } from "lucide-react";
import { FormEvent, useState } from "react";
import type { Approval, Preview, Task } from "../../api/contracts";
import { previewService, type PreviewRegistration } from "../../services/previewService";

export function TaskPreviewPanel(props: {
  projectId: string;
  task: Task;
  previews: Preview[];
  approvals: Approval[];
  runAction: (action: () => Promise<void>) => Promise<void>;
  onChanged: () => Promise<void>;
}) {
  const [showForm, setShowForm] = useState(false);
  const [label, setLabel] = useState("Preview");
  const [runtime, setRuntime] = useState<Preview["runtime"]>("artifact");
  const [executable, setExecutable] = useState("pnpm");
  const [argsText, setArgsText] = useState('["dev"]');
  const [packageRoot, setPackageRoot] = useState(".");
  const [composeFile, setComposeFile] = useState("compose.yaml");
  const [service, setService] = useState("");
  const [artifactPath, setArtifactPath] = useState("");
  const [readinessUrl, setReadinessUrl] = useState("");
  const [environmentKeys, setEnvironmentKeys] = useState("");

  function changeRuntime(nextRuntime: Preview["runtime"]) {
    setRuntime(nextRuntime);
    if (runtime === "artifact" && nextRuntime !== "artifact") setArtifactPath("");
  }

  function resetForm() {
    setLabel("Preview");
    setRuntime("artifact");
    setExecutable("pnpm");
    setArgsText('["dev"]');
    setPackageRoot(".");
    setComposeFile("compose.yaml");
    setService("");
    setArtifactPath("");
    setReadinessUrl("");
    setEnvironmentKeys("");
  }

  async function register(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      const args = runtime === "local" ? JSON.parse(argsText || "[]") : [];
      if (!Array.isArray(args) || args.some((item) => typeof item !== "string")) throw new Error("Arguments must be a JSON string array.");
      const payload: PreviewRegistration = {
        label,
        runtime,
        packageRoot,
        artifactPath: artifactPath || undefined,
        readinessUrl: readinessUrl || undefined,
        environmentKeys: environmentKeys.split(",").map((item) => item.trim()).filter(Boolean),
        ...(runtime === "local" ? { executable, args } : {}),
        ...(runtime === "docker-compose" ? { composeFile, service } : {})
      };
      await previewService.register(props.projectId, props.task.id, payload);
      resetForm();
      setShowForm(false);
    });
  }

  async function run(action: () => Promise<void>) {
    await props.runAction(async () => {
      await action();
      await props.onChanged();
    });
  }

  return (
    <section className="drawer-section preview-section" aria-label="Task previews">
      <div className="preview-heading">
        <h3>Preview</h3>
        <button className="mini-button" type="button" onClick={() => setShowForm((value) => !value)}><Plus size={14} /> Register</button>
      </div>
      {showForm && <form className="preview-register-form" onSubmit={(event) => void register(event)}>
        <input aria-label="Preview label" value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Preview label" />
        <select aria-label="Preview runtime" value={runtime} onChange={(event) => changeRuntime(event.target.value as Preview["runtime"])}>
          <option value="artifact">Artifact</option><option value="local">Local command</option><option value="docker-compose">Docker Compose</option>
        </select>
        <input aria-label="Preview package root" value={packageRoot} onChange={(event) => setPackageRoot(event.target.value)} placeholder="Package root" />
        {runtime === "local" && <><input aria-label="Preview executable" value={executable} onChange={(event) => setExecutable(event.target.value)} placeholder="Executable" /><input aria-label="Preview arguments" value={argsText} onChange={(event) => setArgsText(event.target.value)} placeholder='["dev"]' /></>}
        {runtime === "docker-compose" && <><input aria-label="Preview compose file" value={composeFile} onChange={(event) => setComposeFile(event.target.value)} placeholder="compose.yaml" /><input aria-label="Preview compose service" value={service} onChange={(event) => setService(event.target.value)} placeholder="Service" /></>}
        <input aria-label="Preview artifact path" value={artifactPath} onChange={(event) => setArtifactPath(event.target.value)} placeholder="Optional artifact path" />
        {runtime !== "artifact" && <><input aria-label="Preview readiness URL" value={readinessUrl} onChange={(event) => setReadinessUrl(event.target.value)} placeholder="http://127.0.0.1:4173/" /><input aria-label="Preview environment keys" value={environmentKeys} onChange={(event) => setEnvironmentKeys(event.target.value)} placeholder="PORT, NODE_ENV" /></>}
        <button className="primary-button" type="submit">Register preview</button>
      </form>}
      {props.previews.length === 0 ? <p className="drawer-copy">No explicit preview is registered.</p> : <div className="preview-list">
        {props.previews.map((preview) => {
          const approval = preview.approvalId ? props.approvals.find((item) => item.id === preview.approvalId) : null;
          const canStart = preview.runtime === "artifact" || approval?.status === "approved";
          return <article className={`preview-item status-${preview.status}`} key={preview.id}>
            <div className="preview-item-top"><strong><Monitor size={14} /> {preview.label}</strong><span className={`preview-status ${preview.status}`}>{preview.status}</span></div>
            <span>{preview.runtime} · {preview.packageRoot}{preview.pid ? ` · PID ${preview.pid}` : ""}</span>
            {preview.commandPreview && <code>{preview.commandPreview}</code>}
            {preview.readinessUrl && <span>{preview.readinessUrl}</span>}
            {preview.artifactPath && <span>{preview.artifactPath}</span>}
            {approval && approval.status !== "approved" && <span className="preview-approval">Approval {approval.status}</span>}
            {preview.lastError && <span className="preview-error">{preview.lastError}</span>}
            {preview.logTail && <pre aria-label={`${preview.label} preview log`}>{preview.logTail}</pre>}
            <div className="inline-actions">
              <button className="mini-button" type="button" disabled={!canStart || preview.status === "booting" || preview.status === "live"} onClick={() => void run(() => previewService.start(props.projectId, preview.id).then(() => undefined))}><Play size={13} /> Start</button>
              <button className="mini-button" type="button" disabled={preview.status === "stopped"} onClick={() => void run(() => previewService.stop(props.projectId, preview.id).then(() => undefined))}><Square size={13} /> Stop</button>
              <button className="mini-button" type="button" disabled={!canStart} onClick={() => void run(() => previewService.restart(props.projectId, preview.id).then(() => undefined))}><RefreshCw size={13} /> Restart</button>
              {preview.artifactPath && <button className="mini-button" type="button" onClick={() => void run(() => previewService.open(props.projectId, preview.id, "artifact").then(() => undefined))}><FolderOpen size={13} /> Artifact</button>}
              {preview.readinessUrl && <button className="mini-button" type="button" disabled={preview.status !== "live"} onClick={() => void run(() => previewService.open(props.projectId, preview.id, "url").then(() => undefined))}><ExternalLink size={13} /> URL</button>}
              <button className="mini-button danger" type="button" disabled={preview.status !== "stopped"} onClick={() => void run(() => previewService.remove(props.projectId, preview.id).then(() => undefined))}><Trash2 size={13} /> Remove</button>
            </div>
          </article>;
        })}
      </div>}
    </section>
  );
}
