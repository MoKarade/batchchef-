"""ingredient parent/child hierarchy

Adds:
- ingredient_master.parent_id (self-referential FK, nullable = top-level)
- ingredient_master.specific_unit / specific_price_per_unit (for variants whose
  pricing granularity is "per unit" rather than "per kg", e.g. 1 bacon strip)
- ingredient_master.calories_per_100 / proteins_per_100 / carbs_per_100 / lipids_per_100
  for per-variant nutrition
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a3c7d1e2f4b5"
down_revision: Union[str, Sequence[str], None] = "f1a2b3c4d5e6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("ingredient_master", schema=None) as batch_op:
        batch_op.add_column(sa.Column("parent_id", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("specific_unit", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("specific_price_per_unit", sa.Float(), nullable=True))
        batch_op.add_column(sa.Column("calories_per_100", sa.Float(), nullable=True))
        batch_op.add_column(sa.Column("proteins_per_100", sa.Float(), nullable=True))
        batch_op.add_column(sa.Column("carbs_per_100", sa.Float(), nullable=True))
        batch_op.add_column(sa.Column("lipids_per_100", sa.Float(), nullable=True))
        batch_op.create_foreign_key(
            "fk_ingredient_parent",
            "ingredient_master",
            ["parent_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch_op.create_index("ix_ingredient_parent", ["parent_id"])


def downgrade() -> None:
    with op.batch_alter_table("ingredient_master", schema=None) as batch_op:
        batch_op.drop_index("ix_ingredient_parent")
        batch_op.drop_constraint("fk_ingredient_parent", type_="foreignkey")
        batch_op.drop_column("lipids_per_100")
        batch_op.drop_column("carbs_per_100")
        batch_op.drop_column("proteins_per_100")
        batch_op.drop_column("calories_per_100")
        batch_op.drop_column("specific_price_per_unit")
        batch_op.drop_column("specific_unit")
        batch_op.drop_column("parent_id")
