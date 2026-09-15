// lib/hubSummary.ts — construit le résumé BatchChef pour le hub perso (hubperso.com),
// conforme au contrat @mokarade/hub-contract v1. Données RÉELLES agrégées depuis Neon ;
// base vide → status "building" (jamais de chiffres inventés).
//
// Deux couches : `composeBatchchefSummary` est PURE (agrégats → HubSummary validé, testable
// sans base), `buildBatchchefSummary` lit Neon puis délègue à la première.

import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import { validateSummary, type HubDetailSection, type HubSummary } from "@mokarade/hub-contract";
import { db, schema } from "@/lib/db";
import { totalLlmCostUsd } from "@/lib/llmUsage";
import { semaineISO } from "@/lib/semaine";
import { lireSemaine, type RecetteSemaine } from "@/lib/semaineDb";
import { LIBELLES } from "@/lib/typePlat";

const APP_COLOR = "#c2410c"; // orange cuisine
const ACTIVE = ["planifie", "courses", "cuisine"] as const;

/**
 * L'URL publique de BatchChef, qui part dans le summary et devient les liens du hub.
 *
 * Le défaut est passé de `batchchef-glu8-chi.vercel.app` à `batchchef.hubperso.com` le
 * 14/08 : c'est ce déménagement qui permet à BatchChef de recevoir le cookie de session
 * partagé (un cookie ne franchit pas la frontière entre deux domaines). L'ancienne adresse
 * répond toujours, mais un lien qui y renvoie ferait sortir du domaine du hub — et la
 * personne s'y retrouverait déconnectée sans comprendre pourquoi.
 */
export function publicUrl(): string {
  const raw = (process.env.BATCHCHEF_PUBLIC_URL || "https://batchchef.hubperso.com").trim();
  return raw.replace(/\/+$/, "");
}

/**
 * Fenêtre du compteur d'activité, en jours. UNE SEULE source pour le CALCUL et pour le
 * LIBELLÉ, et c'est tout l'intérêt.
 *
 * ⚠️ Mesuré par mutation le 15/09/2026 : avec « 30 » écrit deux fois — une fois dans le SQL,
 * une fois dans le libellé — faire passer l'intervalle de 30 à 365 jours ne faisait tomber
 * AUCUN test. La carte aurait annoncé « Batchs (30 jours) » en comptant une année. Les tests
 * ne pouvaient pas le voir : ils exercent `composeBatchchefSummary`, qui reçoit des compteurs
 * DÉJÀ calculés, alors que le SQL vit dans `buildBatchchefSummary` et demande une vraie base.
 *
 * Plutôt que d'ajouter un test qui aurait demandé Postgres, la divergence est rendue
 * INEXPRIMABLE : les deux endroits lisent cette constante. C'est le même remède que le type
 * `IssueReleve` du hub le même jour — on ne surveille pas une confusion, on l'empêche.
 */
export const FENETRE_BATCHS_JOURS = 30;

/** Agrégats bruts nécessaires au summary (tous côté données, jamais inventés). */
export interface BatchchefCounts {
  recipes: number;
  batches: number;
  activeBatches: number;
  /**
   * Batchs créés dans les 30 DERNIERS JOURS — demande de Marc (15/09/2026) : « le nombre de
   * batch pour ce dernier mois ».
   *
   * ⚠️ TRENTE JOURS GLISSANTS, PAS LE MOIS CIVIL, et c'est un arbitrage assumé. Un compteur
   * de mois civil retombe à ZÉRO le 1er de chaque mois : le matin du 1er octobre, une cuisine
   * qui a tourné tout septembre afficherait « 0 batch ». Vrai au sens strict, faux au sens
   * utile — ce chiffre existe pour dire « est-ce que ça tourne », pas pour clôturer une
   * comptabilité.
   *
   * Le libellé publié dit donc « 30 jours » et non « ce mois-ci ». Une fenêtre glissante
   * annoncée comme un mois civil serait le même mensonge que le « sur 7 j » que le hub
   * affichait sur quatre heures d'historique — corrigé chez lui le jour même.
   */
  batchesLastMonth: number;
  toBuy: number;
  budgetRemaining: number;
  /** Batch actif le plus récent → lien direct « liste de courses » dans la carte du hub. */
  activeBatchId: number | null;
  /** Nom du batch actif le plus récent — ce que Marc est en train de cuisiner. */
  activeBatchName: string | null;
  /** Coût LLM cumulé en USD (bloc usage du hub). */
  llmCostUsd: number;
  /**
   * Dernier geste de Marc dans l'app, ISO — le batch le plus récent ou la dernière case
   * d'épicerie cochée. `null` si rien n'est daté.
   *
   * ⚠️ C'est la fraîcheur d'une DONNÉE, pas d'une passe de moteur : BatchChef n'a pas de
   * moteur. Voir `composeBatchchefSummary`, qui explique pourquoi elle se publie SANS seuil.
   */
  lastActivityAt: string | null;
  /** La proposition de la semaine, LUE (jamais fabriquée depuis un GET du hub). */
  semaine: { semaine: string; recettes: RecetteSemaine[] } | null;
}

