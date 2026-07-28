"""Add cached activity postmortem."""

import sqlalchemy as sa
from alembic import op

revision = "20260726_activity_postmortem"
down_revision = "20260722_strength_detail"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("activities", sa.Column("postmortem", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("activities", "postmortem")
