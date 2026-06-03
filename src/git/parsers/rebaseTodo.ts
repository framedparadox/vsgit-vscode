export type RebaseAction =
  | "pick"
  | "reword"
  | "edit"
  | "squash"
  | "fixup"
  | "drop";

export interface RebaseTodoItem {
  action: RebaseAction;
  sha: string;
  subject: string;
}

const LONG_TO_SHORT: Record<string, RebaseAction> = {
  pick: "pick",
  p: "pick",
  reword: "reword",
  r: "reword",
  edit: "edit",
  e: "edit",
  squash: "squash",
  s: "squash",
  fixup: "fixup",
  f: "fixup",
  drop: "drop",
  d: "drop",
};

/**
 * Parse the command lines of a `git-rebase-todo` file into structured items.
 * Comments, blanks, and non-commit commands (exec/break/label/...) are ignored
 * because we regenerate the file from the user's structured edits.
 */
export function parseRebaseTodo(text: string): RebaseTodoItem[] {
  const items: RebaseTodoItem[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) {
      continue;
    }
    const m = /^(\S+)\s+([0-9a-fA-F]+)\s*(.*)$/.exec(line);
    if (!m) {
      continue;
    }
    const action = LONG_TO_SHORT[m[1].toLowerCase()];
    if (!action) {
      continue;
    }
    items.push({ action, sha: m[2], subject: m[3] });
  }
  return items;
}

/** Serialize structured items back into todo-file text (drop → omit line). */
export function serializeRebaseTodo(items: RebaseTodoItem[]): string {
  const lines = items
    .filter((it) => it.action !== "drop")
    .map((it) => `${it.action} ${it.sha} ${it.subject}`.trimEnd());
  // git is happy with or without a trailing newline; include one.
  return lines.join("\n") + "\n";
}
