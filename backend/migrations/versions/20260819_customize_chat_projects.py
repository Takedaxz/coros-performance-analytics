"""Add customizable icons and highlight colors to chat projects."""

import sqlalchemy as sa
from alembic import op

revision = "20260819_customize_chat_projects"
down_revision = "20260818_repair_chat_timestamps"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("chat_projects", sa.Column("icon", sa.String(length=32), nullable=True))
    op.add_column(
        "chat_projects", sa.Column("highlight_color", sa.String(length=16), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("chat_projects", "highlight_color")
    op.drop_column("chat_projects", "icon")
