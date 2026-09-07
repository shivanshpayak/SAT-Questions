import { READING_PDF, openDoc, pageChars } from "./lib/pdf.mjs";
import { slantForFont } from "./lib/fontstyle.mjs";

const page = openDoc(READING_PDF).loadPage(0);
const chars = pageChars(page);
const text = chars.map((c) => c.c).join("");
const at = text.indexOf("Ebony and Topaz");
const known = { italic: chars[at].font, body: chars[at - 5].font };

for (const font of new Set(chars.map((c) => c.font))) {
  const label = font === known.italic ? "  <- known ITALIC" : font === known.body ? "  <- known BODY" : "";
  console.log(`${font}  slant=${String(slantForFont(page, chars, font)).slice(0, 8)}${label}`);
}
