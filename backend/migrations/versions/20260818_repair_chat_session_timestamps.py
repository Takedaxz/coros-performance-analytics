"""Repair chat session timestamps changed by project moves."""

from alembic import op

revision = "20260818_repair_chat_timestamps"
down_revision = "20260817_chat_projects"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE chat_sessions AS session
        SET updated_at = activity.last_activity_at
        FROM (
            SELECT
                chat_sessions.id,
                COALESCE(MAX(chat_messages.created_at), chat_sessions.created_at) AS last_activity_at
            FROM chat_sessions
            LEFT JOIN chat_messages ON chat_messages.session_id = chat_sessions.id
            GROUP BY chat_sessions.id, chat_sessions.created_at
        ) AS activity
        WHERE session.id = activity.id
          AND session.updated_at > activity.last_activity_at + INTERVAL '1 second'
        """
    )


def downgrade() -> None:
    pass
