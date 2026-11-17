INSERT INTO logs (log_id, timestamp, severity, service_name, source, ip_address, http_status, message, metadata)
VALUES
  ('DEMO-ERROR-001', NOW() - INTERVAL '1 hour', 'ERROR', 'Database', 'db-01', '192.168.10.12', 503, 'Database connection failed while opening a reporting session.', '{"host":"db-01","port":5432}'),
  ('DEMO-WARNING-001', NOW() - INTERVAL '2 hours', 'WARNING', 'Server', 'app-02', '192.168.10.18', 503, 'Memory usage exceeded the configured warning threshold.', '{"host":"app-02","memoryPercent":87}'),
  ('DEMO-INFO-001', NOW() - INTERVAL '4 hours', 'INFO', 'Auth', 'gateway-01', '192.168.10.33', 200, 'A user authenticated successfully.', '{"host":"gateway-01"}'),
  ('DEMO-DEBUG-001', NOW() - INTERVAL '6 hours', 'DEBUG', 'API', 'api-01', '192.168.10.55', 200, 'Request processing completed in 120 milliseconds.', '{"host":"api-01","durationMs":120}'),
  ('DEMO-CRITICAL-001', NOW() - INTERVAL '9 hours', 'CRITICAL', 'Storage', 'store-01', '192.168.10.61', 500, 'Storage volume reached critical capacity and writes were paused.', '{"host":"store-01","volumePercent":99}')
ON CONFLICT (log_id) DO NOTHING;
