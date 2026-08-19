"use client";

// LA liste d'épicerie — l'écran que Marc tient debout, une main sur un panier.
//
// Cochage OPTIMISTE : le trait apparaît immédiatement, l'écriture part en arrière-plan ; si
// elle échoue (réseau d'épicerie…), la case REVIENT et un bandeau le dit — jamais un état
// local qui ment sur ce qui est sauvegardé.
//
// Refonte du 13/08/2026 : la barre d'avancement remplace la fraction « 3/12 ». Debout dans
// une allée, une barre se lit d'un coup d'œil là où un rapport de deux nombres demande un
// calcul. Les rangées passent à 56 px de haut : la cible n'est plus la case mais la ligne
// entière, ce qui compte quand l'autre main pousse un chariot.

import { useMemo, useState } from "react";
import { toggleShoppingItem } from "@/lib/actions";
import { formatQty } from "@/lib/aggregate";
import { formatMontant, progressionCourses } from "@/lib/courses";

interface Item {
  id: number;
  name: string;
  qty: number | null;
  unit: "g" | "ml" | "unite" | null;
  estCost: number | null;
  checked: boolean;
}

export function ShoppingChecklist({ items: initial }: { items: Item[] }) {
  const [items, setItems] = useState(initial);
  const [syncError, setSyncError] = useState(false);

  const remaining = useMemo(() => items.filter((i) => !i.checked), [items]);
  const done = useMemo(() => items.filter((i) => i.checked), [items]);
  const progression = useMemo(() => progressionCourses(items), [items]);

  const toggle = (item: Item) => {
    const next = !item.checked;
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, checked: next } : i)));
    void toggleShoppingItem(item.id, next).then((res) => {
      if (!res.ok) {
        setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, checked: !next } : i)));
        setSyncError(true);
      } else {
        setSyncError(false);
      }
    });
  };

  const Row = ({ item }: { item: Item }) => (
    <li>
      <button
        type="button"
        onClick={() => toggle(item)}
        aria-pressed={item.checked}
        className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left"
      >
        <span
          aria-hidden
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border-2"
          style={{
            borderColor: item.checked ? "var(--accent)" : "var(--bordure)",
            backgroundColor: item.checked ? "var(--accent)" : "transparent",
            color: "var(--sur-accent)",
          }}
        >
          {item.checked && (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="m5 12.5 4.5 4.5L19 7" />
            </svg>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span
            className={item.checked ? "line-through" : "font-medium"}
            style={{ color: item.checked ? "var(--texte-doux)" : "var(--texte)" }}
          >
            {item.name}
          </span>
          <span className="ml-2 text-sm tabular-nums doux">{formatQty(item.qty, item.unit)}</span>
        </span>
        {item.estCost !== null && (
          <span className="shrink-0 text-sm tabular-nums doux">{formatMontant(item.estCost)}</span>
        )}
      </button>
    </li>
  );

  if (items.length === 0) {
    return (
      <p
        className="rounded-2xl border border-dashed p-6 text-center text-sm doux"
        style={{ borderColor: "var(--bordure)" }}
      >
        Liste vide.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {syncError && (
        <p
          className="rounded-xl p-3 text-sm"
          style={{ backgroundColor: "var(--erreur-fond)", color: "var(--erreur-texte)" }}
        >
          Échec de sauvegarde (réseau ?) — la case a été remise. Réessaie.
        </p>
      )}

      {/* Reste collé sous l'en-tête : au milieu d'une liste de trente articles, l'avancement
          doit rester visible sans remonter. */}
      <div
        className="carte sticky top-14 z-10 px-4 py-3"
        style={{ backgroundColor: "var(--surface)" }}
      >
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-medium">
            {progression.termine ? "Tout est pris" : `${progression.pris} sur ${progression.total} pris`}
          </span>
          <span className="text-sm tabular-nums doux">
            {/* « estimé » est DIT : ce sont des prix devinés par un modèle, pas des prix
                relevés en magasin. Un montant nu passerait pour un vrai total. */}
            reste {formatMontant(progression.restantEstime)} estimé
            {progression.montantIncomplet ? "+" : ""}
          </span>
        </div>
        <div
          className="mt-2 h-2 overflow-hidden rounded-full"
          style={{ backgroundColor: "var(--surface-douce)" }}
          role="progressbar"
          aria-valuenow={progression.pourcentage}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Articles pris"
        >
          <div
            className="h-full rounded-full transition-[width] duration-200"
            style={{ width: `${progression.pourcentage}%`, backgroundColor: "var(--accent)" }}
          />
        </div>
        {progression.montantIncomplet && (
          <p className="mt-2 text-xs doux">
            Le « + » signale des articles restants sans coût estimé : le montant est un
            plancher, pas le total.
          </p>
        )}
      </div>

      <ul className="carte divide-y overflow-hidden" style={{ borderColor: "var(--bordure)" }}>
        {remaining.map((item) => (
          <Row key={item.id} item={item} />
        ))}
      </ul>

      {done.length > 0 && (
        <>
          <h2 className="pt-1 text-sm font-medium doux">Dans le panier ({done.length})</h2>
          <ul className="carte divide-y overflow-hidden" style={{ borderColor: "var(--bordure)" }}>
            {done.map((item) => (
              <Row key={item.id} item={item} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
