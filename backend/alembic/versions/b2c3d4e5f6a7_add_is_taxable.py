"""add is_taxable to ingredient_master

Adds:
- ingredient_master.is_taxable (bool, default False)
  Used for Quebec TPS/TVQ tax computation in batch preview.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b2c3d4e5f6a7"
down_revision: Union[str, Sequence[str], None] = "e533acb00b56"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("ingredient_master", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "is_taxable",
                sa.Boolean(),
                nullable=False,
                server_default="0",
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("ingredient_master", schema=None) as batch_op:
        batch_op.drop_column("is_taxable")
