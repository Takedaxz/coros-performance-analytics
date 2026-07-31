"""Add sex for sex-specific fitness reference calculations."""

import sqlalchemy as sa
from alembic import op

revision = "20260727_user_sex"
down_revision = "20260726_activity_postmortem"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("sex", sa.String(length=10), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "sex")
