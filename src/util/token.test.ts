import { test } from "node:test";
import assert from "node:assert";
import { safeEqual, makeToken } from "./token";

test("safeEqual is true only for identical strings", () => {
  assert.strictEqual(safeEqual("abc123", "abc123"), true);
  assert.strictEqual(safeEqual("abc123", "abc124"), false);
});

test("safeEqual is false (and does not throw) for different lengths", () => {
  assert.strictEqual(safeEqual("short", "longer-value"), false);
  assert.strictEqual(safeEqual("", "x"), false);
  assert.strictEqual(safeEqual("", ""), true);
});

test("makeToken returns a fresh 256-bit hex token each call", () => {
  const a = makeToken();
  const b = makeToken();
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notStrictEqual(a, b);
});
