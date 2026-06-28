'use strict';

/*
 * Shared, DOM-free helpers for the Commit view (resources/commit.js).
 *
 * Like resources/graphLayout.js this is a UMD module: in the browser it attaches
 * to `self.CommitView`; in Node it exports via `module.exports`. Keeping the pure
 * data logic here (status codes, file-tree grouping, escaping) lets the commit
 * webview stay a thin DOM layer and lets this logic be unit-tested directly in
 * Node (resources/commitView.test.js) without a browser.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CommitView = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  // Full change label shown on the right of each row, keyed by status code.
  const STATUS_LABELS = {
    A: 'Added',
    M: 'Modified',
    D: 'Deleted',
    R: 'Renamed',
    C: 'Conflicted',
    U: 'Conflicted',
    '?': 'Untracked',
  };

  // Human label for a single-letter status code; unknown codes read as Modified.
  function statusLabel(code) {
    return STATUS_LABELS[code] || 'Modified';
  }

  // Single-letter status code for a file DTO ({ state, conflicted }). Conflicts
  // always win so they render with the conflict colour and label.
  function statusCode(file) {
    if (file && file.conflicted) return 'C';
    return String((file && file.state) || 'modified')
      .charAt(0)
      .toUpperCase();
  }

  // File extension (lowercase, no dot) shown on the left of each row, or '•' when
  // the file has no extension (or is a dotfile with no further extension).
  function fileExt(name) {
    const base = String(name || '');
    const dot = base.lastIndexOf('.');
    if (dot <= 0 || dot === base.length - 1) return '•';
    return base.slice(dot + 1).toLowerCase();
  }

  // ─── Seti file icons ─────────────────────────────────────────────────────────
  // The Seti icon resolver lives in the shared setiIcons.js module so the commit
  // and graph webviews map file names to the same Explorer-style icons. In Node
  // it is required; in the browser it is read off `self.SetiIcons`.
  const seti =
    typeof require === 'function'
      ? require('./setiIcons.js')
      : (typeof self !== 'undefined' ? self.SetiIcons : undefined);
  const setiIconClass = (name) => seti.setiIconClass(name);

  // Escape a value for safe interpolation into innerHTML.
  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(
      /[&<>"]/g,
      (ch) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
        })[ch],
    );
  }

  // Group a flat list of file DTOs into a nested directory tree:
  //   { dirs: Map<segment, node>, files: [{ file, name }] }
  // Segments come from each file's POSIX `path`; the leaf keeps the bare file
  // name. Empty/odd paths fall back to the file's own `name`/`path`.
  function buildFileTree(files) {
    const root = { dirs: new Map(), files: [] };
    (files || []).forEach((f) => {
      const parts = String((f && f.path) || '')
        .split('/')
        .filter(Boolean);
      let node = root;
      for (let i = 0; i < parts.length - 1; i++) {
        const segment = parts[i];
        if (!node.dirs.has(segment)) {
          node.dirs.set(segment, { dirs: new Map(), files: [] });
        }
        node = node.dirs.get(segment);
      }
      node.files.push({
        file: f,
        name: parts[parts.length - 1] || (f && f.name) || (f && f.path) || '',
      });
    });
    return root;
  }

  return {
    STATUS_LABELS,
    statusLabel,
    statusCode,
    fileExt,
    setiIconClass,
    escapeHtml,
    buildFileTree,
  };
});
