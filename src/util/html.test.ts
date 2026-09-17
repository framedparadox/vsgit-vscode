import { test } from "node:test";
import assert from "node:assert";
import { escapeHtml } from "./html";

test("escapeHtml escapes HTML-significant characters", () => {
  assert.strictEqual(
    escapeHtml(`<script>alert("x")</script> & 'ok'`),
    "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; 'ok'",
  );
});

test("escapeHtml neutralizes a double-quoted attribute breakout", () => {
  const escaped = escapeHtml(`"><img src=x onerror=alert(1)>`);
  assert.ok(!escaped.includes('"'));
  assert.ok(!escaped.includes("<"));
  assert.ok(!escaped.includes(">"));
});

test("escapeHtml leaves plain text and empty strings unchanged", () => {
  assert.strictEqual(escapeHtml("v1.0.0"), "v1.0.0");
  assert.strictEqual(escapeHtml(""), "");
});
