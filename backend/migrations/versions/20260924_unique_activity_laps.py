"""Remove identical duplicate laps and enforce one row per lap number."""

from alembic import op

revision = "20260924_unique_activity_laps"
down_revision = "20260919_add_activity_weather"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        WITH numbered AS (
            SELECT id, row_number() OVER (
                PARTITION BY activity_id, lap_index, start_time, elapsed_s, distance_m,
                    avg_hr_bpm, max_hr_bpm, avg_speed_mps, avg_power_w, calories_kcal,
                    avg_cadence, lap_trigger
                ORDER BY id
            ) AS copy_number
            FROM activity_laps
        )
        DELETE FROM activity_laps
        WHERE id IN (SELECT id FROM numbered WHERE copy_number > 1)
        """
    )
    op.create_unique_constraint(
        "uq_activity_laps_activity_lap_index", "activity_laps", ["activity_id", "lap_index"]
    )


def downgrade() -> None:
    op.drop_constraint("uq_activity_laps_activity_lap_index", "activity_laps", type_="unique")
