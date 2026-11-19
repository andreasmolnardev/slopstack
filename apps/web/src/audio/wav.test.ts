import { describe, expect, it } from 'vitest';
import { encodePcmWav } from './wav';

describe('encodePcmWav', () => {
  it('writes mono 16-bit PCM with the correct RIFF size and sample rate', async () => {
    const wav = encodePcmWav(new Float32Array([-1, 0, 1]), 16_000);
    expect(wav.type).toBe('audio/wav');
    const view = new DataView(await wav.arrayBuffer());
    const text = (offset: number, length: number) => String.fromCharCode(...new Uint8Array(view.buffer, offset, length));
    expect(text(0, 4)).toBe('RIFF'); expect(text(8, 4)).toBe('WAVE');
    expect(view.getUint32(4, true)).toBe(42);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getInt16(44, true)).toBe(-32768);
    expect(view.getInt16(46, true)).toBe(0);
    expect(view.getInt16(48, true)).toBe(32767);
  });

  it('rejects invalid sample rates', () => {
    expect(() => encodePcmWav(new Float32Array(), 0)).toThrow('Unsupported audio sample rate');
  });
});
