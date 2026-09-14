"use client";

// L'écran de conversation. Volontairement simple : une liste de messages, un champ, un envoi.
//
// Deux choix qui comptent pour l'honnêteté de l'écran :
//  - la question de Marc s'affiche IMMÉDIATEMENT, mais la réponse n'apparaît que quand elle
//    existe vraiment — aucun texte n'est fabriqué en attendant ;
//  - un échec laisse la question EN PLACE dans le champ. Perdre ce que quelqu'un vient
//    d'écrire parce que le réseau a coupé est la faute la plus agaçante d'un chat.

import { useEffect, useRef, useState, useTransition } from "react";
import {
  apercuPlacementSemaine,
  demanderAAssistant,
  lireFicheRecette,
  placerRecetteSemaine,
  type FicheRecette,
} from "@/lib/actions";
// ⚠️ Le TYPE vient du module ordinaire, jamais du fichier "use server" : celui-ci ne peut
// exporter que des fonctions async, et y ajouter un type casse le build.
import type { ApercuPlacement } from "@/lib/semaineDb";
import { FicheRecetteModale } from "@/components/FicheRecetteModale";
import {
  MAX_CARACTERES_MESSAGE,
  decouperReponse,
  type Message,
} from "@/lib/assistant/protocole";

const EXEMPLES = [
  "Qu'est-ce que je peux faire avec du poulet, du riz et des brocolis ?",
  "Je n'ai pas de crème 35 %, je remplace par quoi ?",
  "Compose-moi une recette de batch pour 8 portions à partir de ce que tu trouves.",
];

