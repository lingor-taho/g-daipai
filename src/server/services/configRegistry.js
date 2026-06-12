const CONFIG_DEFINITIONS = Object.freeze({
  multi_bid_start_hours: { type: 'number', defaultValue: 0.5, min: 0.01 },
  multi_bid_interval_minutes: { type: 'integer', defaultValue: 5, min: 1 },
  idle_sync_interval_minutes: { type: 'integer', defaultValue: 5, min: 1 },
  idle_bid_guard_minutes: { type: 'integer', defaultValue: 10, min: 1 },
  multi_bid_min_price: { type: 'integer', defaultValue: 5000, min: 1 },
  transaction_start_hour: { type: 'integer', defaultValue: 1, min: 0, max: 23 },
  confirm_receipt_hour: { type: 'integer', defaultValue: 18, min: 0, max: 23 },
  scan_start_hour: { type: 'integer', defaultValue: 1, min: 0, max: 23 },
  scan_end_hour: { type: 'integer', defaultValue: 20, min: 0, max: 23 },
  scan_every_idle_runs: { type: 'integer', defaultValue: 5, min: 1 },
  payment_job_limit: { type: 'integer', defaultValue: 3, min: 1 },
  payment_job_limit_min: { type: 'integer', defaultValue: 3, min: 1 },
  payment_job_limit_max: { type: 'integer', defaultValue: 3, min: 1 },
  payment_page_stay_seconds: { type: 'integer', defaultValue: 3, min: 1 },
  data_cleanup_enabled: { type: 'boolean', defaultValue: false },
  data_cleanup_hour: { type: 'integer', defaultValue: 3, min: 0, max: 23 },
  data_cleanup_retention_days: { type: 'integer', defaultValue: 30, min: 1 }
});

module.exports = { CONFIG_DEFINITIONS };
