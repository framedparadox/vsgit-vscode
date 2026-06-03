import * as vscode from "vscode";

/**
 * Session-level bypass tracking for destructive operation confirmations.
 * Cleared when the extension deactivates.
 */
const sessionBypass = new Set<string>();

export interface ConfirmationOptions {
  /** The destructive operation being performed */
  operation: string;
  /** Detailed message explaining what will happen */
  message: string;
  /** Optional list of affected items (files, branches, etc.) */
  items?: string[];
  /** Whether to show "Don't ask again" option (default: true) */
  allowBypass?: boolean;
}

/**
 * Shows a confirmation dialog for destructive operations.
 * Respects the `vsgit.confirmDestructiveActions` setting.
 * Supports session-level bypass.
 * 
 * @returns true if user confirmed, false otherwise
 */
export async function confirmDestructiveAction(
  options: ConfirmationOptions,
): Promise<boolean> {
  const config = vscode.workspace.getConfiguration("vsgit");
  const confirmEnabled = config.get<boolean>("confirmDestructiveActions", true);
  
  if (!confirmEnabled) {
    return true;
  }
  
  // Check session bypass
  if (sessionBypass.has(options.operation)) {
    return true;
  }
  
  // Build message
  let fullMessage = options.message;
  if (options.items && options.items.length > 0) {
    const itemList = options.items.slice(0, 10).map(i => `  • ${i}`).join("\n");
    const more = options.items.length > 10 ? `\n  ... and ${options.items.length - 10} more` : "";
    fullMessage += `\n\n${itemList}${more}`;
  }
  
  // Show confirmation dialog
  const actions: string[] = ["Confirm"];
  if (options.allowBypass !== false) {
    actions.push("Don't Ask Again (Session)");
  }
  actions.push("Cancel");
  
  const result = await vscode.window.showWarningMessage(
    fullMessage,
    { modal: true },
    ...actions,
  );
  
  if (result === "Confirm") {
    return true;
  }
  
  if (result === "Don't Ask Again (Session)") {
    sessionBypass.add(options.operation);
    return true;
  }
  
  return false;
}

/**
 * Clears all session bypass flags.
 * Should be called on extension deactivation.
 */
export function clearSessionBypass(): void {
  sessionBypass.clear();
}

/**
 * Helper for common destructive operations
 */
export const DestructiveOperations = {
  HARD_RESET: "hardReset",
  DISCARD_CHANGES: "discardChanges",
  CLEAN_UNTRACKED: "cleanUntracked",
  FORCE_PUSH: "forcePush",
  DELETE_BRANCH: "deleteBranch",
  DELETE_REMOTE_BRANCH: "deleteRemoteBranch",
  REBASE_SKIP: "rebaseSkip",
  REBASE_ABORT: "rebaseAbort",
  DELETE_TAG: "deleteTag",
  FORCE_CHECKOUT: "forceCheckout",
  DISCARD_ALL: "discardAll",
} as const;