export function Conversation({ configure }: { configure: boolean }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [saisie, setSaisie] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const champ = useRef<HTMLTextAreaElement>(null);

  // La fiche ouverte par-dessus le chat. `null` partout = rien d'ouvert.
  const [fiche, setFiche] = useState<FicheRecette | null>(null);
  const [ficheChargement, setFicheChargement] = useState(false);
  const [ficheErreur, setFicheErreur] = useState<string | null>(null);

  const ouvrirFiche = (source: "catalogue" | "mes-recettes", id: number) => {
    setFiche(null);
    setFicheErreur(null);
    setFicheChargement(true);
    void lireFicheRecette(id, source).then((res) => {
      setFicheChargement(false);
      if (!res.ok) {
        setFicheErreur(res.error);
        return;
      }
      setFiche(res.fiche ?? null);
    });
  };

  const fermerFiche = () => {
    setFiche(null);
    setFicheErreur(null);
    setFicheChargement(false);
  };

  /**
   * Rend une réponse en remplaçant « [catalogue #482] » par une pastille cliquable.
   *
   * Le texte AUTOUR est conservé mot pour mot : on ne réécrit pas ce que l'assistant a dit,
   * on rend seulement ses références actionnables.
   */
  const rendreReponse = (texte: string) =>
    decouperReponse(texte).map((seg, i) =>
      seg.type === "texte" ? (
        <span key={i}>{seg.valeur}</span>
      ) : seg.type === "proposition" ? (
        <CartePlacement key={i} place={seg.place} id={seg.id} />
      ) : (
        <button
          key={i}
          type="button"
          onClick={() => ouvrirFiche(seg.source, seg.id)}
          className="mx-0.5 inline-flex items-center gap-1 rounded-lg border border-[var(--bordure)] px-2 py-0.5 align-baseline text-xs font-medium"
          style={{ backgroundColor: "var(--accent-doux)", color: "var(--accent-fonce)" }}
        >
          Voir la recette
        </button>
      ),
    );

  const envoyer = (texte: string) => {
    const question = texte.trim();
    if (!question || pending) return;
    setErreur(null);
    const suite: Message[] = [...messages, { role: "user", contenu: question }];
    setMessages(suite);
    setSaisie("");
    startTransition(async () => {
      const res = await demanderAAssistant(suite);
      if (!res.ok) {
        setErreur(res.error);
        // La question retourne dans le champ : elle n'est pas perdue.
        setMessages(messages);
        setSaisie(question);
        champ.current?.focus();
        return;
      }
      setMessages([...suite, { role: "assistant", contenu: res.texte ?? "" }]);
    });
  };

  if (!configure) {
    return (
      <p className="rounded-lg alerte p-3 text-sm">
        L’assistant n’est pas configuré : il manque <code>ANTHROPIC_API_KEY</code> côté serveur.
        Ce n’est pas une panne, l’intégration est simplement éteinte.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {messages.length === 0 && (
        <div className="space-y-2">
          <p className="text-sm doux">Par exemple :</p>
          <ul className="space-y-2">
            {EXEMPLES.map((ex) => (
              <li key={ex}>
                <button
                  type="button"
                  onClick={() => envoyer(ex)}
                  disabled={pending}
                  className="w-full rounded-xl border border-[var(--bordure)] px-4 py-3 text-left text-sm disabled:opacity-60"
                >
                  {ex}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ul className="space-y-3">
        {messages.map((m, i) => (
          <li
            key={i}
            className={m.role === "user" ? "flex justify-end" : "flex justify-start"}
          >
            <div
              className={
                m.role === "user"
                  ? "max-w-[85%] rounded-2xl px-4 py-3 text-sm sur-accent"
                  : "max-w-[85%] whitespace-pre-line carte px-4 py-3 text-sm leading-relaxed"
              }
              style={m.role === "user" ? { backgroundColor: "var(--accent)" } : undefined}
            >
              {m.role === "assistant" ? rendreReponse(m.contenu) : m.contenu}
            </div>
          </li>
        ))}
        {pending && (
          <li className="flex justify-start">
            <p className="carte px-4 py-3 text-sm doux">Je cherche dans ta base…</p>
          </li>
        )}
      </ul>

      {erreur && <p className="rounded-lg erreur p-3 text-sm">{erreur}</p>}

      <FicheRecetteModale
        fiche={fiche}
        chargement={ficheChargement}
        erreur={ficheErreur}
        onFermer={fermerFiche}
      />

      <div className="sticky bottom-20 space-y-2 sm:bottom-4">
        <textarea
          ref={champ}
          value={saisie}
          onChange={(e) => setSaisie(e.target.value)}
          maxLength={MAX_CARACTERES_MESSAGE}
          rows={3}
          placeholder="Ce que tu as sous la main, ou ce que tu cherches…"
          disabled={pending}
          className="champ text-sm"
        />
        <button
          type="button"
          onClick={() => envoyer(saisie)}
          disabled={pending || saisie.trim().length === 0}
          className="bouton bouton-principal w-full"
        >
          {pending ? "Recherche en cours…" : "Demander"}
        </button>
      </div>
    </div>
  );
}

/**
 * La carte d'une proposition de remplacement (SEM-03) : « mets celle-là à la place 3 ».
 *
 * ⚠️ Elle charge un APERÇU avant d'offrir le bouton. Deux raisons, et aucune n'est du
 * confort : Marc doit voir CE QU'IL REMPLACE (la place porte déjà une recette), et il doit
 * voir quand le remplacement CASSE la composition « 3 plats + 1 dessert ». Son clic vaut
 * demande explicite — il ne peut valoir demande explicite que s'il sait ce qu'il demande.
 *
 * ⚠️ Un aperçu en échec ne rend AUCUN bouton : la cause est affichée à la place. Un bouton
 * qui tenterait le placement « pour voir » serait une promesse creuse de plus.
 */
function CartePlacement({ place, id }: { place: number; id: number }) {
  const [apercu, setApercu] = useState<ApercuPlacement | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [pose, setPose] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const demande = useRef(false);

  useEffect(() => {
    // ⚠️ Une seule fois par carte : sans ce garde, un re-rendu relancerait la lecture à
    // chaque frappe dans le champ de saisie.
    if (demande.current) return;
    demande.current = true;
    void apercuPlacementSemaine(place, id).then((res) => {
      if (res.ok) setApercu(res.apercu);
      else setErreur(res.error);
    });
  }, [place, id]);

  const poser = () => {
    setEnCours(true);
    setErreur(null);
    void placerRecetteSemaine(place, id).then((res) => {
      setEnCours(false);
      if (res.ok) setPose(res.titre ?? apercu?.titre ?? "Recette");
      else setErreur(res.error);
    });
  };

  if (erreur) {
    return (
      <span className="mx-0.5 inline-block rounded-lg px-2 py-0.5 align-baseline text-xs erreur">
        {erreur}
      </span>
    );
  }
  if (pose) {
    // ⚠️ Le chat vit sur /assistant, la carte « Ta semaine » sur l'accueil : Marc ne verra
    // rien bouger. Le dire est la seule confirmation qu'il aura.
    return (
      <span className="mx-0.5 inline-block rounded-lg px-2 py-0.5 align-baseline text-xs succes">
        {pose} est posée à la place {place} de ta semaine.
      </span>
    );
  }
  if (!apercu) {
    return <span className="mx-0.5 align-baseline text-xs doux">…</span>;
  }

  return (
    <span className="my-1 block rounded-xl border border-[var(--bordure)] p-2 text-xs">
      <span className="block">
        Mettre <strong>{apercu.titre}</strong> à la place {place}, à la place de{" "}
        <strong>{apercu.titreActuel}</strong>.
      </span>
      {apercu.casseComposition && (
        <span className="mt-1 block rounded-lg px-2 py-1 alerte">
          Cette place attend {apercu.roleAttendu === "dessert" ? "un dessert" : "un plat, une soupe ou une salade"} :
          ta semaine ne sera plus « trois plats et un dessert ».
        </span>
      )}
      <button
        type="button"
        disabled={enCours}
        onClick={poser}
        className="bouton bouton-principal mt-2 w-full disabled:opacity-50"
      >
        {enCours ? "…" : `Mettre à la place ${place}`}
      </button>
    </span>
  );
}
