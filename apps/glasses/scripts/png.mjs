import { deflateSync, inflateSync } from "node:zlib";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function readChunks(buffer) {
  if (!buffer.subarray(0, 8).equals(SIGNATURE)) throw new Error("Not a PNG");
  const chunks = [];
  let offset = 8;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    chunks.push({ type, data: buffer.subarray(offset + 8, offset + 8 + length) });
    offset += 12 + length;
  }
  return chunks;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** Decode the simulator's RGBA PNG into straight pixels. */
export function decodeGlassesPng(buffer) {
  const chunks = readChunks(buffer);
  const ihdr = chunks.find((entry) => entry.type === "IHDR");
  if (!ihdr) throw new Error("PNG has no IHDR");
  const width = ihdr.data.readUInt32BE(0);
  const height = ihdr.data.readUInt32BE(4);
  const bitDepth = ihdr.data[8];
  const colorType = ihdr.data[9];
  const interlace = ihdr.data[12];
  if (bitDepth !== 8 || colorType !== 6 || interlace !== 0) {
    throw new Error(`Unsupported simulator PNG (${bitDepth}/${colorType}/${interlace})`);
  }
  const raw = Buffer.concat(chunks.filter((entry) => entry.type === "IDAT").map((entry) => entry.data));
  const inflated = inflateSync(raw);
  const stride = width * 4;
  const pixels = Buffer.alloc(stride * height);
  const bytesPerPixel = 4;
  for (let y = 0; y < height; y++) {
    const filter = inflated[y * (stride + 1)];
    const source = y * (stride + 1) + 1;
    const target = y * stride;
    for (let x = 0; x < stride; x++) {
      const value = inflated[source + x];
      const left = x >= bytesPerPixel ? pixels[target + x - bytesPerPixel] : 0;
      const up = y > 0 ? pixels[target - stride + x] : 0;
      const upLeft = y > 0 && x >= bytesPerPixel ? pixels[target - stride + x - bytesPerPixel] : 0;
      let out;
      switch (filter) {
        case 0: out = value; break;
        case 1: out = value + left; break;
        case 2: out = value + up; break;
        case 3: out = value + ((left + up) >> 1); break;
        case 4: out = value + paeth(left, up, upLeft); break;
        default: throw new Error(`Unknown PNG filter ${filter}`);
      }
      pixels[target + x] = out & 0xff;
    }
  }
  return { width, height, pixels };
}

/** Highest alpha in a rectangle; the simulator stores text brightness there. */
export function maxAlphaIn(buffer, box) {
  const { width, height, pixels } = decodeGlassesPng(buffer);
  const x0 = Math.max(0, Math.floor(box.x));
  const y0 = Math.max(0, Math.floor(box.y));
  const x1 = Math.min(width, Math.ceil(box.x + box.width));
  const y1 = Math.min(height, Math.ceil(box.y + box.height));
  let max = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const alpha = pixels[(y * width + x) * 4 + 3];
      if (alpha > max) max = alpha;
    }
  }
  return max;
}

/** Decode the simulator's RGBA PNG, then bake brightness into green on a black background. */
export function compositeGlassesPng(buffer, tint = [140, 255, 120]) {
  const { width, height, pixels } = decodeGlassesPng(buffer);

  const out = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = pixels[(y * width + x) * 4 + 3];
      const factor = alpha / 255;
      const index = (y * width + x) * 3;
      out[index] = Math.round(tint[0] * factor);
      out[index + 1] = Math.round(tint[1] * factor);
      out[index + 2] = Math.round(tint[2] * factor);
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const scanlines = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    scanlines[y * (width * 3 + 1)] = 0;
    out.copy(scanlines, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  }
  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(scanlines, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
