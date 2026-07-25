CREATE TABLE api_rate_limit_counters (
  scope TEXT NOT NULL,
  key_hmac_sha256 CHAR(64) NOT NULL,
  request_count INTEGER NOT NULL CHECK (request_count > 0),
  window_started_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (scope, key_hmac_sha256),
  CHECK (scope ~ '^[a-z0-9][a-z0-9._-]{0,79}$'),
  CHECK (key_hmac_sha256 ~ '^[0-9a-f]{64}$'),
  CHECK (expires_at > window_started_at)
);

CREATE INDEX api_rate_limit_counters_expiry_idx
  ON api_rate_limit_counters (expires_at);

COMMENT ON TABLE api_rate_limit_counters IS
  'Shared fixed-window abuse counters. Identifiers are stored only as keyed HMAC-SHA256 values.';
