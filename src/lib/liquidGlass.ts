// Liquid glass: makes every .glass panel and .lg-bar refract what is behind it, like a slab of clear
// glass with rounded edges, instead of frosting it with a blur.
//
// For each panel size we draw a displacement map: flat (no shift) in the middle, and towards the
// rounded edge a shift that grows the closer a pixel is to the rim, pointing inwards along the edge's
// normal (found from the rounded rectangle's signed distance field). An SVG feDisplacementMap then
// moves the backdrop's pixels by that map, which bends the content near the rim like a lens.
// Chromium supports SVG filters in backdrop-filter; other browsers keep the plain CSS glass.

const NS = "http://www.w3.org/2000/svg";
const SELECTOR = ".glass, .lg-bar";
const cache = new Map<string, string>(); // size key -> filter id
let defs: SVGDefsElement | null = null;

/** Signed distance from (x, y) to a w x h rectangle with corner radius r: negative inside. */
function sdf(x: number, y: number, w: number, h: number, r: number) {
  const qx = Math.abs(x - w / 2) - (w / 2 - r);
  const qy = Math.abs(y - h / 2) - (h / 2 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

function displacementMap(w: number, h: number, r: number) {
  const s = Math.min(0.5, 400 / Math.max(w, h)); // draw at reduced size; the filter stretches it back
  const cw = Math.max(8, Math.round(w * s));
  const ch = Math.max(8, Math.round(h * s));
  const c = document.createElement("canvas");
  c.width = cw;
  c.height = ch;
  const g = c.getContext("2d")!;
  const img = g.createImageData(cw, ch);
  const bezel = Math.min(30, Math.min(w, h) * 0.22);
  for (let py = 0; py < ch; py++) {
    for (let px = 0; px < cw; px++) {
      const x = (px + 0.5) / s;
      const y = (py + 0.5) / s;
      const d = -sdf(x, y, w, h, r); // depth inside the panel
      let dx = 0;
      let dy = 0;
      if (d > 0 && d < bezel) {
        const nx = sdf(x + 1, y, w, h, r) - sdf(x - 1, y, w, h, r);
        const ny = sdf(x, y + 1, w, h, r) - sdf(x, y - 1, w, h, r);
        const len = Math.hypot(nx, ny) || 1;
        const m = Math.pow(1 - d / bezel, 2);
        dx = (-nx / len) * m;
        dy = (-ny / len) * m;
      }
      const i = (py * cw + px) * 4;
      img.data[i] = 128 + dx * 127;
      img.data[i + 1] = 128 + dy * 127;
      img.data[i + 2] = 128;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c.toDataURL();
}

function filterFor(w: number, h: number, r: number) {
  const key = `${w}x${h}r${r}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const id = `lg-${cache.size}`;
  const f = document.createElementNS(NS, "filter");
  f.setAttribute("id", id);
  f.setAttribute("x", "0");
  f.setAttribute("y", "0");
  f.setAttribute("width", "100%");
  f.setAttribute("height", "100%");
  f.setAttribute("color-interpolation-filters", "sRGB");
  const im = document.createElementNS(NS, "feImage");
  im.setAttribute("href", displacementMap(w, h, r));
  im.setAttribute("x", "0");
  im.setAttribute("y", "0");
  im.setAttribute("width", String(w));
  im.setAttribute("height", String(h));
  im.setAttribute("preserveAspectRatio", "none");
  im.setAttribute("result", "map");
  const dm = document.createElementNS(NS, "feDisplacementMap");
  dm.setAttribute("in", "SourceGraphic");
  dm.setAttribute("in2", "map");
  dm.setAttribute("scale", String(Math.min(70, 26 + Math.min(w, h) * 0.06)));
  dm.setAttribute("xChannelSelector", "R");
  dm.setAttribute("yChannelSelector", "G");
  f.append(im, dm);
  defs!.append(f);
  cache.set(key, id);
  return id;
}

function apply(el: HTMLElement) {
  const w = Math.round(el.offsetWidth / 4) * 4;
  const h = Math.round(el.offsetHeight / 4) * 4;
  if (w < 16 || h < 16) return;
  const r = Math.min(Math.round(parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0), w / 2, h / 2);
  const id = filterFor(w, h, r);
  const value = `url(#${id}) blur(var(--lg-blur, 14px)) saturate(165%) brightness(1.06)`;
  if (el.style.backdropFilter !== value) el.style.backdropFilter = value;
}

export function startLiquidGlass() {
  const brands: Array<{ brand: string }> = (navigator as any).userAgentData?.brands ?? [];
  if (!brands.some((b) => /Chromium|Google Chrome|Microsoft Edge/.test(b.brand))) return;
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("style", "position:absolute;width:0;height:0;overflow:hidden");
  defs = document.createElementNS(NS, "defs");
  svg.append(defs);
  document.body.append(svg);

  const seen = new WeakSet<Element>();
  const ro = new ResizeObserver((entries) => entries.forEach((e) => apply(e.target as HTMLElement)));
  const scan = () =>
    document.querySelectorAll<HTMLElement>(SELECTOR).forEach((el) => {
      if (seen.has(el)) return;
      seen.add(el);
      ro.observe(el);
    });
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      scan();
    });
  }).observe(document.body, { childList: true, subtree: true });
  scan();
}
