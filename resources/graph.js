'use strict';

/*
 * Git Graph webview client (vscode-git-graph style).
 *
 * Composition:
 *   • icon-only top toolbar (repo picker, Pull/Push/Fetch/Commit/Branch/Merge/
 *     Stash, find/trace/refresh) with ahead/behind badges and an in-progress
 *     operation banner;
 *   • one overlay SVG drawing the whole coloured DAG (single coordinate space so
 *     edges never break across rows);
 *   • a commit table whose Description column carries inline ref pills + message;
 *   • an expand-at-selection commit-details row inserted directly beneath the
 *     clicked commit — changed files on the LEFT, commit metadata on the RIGHT.
 *
 * Column widths and trace mode persist via vscode.getState/setState. All actions
 * post `{type,data}` messages to the extension host, which drives every git op.
 */

const vscode = acquireVsCodeApi();

// ─── tunables ──────────────────────────────────────────────────────────────
const ROW_H = 24; // px per row
const COL_W = 14; // px per graph column
const R = 4;      // commit dot radius
const PAD = 8;    // left / right padding inside the graph cell

var LANE_COLORS_X = {
  sugg: ['#4D90FE', '#F28B30', '#2DC55E', '#C678DD', '#E06C75', '#56B6C2',
    '#D19A66', '#98C379', '#61AFEF', '#F9826C', '#BB8EF8', '#E5C07B'],

  palette: ['#0085d9', '#d9008f', '#00d90a', '#282520', '#a300d9', '#ff0000',
    '#00d9cc', '#e138e8', '#85d900', '#dc5b23', '#6f24d6', '#ffcc00'],
}
let CONFIG = {
  palette: ['#0085d9','#ff7700','#00d90a','#d98500','#ffd000','#0a6976',
            '#6f24d6','#00d9cc','#85d900','#dc5b23','#BB8EF8','#ffcc00'],
  style: 'rounded',
  dateFormat: 'standard',
  // VsGit/EGit-style columns: Graph | Description | Author | Authored Date |
  // Committer | Committed Date | Commit. Graph/Description are always shown;
  // the metadata columns and Commit (id) are configurable.
  columns: {
    id: true,
    author: true,
    authoredDate: false,
    committer: false,
    committedDate: true,
  },
  showRemoteBranches: true,
  showSidebar: true,
};
function laneColor(idx) { return CONFIG.palette[idx % CONFIG.palette.length]; }

// ─── state ───────────────────────────────────────────────────────────────────
let graphData = null;       // full payload from the host
let layoutRows = [];        // output of buildLayout
let selectedSha = null;
let lastAnnouncedCommitCount = -1;  // avoid re-announcing the same count on refresh
let compareSha = null;      // 2nd commit for CTRL/CMD-click comparison
let findMatches = [];
let findIndex = -1;

// Commit-details file pane: 'tree' (folder hierarchy) or 'list' (flat). Persisted
// so the choice survives refreshes, and the most-recent file payload is cached so
// toggling the view re-renders without a round-trip to the host.
let cdvFileViewMode = (vscode.getState() || {}).cdvFileViewMode || 'tree';
let cdvFilesCache = null;   // { sha, toSha?, files }

// Control-bar dropdowns + branch filter. SHOW_ALL is the multi-select "Show All"
// pseudo-value (always the first branch option), matching vscode-git-graph.
const SHOW_ALL_BRANCHES = '';
let repoDropdown = null;
let branchDropdown = null;
let currentBranches = null;  // null / [SHOW_ALL] => all branches
let columnMenuOpen = false;

let traceMode = persistedTraceMode();
let traceRoot = null;
let parentMap = new Map();
let childMap = new Map();
function persistedTraceMode() {
  const p = vscode.getState() || {};
  return p.traceMode || 'off';
}

const persisted = vscode.getState() || {};
let colWidths = persisted.colWidths || {};
let trackingEnabled = persisted.trackingEnabled === true;
let trackedSha = persisted.trackedSha || null;
let trackedRef = persisted.trackedRef || null;

function savePersisted() {
  vscode.setState({
    ...vscode.getState(),
    colWidths,
    trackingEnabled,
    trackedSha,
    trackedRef,
  });
}

// ─── Icons (VS Code codicons) ────────────────────────────────────────────────
// Every glyph is a real codicon rendered from the bundled codicon font (see
// resources/codicon.css). Each logical name maps to its exact codicon id; the
// `icon()` helper emits the standard `<i class="codicon codicon-…">` markup.
const ICON_NAMES = {
  branch: 'git-branch',
  tag: 'tag',
  stash: 'archive',
  commit: 'git-commit',
  download: 'cloud-download',
  fetch: 'git-fetch',
  refresh: 'refresh',
  search: 'search',
  find: 'search',
  check: 'check',
  info: 'info',
  close: 'close',
  fileList: 'list-flat',
  fileTree: 'list-tree',
  chevron: 'chevron-right',
  pull: 'arrow-down',
  push: 'arrow-up',
  merge: 'git-merge',
  columns: 'split-horizontal',
  tracking: 'target',
  trace: 'type-hierarchy',
};
// Markup for a codicon by logical name (e.g. icon('branch')).
function icon(name) {
  const id = ICON_NAMES[name];
  return id ? '<i class="codicon codicon-' + id + '"></i>' : '';
}
// Back-compat accessor so existing `SVG_ICONS.foo` call sites keep working.
const SVG_ICONS = new Proxy({}, { get: (_t, name) => icon(name) });
function paintToolbarIcons() {
  document.querySelectorAll('.tb-ico[data-icon]').forEach((el) => {
    el.innerHTML = icon(el.dataset.icon);
  });
}

