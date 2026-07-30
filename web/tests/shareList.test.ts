// Export de la liste de courses (texte à partager vers Keep/Notes).

import { describe, expect, it } from "vitest";
import { buildText } from "../components/ShareListButton";

const it2 = (name: string, qty: number | null, unit: "g" | "ml" | "unite" | null, checked = false) => ({
  name,
  qty,
  unit,
  checked,
});

describe("buildText", () => {
  it("titre + articles à acheter (non cochés), quantités formatées", () => {
    const out = buildText("Semaine 1", [it2("Poulet", 500, "g"), it2("Oignon", 2, "unite")]);
    expect(out?.title).toBe("Épicerie — Semaine 1");
    expect(out?.body).toBe("Épicerie — Semaine 1\n- Poulet — 500 g\n- Oignon — 2");
  });

  it("n'exporte que le RESTANT (articles cochés = déjà dans le panier)", () => {
    const out = buildText("B", [it2("Riz", 1000, "g", true), it2("Lait", 2000, "ml", false)]);
    expect(out?.body).toContain("Lait");
    expect(out?.body).not.toContain("Riz");
  });

  it("« au goût » (qty null) → pas de quantité affichée", () => {
    const out = buildText("B", [it2("Sel", null, null)]);
    expect(out?.body).toBe("Épicerie — B\n- Sel");
  });

  it("tout coché → on exporte quand même toute la liste (repli)", () => {
    const out = buildText("B", [it2("Riz", 1000, "g", true)]);
    expect(out?.body).toContain("Riz");
  });

  it("liste vide → null (rien à partager)", () => {
    expect(buildText("B", [])).toBeNull();
  });
});
