import { GitError } from "./GitError";

/**
 * Guards against argument/option injection when a ref, SHA, branch, tag, or
 * remote name is passed to `git` as a positional argument.
 *
 * Git is always spawned with an argv array (never a shell), so shell
 * metacharacters are inert. The remaining risk is that a value beginning with
 * "-" is parsed by git as an *option* rather than data (e.g. a crafted commit
 * "ref" of `--output=...`). No valid git ref or object name begins with "-"
 * (see `git check-ref-format`), and SHAs are hex, so rejecting option-like
 * values is safe and closes the whole class of option injection for refs.
 *
 * These values can originate from webview `postMessage` payloads and from ref
 * names embedded in rendered commit data, so they are not fully trusted.
 */
export function isOptionLike(value: string): boolean {
  return value.length > 0 && value[0] === "-";
}

/** Return `ref` unchanged, or throw if it could be interpreted as an option. */
export function safeRef(ref: string, label = "ref"): string {
  if (typeof ref !== "string" || ref.length === 0) {
    throw new GitError(`Invalid ${label}: empty value`, -1, "", "", []);
  }
  if (isOptionLike(ref)) {
    throw new GitError(
      `Refusing ${label} "${ref}": values beginning with "-" are not allowed (option injection).`,
      -1,
      "",
      "",
      [],
    );
  }
  return ref;
}

/**
 * Like {@link safeRef} but for a remote URL. Also rejects git's local
 * remote-helper transports (`ext::`, `fd::`) which can execute arbitrary
 * commands when git connects to the URL.
 */
export function safeRemoteUrl(url: string, label = "remote URL"): string {
  safeRef(url, label);
  if (/^(ext|fd)::/i.test(url)) {
    throw new GitError(
      `Refusing ${label} "${url}": ext::/fd:: transports can execute arbitrary commands.`,
      -1,
      "",
      "",
      [],
    );
  }
  return url;
}

/**
 * Redact URL user-info and common secret query parameters before displaying a
 * remote in command previews, progress messages, or webviews.
 */
export function redactRemoteUrl(url: string): string {
  return url
    .replace(
      /^([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/i,
      "$1***@",
    )
    .replace(
      /([?&](?:access_token|auth|password|token)=)[^&#\s]*/gi,
      "$1***",
    );
}