// ─── Dropdown component (ported from vscode-git-graph web/dropdown.ts) ────────
// A filterable single- or multi-select dropdown. Multi-select includes a leading
// "Show All" pseudo-option; selecting it clears the rest, and selecting any other
// option deselects "Show All". Used for the Repo (single) and Branches (multi)
// pickers in the control bar.
function alterClass(elem, className, enable) { elem.classList.toggle(className, enable); }
function formatCommaSeparatedList(vals) { return vals.length ? vals.join(', ') : ''; }
const CLASS_SELECTED = 'selected';
function announce(message) {
  const status = document.getElementById('aria-status');
  if (!status) return;
  status.textContent = '';
  requestAnimationFrame(() => { status.textContent = message; });
}
function makeKeyboardClickable(node, label, handler) {
  node.tabIndex = 0;
  node.setAttribute('role', 'button');
  node.setAttribute('aria-label', label);
  node.addEventListener('click', handler);
  node.addEventListener('keydown', (event) => {
    if (event.target !== node || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    handler(event);
  });
}

class Dropdown {
  constructor(id, showInfo, multipleAllowed, dropdownType, changeCallback) {
    this.showInfo = showInfo;
    this.multipleAllowed = multipleAllowed;
    this.changeCallback = changeCallback;
    this.options = [];
    this.optionsSelected = [];
    this.lastSelected = 0;
    this.dropdownVisible = false;
    this.lastClicked = 0;
    this.doubleClickTimeout = null;

    this.elem = document.getElementById(id);
    this.menuElem = document.createElement('div');
    this.menuElem.className = 'dropdownMenu';
    const filter = this.menuElem.appendChild(document.createElement('div'));
    filter.className = 'dropdownFilter';
    this.filterInput = filter.appendChild(document.createElement('input'));
    this.filterInput.className = 'dropdownFilterInput';
    this.filterInput.placeholder = 'Filter ' + dropdownType + '...';
    this.filterInput.setAttribute('aria-label', 'Filter ' + dropdownType);
    this.optionsElem = this.menuElem.appendChild(document.createElement('div'));
    this.optionsElem.className = 'dropdownOptions';
    this.noResultsElem = this.menuElem.appendChild(document.createElement('div'));
    this.noResultsElem.className = 'dropdownNoResults';
    this.noResultsElem.innerHTML = 'No results found.';
    this.currentValueElem = this.elem.appendChild(document.createElement('div'));
    this.currentValueElem.className = 'dropdownCurrentValue';
    this.currentValueElem.tabIndex = 0;
    this.currentValueElem.setAttribute('role', 'combobox');
    this.currentValueElem.setAttribute('aria-haspopup', 'listbox');
    this.currentValueElem.setAttribute('aria-expanded', 'false');
    this.optionsElem.setAttribute('role', 'listbox');
    alterClass(this.elem, 'multi', multipleAllowed);
    this.elem.appendChild(this.menuElem);

    document.addEventListener('click', (e) => {
      if (!e.target) return;
      if (e.target === this.currentValueElem) {
        this.dropdownVisible = !this.dropdownVisible;
        if (this.dropdownVisible) { this.filterInput.value = ''; this.filter(); }
        this.elem.classList.toggle('dropdownOpen');
        this.currentValueElem.setAttribute('aria-expanded', String(this.dropdownVisible));
        if (this.dropdownVisible) this.filterInput.focus();
      } else if (this.dropdownVisible) {
        if (e.target.closest('.dropdown') !== this.elem) {
          this.close();
        } else {
          const option = e.target.closest('.dropdownOption');
          if (option !== null && option.parentNode === this.optionsElem && typeof option.dataset.id !== 'undefined') {
            this.onOptionClick(parseInt(option.dataset.id));
          }
        }
      }
    }, true);
    document.addEventListener('contextmenu', () => this.close(), true);
    this.filterInput.addEventListener('keyup', () => this.filter());
    this.filterInput.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.close();
        this.currentValueElem.focus();
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        const first = Array.from(this.optionsElem.children).find((option) => option.style.display !== 'none');
        if (first) first.focus();
      }
    });
    this.optionsElem.addEventListener('keydown', (event) => {
      const option = event.target.closest('.dropdownOption');
      if (!option) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        this.onOptionClick(Number(option.dataset.id));
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        this.close();
        this.currentValueElem.focus();
        return;
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();
      const visible = Array.from(this.optionsElem.children).filter((entry) => entry.style.display !== 'none');
      const index = visible.indexOf(option);
      const next = event.key === 'ArrowDown'
        ? visible[(index + 1) % visible.length]
        : visible[(index - 1 + visible.length) % visible.length];
      if (next) next.focus();
    });
    this.currentValueElem.addEventListener('keydown', (event) => {
      if (!['Enter', ' ', 'ArrowDown', 'Escape'].includes(event.key)) return;
      event.preventDefault();
      if (event.key === 'Escape') {
        this.close();
        return;
      }
      this.dropdownVisible = true;
      this.elem.classList.add('dropdownOpen');
      this.currentValueElem.setAttribute('aria-expanded', 'true');
      this.filterInput.value = '';
      this.filter();
      this.filterInput.focus();
    });
  }

  setOptions(options, optionsSelected) {
    this.options = options;
    this.optionsSelected = [];
    let selectedOption = -1;
    for (let i = 0; i < options.length; i++) {
      const isSelected = optionsSelected.includes(options[i].value);
      this.optionsSelected[i] = isSelected;
      if (isSelected) selectedOption = i;
    }
    if (selectedOption === -1) { selectedOption = 0; this.optionsSelected[0] = true; }
    this.lastSelected = selectedOption;
    if (this.dropdownVisible && options.length <= 1) this.close();
    this.render();
    this.clearDoubleClickTimeout();
  }

  close() {
    this.elem.classList.remove('dropdownOpen');
    this.dropdownVisible = false;
    this.currentValueElem.setAttribute('aria-expanded', 'false');
    this.clearDoubleClickTimeout();
  }

  render() {
    this.elem.classList.add('loaded');
    const curValueText = formatCommaSeparatedList(this.getSelectedOptions(true));
    this.currentValueElem.title = curValueText;
    this.currentValueElem.textContent = curValueText;
    let html = '';
    for (let i = 0; i < this.options.length; i++) {
      const escapedName = esc(this.options[i].name);
      html += '<div class="dropdownOption' + (this.optionsSelected[i] ? ' ' + CLASS_SELECTED : '') + '" role="option" tabindex="-1" aria-selected="' + String(this.optionsSelected[i]) + '" data-id="' + i + '" title="' + escapedName + '">' +
        (this.multipleAllowed && this.optionsSelected[i] ? '<div class="dropdownOptionMultiSelected">' + SVG_ICONS.check + '</div>' : '') +
        escapedName +
        (this.showInfo ? '<div class="dropdownOptionInfo" title="' + esc(this.options[i].value) + '">' + SVG_ICONS.info + '</div>' : '') +
        '</div>';
    }
    this.optionsElem.className = 'dropdownOptions' + (this.showInfo ? ' showInfo' : '');
    this.optionsElem.innerHTML = html;
    if (this.dropdownVisible) this.filter();
  }

  filter() {
    const val = this.filterInput.value.toLowerCase();
    let matches = false;
    for (let i = 0; i < this.options.length; i++) {
      const match = this.options[i].name.toLowerCase().indexOf(val) > -1;
      this.optionsElem.children[i].style.display = match ? 'block' : 'none';
      if (match) matches = true;
    }
    this.noResultsElem.style.display = matches ? 'none' : 'block';
  }

  getSelectedOptions(names) {
    if (this.multipleAllowed && this.optionsSelected[0]) {
      return [names ? this.options[0].name : this.options[0].value];
    }
    const selected = [];
    for (let i = 0; i < this.options.length; i++) {
      if (this.optionsSelected[i]) selected.push(names ? this.options[i].name : this.options[i].value);
    }
    return selected;
  }

  onOptionClick(option) {
    let change = false;
    const doubleClick = this.doubleClickTimeout !== null && this.lastClicked === option;
    if (this.doubleClickTimeout !== null) this.clearDoubleClickTimeout();

    if (doubleClick) {
      if (this.multipleAllowed && option === 0) {
        for (let i = 1; i < this.optionsSelected.length; i++) this.optionsSelected[i] = !this.optionsSelected[i];
        change = true;
      }
    } else if (this.multipleAllowed) {
      if (option === 0) {
        if (!this.optionsSelected[0]) {
          this.optionsSelected[0] = true;
          for (let i = 1; i < this.optionsSelected.length; i++) this.optionsSelected[i] = false;
          change = true;
        }
      } else {
        if (this.optionsSelected[0]) this.optionsSelected[0] = false;
        this.optionsSelected[option] = !this.optionsSelected[option];
        if (this.optionsSelected.every((s) => !s)) this.optionsSelected[0] = true;
        change = true;
      }
      if (change) this.changeCallback(this.getSelectedOptions(false));
    } else {
      this.close();
      if (this.lastSelected !== option) {
        this.optionsSelected[this.lastSelected] = false;
        this.optionsSelected[option] = true;
        this.lastSelected = option;
        change = true;
        this.changeCallback(this.getSelectedOptions(false));
      }
    }

    if (change) {
      const menuScroll = this.menuElem.scrollTop;
      this.render();
      if (this.dropdownVisible) this.menuElem.scroll(0, menuScroll);
    }
    this.lastClicked = option;
    this.doubleClickTimeout = setTimeout(() => this.clearDoubleClickTimeout(), 500);
  }

  clearDoubleClickTimeout() {
    if (this.doubleClickTimeout !== null) { clearTimeout(this.doubleClickTimeout); this.doubleClickTimeout = null; }
  }
}

// ─── ref labels (gitRef pills) ───────────────────────────────────────────────
// Rendered exactly as vscode-git-graph: <span class="gitRef <kind>"> + an SVG
// (icon, the .gitRef > svg CSS gives it the lane-coloured box) + a .gitRefName
// span, tinted via --git-graph-color to the lane colour of the target commit.
function refKindClass(type) {
  switch (type) {
    case 'head': return 'gitRef head active';
    case 'localBranch': return 'gitRef head';
    case 'remoteBranch': return 'gitRef remote';
    case 'tag': return 'gitRef tag';
    case 'stash': return 'gitRef stash';
    default: return 'gitRef head';
  }
}
function refGlyph(type) {
  if (type === 'tag') return SVG_ICONS.tag;
  if (type === 'stash') return SVG_ICONS.stash;
  return SVG_ICONS.branch; // head / localBranch / remoteBranch
}
function makeRefBadge(ref, colorIdx) {
  const color = laneColor(colorIdx);
  const span = document.createElement('span');
  span.className = refKindClass(ref.type);
  span.dataset.refName = ref.name;
  span.dataset.refType = ref.type;
  span.style.setProperty('--git-graph-color', color);
  span.title = ref.name;
  // Glyph must be a DIRECT child of .gitRef (the .gitRef > .codicon styling).
  span.innerHTML = refGlyph(ref.type);
  const nameEl = document.createElement('span');
  nameEl.className = 'gitRefName';
  nameEl.textContent = ref.name;
  span.appendChild(nameEl);

  span.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    showRefMenu(e.clientX, e.clientY, ref);
  });
  span.addEventListener('click', (e) => {
    e.stopPropagation();
    const host = span.closest('tr.commit-row');
    if (!host || !host.dataset.sha) return;
    if (trackingEnabled) {
      const row = layoutRows.find((r) => r.commit.sha === host.dataset.sha);
      if (row) selectCommit(row.commit, host);
      trackRef(ref.name);
    } else if (traceMode !== 'off') {
      setTraceRoot(host.dataset.sha);
    }
  });
  return span;
}
function refBadgesFor(commit, colorIdx) {
  const frag = document.createDocumentFragment();
  (commit.refs || []).forEach((r) => frag.appendChild(makeRefBadge(r, colorIdx)));
  return frag;
}

// ─── lane layout (two-half connected model, topological) ─────────────────────
// The layout algorithm lives in the shared, unit-tested module
// resources/graphLayout.js (GraphLayout), so the Git Graph panel and the History
// view draw from one identical, verified implementation. Commits arrive in
// --topo-order (child before parents); each returned row carries its column,
// stable lane colour, and the incoming/outgoing lane segments used to draw edges.
function buildLayout(commits) {
  return GraphLayout.buildLayout(commits);
}

// ─── SVG drawing (ported verbatim) ───────────────────────────────────────────
// One overlay SVG spans the whole graph (vscode-git-graph style). A commit's
// vertical position is fixed to its row index, so each edge is drawn as a single
// continuous path from the commit down to its parent — routed through the lane
// column the parent occupies. This cannot fall out of alignment the way stacked
// per-row half-SVGs did. cyOf(rowIdx) is the exact vertical centre of that row.
const SVGNS = 'http://www.w3.org/2000/svg';
const cx = (c) => PAD + c * COL_W + COL_W / 2;
// Each commit dot sits at the MEASURED vertical centre of its table row, so dots
// line up exactly even when font metrics or ref pills make a row a fraction taller
// than ROW_H, and the alignment stays correct when an expanded details row pushes
// the rows below it down. `rowCenters` (px, relative to the overlay's origin) and
// `graphHeight` are filled by rebuildGraphOverlay() after each render; before the
// first measurement we fall back to the nominal ROW_H grid.
let rowCenters = [];
let graphHeight = 0;
function cyOf(rowIdx) {
  if (rowIdx >= 0 && rowIdx < rowCenters.length && rowCenters[rowIdx] != null) {
    return rowCenters[rowIdx];
  }
  return rowIdx * ROW_H + ROW_H / 2;
}

