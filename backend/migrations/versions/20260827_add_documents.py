"""Add local race document metadata."""

import sqlalchemy as sa
from alembic import op

revision = "20260827_add_documents"
down_revision = "20260826_add_daily_feelings"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "documents",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("goal_id", sa.UUID(), nullable=True),
        sa.Column("original_filename", sa.String(length=255), nullable=False),
        sa.Column("storage_filename", sa.String(length=255), nullable=False),
        sa.Column("content_type", sa.String(length=100), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["goal_id"], ["goals.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("storage_filename"),
    )


def downgrade() -> None:
    op.drop_table("documents")
