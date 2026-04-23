"use client";

import { useEffect, useState } from "react";
import { Shield } from "lucide-react";
import { ingredientsApi, type IngredientMaster } from "@/lib/api";

/**
 * Allergy presets — preset groups of canonical parent names that, when
 * toggled, get resolved to real IngredientMaster rows and merged into the
 * parent's excludedIngs state.
 *
 * Each preset lists canonical names to search; the component queries
 * /api/ingredients?search=X for each and unions the resulting parent ids.
 * Cached per preset so toggling on/off is instant after the first load.
 */
const ALLERGY_PRESETS = [
  {
    key: "arachide",
    label: "Arachide",
    emoji: "🥜",
    searches: ["arachide", "cacahuete"],
  },
  {
    key: "noix",
    label: "Noix à coque",
    emoji: "🌰",
    searches: ["noix", "amande", "noisette", "pistache", "pecan", "pignon"],
  },
  {
    key: "gluten",
    label: "Gluten",
    emoji: "🌾",
    searches: ["farine", "pain", "pates", "seitan", "boulgour", "orge", "seigle", "couscous"],
  },
  {
    key: "lactose",
    label: "Lactose",
    emoji: "🥛",
    searches: ["lait", "beurre", "creme", "fromage", "yogourt", "mozzarella", "parmesan", "cheddar", "ricotta", "feta", "brie", "camembert", "emmental", "gruyere", "mascarpone", "philadelphia"],
  },
  {
    key: "oeuf",
    label: "Œuf",
    emoji: "🥚",
    searches: ["oeuf", "œuf", "jaune", "blanc"],
  },
  {
    key: "soja",
    label: "Soja",
    emoji: "🫘",
    searches: ["soja", "tofu", "tempeh", "edamame", "miso"],
  },
  {
    key: "poisson",
    label: "Poisson",
    emoji: "🐟",
    searches: ["poisson", "thon", "saumon", "truite", "morue", "sole", "sardine", "anchois", "maquereau", "cabillaud", "bar"],
  },
  {
    key: "crustace",
    label: "Crustacés",
    emoji: "🦐",
    searches: ["crevette", "crabe", "homard", "langoustine", "ecrevisse"],
  },
  {
    key: "sesame",
    label: "Sésame",
    emoji: "⚪",
    searches: ["sesame", "tahini"],
  },
] as const;

type AllergyKey = typeof ALLERGY_PRESETS[number]["key"];

export function AllergyFilter({
  excluded,
  onMergeExclude,
  onRemoveExclude,
}: {
  /** Currently excluded ingredients (parent-level IngredientMaster objects) */
  excluded: IngredientMaster[];
  /** Add these ingredients to the exclude set (dedup in parent) */
  onMergeExclude: (ings: IngredientMaster[]) => void;
  /** Remove an id from the exclude set */
  onRemoveExclude: (id: number) => void;
}) {
  const [active, setActive] = useState<Set<AllergyKey>>(new Set());
  const [loading, setLoading] = useState<AllergyKey | null>(null);
  // Remember which ids each preset added so we can undo cleanly
  const [presetIds, setPresetIds] = useState<Record<string, number[]>>({});

  // When user removes a chip externally, also uncheck any preset that
  // references it (so the checkbox stays in sync with reality).
  useEffect(() => {
    const excludedIds = new Set(excluded.map((x) => x.id));
    setActive((prev) => {
      const next = new Set(prev);
      for (const key of prev) {
        const ids = presetIds[key] || [];
        if (ids.length > 0 && !ids.some((id) => excludedIds.has(id))) {
          next.delete(key);
        }
      }
      return next;
    });
  }, [excluded, presetIds]);

  const toggle = async (preset: typeof ALLERGY_PRESETS[number]) => {
    const key = preset.key;
    if (active.has(key)) {
      // Uncheck: remove all ids this preset contributed
      for (const id of presetIds[key] || []) {
        onRemoveExclude(id);
      }
      setActive((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      return;
    }
    // Check: fetch parents matching each search term, dedupe by id
    setLoading(key);
    try {
      const byId = new Map<number, IngredientMaster>();
      for (const term of preset.searches) {
        const r = await ingredientsApi.list({
          search: term,
          parent_id: "null",
          limit: 20,
        });
        for (const ing of r.data) {
          // Extra safety: only match parents whose canonical contains the term
          const lc = (ing.canonical_name || "").toLowerCase();
          if (!term.split(/\s+/).every((t) => lc.includes(t))) continue;
          byId.set(ing.id, ing);
        }
      }
      const resolved = Array.from(byId.values());
      setPresetIds((prev) => ({ ...prev, [key]: resolved.map((i) => i.id) }));
      onMergeExclude(resolved);
      setActive((prev) => new Set(prev).add(key));
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground font-medium mr-1">
        <Shield className="h-3.5 w-3.5" />
        Allergies / à exclure
      </span>
      {ALLERGY_PRESETS.map((preset) => {
        const checked = active.has(preset.key);
        const busy = loading === preset.key;
        return (
          <button
            key={preset.key}
            onClick={() => toggle(preset)}
            disabled={busy}
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 h-7 text-xs font-medium transition-colors ${
              checked
                ? "bg-destructive/15 border-destructive/40 text-destructive hover:bg-destructive/25"
                : "bg-background border-border text-muted-foreground hover:border-destructive/30"
            } ${busy ? "opacity-50" : ""}`}
          >
            <span>{preset.emoji}</span>
            {preset.label}
          </button>
        );
      })}
    </div>
  );
}