// One smooth/angular transition between two adjacent row centres (x1,y1)->(x2,y2).
function transition(x1, y1, x2, y2) {
  if (x1 === x2) return `L${x2},${y2} `;
  if (CONFIG.style === 'angular') {
    const bend = ROW_H * 0.4;
    return `L${x1},${y2 - bend} L${x2},${y2} `;
  }
  const dy = (y2 - y1) * 0.8;
  return `C${x1},${y1 + dy} ${x2},${y2 - dy} ${x2},${y2} `;
}

// Path from a commit (commitCol, commitRow) to a parent (parentCol, parentRow),
// travelling in the edge's lane column (laneCol). The transition into the lane
// happens just below the commit; the line then runs straight down the lane; and
// the final transition (just above the parent) jogs from the lane to the
// parent's actual dot column — which may differ from the lane column. Modelled on
// vscode-git-graph, where the horizontal moves are confined to single-row gaps.
function commitToParentPath(commitCol, commitRow, laneCol, parentCol, parentRow) {
  const xc = cx(commitCol), yc = cyOf(commitRow);
  const xl = cx(laneCol);
  const xp = cx(parentCol), yp = cyOf(parentRow);
  let d = `M${xc},${yc} `;

  // Enter the lane over the first inter-row gap.
  const yEnter = cyOf(commitRow + 1);
  d += transition(xc, yc, xl, yEnter);

  // Straight vertical down the lane to the row just above the parent.
  const yBeforeParent = cyOf(parentRow - 1);
  if (yBeforeParent > yEnter) d += `L${xl},${yBeforeParent} `;

  // Final transition into the parent's actual dot column.
  if (parentRow - 1 >= commitRow + 1) {
    d += transition(xl, yBeforeParent, xp, yp);
  } else if (xl !== xp) {
    // Parent is the immediate next row: single combined transition.
    d = `M${xc},${yc} ` + transition(xc, yc, xp, yp);
  } else {
    d += `L${xp},${yp} `;
  }
  return d;
}

// Build the single overlay SVG for all rows: edges first, then dots on top.
function buildGraphSvg(rows) {
  const maxCols = rows.length ? rows[0].maxCols : 1;
  const w = maxCols * COL_W + PAD * 2;
  const h = graphHeight || rows.length * ROW_H;
  const svg = document.createElementNS(SVGNS, 'svg');
  svg.setAttribute('id', 'graph-svg');
  svg.setAttribute('width', String(w));
  svg.setAttribute('height', String(h));
  svg.style.width = w + 'px';
  svg.style.height = h + 'px';

  const rowOf = new Map();
  rows.forEach((r, i) => rowOf.set(r.commit.sha, i));

  const addLine = (d, colorIdx, sha) => {
    const p = document.createElementNS(SVGNS, 'path');
    p.setAttribute('d', d);
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', laneColor(colorIdx));
    p.setAttribute('stroke-width', '2');
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('stroke-linejoin', 'round');
    p.setAttribute('class', 'graph-line');
    p.dataset.sha = sha;
    svg.appendChild(p);
  };

  // Edges: one path per (commit → parent). The parent's lane column comes from
  // this row's `outgoing` list (pi-th entry == pi-th parent), so the vertical run
  // lands exactly on the parent's dot column.
  const colByRow = rows.map((r) => r.col);
  rows.forEach((row, i) => {
    const parents = (row.commit.parents || []).filter((p) => rowOf.has(p));
    parents.forEach((pSha, pi) => {
      const pRow = rowOf.get(pSha);
      const seg = row.outgoing[pi];
      const laneCol = seg ? seg.toCol : row.col;        // lane the edge travels in
      const parentCol = colByRow[pRow];                  // parent's actual dot column
      const colorIdx = seg ? seg.colorIdx : row.colorIdx;
      addLine(commitToParentPath(row.col, i, laneCol, parentCol, pRow), colorIdx, row.commit.sha);
    });
  });

  // Dots on top of the lines. Each dot is its own pointer target: clicking a node
  // selects exactly that commit (and opens its details) regardless of which row
  // the overlay SVG physically lives in, and right-click opens the commit menu.
  rows.forEach((row, i) => {
    const commit = row.commit;
    const dot = document.createElementNS(SVGNS, 'circle');
    dot.setAttribute('cx', String(cx(row.col)));
    dot.setAttribute('cy', String(cyOf(i)));
    dot.setAttribute('r', String(R));
    dot.setAttribute('class', 'graph-node');
    dot.dataset.sha = commit.sha;
    if (commit.kind === 'uncommitted') {
      dot.setAttribute('fill', 'var(--vscode-editor-background)');
      dot.setAttribute('stroke', laneColor(row.colorIdx));
      dot.setAttribute('stroke-width', '2');
    } else {
      dot.setAttribute('fill', laneColor(row.colorIdx));
      dot.setAttribute('stroke', 'rgba(0,0,0,0.35)');
      dot.setAttribute('stroke-width', '1');
    }
    dot.addEventListener('click', (e) => {
      e.stopPropagation();
      const tr = document.querySelector('#graph-body tr[data-sha="' + cssEsc(commit.sha) + '"]');
      selectCommit(commit, tr, e);
    });
    dot.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (commit.kind === 'uncommitted') return;
      showCommitMenu(e.clientX, e.clientY, commit);
    });
    svg.appendChild(dot);
  });

  return svg;
}

// Measure the real vertical centre of every commit row and (re)build the overlay
// SVG into the first commit row's graph cell. Called after the table renders and
// whenever a details row opens/closes (which shifts the rows below it). Measuring
// the live DOM keeps dots centred on their rows and lines continuous across the
// expanded-row gap — exactly like vscode-git-graph.
function rebuildGraphOverlay() {
  const tbody = document.getElementById('graph-body');
  if (!tbody || !layoutRows.length) return;
  const firstCell = tbody.querySelector('tr.commit-row td.col-graph');
  if (!firstCell) return;

  const trBySha = new Map();
  tbody.querySelectorAll('tr.commit-row').forEach((tr) => {
    if (tr.dataset.sha) trBySha.set(tr.dataset.sha, tr);
  });
  const originTop = firstCell.getBoundingClientRect().top;
  let maxBottom = 0;
  rowCenters = layoutRows.map((r) => {
    const tr = trBySha.get(r.commit.sha);
    if (!tr) return null;
    const rect = tr.getBoundingClientRect();
    maxBottom = Math.max(maxBottom, rect.bottom - originTop);
    return rect.top - originTop + rect.height / 2;
  });
  graphHeight = maxBottom;

  const old = document.getElementById('graph-svg');
  if (old) old.remove();
  firstCell.appendChild(buildGraphSvg(layoutRows));
  applyTrace();
}

// ─── flow tracing / highlight (ported) ───────────────────────────────────────
function buildAdjacency(commits) {
  parentMap = new Map();
  childMap = new Map();
  const present = new Set(commits.map((c) => c.sha));
  commits.forEach((c) => {
    const ps = (c.parents || []).filter((p) => present.has(p));
    parentMap.set(c.sha, ps);
    ps.forEach((p) => {
      if (!childMap.has(p)) childMap.set(p, []);
      childMap.get(p).push(c.sha);
    });
  });
}
function walk(sha, adj) {
  const seen = new Set();
  const stack = [sha];
  while (stack.length) {
    const cur = stack.pop();
    if (seen.has(cur)) continue;
    seen.add(cur);
    (adj.get(cur) || []).forEach((n) => { if (!seen.has(n)) stack.push(n); });
  }
  return seen;
}
function traceSet() {
  if (traceMode === 'off' || !traceRoot) return null;
  const lit = walk(traceRoot, parentMap);
  if (traceMode === 'both') walk(traceRoot, childMap).forEach((s) => lit.add(s));
  return lit;
}
function applyTrace() {
  const lit = traceSet();
  const dimAll = lit !== null;
  document.querySelectorAll('#graph-body tr.commit-row').forEach((tr) => {
    const sha = tr.dataset.sha;
    const on = !dimAll || lit.has(sha);
    tr.classList.toggle('dimmed', dimAll && !on);
    tr.classList.toggle('traced', dimAll && on && sha === traceRoot);
  });
  document.querySelectorAll('.graph-line, .graph-node').forEach((el) => {
    const sha = el.dataset.sha;
    el.classList.toggle('dim', dimAll && !lit.has(sha));
  });
  updateTraceButton();
}
function clearTraceRoot() { traceRoot = null; applyTrace(); }
function setTraceRoot(sha) { traceRoot = sha; applyTrace(); }
function setTraceMode(mode) {
  traceMode = mode;
  vscode.setState({ ...vscode.getState(), traceMode: mode });
  if (traceMode === 'off') traceRoot = null;
  else if (!traceRoot && selectedSha) traceRoot = selectedSha;
  applyTrace();
}
function updateTraceButton() {
  const btn = document.getElementById('tb-trace');
  if (!btn) return;
  const label = 'Trace flow: ' + traceModeLabel();
  btn.title = label;
  btn.setAttribute('aria-label', label);
  btn.classList.toggle('active', traceMode !== 'off');
  btn.dataset.traceMode = traceMode;
  // Reflect the current mode in the visible button label.
  const labelEl = btn.querySelector('.tb-label');
  if (labelEl) {
    labelEl.textContent =
      traceMode === 'off' ? 'Trace'
      : traceMode === 'both' ? 'Trace: both'
      : 'Trace: ancestors';
  }
}
function traceModeLabel() {
  if (traceMode === 'off') return 'off';
  if (traceMode === 'both') return 'ancestors + descendants';
  return 'ancestors';
}
function cycleTraceMode() {
  const order = ['off', 'ancestors', 'both'];
  setTraceMode(order[(order.indexOf(traceMode) + 1) % order.length]);
}

function updateTrackingButton() {
  const btn = document.getElementById('tb-tracking');
  if (!btn) return;
  const target = trackedRef || (trackedSha ? trackedSha.slice(0, 8) : 'none');
  const label = trackingEnabled ? 'Tracking: ' + target : 'Tracking: off';
  btn.classList.toggle('active', trackingEnabled);
  btn.title = label;
  btn.setAttribute('aria-label', label);
}

