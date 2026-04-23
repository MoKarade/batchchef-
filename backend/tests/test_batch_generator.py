"""Batch generator tests: filters, meal_type_sequence, num_recipes."""
import pytest
from sqlalchemy import select

from app.models.recipe import Recipe, RecipeIngredient
from app.models.ingredient import IngredientMaster
from app.models.batch import BatchRecipe
from app.services.batch_generator import generate_batch


async def _seed_recipes(db):
    ing = IngredientMaster(canonical_name="riz", display_name_fr="Riz", default_unit="g")
    db.add(ing)
    await db.flush()

    recipes = [
        Recipe(marmiton_url="https://m/1", title="Salade vegan", slug="salade-vegan",
               meal_type="plat", is_vegetarian=True, is_vegan=True,
               prep_time_min=10, estimated_cost_per_portion=2.0, health_score=8.5,
               status="ai_done", pricing_status="complete"),
        Recipe(marmiton_url="https://m/2", title="Curry legumes", slug="curry",
               meal_type="plat", is_vegetarian=True, is_vegan=False,
               prep_time_min=25, estimated_cost_per_portion=3.5, health_score=7.0,
               status="ai_done", pricing_status="complete"),
        Recipe(marmiton_url="https://m/3", title="Steak frites", slug="steak",
               meal_type="plat", is_vegetarian=False, is_vegan=False,
               prep_time_min=30, estimated_cost_per_portion=6.0, health_score=5.0,
               status="ai_done", pricing_status="complete"),
        Recipe(marmiton_url="https://m/4", title="Tarte pommes", slug="tarte",
               meal_type="dessert", is_vegetarian=True, is_vegan=False,
               prep_time_min=45, estimated_cost_per_portion=2.5, health_score=4.0,
               status="ai_done", pricing_status="complete"),
        Recipe(marmiton_url="https://m/5", title="Soupe miso", slug="soupe",
               meal_type="entree", is_vegetarian=True, is_vegan=True,
               prep_time_min=15, estimated_cost_per_portion=1.8, health_score=9.0,
               status="ai_done", pricing_status="complete"),
        Recipe(marmiton_url="https://m/6", title="Poulet roti", slug="poulet",
               meal_type="plat", is_vegetarian=False, is_vegan=False,
               prep_time_min=60, estimated_cost_per_portion=5.0, health_score=6.0,
               status="ai_done", pricing_status="complete"),
    ]
    for r in recipes:
        db.add(r)
    await db.flush()

    for r in recipes:
        db.add(RecipeIngredient(
            recipe_id=r.id, ingredient_master_id=ing.id,
            raw_text="100 g riz", quantity_per_portion=100.0, unit="g",
        ))
    await db.commit()
    return recipes


async def _batch_recipes(db, batch_id: int) -> list[BatchRecipe]:
    q = select(BatchRecipe).where(BatchRecipe.batch_id == batch_id).order_by(BatchRecipe.id)
    return list((await db.execute(q)).scalars().all())


@pytest.mark.asyncio
async def test_vegetarian_only_filters_meat(db):
    await _seed_recipes(db)
    batch = await generate_batch(db, target_portions=12, num_recipes=3, vegetarian_only=True)

    brs = await _batch_recipes(db, batch.id)
    titles = [(await db.get(Recipe, br.recipe_id)).title for br in brs]
    assert "Steak frites" not in titles
    assert "Poulet roti" not in titles
    assert len(brs) == 3


@pytest.mark.asyncio
async def test_vegan_only_excludes_vegetarian_non_vegan(db):
    await _seed_recipes(db)
    batch = await generate_batch(db, target_portions=10, num_recipes=2, vegan_only=True)

    brs = await _batch_recipes(db, batch.id)
    titles = {(await db.get(Recipe, br.recipe_id)).title for br in brs}
    assert titles == {"Salade vegan", "Soupe miso"}


@pytest.mark.asyncio
async def test_meal_type_sequence_respected(db):
    await _seed_recipes(db)
    batch = await generate_batch(
        db, target_portions=15, num_recipes=3,
        meal_type_sequence=["entree", "plat", "dessert"],
    )
    brs = await _batch_recipes(db, batch.id)
    meal_types = [(await db.get(Recipe, br.recipe_id)).meal_type for br in brs]
    assert meal_types == ["entree", "plat", "dessert"]


@pytest.mark.asyncio
async def test_num_recipes_5_and_portion_split(db):
    await _seed_recipes(db)
    batch = await generate_batch(db, target_portions=20, num_recipes=5)

    brs = await _batch_recipes(db, batch.id)
    assert len(brs) == 5
    assert sum(br.portions for br in brs) == 20
    # 20 / 5 → all exactly 4
    assert all(br.portions == 4 for br in brs)


@pytest.mark.asyncio
async def test_max_cost_per_portion_filter(db):
    await _seed_recipes(db)
    batch = await generate_batch(db, target_portions=9, num_recipes=3, max_cost_per_portion=3.0)

    brs = await _batch_recipes(db, batch.id)
    for br in brs:
        r = await db.get(Recipe, br.recipe_id)
        assert r.estimated_cost_per_portion is None or r.estimated_cost_per_portion <= 3.0


@pytest.mark.asyncio
async def test_not_enough_recipes_raises(db):
    await _seed_recipes(db)
    # Force constraints too tight: vegan + very high health score → empty pool
    with pytest.raises(ValueError):
        await generate_batch(
            db, target_portions=10, num_recipes=3,
            vegan_only=True, health_score_min=9.5,
        )