/** Le contrat borne les libellés à 40 et les précisions à 80 : on tronque plutôt qu'être rejeté. */
function borne(texte: string, max: number): string {
  const t = texte.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}\u2026`;
}

/** « 1 h 20 », « 25 min », ou rien quand la durée est inconnue (jamais « 0 min »). */
function duree(minutes: number | null): string {
  if (minutes === null || minutes <= 0) return "";
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m}`;
}

/**
 * Les sections `details` du contrat v1.3. PURE.
 *
 * ── LA SEMAINE EST LUE, JAMAIS FABRIQUÉE ────────────────────────────────────────────
 *
 * `counts.semaine` vient de `lireSemaine` (lecture seule) et pas de `semaineCourante`, qui
 * FABRIQUE la proposition manquante avec un `delete` + `insert`. Le hub interroge ce endpoint
 * toutes les ~15 s tant qu'un onglet est ouvert, et son horloge toutes les 30 min sans
 * personne devant : y brancher `semaineCourante` fabriquerait la semaine de Marc à son insu,
 * et le `delete … where semaine <> …` effacerait la précédente. Un GET n'écrit pas.
 *
 * `null` (pas encore de proposition) n'est donc PAS une anomalie : c'est ce que le hub voit
 * un lundi matin avant que Marc n'ouvre son app. Aucune section, plutôt qu'un encadré vide
 * qui ressemblerait à une donnée qui n'a pas chargé.
 */
