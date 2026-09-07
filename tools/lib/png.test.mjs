import { test } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { encodeGray, inkBounds, cropToPng } from "./png.mjs";

function chunks(png) {
  const found = {};
  let off = 8;
  while (off < png.length) {
    const len = png.readUInt32BE(off);
    const type = png.subarray(off + 4, off + 8).toString("latin1");
    found[type] = png.subarray(off + 8, off + 8 + len);
    off += 12 + len;
  }
  return found;
}

test("encodeGray writes a valid PNG whose pixels round-trip", () => {
  const rows = [Buffer.from([0, 128, 255]), Buffer.from([255, 0, 64])];
  const png = encodeGray(3, 2, (y) => rows[y]);

  assert.deepEqual(png.subarray(0, 8), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

  const { IHDR, IDAT, IEND } = chunks(png);
  assert.equal(IHDR.readUInt32BE(0), 3);
  assert.equal(IHDR.readUInt32BE(4), 2);
  assert.equal(IHDR[8], 8, "bit depth must be 8");
  assert.equal(IHDR[9], 0, "colour type must be grayscale");
  assert.ok(IEND, "IEND chunk required");

  const raw = zlib.inflateSync(IDAT);
  assert.equal(raw.length, (3 + 1) * 2);
  assert.equal(raw[0], 0, "scanline filter byte must be 0");
  assert.deepEqual(raw.subarray(1, 4), rows[0]);
  assert.equal(raw[4], 0);
  assert.deepEqual(raw.subarray(5, 8), rows[1]);
});

test("inkBounds finds the dark region and ignores white margin", () => {
  const width = 5, height = 4, stride = 5;
  const pixels = new Uint8Array(width * height).fill(255);
  pixels[1 * stride + 2] = 0;
  pixels[2 * stride + 3] = 10;
  assert.deepEqual(inkBounds({ pixels, width, height, stride }), { x0: 2, y0: 1, x1: 3, y1: 2 });
});

test("inkBounds returns null for a blank region", () => {
  const pixels = new Uint8Array(9).fill(255);
  assert.equal(inkBounds({ pixels, width: 3, height: 3, stride: 3 }), null);
});

test("cropToPng trims to ink plus padding", () => {
  const width = 10, height = 10, stride = 10;
  const pixels = new Uint8Array(width * height).fill(255);
  pixels[5 * stride + 5] = 0;
  const png = cropToPng({ pixels, width, height, stride }, 2);
  const { IHDR } = chunks(png);
  assert.equal(IHDR.readUInt32BE(0), 5, "1 ink px + 2 padding each side");
  assert.equal(IHDR.readUInt32BE(4), 5);
});

test("cropToPng returns null for a blank region", () => {
  const pixels = new Uint8Array(16).fill(255);
  assert.equal(cropToPng({ pixels, width: 4, height: 4, stride: 4 }, 2), null);
});
