"""Add A-E race priority tier to goals."""

import sqlalchemy as sa
from alembic import op

revision = "20260824_goal_race_tier"
down_revision = "20260819_customize_chat_projects"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("goals", sa.Column("goal_race_tier", sa.String(length=1), nullable=True))


def downgrade() -> None:
    op.drop_column("goals", "goal_race_tier")