function sectionsDetail(counts: BatchchefCounts): HubDetailSection[] {
  const sections: HubDetailSection[] = [];

  const semaine = counts.semaine;
  if (semaine !== null && semaine.recettes.length > 0) {
    sections.push({
      title: borne(`Semaine ${semaine.semaine}`, 40),
      // Le contrat plafonne à 8 lignes ; la proposition en compte 4 (`RECETTES_PAR_SEMAINE`).
      // Le `slice` est une ceinture au cas où ce nombre monterait un jour : un dépassement
      // ferait REJETER le résumé entier, donc accuserait BatchChef d'une panne inexistante.
      items: semaine.recettes.slice(0, 8).map((r) => {
        const bouts = [
          r.type !== null ? LIBELLES[r.type] : "",
          duree((r.prepMinutes ?? 0) + (r.cuissonMinutes ?? 0)),
        ].filter((x) => x !== "");
        return {
          // ⚠️ LE NUMÉRO N'EST PAS DÉCORATIF, IL REND LE LIBELLÉ UNIQUE.
          //
          // Le contrat REFUSE deux lignes de même libellé dans une section — et un refus
          // fait jeter `validateSummary` à l'émission, donc basculer TOUT le summary en
          // `status: "error"` : la carte entière deviendrait « impossible de lire l'état »
          // à cause de deux titres qui se ressemblent. Découvert en écrivant le test des
          // bornes, pas en production, et c'est bien là qu'il fallait le trouver.
          //
          // Sur 10 188 recettes, deux titres qui partagent leurs 37 premiers caractères
          // existent (« Gratin de pommes de terre et de courgettes au parmesan » / « … au
          // comté ») : la troncature à 40 les rendait identiques. La `position` est UNIQUE
          // par semaine — contrainte `week_picks_semaine_position` en base, pas une
          // convention — donc le préfixe l'est aussi.
          //
          // Et il informe : c'est le numéro auquel Marc parle (« remplace la deuxième »,
          // cf. `remplacerPosition`). Le rendre visible fait correspondre ce que le hub
          // affiche à ce qu'il dira à l'assistant.
          label: `${r.position + 1}. ${borne(r.titre, 40 - 3)}`,
          // La VALEUR est le titre et non un numéro de position : c'est ce qu'on lit. Le
          // libellé porte déjà le titre tronqué à 40 ; la valeur le redonne à 60, parce que
          // les titres de recettes sont longs et que couper « Gratin de courgettes au… » à
          // quarante caractères perd souvent le plat.
          value: borne(r.titre, 60),
          format: "text" as const,
          ...(bouts.length > 0 ? { hint: borne(bouts.join(" \u00b7 "), 80) } : {}),
        };
      }),
    });
  }

  sections.push({
    title: "Épicerie et cuisine",
    items: [
      { label: "Articles à acheter", value: counts.toBuy, format: "number" as const },
      {
        label: "Budget restant (est.)",
        value: Math.round(counts.budgetRemaining * 100) / 100,
        format: "currency" as const,
        hint: "somme des lignes RÉELLEMENT chiffrées",
      },
      { label: "Batchs actifs", value: counts.activeBatches, format: "number" as const },
      { label: "Batchs au total", value: counts.batches, format: "number" as const },
    ],
  });

  return sections;
}

