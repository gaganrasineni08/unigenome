CREATE TABLE IF NOT EXISTS parties (
  id TEXT PRIMARY KEY,
  handle TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL,              -- regulator | manufacturer | qa | warehouse | retailer
  org TEXT,                        -- for qa: the manufacturer it belongs to
  public_key TEXT NOT NULL,
  enc_key JSONB NOT NULL,          -- private key encrypted in the browser with the user's passphrase
  status TEXT NOT NULL,            -- pending | approved | rejected | revoked
  approved_by TEXT,
  approval_sig TEXT,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS sites (
  id TEXT PRIMARY KEY,
  party_id TEXT NOT NULL,
  name TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL
);
CREATE TABLE IF NOT EXISTS challenges (nonce TEXT PRIMARY KEY, party_id TEXT NOT NULL, expires BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, party_id TEXT NOT NULL, expires BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS batches (
  id TEXT PRIMARY KEY,
  mfr TEXT NOT NULL,
  product_code TEXT NOT NULL,
  product_name TEXT NOT NULL,
  category TEXT NOT NULL,
  mfg TEXT NOT NULL,
  exp TEXT,
  quantity INT NOT NULL,
  issued INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL,            -- awaiting_qa | approved | recalled
  created_by TEXT NOT NULL,
  sig TEXT NOT NULL,
  qa_by TEXT,
  qa_sig TEXT,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS units (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,              -- item | carton | pallet
  batch_id TEXT,
  fields JSONB NOT NULL,
  sig TEXT NOT NULL,
  dna TEXT NOT NULL,
  signer TEXT NOT NULL,
  parent_id TEXT,
  head TEXT NOT NULL DEFAULT '0',  -- hash of the newest record on this unit's chain
  custodian TEXT,                  -- party holding it; NULL while in transit or while packed
  in_transit_to TEXT,
  condition_bad BOOLEAN NOT NULL DEFAULT FALSE,
  sold_at_site TEXT,
  sold_ts BIGINT,
  claim_hash TEXT,
  claimed_ts BIGINT,
  claimed_device TEXT,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS units_parent ON units(parent_id);
CREATE INDEX IF NOT EXISTS units_batch ON units(batch_id);
CREATE TABLE IF NOT EXISTS pack_links (
  child TEXT NOT NULL,
  parent TEXT NOT NULL,
  from_ts BIGINT NOT NULL,
  to_ts BIGINT
);
CREATE INDEX IF NOT EXISTS pack_child ON pack_links(child);
CREATE INDEX IF NOT EXISTS pack_parent ON pack_links(parent);
CREATE TABLE IF NOT EXISTS events (
  hash TEXT PRIMARY KEY,
  unit_id TEXT NOT NULL,
  seq INT NOT NULL,
  body JSONB NOT NULL,
  sig TEXT NOT NULL,
  actor TEXT NOT NULL,
  type TEXT NOT NULL,
  ts BIGINT NOT NULL,
  server_ts BIGINT NOT NULL,
  flags JSONB NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS events_unit ON events(unit_id, seq);
CREATE TABLE IF NOT EXISTS shipments (
  id TEXT PRIMARY KEY,
  unit_id TEXT NOT NULL,
  from_party TEXT NOT NULL,
  to_party TEXT NOT NULL,
  ref TEXT,
  dispatched_ts BIGINT NOT NULL,
  eta_ts BIGINT NOT NULL,
  eta_path JSONB,
  received_ts BIGINT,
  received_by TEXT,
  status TEXT NOT NULL             -- in_transit | received | diverted
);
CREATE TABLE IF NOT EXISTS scans (
  id SERIAL PRIMARY KEY,
  unit_id TEXT,
  device TEXT NOT NULL,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  ts BIGINT NOT NULL,
  verdict TEXT NOT NULL,
  reasons JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS scans_unit ON scans(unit_id);
CREATE TABLE IF NOT EXISTS complaints (
  id TEXT PRIMARY KEY,
  unit_id TEXT,
  batch_id TEXT,
  reason TEXT NOT NULL,
  text TEXT NOT NULL,
  contact TEXT,
  with_claim BOOLEAN NOT NULL,
  verdict TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  device TEXT NOT NULL,
  ts BIGINT NOT NULL,
  status TEXT NOT NULL,            -- received | under_review | resolved | rejected
  severity INT NOT NULL,
  response TEXT
);
CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  severity INT NOT NULL,
  unit_id TEXT,
  batch_id TEXT,
  party_id TEXT,
  message TEXT NOT NULL,
  ts BIGINT NOT NULL,
  status TEXT NOT NULL,            -- open | closed
  dedupe TEXT UNIQUE
);

-- Company proofs for the network head's review (added after the first release, so existing databases get the columns too).
ALTER TABLE parties ADD COLUMN IF NOT EXISTS proof JSONB;
ALTER TABLE parties ADD COLUMN IF NOT EXISTS review_note TEXT;
ALTER TABLE parties ADD COLUMN IF NOT EXISTS reviewed_at BIGINT;
