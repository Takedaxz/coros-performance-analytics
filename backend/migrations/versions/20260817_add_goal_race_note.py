"""Add optional post-race notes to goals."""

import sqlalchemy as sa
from alembic import op

revision = "20260817_goal_race_note"
down_revision = "20260817_goal_result_time"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("goals", sa.Column("goal_race_note", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("goals", "goal_race_note")
