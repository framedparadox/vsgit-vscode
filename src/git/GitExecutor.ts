import { spawn } from "node:child_process";
import { GitError } from "./GitError";

export type GitCommandPreview = (
  args: string[],
  cwd: string,
  gitPath: string,
) => Promise<boolean>;

export interface GitRunOptions {
  /** Working directory the git command runs in. */
  cwd: string;
  /** Optional data to write to the process stdin (e.g. commit messages, patches). */
  stdin?: string;
  /** Extra environment variables merged over the current process env. */
  env?: NodeJS.ProcessEnv;
  /** Treat these exit codes as success (in addition to 0). */
  okCodes?: number[];
  /** Kill the process if it hasn't exited after this many milliseconds. */
  timeoutMs?: number;
}

export interface GitResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export class GitCommandCancelled extends Error {
  constructor(readonly args: string[]) {
    super("Git command cancelled by user.");
    this.name = "GitCommandCancelled";
  }
}

/**
 * Thin wrapper around spawning the `git` binary. Every higher-level operation
 * funnels through here so we have a single place for env, error handling and
 * stdin plumbing. Output is parsed by callers using machine-readable formats.
 */
export class GitExecutor {
  constructor(
    private gitPath: string = "git",
    private readonly preview?: GitCommandPreview,
  ) {}

  setGitPath(gitPath: string): void {
    this.gitPath = gitPath || "git";
  }

  /** Run git, throwing GitError on unexpected non-zero exit. */
  async run(args: string[], options: GitRunOptions): Promise<GitResult> {
    if (this.preview) {
      const shouldRun = await this.preview(args, options.cwd, this.gitPath);
      if (!shouldRun) {
        throw new GitCommandCancelled(args);
      }
    }
    const result = await this.exec(args, options);
    const ok = result.exitCode === 0 || (options.okCodes ?? []).includes(result.exitCode);
    if (!ok) {
      throw new GitError(
        `git ${args[0] ?? ""} failed (exit ${result.exitCode}): ${result.stderr.trim()}`,
        result.exitCode,
        result.stderr,
        result.stdout,
        args,
      );
    }
    return result;
  }

  /** Convenience: run and return trimmed stdout. */
  async stdout(args: string[], options: GitRunOptions): Promise<string> {
    return (await this.run(args, options)).stdout;
  }

  private exec(args: string[], options: GitRunOptions): Promise<GitResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.gitPath, args, {
        cwd: options.cwd,
        env: { ...process.env, ...options.env },
      });

      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => (stdout += d.toString()));
      child.stderr.on("data", (d) => (stderr += d.toString()));

      let timedOut = false;
      const timer = options.timeoutMs
        ? setTimeout(() => {
            timedOut = true;
            child.kill();
          }, options.timeoutMs)
        : undefined;

      child.on("error", (err) => {
        if (timer) clearTimeout(timer);
        reject(err);
      });
      child.on("close", (code) => {
        if (timer) clearTimeout(timer);
        if (timedOut) {
          reject(new GitError(`git ${args[0] ?? ""} timed out after ${options.timeoutMs}ms`, -1, stderr, stdout, args));
          return;
        }
        resolve({ stdout, stderr, exitCode: code ?? -1 });
      });

      if (options.stdin !== undefined) {
        child.stdin.write(options.stdin);
        child.stdin.end();
      }
    });
  }
}
