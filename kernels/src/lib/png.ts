/**
 * Minimal pure-JS PNG encoder for fleet kernels — no native modules, no deps.
 *
 * Raw RGB/RGBA/grayscale bitmaps (as handed out by pdfjs) become valid PNGs
 * using STORED zlib blocks (no compression). That sounds wasteful, but every
 * PNG produced here is immediately written into an EPUB ZIP entry that JSZip
 * DEFLATEs — compressing twice buys nothing, and skipping it keeps this
 * encoder dependency-free and fast on a browser host.
 */

/* CRC-32 (PNG chunk checksums) */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(...parts: Uint8Array[]): number {
  let c = 0xffffffff;
  for (const p of parts) {
    for (let i = 0; i < p.length; i++) c = CRC_TABLE[(c ^ p[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/* Adler-32 (zlib stream checksum) */
function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function u32be(n: number): Uint8Array {
  return new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new Uint8Array([...type].map((ch) => ch.charCodeAt(0)));
  const out = new Uint8Array(12 + data.length);
  out.set(u32be(data.length), 0);
  out.set(typeBytes, 4);
  out.set(data, 8);
  out.set(u32be(crc32(typeBytes, data)), 8 + data.length);
  return out;
}

/** Wrap raw bytes in a zlib stream using stored (uncompressed) deflate blocks. */
function zlibStored(data: Uint8Array): Uint8Array {
  const BLOCK = 65535;
  const blocks = Math.max(1, Math.ceil(data.length / BLOCK));
  const out = new Uint8Array(2 + blocks * 5 + data.length + 4);
  let o = 0;
  out[o++] = 0x78; // CMF: deflate, 32K window
  out[o++] = 0x01; // FLG: no preset dict, fastest (checksum-valid pair)
  for (let i = 0; i < blocks; i++) {
    const start = i * BLOCK;
    const len = Math.min(BLOCK, data.length - start);
    out[o++] = i === blocks - 1 ? 1 : 0; // BFINAL on the last block, BTYPE=00
    out[o++] = len & 0xff;
    out[o++] = (len >>> 8) & 0xff;
    out[o++] = ~len & 0xff;
    out[o++] = (~len >>> 8) & 0xff;
    out.set(data.subarray(start, start + len), o);
    o += len;
  }
  out.set(u32be(adler32(data)), o);
  return out;
}

/**
 * Encode a raw bitmap as a PNG. channels: 1 = grayscale, 3 = RGB, 4 = RGBA —
 * matching pdfjs ImageKind layouts.
 */
export function encodePng(
  raw: Uint8Array,
  width: number,
  height: number,
  channels: 1 | 3 | 4,
): Uint8Array {
  const colorType = channels === 1 ? 0 : channels === 3 ? 2 : 6;
  const stride = width * channels;
  if (raw.length < stride * height) {
    throw new Error(`raw bitmap too small: ${raw.length} < ${stride * height}`);
  }

  // Filtered scanlines: every row prefixed with filter type 0 (None).
  const filtered = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    filtered[y * (stride + 1)] = 0;
    filtered.set(raw.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }

  const ihdr = new Uint8Array(13);
  ihdr.set(u32be(width), 0);
  ihdr.set(u32be(height), 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = colorType;
  ihdr[10] = 0; // compression: deflate
  ihdr[11] = 0; // filter method 0
  ihdr[12] = 0; // no interlace

  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrChunk = chunk("IHDR", ihdr);
  const idatChunk = chunk("IDAT", zlibStored(filtered));
  const iendChunk = chunk("IEND", new Uint8Array(0));

  const out = new Uint8Array(
    signature.length + ihdrChunk.length + idatChunk.length + iendChunk.length,
  );
  let o = 0;
  for (const part of [signature, ihdrChunk, idatChunk, iendChunk]) {
    out.set(part, o);
    o += part.length;
  }
  return out;
}