function setTrackingEnabled(enabled) {
  trackingEnabled = enabled;
  if (!trackingEnabled) {
    trackedSha = null;
    trackedRef = null;
  } else if (selectedSha) {
    trackedSha = selectedSha;
    trackedRef = null;
  }
  savePersisted();
  updateTrackingButton();
}

function trackCommit(sha) {
  if (!trackingEnabled || !sha || sha === '*uncommitted*') return;
  trackedSha = sha;
  trackedRef = null;
  savePersisted();
  updateTrackingButton();
}

function trackRef(refName) {
  if (!trackingEnabled || !refName) return;
  trackedRef = refName;
  const row = layoutRows.find((r) => (r.commit.refs || []).some((ref) => ref.name === refName));
  trackedSha = row ? row.commit.sha : null;
  savePersisted();
  updateTrackingButton();
  if (row) applyTrackingSelection({ scroll: false });
}

function trackedRow() {
  if (trackedRef) {
    const byRef = layoutRows.find((r) => (r.commit.refs || []).some((ref) => ref.name === trackedRef));
    if (byRef) {
      trackedSha = byRef.commit.sha;
      return byRef;
    }
  }
  return trackedSha ? layoutRows.find((r) => r.commit.sha === trackedSha) : null;
}

function applyTrackingSelection({ scroll = false } = {}) {
  if (!trackingEnabled) return false;
  const row = trackedRow();
  document.querySelectorAll('#graph-body tr.selected, #graph-body tr.compareSelected').forEach((r) =>
    r.classList.remove('selected', 'compareSelected'));
  compareSha = null;
  if (!row) {
    selectedSha = null;
    updateTrackingButton();
    savePersisted();
    return false;
  }
  selectedSha = row.commit.sha;
  const tr = document.querySelector('#graph-body tr[data-sha="' + cssEsc(selectedSha) + '"]');
  if (tr) {
    tr.classList.add('selected');
    if (scroll) setTimeout(() => tr.scrollIntoView({ block: 'center' }), 0);
  }
  if (traceMode !== 'off') setTraceRoot(selectedSha);
  else applyTrace();
  updateTrackingButton();
  savePersisted();
  return true;
}

// ─── table rendering (ported, + keyboard nav) ────────────────────────────────
function renderTable(rows) {
  const tbody = document.getElementById('graph-body');
  tbody.innerHTML = '';
  if (rows.length === 0) return;

  const maxCols = rows.length ? rows[0].maxCols : 1;
  const graphColW = maxCols * COL_W + PAD * 2;
  document.getElementById('col-graph').style.width = graphColW + 'px';

  const colorOf = new Map();
  rows.forEach((r) => colorOf.set(r.commit.sha, r.colorIdx));

  applyColumnWidths();
  applyColumnVisibility();

  const frag = document.createDocumentFragment();
  rows.forEach((row, i) => {
    const commit = row.commit;
    const tr = document.createElement('tr');
    tr.className = 'commit-row' + (commit.kind === 'uncommitted' ? ' uncommitted' : '');
    tr.dataset.sha = commit.sha;
    tr.tabIndex = 0;
    tr.setAttribute('aria-label', `${commit.message}, ${commit.kind === 'uncommitted' ? 'uncommitted changes' : `commit ${commit.shortSha}, by ${commit.author || 'unknown author'}`}`);
    if (commit.sha === selectedSha) tr.classList.add('selected');

    // Column order mirrors VsGit / EGit history: Graph | Description | Author |
    // Authored Date | Committer | Committed Date | Commit.

    // Graph: a fixed-size spacer cell; all lines + dots are drawn by one overlay
    // SVG appended to the first row's graph cell (see below), so the whole DAG
    // shares one coordinate space and edges never break across rows.
    const tdGraph = document.createElement('td');
    tdGraph.className = 'col-graph';
    tr.appendChild(tdGraph);

    // Description: inline ref pills, then the commit subject (git-graph style).
    const tdDesc = document.createElement('td');
    tdDesc.className = 'col-desc';
    tdDesc.appendChild(refBadgesFor(commit, colorOf.get(commit.sha) ?? row.colorIdx));
    const text = document.createElement('span');
    text.className = 'desc-text';
    text.textContent = commit.message;
    text.title = commit.message;
    tdDesc.appendChild(text);
    tr.appendChild(tdDesc);

    const tdAuthor = document.createElement('td');
    tdAuthor.className = 'col-author';
    tdAuthor.textContent = commit.author || '';
    tdAuthor.title = commit.author || '';
    tr.appendChild(tdAuthor);

    const tdADate = document.createElement('td');
    tdADate.className = 'col-adate';
    tdADate.textContent = commit.kind === 'uncommitted' ? '' : formatDate(commit.date);
    tdADate.title = commit.date || '';
    tr.appendChild(tdADate);

    const tdCommitter = document.createElement('td');
    tdCommitter.className = 'col-committer';
    tdCommitter.textContent = commit.kind === 'uncommitted' ? '' : (commit.committer || '');
    tdCommitter.title = commit.committer || '';
    tr.appendChild(tdCommitter);

    const tdCDate = document.createElement('td');
    tdCDate.className = 'col-cdate';
    tdCDate.textContent = commit.kind === 'uncommitted' ? '' : formatDate(commit.committerDate);
    tdCDate.title = commit.committerDate || '';
    tr.appendChild(tdCDate);

    // Commit: the abbreviated commit hash (git-graph's trailing column).
    const tdId = document.createElement('td');
    tdId.className = 'col-id';
    tdId.textContent = commit.kind === 'uncommitted' ? '*' : commit.shortSha;
    tr.appendChild(tdId);

    tr.addEventListener('click', (e) => selectCommit(commit, tr, e));
    tr.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        selectCommit(commit, tr, e);
      } else if ((e.shiftKey && e.key === 'F10') || e.key === 'ContextMenu') {
        e.preventDefault();
        if (commit.kind !== 'uncommitted') {
          const rect = tr.getBoundingClientRect();
          showCommitMenu(rect.left + 24, rect.top + Math.min(rect.height, 24), commit);
        }
      }
    });
    tr.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (commit.kind === 'uncommitted') return;
      showCommitMenu(e.clientX, e.clientY, commit);
    });
    frag.appendChild(tr);
  });
  tbody.appendChild(frag);
  applyColumnVisibility();
  // Build the overlay SVG now that the rows are in the DOM and measurable.
  rebuildGraphOverlay();
}

function applyColumnWidths() {
  const set = (id, w) => { const el = document.getElementById(id); if (w && el) el.style.width = w + 'px'; };
  set('col-id', colWidths.id || 80);
  set('col-author', colWidths.author || 130);
  set('col-adate', colWidths.adate || 150);
  set('col-committer', colWidths.committer || 130);
  set('col-cdate', colWidths.cdate || 150);
  updateDescriptionColumnWidth();
}
// `configKey` is the CONFIG.columns visibility key; `widthKey` is the (possibly
// different) key the resized width is persisted under in colWidths.
function visibleColumnWidth(key, widthKey, defaultWidth) {
  return CONFIG.columns[key] === false ? 0 : (colWidths[widthKey] || defaultWidth);
}
function updateDescriptionColumnWidth() {
  const main = document.getElementById('main');
  const desc = document.getElementById('col-desc');
  const graph = document.getElementById('col-graph');
  if (!main || !desc || !graph) return;
  const graphWidth = parseFloat(graph.style.width) || 80;
  const metadataWidth =
    visibleColumnWidth('author', 'author', 130) +
    visibleColumnWidth('authoredDate', 'adate', 150) +
    visibleColumnWidth('committer', 'committer', 130) +
    visibleColumnWidth('committedDate', 'cdate', 150) +
    visibleColumnWidth('id', 'id', 80);
  // Fit the table to the window: the Description column takes exactly the space
  // left over so the row never extends past #main and forces a horizontal
  // scrollbar. When the metadata columns alone overflow a narrow window we
  // still floor at 0 (those columns keep their own px widths and scroll), but
  // we never *add* an artificial minimum that would push the table wider.
  const available = Math.floor(main.clientWidth - graphWidth - metadataWidth);
  desc.style.width = Math.max(0, available) + 'px';
}
function applyColumnVisibility() {
  const toggle = (cls, show) => {
    document.querySelectorAll('.' + cls).forEach((el) => {
      el.classList.toggle('hidden-col', !show);
    });
  };
  toggle('col-id', CONFIG.columns.id);
  toggle('col-author', CONFIG.columns.author);
  toggle('col-adate', CONFIG.columns.authoredDate);
  toggle('col-committer', CONFIG.columns.committer);
  toggle('col-cdate', CONFIG.columns.committedDate);
  updateDescriptionColumnWidth();
  renderColumnsMenu();
}

const COLUMN_OPTIONS = [
  { key: 'id', label: 'Commit' },
  { key: 'author', label: 'Author' },
  { key: 'authoredDate', label: 'Authored Date' },
  { key: 'committer', label: 'Committer' },
  { key: 'committedDate', label: 'Committed Date' },
];

function renderColumnsMenu() {
  const menu = document.getElementById('columns-menu');
  if (!menu) return;
  menu.innerHTML = '';
  COLUMN_OPTIONS.forEach((col) => {
    const label = document.createElement('label');
    label.className = 'column-option';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = CONFIG.columns[col.key] !== false;
    input.dataset.columnKey = col.key;
    const mark = document.createElement('span');
    mark.className = 'customCheckbox';
    const text = document.createElement('span');
    text.textContent = col.label;
    label.appendChild(input);
    label.appendChild(mark);
    label.appendChild(text);
    menu.appendChild(label);
  });
}

