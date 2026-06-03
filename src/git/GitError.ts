/**
 * Error thrown when a git CLI invocation exits non-zero.
 */
export class GitError extends Error {
  constructor(
    message: string,
    readonly exitCode: number,
    readonly stderr: string,
    readonly stdout: string,
    readonly args: string[],
  ) {
    super(message);
    this.name = "GitError";
  }
}
