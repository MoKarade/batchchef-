"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { recipesApi } from "@/lib/api";
import {
  ChevronLeft,
  ChevronRight,
  X,
  Play,
  Pause,
  RotateCcw,
  Timer,
  Flame,
  Users,
  Clock,
} from "lucide-react";
import toast from "react-hot-toast";
import { Skeleton } from "@/components/shared/Skeleton";

/**
 * Fullscreen cooking mode — big typography, keyboard + swipe nav, per-step
 * timer. Opens from the recipe detail page ("Cuisiner") or batch detail.
 *
 * Design constraints:
 *   - Tablet landscape is the primary viewport.
 *   - Instructions are split on "\n\n" paragraphs (Marmiton writes one step
 *     per paragraph most of the time). Fallback: split on ". " with length
 *     >= 40 to avoid treating "Salt." as a step.
 *   - Timer starts fresh per step and resets on navigation. Plays a tone
 *     via the Web Audio API when done.
 */
export function CookingModePage({ recipeId }: { recipeId: number }) {
  const router = useRouter();

  const { data: recipe, isLoading } = useQuery({
    queryKey: ["recipe", recipeId],
    queryFn: () => recipesApi.get(recipeId).then((r) => r.data),
  });

  const steps = useMemo(() => splitIntoSteps(recipe?.instructions ?? ""), [recipe]);
  const [stepIdx, setStepIdx] = useState(0);

  // Keyboard nav: ←/→ for steps, Esc to quit, Space for timer toggle
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") setStepIdx((i) => Math.min(i + 1, steps.length - 1));
      if (e.key === "ArrowLeft") setStepIdx((i) => Math.max(i - 1, 0));
      if (e.key === "Escape") router.push(`/recipes/${recipeId}`);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [steps.length, router, recipeId]);

  if (isLoading) {
    return (
      <div className="fixed inset-0 bg-background z-50 p-10">
        <Skeleton className="h-12 w-64 mb-6" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }
  if (!recipe) {
    return (
      <div className="p-6 text-sm text-muted-foreground">Recette introuvable.</div>
    );
  }

  const hasSteps = steps.length > 0;
  const progress = hasSteps ? ((stepIdx + 1) / steps.length) * 100 : 0;

  return (
    <div className="fixed inset-0 bg-background z-50 flex flex-col">
      {/* Top bar */}
      <header className="flex items-center justify-between p-4 sm:p-5 border-b">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-semibold">
            Mode cuisine
          </p>
          <h1 className="title-serif text-xl sm:text-2xl font-bold leading-tight truncate">
            {recipe.title}
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-3 text-xs text-muted-foreground">
            {recipe.prep_time_min != null && (
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {recipe.prep_time_min} min
              </span>
            )}
            {recipe.servings && (
              <span className="inline-flex items-center gap-1">
                <Users className="h-3 w-3" />
                {recipe.servings}
              </span>
            )}
          </div>
          <Link
            href={`/recipes/${recipeId}`}
            className="h-9 w-9 rounded-full border bg-card hover:bg-accent flex items-center justify-center"
            title="Quitter (Esc)"
          >
            <X className="h-4 w-4" />
          </Link>
        </div>
      </header>

      {/* Progress */}
      {hasSteps && (
        <div className="h-1 bg-muted">
          <div
            className="h-full bg-gradient-to-r from-primary to-secondary transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {/* Body */}
      <main className="flex-1 overflow-y-auto px-6 py-8 sm:px-12 sm:py-14 max-w-4xl w-full mx-auto">
        {!hasSteps ? (
          <div className="rounded-2xl border border-dashed p-10 text-center">
            <p className="text-sm text-muted-foreground">
              Cette recette n&apos;a pas d&apos;étapes structurées. Les
              instructions originales sont disponibles sur la page détail.
            </p>
            <Link
              href={recipe.marmiton_url}
              target="_blank"
              className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline"
            >
              Voir sur Marmiton →
            </Link>
          </div>
        ) : (
          <>
            <p className="text-[11px] uppercase tracking-[0.25em] text-muted-foreground font-semibold mb-3">
              Étape {stepIdx + 1} sur {steps.length}
            </p>
            <p className="title-serif text-2xl sm:text-3xl leading-[1.35] font-medium text-foreground">
              {steps[stepIdx]}
            </p>

            <StepTimer key={stepIdx} stepText={steps[stepIdx]} />
          </>
        )}
      </main>

      {/* Nav footer */}
      {hasSteps && (
        <footer className="border-t p-4 sm:p-6 flex items-center justify-between gap-3">
          <button
            onClick={() => setStepIdx((i) => Math.max(i - 1, 0))}
            disabled={stepIdx === 0}
            className="h-12 rounded-full border bg-card hover:bg-accent disabled:opacity-40 inline-flex items-center gap-2 px-5 text-sm font-semibold transition"
          >
            <ChevronLeft className="h-4 w-4" />
            Précédent
          </button>

          <div className="flex items-center gap-1">
            {steps.map((_, i) => (
              <button
                key={i}
                onClick={() => setStepIdx(i)}
                className={`h-2 rounded-full transition-all ${
                  i === stepIdx ? "w-6 bg-primary" : "w-2 bg-muted-foreground/30"
                }`}
                aria-label={`Étape ${i + 1}`}
              />
            ))}
          </div>

          {stepIdx === steps.length - 1 ? (
            <button
              onClick={() => {
                toast.success("Bon appétit ! 🍴");
                router.push(`/recipes/${recipeId}`);
              }}
              className="h-12 rounded-full bg-primary text-primary-foreground px-5 text-sm font-semibold shadow-lg hover:shadow-xl inline-flex items-center gap-2 transition"
            >
              Terminé
            </button>
          ) : (
            <button
              onClick={() => setStepIdx((i) => Math.min(i + 1, steps.length - 1))}
              className="h-12 rounded-full bg-primary text-primary-foreground px-5 text-sm font-semibold shadow-lg hover:shadow-xl inline-flex items-center gap-2 transition"
            >
              Suivant
              <ChevronRight className="h-4 w-4" />
            </button>
          )}
        </footer>
      )}
    </div>
  );
}

/**
 * Per-step timer. Auto-detects a duration in the step text (e.g.
 * "cuire 15 min" → 15:00), otherwise shows a blank timer the user can
 * start from zero.
 */
function StepTimer({ stepText }: { stepText: string }) {
  const detected = useMemo(() => detectMinutes(stepText), [stepText]);
  const initialSec = detected != null ? detected * 60 : 0;
  // No reset effect needed — the parent re-mounts this component via
  // ``key={stepIdx}`` every time the step changes, so useState() runs fresh.
  const [remaining, setRemaining] = useState(initialSec);
  const [running, setRunning] = useState(false);
  const beepedRef = useRef(false);

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          if (!beepedRef.current) {
            beep();
            beepedRef.current = true;
          }
          setRunning(false);
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [running]);

  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;

  return (
    <div className="mt-10 rounded-2xl border bg-card p-5 flex items-center justify-between gap-4 max-w-lg">
      <div className="flex items-center gap-3">
        <div
          className={`h-12 w-12 rounded-xl flex items-center justify-center ${
            running
              ? "bg-primary/15 text-primary animate-pulse"
              : "bg-muted text-muted-foreground"
          }`}
        >
          {running ? <Flame className="h-5 w-5" /> : <Timer className="h-5 w-5" />}
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
            Minuteur
          </p>
          <p className="title-serif text-3xl font-bold tabular-nums leading-none">
            {String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}
          </p>
          {detected != null && initialSec === remaining && !running && (
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Détecté : {detected} min
            </p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => setRunning((r) => !r)}
          className="h-10 w-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow hover:shadow-md"
          aria-label={running ? "Pause" : "Démarrer"}
        >
          {running ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </button>
        <button
          onClick={() => {
            setRunning(false);
            setRemaining(initialSec);
            beepedRef.current = false;
          }}
          className="h-10 w-10 rounded-full border bg-background hover:bg-accent flex items-center justify-center"
          aria-label="Reset"
        >
          <RotateCcw className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function splitIntoSteps(instructions: string): string[] {
  if (!instructions) return [];
  // First: blank-line separated paragraphs (ideal case)
  const paras = instructions
    .split(/\n\s*\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (paras.length >= 2) return paras;

  // Fallback: numbered list "1. foo  2. bar"
  const numbered = instructions
    .split(/(?=\b\d+[\.\)]\s)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 10);
  if (numbered.length >= 2) return numbered;

  // Last resort: sentence-level split with min length 40 to avoid garbage
  const sentences = instructions
    .split(/(?<=[.!?])\s+(?=[A-ZÉÈÀÂÎ])/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 40);
  if (sentences.length >= 2) return sentences;

  return [instructions.trim()].filter((s) => s.length > 0);
}

function detectMinutes(text: string): number | null {
  const m = text.match(/(\d+)\s*(min|minutes?)/i);
  if (m) return parseInt(m[1], 10);
  const h = text.match(/(\d+)\s*(h|heures?)/i);
  if (h) return parseInt(h[1], 10) * 60;
  return null;
}

function beep() {
  try {
    const AC = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    osc.type = "sine";
    osc.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
    setTimeout(() => ctx.close(), 400);
  } catch {
    // Audio blocked / unsupported — silent fail is fine
  }
}
