import { test } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  buildDocumentationData,
  DocumentationManifest,
} from "./documentationContent";

const manifest = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
) as DocumentationManifest;

test("documentation catalog covers every contributed operation exactly once", () => {
  const data = buildDocumentationData(manifest);
  const documented = data.operationCategories.flatMap((category) =>
    category.operations.map((operation) => operation.command),
  );
  const contributed = (manifest.contributes?.commands ?? []).map(
    (command) => command.command,
  );

  assert.deepStrictEqual([...documented].sort(), [...contributed].sort());
  assert.strictEqual(new Set(documented).size, documented.length);
  assert.strictEqual(data.operationCount, contributed.length);
});

test("documentation entries include definitions, purposes, and usage guidance", () => {
  const data = buildDocumentationData(manifest);

  assert.ok(data.components.length >= 15);
  assert.ok(data.glossary.length >= 60);
  for (const entry of [...data.components, ...data.glossary]) {
    assert.ok(entry.name);
    assert.ok(entry.definition);
    assert.ok(entry.purpose);
    assert.ok(entry.use);
  }
  for (const category of data.operationCategories) {
    assert.ok(category.purpose);
    assert.ok(category.workflow);
    for (const operation of category.operations) {
      assert.ok(operation.title);
      assert.ok(operation.purpose);
      assert.ok(operation.use);
    }
  }
});

test("context-only operations are not presented as directly runnable", () => {
  const data = buildDocumentationData(manifest);
  const hidden = new Set(
    (manifest.contributes?.menus?.commandPalette ?? [])
      .filter((entry) => entry.when === "false")
      .map((entry) => entry.command),
  );
  const operations = data.operationCategories.flatMap(
    (category) => category.operations,
  );

  assert.strictEqual(
    data.paletteOperationCount,
    data.operationCount - hidden.size,
  );
  for (const operation of operations) {
    assert.strictEqual(operation.runnable, !hidden.has(operation.command));
  }
});
