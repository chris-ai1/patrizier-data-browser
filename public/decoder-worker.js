// Authors: Christian Reitwiessner
import { parseReport } from './formats.js';
let api;
const ready = (async () => {
  const response = await fetch('./patrizier.wasm');
  if (!response.ok) throw new Error(`Could not load decoder (${response.status}).`);
  const { instance } = await WebAssembly.instantiate(await response.arrayBuffer(), {});
  api = instance.exports;
})();
const text = (pointer, length) => new TextDecoder().decode(new Uint8Array(api.memory.buffer, pointer, length));
const error = () => new Error(text(api.error_ptr(), api.error_len()));
const copy = (pointer, length) => new Uint8Array(api.memory.buffer, pointer, length).slice();
self.onmessage = async ({ data: message }) => {
  const { id, method, args = {} } = message;
  try {
    await ready;
    let value;
    if (method === 'ready') value = true;
    else if (method === 'load') {
      if (args.buffer.byteLength > 16 * 1024 * 1024) throw new Error('Reference archive exceeds 16 MiB.');
      const pointer = api.input_resize(args.buffer.byteLength);
      if (!pointer) throw error();
      new Uint8Array(api.memory.buffer, pointer, args.buffer.byteLength).set(new Uint8Array(args.buffer));
      if (!api.load_reference()) throw error();
      value = parseReport(text(api.report_ptr(), api.report_len()));
    } else if (method === 'file') {
      if (!api.select_file(args.index)) throw new Error('File is not available.');
      value = copy(api.file_ptr(), api.file_len());
    } else if (method === 'resource') {
      if (!api.select_resource(args.index)) throw new Error('Decoded resource is not available.');
      value = copy(api.resource_ptr(), api.resource_len());
    } else if (method === 'frame' || method === 'bitmap' || method === 'resourceFrame') {
      if (method === 'frame' && !api.select_scene(args.index)) throw new Error('Screen is not available.');
      if (method === 'resourceFrame' && !api.render_screen_resource(args.index)) throw error();
      if (method === 'bitmap' && !api.render_bitmap(args.index, args.offset, args.width, args.height, args.depth, args.palette)) throw error();
      const width = api.frame_width(), height = api.frame_height();
      value = { width, height, rgba: copy(api.frame_ptr(), width * height * 4) };
    } else throw new Error('Unknown decoder operation.');
    const transfer = value instanceof Uint8Array ? [value.buffer] : value?.rgba ? [value.rgba.buffer] : [];
    self.postMessage({ id, value }, transfer);
  } catch (error) { self.postMessage({ id, error: error.message }); }
};
