"""Add training goal fields to users table.

Revision ID: 001
Revises:
Create Date: 2026-05-27
"""

from alembic import op
import sqlalchemy as sa

revision = "001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("goal_description", sa.Text(), nullable=True))
    op.add_column("users", sa.Column("goal_race_name", sa.String(255), nullable=True))
    op.add_column("users", sa.Column("goal_race_date", sa.Date(), nullable=True))
    op.add_column("users", sa.Column("goal_target_time", sa.String(20), nullable=True))
    op.add_column("users", sa.Column("weekly_training_hours", sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "weekly_training_hours")
    op.drop_column("users", "goal_target_time")
    op.drop_column("users", "goal_race_date")
    op.drop_column("users", "goal_race_name")
    op.drop_column("users", "goal_description")