function closeColumnsMenu() {
  columnMenuOpen = false;
  const menu = document.getElementById('columns-menu');
  const btn = document.getElementById('tb-columns');
  if (menu) menu.hidden = true;
  if (btn) btn.classList.remove('active');
}

function toggleColumnsMenu() {
  columnMenuOpen = !columnMenuOpen;
  const menu = document.getElementById('columns-menu');
  const btn = document.getElementById('tb-columns');
  if (menu) menu.hidden = !columnMenuOpen;
  if (btn) btn.classList.toggle('active', columnMenuOpen);
}

function setColumnVisibility(key, visible) {
  if (!Object.prototype.hasOwnProperty.call(CONFIG.columns, key)) return;
  CONFIG.columns[key] = visible;
  applyColumnVisibility();
  vscode.postMessage({ type: 'setColumnVisibility', data: { column: key, visible } });
}

// keyboard navigation over rows
function moveSelection(dir) {
  if (!layoutRows.length) return;
  let idx = layoutRows.findIndex((r) => r.commit.sha === selectedSha);
  if (idx === -1) idx = dir > 0 ? -1 : layoutRows.length;
  idx = Math.max(0, Math.min(layoutRows.length - 1, idx + dir));
  const row = layoutRows[idx];
  const tr = document.querySelector('#graph-body tr[data-sha="' + cssEsc(row.commit.sha) + '"]');
  selectCommit(row.commit, tr);
  if (tr) tr.scrollIntoView({ block: 'nearest' });
}
function selectIndex(i) {
  if (!layoutRows.length) return;
  const idx = Math.max(0, Math.min(layoutRows.length - 1, i));
  const row = layoutRows[idx];
  const tr = document.querySelector('#graph-body tr[data-sha="' + cssEsc(row.commit.sha) + '"]');
  selectCommit(row.commit, tr);
  if (tr) tr.scrollIntoView({ block: 'nearest' });
}

// ─── inline commit details (expand-at-selection, git-graph style) ────────────
// Clicking a commit toggles an expanded row inserted directly beneath it. The
// expanded row holds a two-column view: changed files on the LEFT, commit
// metadata + message on the RIGHT (per the requested layout).
function removeExpandedRow() {
  const ex = document.getElementById('cdv-row');
  const had = !!ex;
  if (ex) ex.remove();
  cdvFilesCache = null;
  document.querySelectorAll('#graph-body tr.commitDetailsOpen').forEach((r) =>
    r.classList.remove('commitDetailsOpen'));
  // Re-measure so the rows that were pushed down snap back into alignment.
  if (had) rebuildGraphOverlay();
}

function selectCommit(commit, tr, ev) {
  // CTRL/CMD-click a second commit (while one is open) => compare the two,
  // exactly like vscode-git-graph.
  if (ev && (ev.ctrlKey || ev.metaKey) && selectedSha && selectedSha !== commit.sha) {
    compareSha = commit.sha;
    document.querySelectorAll('#graph-body tr.compareSelected').forEach((r) => r.classList.remove('compareSelected'));
    if (tr) tr.classList.add('compareSelected');
    openComparison(selectedSha, compareSha);
    vscode.postMessage({ type: 'requestComparison', data: { from: selectedSha, to: compareSha } });
    return;
  }

  // Toggle off if re-clicking the open commit (with no active comparison).
  if (selectedSha === commit.sha && !compareSha && document.getElementById('cdv-row')) {
    removeExpandedRow();
    selectedSha = null;
    compareSha = null;
    clearTraceRoot();
    document.querySelectorAll('#graph-body tr.selected').forEach((r) => r.classList.remove('selected'));
    return;
  }

  compareSha = null;
  selectedSha = commit.sha;
  document.querySelectorAll('#graph-body tr.selected, #graph-body tr.compareSelected').forEach((r) =>
    r.classList.remove('selected', 'compareSelected'));
  if (tr) tr.classList.add('selected');
  if (trackingEnabled) trackCommit(commit.sha);
  if (traceMode !== 'off' && commit.kind !== 'uncommitted') setTraceRoot(commit.sha);
  else applyTrace();

  openExpandedRow(commit, tr);
  vscode.postMessage({ type: 'requestFiles', data: commit.sha });
}

// Open the CDV in comparison mode (two commits). Summary names the range; the
// file list is filled when the host replies with `comparisonFiles`.
function openComparison(fromSha, toSha) {
  const fromRow = layoutRows.find((r) => r.commit.sha === fromSha);
  const tr = document.querySelector('#graph-body tr[data-sha="' + cssEsc(fromSha) + '"]');
  if (!fromRow || !tr) return;
  openExpandedRow(fromRow.commit, tr);
  const summary = document.getElementById('cdvSummary');
  if (summary) {
    summary.innerHTML = 'Displaying all changes from <b>' + esc(fromSha.slice(0, 8)) +
      '</b> to <b>' + esc(toSha.slice(0, 8)) + '</b>.';
  }
}

function openExpandedRow(commit, tr) {
  removeExpandedRow();
  if (!tr) return;
  tr.classList.add('commitDetailsOpen');

  // Inline CDV layout (vscode-git-graph style), but anchored so the details panel
  // begins at the Description column — the first cell is an empty spacer over the
  // Graph column so the DAG line continues to show through, and the panel itself
  // spans the remaining columns. A header strip carries the title plus the
  // tree/list view toggle and the close button; the body splits into commit
  // metadata (left) and changed files (right).
  const colCount = tr.children.length;
  const row = document.createElement('tr');
  row.id = 'cdv-row';
  row.className = 'cdv-row';

  const spacer = document.createElement('td');
  spacer.className = 'col-graph cdv-graph-spacer';
  row.appendChild(spacer);

  const td = document.createElement('td');
  td.colSpan = colCount - 1;
  td.className = 'cdv-cell';
  row.appendChild(td);

  const title = commit.kind === 'uncommitted'
    ? 'Uncommitted Changes'
    : 'Commit ' + esc(commit.shortSha);
  const cdv = document.createElement('div');
  cdv.id = 'cdv';
  cdv.innerHTML =
    '<div id="cdvHeader">' +
      '<span id="cdvHeaderTitle">' + title + '</span>' +
      '<span class="cdvHeaderSpacer"></span>' +
      '<button type="button" id="cdvViewTree" class="cdvHeaderBtn cdvViewBtn" title="Tree View" aria-label="Tree View">' + SVG_ICONS.fileTree + '</button>' +
      '<button type="button" id="cdvViewList" class="cdvHeaderBtn cdvViewBtn" title="List View" aria-label="List View">' + SVG_ICONS.fileList + '</button>' +
      '<button type="button" id="cdvClose" class="cdvHeaderBtn" title="Close" aria-label="Close commit details">' + SVG_ICONS.close + '</button>' +
    '</div>' +
    '<div id="cdvBody">' +
      '<div id="cdvSummary"></div>' +
      '<div id="cdvFiles"><div class="cdvLoading">Loading changed files…</div></div>' +
    '</div>';
  td.appendChild(cdv);

  tr.insertAdjacentElement('afterend', row);
  sizeExpandedPanel();

  syncFileViewButtons();
  cdv.querySelector('#cdvViewTree').addEventListener('click', (e) => { e.stopPropagation(); setFileViewMode('tree'); });
  cdv.querySelector('#cdvViewList').addEventListener('click', (e) => { e.stopPropagation(); setFileViewMode('list'); });
  cdv.querySelector('#cdvClose').addEventListener('click', (e) => {
    e.stopPropagation();
    removeExpandedRow();
    selectedSha = null;
    document.querySelectorAll('#graph-body tr.selected').forEach((r) => r.classList.remove('selected'));
  });

  if (commit.kind === 'uncommitted') {
    document.getElementById('cdvSummary').innerHTML = 'Displaying all uncommitted changes.';
  } else {
    renderSummary(commit);
  }

  // The inserted details row pushes the rows below it down; re-measure so the
  // dots stay centred and the edges run continuously through the new gap (the
  // graph lines keep flowing past the open commit, exactly like git-graph).
  rebuildGraphOverlay();

  // Bring the whole panel onto the screen: when the clicked commit sits near the
  // bottom of the viewport the 248px details row would be clipped, so scroll the
  // container just enough to reveal it — but never so far that the clicked
  // commit's own row scrolls out of view above.
  scrollExpandedRowIntoView(tr, row);
}

// Pin the commit-details panel to the visible viewport width so its right pane
// (changed files) never runs off-screen. The panel lives in a td that spans the
// metadata columns, whose summed width can exceed the window; anchoring #cdv to
// (visible width − graph column) keeps both halves inside the screen with no
// horizontal overflow, regardless of column widths.
function sizeExpandedPanel() {
  const cdv = document.getElementById('cdv');
  const main = document.getElementById('main');
  const graphCol = document.getElementById('col-graph');
  if (!cdv || !main) return;
  const graphColW = graphCol ? (parseFloat(graphCol.style.width) || 0) : 0;
  const width = Math.max(0, main.clientWidth - graphColW);
  cdv.style.width = width + 'px';
}

// Scroll #main so the expanded details row (`cdvRow`) is fully visible while
// keeping its parent commit row (`commitRow`) on screen. Runs after layout so
// offset measurements are final.
function scrollExpandedRowIntoView(commitRow, cdvRow) {
  const main = document.getElementById('main');
  if (!main || !commitRow || !cdvRow) return;
  requestAnimationFrame(() => {
    const viewTop = main.scrollTop;
    const viewBottom = viewTop + main.clientHeight;
    const commitTop = commitRow.offsetTop;
    const panelBottom = cdvRow.offsetTop + cdvRow.offsetHeight;
    if (panelBottom > viewBottom) {
      // Scroll down to reveal the panel's bottom, but stop if that would push
      // the commit row off the top — pin to the commit row in that case.
      const target = Math.min(panelBottom - main.clientHeight, commitTop);
      main.scrollTop = Math.max(0, target);
    } else if (commitTop < viewTop) {
      main.scrollTop = commitTop;
    }
  });
}

