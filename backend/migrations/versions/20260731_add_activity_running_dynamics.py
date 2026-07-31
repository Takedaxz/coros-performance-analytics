"""Add activity label and running dynamics."""

import sqlalchemy as sa
from alembic import op

revision = "20260731_running_dynamics"
down_revision = "20260730_chat_session_model"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("activities", sa.Column("label_id", sa.String(length=64), nullable=True))
    op.add_column(
        "activity_records", sa.Column("ground_time_ms", sa.Float(), nullable=True)
    )
    op.add_column(
        "activity_records", sa.Column("stride_length_cm", sa.Float(), nullable=True)
    )
    op.add_column(
        "activity_records", sa.Column("stride_ratio_pct", sa.Float(), nullable=True)
    )
    op.add_column(
        "activity_records", sa.Column("stride_height_cm", sa.Float(), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("activity_records", "stride_height_cm")
    op.drop_column("activity_records", "stride_ratio_pct")
    op.drop_column("activity_records", "stride_length_cm")
    op.drop_column("activity_records", "ground_time_ms")
    op.drop_column("activities", "label_id")
