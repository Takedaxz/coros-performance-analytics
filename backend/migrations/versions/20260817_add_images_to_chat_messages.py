"""Add images JSON column to chat_messages table for vision attachments."""

import sqlalchemy as sa
from alembic import op

revision = "20260817_chat_message_images"
down_revision = "20260817_goal_race_note"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("chat_messages", sa.Column("images", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("chat_messages", "images")
