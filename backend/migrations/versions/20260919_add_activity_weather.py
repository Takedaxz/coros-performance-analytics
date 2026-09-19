"""Add persisted activity weather snapshots."""

import sqlalchemy as sa
from alembic import op

revision = "20260919_add_activity_weather"
down_revision = "20260902_chat_message_status"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("activities", sa.Column("weather", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("activities", "weather")
