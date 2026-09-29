"use client";

// Édition de la liste d'épicerie (séparée du mode « courses » pour ne pas cocher par erreur) :
// ajouter un article manuel, corriger nom/quantité/unité/prix, ou retirer une ligne.
// Repliée par défaut (details/summary) — le mode courses reste l'usage principal.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addShoppingItem, deleteShoppingItem, updateShoppingItem } from "@/lib/actions";

type Unit = "g" | "ml" | "unite" | null;

interface Item {
  id: number;
  name: string;
  qty: number | null;
  unit: Unit;
  estCost: number | null;
}

interface Fields {
  name: string;
  qty: string;
  unit: Unit;
  estCost: string;
}

const EMPTY: Fields = { name: "", qty: "", unit: "g", estCost: "" };

function toFields(i: Item): Fields {
  return {
    name: i.name,
    qty: i.qty === null ? "" : String(i.qty),
    unit: i.unit,
    estCost: i.estCost === null ? "" : String(i.estCost),
  };
}

function toPayload(f: Fields) {
  const q = f.qty.trim().replace(",", ".");
  const c = f.estCost.trim().replace(",", ".");
  return {
    name: f.name,
    qty: q === "" ? null : Number(q),
    unit: f.unit,
    estCost: c === "" ? null : Number(c),
  };
}

function UnitSelect({
  value,
  onChange,
  disabled,
}: {
  value: Unit;
  onChange: (u: Unit) => void;
  disabled?: boolean;
}) {
  return (
    <select
      value={value ?? "augout"}
      onChange={(e) => onChange(e.target.value === "augout" ? null : (e.target.value as Unit))}
      disabled={disabled}
      className="champ"
    >
      <option value="g">g</option>
      <option value="ml">ml</option>
      <option value="unite">unité</option>
      <option value="augout">au goût</option>
    </select>
  );
}

export function ShoppingListEditor({ batchId, items }: { batchId: number; items: Item[] }) {
  const [add, setAdd] = useState<Fields>(EMPTY);
  const [edits, setEdits] = useState<Record<number, Fields>>(
    Object.fromEntries(items.map((i) => [i.id, toFields(i)])),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) {
        setError(res.error ?? "Échec.");
        return;
      }
      router.refresh();
    });

  const addItem = () =>
    run(async () => {
      const res = await addShoppingItem(batchId, toPayload(add));
      if (res.ok) setAdd(EMPTY);
      return res;
    });

  return (
    <details className="carte">
      <summary className="flex min-h-11 cursor-pointer list-none items-center px-4 text-sm font-semibold">
        Modifier la liste (ajouter / corriger)
      </summary>
      <div className="space-y-4 border-t border-[var(--bordure)] p-4">
        {error && (
          <p className="bandeau erreur" role="alert">
            {error}
          </p>
        )}

        {/* Ajout d'un article manuel */}
        <div className="carte space-y-2 p-3">
          <p className="text-sm font-medium">Ajouter un article</p>
          <input
            type="text"
            value={add.name}
            onChange={(e) => setAdd({ ...add, name: e.target.value })}
            placeholder="Nom (ex. Sacs de congélation)"
            disabled={pending}
            className="champ"
          />
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              inputMode="decimal"
              value={add.qty}
              onChange={(e) => setAdd({ ...add, qty: e.target.value })}
              placeholder="Qté"
              disabled={pending}
              className="champ w-16 text-center num"
            />
            <UnitSelect value={add.unit} onChange={(u) => setAdd({ ...add, unit: u })} disabled={pending} />
            <input
              type="text"
              inputMode="decimal"
              value={add.estCost}
              onChange={(e) => setAdd({ ...add, estCost: e.target.value })}
              placeholder="Prix $"
              disabled={pending}
              className="champ w-20 text-center num"
            />
            <button
              type="button"
              onClick={addItem}
              disabled={pending || !add.name.trim()}
              className="bouton bouton-principal ml-auto"
            >
              Ajouter
            </button>
          </div>
        </div>

        {/* Correction des articles existants */}
        <ul className="space-y-2">
          {items.map((item) => {
            const f = edits[item.id] ?? toFields(item);
            const setF = (patch: Partial<Fields>) =>
              setEdits((prev) => ({ ...prev, [item.id]: { ...f, ...patch } }));
            return (
              <li key={item.id} className="carte space-y-2 p-3">
                <input
                  type="text"
                  value={f.name}
                  onChange={(e) => setF({ name: e.target.value })}
                  disabled={pending}
                  className="champ"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={f.qty}
                    onChange={(e) => setF({ qty: e.target.value })}
                    placeholder="Qté"
                    disabled={pending}
                    className="champ w-16 text-center num"
                  />
                  <UnitSelect value={f.unit} onChange={(u) => setF({ unit: u })} disabled={pending} />
                  <input
                    type="text"
                    inputMode="decimal"
                    value={f.estCost}
                    onChange={(e) => setF({ estCost: e.target.value })}
                    placeholder="Prix $"
                    disabled={pending}
                    className="champ w-20 text-center num"
                  />
                  <button
                    type="button"
                    onClick={() => run(() => updateShoppingItem(item.id, toPayload(f)))}
                    disabled={pending || !f.name.trim()}
                    className="bouton bouton-second ml-auto"
                  >
                    Enregistrer
                  </button>
                  <button
                    type="button"
                    onClick={() => run(() => deleteShoppingItem(item.id))}
                    disabled={pending}
                    className="bouton bouton-second"
                  >
                    Suppr.
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </details>
  );
}
