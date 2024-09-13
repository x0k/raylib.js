import { it, describe, beforeEach } from "node:test";
import assert from "node:assert";

import { SharedQueue } from "./shared_queue.js";

let buffer;
let w;
let r;

describe("SharedQueue Tests", () => {
  beforeEach(() => {
    buffer = new ArrayBuffer(32);
    w = new SharedQueue(buffer);
    r = new SharedQueue(buffer);
  });

  it("Should store small buffer", () => {
    const arr = new Uint8Array([1, 2, 3, 4, 5, 6]);
    w.pushBytes(arr);
    w.commit();
    for (const item of r.read()) {
      assert.deepStrictEqual(item.bytes, arr);
    }
    assert.strictEqual(w.lastIndex, 4);
    assert.strictEqual(w.index, 4);
    assert.strictEqual(r.lastIndex, 4);
    assert.strictEqual(r.index, 4);
  });

  it("Should handle overlapping", () => {
    const padding = new Uint8Array(12);
    w.pushBytes(padding);
    w.commit();
    r.pop((item) => assert.deepStrictEqual(item.bytes, padding));
    const arr = new Uint8Array([1, 2, 3, 4, 5, 6]);
    w.pushBytes(arr);
    w.commit();
    for (const item of r.read()) {
      assert.deepStrictEqual(item.bytes, arr);
    }
    assert.strictEqual(w.lastIndex, 1);
    assert.strictEqual(w.index, 1);
    assert.strictEqual(r.lastIndex, 1);
    assert.strictEqual(r.index, 1);
  });

  it("Should handle multiple buffers", () => {
    const a = new Uint8Array([1, 2, 3, 4, 5, 6]);
    w.pushBytes(a);
    const b = new Uint8Array([7, 8, 9]);
    w.pushBytes(b);
    w.commit();
    const gen = r.read();
    assert.deepStrictEqual(gen.next().value.bytes, a);
    assert.deepStrictEqual(gen.next().value.bytes, b);
  });
});
