import { test } from "node:test";
import assert from "node:assert";
import { escapeHtml } from "./html";

test("escapeHtml escapes all HTML-significant characters", () => {
  assert.strictEqual(
    escapeHtml(`<script>alert("x")</script> & 'ok'`),
    "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; 'ok'",
  );
});

test("escapeHtml neutralizes an attribute-breakout attempt", () => {
  const malicious = `"><img src=x onerror=alert(1)>`;
  const escaped = escapeHtml(malicious);
  assert.ok(!escaped.includes('"'));
  assert.ok(!escaped.includes("<"));
  assert.ok(!escaped.includes(">"));
});

test("escapeHtml leaves plain text untouched", () => {
  assert.strictEqual(escapeHtml("v1.0.0"), "v1.0.0");
  assert.strictEqual(escapeHtml("abcdef1"), "abcdef1");
});

test("escapeHtml handles empty string", () => {
  assert.strictEqual(escapeHtml(""), "");
});
