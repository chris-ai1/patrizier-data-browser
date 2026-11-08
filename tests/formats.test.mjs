// Authors: Christian Reitwiessner
import test from 'node:test';
import assert from 'node:assert/strict';
import { category, hexDump, strings, pcmWav, parseReport } from '../public/formats.js';

test('file categories use prefixes as well as extensions', () => {
  assert.equal(category('PA1/Songs/mdat.2'), 'audio');
  assert.equal(category('PA1/Songs/smpl.2'), 'audio');
  assert.equal(category('PA1/Songs/tfmx.obj'), 'data');
  assert.equal(category('PA1/Pictures/Karte.fdl'), 'images');
});
test('WAV conversion changes signed PCM to unsigned and pads odd lengths', () => {
  const wav = pcmWav(Uint8Array.of(128, 0, 127), 8363);
  assert.equal(wav.length, 48);
  assert.deepEqual([...wav.subarray(44, 47)], [0, 128, 255]);
  assert.equal(new DataView(wav.buffer).getUint32(40, true), 3);
  assert.equal(new DataView(wav.buffer).getUint32(4, true), 40);
  assert.throws(() => pcmWav(new Uint8Array(1), NaN));
});
test('hex and string views preserve offsets and escape nonprinting data', () => {
  const bytes = Uint8Array.of(0, 65, 66, 67, 68, 255);
  assert.match(strings(bytes), /^00000001  ABCD$/);
  assert.match(hexDump(bytes), /00 41 42 43 44 ff/);
  assert.match(hexDump(bytes), /·ABCD·/);
});
test('catalog associates each decoded stream with its original file', () => {
  const result = parseReport('file\tPA1/Pictures/A.fdl\t10\tabc\ndecoded\tPA1/Pictures/A.fdl\t0\t40064\tdef\nframe\t0\tPA1/Pictures/A.fdl\t320\t200\tghi\n');
  assert.equal(result.files[0].resources[0].size, 40064);
  assert.equal(result.files[0].scene.id, 0);
});
