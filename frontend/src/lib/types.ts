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
  readiness_score_app?: number;
  strain_score_app?: number;
  anomaly_flags?: Record<string, unknown>;
}

export interface SleepSummary {
  sleep_start: string;
  duration_s: number;
  stage_deep_s?: number;
  stage_rem_s?: number;
  stage_light_s?: number;
  stage_awake_s?: number;
}

export interface FitnessSummary {
  vo2max?: number;
  ftp?: number;
  running_fitness?: number;
  biological_age?: number;
  date?: string;
}

export interface DashboardData {
  period_days: number;
  activities: ActivitySummary[];
  health: HealthDay[];
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
