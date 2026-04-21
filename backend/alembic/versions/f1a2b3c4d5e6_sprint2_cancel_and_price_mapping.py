"""sprint2: cancel_requested + price mapping metadata

Adds:
- import_job.cancel_requested (cooperative cancellation flag)
- ingredient_master.price_mapping_status
- ingredient_master.last_price_mapping_at
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f1a2b3c4d5e6"
down_revision: Union[str, Sequence[str], None] = "61bc335b03d5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("import_job", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "cancel_requested",
                sa.Boolean(),
                nullable=False,
                server_default="0",
            )
        )

    with op.batch_alter_table("ingredient_master", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "price_mapping_status",
                sa.String(),
                nullable=False,
                server_default="pending",
            )
        )
        batch_op.add_column(
            sa.Column("last_price_mapping_at", sa.DateTime(), nullable=True)
        )


def downgrade() -> None:
    with op.batch_alter_table("ingredient_master", schema=None) as batch_op:
        batch_op.drop_column("last_price_mapping_at")
        batch_op.drop_column("price_mapping_status")

    with op.batch_alter_table("import_job", schema=None) as batch_op:
        batch_op.drop_column("cancel_requested")
