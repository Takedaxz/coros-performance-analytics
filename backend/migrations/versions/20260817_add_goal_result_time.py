"""Add optional actual finish time to race goals."""

import sqlalchemy as sa
from alembic import op

revision = "20260817_goal_result_time"
down_revision = "20260817_activity_note"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("goals", sa.Column("goal_result_time", sa.String(length=20), nullable=True))


def downgrade() -> None:
    op.drop_column("goals", "goal_result_time")
