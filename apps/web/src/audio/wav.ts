export type WavRecorder = { stop: () => Promise<Blob>; cancel: () => Promise<void> };

export function encodePcmWav(samples: Float32Array, sampleRate: number): Blob {
  if (!Number.isInteger(sampleRate) || sampleRate < 8_000 || sampleRate > 192_000) {
    throw new Error('Unsupported audio sample rate');
  }
  const dataSize = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const write = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  write(0, 'RIFF'); view.setUint32(4, 36 + dataSize, true); write(8, 'WAVE');
  write(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true);
  view.setUint16(34, 16, true); write(36, 'data'); view.setUint32(40, dataSize, true);
  for (let i = 0; i < samples.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(44 + i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

export async function startWavRecording(): Promise<WavRecorder> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone recording is unavailable in this browser');
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const context = new AudioContext();
  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(4096, 1, 1);
  const chunks: Float32Array[] = [];
  processor.onaudioprocess = event => {
    chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
    event.outputBuffer.getChannelData(0).fill(0);
  };
  source.connect(processor);
  processor.connect(context.destination);
  let finished = false;
  const cleanup = async () => {
    if (finished) return;
    finished = true;
    processor.onaudioprocess = null;
    source.disconnect(); processor.disconnect();
    stream.getTracks().forEach(track => track.stop());
    await context.close();
  };
  return {
    stop: async () => {
      await cleanup();
      const count = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const samples = new Float32Array(count);
      let offset = 0;
      for (const chunk of chunks) { samples.set(chunk, offset); offset += chunk.length; }
      return encodePcmWav(samples, context.sampleRate);
    },
    cancel: cleanup,
  };
}
