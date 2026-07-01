/** Escapes text for safe interpolation into HTML and double-quoted attributes. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Source for a client-side `esc()` matching {@link escapeHtml}, for injection
 * into webview `<script>` blocks. Webview scripts are serialized as strings and
 * cannot import from the extension, so they share this one definition instead
 * of each re-declaring their own (previously divergent) escaper. Nullish input
 * escapes to an empty string.
 */
export const ESC_SCRIPT = `function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}`;
