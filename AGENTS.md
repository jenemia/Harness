# Project Instructions

## Commit discipline

- Finish every completed implementation task that changes repository files with a Git commit.
- Keep one logical user-requested task per commit; do not combine unrelated work.
- Run the relevant checks and review the diff before committing.
- Stage only the files or hunks that belong to the current task. Preserve pre-existing and unrelated user changes.
- Use a concise, imperative commit message that describes the completed task.
- Do not create empty commits for read-only tasks or tasks that produce no repository changes.
- Do not amend, rewrite, squash, or otherwise alter existing commits unless the user explicitly requests it.

## Worktree cleanup

- After successfully merging a temporary worktree branch into `main`, stop processes running from that worktree, remove the worktree, and delete the merged local branch.
- Only perform this cleanup after the merge and relevant verification checks succeed.
