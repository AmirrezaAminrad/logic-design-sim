export const THEMES = {
  dark: {
    bg: '#0a0f1c', grid: '#1d2740', body: '#131c31', stroke: '#8fa3c4', text: '#e5ecf8', sub: '#8a9bb8',
    wireOff: '#4a5a78', wireOn: '#34d399', bus: '#38bdf8', busOff: '#1e5a86', sel: '#facc15', crit: '#fb923c', pinOff: '#2b3a58', ledOff: 0.22,
  },
  light: {
    bg: '#f4f6fb', grid: '#d3d9e6', body: '#ffffff', stroke: '#51607e', text: '#18233b', sub: '#5b6a86',
    wireOff: '#9aa6bd', wireOn: '#16a34a', bus: '#0284c7', busOff: '#9cc7e3', sel: '#d97706', crit: '#ea580c', pinOff: '#c2cbdc', ledOff: 0.18,
  },
};
export type Theme = typeof THEMES.dark;

export const LED_COLORS: Record<string, string> = { red: '#ef4444', green: '#22c55e', yellow: '#facc15', blue: '#3b82f6' };

export function gateShape(type: string, W: number, H: number) {
  const inv = ['nand', 'nor', 'xnor', 'not'].includes(type);
  const yT = H <= 40 ? 2 : 10;
  const hh = H - 2 * yT;
  const bw = inv ? W - 10 : W;
  const mid = yT + hh / 2, yB = yT + hh;
  let d = '', extra = '';
  switch (type) {
    case 'and': case 'nand':
      d = `M0 ${yT} H${bw * 0.5} A${bw * 0.5} ${hh / 2} 0 0 1 ${bw * 0.5} ${yB} H0 Z`;
      break;
    case 'or': case 'nor': case 'xor': case 'xnor':
      d = `M0 ${yT} Q${bw * 0.55} ${yT} ${bw} ${mid} Q${bw * 0.55} ${yB} 0 ${yB} Q${bw * 0.22} ${mid} 0 ${yT} Z`;
      if (type === 'xor' || type === 'xnor') extra = `M-8 ${yT} Q${bw * 0.22 - 8} ${mid} -8 ${yB}`;
      break;
    default:
      d = `M0 ${yT} L${bw} ${mid} L0 ${yB} Z`;
  }
  return { d, extra, bubble: inv, bw, mid };
}
