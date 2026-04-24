"""Maxi auto-cart filler — reads a BatchChef shopping list and populates
the user's Maxi.ca cart.

Flow (option A from user discussion):
  1. Decrypt stored Maxi creds for the current user.
  2. Launch Chromium headful so the user can watch and intervene on 2FA /
     captcha. First run is always visual — we don't want a headless bot
     silently failing auth.
  3. Log in to maxi.ca with email+password.
  4. For every ShoppingListItem:
       - if product_url: open it, click add-to-cart, set quantity = packages_to_buy.
       - else: run a Maxi search with the ingredient display name. Try to
         auto-pick the first result IFF the product title fuzzy-matches
         the ingredient name (Levenshtein ratio >= 0.6); otherwise leave
         it for manual selection.
  5. At the end, navigate to /cart and open a tab of the Maxi search for
     each item that needed manual confirmation.
  6. Return a summary structure with counts and per-item outcomes.

The job is tracked via the standard ImportJob table so the UI can show a
live progress bar via the existing WebSocket + polling fallback.
"""
from __future__ import annotations
import asyncio
import json
import logging
import re
from dataclasses import dataclass, field
from datetime import datetime
from difflib import SequenceMatcher

from app.workers.celery_app import celery_app
from app.utils.time import utcnow

logger = logging.getLogger(__name__)


# Maxi tries hard to detect bots. We keep it simple and honest — real Chrome
# channel (not bundled Chromium), a realistic user agent, and human-ish
# delays between clicks.
DEFAULT_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)

# Minimum similarity between search query and first-result title to accept
# automatic selection. Anything below is kicked to the "manual" bucket.
AUTO_PICK_THRESHOLD = 0.60


@dataclass
class ItemOutcome:
    ingredient_name: str
    status: str       # "added" | "auto-picked" | "manual" | "failed"
    message: str = ""
    product_url: str | None = None
    packages_added: int = 0


@dataclass
class CartSummary:
    added: int = 0
    auto_picked: int = 0
    manual: list[str] = field(default_factory=list)
    failed: list[str] = field(default_factory=list)
    items: list[ItemOutcome] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "added": self.added,
            "auto_picked": self.auto_picked,
            "manual": self.manual,
            "failed": self.failed,
            "items": [i.__dict__ for i in self.items],
        }


def _similarity(a: str, b: str) -> float:
    """Normalized Levenshtein ratio on lowercased, stripped strings."""
    return SequenceMatcher(None, a.lower().strip(), b.lower().strip()).ratio()


def _search_url(ingredient_name: str) -> str:
    from urllib.parse import quote
    return f"https://www.maxi.ca/fr/recherche?search-bar={quote(ingredient_name)}"


@celery_app.task(name="maxi_cart.fill", bind=True)
def fill_maxi_cart(self, job_id: int, batch_id: int, user_id: int):
    """Celery entry point — async work is wrapped in asyncio.run."""
    return asyncio.run(_run(job_id=job_id, batch_id=batch_id, user_id=user_id))


