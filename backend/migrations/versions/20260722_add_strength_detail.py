"""Add cached official COROS strength detail."""

from alembic import op
import sqlalchemy as sa

revision = "20260722_strength_detail"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("activities", sa.Column("strength_detail", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("activities", "strength_detail")