// Tree/list view-type toggle for the changed-file pane.
function setFileViewMode(mode) {
  if (cdvFileViewMode === mode) return;
  cdvFileViewMode = mode;
  vscode.setState({ ...vscode.getState(), cdvFileViewMode: mode });
  syncFileViewButtons();
  if (cdvFilesCache) {
    if (cdvFilesCache.toSha) renderComparisonFiles(cdvFilesCache.sha, cdvFilesCache.toSha, cdvFilesCache.files);
    else renderFiles(cdvFilesCache.sha, cdvFilesCache.files);
  }
}
function syncFileViewButtons() {
  const tree = document.getElementById('cdvViewTree');
  const list = document.getElementById('cdvViewList');
  if (tree) tree.classList.toggle('active', cdvFileViewMode === 'tree');
  if (list) list.classList.toggle('active', cdvFileViewMode === 'list');
}

// LEFT pane: commit metadata + message. Shows author AND committer (with their
// respective dates), matching VsGit's commit detail.
function renderSummary(commit) {
  const host = document.getElementById('cdvSummary');
  if (!host) return;
  const authoredStr = commit.date ? formatLongDate(commit.date) : '';
  const committedStr = commit.committerDate ? formatLongDate(commit.committerDate) : '';

  const parents = (commit.parents || []).length
    ? (commit.parents || []).map((p) =>
        '<span class="cdvInternalLink" data-sha="' + esc(p) + '">' + esc(p) + '</span>').join(', ')
    : 'None';

  // Refs (branches / tags / remotes) pointing at this commit, so clicking a node
  // surfaces its branch/tag membership directly in the details.
  const refsHtml = (commit.refs || []).length
    ? (commit.refs || []).map((r) =>
        '<span class="cdvRefLabel ' + refKindClass(r.type).replace('gitRef', 'cdvRef') + '">' +
        esc(r.name) + '</span>').join(' ')
    : '';

  host.innerHTML =
    '<span class="cdvSummaryTop"><span class="cdvSummaryTopRow"><span class="cdvSummaryKeyValues">' +
      '<b>Commit: </b>' + esc(commit.sha) + '<br>' +
      '<b>Parents: </b>' + parents + '<br>' +
      '<b>Author: </b>' + esc(commit.author || '') + ' &lt;' + esc(authoredStr) + '&gt;<br>' +
      '<b>Committer: </b>' + esc(commit.committer || '') + ' &lt;' + esc(committedStr) + '&gt;' +
      (refsHtml ? '<br><b>Refs: </b>' + refsHtml : '') +
    '</span></span></span><br><br>' +
    '<span class="cdvBody">' + esc(commit.message) + '</span>';

  host.querySelectorAll('.cdvInternalLink').forEach((a) => {
    a.addEventListener('click', () => selectShaIfPresent(a.dataset.sha));
  });
}

// vscode-git-graph-style long date, e.g. "Sun Jun 1 2026 14:32:05 GMT+0530".
function formatLongDate(dateStr) {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toString();
}

function selectShaIfPresent(sha) {
  const tr = document.querySelector('#graph-body tr[data-sha="' + cssEsc(sha) + '"]');
  if (!tr) return;
  const row = layoutRows.find((r) => r.commit.sha === sha);
  if (row) { selectCommit(row.commit, tr); tr.scrollIntoView({ block: 'center' }); }
}

// RIGHT pane: the changed-file list, rendered as a folder tree or a flat list
// per the current view-type toggle.
function renderFiles(sha, files) {
  if (selectedSha !== sha) return;
  cdvFilesCache = { sha, files };
  const host = document.getElementById('cdvFiles');
  if (!host) return;
  renderFilePane(host, files, sha === '*uncommitted*' ? null : (f) => {
    vscode.postMessage({ type: 'openFileDiff', data: { sha, path: f.path } });
  });
}

// Shared renderer for the changed-file pane (commit or comparison).
function renderFilePane(host, files, onOpen, emptyText) {
  if (!files || files.length === 0) {
    host.innerHTML = '<div class="cdvFilesHead">' + (emptyText || 'No file changes.') + '</div>';
    return;
  }
  host.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'cdvFilesHead';
  head.textContent = files.length + ' changed file' + (files.length === 1 ? '' : 's');
  host.appendChild(head);
  host.appendChild(cdvFileViewMode === 'tree' ? buildFileTree(files, onOpen) : buildFileList(files, onOpen));
}

// Full change label shown on the right of each row, keyed by status code.
const CDV_STATUS_LABELS = {
  A: 'Added',
  M: 'Modified',
  D: 'Deleted',
  R: 'Renamed',
  C: 'Copied',
  T: 'Type Changed',
  U: 'Conflicted',
};

// File extension (lowercase, no dot) shown on the left of each row, or '•' when
// the file has no extension.
function makeFileRow(f, onOpen, label) {
  const fileRow = document.createElement('div');
  fileRow.className = 'file-row';
  const code = (f.status || 'M').charAt(0).toUpperCase();

  // LEFT: Seti file-type icon (the icon VS Code shows in the Explorer).
  const ext = document.createElement('span');
  ext.className = 'file-ext seti-icon ' + self.SetiIcons.setiIconClass(f.path);

  const p = document.createElement('span');
  p.className = 'file-path';
  p.textContent = label;
  p.title = f.path;

  // RIGHT: full change label (Modified, Added, …).
  const change = document.createElement('span');
  change.className = 'file-change ' + code;
  change.textContent = CDV_STATUS_LABELS[code] || 'Modified';

  fileRow.appendChild(ext);
  fileRow.appendChild(p);
  fileRow.appendChild(change);
  if (onOpen) {
    makeKeyboardClickable(fileRow, `${f.path}, ${CDV_STATUS_LABELS[code] || 'Modified'}, open diff`, () => onOpen(f));
  }
  return fileRow;
}

function buildFileList(files, onOpen) {
  const list = document.createElement('div');
  list.className = 'cdvFileList';
  files.slice().sort((a, b) => a.path.localeCompare(b.path)).forEach((f) => {
    list.appendChild(makeFileRow(f, onOpen, f.path));
  });
  return list;
}

// Build a nested folder tree from flat file paths and render collapsible folders.
function buildFileTree(files, onOpen) {
  const root = { dirs: new Map(), files: [] };
  files.forEach((f) => {
    const parts = f.path.split('/');
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i];
      if (!node.dirs.has(seg)) node.dirs.set(seg, { dirs: new Map(), files: [] });
      node = node.dirs.get(seg);
    }
    node.files.push({ file: f, name: parts[parts.length - 1] });
  });
  const container = document.createElement('div');
  container.className = 'cdvFileList cdvFileTree';
  renderTreeLevel(root, container, onOpen, 0);
  return container;
}

function renderTreeLevel(node, parent, onOpen, depth) {
  Array.from(node.dirs.keys()).sort((a, b) => a.localeCompare(b)).forEach((name) => {
    const dir = node.dirs.get(name);
    const folderRow = document.createElement('div');
    folderRow.className = 'tree-folder-row';
    folderRow.style.paddingLeft = (4 + depth * 14) + 'px';
    const chev = document.createElement('span');
    chev.className = 'tree-chevron expanded';
    chev.innerHTML = SVG_ICONS.chevron;
    const fname = document.createElement('span');
    fname.className = 'tree-folder-name';
    fname.textContent = name;
    folderRow.appendChild(chev);
    folderRow.appendChild(fname);
    folderRow.setAttribute('aria-expanded', 'true');
    const childrenWrap = document.createElement('div');
    childrenWrap.className = 'tree-children';
    renderTreeLevel(dir, childrenWrap, onOpen, depth + 1);
    makeKeyboardClickable(folderRow, `${name}, folder`, (e) => {
      e.stopPropagation();
      const collapsed = childrenWrap.classList.toggle('collapsed');
      chev.classList.toggle('expanded', !collapsed);
      folderRow.setAttribute('aria-expanded', String(!collapsed));
    });
    parent.appendChild(folderRow);
    parent.appendChild(childrenWrap);
  });
  node.files.sort((a, b) => a.name.localeCompare(b.name)).forEach((entry) => {
    const row = makeFileRow(entry.file, onOpen, entry.name);
    row.style.paddingLeft = (4 + depth * 14 + 16) + 'px';
    parent.appendChild(row);
  });
}