async def _run(job_id: int, batch_id: int, user_id: int) -> dict:
    from patchright.async_api import async_playwright
    from sqlalchemy import select
    from sqlalchemy.orm import selectinload
    from app.database import AsyncSessionLocal, init_db
    from app.models.batch import Batch, ShoppingListItem
    from app.models.ingredient import IngredientMaster
    from app.models.job import ImportJob
    from app.models.user import User
    from app.utils.crypto import decrypt

    await init_db()

    summary = CartSummary()

    # ── 1. Resolve user, batch, items ────────────────────────────────────
    async with AsyncSessionLocal() as db:
        job = await db.get(ImportJob, job_id)
        if not job:
            logger.error("fill_maxi_cart: job #%d not found", job_id)
            return {"error": "job_not_found"}

        user = await db.get(User, user_id)
        if not user:
            job.status = "failed"
            job.error_log = json.dumps(["Utilisateur introuvable"])
            job.finished_at = utcnow()
            await db.commit()
            return {"error": "user_not_found"}
        if not user.maxi_email or not user.maxi_password_encrypted:
            job.status = "failed"
            job.error_log = json.dumps(
                ["Aucune credential Maxi enregistrée — va dans /settings d'abord"]
            )
            job.finished_at = utcnow()
            await db.commit()
            return {"error": "no_creds"}

        try:
            maxi_pwd = decrypt(user.maxi_password_encrypted)
        except Exception as e:
            job.status = "failed"
            job.error_log = json.dumps([f"Déchiffrement impossible ({e.__class__.__name__}) — "
                                        "re-saisis tes creds dans /settings"])
            job.finished_at = utcnow()
            await db.commit()
            return {"error": "decrypt_failed"}
        maxi_email = user.maxi_email

        batch_q = (
            select(Batch)
            .where(Batch.id == batch_id)
            .options(
                selectinload(Batch.shopping_items)
                .selectinload(ShoppingListItem.ingredient)
            )
        )
        batch = (await db.execute(batch_q)).scalar_one_or_none()
        if not batch:
            job.status = "failed"
            job.error_log = json.dumps([f"Batch #{batch_id} introuvable"])
            job.finished_at = utcnow()
            await db.commit()
            return {"error": "batch_not_found"}

        # Only items the user hasn't purchased manually yet
        items = [it for it in batch.shopping_items if not it.is_purchased]
        if not items:
            job.status = "completed"
            job.progress_total = 0
            job.progress_current = 0
            job.finished_at = utcnow()
            await db.commit()
            return {"status": "nothing_to_buy"}

        job.status = "running"
        job.progress_total = len(items)
        job.progress_current = 0
        job.started_at = utcnow()
        await db.commit()

    # ── 2. Playwright — always headful for cart filling ──────────────────
    manual_search_tabs: list[str] = []

    async with async_playwright() as pw:
        # channel="chrome" uses the real Chrome install (more human, less
        # likely to trip anti-bot). User said option 3 = headful first run.
        browser = await pw.chromium.launch(
            channel="chrome",
            headless=False,
            args=["--disable-blink-features=AutomationControlled"],
        )
        context = await browser.new_context(
            user_agent=DEFAULT_UA,
            viewport={"width": 1400, "height": 900},
            locale="fr-CA",
        )
        page = await context.new_page()

        # ── 2a. Login ────────────────────────────────────────────────────
        await _login(page, maxi_email, maxi_pwd)

        # ── 2b. Walk items ───────────────────────────────────────────────
        for idx, it in enumerate(items, 1):
            name = (
                it.ingredient.display_name_fr
                if it.ingredient
                else f"Ingrédient #{it.ingredient_master_id}"
            )
            packages = max(1, it.packages_to_buy or 1)

            try:
                if it.product_url:
                    outcome = await _add_direct(page, it.product_url, packages, name)
                else:
                    outcome = await _add_via_search(page, name, packages)
            except Exception as e:
                logger.exception("cart item failed: %s", name)
                outcome = ItemOutcome(
                    ingredient_name=name, status="failed", message=str(e)[:120]
                )

            summary.items.append(outcome)
            if outcome.status == "added":
                summary.added += 1
            elif outcome.status == "auto-picked":
                summary.auto_picked += 1
            elif outcome.status == "manual":
                summary.manual.append(name)
                manual_search_tabs.append(_search_url(name))
            else:
                summary.failed.append(f"{name}: {outcome.message}")

            # Live progress
            async with AsyncSessionLocal() as db:
                job = await db.get(ImportJob, job_id)
                job.progress_current = idx
                job.current_item = name[:120]
                await db.commit()

            # Be human: small random-ish pause between actions
            await asyncio.sleep(1.5)

        # ── 2c. Open the cart + search tabs for items that need a human ──
        try:
            cart_page = await context.new_page()
            await cart_page.goto("https://www.maxi.ca/panier", wait_until="domcontentloaded")
        except Exception as e:
            logger.warning("cart page open failed: %s", e)

        for url in manual_search_tabs[:10]:  # cap at 10 extra tabs
            try:
                t = await context.new_page()
                await t.goto(url, wait_until="domcontentloaded")
            except Exception:
                pass

        # Leave the browser open — user picks from here. Don't close().
        # A separate "je suis fini" UI button could close it later.

    # ── 3. Finalize job ──────────────────────────────────────────────────
    async with AsyncSessionLocal() as db:
        job = await db.get(ImportJob, job_id)
        job.status = "completed"
        job.finished_at = utcnow()
        job.metadata_json = json.dumps(summary.as_dict())
        await db.commit()

    logger.info(
        "Maxi cart done: added=%d auto=%d manual=%d failed=%d",
        summary.added, summary.auto_picked, len(summary.manual), len(summary.failed),
    )
    return summary.as_dict()


