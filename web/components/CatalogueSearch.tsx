"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function CatalogueSearch({ initial }: { initial: string }) {
  const [q, setQ] = useState(initial);
  const router = useRouter();
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        router.push(q.trim() ? `/catalogue?q=${encodeURIComponent(q.trim())}` : "/catalogue");
      }}
    >
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Chercher une recette ou un ingrédient (ex. poulet, gingembre, tarte…)"
        className="min-w-0 flex-1 rounded-xl border border-[var(--bordure)] bg-[var(--surface)] px-3 py-3 text-sm"
      />
      <button type="submit" className="rounded-xl px-4 py-3 text-sm font-medium sur-accent" style={{ backgroundColor: "var(--accent)" }}>
        Chercher
      </button>
    </form>
  );
}
