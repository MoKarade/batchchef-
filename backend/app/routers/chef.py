"""Chef AI — conversational assistant for BatchChef.

The Chef has read-only knowledge of the user's current state (inventory,
recent batches, available recipes) plus domain knowledge (what a real
Quebec chef would know about grocery substitutes, dietary adaptation,
cooking techniques).

It does NOT execute actions on the user's behalf in this MVP — it gives
advice + short lists. Later we may add structured 'actions' (add recipe
to cart, generate batch) via function-calling.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.client import call_claude
from app.database import get_db
from app.models.ingredient import IngredientMaster
from app.models.inventory import InventoryItem
from app.models.recipe import Recipe

router = APIRouter(prefix="/api/chef", tags=["chef"])


class ChatMessage(BaseModel):
    role: str  # 'user' | 'assistant'
    content: str


class ChefChatRequest(BaseModel):
    messages: list[ChatMessage]
    # Optional snapshot of the frontend-side cart so Chef knows what the
    # user has already staged. Kept as a list of {title, portions} to keep
    # the system prompt small.
    cart_recipes: list[str] | None = None


class ChefChatResponse(BaseModel):
    reply: str


SYSTEM_PROMPT = """Tu es Chef, l'assistant IA de l'app BatchChef, un planificateur de
batch cooking québécois. Tu parles français (québécois naturel, pas de tournures
françaises de France).

Ton rôle :
- Aider l'utilisateur à planifier son batch de la semaine
- Répondre aux questions de cuisine (techniques, substitutions, conservation)
- Suggérer des recettes à partir de ses ingrédients ou contraintes
- Expliquer des ingrédients, estimer des temps de prep, équivalences

Ton style :
- Réponses courtes et directes, format listes/bullets quand pertinent
- Tutoiement amical
- Pas de bullshit, pas d'emoji sauf pour structurer une liste
- Si tu ne sais pas, dis-le franchement