/** Compose un HubSummary VALIDÉ à partir des agrégats (jette si le payload dévie du contrat). */
export function composeBatchchefSummary(counts: BatchchefCounts, base = publicUrl()): HubSummary {
  const budgetRemaining = Math.round(counts.budgetRemaining * 100) / 100;

  // Base VRAIMENT vide (aucune recette, aucun batch) → état honnête "building", pas "ok à 0".
  const status: HubSummary["status"] =
    counts.recipes === 0 && counts.batches === 0 ? "building" : "ok";

  // `primary` (contrat v1.3) = LE chiffre de la carte, et il SUIT ce qu'il y a à faire.
  //
  // « Recettes » est le plus gros nombre de l'app (dix mille et des) et le moins informatif :
  // il ne bouge quasiment jamais. Mettre en avant un nombre figé est la façon la plus sûre de
  // faire cesser de regarder une carte. Ce qui compte pour une app de cuisine en lots, c'est
  // ce qui reste à faire — les courses tant qu'il y en a, l'état de la cuisine sinon. Même
  // repli conditionnel que JobAI, et pour la même raison : une carte sans chiffre mis en
  // avant est une carte qu'on ne lit pas.
  const enCourses = counts.toBuy > 0;
  const metrics: HubSummary["metrics"] = [
    {
      label: "Articles à acheter",
      value: counts.toBuy,
      format: "number",
      severity: enCourses ? "warn" : "ok",
      ...(enCourses ? { primary: true as const } : {}),
    },
    {
      label: "Batchs actifs",
      value: counts.activeBatches,
      format: "number",
      ...(enCourses ? {} : { primary: true as const }),
    },
    { label: "Budget restant (est.)", value: budgetRemaining, format: "currency" },
    // Demande de Marc (15/09) : voir l'ACTIVITÉ récente, et non le seul instantané. « Batchs
    // actifs » dit ce qui est en cours ; celui-ci dit si la cuisine a TOURNÉ. Un zéro ici à
    // côté d'un total de quarante raconte quelque chose qu'aucune des autres lignes ne dit.
    //
    // ⚠️ « 30 jours » et non « ce mois-ci » : voir `batchesLastMonth`. La fenêtre est
    // glissante, et le libellé le dit plutôt que de laisser croire à un mois civil.
    {
      label: `Batchs (${FENETRE_BATCHS_JOURS} jours)`,
      value: counts.batchesLastMonth,
      format: "number",
    },
    { label: "Recettes", value: counts.recipes, format: "number" },
  ];

  const alerts: HubSummary["alerts"] = [];
  if (counts.toBuy > 0) {
    alerts.push({
      label: `${counts.toBuy} article(s) d'épicerie à acheter`,
      severity: "info",
      href: `${base}/batchs`,
    });
  }

  const actions: HubSummary["actions"] = [
    { label: "Ouvrir BatchChef", kind: "link", href: base },
  ];
  // Lien direct vers la liste d'épicerie du batch actif le plus récent (si présent).
  if (counts.activeBatchId !== null) {
    actions.push({
      label: "Liste d'épicerie",
      kind: "link",
      href: `${base}/courses/${counts.activeBatchId}`,
    });
  }

  // Le NOM du batch en cours, en alerte d'information : « Batchs actifs : 1 » ne dit pas ce
  // qu'on cuisine, et c'est la première chose qu'on veut savoir en regardant la carte.
  if (counts.activeBatchName !== null) {
    alerts.push({ label: borne(`En cours : ${counts.activeBatchName}`, 40), severity: "info" });
  }

  const sections = sectionsDetail(counts);

  const summary = {
    contractVersion: 1 as const,
    app: { id: "batchchef", name: "BatchChef", url: base, color: APP_COLOR },
    generatedAt: new Date().toISOString(),
    // ── `dataAsOf` SANS `expectedMaxAgeSec`, ET C'EST UNE DÉCISION ───────────────────
    //
    // Le contrat v1.3 permet de publier un seuil au-delà duquel le hub déclare la donnée
    // FIGÉE. BatchChef n'en publie AUCUN, exprès : les quatre autres apps ont un moteur qui
    // passe (un tick, un cron, un poll), donc un rythme attendu. Ici il n'y a pas de moteur —
    // la donnée change quand MARC cuisine. Une semaine sans batch n'est pas une panne, c'est
    // une semaine où il a mangé dehors.
    //
    // Un seuil, quel qu'il soit, ferait donc crier « BatchChef est figée » à chaque semaine
    // creuse. Sans seuil, le hub affiche l'âge et dit qu'il ne peut pas le juger
    // (`age-connu-non-juge`, ADR-0003 de Hubperso) — ce qui est exactement vrai. C'est le seul
    // état des cinq pour lequel cet état-là est le BON, pas un pis-aller en attendant un
    // re-pin.
    ...(counts.lastActivityAt !== null ? { dataAsOf: counts.lastActivityAt } : {}),
    status,
    metrics,
    alerts,
    actions,
    ...(sections.length > 0 ? { details: sections } : {}),
    // Coût LLM cumulé (estimé) — facturé en USD par Anthropic.
    usage: {
      cost: {
        amount: Math.round(counts.llmCostUsd * 100) / 100,
        currency: "USD" as const,
        period: "total" as const,
      },
    },
  };

  // Conformité prouvée à l'émission : un payload hors contrat jette ici, pas chez le hub.
  return validateSummary(summary);
}

