import * as mupdf from "mupdf";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export const MATH_PDF = path.join(ROOT, "Math SAT Questions.pdf");
export const READING_PDF = path.join(ROOT, "SAT Reading.pdf");

export function openDoc(file) {
  return mupdf.Document.openDocument(fs.readFileSync(file), "application/pdf");
}

export function pageLines(page) {
  const json = JSON.parse(page.toStructuredText("preserve-whitespace").asJSON());
  const out = [];
  for (const block of json.blocks) {
    if (block.type !== "text") continue;
    for (const line of block.lines) {
      out.push({ x: line.bbox.x, y: line.bbox.y, w: line.bbox.w, h: line.bbox.h, text: line.text });
    }
  }
  return out;
}

export function pageChars(page) {
  const chars = [];
  page.toStructuredText("preserve-whitespace").walk({
    onChar(c, origin, font, size, quad) {
      // quad is flat: [ulx, uly, urx, ury, llx, lly, lrx, lry]
      chars.push({ c, font: font.getName(), size, x0: quad[0], top: quad[1], x1: quad[2], bot: quad[5] });
    },
  });
  return chars;
}

export function renderGray(page, scale, clip) {
  const bounds = page.getBounds();
  const region = clip ?? [bounds[0], bounds[1], bounds[2], bounds[3]];
  const box = [
    Math.floor(region[0] * scale),
    Math.floor(region[1] * scale),
    Math.ceil(region[2] * scale),
    Math.ceil(region[3] * scale),
  ];
  const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceGray, box, false);
  pix.clear(255);
  const device = new mupdf.DrawDevice(mupdf.Matrix.scale(scale, scale), pix);
  page.run(device, mupdf.Matrix.identity);
  device.close();
  return {
    pixels: pix.getPixels(),
    width: pix.getWidth(),
    height: pix.getHeight(),
    stride: pix.getStride(),
    ox: box[0],
    oy: box[1],
  };
}
