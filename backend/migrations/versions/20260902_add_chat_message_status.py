"""Persist chat message generation status."""

import sqlalchemy as sa
from alembic import op

revision = "20260902_chat_message_status"
down_revision = "20260831_add_activity_pauses"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {column["name"] for column in inspector.get_columns("chat_messages")}
    if "status" not in columns:
        op.add_column(
            "chat_messages",
            sa.Column(
                "status",
                sa.String(length=20),
                nullable=False,
                server_default="completed",
            ),
        )


def downgrade() -> None:
    op.drop_column("chat_messages", "status")
