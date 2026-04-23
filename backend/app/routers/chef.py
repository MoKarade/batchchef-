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
