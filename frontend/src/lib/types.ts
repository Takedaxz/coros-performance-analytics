/* Activity and health data types matching the backend API responses */

export interface ActivitySummary {
  id: string;
  sport: string;
  subsport?: string;
  title?: string;
  start_time: string;
  elapsed_time_s?: number;
  distance_m?: number;
  elevation_gain_m?: number;
  avg_hr_bpm?: number;
  avg_speed_mps?: number;
  avg_power_w?: number;
  calories_kcal?: number;
  training_load_vendor?: number;
  source_type: string;
}

export interface HealthDay {
  date: string;
  resting_hr_bpm?: number;
  overnight_hrv_avg_ms?: number;
  hrv_7d_sma?: number;
  recovery_vendor?: number;
  steps?: number;
  active_calories_kcal?: number;
  readiness_score_app?: number;
  strain_score_app?: number;
  anomaly_flags?: Record<string, unknown>;
}

export interface SleepSummary {
  sleep_start: string;
  duration_s: number;
  is_nap: boolean;
  stage_deep_s?: number;
  stage_rem_s?: number;
  stage_light_s?: number;
  stage_awake_s?: number;
  sleep_quality_vendor?: number;
}

export interface FitnessSummary {
  vo2max?: number;
  vo2max_30d_avg?: number | null;
  ftp?: number;
  running_fitness?: number;
  cardio_fitness_age?: number;
  date?: string;
}

export interface DashboardData {
  period_days: number;
  activities: ActivitySummary[];
  health: HealthDay[];
  latest_steps?: Pick<HealthDay, "date" | "steps" | "active_calories_kcal"> | null;
  sleep: SleepSummary[];
  fitness: FitnessSummary;
}

export interface SyncStatus {
  api_enabled: boolean;
  sync_interval_minutes: string;
  last_sync_at: string;
  last_sync_status: string;
}

export interface TrainingLoadDay {
  date: string;
  total_load: number;
  activity_count: number;
}
