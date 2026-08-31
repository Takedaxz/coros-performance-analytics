"""Persist FIT timer pause intervals."""

import sqlalchemy as sa
from alembic import op

revision = "20260831_add_activity_pauses"
down_revision = "20260827_add_documents"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table("activity_pauses"):
        op.create_table(
            "activity_pauses",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("activity_id", sa.UUID(as_uuid=False), nullable=False),
            sa.Column("start_time", sa.DateTime(), nullable=False),
            sa.Column("end_time", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["activity_id"], ["activities.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_activity_pause_start", "activity_pauses", ["activity_id", "start_time"])


def downgrade() -> None:
    op.drop_index("ix_activity_pause_start", table_name="activity_pauses")
    op.drop_table("activity_pauses")