/** Lit l'état réel depuis Neon et compose le HubSummary. */
export async function buildBatchchefSummary(): Promise<HubSummary> {
  const [recipes] = await db.select({ n: count() }).from(schema.recipes);
  const [batches] = await db.select({ n: count() }).from(schema.batches);
  const [activeBatches] = await db
    .select({ n: count() })
    .from(schema.batches)
    .where(inArray(schema.batches.status, [...ACTIVE]));
  // 30 jours glissants, bornés par la BASE (`now()` évalué par Postgres) et non par l'horloge
  // de l'instance : la fenêtre ne dépend donc ni du fuseau du serveur ni d'un décalage entre
  // les deux. TOUS statuts confondus — un batch terminé a bel et bien été cuisiné ce mois-ci,
  // et l'exclure répondrait à une autre question que celle posée.
  const [batchesLastMonth] = await db
    .select({ n: count() })
    .from(schema.batches)
    .where(
      sql`${schema.batches.createdAt} >= now() - make_interval(days => ${FENETRE_BATCHS_JOURS})`,
    );
  const [toBuy] = await db
    .select({ n: count() })
    .from(schema.shoppingItems)
    .innerJoin(schema.batches, eq(schema.batches.id, schema.shoppingItems.batchId))
    .where(and(eq(schema.shoppingItems.checked, false), inArray(schema.batches.status, [...ACTIVE])));
  const [budget] = await db
    .select({ sum: sql<number>`coalesce(sum(${schema.shoppingItems.estCost}), 0)` })
    .from(schema.shoppingItems)
    .innerJoin(schema.batches, eq(schema.batches.id, schema.shoppingItems.batchId))
    .where(
      and(
        eq(schema.shoppingItems.checked, false),
        inArray(schema.batches.status, [...ACTIVE]),
        // uniquement les lignes RÉELLEMENT chiffrées (jamais un total qui ment sur sa complétude)
        sql`${schema.shoppingItems.estCost} is not null`,
      ),
    );
  // Batch actif le plus récent (pour le lien direct « liste de courses » ET son nom).
  const [activeBatch] = await db
    .select({ id: schema.batches.id, name: schema.batches.name, createdAt: schema.batches.createdAt })
    .from(schema.batches)
    .where(inArray(schema.batches.status, [...ACTIVE]))
    .orderBy(desc(schema.batches.createdAt))
    .limit(1);

  // DERNIER GESTE DE MARC — le plus récent des deux seuls faits datés de l'app : la création
  // d'un batch, et une case d'épicerie cochée. Le maximum des deux, pas l'un ou l'autre :
  // pendant une semaine de courses, ce qui bouge est `checked_at`, et le batch a des jours ;
  // le lundi d'un nouveau lot, c'est l'inverse. Prendre un seul des deux publierait une
  // fraîcheur périmée la moitié du temps.
  const [dernierBatch] = await db
    .select({ at: schema.batches.createdAt })
    .from(schema.batches)
    .orderBy(desc(schema.batches.createdAt))
    .limit(1);
  const [dernierCoche] = await db
    .select({ at: sql<Date | null>`max(${schema.shoppingItems.checkedAt})` })
    .from(schema.shoppingItems);

  const llmCostUsd = await totalLlmCostUsd();

  // ⚠️ LECTURE SEULE de la semaine (`lireSemaine`), jamais `semaineCourante` qui la FABRIQUE :
  // un GET du hub ne doit rien écrire. Et échec AVALÉ ici, exprès : la proposition de la
  // semaine est un agrément, pas l'état de l'app. Laisser une panne de cette lecture faire
  // basculer tout le summary en `status: "error"` rendrait la carte inutilisable pour une
  // section de détail — alors que les compteurs, eux, sont là.
  let semaine: BatchchefCounts["semaine"] = null;
  try {
    const cle = semaineISO(new Date());
    const recettes = await lireSemaine(cle);
    if (recettes.length > 0) semaine = { semaine: cle, recettes };
  } catch (err) {
    console.error("[hub/summary] proposition de la semaine illisible", err);
  }

  return composeBatchchefSummary({
    recipes: recipes?.n ?? 0,
    batches: batches?.n ?? 0,
    activeBatches: activeBatches?.n ?? 0,
    batchesLastMonth: batchesLastMonth?.n ?? 0,
    toBuy: toBuy?.n ?? 0,
    budgetRemaining: Number(budget?.sum ?? 0),
    activeBatchId: activeBatch?.id ?? null,
    activeBatchName: activeBatch?.name ?? null,
    lastActivityAt: plusRecent(dernierBatch?.at ?? null, dernierCoche?.at ?? null),
    semaine,
    llmCostUsd,
  });
}

/** Le plus récent de deux instants, en ISO. `null` si aucun des deux n'est utilisable. */
export function plusRecent(a: Date | string | null, b: Date | string | null): string | null {
  const ms = [a, b]
    .map((x) => (x === null ? NaN : new Date(x).getTime()))
    .filter((n) => Number.isFinite(n));
  return ms.length === 0 ? null : new Date(Math.max(...ms)).toISOString();
}