// ─── context menus (ported) ──────────────────────────────────────────────────
function buildMenu(items) {
  const menu = document.getElementById('context-menu');
  menu.innerHTML = '';
  items.forEach((it) => {
    if (it.sep) {
      const s = document.createElement('div');
      s.className = 'context-menu-separator';
      menu.appendChild(s);
    } else if (it.title) {
      const t = document.createElement('div');
      t.className = 'context-menu-title';
      t.textContent = it.title;
      menu.appendChild(t);
    } else {
      const el = document.createElement('div');
      el.className = 'context-menu-item';
      el.textContent = it.label;
      makeKeyboardClickable(el, it.label, (e) => {
        e.stopPropagation();
        menu.classList.remove('visible');
        it.action();
      });
      el.setAttribute('role', 'menuitem');
      menu.appendChild(el);
    }
  });
  return menu;
}
function placeMenu(menu, x, y) {
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  menu.classList.add('visible');
  const r = menu.getBoundingClientRect();
  if (r.right > window.innerWidth) menu.style.left = Math.max(0, window.innerWidth - r.width - 4) + 'px';
  if (r.bottom > window.innerHeight) menu.style.top = Math.max(0, window.innerHeight - r.height - 4) + 'px';
  menu.querySelector('[role="menuitem"]')?.focus();
}
function showCommitMenu(x, y, commit) {
  const sha = commit.sha;
  const send = (type, data) => vscode.postMessage({ type, data });
  const menu = buildMenu([
    { title: commit.shortSha },
    { label: 'Checkout Commit…', action: () => send('checkout', sha) },
    { label: 'Create Branch Here…', action: () => send('createBranch', { sha }) },
    { label: 'Create Tag Here…', action: () => openCreateTagModal(commit) },
    { sep: true },
    { label: 'Merge into Current Branch…', action: () => send('merge', sha) },
    { label: 'Rebase Current Branch onto This…', action: () => send('rebase', sha) },
    { sep: true },
    { label: 'Cherry-Pick', action: () => send('cherryPick', sha) },
    { label: 'Revert', action: () => send('revert', sha) },
    { label: 'Drop Commit…', action: () => send('dropCommit', sha) },
    { sep: true },
    { label: 'Reset → Soft', action: () => send('reset', { sha, mode: 'soft' }) },
    { label: 'Reset → Mixed', action: () => send('reset', { sha, mode: 'mixed' }) },
    { label: 'Reset → Hard', action: () => send('reset', { sha, mode: 'hard' }) },
    { sep: true },
    { label: 'Compare with HEAD', action: () => send('compareWithHead', sha) },
    { label: 'Compare with Another Commit…', action: () => send('compareWithAnother', sha) },
    { sep: true },
    { label: 'Copy SHA (short)', action: () => send('copyCommitSha', commit.shortSha) },
    { label: 'Copy SHA (full)', action: () => send('copyCommitSha', sha) },
  ]);
  placeMenu(menu, x, y);
}

function openCreateTagModal(commit) {
  const backdrop = document.getElementById('create-tag-modal');
  const form = document.getElementById('create-tag-form');
  const name = document.getElementById('create-tag-name');
  const sha = document.getElementById('create-tag-sha');
  const annotated = document.getElementById('create-tag-annotated');
  const signed = document.getElementById('create-tag-signed');
  const message = document.getElementById('create-tag-message');
  const force = document.getElementById('create-tag-force');
  const push = document.getElementById('create-tag-push');

  form.dataset.sha = commit.sha;
  name.value = '';
  sha.value = commit.shortSha || commit.sha.slice(0, 8);
  annotated.checked = false;
  signed.checked = false;
  message.value = '';
  message.disabled = true;
  force.checked = false;
  push.checked = false;
  backdrop.hidden = false;
  name.focus();
}

function closeCreateTagModal() {
  document.getElementById('create-tag-modal').hidden = true;
}

function syncCreateTagMessageState() {
  const annotated = document.getElementById('create-tag-annotated');
  const signed = document.getElementById('create-tag-signed');
  const message = document.getElementById('create-tag-message');
  message.disabled = !annotated.checked && !signed.checked;
  if (message.disabled) message.value = '';
}
function showRefMenu(x, y, ref) {
  const send = (type, data) => vscode.postMessage({ type, data });
  let items = [{ title: ref.name }];
  if (ref.type === 'localBranch' || ref.type === 'head') {
    items = items.concat([
      { label: 'Checkout', action: () => send('checkout', ref.name) },
      { label: 'Merge into Current…', action: () => send('merge', ref.name) },
      { label: 'Rebase Current onto…', action: () => send('rebase', ref.name) },
      { sep: true },
      { label: 'Rename…', action: () => send('renameBranch', { name: ref.name }) },
      { label: 'Delete…', action: () => send('deleteBranch', { name: ref.name }) },
      { label: 'Push…', action: () => send('pushBranch', { name: ref.name }) },
    ]);
  } else if (ref.type === 'remoteBranch') {
    items = items.concat([
      { label: 'Checkout', action: () => send('checkout', ref.name) },
      { label: 'Delete Remote Branch…', action: () => send('deleteRemoteBranch', { name: ref.name }) },
    ]);
  } else if (ref.type === 'tag') {
    items = items.concat([
      { label: 'Checkout', action: () => send('checkout', ref.name) },
      { label: 'Delete Tag…', action: () => send('deleteTag', { name: ref.name }) },
      { label: 'Push Tag…', action: () => send('pushTag', { name: ref.name }) },
    ]);
  } else if (ref.type === 'stash') {
    items = items.concat([
      { label: 'Apply Stash', action: () => send('stashApply', { ref: ref.name }) },
      { label: 'Pop Stash', action: () => send('stashPop', { ref: ref.name }) },
      { label: 'Create Branch from Stash…', action: () => send('stashBranch', { ref: ref.name }) },
      { label: 'Drop Stash…', action: () => send('stashDrop', { ref: ref.name }) },
    ]);
  }
  placeMenu(buildMenu(items), x, y);
}

// ─── find widget (ported) ────────────────────────────────────────────────────
function openFind() {
  const w = document.getElementById('find-widget');
  w.classList.add('visible');
  document.getElementById('find-input').focus();
  document.getElementById('find-input').select();
}
function closeFind() {
  document.getElementById('find-widget').classList.remove('visible');
  clearFindHighlights();
  findMatches = [];
  findIndex = -1;
}
function clearFindHighlights() {
  document.querySelectorAll('.find-match,.find-current').forEach((el) =>
    el.classList.remove('find-match', 'find-current'));
}
function runFind(term) {
  clearFindHighlights();
  findMatches = [];
  findIndex = -1;
  const q = term.trim().toLowerCase();
  document.getElementById('find-count').textContent = '';
  if (!q || !graphData) return;
  graphData.commits.forEach((c) => {
    if (c.kind === 'uncommitted') return;
    const hay = (c.message + ' ' + (c.author || '') + ' ' + (c.committer || '') + ' ' + c.sha + ' ' +
      (c.refs || []).map((r) => r.name).join(' ')).toLowerCase();
    if (hay.includes(q)) findMatches.push(c.sha);
  });
  findMatches.forEach((sha) => {
    const tr = document.querySelector('#graph-body tr[data-sha="' + cssEsc(sha) + '"]');
    if (tr) tr.classList.add('find-match');
  });
  if (findMatches.length) { findIndex = 0; gotoMatch(); }
  updateFindCount();
}
function updateFindCount() {
  document.getElementById('find-count').textContent =
    findMatches.length ? (findIndex + 1) + ' / ' + findMatches.length : 'No results';
}
function gotoMatch() {
  if (findIndex < 0 || findIndex >= findMatches.length) return;
  document.querySelectorAll('.find-current').forEach((el) => el.classList.remove('find-current'));
  const sha = findMatches[findIndex];
  const tr = document.querySelector('#graph-body tr[data-sha="' + cssEsc(sha) + '"]');
  if (tr) { tr.classList.add('find-current'); tr.scrollIntoView({ block: 'center' }); }
  updateFindCount();
}
function findNext(dir) {
  if (!findMatches.length) return;
  findIndex = (findIndex + dir + findMatches.length) % findMatches.length;
  gotoMatch();
}

// ─── helpers (ported) ────────────────────────────────────────────────────────
function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  if (CONFIG.dateFormat === 'iso') return d.toISOString().slice(0, 19).replace('T', ' ');
  if (CONFIG.dateFormat === 'relative') {
    const diff = Date.now() - d.getTime();
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
    if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
    if (diff < 7 * 86400000) return Math.floor(diff / 86400000) + 'd ago';
    return d.toLocaleDateString();
  }
  // 'standard' (default): an absolute date + time, e.g. "2 Jun 2026, 14:32".
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) +
    ', ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function cssEsc(s) { return String(s).replace(/["\\]/g, '\\$&'); }

// ─── ahead/behind + in-progress banner ───────────────────────────────────────
function applyAheadBehind(ab) {
  const pull = document.getElementById('badge-pull');
  const push = document.getElementById('badge-push');
  const behind = ab && ab.behind ? ab.behind : 0;
  const ahead = ab && ab.ahead ? ab.ahead : 0;
  pull.textContent = behind ? '↓' + behind : '';
  pull.classList.toggle('visible', behind > 0);
  push.textContent = ahead ? '↑' + ahead : '';
  push.classList.toggle('visible', ahead > 0);
}
function applyInProgress(kind) {
  const banner = document.getElementById('inprogress-banner');
  if (!kind) { banner.classList.remove('visible'); return; }
  banner.classList.add('visible');
  banner.dataset.kind = kind;
  document.getElementById('inprogress-text').textContent =
    kind.charAt(0).toUpperCase() + kind.slice(1) + ' in progress';
  // merge has no --skip
  document.getElementById('seq-skip').style.display = kind === 'merge' ? 'none' : '';
}

