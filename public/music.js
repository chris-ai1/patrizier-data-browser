// Authors: Christian Reitwiessner
export class MusicPlayer {
  constructor(onMessage) { this.onMessage = onMessage; this.volume = 0.65; this.generation = 0; }
  async setup() {
    if (this.initializing) return this.initializing;
    this.context = new AudioContext();
    this.gain = this.context.createGain();
    this.gain.gain.value = this.volume;
    this.gain.connect(this.context.destination);
    this.initializing = (async () => {
      const response = await fetch('./audio/libtfmx.worklet.wasm');
      if (!response.ok) throw new Error(`Audio decoder download failed (${response.status}).`);
      const wasmModule = await WebAssembly.compile(await response.arrayBuffer());
      await this.context.audioWorklet.addModule('./audio/tfmx.worklet.js');
      this.node = new AudioWorkletNode(this.context, 'tfmx-processor', {
        numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2], processorOptions: { wasmModule }
      });
      this.node.connect(this.gain);
      this.node.port.onmessage = event => this.onMessage(event.data);
      this.node.onprocessorerror = () => this.onMessage({ cmd: 'err', detail: 'The music decoder stopped unexpectedly.' });
      this.node.port.postMessage({ cmd: 'repeatCount', val: 0 });
    })().catch(async error => {
      await this.context.close();
      this.initializing = null;
      throw error;
    });
    return this.initializing;
  }
  unlock() { const ready = this.setup(); return Promise.all([ready, this.context.resume()]); }
  async play(mdat, samples, base) {
    const generation = ++this.generation;
    const initializing = this.setup();
    await this.context.resume();
    await initializing;
    if (generation !== this.generation) return;
    this.node.port.postMessage({ cmd: 'play', val: { tfx: mdat.buffer, sam: samples.buffer, base } });
    this.node.port.postMessage({ cmd: 'repeatCount', val: 0 });
  }
  pause(paused) { this.node?.port.postMessage({ cmd: paused ? 'pause' : 'unpause' }); }
  stop() { this.generation++; this.node?.port.postMessage({ cmd: 'stop' }); }
  select(index) { this.node?.port.postMessage({ cmd: 'selectSubsong', val: index }); }
  setVolume(value) { this.volume = value; if (this.gain) this.gain.gain.value = value; }
}
