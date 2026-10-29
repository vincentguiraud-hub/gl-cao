// Bibliothèque de profilés acier (dimensions en mm) — sections simplifiées
import { R } from "./occ.js";

export const PROFILE_FAMILIES = {
  tube_carre: { label: "Tube carré", sizes: ["20x20x2", "25x25x2", "30x30x2", "35x35x2", "40x40x2", "40x40x3", "50x50x2", "50x50x3", "60x60x3", "70x70x3", "80x80x3", "80x80x4", "100x100x4", "120x120x5", "150x150x5"] },
  tube_rect: { label: "Tube rectangulaire", sizes: ["30x20x2", "40x20x2", "40x27x2", "50x25x2", "50x30x2", "60x30x2", "60x40x2", "60x40x3", "80x40x3", "100x40x3", "100x50x3", "120x60x4", "120x80x4", "150x100x5", "200x100x5"] },
  tube_rond: { label: "Tube rond", sizes: ["21.3x2", "26.9x2.3", "33.7x2.6", "42.4x2.6", "48.3x2.9", "60.3x3", "76.1x3", "88.9x3.2", "114.3x3.6"] },
  rond_plein: { label: "Rond plein", sizes: ["8", "10", "12", "14", "16", "20", "25", "30"] },
  carre_plein: { label: "Carré plein", sizes: ["10", "12", "14", "16", "20", "25", "30"] },
  plat: { label: "Fer plat", sizes: ["20x3", "25x4", "30x4", "30x5", "40x4", "40x5", "50x5", "50x8", "60x6", "80x8", "100x10", "120x10", "150x10"] },
  corniere: { label: "Cornière égale", sizes: ["20x3", "25x3", "30x3", "35x4", "40x4", "50x5", "60x6", "70x7", "80x8", "100x10"] },
  te: { label: "Fer T", sizes: ["30x4", "35x4.5", "40x5", "50x6", "60x7"] },
  ipe: { label: "IPE", sizes: ["80", "100", "120", "140", "160", "180", "200", "220", "240"] },
  hea: { label: "HEA", sizes: ["100", "120", "140", "160", "180", "200", "220", "240"] },
  heb: { label: "HEB", sizes: ["100", "120", "140", "160", "180", "200"] },
  upn: { label: "UPN", sizes: ["50", "65", "80", "100", "120", "140", "160", "180", "200"] },
};

// h, b, tw, tf
const I_DATA = {
  ipe: { 80: [80, 46, 3.8, 5.2], 100: [100, 55, 4.1, 5.7], 120: [120, 64, 4.4, 6.3], 140: [140, 73, 4.7, 6.9], 160: [160, 82, 5, 7.4], 180: [180, 91, 5.3, 8], 200: [200, 100, 5.6, 8.5], 220: [220, 110, 5.9, 9.2], 240: [240, 120, 6.2, 9.8] },
  hea: { 100: [96, 100, 5, 8], 120: [114, 120, 5, 8], 140: [133, 140, 5.5, 8.5], 160: [152, 160, 6, 9], 180: [171, 180, 6, 9.5], 200: [190, 200, 6.5, 10], 220: [210, 220, 7, 11], 240: [230, 240, 7.5, 12] },
  heb: { 100: [100, 100, 6, 10], 120: [120, 120, 6.5, 11], 140: [140, 140, 7, 12], 160: [160, 160, 8, 13], 180: [180, 180, 8.5, 14], 200: [200, 200, 9, 15] },
  upn: { 50: [50, 38, 5, 7], 65: [65, 42, 5.5, 7.5], 80: [80, 45, 6, 8], 100: [100, 50, 6, 8.5], 120: [120, 55, 7, 9], 140: [140, 60, 7, 10], 160: [160, 65, 7.5, 10.5], 180: [180, 70, 8, 11], 200: [200, 75, 8.5, 11.5] },
};

const nums = s => String(s).split("x").map(parseFloat);

// Renvoie { drawing, area (mm²), w, h }
export function profileSection(family, size) {
  const n = nums(size);
  let d, area, w, h;
  switch (family) {
    case "tube_carre": case "tube_rect": {
      let [a, b, t] = family === "tube_carre" ? n : n; if (family === "tube_carre" && n.length === 3) { a = n[0]; b = n[1]; t = n[2]; }
      w = a; h = b;
      const ro = Math.min(2 * t, a / 2 - 0.01, b / 2 - 0.01), ri = Math.max(Math.min(t, (a - 2 * t) / 2 - 0.01), 0.1);
      d = R.drawRoundedRectangle(a, b, ro).cut(R.drawRoundedRectangle(a - 2 * t, b - 2 * t, ri));
      area = a * b - (a - 2 * t) * (b - 2 * t); break;
    }
    case "tube_rond": { const [D, t] = n; w = h = D; d = R.drawCircle(D / 2).cut(R.drawCircle(D / 2 - t)); area = Math.PI / 4 * (D * D - (D - 2 * t) ** 2); break; }
    case "rond_plein": { const [D] = n; w = h = D; d = R.drawCircle(D / 2); area = Math.PI * D * D / 4; break; }
    case "carre_plein": { const [a] = n; w = h = a; d = R.drawRectangle(a, a); area = a * a; break; }
    case "plat": { const [a, t] = n; w = a; h = t; d = R.drawRectangle(a, t); area = a * t; break; }
    case "corniere": {
      const [a, t] = n; w = h = a;
      d = R.draw([-a / 2, -a / 2]).hLine(a).vLine(t).hLine(-(a - t)).vLine(a - t).hLine(-t).close();
      area = t * (2 * a - t); break;
    }
    case "te": {
      const [a, t] = n; w = h = a;
      d = R.draw([-a / 2, a / 2]).hLine(a).vLine(-t).hLine(-(a - t) / 2).vLine(-(a - t)).hLine(-t).vLine(a - t).hLine(-(a - t) / 2).close();
      area = t * (2 * a - t); break;
    }
    case "ipe": case "hea": case "heb": {
      const [H, B, tw, tf] = I_DATA[family][n[0]]; w = B; h = H;
      d = R.draw([-B / 2, -H / 2]).hLine(B).vLine(tf).hLine(-(B - tw) / 2).vLine(H - 2 * tf).hLine((B - tw) / 2).vLine(tf).hLine(-B).vLine(-tf).hLine((B - tw) / 2).vLine(-(H - 2 * tf)).hLine(-(B - tw) / 2).close();
      area = 2 * B * tf + (H - 2 * tf) * tw; break;
    }
    case "upn": {
      const [H, B, tw, tf] = I_DATA.upn[n[0]]; w = B; h = H;
      d = R.draw([-B / 2, -H / 2]).hLine(B).vLine(tf).hLine(-(B - tw)).vLine(H - 2 * tf).hLine(B - tw).vLine(tf).hLine(-B).close();
      area = 2 * B * tf + (H - 2 * tf) * tw; break;
    }
    default: throw new Error("Profil inconnu");
  }
  return { drawing: d, area, w, h };
}
export function profileName(family, size) { return (PROFILE_FAMILIES[family]?.label || family) + " " + size; }
