import type { Box, GrayImage } from "../ocr/types.js";
import { openPdf, type PdfWasmFiles } from "./pdfjs.js";

/** pdf.js `ImageKind`: how a decoded image's pixels are packed. */
const GRAYSCALE_1BPP = 1;
const RGB_24BPP = 2;
const RGBA_32BPP = 3;

/** Pixels darker than this count as ink. */
const INK = 128;

/**
 * The page images of a scanned PDF, upright (the page's /Rotate applied).
 * Returns null when a page has no image covering most of it — a digital PDF.
 */
export async function loadScan(data: Uint8Array, wasm: PdfWasmFiles): Promise<GrayImage[] | null> {
  const { pdf, close } = await openPdf(data, wasm);
  const { OPS } = await import("pdfjs-dist");
  try {
    const pages: GrayImage[] = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const ops = await page.getOperatorList();
      let largest: RawImage | null = null;
      for (let i = 0; i < ops.fnArray.length; i++) {
        if (ops.fnArray[i] !== OPS.paintImageXObject) continue;
        const name = ops.argsArray[i][0] as string;
        const store = name.startsWith("g_") ? page.commonObjs : page.objs;
        const image = await new Promise<RawImage | null>((resolve) => store.get(name, resolve));
        if (image?.data && (!largest || image.width * image.height > largest.width * largest.height)) largest = image;
      }
      // A scan is one image at roughly 150 dpi or more over an A4-sized page.
      if (!largest || largest.width * largest.height < 1_000_000) return null;
      pages.push(rotate(toGray(largest), page.rotate));
    }
    return pages;
  } finally {
    await close();
  }
}

type RawImage = { width: number; height: number; kind: number; data: Uint8Array | Uint8ClampedArray };

function toGray({ width, height, kind, data }: RawImage): GrayImage {
  const gray = new Uint8Array(width * height);
  if (kind === GRAYSCALE_1BPP) {
    // pdf.js has already applied /Decode and /BlackIs1: a set bit is white.
    const rowBytes = (width + 7) >> 3;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        gray[y * width + x] = (data[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1 ? 255 : 0;
      }
    }
  } else {
    const channels = kind === RGBA_32BPP ? 4 : kind === RGB_24BPP ? 3 : 1;
    for (let i = 0; i < width * height; i++) {
      const o = i * channels;
      gray[i] = channels === 1 ? data[o] : (data[o] * 299 + data[o + 1] * 587 + data[o + 2] * 114) / 1000;
    }
  }
  return { width, height, data: gray };
}

/** Apply a page's /Rotate (clockwise degrees). */
function rotate(image: GrayImage, degrees: number): GrayImage {
  const { width: w, height: h, data } = image;
  const turn = ((degrees % 360) + 360) % 360;
  if (turn === 0) return image;
  const out = new Uint8Array(w * h);
  if (turn === 180) {
    for (let i = 0; i < w * h; i++) out[w * h - 1 - i] = data[i];
    return { width: w, height: h, data: out };
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // 90: (x, y) → (h-1-y, x); 270: (x, y) → (y, w-1-x). The new width is h.
      const target = turn === 90 ? x * h + (h - 1 - y) : (w - 1 - x) * h + y;
      out[target] = data[y * w + x];
    }
  }
  return { width: h, height: w, data: out };
}

/* ------------------------------------------------------------------ */
/* Ruled tables                                                        */
/* ------------------------------------------------------------------ */

/** A horizontal ruling line: the image rows it covers. */
type Rule = { top: number; bottom: number };



export type Grid = {
  /** Column boxes between the vertical rules, left to right. */
  columns: { left: number; right: number }[];
  /** The shaded header row. */
  header: Rule;
  /** Data rows (the bands between horizontal rules), top to bottom. */
  rows: Rule[];
  /** Every horizontal rule inside the table, to erase before OCR. */
  rules: Rule[];
  /** Bottom edge of the table's last rule. */
  bottom: number;
};

/** A horizontal rule runs across at least this share of the page width. */
const MIN_RULE_WIDTH = 0.4;
/** Narrower than any real column: two rules this close are the frame beside the table's edge. */
const MIN_COLUMN_WIDTH = 60;
/** A column rule is ink over at least this share of a row's height. */
const MIN_COLUMN_RULE_INK = 0.85;

/**
 * Find the ruled table on a scanned page: the longest run of row bands that
 * are each split into `columnCount` columns by vertical rules. The page frame
 * and stray lines around the table only ever give a band two or three rules.
 */