Ce que tu NE peux PAS faire pour l'instant (mentionne-le si on te le demande) :
- Ajouter des recettes au panier toi-même (l'utilisateur doit cliquer les boutons +)
- Générer un batch complet (le bouton "Générer pour moi" sur /batch Auto fait ça)
- Modifier l'inventaire ou les prix

Contexte utilisateur (réel, à jour) :"""


def _render_context(
    inventory: list[InventoryItem],
    top_ingredients: list[IngredientMaster],
    stats: dict,
    cart_recipes: list[str] | None,
) -> str:
    parts: list[str] = []

    parts.append(f"- {stats['recipes_total']} recettes dans la bibliothèque, "
                 f"{stats['recipes_complete']} avec tous les prix dispo.")
    parts.append(f"- {stats['parents_mapped']} ingrédients ont un prix Maxi chargé.")

    if inventory:
        inv_str = ", ".join(
            f"{i.quantity or 0:g} {i.unit or 'unité'} de "
            f"{(i.ingredient.display_name_fr if i.ingredient else '?')}"
            for i in inventory[:15]
        )
        parts.append(f"- Frigo actuel : {inv_str}"
                     + (" (et plus…)" if len(inventory) > 15 else "."))
    else:
        parts.append("- Frigo vide.")

    if cart_recipes:
        parts.append(
            f"- Panier en cours ({len(cart_recipes)} recettes) : "
            + ", ".join(cart_recipes[:8])
            + ("…" if len(cart_recipes) > 8 else "")
        )
    else:
        parts.append("- Panier vide.")

    if top_ingredients:
        names = ", ".join(i.display_name_fr or i.canonical_name for i in top_ingredients[:10])
        parts.append(f"- Ingrédients les plus utilisés dans l'app : {names}.")

    return "\n".join(parts)


@router.post("/chat", response_model=ChefChatResponse)
async def chef_chat(body: ChefChatRequest, db: AsyncSession = Depends(get_db)):
    if not body.messages:
        raise HTTPException(status_code=400, detail="No messages")
    if body.messages[-1].role != "user":
        raise HTTPException(status_code=400, detail="Last message must be from user")

    # Build context
    from sqlalchemy.orm import selectinload

    inv = list(
        (
            await db.execute(
                select(InventoryItem)
                .options(selectinload(InventoryItem.ingredient))
                .where(InventoryItem.quantity > 0)
                .order_by(InventoryItem.quantity.desc())
                .limit(20)
            )
        )
        .scalars()
    )

    top_ings = list(
        (
            await db.execute(
                select(IngredientMaster)
                .where(IngredientMaster.parent_id.is_(None))
                .where(IngredientMaster.price_mapping_status == "mapped")
                .limit(12)
            )
        )
        .scalars()
    )

    # Cheap counts
    recipes_total = (await db.execute(select(func.count(Recipe.id)))).scalar() or 0
    recipes_complete = (
        await db.execute(
            select(func.count(Recipe.id)).where(Recipe.pricing_status == "complete")
        )
    ).scalar() or 0
    parents_mapped = (
        await db.execute(
            select(func.count(IngredientMaster.id))
            .where(IngredientMaster.parent_id.is_(None))
            .where(IngredientMaster.price_mapping_status == "mapped")
        )
    ).scalar() or 0

    stats = {
        "recipes_total": recipes_total,
        "recipes_complete": recipes_complete,
        "parents_mapped": parents_mapped,
    }

    context = _render_context(inv, top_ings, stats, body.cart_recipes)
    system = SYSTEM_PROMPT + "\n" + context

    # Render the conversation as a simple user-prompt block. Claude handles
    # turn-taking via 'messages' natively but our call_claude helper only
    # takes a single system + user pair, so we collapse turns into a
    # transcript. Works fine for short conversations (<20 turns).
    transcript_lines: list[str] = []
    for m in body.messages[:-1]:
        role = "Utilisateur" if m.role == "user" else "Chef"
        transcript_lines.append(f"{role}: {m.content}")
    last_user = body.messages[-1].content
    if transcript_lines:
        user_prompt = "\n".join(transcript_lines) + f"\n\nUtilisateur: {last_user}\n\nChef:"
    else:
        user_prompt = last_user

    try:
        reply = await call_claude(
            system=system,
            user=user_prompt,
            max_tokens=800,
            temperature=0.7,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Chef AI unavailable: {e}")

    return ChefChatResponse(reply=reply.strip())


# ── Item #23 — proactive suggestions from fridge ───────────────────────────
class FridgeSuggestion(BaseModel):
    recipe_id: int
    title: str
    image_url: str | None = None
    health_score: float | None = None
    match_pct: float  # 0..100 — fraction of ingredients already in the frigo
    missing: list[str]  # human-readable ingredient names still needed


class FridgeSuggestResponse(BaseModel):
    fridge_items: list[str]
    suggestions: list[FridgeSuggestion]


@router.get("/suggest-from-fridge", response_model=FridgeSuggestResponse)
async def suggest_from_fridge(
    limit: int = 8,
    min_match_pct: float = 0.5,
    db: AsyncSession = Depends(get_db),
):
    """Suggest recipes the user can (almost) cook tonight from what's in the
    frigo. No LLM call — pure set intersection on ingredient IDs. Fast and
    deterministic.

    Algorithm:
      1. Collect ingredient_master_ids from InventoryItem (with quantity > 0).
      2. Resolve to the full set {self + parent + all variants}.
      3. For every recipe, score = len(fridge ∩ recipe_ings) / len(recipe_ings)
      4. Keep recipes with score >= min_match_pct, sorted by score.
    """
    from sqlalchemy.orm import selectinload
    from app.models.recipe import RecipeIngredient

    # 1. Fridge ingredient ids
    q = select(InventoryItem).options(selectinload(InventoryItem.ingredient)).where(
        InventoryItem.quantity > 0,
        InventoryItem.ingredient_master_id.is_not(None),
    )
    inv = list((await db.execute(q)).scalars().all())
    fridge_ids: set[int] = set()
    fridge_names: list[str] = []
    for it in inv:
        if it.ingredient_master_id:
            fridge_ids.add(it.ingredient_master_id)
            if it.ingredient:
                fridge_names.append(it.ingredient.display_name_fr or it.ingredient.canonical_name)

    if not fridge_ids:
        return FridgeSuggestResponse(fridge_items=[], suggestions=[])

    # 2. Expand via parent/child relationships — "beurre_demi_sel" in fridge
    #    should match recipes needing "beurre" (the parent), and vice versa.
    id_parent_q = select(IngredientMaster.id, IngredientMaster.parent_id)
    id_parent = dict((await db.execute(id_parent_q)).all())
    parent_children: dict[int, list[int]] = {}
    for child_id, parent_id in id_parent.items():
        if parent_id:
            parent_children.setdefault(parent_id, []).append(child_id)

    expanded: set[int] = set(fridge_ids)
    for fid in fridge_ids:
        # include parent
        parent = id_parent.get(fid)
        if parent:
            expanded.add(parent)
        # include siblings (variants of same parent) — optional; keeps the
        # search loose. "j'ai du beurre demi-sel" → recipes using beurre salé
        # are still plausible candidates.
        if parent and parent in parent_children:
            expanded.update(parent_children[parent])
        # include own variants
        if fid in parent_children:
            expanded.update(parent_children[fid])

    # 3. Score every AI-done recipe. We limit SQL to recipes that have at
    #    least one ingredient present in the fridge to keep it fast.
    ri_q = (
        select(RecipeIngredient.recipe_id, RecipeIngredient.ingredient_master_id)
        .where(RecipeIngredient.ingredient_master_id.is_not(None))
    )
    rows = list((await db.execute(ri_q)).all())

    by_recipe: dict[int, set[int]] = {}
    for rid, ing_id in rows:
        by_recipe.setdefault(rid, set()).add(ing_id)

    scored: list[tuple[int, float, set[int]]] = []
    for rid, ings in by_recipe.items():
        if not ings:
            continue
        hits = ings & expanded
        if not hits:
            continue
        score = len(hits) / len(ings)
        if score >= min_match_pct:
            missing = ings - expanded
            scored.append((rid, score, missing))

    scored.sort(key=lambda t: -t[1])
    top_ids = [rid for rid, _, _ in scored[: limit * 2]]  # over-fetch, we filter by AI status next

    if not top_ids:
        return FridgeSuggestResponse(fridge_items=fridge_names, suggestions=[])

    # 4. Enrich with recipe metadata — drop non-ai_done
    r_q = (
        select(Recipe)
        .where(Recipe.id.in_(top_ids), Recipe.status == "ai_done")
    )
    recipes_by_id = {r.id: r for r in (await db.execute(r_q)).scalars().all()}

    # Look up missing ingredient names in one query
    missing_ids = {mid for _, _, miss in scored for mid in miss}
    name_q = select(IngredientMaster.id, IngredientMaster.display_name_fr, IngredientMaster.canonical_name).where(
        IngredientMaster.id.in_(missing_ids)
    )
    names_by_id = {
        row.id: (row.display_name_fr or row.canonical_name)
        for row in (await db.execute(name_q)).all()
    }

    suggestions: list[FridgeSuggestion] = []
    for rid, score, missing in scored:
        r = recipes_by_id.get(rid)
        if not r:
            continue
        suggestions.append(
            FridgeSuggestion(
                recipe_id=r.id,
                title=r.title,
                image_url=r.image_url,
                health_score=r.health_score,
                match_pct=round(score * 100, 1),
                missing=[names_by_id.get(m, f"#{m}") for m in list(missing)[:6]],
            )
        )
        if len(suggestions) >= limit:
            break

    return FridgeSuggestResponse(
        fridge_items=fridge_names[:20],
        suggestions=suggestions,
    )
