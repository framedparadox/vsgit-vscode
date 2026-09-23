/**
 * POSIX shell launcher for the askpass shim. Git for Windows runs `#!/bin/sh`
 * scripts through its bundled shell, so the same script works everywhere.
 * ELECTRON_RUN_AS_NODE makes VS Code's executable behave as plain Node instead
 * of starting a second editor window.
 */
export const ASKPASS_LAUNCHER_SCRIPT = [
  "#!/bin/sh",
  'ELECTRON_RUN_AS_NODE=1 exec "$VSGIT_ASKPASS_NODE" "$VSGIT_ASKPASS_MAIN" "$@"',
  "",
].join("\n");

/** True unless the prompt clearly asks for a username or a yes/no answer. */
export function isSecretPrompt(prompt: string): boolean {
  return !/username|user name|\blogin\b|\(yes\/no/i.test(prompt);
}
