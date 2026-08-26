"""Add athlete-reported daily feelings."""

import sqlalchemy as sa
from alembic import op

revision = "20260826_add_daily_feelings"
down_revision = "20260825_add_csv_chat_attachment"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "daily_feelings",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("feeling", sa.String(length=20), nullable=False),
        sa.Column("note", sa.String(length=280), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "date", name="uq_daily_feeling_user_date"),
    )


def downgrade() -> None:
    op.drop_table("daily_feelings")
