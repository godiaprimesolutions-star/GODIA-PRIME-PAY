
-- GODIA PRIME PAY
-- Migration 0002: Daraja payment records
-- Compatible with src/index.js

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS gp_payments (
  checkout_id TEXT PRIMARY KEY NOT NULL,
  merchant_id TEXT NOT NULL,
  phone TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  reference TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'PAID', 'FAILED')),
  result_code INTEGER,
  result_description TEXT,
  mpesa_receipt TEXT UNIQUE,
  paid_amount INTEGER,
  paid_phone TEXT,
  transaction_date TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_gp_payments_phone
ON gp_payments(phone);

CREATE INDEX IF NOT EXISTS idx_gp_payments_status
ON gp_payments(status);

CREATE INDEX IF NOT EXISTS idx_gp_payments_reference
ON gp_payments(reference);

CREATE INDEX IF NOT EXISTS idx_gp_payments_created
ON gp_payments(created_at);
