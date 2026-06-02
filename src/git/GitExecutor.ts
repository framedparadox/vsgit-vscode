import { spawn } from "node:child_process";
import { GitError } from "./GitError";

export interface GitRunOptions {
  /** Working directory the git command runs in. */
  cwd: string;
  /** Optional data to write to the process stdin (e.g. commit messages, patches). */
  stdin?: string;
  /** Extra environment variables merged over the current process env. */
  env?: NodeJS.ProcessEnv;
  /** Treat these exit codes as success (in addition to 0). */
  okCodes?: number[];
}

export interface GitResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Thin wrapper around spawning the `git` binary. Every higher-level operation
 * funnels through here so we have a single place for env, error handling and
 * stdin plumbing. Output is parsed by callers using machine-readable formats.
 */
export class GitExecutor {
  constructor(private readonly gitPath: string = "git") {}

  /** Run git, throwing GitError on unexpected non-zero exit. */
  async run(args: string[], options: GitRunOptions): Promise<GitResult> {
    const result = await this.exec(args, options);
    const ok = result.exitCode === 0 || (options.okCodes ?? []).includes(result.exitCode);
    if (!ok) {
      throw new GitError(
        `git ${args.join(" ")} failed (exit ${result.exitCode}): ${result.stderr.trim()}`,
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

      child.on("error", reject);
      child.on("close", (code) => {
        resolve({ stdout, stderr, exitCode: code ?? -1 });
      });

      if (options.stdin !== undefined) {
        child.stdin.write(options.stdin);
        child.stdin.end();
      }
    });
  }
}
