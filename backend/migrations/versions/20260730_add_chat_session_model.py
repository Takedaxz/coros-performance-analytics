"""Store the selected AI model on each chat session."""

import sqlalchemy as sa
from alembic import op

revision = "20260730_chat_session_model"
down_revision = "20260727_user_sex"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("chat_sessions", sa.Column("model_name", sa.String(length=100), nullable=True))


def downgrade() -> None:
    op.drop_column("chat_sessions", "model_name")
