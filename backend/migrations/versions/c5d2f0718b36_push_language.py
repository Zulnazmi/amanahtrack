"""language of each phone's notifications

Revision ID: c5d2f0718b36
Revises: a41d90c3e7b2
"""

import sqlalchemy as sa
from alembic import op

revision = "c5d2f0718b36"
down_revision = "a41d90c3e7b2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "push_tokens", sa.Column("lang", sa.String(2), nullable=False, server_default="ms")
    )


def downgrade() -> None:
    raise NotImplementedError("Going back would delete records. Restore a backup.")
