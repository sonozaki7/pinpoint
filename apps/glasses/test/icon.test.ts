import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { inflateSync } from "node:zlib";

interface RgbaImage {
  width: number;
  height: number;
  pixels: Buffer;
}

/** Minimal decoder for the RGBA PNGs this repository writes (filter 0). */
function decodeRgba(file: string): RgbaImage {
  const buffer = readFileSync(file);
  assert.equal(buffer.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "PNG signature");
  let offset = 8;
  let width = 0;
  let height = 0;
  const data: Buffer[] = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    const chunk = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      assert.equal(chunk[8], 8, "8-bit");
      assert.equal(chunk[9], 6, "RGBA");
      assert.equal(chunk[12], 0, "not interlaced");
    } else if (type === "IDAT") {
      data.push(chunk);
    }
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(data));
  const stride = width * 4;
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    assert.equal(filter, 0, "our encoder writes filter 0");
    raw.copy(pixels, y * stride, y * (stride + 1) + 1, (y + 1) * (stride + 1));
  }
  return { width, height, pixels };
}

function pixel(image: RgbaImage, x: number, y: number): [number, number, number, number] {
  const offset = (y * image.width + x) * 4;
  return [
    image.pixels[offset] ?? 0,
    image.pixels[offset + 1] ?? 0,
    image.pixels[offset + 2] ?? 0,
    image.pixels[offset + 3] ?? 0,
  ];
}

test("the Hub icon is a 24x24 1-bit mask in complete 2x2 blocks", () => {
  const icon = decodeRgba(new URL("../icon-24.png", import.meta.url).pathname);
  assert.equal(icon.width, 24);
  assert.equal(icon.height, 24);

  const lit = new Uint8Array(24 * 24);
  let litCount = 0;
  for (let y = 0; y < 24; y++) {
    for (let x = 0; x < 24; x++) {
      const [r, g, b, a] = pixel(icon, x, y);
      if (a === 0) continue;
      assert.equal(a, 255, `pixel ${x},${y} must be fully opaque`);
      assert.deepEqual([r, g, b], [0xf4, 0xf4, 0xf4], `pixel ${x},${y} must be #F4F4F4`);
      lit[y * 24 + x] = 1;
      litCount++;
    }
  }
  assert.ok(litCount >= 40, `the reticle is actually drawn (${litCount} lit pixels)`);

  for (let y = 0; y < 24; y += 2) {
    for (let x = 0; x < 24; x += 2) {
      const index = y * 24 + x;
      const block = [lit[index], lit[index + 1], lit[index + 24], lit[index + 25]];
      assert.ok(
        block.every((value) => value === block[0]),
        `2x2 block at ${x},${y} must be all lit or all clear`,
      );
    }
  }

  // Ring + centre dot: the middle block is lit, and the extreme corners stay
  // clear so the mark reads as a circle, not a square.
  assert.equal(lit[12 * 24 + 12], 1, "the centre dot is lit");
  assert.equal(lit[11 * 24 + 11], 1);
  assert.equal(lit[0], 0);
  assert.equal(lit[23], 0);
  assert.equal(lit[23 * 24 + 23], 0);
});

test("the 4x preview mirrors the same mask", () => {
  const icon = decodeRgba(new URL("../icon-24.png", import.meta.url).pathname);
  const preview = decodeRgba(new URL("../../../brand/pinpoint-icon-24-preview.png", import.meta.url).pathname);
  assert.equal(preview.width, 96);
  assert.equal(preview.height, 96);
  for (let y = 0; y < 24; y++) {
    for (let x = 0; x < 24; x++) {
      const source = pixel(icon, x, y);
      const sample = pixel(preview, x * 4 + 1, y * 4 + 1);
      if (source[3] === 0) {
        assert.deepEqual(sample, [0x05, 0x07, 0x06, 0xff], `preview background at ${x},${y}`);
      } else {
        assert.deepEqual(sample, [0xf4, 0xf4, 0xf4, 0xff], `preview mark at ${x},${y}`);
      }
    }
  }
});
