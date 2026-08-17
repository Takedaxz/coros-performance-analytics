"""Store read-only AI Coach tools used for each assistant message."""

import sqlalchemy as sa
from alembic import op

revision = "20260809_tool_calls"
down_revision = "20260804_backfill_sport_types"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("chat_messages", sa.Column("tool_calls", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("chat_messages", "tool_calls")
