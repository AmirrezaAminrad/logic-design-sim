import type { Circuit } from './types';
import { bbox, layoutOf } from './geometry';
import type { Theme } from './theme';

export function download(name: string, data: string | Blob, mime = 'text/plain') {
  const blob = typeof data === 'string' ? new Blob([data], { type: mime }) : data;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const serialize = (c: Circuit, name: string) =>
  JSON.stringify({ app: 'logic-design-sim', version: 1, name, circuit: c }, null, 1);

export function parseCircuitJSON(text: string): { circuit: any; name?: string } {
  const j = JSON.parse(text);
  const circuit = j.circuit ?? j;
  if (!Array.isArray(circuit.comps) || !Array.isArray(circuit.wires)) throw new Error('Not a Logic Design Sim file');
  return { circuit, name: j.name };
}

const KEY = 'lds.saves';
export function getSaves(): Record<string, { circuit: Circuit; at: number }> {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
}
export function saveNamed(name: string, circuit: Circuit) {
  const s = getSaves();
  s[name] = { circuit, at: Date.now() };
  localStorage.setItem(KEY, JSON.stringify(s));
}
export function deleteSave(name: string) {
  const s = getSaves();
  delete s[name];
  localStorage.setItem(KEY, JSON.stringify(s));
}

export function buildSVG(circuit: Circuit, th: Theme): { svg: string; w: number; h: number } | null {
  const world = document.getElementById('world');
  if (!world || !circuit.comps.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of circuit.comps) {
    const b = bbox(c, layoutOf(c, circuit.defs));
    x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0); x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1);
  }
  const m = 50;
  x0 -= m; y0 -= m; x1 += m; y1 += m;
  const clone = world.cloneNode(true) as SVGGElement;
  clone.querySelectorAll('[data-ui]').forEach((n) => n.remove());
  clone.removeAttribute('id');
  const inner = new XMLSerializer().serializeToString(clone);
  const w = x1 - x0, h = y1 - y0;
  const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${x0} ${y0} ${w} ${h}"><rect x="${x0}" y="${y0}" width="${w}" height="${h}" fill="${th.bg}"/>${inner}</svg>`;
  return { svg, w, h };
}

export function exportSVG(circuit: Circuit, th: Theme, name: string): boolean {
  const r = buildSVG(circuit, th);
  if (!r) return false;
  download(`${name}.svg`, r.svg, 'image/svg+xml');
  return true;
}

export function exportPNG(circuit: Circuit, th: Theme, name: string): Promise<boolean> {
  const r = buildSVG(circuit, th);
  if (!r) return Promise.resolve(false);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = 2;
      const cv = document.createElement('canvas');
      cv.width = Math.min(8000, r.w * scale);
      cv.height = Math.min(8000, r.h * scale);
      const ctx = cv.getContext('2d')!;
      ctx.drawImage(img, 0, 0, cv.width, cv.height);
      cv.toBlob((b) => {
        if (b) download(`${name}.png`, b, 'image/png');
        resolve(!!b);
      }, 'image/png');
    };
    img.onerror = () => resolve(false);
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(r.svg);
  });
}
