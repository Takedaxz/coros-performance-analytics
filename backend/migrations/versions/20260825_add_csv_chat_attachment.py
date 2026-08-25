"""Persist CSV attachments on chat messages."""

import sqlalchemy as sa
from alembic import op

revision = "20260825_add_csv_chat_attachment"
down_revision = "20260824_goal_race_tier"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("chat_messages", sa.Column("csv_filename", sa.String(length=255), nullable=True))
    op.add_column("chat_messages", sa.Column("csv_content", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("chat_messages", "csv_content")
    op.drop_column("chat_messages", "csv_filename")
