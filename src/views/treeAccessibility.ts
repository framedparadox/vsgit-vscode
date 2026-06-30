import * as vscode from "vscode";

/**
 * Give screen readers a complete label instead of relying on visual
 * decorations, icons, abbreviated status letters, or secondary descriptions.
 */
export function accessibleTreeItem(
  item: vscode.TreeItem,
  label: string,
): vscode.TreeItem {
  item.accessibilityInformation = { label };
  return item;
}
