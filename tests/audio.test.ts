/**
 * Pure helpers of the Lemonade audio client — no network. The WAV decoder must
 * handle both PCM16 and the IEEE-float WAVs kokoro-v1 actually serves.
 */
import { describe, it, expect } from "vitest";
import { decodeWavToFloat32 } from "../app/lib/llm/audio";

function wavOf(samples: number[], opts: { float?: boolean; rate?: number; channels?: number }) {
  const { float = false, rate = 24000, channels = 1 } = opts;
  const bps = float ? 4 : 2;
  const data = Buffer.alloc(samples.length * bps);
  samples.forEach((s, i) => {
    if (float) data.writeFloatLE(s, i * 4);
    else data.writeInt16LE(Math.round(s * 0x7fff), i * 2);
  });
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(float ? 3 : 1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * channels * bps, 28);
  header.writeUInt16LE(channels * bps, 32);
  header.writeUInt16LE(bps * 8, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

describe("decodeWavToFloat32", () => {
  it("decodes PCM16 mono", () => {
    const out = decodeWavToFloat32(wavOf([0, 0.5, -0.5, 1], {}), 24000);
    expect(out.length).toBe(4);
    expect(out[1]).toBeCloseTo(0.5, 2);
    expect(out[2]).toBeCloseTo(-0.5, 2);
  });

  it("decodes IEEE-float WAV (what kokoro-v1 serves)", () => {
    const out = decodeWavToFloat32(wavOf([0.25, -0.75], { float: true }), 24000);
    expect(out.length).toBe(2);
    expect(out[0]).toBeCloseTo(0.25, 5);
    expect(out[1]).toBeCloseTo(-0.75, 5);
  });

  it("resamples when rates differ", () => {
    const out = decodeWavToFloat32(wavOf(new Array(48).fill(0.1), { rate: 48000 }), 24000);
    expect(out.length).toBe(24);
    expect(out[10]).toBeCloseTo(0.1, 2);
  });

  it("rejects non-RIFF payloads (HTML error pages etc.)", () => {
    expect(() =>
      decodeWavToFloat32(Buffer.from("<!DOCTYPE html>starting up".repeat(4)), 24000),
    ).toThrow(/RIFF/);
  });
});
