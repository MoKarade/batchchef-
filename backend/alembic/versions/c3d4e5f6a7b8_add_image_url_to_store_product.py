"""add image_url to store_product

Adds:
- store_product.image_url (str, nullable) — product thumbnail URL from Maxi/Costco.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c3d4e5f6a7b8"
down_revision: Union[str, Sequence[str], None] = "b7c8d9e0f1a2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("store_product", schema=None) as batch_op:
        batch_op.add_column(sa.Column("image_url", sa.String(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("store_product", schema=None) as batch_op:
        batch_op.drop_column("image_url")