# ── Helpers ──────────────────────────────────────────────────────────────
async def _login(page, email: str, password: str) -> None:
    """Navigate to Maxi login and submit. Maxi uses a PC Optimum-branded
    login flow hosted at accounts.pcid.ca — the form fields are
    standard HTML inputs with name="email"/name="password".
    """
    await page.goto("https://www.maxi.ca/connexion", wait_until="domcontentloaded")
    # If the user already has a session cookie (unlikely on a fresh context
    # but possible via context reuse), the page redirects. Detect that.
    if "connexion" not in page.url and "login" not in page.url.lower():
        return  # already logged in

    # The actual login form lives in a subdomain iframe or redirect
    try:
        await page.wait_for_selector('input[type="email"], input[name="email"]', timeout=10_000)
        # Click cookie-accept if present
        try:
            await page.get_by_role("button", name=re.compile(r"accept|accepter", re.I)).click(timeout=2_000)
        except Exception:
            pass
        await page.fill('input[type="email"], input[name="email"]', email)
        await page.fill('input[type="password"], input[name="password"]', password)
        # Submit
        await page.get_by_role("button", name=re.compile(r"connexion|sign.?in|se connecter", re.I)).first.click()
        # Wait for redirect back to maxi.ca OR an error
        await page.wait_for_load_state("networkidle", timeout=20_000)
    except Exception as e:
        logger.warning("login flow encountered issue: %s", e)
        # Leave page as-is so user can intervene manually in the headful window


async def _add_direct(page, product_url: str, packages: int, name: str) -> ItemOutcome:
    """Open a known product URL and add ``packages`` units."""
    await page.goto(product_url, wait_until="domcontentloaded", timeout=20_000)
    # Try several patterns for the add-to-cart button (maxi changes class names)
    selectors = [
        '[data-testid="add-to-cart-button"]',
        'button:has-text("Ajouter au panier")',
        'button:has-text("Add to cart")',
    ]
    btn = None
    for sel in selectors:
        try:
            btn = await page.wait_for_selector(sel, timeout=4_000)
            if btn:
                break
        except Exception:
            continue
    if not btn:
        return ItemOutcome(ingredient_name=name, status="failed",
                           message="bouton Ajouter au panier introuvable",
                           product_url=product_url)
    # Click ``packages`` times OR use quantity stepper if the product page has one.
    # The stepper buttons on Maxi are labeled with + / -
    await btn.click()
    for _ in range(packages - 1):
        try:
            plus = await page.wait_for_selector('button[aria-label*="Augmenter"], button[aria-label*="Increase"]', timeout=2_000)
            if plus:
                await plus.click()
                await asyncio.sleep(0.2)
        except Exception:
            # fallback: click add-to-cart again
            await btn.click()
            await asyncio.sleep(0.2)
    return ItemOutcome(
        ingredient_name=name, status="added",
        message=f"{packages} × ajouté", product_url=product_url,
        packages_added=packages,
    )


async def _add_via_search(page, ingredient_name: str, packages: int) -> ItemOutcome:
    """Fallback when no product_url is mapped — search Maxi + auto-pick
    the first result if the title fuzzy-matches."""
    await page.goto(_search_url(ingredient_name), wait_until="domcontentloaded", timeout=20_000)
    try:
        first_card = await page.wait_for_selector(
            '[data-testid="product-tile"], article[data-testid*="product"]',
            timeout=8_000,
        )
    except Exception:
        return ItemOutcome(
            ingredient_name=ingredient_name, status="manual",
            message="aucun résultat de recherche",
        )
    if not first_card:
        return ItemOutcome(ingredient_name=ingredient_name, status="manual",
                           message="aucun résultat")

    # Title check
    try:
        title_el = await first_card.query_selector('[data-testid="product-title"], h3')
        title = (await title_el.inner_text()).strip() if title_el else ""
    except Exception:
        title = ""
    sim = _similarity(ingredient_name, title)

    if sim < AUTO_PICK_THRESHOLD:
        return ItemOutcome(
            ingredient_name=ingredient_name, status="manual",
            message=f"similarité {sim:.0%} trop basse (« {title[:40]} »)",
        )

    # Click the card → product page → add to cart via _add_direct-like flow
    try:
        link = await first_card.query_selector("a")
        if not link:
            return ItemOutcome(ingredient_name=ingredient_name, status="manual",
                               message="pas de lien sur la carte produit")
        href = await link.get_attribute("href")
        product_url = href if href and href.startswith("http") else f"https://www.maxi.ca{href}"

        out = await _add_direct(page, product_url, packages, ingredient_name)
        if out.status == "added":
            out.status = "auto-picked"
            out.message = f"pris 1er résultat « {title[:40]} » (sim {sim:.0%})"
        return out
    except Exception as e:
        return ItemOutcome(ingredient_name=ingredient_name, status="manual", message=str(e)[:80])
