// QuickPeg backend -- database setup
// Uses SQLite (a single-file database, no separate server needed).
// The file quickpeg.db will be created in this folder the first time this runs.

const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'quickpeg.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS retailers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT,
  phone TEXT,
  password TEXT,
  excise_license TEXT,
  is_open INTEGER DEFAULT 1,
  commission_pct REAL DEFAULT 12,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  retailer_id TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  price INTEGER NOT NULL,
  kind TEXT DEFAULT 'bottle',
  tone TEXT DEFAULT '#8A7B4F',
  cap TEXT DEFAULT '#C77D34',
  in_stock INTEGER DEFAULT 1,
  FOREIGN KEY(retailer_id) REFERENCES retailers(id)
);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  phone TEXT UNIQUE NOT NULL,
  name TEXT,
  dob TEXT,
  age_verified INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS riders (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT UNIQUE,
  password TEXT,
  vehicle TEXT,
  is_online INTEGER DEFAULT 0,
  rating REAL DEFAULT 5.0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  order_number TEXT UNIQUE NOT NULL,
  customer_id TEXT,
  retailer_id TEXT NOT NULL,
  rider_id TEXT,
  status TEXT DEFAULT 'placed',
  -- placed -> accepted -> preparing -> ready -> picked_up -> delivered  (or rejected/cancelled)
  items_json TEXT NOT NULL,
  total INTEGER NOT NULL,
  rider_fare INTEGER DEFAULT 70,
  payment_method TEXT,
  delivery_address TEXT,
  cancel_reason TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS order_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY(order_id) REFERENCES orders(id)
);

CREATE TABLE IF NOT EXISTS otps (
  phone TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_orders_retailer ON orders(retailer_id);
CREATE INDEX IF NOT EXISTS idx_orders_rider ON orders(rider_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_products_retailer ON products(retailer_id);
`);

module.exports = db;