export function findGrid(image: GrayImage, columnCount: number): Grid | null {
  const rules = horizontalRules(image);
  type Band = { top: number; bottom: number; verticals: number[] };
  const bands: Band[] = [];
  for (let i = 0; i + 1 < rules.length; i++) {
    const top = rules[i].bottom + 1;
    const bottom = rules[i + 1].top - 1;
    if (bottom - top < 10) continue;
    bands.push({ top, bottom, verticals: verticalRules(image, top, bottom) });
  }

  // The longest run of consecutive bands split into at least `columnCount`
  // columns. A band may show an extra rule or two where the page frame
  // touches the table; those are voted out below.
  let best: Band[] = [];
  let run: Band[] = [];
  for (const band of bands) {
    const fits = band.verticals.length >= columnCount + 1 && band.verticals.length <= columnCount + 4;
    const joins = run.length > 0 && band.top - run.at(-1)!.bottom < 20;
    if (fits && (run.length === 0 || joins)) run.push(band);
    else run = fits ? [band] : [];
    if (run.length > best.length) best = [...run];
  }
  if (best.length < 2) return null;

  // Keep the rules found in most bands, each at its median position.
  const clusters: number[][] = [];
  for (const x of best.flatMap((b) => b.verticals).sort((a, b) => a - b)) {
    const last = clusters.at(-1);
    if (last && x - last.at(-1)! <= 4) last.push(x);
    else clusters.push([x]);
  }
  const verticals = clusters.filter((c) => c.length >= best.length * 0.6).map(median);

  // The page frame can run alongside the table's outer edge, closer to it
  // than any real column is wide. Bands outside the table cross only the
  // frame, which tells the two apart.
  const frame = bands.filter((b) => b.verticals.length <= 3).flatMap((b) => b.verticals);
  const nearFrame = (x: number) => Math.min(Infinity, ...frame.map((f) => Math.abs(f - x)));
  while (verticals.length > columnCount + 1) {
    const n = verticals.length;
    const pair = verticals[1] - verticals[0] < MIN_COLUMN_WIDTH ? [0, 1] : verticals[n - 1] - verticals[n - 2] < MIN_COLUMN_WIDTH ? [n - 2, n - 1] : null;
    if (!pair) break;
    verticals.splice(nearFrame(verticals[pair[0]]) < nearFrame(verticals[pair[1]]) ? pair[0] : pair[1], 1);
  }
  if (verticals.length !== columnCount + 1) return null;
  const columns = verticals.slice(1).map((right, i) => ({ left: verticals[i], right }));
  const [header, ...rows] = best.map(({ top, bottom }) => ({ top, bottom }));
  const tableRules = rules.filter((r) => r.bottom >= header.top - 20 && r.top <= rows.at(-1)!.bottom + 20);
  return { columns, header, rows, rules: tableRules, bottom: tableRules.at(-1)!.bottom };
}

export function horizontalRules(image: GrayImage): Rule[] {
  const { width, height, data } = image;
  const minRun = width * MIN_RULE_WIDTH;
  const rules: Rule[] = [];
  for (let y = 0; y < height; y++) {
    // Longest run of ink on this row, bridging gaps of up to 3 pixels.
    let longest = 0;
    let run = 0;
    let gap = 0;
    for (let x = 0; x < width; x++) {
      if (data[y * width + x] < INK) {
        run += gap + 1;
        gap = 0;
        if (run > longest) longest = run;
      } else if (run > 0 && ++gap > 3) {
        run = 0;
        gap = 0;
      }
    }
    if (longest < minRun) continue;
    const last = rules.at(-1);
    if (last && y - last.bottom <= 2) last.bottom = y;
    else rules.push({ top: y, bottom: y });
  }
  return rules;
}

/** Centres of the vertical rules crossing the band `top..bottom`, left to right. */
export function verticalRules(image: GrayImage, top: number, bottom: number): number[] {
  const { width, data } = image;
  // Skip a few rows at each edge: rules are often a pixel or two thicker there.
  const y0 = top + 2;
  const y1 = bottom - 2;
  const need = (y1 - y0 + 1) * MIN_COLUMN_RULE_INK;
  const centres: number[] = [];
  let start = -1;
  for (let x = 0; x <= width; x++) {
    let ink = 0;
    if (x < width) for (let y = y0; y <= y1; y++) if (data[y * width + x] < INK) ink++;
    if (x < width && ink >= need) {
      if (start < 0) start = x;
    } else if (start >= 0) {
      const centre = Math.round((start + x - 1) / 2);
      // Rules a few pixels apart are one rule drawn twice.
      if (centres.length > 0 && centre - centres.at(-1)! <= 6) centres[centres.length - 1] = centre;
      else centres.push(centre);
      start = -1;
    }
  }
  return centres;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[sorted.length >> 1];
}

/* ------------------------------------------------------------------ */
/* Crops for OCR                                                       */
/* ------------------------------------------------------------------ */

/**
 * Margin kept inside a column's rules. The ink where rules cross survives the
 * erasing of horizontal rules as a line of dots down a strip's side, and
 * Tesseract can give up on a whole column because of it.
 */
const RULE_MARGIN = 12;
/** White border around a crop; Tesseract reads text touching the edge poorly. */
const PAD = 20;

/**
 * Copy `box` out of the page onto a white border, blanking the given
 * horizontal rules so only the text inside the cells is left.
 */
export function crop(image: GrayImage, box: Box, erase: Rule[] = []): GrayImage {
  const left = Math.max(0, box.left);
  const right = Math.min(image.width - 1, box.right);
  const top = Math.max(0, box.top);
  const bottom = Math.min(image.height - 1, box.bottom);
  const width = right - left + 1 + 2 * PAD;
  const height = bottom - top + 1 + 2 * PAD;
  const data = new Uint8Array(width * height).fill(255);
  for (let y = top; y <= bottom; y++) {
    if (erase.some((r) => y >= r.top - 2 && y <= r.bottom + 2)) continue;
    data.set(image.data.subarray(y * image.width + left, y * image.width + right + 1), (y - top + PAD) * width + PAD);
  }
  return { width, height, data };
}

/** The box of a column across the given rows, inside its rules. */
export function columnBox(column: { left: number; right: number }, top: number, bottom: number): Box {
  return { left: column.left + RULE_MARGIN, right: column.right - RULE_MARGIN, top, bottom };
}

/** Map a y coordinate inside a crop made by `crop` back to the page. */
export function pageY(cropY: number, box: Box): number {
  return cropY - PAD + Math.max(0, box.top);
}
