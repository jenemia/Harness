import { Brain } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import type { MemoryRecord, Overview } from "../../api/contracts";
import { memoryService } from "../../services/contentService";

export function MemoryPanel(props: {
  overview: Overview;
  runAction: (action: () => Promise<void>) => Promise<void>;
  onChanged: () => Promise<void>;
}) {
  const [scope, setScope] = useState<"project" | "global">("project");
  const [selectedMemoryId, setSelectedMemoryId] = useState("");
  const memories =
    scope === "project"
      ? props.overview.memories
      : props.overview.globalMemories;
  const selected =
    memories.find((memory) => memory.id === selectedMemoryId) || null;

  return (
    <section className="rail-panel">
      <div className="panel-header">
        <Brain size={17} />
        <h2>Memory</h2>
      </div>
      <MemoryEditor
        projectId={props.overview.project.id}
        scope={scope}
        onScopeChange={(nextScope) => {
          setScope(nextScope);
          setSelectedMemoryId("");
        }}
        memory={selected}
        memories={memories}
        onSelect={setSelectedMemoryId}
        runAction={props.runAction}
        onChanged={props.onChanged}
      />
    </section>
  );
}

export function MemoryEditor(props: {
  projectId: string;
  scope: "project" | "global";
  onScopeChange: (scope: "project" | "global") => void;
  memory: MemoryRecord | null;
  memories: MemoryRecord[];
  onSelect: (id: string) => void;
  runAction: (action: () => Promise<void>) => Promise<void>;
  onChanged: () => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");

  useEffect(() => {
    setTitle(props.memory?.title || "");
    setContent(props.memory?.content || "");
  }, [props.memory?.id]);

  async function save(event: FormEvent) {
    event.preventDefault();
    await props.runAction(async () => {
      if (props.scope === "global" && props.memory) {
        await memoryService.updateGlobal(props.memory.id, { title, content });
      } else if (props.scope === "global") {
        const response = await memoryService.createGlobal({ title, content });
        props.onSelect(response.memory.id);
      } else if (props.memory) {
        await memoryService.updateProject(props.projectId, props.memory.id, {
          title,
          content,
        });
      } else {
        const response = await memoryService.createProject(props.projectId, {
          title,
          content,
        });
        props.onSelect(response.memory.id);
      }
      await props.onChanged();
    });
  }

  return (
    <form className="stack-form" onSubmit={save}>
      <select
        value={props.scope}
        onChange={(event) =>
          props.onScopeChange(event.target.value as "project" | "global")
        }
      >
        <option value="project">Project memory</option>
        <option value="global">Global memory</option>
      </select>
      <select
        value={props.memory?.id || ""}
        onChange={(event) => props.onSelect(event.target.value)}
      >
        <option value="">New memory</option>
        {props.memories.map((memory) => (
          <option key={memory.id} value={memory.id}>
            {memory.title}
          </option>
        ))}
      </select>
      <input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="Memory title"
      />
      <textarea
        className="document-textarea memory-textarea"
        value={content}
        onChange={(event) => setContent(event.target.value)}
        placeholder={
          props.scope === "global"
            ? "Global user preferences and reusable conventions..."
            : "Project conventions, recurring decisions..."
        }
      />
      <button className="secondary-button" type="submit">
        <Brain size={16} />
        <span>Save memory</span>
      </button>
      <p className="provider-help">
        Global and project memory are injected into every agent prompt and CLI
        environment.
      </p>
    </form>
  );
}
