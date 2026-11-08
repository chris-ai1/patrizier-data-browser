// Authors: Christian Reitwiessner
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parseReport } from '../public/formats.js';
const wasm = readFileSync(new URL('../dist/patrizier.wasm', import.meta.url));
const hash = data => createHash('sha256').update(data).digest('hex');
const text = (a, pointer, len) => new TextDecoder().decode(new Uint8Array(a.memory.buffer, pointer, len));
test('portable WASM rejects an unrecognized archive and remains usable', async () => {
  const { instance: { exports: a } } = await WebAssembly.instantiate(wasm, {});
  const pointer = a.input_resize(3); new Uint8Array(a.memory.buffer, pointer, 3).set([1,2,3]);
  assert.equal(a.load_reference(), 0);
  assert.match(text(a, a.error_ptr(), a.error_len()), /SHA-256 mismatch/);
  assert.equal(a.select_scene(0), 0); assert.equal(a.select_file(0), 0);
  assert.equal(a.input_resize(17 * 1024 * 1024), 0);
});
test('all original file, decoded resource and framebuffer hashes match their report', { skip: !process.env.PATRIZIER_ZIP }, async () => {
  const { instance: { exports: a } } = await WebAssembly.instantiate(wasm, {});
  const bytes = readFileSync(process.env.PATRIZIER_ZIP); const pointer = a.input_resize(bytes.length);
  new Uint8Array(a.memory.buffer, pointer, bytes.length).set(bytes);
  assert.equal(a.load_reference(), 1, text(a, a.error_ptr(), a.error_len()));
  const catalog = parseReport(text(a, a.report_ptr(), a.report_len()));
  assert.equal(catalog.files.length, 105); assert.equal(catalog.resources.length, 95); assert.equal(catalog.scenes.length, 44);
  for (const file of catalog.files) { assert.equal(a.select_file(file.id), 1); assert.equal(hash(new Uint8Array(a.memory.buffer, a.file_ptr(), a.file_len())), file.hash); }
  for (const resource of catalog.resources) { assert.equal(a.select_resource(resource.id), 1); assert.equal(hash(new Uint8Array(a.memory.buffer, a.resource_ptr(), a.resource_len())), resource.hash); }
  for (const scene of catalog.scenes) { assert.equal(a.select_scene(scene.id), 1); assert.equal(a.frame_width(), scene.width); assert.equal(hash(new Uint8Array(a.memory.buffer, a.frame_ptr(), scene.width * scene.height * 4)), scene.hash); }
  for (const resource of catalog.resources.filter(r => r.size === 40064)) { assert.equal(a.render_screen_resource(resource.id), 1); assert.equal(a.render_bitmap(resource.id, 0, 320, 200, 5, 4294967294), 1); }
  assert.equal(a.render_bitmap(0, 0xffffffff, 320, 200, 5, 0), 0);
});
