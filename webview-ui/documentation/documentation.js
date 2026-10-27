(function () {
  "use strict";

  const vscode = acquireVsCodeApi();
  const previousState = vscode.getState() || {};
  const library = document.getElementById("library");
  const emptyState = document.getElementById("empty-state");
  const search = document.getElementById("library-search");
  const stats = document.getElementById("stats");
  const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
  const openFull = document.getElementById("open-full");

  let data;
  let activeSection = previousState.activeSection || "overview";
  let query = previousState.query || "";

  search.value = query;

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function appendDefinition(parent, label, text) {
    const row = element("div", "definition-row");
    row.append(element("span", "definition-label", label));
    row.append(element("p", "", text));
    parent.append(row);
  }

  function normalized(value) {
    return String(value || "").toLocaleLowerCase();
  }

  function includesQuery(values) {
    if (!query) return true;
    const needles = normalized(query).split(/\s+/).filter(Boolean);
    const haystack = normalized(values.join(" "));
    return needles.every((needle) => haystack.includes(needle));
  }

  function entryMatches(entry) {
    return includesQuery([
      entry.name,
      entry.definition,
      entry.purpose,
      entry.use,
      entry.keywords,
    ]);
  }

  function operationMatches(operation, category) {
    return includesQuery([
      category.name,
      category.purpose,
      category.workflow,
      operation.title,
      operation.command,
      operation.purpose,
      operation.use,
    ]);
  }

  function persist() {
    vscode.setState({ activeSection, query });
  }

  function selectTab(section) {
    activeSection = section;
    for (const tab of tabs) {
      const selected = tab.dataset.section === section;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    }
    persist();
    render();
  }

  function createSectionHeader(eyebrow, title, description) {
    const header = element("header", "section-header");
    header.append(element("span", "eyebrow", eyebrow));
    header.append(element("h2", "", title));
    header.append(element("p", "", description));
    return header;
  }

  function createEntry(entry, kind) {
    const details = element("details", `doc-entry ${kind}`);
    const summary = element("summary");
    summary.append(element("span", "entry-name", entry.name));
    summary.append(element("span", "summary-action", "Details"));
    details.append(summary);
    const body = element("div", "entry-body");
    appendDefinition(body, "Definition", entry.definition);
    appendDefinition(body, "Purpose", entry.purpose);
    appendDefinition(body, "How to use", entry.use);
    details.append(body);
    if (query) details.open = true;
    return details;
  }

  function renderEntryList(entries, kind) {
    const fragment = document.createDocumentFragment();
    for (const entry of entries) fragment.append(createEntry(entry, kind));
    return fragment;
  }

  function renderOverview(target) {
    target.append(
      createSectionHeader(
        "Start here",
        "A working map of Git and VsGit",
        "Use the library to understand a concept, find the right surface, or locate an exact operation.",
      ),
    );

    const workflow = element("section", "workflow");
    const steps = [
      ["01", "Choose a repository", "Select it in Repositories so every VsGit view follows the same active project."],
      ["02", "Review changes", "Open diffs, separate staged from unstaged work, and resolve conflicts before committing."],
      ["03", "Record intent", "Commit one coherent change with a useful message and optional sign-off or GPG signature."],
      ["04", "Synchronize safely", "Fetch to inspect remote work, integrate with pull or rebase, then push reviewed history."],
      ["05", "Recover deliberately", "Use status, history, graph, and reflog before reset, clean, prune, or other destructive actions."],
    ];
    for (const [number, title, copy] of steps) {
      const row = element("div", "workflow-step");
      row.append(element("span", "step-number", number));
      const text = element("div");
      text.append(element("h3", "", title), element("p", "", copy));
      row.append(text);
      workflow.append(row);
    }
    target.append(workflow);

    const statusGrid = element("section", "status-grid");
    statusGrid.append(
      createStatusBlock(
        "Added now",
        "Included in this implementation",
        data.added,
        "added",
      ),
      createStatusBlock(
        "Future enhancements",
        "Planned, not represented as complete",
        data.pending,
        "pending",
      ),
    );
    target.append(statusGrid);

    const guide = element("aside", "library-guide");
    guide.append(element("strong", "", "How the operation catalog stays current"));
    guide.append(
      element(
        "p",
        "",
        `The catalog is generated from the extension manifest. It currently covers all ${data.operationCount} contributed operations; ${data.paletteOperationCount} can run from the Command Palette and the rest appear only where their required repository object is available.`,
      ),
    );
    target.append(guide);
  }

  function createStatusBlock(eyebrow, title, items, variant) {
    const block = element("div", `status-block ${variant}`);
    block.append(element("span", "eyebrow", eyebrow));
    block.append(element("h3", "", title));
    const list = element("ul");
    for (const item of items) list.append(element("li", "", item));
    block.append(list);
    return block;
  }

  function renderComponents(target, entries) {
    target.append(
      createSectionHeader(
        `${entries.length} extension surfaces`,
        "Components and how to use them",
        "Each component has one primary job. Start with the active repository, then move to the surface that matches the task.",
      ),
    );
    const list = element("div", "entry-list");
    list.append(renderEntryList(entries, "component-entry"));
    target.append(list);
  }

  function renderGlossary(target, entries) {
    target.append(
      createSectionHeader(
        `${entries.length} key terms`,
        "Git glossary",
        "Definitions include the reason a concept exists and the practical way it appears in VsGit.",
      ),
    );
    const list = element("div", "entry-list glossary-list");
    list.append(renderEntryList(entries, "glossary-entry"));
    target.append(list);
  }

  function createOperation(operation) {
    const item = element("article", "operation-entry");
    const titleRow = element("div", "operation-title-row");
    const title = element("div");
    title.append(element("h4", "", operation.title));
    title.append(element("code", "", operation.command));
    titleRow.append(title);
    titleRow.append(
      element(
        "span",
        `availability ${operation.runnable ? "palette" : "context"}`,
        operation.runnable ? "Command Palette" : "Context action",
      ),
    );
    item.append(titleRow);
    appendDefinition(item, "Purpose", operation.purpose);
    appendDefinition(item, "How to use", operation.use);
    if (operation.runnable) {
      const run = element("button", "run-operation", "Run operation");
      run.type = "button";
      run.dataset.command = operation.command;
      item.append(run);
    }
    return item;
  }

  function createOperationCategory(category, operations, forceOpen) {
    const details = element("details", "operation-category");
    details.open = forceOpen;
    const summary = element("summary");
    const summaryText = element("div");
    summaryText.append(element("h3", "", category.name));
    summaryText.append(element("p", "", category.purpose));
    summary.append(summaryText);
    summary.append(
      element(
        "span",
        "operation-count",
        `${operations.length} operation${operations.length === 1 ? "" : "s"}`,
      ),
    );
    details.append(summary);

    const guidance = element("div", "category-guidance");
    appendDefinition(guidance, "Workflow", category.workflow);
    if (category.caution) {
      appendDefinition(guidance, "Caution", category.caution);
    }
    details.append(guidance);

    const operationList = element("div", "operation-list");
    for (const operation of operations) {
      operationList.append(createOperation(operation));
    }
    details.append(operationList);
    return details;
  }

  function renderOperations(target, categories, forceOpen) {
    const count = categories.reduce(
      (total, category) => total + category.operations.length,
      0,
    );
    target.append(
      createSectionHeader(
        `${count} operations`,
        "Complete operation catalog",
        "Every contributed VsGit command is grouped by workflow. Context actions appear only where VS Code can supply the required file, ref, commit, or resource group.",
      ),
    );
    const list = element("div", "operation-categories");
    for (const category of categories) {
      list.append(
        createOperationCategory(category, category.operations, forceOpen),
      );
    }
    target.append(list);
  }

  function renderSearchResults(target) {
    const components = data.components.filter(entryMatches);
    const glossary = data.glossary.filter(entryMatches);
    const categories = data.operationCategories
      .map((category) => ({
        ...category,
        operations: category.operations.filter((operation) =>
          operationMatches(operation, category),
        ),
      }))
      .filter((category) => category.operations.length > 0);
    const operationCount = categories.reduce(
      (total, category) => total + category.operations.length,
      0,
    );
    const total = components.length + glossary.length + operationCount;

    target.append(
      createSectionHeader(
        `${total} matches`,
        `Search results for “${query}”`,
        "Results are drawn from components, glossary definitions, purposes, usage guidance, command titles, and command IDs.",
      ),
    );

    if (components.length) {
      const group = element("section", "search-group");
      group.append(element("h3", "", `Components · ${components.length}`));
      group.append(renderEntryList(components, "component-entry"));
      target.append(group);
    }
    if (glossary.length) {
      const group = element("section", "search-group");
      group.append(element("h3", "", `Glossary · ${glossary.length}`));
      group.append(renderEntryList(glossary, "glossary-entry"));
      target.append(group);
    }
    if (operationCount) {
      const group = element("section", "search-group");
      group.append(element("h3", "", `Operations · ${operationCount}`));
      const list = element("div", "operation-categories");
      for (const category of categories) {
        list.append(createOperationCategory(category, category.operations, true));
      }
      group.append(list);
      target.append(group);
    }

    emptyState.hidden = total !== 0;
  }

  function render() {
    if (!data) return;
    library.replaceChildren();
    emptyState.hidden = true;
    library.setAttribute("aria-busy", "false");

    if (query) {
      renderSearchResults(library);
      return;
    }

    if (activeSection === "components") {
      renderComponents(library, data.components);
    } else if (activeSection === "glossary") {
      renderGlossary(library, data.glossary);
    } else if (activeSection === "operations") {
      renderOperations(library, data.operationCategories, false);
    } else {
      renderOverview(library);
    }
  }

  function updateStats() {
    stats.replaceChildren();
    const values = [
      [`v${data.version}`, "extension"],
      [String(data.components.length), "components"],
      [String(data.glossary.length), "Git terms"],
      [String(data.operationCount), "operations"],
    ];
    for (const [value, label] of values) {
      const item = element("span", "stat");
      item.append(element("strong", "", value), document.createTextNode(` ${label}`));
      stats.append(item);
    }
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => selectTab(tab.dataset.section));
    tab.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
        return;
      }
      event.preventDefault();
      let target = index;
      if (event.key === "ArrowRight") target = (index + 1) % tabs.length;
      if (event.key === "ArrowLeft") target = (index - 1 + tabs.length) % tabs.length;
      if (event.key === "Home") target = 0;
      if (event.key === "End") target = tabs.length - 1;
      tabs[target].focus();
      selectTab(tabs[target].dataset.section);
    });
  });

  search.addEventListener("input", () => {
    query = search.value.trim();
    persist();
    render();
  });

  document.addEventListener("keydown", (event) => {
    const tag = document.activeElement && document.activeElement.tagName;
    if (
      event.key === "/" &&
      tag !== "INPUT" &&
      tag !== "TEXTAREA" &&
      tag !== "SELECT"
    ) {
      event.preventDefault();
      search.focus();
    } else if (event.key === "Escape" && query) {
      search.value = "";
      query = "";
      persist();
      render();
      search.focus();
    }
  });

  library.addEventListener("click", (event) => {
    const button = event.target.closest(".run-operation");
    if (button && button.dataset.command) {
      vscode.postMessage({
        type: "runCommand",
        command: button.dataset.command,
      });
    }
  });

  openFull?.addEventListener("click", () =>
    vscode.postMessage({ type: "openFull" }),
  );

  window.addEventListener("message", (event) => {
    if (event.data?.type !== "documentationData") return;
    data = event.data.data;
    updateStats();
    selectTab(activeSection);
  });

  vscode.postMessage({ type: "ready" });
})();
