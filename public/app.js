// Authors: Christian Reitwiessner
import { hexDump, strings, pcmWav, sizeLabel } from './formats.js';
import { MusicPlayer } from './music.js';
const $ = id => document.getElementById(id);
const worker = new Worker('./decoder-worker.js', { type: 'module' });
const pending = new Map();
let sequence = 0, catalog, selected, raw, decoded, view = 'preview', category = 'all', generation = 0, hexPage = 0, paused = false, duration = 0, sampleUrl, playingFile;
function call(method, args = {}, transfer = []) {
  return new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); worker.postMessage({ id, method, args }, transfer); });
}
worker.onmessage = ({ data }) => { const request = pending.get(data.id); if (!request) return; pending.delete(data.id); data.error ? request.reject(new Error(data.error)) : request.resolve(data.value); };
worker.onerror = event => { for (const request of pending.values()) request.reject(new Error(event.message || 'The local decoder failed.')); pending.clear(); notice('The local decoder failed. Reload the page to try again.', true); };
function notice(text, error = false) { $('notice').textContent = text; $('notice').classList.toggle('error', error); }
function download(bytes, name, type = 'application/octet-stream') {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes], { type });
  const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 10000);
}
function files() {
  if (!catalog) return;
  const restoreFocus = document.activeElement?.classList.contains('file-row');
  const query = $('search').value.toLowerCase();
  const matches = catalog.files.filter(f => (category === 'all' || f.category === category) && f.path.toLowerCase().includes(query));
  const fragment = document.createDocumentFragment();
  for (const file of matches) {
    const button = document.createElement('button'); button.className = 'file-row'; button.dataset.id = file.id; button.setAttribute('aria-current', String(selected?.id === file.id));
    const symbol = document.createElement('span'); symbol.className = 'file-symbol'; symbol.textContent = { images: '▧', audio: '♫', data: '≡' }[file.category]; symbol.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span'); label.className = 'file-label';
    const name = document.createElement('strong'); name.textContent = file.name; const path = document.createElement('small'); path.textContent = file.path.split('/').slice(0, -1).join('/'); label.append(name, path);
    const size = document.createElement('span'); size.className = 'file-size'; size.textContent = sizeLabel(file.size); button.append(symbol, label, size);
    button.addEventListener('click', () => selectFile(file).catch(showError)); fragment.append(button);
  }
  if (!matches.length) { const empty = document.createElement('p'); empty.className = 'library-empty'; empty.textContent = 'No matching files.'; fragment.append(empty); }
  $('files').replaceChildren(fragment); $('count').textContent = `${matches.length} / ${catalog.files.length}`;
  if (restoreFocus) $('files').querySelector('[aria-current=true]')?.focus();
}
function showError(error) { notice(error.message, true); }
function stopAudio() {
  playingFile = undefined; player.stop(); $('sample-player').pause(); $('pause').disabled = $('stop').disabled = true; $('play').disabled = false;
  $('pause').textContent = 'Pause'; paused = false; $('progress').value = 0; duration = 0;
  if (sampleUrl) { URL.revokeObjectURL(sampleUrl); sampleUrl = undefined; $('sample-player').removeAttribute('src'); $('sample-player').load(); }
}
const player = new MusicPlayer(message => {
  if (!selected?.name.startsWith('mdat.') || selected.id !== playingFile) return;
  if (message.cmd === 'meta') {
    duration = message.meta.dur;
    const previous = $('subsong').value; $('subsong').replaceChildren();
    for (let i = 0; i < message.meta.songs.length; i++) { const option = new Option(String(i + 1), String(i)); $('subsong').add(option); }
    if (Number(previous) < $('subsong').options.length) $('subsong').value = previous;
    $('subsong').disabled = false; $('pause').disabled = $('stop').disabled = false;
    $('music-info').textContent = `${message.meta.type} · ${message.meta.songs.length} track${message.meta.songs.length === 1 ? '' : 's'}`;
    $('audio-status').textContent = 'Playing locally.';
  } else if (message.cmd === 'pos') {
    $('progress').value = duration > 0 ? Math.min(1, message.pos / duration) : 0;
    $('audio-status').textContent = `${paused ? 'Paused' : 'Playing'} · ${Math.floor(message.pos / 60)}:${String(Math.floor(message.pos % 60)).padStart(2, '0')}`;
  } else if (message.cmd === 'end') { stopAudio(); $('audio-status').textContent = 'Track ended.'; }
  else if (message.cmd === 'err') { stopAudio(); $('audio-status').textContent = message.detail || 'The audio decoder could not play this track.'; }
});
async function selectFile(file) {
  const token = ++generation; stopAudio(); clearImage(); selected = file; raw = decoded = undefined; hexPage = 0;
  $('welcome').hidden = true; $('inspector').hidden = false;
  $('file-name').textContent = file.name; $('file-path').textContent = file.path.split('/').slice(0, -1).join(' / ');
  $('file-size').textContent = `${sizeLabel(file.size)} · ${file.size.toLocaleString()} bytes`; $('file-volume').textContent = `Volume ${file.path.split('/')[0]}`; $('hash').textContent = file.hash;
  $('file-kind').textContent = file.category === 'images' ? 'FDL graphics' : file.name.startsWith('mdat.') ? 'TFMX music data' : file.name.startsWith('smpl.') ? 'TFMX sample bank' : 'Amiga resource';
  files();
  for (const id of ['image-panel', 'music-panel', 'sample-panel', 'data-panel']) $(id).hidden = true;
  $('hex-decoded').checked = false; $('hex-decoded').disabled = !file.resources.length; $('download-decoded').hidden = !file.resources.length;
  $('chunk').replaceChildren();
  for (const resource of file.resources) $('chunk').add(new Option(String(resource.chunk + 1), String(resource.id)));
  $('chunk-label').hidden = file.resources.length <= 1;
  const bytes = await call('file', { index: file.id }); if (token !== generation) return; raw = bytes;
  setView('preview');
  if (file.category === 'images') {
    $('image-panel').hidden = false;
    await showImage(token);
  } else if (file.name.startsWith('mdat.')) {
    $('music-panel').hidden = false; $('music-title').textContent = `Music bank ${file.name.split('.').at(-1)}`;
    $('audio-status').textContent = 'Ready to play.'; $('subsong').replaceChildren(new Option('1', '0')); $('subsong').disabled = true;
    $('music-info').textContent = 'Music data and its matching sample bank are played together.';
  } else if (file.name.startsWith('smpl.')) {
    $('sample-panel').hidden = false; waveform(raw);
  } else {
    $('data-panel').hidden = false; $('data-title').textContent = raw[0] === 0 && raw[1] === 0 && raw[2] === 3 && raw[3] === 0xf3 ? 'Amiga executable' : 'Original data file';
    $('data-metadata').textContent = `Path: ${file.path}\nLength: ${file.size} bytes\nFirst bytes: ${[...raw.subarray(0, 16)].map(x => x.toString(16).padStart(2, '0')).join(' ')}`;
  }
  if (token === generation) notice(`${file.path} · decoded locally`);
}
function setView(name) {
  view = name;
  for (const tab of ['preview', 'hex', 'text']) { $(`tab-${tab}`).setAttribute('aria-selected', String(tab === name)); $(`tab-${tab}`).tabIndex = tab === name ? 0 : -1; $(`panel-${tab}`).hidden = tab !== name; }
  if (name === 'hex') renderHex().catch(showError);
  if (name === 'text' && raw) $('strings').textContent = strings(raw);
}
async function getDecoded() {
  if (!selected?.resources.length) return undefined;
  const resource = selected.resources.find(r => r.id === Number($('chunk').value)) || selected.resources[0];
  if (decoded?.id === resource.id) return decoded.bytes;
  const token = generation; const bytes = await call('resource', { index: resource.id });
  if (token !== generation) return undefined;
  decoded = { id: resource.id, bytes }; return bytes;
}
function clearImage() { $('save-png').disabled = true; const canvas = $('image'); canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height); }
function draw(frame) {
  const canvas = $('image'); canvas.width = frame.width; canvas.height = frame.height;
  canvas.getContext('2d', { alpha: false }).putImageData(new ImageData(new Uint8ClampedArray(frame.rgba), frame.width, frame.height), 0, 0);
  $('image-info').textContent = `${frame.width} × ${frame.height} px`; $('save-png').disabled = false; scaleImage();
}
function scaleImage() { const scale = $('scale').value; $('image').style.width = scale === 'fit' ? '100%' : `${$('image').width * Number(scale)}px`; }
async function showImage(token = generation) {
  const bytes = await getDecoded(); if (!bytes || token !== generation) return;
  const file = selected;
  if (bytes.length === 40064 || (file.scene && (!file.resources.length || Number($('chunk').value) === file.resources[0].id))) {
    const frame = await call(bytes.length === 40064 ? 'resourceFrame' : 'frame', { index: bytes.length === 40064 ? Number($('chunk').value) : file.scene.id }); if (token !== generation) return;
    $('width').value = frame.width; $('height').value = frame.height; $('depth').value = '5'; $('offset').value = '0'; $('palette').value = bytes.length === 40064 ? '4294967294' : String(file.scene.id); draw(frame);
    $('image-note').textContent = file.name === 'Karte.fdl' ? 'Original scrolling map. Its 32-color palette is recovered from the executable.' : 'Original 320 × 200 screen, with its embedded 32-color Amiga palette.';
    $('geometry').open = false; return;
  }
  let width = 320, depth = 5, offset = 0;
  if (file.name === 'Patrizier.fdl') { width = 1456; depth = 1; }
  const height = file.name === 'Patrizier.fdl' ? 16 : Math.max(1, Math.floor(bytes.length / (width / 8 * depth)));
  const base = file.name.replace('Obj.fdl', '.fdl');
  const matching = catalog.scenes.find(s => s.path.split('/').at(-1) === base);
  const harbor = catalog.scenes.find(s => s.path === 'PA1/Pictures/Hafen.fdl');
  $('width').value = width; $('height').value = height; $('depth').value = depth; $('offset').value = offset;
  $('palette').value = file.name === 'Patrizier.fdl' ? '4294967295' : String((matching || harbor).id);
  $('geometry').open = true;
  $('image-note').textContent = file.name === 'Patrizier.fdl' ? 'Original one-bit font atlas, 91 glyphs across 16 scanlines.' : bytes.length === 22600 ? 'City fragment: 320 × 113 pixels. Displayed with the harbor palette.' : 'Bitmap inspection view. Adjust geometry and palette to inspect this resource; objects are not yet assembled into their in-game positions.';
  await customImage(token);
}
async function customImage(token = generation) {
  const index = Number($('chunk').value), offset = Number($('offset').value), width = Number($('width').value), height = Number($('height').value), depth = Number($('depth').value), palette = Number($('palette').value);
  if (![index, offset, width, height, depth, palette].every(Number.isInteger) || offset < 0 || width < 16 || width % 16 || width > 2048 || height < 1 || height > 2048 || depth < 1 || depth > 5) throw new Error('Use a width divisible by 16, height 1–2048, and bitplane depth 1–5.');
  const frame = await call('bitmap', { index, offset, width, height, depth, palette }); if (token === generation) draw(frame);
}
async function renderHex() {
  const token = generation; const bytes = $('hex-decoded').checked ? await getDecoded() : raw; if (!bytes || token !== generation) return;
  const pages = Math.max(1, Math.ceil(bytes.length / 512)); hexPage = Math.max(0, Math.min(hexPage, pages - 1));
  $('hex').textContent = hexDump(bytes, hexPage * 512); $('hex-page').textContent = `${hexPage + 1} / ${pages}`; $('hex-prev').disabled = hexPage === 0; $('hex-next').disabled = hexPage === pages - 1;
}
function waveform(bytes) {
  const canvas = $('waveform'), context = canvas.getContext('2d'); context.clearRect(0, 0, canvas.width, canvas.height); context.strokeStyle = '#d0b77b'; context.beginPath();
  const step = Math.max(1, Math.ceil(bytes.length / canvas.width));
  for (let x = 0; x < canvas.width; x++) { let lo = 0, hi = 0; for (let i = x * step; i < Math.min(bytes.length, (x + 1) * step); i++) { const value = bytes[i] < 128 ? bytes[i] : bytes[i] - 256; lo = Math.min(lo, value); hi = Math.max(hi, value); } context.moveTo(x, 80 + lo / 128 * 70); context.lineTo(x, 80 + hi / 128 * 70); } context.stroke();
}
$('archive').addEventListener('change', async () => {
  const file = $('archive').files[0]; if (!file) return;
  if (file.size > 16 * 1024 * 1024) { notice('Please choose the supplied three-disk patrizier.zip archive (under 16 MiB).', true); return; }
  generation++; stopAudio(); $('archive').disabled = true; $('inspector').hidden = true; $('welcome').hidden = false; selected = undefined;
  $('search').disabled = true; $('files').replaceChildren(); notice('Verifying all three disks and decoding their resources locally…');
  try {
    const buffer = await file.arrayBuffer(); catalog = await call('load', { buffer }, [buffer]); $('search').disabled = false; $('search').value = ''; category = 'all';
    for (const button of $('filters').querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.category === 'all'));
    $('palette').replaceChildren(new Option('Embedded in this stream', '4294967294'), new Option('Grayscale', '4294967295'));
    for (const scene of catalog.scenes) $('palette').add(new Option(scene.path.split('/').at(-1), String(scene.id)));
    files(); notice(`${catalog.files.length} files · ${catalog.resources.length} decoded streams · everything stays on your device`);
    await selectFile(catalog.files.find(f => f.name === 'Holstentor.fdl') || catalog.files[0]);
  } catch (error) { catalog = undefined; $('count').textContent = '0 files'; showError(error); }
  finally { $('archive').disabled = false; }
});
$('search').addEventListener('input', files);
$('filters').addEventListener('click', event => { const button = event.target.closest('button'); if (!button) return; category = button.dataset.category; for (const b of $('filters').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b === button)); files(); });
for (const tab of ['preview', 'hex', 'text']) {
  $(`tab-${tab}`).addEventListener('click', () => setView(tab));
  $(`tab-${tab}`).addEventListener('keydown', event => { if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return; const tabs = ['preview', 'hex', 'text']; const next = tabs[(tabs.indexOf(tab) + (event.key === 'ArrowLeft' ? 2 : 1)) % 3]; setView(next); $(`tab-${next}`).focus(); event.preventDefault(); });
}
$('scale').addEventListener('change', scaleImage);
$('chunk').addEventListener('change', () => { clearImage(); decoded = undefined; showImage().then(() => view === 'hex' && renderHex()).catch(showError); });
$('apply-geometry').addEventListener('click', () => { clearImage(); customImage().catch(showError); });
$('hex-prev').addEventListener('click', () => { hexPage--; renderHex().catch(showError); });
$('hex-next').addEventListener('click', () => { hexPage++; renderHex().catch(showError); });
$('hex-decoded').addEventListener('change', () => { hexPage = 0; renderHex().catch(showError); });
$('download-file').addEventListener('click', () => { if (raw && selected) download(raw, selected.name); });
$('download-decoded').addEventListener('click', async () => { const file = selected; const bytes = await getDecoded(); if (bytes && file === selected) download(bytes, `${file.name}.decoded`); });
$('save-png').addEventListener('click', () => { const name = selected.name; $('image').toBlob(blob => { if (blob) download(blob, `${name}.png`); }, 'image/png'); });
$('sample-wav').addEventListener('click', async () => { try { if (!raw) return; const bytes = pcmWav(raw, Number($('sample-rate').value)); if (sampleUrl) URL.revokeObjectURL(sampleUrl); sampleUrl = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' })); $('sample-player').src = sampleUrl, playingFile; await $('sample-player').play(); } catch (error) { showError(error); } });
$('play').addEventListener('click', async () => {
  if (!selected?.name.startsWith('mdat.')) return;
  const token = generation, file = selected; playingFile = file.id; $('play').disabled = true; $('audio-status').textContent = 'Starting the local music decoder…';
  try {
    await player.unlock(); if (token !== generation) return; $('subsong').value = '0';
    const sample = catalog.files.find(f => f.path === file.path.replace('/mdat.', '/smpl.')); if (!sample) throw new Error('Matching sample bank is missing.');
    const music = raw.slice(), samples = await call('file', { index: sample.id }); if (token !== generation) return;
    paused = false; $('pause').textContent = 'Pause'; await player.play(music, samples, file.name);
  } catch (error) { if (token === generation) { $('play').disabled = false; $('audio-status').textContent = error.message; } }
});
$('pause').addEventListener('click', () => { paused = !paused; player.pause(paused); $('pause').textContent = paused ? 'Resume' : 'Pause'; $('audio-status').textContent = paused ? 'Paused.' : 'Playing locally.'; });
$('stop').addEventListener('click', () => { stopAudio(); $('audio-status').textContent = 'Stopped.'; });
$('subsong').addEventListener('change', () => { player.select(Number($('subsong').value)); $('progress').value = 0; });
$('volume').addEventListener('input', () => player.setVolume(Number($('volume').value)));
call('ready').then(() => { $('archive').disabled = false; notice('No uploads. No accounts. Open your original archive to begin.'); }).catch(showError);