// ─── column resizers ─────────────────────────────────────────────────────────
function wireResizers() {
  document.querySelectorAll('.col-resizer').forEach((handle) => {
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const key = handle.dataset.col;
      const th = handle.closest('th');
      const startX = e.clientX;
      const startW = th.getBoundingClientRect().width;
      const onMove = (ev) => {
        const w = Math.max(40, startW + (ev.clientX - startX));
        th.style.width = w + 'px';
        if (key !== 'desc') {
          colWidths[key] = w;
          document.querySelectorAll('td.col-' + key).forEach((td) => { td.style.width = w + 'px'; });
          // Re-fit Description so widening a metadata column shrinks it instead
          // of pushing the table past the window.
          updateDescriptionColumnWidth();
        }
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        savePersisted();
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  });
}

// ─── message handling ─────────────────────────────────────────────────────────
window.addEventListener('message', (event) => {
  const msg = event.data;
  switch (msg.type) {
    case 'config': {
      const previousColumns = CONFIG.columns;
      CONFIG = Object.assign(CONFIG, msg.data || {});
      CONFIG.columns = Object.assign({}, previousColumns, (msg.data && msg.data.columns) || {});
      if (graphData) {
        layoutRows = buildLayout(graphData.commits);
        renderTable(layoutRows);
        applyTrace();
      }
      break;
    }
    case 'empty':
      document.getElementById('loading').style.display = 'none';
      document.getElementById('empty-state').style.display = 'block';
      document.getElementById('graph-body').innerHTML = '';
      announce('No Git repository is active.');
      break;
    case 'graphData': {
      graphData = msg.data;
      const hadExpanded = !!document.getElementById('cdv-row');
      document.getElementById('loading').style.display = 'none';
      document.getElementById('empty-state').style.display = 'none';
      document.getElementById('main').classList.remove('loading');
      renderRepoDropdown(graphData.repos);
      renderBranchDropdown(graphData.branches);
      const rb = document.getElementById('showRemoteBranchesCheckbox');
      if (rb && typeof graphData.showRemoteBranches === 'boolean') rb.checked = graphData.showRemoteBranches;
      applyAheadBehind(graphData.aheadBehind);
      applyInProgress(graphData.inProgress);
      buildAdjacency(graphData.commits);
      layoutRows = buildLayout(graphData.commits);
      renderTable(layoutRows);
      if (trackingEnabled) {
        applyTrackingSelection({ scroll: true });
      } else {
        // Re-open the previously expanded commit if it still exists, else clear.
        const stillThere = selectedSha && layoutRows.find((r) => r.commit.sha === selectedSha);
        if (stillThere) {
          const tr = document.querySelector('#graph-body tr[data-sha="' + cssEsc(selectedSha) + '"]');
          if (tr) {
            tr.classList.add('selected');
            if (hadExpanded) {
              openExpandedRow(stillThere.commit, tr);
              vscode.postMessage({ type: 'requestFiles', data: selectedSha });
            }
          }
        } else {
          selectedSha = null;
        }
      }
      applyTrace();
      const commitCount = graphData.commits.filter((c) => c.kind !== 'uncommitted').length;
      document.getElementById('commit-count').textContent = commitCount + ' commits';
      if (commitCount !== lastAnnouncedCommitCount) {
        lastAnnouncedCommitCount = commitCount;
        announce(`${commitCount} commits loaded.`);
      }
      break;
    }
    case 'files':
      renderFiles(msg.data.sha, msg.data.files);
      break;
    case 'comparisonFiles':
      // Only render if the comparison is still the active one.
      if (selectedSha === msg.data.from && compareSha === msg.data.to) {
        renderComparisonFiles(msg.data.from, msg.data.to, msg.data.files);
      }
      break;
  }
});

function renderComparisonFiles(fromSha, toSha, files) {
  cdvFilesCache = { sha: fromSha, toSha, files };
  const host = document.getElementById('cdvFiles');
  if (!host) return;
  renderFilePane(host, files, (f) => {
    vscode.postMessage({ type: 'openComparisonDiff', data: { from: fromSha, to: toSha, path: f.path } });
  }, 'No differences.');
}

function renderRepoDropdown(repos) {
  if (!repoDropdown) return;
  const list = repos || [];
  const active = list.find((r) => r.active);
  repoDropdown.setOptions(
    list.map((r) => ({ name: r.name, value: r.root })),
    active ? [active.root] : (list[0] ? [list[0].value] : []),
  );
  // Hide the whole Repo control when there's only one repository.
  document.getElementById('repoControl').style.display = list.length > 1 ? '' : 'none';
}

function renderBranchDropdown(branches) {
  if (!branchDropdown) return;
  // First option is the "Show All" pseudo-entry (value = SHOW_ALL_BRANCHES).
  const opts = [{ name: 'Show All', value: SHOW_ALL_BRANCHES }];
  (branches || []).forEach((b) => opts.push({ name: b, value: b }));
  const selected = (currentBranches && currentBranches.length && !(currentBranches.length === 1 && currentBranches[0] === SHOW_ALL_BRANCHES))
    ? currentBranches
    : [SHOW_ALL_BRANCHES];
  branchDropdown.setOptions(opts, selected);
}

// ─── controls wiring ──────────────────────────────────────────────────────────
function wireControls() {
  const send = (type, data) => vscode.postMessage({ type, data });

  // Repo dropdown (single-select) — switches the active repository.
  repoDropdown = new Dropdown('repoDropdown', false, false, 'Repos', (values) => {
    if (values[0]) send('switchRepo', { root: values[0] });
  });
  // Branches dropdown (multi-select) — filters the graph by branch.
  branchDropdown = new Dropdown('branchDropdown', false, true, 'Branches', (values) => {
    currentBranches = values;
    send('setBranchFilter', { branches: (values.length === 1 && values[0] === SHOW_ALL_BRANCHES) ? [] : values });
  });

  document.getElementById('showRemoteBranchesCheckbox').addEventListener('change', (e) => {
    send('setShowRemoteBranches', e.target.checked);
  });

  document.getElementById('tb-pull').addEventListener('click', () => send('pull'));
  document.getElementById('tb-push').addEventListener('click', () => send('push'));
  document.getElementById('tb-fetch').addEventListener('click', () => send('fetch'));
  document.getElementById('tb-commit').addEventListener('click', () => send('commitOpen'));
  document.getElementById('tb-branch').addEventListener('click', () => send('createBranchInteractive'));
  document.getElementById('tb-merge').addEventListener('click', () => send('toolbarMerge'));
  document.getElementById('tb-stash').addEventListener('click', () => send('toolbarStash'));

  document.getElementById('tb-find').addEventListener('click', openFind);
  document.getElementById('tb-columns').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleColumnsMenu();
  });
  document.getElementById('columns-menu').addEventListener('click', (e) => {
    e.stopPropagation();
    const input = e.target.closest('input[data-column-key]');
    if (input) setColumnVisibility(input.dataset.columnKey, input.checked);
  });
  document.getElementById('tb-tracking').addEventListener('click', () => {
    setTrackingEnabled(!trackingEnabled);
  });
  updateTrackingButton();
  document.getElementById('tb-trace').addEventListener('click', cycleTraceMode);
  updateTraceButton();
  document.getElementById('tb-refresh').addEventListener('click', () => {
    document.getElementById('main').classList.add('loading');
    send('refresh');
  });

  // sequencer banner
  document.getElementById('seq-continue').addEventListener('click', () =>
    send('seqContinue', { kind: document.getElementById('inprogress-banner').dataset.kind }));
  document.getElementById('seq-skip').addEventListener('click', () =>
    send('seqSkip', { kind: document.getElementById('inprogress-banner').dataset.kind }));
  document.getElementById('seq-abort').addEventListener('click', () =>
    send('seqAbort', { kind: document.getElementById('inprogress-banner').dataset.kind }));

  // find
  const findInput = document.getElementById('find-input');
  findInput.addEventListener('input', (e) => runFind(e.target.value));
  findInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); findNext(e.shiftKey ? -1 : 1); }
    else if (e.key === 'Escape') { closeFind(); }
  });
  document.getElementById('find-prev').addEventListener('click', () => findNext(-1));
  document.getElementById('find-next').addEventListener('click', () => findNext(1));
  document.getElementById('find-close').addEventListener('click', closeFind);

  const createTagModal = document.getElementById('create-tag-modal');
  const createTagForm = document.getElementById('create-tag-form');
  const createTagAnnotated = document.getElementById('create-tag-annotated');
  const createTagSigned = document.getElementById('create-tag-signed');
  createTagAnnotated.addEventListener('change', syncCreateTagMessageState);
  createTagSigned.addEventListener('change', () => {
    if (createTagSigned.checked) createTagAnnotated.checked = true;
    syncCreateTagMessageState();
  });
  document.getElementById('create-tag-close').addEventListener('click', closeCreateTagModal);
  document.getElementById('create-tag-cancel').addEventListener('click', closeCreateTagModal);
  createTagModal.addEventListener('click', (e) => {
    if (e.target === createTagModal) closeCreateTagModal();
  });
  createTagForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('create-tag-name').value.trim();
    const message = document.getElementById('create-tag-message').value.trim();
    const signed = document.getElementById('create-tag-signed').checked;
    if (!name) return;
    if (signed && !message) {
      document.getElementById('create-tag-message').focus();
      return;
    }
    send('createTag', {
      sha: createTagForm.dataset.sha,
      name,
      message: message || undefined,
      annotate: document.getElementById('create-tag-annotated').checked,
      sign: signed,
      force: document.getElementById('create-tag-force').checked,
      push: document.getElementById('create-tag-push').checked,
    });
    closeCreateTagModal();
  });

  // global keys
  document.addEventListener('keydown', (e) => {
    const typing = e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA');
    if (e.key === 'Escape' && !createTagModal.hidden) { e.preventDefault(); closeCreateTagModal(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); openFind(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r') { e.preventDefault(); document.getElementById('main').classList.add('loading'); send('refresh'); }
    else if (!typing && e.key === 'ArrowDown') { e.preventDefault(); moveSelection(1); }
    else if (!typing && e.key === 'ArrowUp') { e.preventDefault(); moveSelection(-1); }
    else if (!typing && e.key === 'Home') { e.preventDefault(); selectIndex(0); }
    else if (!typing && e.key === 'End') { e.preventDefault(); selectIndex(layoutRows.length - 1); }
  });

  document.addEventListener('click', () => {
    document.getElementById('context-menu').classList.remove('visible');
    closeColumnsMenu();
  });
  window.addEventListener('resize', () => {
    updateDescriptionColumnWidth();
    // Keep an open commit-details panel pinned to the viewport width.
    if (document.getElementById('cdv-row')) sizeExpandedPanel();
  });

  wireResizers();
}

paintToolbarIcons();
wireControls();
vscode.postMessage({ type: 'ready' });
