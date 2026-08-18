"""Add chat projects and link chat sessions to them."""

import sqlalchemy as sa
from alembic import op

revision = "20260817_chat_projects"
down_revision = "20260817_chat_message_images"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "chat_projects",
        sa.Column("id", sa.UUID(as_uuid=False), primary_key=True),
        sa.Column("user_id", sa.UUID(as_uuid=False), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("user_id", "name", name="uq_chat_projects_user_name"),
    )
    op.add_column("chat_sessions", sa.Column("project_id", sa.UUID(as_uuid=False), nullable=True))
    op.create_foreign_key(
        "fk_chat_sessions_project_id",
        "chat_sessions",
        "chat_projects",
        ["project_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_chat_sessions_project_id", "chat_sessions", type_="foreignkey")
    op.drop_column("chat_sessions", "project_id")
    op.drop_table("chat_projects")
