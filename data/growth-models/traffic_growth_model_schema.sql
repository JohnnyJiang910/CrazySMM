CREATE TABLE traffic_growth_models (
  version VARCHAR(64) NOT NULL,
  model_id VARCHAR(16) NOT NULL,
  model_key VARCHAR(80) NOT NULL,
  model_name VARCHAR(120) NOT NULL,
  family VARCHAR(80) NOT NULL,
  use_case TEXT NOT NULL,
  timing_basis VARCHAR(80) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (version, model_id)
);

CREATE TABLE traffic_growth_model_points (
  version VARCHAR(64) NOT NULL,
  model_id VARCHAR(16) NOT NULL,
  horizon_days SMALLINT NOT NULL,
  slot INTEGER NOT NULL,
  day SMALLINT NOT NULL,
  hour_start NUMERIC(8, 2) NOT NULL,
  hour_end NUMERIC(8, 2) NOT NULL,
  progress_start NUMERIC(12, 8) NOT NULL,
  progress_end NUMERIC(12, 8) NOT NULL,
  phase VARCHAR(80) NOT NULL,
  increment_share NUMERIC(16, 12) NOT NULL,
  cumulative_share NUMERIC(16, 12) NOT NULL,
  PRIMARY KEY (version, model_id, horizon_days, slot),
  FOREIGN KEY (version, model_id)
    REFERENCES traffic_growth_models(version, model_id)
);

CREATE INDEX idx_traffic_growth_points_lookup
  ON traffic_growth_model_points(version, model_id, horizon_days, slot);
