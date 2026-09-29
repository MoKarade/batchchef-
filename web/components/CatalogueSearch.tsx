"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function CatalogueSearch({ initial }: { initial: string }) {
  const [q, setQ] = useState(initial);
  const router = useRouter();
  return (
    <form
      className="ligne"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        router.push(q.trim() ? `/catalogue?q=${encodeURIComponent(q.trim())}` : "/catalogue");
      }}
    >
      <div className="min-w-0 flex-1 basis-60">
        <label className="etiquette" htmlFor="recherche-catalogue">
          Rechercher
        </label>
        <input
          id="recherche-catalogue"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Chercher une recette ou un ingrédient (ex. poulet, gingembre, tarte…)"
          className="champ"
        />
      </div>
      <button type="submit" className="bouton bouton-principal self-end">
        Chercher
      </button>
    </form>
  );
}
