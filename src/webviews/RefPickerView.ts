import * as crypto from "node:crypto";
import * as path from "node:path";
import * as fs from "node:fs";
import * as vscode from "vscode";
import { Repository } from "../git/Repository";
import { refPickerHtml } from "./refPickerHtml";

interface RefEntry {
  ref: string;
  shortSha: string;
  subject: string;
  isHead: boolean;
  icon: string;
}

interface RefGroup {
  id: string;
  label: string;
  icon: string;
  collapsedByDefault: boolean;
  items: RefEntry[];
}

/**
 * Opens the "Select a Branch, Tag, or Reference" webview picker.
 * Resolves with the chosen ref string, or undefined if cancelled.
 */
export class RefPickerView {
  static async pick(
    repo: Repository,
    opts: { title?: string; subtitle?: string } = {},
  ): Promise<string | undefined> {
    return new Promise<string | undefined>((resolve) => {
      const panel = vscode.window.createWebviewPanel(
        "vsgit.refPicker",
        opts.title ?? "Select a Branch, Tag, or Reference",
        vscode.ViewColumn.Active,
        {
          enableScripts: true,
          retainContextWhenHidden: false,
          localResourceRoots: [],
        },
      );

      const nonce = crypto.randomBytes(16).toString("hex");
      panel.webview.html = refPickerHtml(nonce, panel.webview.cspSource);

      let resolved = false;
      const finish = (ref: string | undefined) => {
        if (!resolved) {
          resolved = true;
          resolve(ref);
          panel.dispose();
        }
      };

      panel.onDidDispose(() => finish(undefined));
      panel.webview.onDidReceiveMessage((msg) => {
        if (msg.command === "cancel") finish(undefined);
        else if (msg.command === "pick") finish(msg.ref as string);
      });

      // Build and send groups asynchronously
      void buildGroups(repo, opts).then((groups) => {
        void panel.webview.postMessage({
          command: "load",
          groups,
          title:    opts.title,
          subtitle: opts.subtitle,
        });
      });
    });
  }
}

// ── Group builder ──────────────────────────────────────────────────────────

async function buildGroups(
  repo: Repository,
  _opts: { title?: string; subtitle?: string },
): Promise<RefGroup[]> {
  const groups: RefGroup[] = [];

  // ── 1. Local branches ─────────────────────────────────────────────────
  const localItems: RefEntry[] = repo.localBranches.map((b) => ({
    ref: b.shortName,
    shortSha: b.objectId.slice(0, 7),
    subject: b.subject ?? "",
    isHead: b.isHead,
    icon: b.isHead ? "🔀" : "⎇",
  }));
  if (localItems.length > 0) {
    groups.push({
      id: "local",
      label: "Local",
      icon: "📁",
      collapsedByDefault: false,
      items: localItems,
    });
  }

  // ── 2. Remote Tracking ────────────────────────────────────────────────
  const remoteItems: RefEntry[] = repo.remoteBranches.map((b) => ({
    ref: b.shortName,
    shortSha: b.objectId.slice(0, 7),
    subject: b.subject ?? "",
    isHead: false,
    icon: "🌐",
  }));
  if (remoteItems.length > 0) {
    groups.push({
      id: "remote",
      label: "Remote Tracking",
      icon: "📁",
      collapsedByDefault: true,  // collapsed by default, like VsGit
      items: remoteItems,
    });
  }

  // ── 3. Tags ───────────────────────────────────────────────────────────
  const tagItems: RefEntry[] = repo.tags.map((t) => ({
    ref: t.shortName,
    shortSha: t.objectId.slice(0, 7),
    subject: t.subject ?? "",
    isHead: false,
    icon: "🏷",
  }));
  if (tagItems.length > 0) {
    groups.push({
      id: "tags",
      label: "Tags",
      icon: "📁",
      collapsedByDefault: false,
      items: tagItems,
    });
  }

  // ── 4. Stashes ────────────────────────────────────────────────────────
  const stashItems: RefEntry[] = repo.stashes.map((s) => ({
    ref: s.ref,          // e.g. stash@{0}
    shortSha: "",
    subject: s.message,
    isHead: false,
    icon: "📦",
  }));
  if (stashItems.length > 0) {
    groups.push({
      id: "stashes",
      label: "Stashed Changes",
      icon: "📁",
      collapsedByDefault: true,
      items: stashItems,
    });
  }

  // ── 5. References — special refs resolved live ────────────────────────
  const specialItems = await resolveSpecialRefs(repo);
  if (specialItems.length > 0) {
    groups.push({
      id: "references",
      label: "References",
      icon: "📁",
      collapsedByDefault: false,
      items: specialItems,
    });
  }

  return groups;
}

// ── Special ref resolution ─────────────────────────────────────────────────

const SPECIAL_REFS = [
  "HEAD",
  "FETCH_HEAD",
  "ORIG_HEAD",
  "MERGE_HEAD",
  "CHERRY_PICK_HEAD",
  "REVERT_HEAD",
  "refs/stash",
];

async function resolveSpecialRefs(repo: Repository): Promise<RefEntry[]> {
  const items: RefEntry[] = [];

  for (const name of SPECIAL_REFS) {
    try {
      const sha = await resolveRef(repo, name);
      if (!sha) continue;
      const subject = await resolveSubject(repo, sha);
      // For HEAD show what it points to in the label, but keep "HEAD" as the ref value
      const displayName = (name === "HEAD" && repo.headName)
        ? `HEAD [${repo.headName.startsWith("refs/heads/") ? repo.headName.slice(11) : repo.headName}]`
        : name;
      items.push({
        ref: displayName,
        shortSha: sha.slice(0, 7),
        subject,
        isHead: name === "HEAD",
        icon: "📄",
      });
    } catch {
      // ref doesn't exist — skip silently
    }
  }

  return items;
}

async function resolveRef(repo: Repository, name: string): Promise<string | undefined> {
  // First try git rev-parse to handle both symbolic and packed refs
  try {
    const out = await (repo as unknown as { git: { stdout: (args: string[], opts?: object) => Promise<string> } })
      .git.stdout(["rev-parse", "--verify", name], { cwd: repo.root });
    return out.trim() || undefined;
  } catch {
    // Try reading the file directly for special refs
    const gitDir = await getGitDir(repo);
    const filePath = path.join(gitDir, name);
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, "utf8").trim();
      // Handle symrefs like "ref: refs/heads/main"
      if (content.startsWith("ref: ")) {
        const target = content.slice(5).trim();
        return resolveRef(repo, target);
      }
      return content || undefined;
    }
    return undefined;
  }
}

async function resolveSubject(repo: Repository, sha: string): Promise<string> {
  try {
    const out = await (repo as unknown as { git: { stdout: (args: string[], opts?: object) => Promise<string> } })
      .git.stdout(["log", "-1", "--format=%s", sha], { cwd: repo.root });
    return out.trim();
  } catch {
    return "";
  }
}

async function getGitDir(repo: Repository): Promise<string> {
  try {
    const out = await (repo as unknown as { git: { stdout: (args: string[], opts?: object) => Promise<string> } })
      .git.stdout(["rev-parse", "--git-dir"], { cwd: repo.root });
    const rel = out.trim();
    return path.isAbsolute(rel) ? rel : path.join(repo.root, rel);
  } catch {
    return path.join(repo.root, ".git");
  }
}
