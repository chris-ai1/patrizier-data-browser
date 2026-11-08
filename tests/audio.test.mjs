// Authors: Christian Reitwiessner
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import createDecoder from '../public/audio/libtfmx.worklet.js';
import { parseReport } from '../public/formats.js';
test('all three supplied music banks load and render non-silent stereo PCM', { skip: !process.env.PATRIZIER_ZIP }, async () => {
  const { instance: { exports: a } } = await WebAssembly.instantiate(readFileSync(new URL('../dist/patrizier.wasm', import.meta.url)), {});
  const zip = readFileSync(process.env.PATRIZIER_ZIP), pointer = a.input_resize(zip.length);
  new Uint8Array(a.memory.buffer, pointer, zip.length).set(zip); assert.equal(a.load_reference(), 1);
  const catalog = parseReport(new TextDecoder().decode(new Uint8Array(a.memory.buffer, a.report_ptr(), a.report_len())));
  const get = path => { const file = catalog.files.find(f => f.path === path); a.select_file(file.id); return new Uint8Array(a.memory.buffer, a.file_ptr(), a.file_len()).slice(); };
  const wasm = new WebAssembly.Module(readFileSync(new URL('../public/audio/libtfmx.worklet.wasm', import.meta.url)));
  const decoder = await createDecoder({ instantiateWasm(imports, done) { const instance = new WebAssembly.Instance(wasm, imports); done(instance); return instance.exports; } });
  decoder.FS.mkdir('/song');
  for (let i = 1; i <= 3; i++) {
    const musicPath = `/song/bank${i}.tfx`, samplePath = `/song/bank${i}.sam`;
    decoder.FS.writeFile(musicPath, get(`PA1/Songs/mdat.${i}`)); decoder.FS.writeFile(samplePath, get(`PA1/Songs/smpl.${i}`));
    const handle = decoder.ccall('tfx_new', 'number', [], []);
    decoder.ccall('tfx_set_path', null, ['number', 'string'], [handle, musicPath]);
    assert.equal(decoder.ccall('tfx_load', 'number', ['number', 'string', 'number'], [handle, musicPath, 0]), 1);
    assert.equal(decoder.ccall('tfx_songs', 'number', ['number'], [handle]), i === 2 ? 9 : 1);
    decoder.ccall('tfx_mixer_init', null, ['number','number','number','number','number','number'], [handle,48000,16,2,0,100]);
    const output = decoder.ccall('tfx_malloc','number',['number'],[1920000]);
    decoder.ccall('tfx_buffer_fill',null,['number','number','number'],[handle,output,1920000]);
    assert.ok(decoder.HEAP16.subarray(output / 2, output / 2 + 960000).some(sample => sample !== 0), `bank ${i} is silent`);
    decoder.ccall('tfx_free',null,['number'],[output]); decoder.ccall('tfx_delete',null,['number'],[handle]);
    decoder.FS.unlink(musicPath); decoder.FS.unlink(samplePath);
  }
});
