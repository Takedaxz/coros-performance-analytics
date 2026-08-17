"""Add a private note for each activity."""

import sqlalchemy as sa
from alembic import op

revision = "20260817_activity_note"
down_revision = "20260809_tool_calls"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("activities", sa.Column("activity_note", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("activities", "activity_note")
