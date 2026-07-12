import { useEffect, useState } from "react";
import type { Task } from "../../api/contracts";
import { taskService } from "../../services/taskService";

export function TaskCompletionModal(props: { projectId: string; task: Task; onClose: () => void; onCompleted: () => Promise<void>; runAction: (action: () => Promise<void>) => Promise<void> }) {
  const [branches, setBranches] = useState<string[]>([]);
  const [targetBranch, setTargetBranch] = useState("");
  const [merge, setMerge] = useState(true);
  const [removeWorktree, setRemoveWorktree] = useState(true);
  useEffect(() => { void taskService.completionBranches(props.projectId).then((response) => {
    setBranches(response.branches.branches); setTargetBranch(response.branches.current || response.branches.branches[0] || "");
  }); }, [props.projectId]);
  async function complete() {
    await props.runAction(async () => {
      const response = await taskService.complete(props.projectId, props.task.id, { targetBranch, merge, removeWorktree }) as { result?: { ok: boolean; reason?: string } };
      if (response.result && !response.result.ok) throw new Error(response.result.reason || "완료 처리에 실패했습니다.");
      await props.onCompleted(); props.onClose();
    });
  }
  return <div className="modal-backdrop" onClick={props.onClose}><section className="modal-card" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
    <header><div><span className="modal-kicker">일감 완료</span><h2>머지 및 워크트리 정리</h2></div></header>
    <label><span>대상 브랜치</span><select value={targetBranch} disabled={!merge} onChange={(event) => setTargetBranch(event.target.value)}>{branches.map((branch) => <option key={branch}>{branch}</option>)}</select></label>
    <label className="checkbox-row"><input type="checkbox" checked={merge} onChange={(event) => setMerge(event.target.checked)} /><span>대상 브랜치로 머지</span></label>
    <label className="checkbox-row"><input type="checkbox" checked={removeWorktree} onChange={(event) => setRemoveWorktree(event.target.checked)} /><span>워크트리 삭제</span></label>
    {!merge && removeWorktree && <p className="warning-line">병합되지 않은 변경이 있으면 워크트리를 삭제할 수 없습니다.</p>}
    <div className="task-prompt-actions"><button className="secondary-button" type="button" onClick={props.onClose}>취소</button><button className="primary-button" type="button" disabled={merge && !targetBranch} onClick={() => void complete()}>완료 처리</button></div>
  </section></div>;
}
