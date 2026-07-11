import { Archive, ArrowDown, ArrowUp, Copy, Eye, FolderOpen, Plus, RefreshCw, Save, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Agent, Overview, ProviderCatalog } from "../../api/contracts";
import { agentService, type AgentDocumentBundle, type AgentInstructionDocument } from "../../services/agentService";
import { buildLineDiff, parseAgentMarkdownDraft, type ParsedAgentMarkdownDraft, updateAgentMarkdownDraft } from "./agentMarkdownDraft";

type ValidationState = { status: "idle" | "pending" | "valid" | "invalid"; message: string };
export function AgentMarkdownEditor(props: {
  overview: Overview;
  providerCatalog: ProviderCatalog | null;
  bundle: AgentDocumentBundle;
  runAction: (action: () => Promise<void>) => Promise<void>;
  onBundleChanged: (bundle: AgentDocumentBundle) => void;
  onClose: () => void;
  onProjectChanged: () => Promise<void>;
}) {
  const projectId = props.overview.project.id;
  const agentId = props.bundle.agent.id;
  const initialSource = props.bundle.source;
  const [baseRaw, setBaseRaw] = useState(initialSource?.raw || "");
  const [baseHash, setBaseHash] = useState(initialSource?.hash || "");
  const [draftRaw, setDraftRaw] = useState(initialSource?.raw || "");
  const [validation, setValidation] = useState<ValidationState>(() => props.bundle.validation.valid
    ? { status: "valid", message: "Markdown and instruction references are valid." }
    : { status: "invalid", message: props.bundle.validation.error || "Agent Markdown is invalid." });
  const [selectedInstructionPath, setSelectedInstructionPath] = useState(props.bundle.instructions[0]?.path || "");
  const [instructionContent, setInstructionContent] = useState(props.bundle.instructions[0]?.content || "");
  const [instructionName, setInstructionName] = useState("");
  const [renameInstructionName, setRenameInstructionName] = useState("");
  const [archiveReplacement, setArchiveReplacement] = useState("");

  const parsed = useMemo(() => {
    try {
      return { value: parseAgentMarkdownDraft(draftRaw), error: "" };
    } catch (error) {
      return { value: null, error: error instanceof Error ? error.message : String(error) };
    }
  }, [draftRaw]);
  const dirty = draftRaw !== baseRaw;
  const diff = useMemo(() => buildLineDiff(baseRaw, draftRaw), [baseRaw, draftRaw]);
  const selectedInstruction = props.bundle.instructions.find((item) => item.path === selectedInstructionPath) || null;
  const assignedOpenTasks = props.overview.tasks.filter((task) => task.assigneeAgentId === agentId && task.status !== "Done");
  const replacementAgents = props.overview.agents.filter((agent) => agent.id !== agentId && !agent.archivedAt && agent.enabled);

  useEffect(() => {
    const source = props.bundle.source;
    if (!source) return;
    setBaseRaw(source.raw);
    setBaseHash(source.hash);
    setDraftRaw(source.raw);
    setValidation(props.bundle.validation.valid
      ? { status: "valid", message: "Markdown and instruction references are valid." }
      : { status: "invalid", message: props.bundle.validation.error || "Agent Markdown is invalid." });
  }, [props.bundle.agent.id, props.bundle.source?.hash]);

  useEffect(() => {
    const selected = props.bundle.instructions.find((item) => item.path === selectedInstructionPath) || props.bundle.instructions[0] || null;
    setSelectedInstructionPath(selected?.path || "");
    setInstructionContent(selected?.content || "");
  }, [props.bundle.instructions]);

  useEffect(() => {
    if (!initialSource) return;
    if (!dirty) {
      setValidation(props.bundle.validation.valid
        ? { status: "valid", message: "Markdown and instruction references are valid." }
        : { status: "invalid", message: props.bundle.validation.error || "Agent Markdown is invalid." });
      return;
    }
    if (parsed.error) {
      setValidation({ status: "invalid", message: parsed.error });
      return;
    }
    setValidation({ status: "pending", message: "Validating Markdown and instruction references…" });
    let active = true;
    const timeout = window.setTimeout(() => {
      void agentService.previewRaw(projectId, agentId, draftRaw).then(() => {
        if (active) setValidation({ status: "valid", message: "Markdown and instruction references are valid." });
      }).catch((error) => {
        if (active) setValidation({ status: "invalid", message: error instanceof Error ? error.message : String(error) });
      });
    }, 300);
    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [agentId, draftRaw, dirty, initialSource, parsed.error, projectId, props.bundle.validation.error, props.bundle.validation.valid]);

  function updateStructured(patch: Partial<ParsedAgentMarkdownDraft>) {
    try {
      setDraftRaw(updateAgentMarkdownDraft(draftRaw, patch));
    } catch (error) {
      setValidation({ status: "invalid", message: error instanceof Error ? error.message : String(error) });
    }
  }

  async function reloadBundle() {
    const bundle = await agentService.get(projectId, agentId);
    props.onBundleChanged(bundle);
    return bundle;
  }

  async function saveRaw() {
    await props.runAction(async () => {
      const bundle = await agentService.saveRaw(projectId, agentId, draftRaw, baseHash);
      props.onBundleChanged(bundle);
      setBaseRaw(bundle.source?.raw || draftRaw);
      setBaseHash(bundle.source?.hash || "");
      setDraftRaw(bundle.source?.raw || draftRaw);
      await props.onProjectChanged();
    });
  }

  async function resetDraft() {
    const bundle = await reloadBundle();
    setBaseRaw(bundle.source?.raw || "");
    setBaseHash(bundle.source?.hash || "");
    setDraftRaw(bundle.source?.raw || "");
    setValidation(bundle.validation.valid
      ? { status: "valid", message: "Markdown and instruction references are valid." }
      : { status: "invalid", message: bundle.validation.error || "Agent Markdown is invalid." });
  }

  async function saveInstruction() {
    await props.runAction(async () => {
      await agentService.saveInstruction(projectId, agentId, {
        instructionPath: selectedInstruction?.path,
        name: selectedInstruction ? undefined : instructionName,
        content: instructionContent,
        expectedDefinitionHash: baseHash,
        expectedInstructionHash: selectedInstruction?.hash,
      });
      const bundle = await reloadBundle();
      const next = selectedInstruction
        ? bundle.instructions.find((item) => item.path === selectedInstruction.path)
        : bundle.instructions.at(-1);
      setSelectedInstructionPath(next?.path || "");
      setInstructionContent(next?.content || "");
      setInstructionName("");
      await props.onProjectChanged();
    });
  }

  async function renameInstruction() {
    if (!selectedInstruction) return;
    await props.runAction(async () => {
      await agentService.renameInstruction(projectId, agentId, {
        instructionPath: selectedInstruction.path,
        name: renameInstructionName,
        expectedDefinitionHash: baseHash,
        expectedInstructionHash: selectedInstruction.hash,
      });
      const bundle = await reloadBundle();
      const renamed = bundle.instructions.find((item) => item.content === selectedInstruction.content);
      setSelectedInstructionPath(renamed?.path || bundle.instructions[0]?.path || "");
      setRenameInstructionName("");
      await props.onProjectChanged();
    });
  }

  async function removeInstruction() {
    if (!selectedInstruction) return;
    await props.runAction(async () => {
      await agentService.removeInstruction(projectId, agentId, {
        instructionPath: selectedInstruction.path,
        expectedDefinitionHash: baseHash,
        expectedInstructionHash: selectedInstruction.hash,
      });
      const bundle = await reloadBundle();
      setSelectedInstructionPath(bundle.instructions[0]?.path || "");
      setInstructionContent(bundle.instructions[0]?.content || "");
      await props.onProjectChanged();
    });
  }

  async function moveInstruction(direction: -1 | 1) {
    if (!selectedInstruction) return;
    const paths = props.bundle.instructions.map((item) => item.path);
    const index = paths.indexOf(selectedInstruction.path);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= paths.length) return;
    [paths[index], paths[nextIndex]] = [paths[nextIndex], paths[index]];
    await props.runAction(async () => {
      await agentService.reorderInstructions(projectId, agentId, { instructionPaths: paths, expectedDefinitionHash: baseHash });
      await reloadBundle();
      await props.onProjectChanged();
    });
  }

  async function cloneAgent() {
    await props.runAction(async () => {
      await agentService.clone(projectId, agentId, { name: `${parsed.value?.name || props.bundle.agent.name} Copy`, enabled: false });
      await props.onProjectChanged();
    });
  }

  async function archiveAgent() {
    await props.runAction(async () => {
      const payload: { expectedHash: string; reassignToAgentId?: string | null } = { expectedHash: baseHash };
      if (assignedOpenTasks.length > 0) {
        if (!archiveReplacement) throw new Error("Choose a replacement agent or explicitly unassign open tasks.");
        payload.reassignToAgentId = archiveReplacement === "__unassign__" ? null : archiveReplacement;
      }
      await agentService.archive(projectId, agentId, payload);
      props.onClose();
      await props.onProjectChanged();
    });
  }

  async function openFolder() {
    await props.runAction(async () => {
      await agentService.openFolder(projectId, agentId);
    });
  }

  if (!props.bundle.source) {
    return (
      <div className="agent-editor-card archived">
        <div className="agent-editor-toolbar">
          <strong>{props.bundle.agent.name}</strong>
          <button className="mini-button" type="button" onClick={props.onClose}><X size={14} /> Close</button>
        </div>
        <p>This agent is archived at {props.bundle.agent.archivePath || props.bundle.folderPath || "the project archive"}.</p>
        <button className="secondary-button" type="button" onClick={() => void openFolder()}><FolderOpen size={15} /> Open archive folder</button>
      </div>
    );
  }

  return (
    <div className="agent-editor-card" data-testid="agent-markdown-editor">
      <div className="agent-editor-toolbar">
        <div>
          <strong>{parsed.value?.name || props.bundle.agent.name}</strong>
          <span>{props.bundle.source.relativePath} · {baseHash.slice(0, 10)}</span>
        </div>
        <div className="inline-actions">
          <button className="mini-button" type="button" onClick={() => void openFolder()}><FolderOpen size={14} /> Folder</button>
          <button className="mini-button" type="button" onClick={() => void cloneAgent()}><Copy size={14} /> Clone</button>
          <button className="mini-button" type="button" onClick={props.onClose}><X size={14} /> Close</button>
        </div>
      </div>

      <div className="agent-editor-grid">
        <section className="agent-structured-editor">
          <h3>Structured form</h3>
          <input aria-label="Agent editor name" value={parsed.value?.name || ""} disabled={!parsed.value} onChange={(event) => updateStructured({ name: event.target.value })} />
          <select aria-label="Agent editor role" value={parsed.value?.role || "worker"} disabled={!parsed.value} onChange={(event) => updateStructured({ role: event.target.value })}>
            <option value="worker">worker</option><option value="programmer">programmer</option><option value="reviewer">reviewer</option><option value="project-manager">project-manager</option>
          </select>
          <select aria-label="Agent editor provider" value={parsed.value?.modelBackend || "mock"} disabled={!parsed.value} onChange={(event) => updateStructured({ modelBackend: event.target.value })}>
            {(props.providerCatalog?.llmProviders || [{ id: "mock", label: "Mock" }]).map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}
          </select>
          <input aria-label="Agent editor max parallel" type="number" min={1} max={8} value={parsed.value?.maxParallel || 1} disabled={!parsed.value} onChange={(event) => updateStructured({ maxParallel: Math.max(1, Number(event.target.value || 1)) })} />
          <label className="checkbox-row"><input type="checkbox" checked={parsed.value?.enabled || false} disabled={!parsed.value} onChange={(event) => updateStructured({ enabled: event.target.checked })} /><span>Enabled for new runs</span></label>
          <textarea aria-label="Agent editor persona" value={parsed.value?.persona || ""} disabled={!parsed.value} onChange={(event) => updateStructured({ persona: event.target.value })} placeholder="Persona" />
          <input aria-label="Agent editor capabilities" value={(parsed.value?.capabilities || []).join(", ")} disabled={!parsed.value} onChange={(event) => updateStructured({ capabilities: parseList(event.target.value) })} placeholder="Capabilities" />
          <input aria-label="Agent editor allowed tools" value={(parsed.value?.allowedTools || []).join(", ")} disabled={!parsed.value} onChange={(event) => updateStructured({ allowedTools: parseList(event.target.value) })} placeholder="Allowed tools" />
          <textarea aria-label="Agent editor boundaries" value={parsed.value?.boundaries || ""} disabled={!parsed.value} onChange={(event) => updateStructured({ boundaries: event.target.value })} placeholder="Boundaries" />
          <input aria-label="Agent editor CLI command" value={parsed.value?.cliCommand || ""} disabled={!parsed.value} onChange={(event) => updateStructured({ cliCommand: event.target.value })} placeholder="CLI command" />
        </section>
        <section className="agent-raw-editor">
          <h3>Raw agent.md</h3>
          <textarea aria-label="Raw agent Markdown" value={draftRaw} onChange={(event) => setDraftRaw(event.target.value)} spellCheck={false} />
        </section>
      </div>

      <div className={`agent-validation ${validation.status}`} role="status">
        <strong>{validation.status === "valid" ? "Valid" : validation.status === "pending" ? "Validating" : "Validation error"}</strong>
        <span>{validation.message}</span>
      </div>

      <div className="agent-result-grid">
        <section>
          <h3>Change result</h3>
          <pre className="agent-diff" aria-label="Agent Markdown diff">{diff.map((line, index) => <span className={`diff-${line.kind}`} key={`${index}-${line.text}`}>{line.kind === "add" ? "+ " : line.kind === "remove" ? "- " : "  "}{line.text}{"\n"}</span>)}</pre>
        </section>
        <section>
          <h3><Eye size={14} /> Persona preview</h3>
          <div className="markdown-preview">{parsed.value?.persona || "No valid Persona section to preview."}</div>
          <h3>Instruction preview</h3>
          <div className="markdown-preview">{selectedInstruction?.content || "Select or create an instruction file."}</div>
        </section>
      </div>

      <div className="agent-editor-actions">
        <button className="secondary-button" type="button" disabled={!dirty} onClick={() => void resetDraft()}><RefreshCw size={15} /> Reload</button>
        <button className="primary-button" type="button" disabled={!dirty || validation.status !== "valid"} onClick={() => void saveRaw()}><Save size={15} /> Save Markdown</button>
      </div>

      <section className="agent-instruction-editor">
        <h3>Instruction files</h3>
        <div className="instruction-controls">
          <select aria-label="Instruction file" value={selectedInstructionPath} onChange={(event) => {
            const selected = props.bundle.instructions.find((item) => item.path === event.target.value) || null;
            setSelectedInstructionPath(selected?.path || "");
            setInstructionContent(selected?.content || "");
          }}>
            <option value="">New instruction</option>
            {props.bundle.instructions.map((item) => <option key={item.path} value={item.path}>{item.path}</option>)}
          </select>
          {!selectedInstruction && <input aria-label="New instruction name" value={instructionName} onChange={(event) => setInstructionName(event.target.value)} placeholder="instruction-name" />}
          <textarea aria-label="Instruction Markdown" value={instructionContent} onChange={(event) => setInstructionContent(event.target.value)} placeholder="Instruction Markdown" />
          <div className="inline-actions">
            <button className="mini-button" type="button" disabled={dirty || (!selectedInstruction && !instructionName.trim())} onClick={() => void saveInstruction()}><Save size={14} /> Save</button>
            <button className="mini-button" type="button" disabled={dirty || !selectedInstruction} onClick={() => void moveInstruction(-1)}><ArrowUp size={14} /> Up</button>
            <button className="mini-button" type="button" disabled={dirty || !selectedInstruction} onClick={() => void moveInstruction(1)}><ArrowDown size={14} /> Down</button>
          </div>
          {selectedInstruction && <div className="instruction-rename-row">
            <input aria-label="Rename instruction" value={renameInstructionName} onChange={(event) => setRenameInstructionName(event.target.value)} placeholder="new-name" />
            <button className="mini-button" type="button" disabled={dirty || !renameInstructionName.trim()} onClick={() => void renameInstruction()}>Rename</button>
            <button className="mini-button danger" type="button" disabled={dirty} onClick={() => void removeInstruction()}><Trash2 size={14} /> Remove</button>
          </div>}
        </div>
      </section>

      <section className="agent-archive-controls">
        <h3>Archive agent</h3>
        {assignedOpenTasks.length > 0 && <select aria-label="Archive replacement agent" value={archiveReplacement} onChange={(event) => setArchiveReplacement(event.target.value)}>
          <option value="">Choose reassignment</option>
          <option value="__unassign__">Explicitly unassign open tasks</option>
          {replacementAgents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
        </select>}
        <span>{assignedOpenTasks.length} open assigned task(s); active runs are always blocked by the service.</span>
        <button className="secondary-button danger" type="button" disabled={dirty || (assignedOpenTasks.length > 0 && !archiveReplacement)} onClick={() => void archiveAgent()}><Archive size={15} /> Archive</button>
      </section>
    </div>
  );
}

function parseList(value: string) {
  return Array.from(new Set(value.split(",").map((item) => item.trim()).filter(Boolean)));
}
