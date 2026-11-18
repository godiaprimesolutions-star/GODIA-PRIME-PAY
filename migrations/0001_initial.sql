-- GODIA PRIME PAY initial schema.
-- Review before applying to a newly created project D1 database.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  name TEXT,
  phone TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payment_requests (
  id TEXT PRIMARY KEY,
  customer_id TEXT,
  phone TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  account_reference TEXT,
  description TEXT,
  method TEXT NOT NULL CHECK (method IN ('daraja_stk', 'ussd_assisted')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'submitted', 'successful', 'failed', 'cancelled')),
  checkout_request_id TEXT UNIQUE,
  merchant_request_id TEXT,
  mpesa_receipt_number TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE INDEX IF NOT EXISTS idx_payment_requests_phone
  ON payment_requests(phone);

CREATE INDEX IF NOT EXISTS idx_payment_requests_status
  ON payment_requests(status);

CREATE INDEX IF NOT EXISTS idx_payment_requests_created
  ON payment_requests(created_at);
