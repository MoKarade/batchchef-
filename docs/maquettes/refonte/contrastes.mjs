// Mesure des contrastes WCAG des jetons de refonte.css (thème sombre seul).
// Usage : node contrastes.mjs   -> sortie non nulle si un couple échoue.
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("./refonte.css", import.meta.url), "utf8");
const bloc = css.slice(css.indexOf(":root {"), css.indexOf("}", css.indexOf(":root {")));
const v = {};
for (const m of bloc.matchAll(/--([a-z-]+):\s*(#[0-9a-f]{6})/g)) v[m[1]] = m[2];

const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = (h) => { const n = parseInt(h.slice(1), 16); return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255); };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// [texte, fond, minimum, rôle]  (4,5 = texte ; 3 = composant d'interface, WCAG 1.4.11)
const couples = [
  ["texte", "fond", 4.5, "texte sur page"],
  ["texte", "surface", 4.5, "texte sur carte"],
  ["texte-doux", "surface", 4.5, "texte doux sur carte"],
  ["texte-doux", "fond", 4.5, "texte doux sur page"],
  ["texte-doux", "surface-douce", 4.5, "texte doux sur tuile"],
  ["sur-accent", "accent", 4.5, "bouton principal"],
  ["sur-accent", "accent-fonce", 4.5, "bouton principal (survol)"],
  ["repere", "fond", 4.5, "repère sur page (surtitre)"],
  ["repere", "surface", 4.5, "repère sur carte"],
  ["repere", "repere-doux", 4.5, "repère : pastille / nav actif"],
  ["succes-texte", "succes-fond", 4.5, "succès"],
  ["alerte-texte", "alerte-fond", 4.5, "alerte"],
  ["erreur-texte", "erreur-fond", 4.5, "erreur"],
  ["erreur-texte", "surface", 4.5, "bouton danger / texte d'erreur"],
  ["texte", "surface-douce", 4.5, "texte sur pastille neutre"],
  ["fond", "texte", 4.5, "onglet actif (texte inversé)"],
  ["bordure-champ", "surface", 3, "contour de champ / case"],
  ["bordure-champ", "fond", 3, "contour de champ sur page"],
  ["accent", "fond", 3, "anneau de focus"],
  ["repere", "fond", 3, "trait actif de la navigation"],
];
let echecs = 0;
for (const [a, b, min, role] of couples) {
  const r = ratio(v[a], v[b]);
  const ok = r >= min;
  if (!ok) echecs++;
  console.log(`${ok ? "OK   " : "ÉCHEC"} ${r.toFixed(2).padStart(5)}:1 (min ${min})  ${a} ${v[a]} / ${b} ${v[b]}  - ${role}`);
}
console.log(echecs ? `\n${echecs} couple(s) sous le seuil` : "\nTous les couples passent.");
process.exit(echecs ? 1 : 0);
