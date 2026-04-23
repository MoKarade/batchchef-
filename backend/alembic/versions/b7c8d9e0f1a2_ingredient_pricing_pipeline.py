"""ingredient pricing pipeline: search_aliases, price_map_attempts, recipe pricing_status

Adds:
- ingredient_master.search_aliases (JSON list of alternative search queries)
- ingredient_master.price_map_attempts (counter for retry logic)
- recipe.pricing_status (pending|complete|incomplete)
- recipe.missing_price_ingredients (JSON list of canonical names without price)
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b7c8d9e0f1a2"
down_revision: Union[str, Sequence[str], None] = "e533acb00b56"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("ingredient_master", schema=None) as batch_op:
        batch_op.add_column(sa.Column("search_aliases", sa.JSON(), nullable=True))
        batch_op.add_column(
            sa.Column("price_map_attempts", sa.Integer(), nullable=False, server_default="0")
        )

    with op.batch_alter_table("recipe", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("pricing_status", sa.String(), nullable=False, server_default="pending")
        )
        batch_op.add_column(sa.Column("missing_price_ingredients", sa.JSON(), nullable=True))

    with op.batch_alter_table("shopping_list_item", schema=None) as batch_op:
        batch_op.add_column(sa.Column("product_url", sa.String(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("recipe", schema=None) as batch_op:
        batch_op.drop_column("missing_price_ingredients")
        batch_op.drop_column("pricing_status")

    with op.batch_alter_table("ingredient_master", schema=None) as batch_op:
        batch_op.drop_column("price_map_attempts")
        batch_op.drop_column("search_aliases")
