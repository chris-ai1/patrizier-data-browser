// Authors: Christian Reitwiessner
export function parseReport(text) {
  const result = { files: [], resources: [], scenes: [] };
  for (const line of text.trim().split('\n')) {
    const fields = line.split('\t');
    if (fields[0] === 'file') result.files.push({ id: result.files.length, path: fields[1], size: Number(fields[2]), hash: fields[3] });
    if (fields[0] === 'decoded') result.resources.push({ id: result.resources.length, path: fields[1], chunk: Number(fields[2]), size: Number(fields[3]), hash: fields[4] });
    if (fields[0] === 'frame') result.scenes.push({ id: Number(fields[1]), path: fields[2], width: Number(fields[3]), height: Number(fields[4]), hash: fields[5] });
  }
  for (const file of result.files) {
    file.name = file.path.split('/').at(-1);
    file.category = category(file.path);
    file.resources = result.resources.filter(r => r.path === file.path);
    file.scene = result.scenes.find(s => s.path === file.path);
  }
  return result;
}
export function category(path) {
  if (/\.fdl$/i.test(path)) return 'images';
  if (/\/(mdat|smpl)\./i.test(path)) return 'audio';
  return 'data';
}
export function hexDump(bytes, offset = 0, size = 512) {
  const rows = ['OFFSET    00 01 02 03 04 05 06 07 08 09 0A 0B 0C 0D 0E 0F   TEXT'];
  for (let i = offset; i < Math.min(bytes.length, offset + size); i += 16) {
    const data = bytes.subarray(i, Math.min(i + 16, bytes.length));
    const hex = [...data].map(b => b.toString(16).padStart(2, '0')).join(' ').padEnd(47);
    const text = [...data].map(b => b >= 32 && b <= 126 ? String.fromCharCode(b) : '·').join('');
    rows.push(i.toString(16).padStart(8, '0') + '  ' + hex + '   ' + text);
  }
  return rows.join('\n');
}
export function strings(bytes) {
  const lines = [];
  let start = 0, text = '';
  function flush() { if (text.length >= 4) lines.push(start.toString(16).padStart(8, '0') + '  ' + text); text = ''; }
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b >= 32 && b <= 126) { if (!text) start = i; text += String.fromCharCode(b); }
    else flush();
  }
  flush();
  return lines.join('\n') || 'No printable strings of four or more characters.';
}
export function pcmWav(bytes, sampleRate) {
  if (!Number.isInteger(sampleRate) || sampleRate < 3000 || sampleRate > 48000) throw new Error('Choose a sample rate between 3000 and 48000 Hz.');
  const out = new Uint8Array(44 + bytes.length + (bytes.length & 1));
  const view = new DataView(out.buffer);
  const text = (offset, value) => [...value].forEach((c, i) => out[offset + i] = c.charCodeAt(0));
  text(0, 'RIFF'); view.setUint32(4, out.length - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate, true); view.setUint16(32, 1, true); view.setUint16(34, 8, true);
  text(36, 'data'); view.setUint32(40, bytes.length, true);
  for (let i = 0; i < bytes.length; i++) out[i + 44] = bytes[i] ^ 128;
  return out;
}
export function sizeLabel(size) { return size >= 1024 ? `${(size / 1024).toFixed(1)} KiB` : `${size} B`; }
