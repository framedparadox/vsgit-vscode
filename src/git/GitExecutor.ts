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
  /**
   * Maximum combined stdout/stderr retained in memory. Git commands can read
   * repository-controlled data, so bounding output prevents a malformed or
   * unexpectedly large repository from exhausting the extension host.
   */
  maxOutputBytes?: number;
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

const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
const FORCE_KILL_DELAY_MS = 1_000;

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

  /** Convenience: run and return stdout without altering parser delimiters. */
  async stdout(args: string[], options: GitRunOptions): Promise<string> {
    return (await this.run(args, options)).stdout;
  }

  private exec(args: string[], options: GitRunOptions): Promise<GitResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.gitPath, args, {
        cwd: options.cwd,
        env: { ...process.env, ...options.env },
      });

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      const maxOutputBytes = Math.max(
        1,
        options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
      );
      let outputBytes = 0;
      let outputExceeded = false;
      let timedOut = false;
      let settled = false;
      let forceKillTimer: NodeJS.Timeout | undefined;
      const timer = options.timeoutMs
        ? setTimeout(() => {
            timedOut = true;
            terminate();
          }, options.timeoutMs)
        : undefined;
      timer?.unref();

      const output = (chunks: Buffer[]): string =>
        Buffer.concat(chunks).toString("utf8");
      const clearTimers = () => {
        if (timer) clearTimeout(timer);
        if (forceKillTimer) clearTimeout(forceKillTimer);
      };
      const terminate = () => {
        child.kill();
        if (!forceKillTimer) {
          forceKillTimer = setTimeout(() => child.kill("SIGKILL"), FORCE_KILL_DELAY_MS);
          forceKillTimer.unref();
        }
      };
      const capture = (chunks: Buffer[], data: Buffer | string) => {
        if (outputExceeded) {
          return;
        }
        const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
        outputBytes += chunk.length;
        if (outputBytes > maxOutputBytes) {
          outputExceeded = true;
          terminate();
          return;
        }
        chunks.push(chunk);
      };

      child.stdout.on("data", (data) => capture(stdoutChunks, data));
      child.stderr.on("data", (data) => capture(stderrChunks, data));
      // A child that exits before consuming stdin can emit EPIPE. The process
      // close event remains the authoritative result and prevents an unhandled
      // stream error from crashing the extension host.
      child.stdin.on("error", () => undefined);

      child.on("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimers();
        reject(error);
      });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimers();
        const stdout = output(stdoutChunks);
        const stderr = output(stderrChunks);
        if (timedOut) {
          reject(
            new GitError(
              `git ${args[0] ?? ""} timed out after ${options.timeoutMs}ms`,
              -1,
              stderr,
              stdout,
              args,
            ),
          );
          return;
        }
        if (outputExceeded) {
          reject(
            new GitError(
              `git ${args[0] ?? ""} exceeded the ${maxOutputBytes}-byte output limit`,
              -1,
              stderr,
              stdout,
              args,
            ),
          );
          return;
        }
        resolve({ stdout, stderr, exitCode: code ?? -1 });
      });

      if (options.stdin !== undefined) {
        child.stdin.end(options.stdin);
      }
    });
  }
}
