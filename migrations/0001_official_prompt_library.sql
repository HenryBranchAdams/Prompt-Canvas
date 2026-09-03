PRAGMA foreign_keys = ON;

CREATE TABLE official_prompt_catalog_meta (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  catalog_version TEXT NOT NULL,
  build_hash TEXT NOT NULL,
  published_at TEXT NOT NULL
);

CREATE TABLE official_prompts (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  current_version INTEGER NOT NULL CHECK (current_version > 0),
  title TEXT NOT NULL,
  short_description TEXT NOT NULL,
  user_promise TEXT NOT NULL,
  collection TEXT NOT NULL,
  category TEXT NOT NULL,
  template_family TEXT NOT NULL,
  default_operation TEXT NOT NULL,
  input_mode TEXT NOT NULL,
  output_kind TEXT NOT NULL,
  complexity TEXT NOT NULL,
  required_input_summary TEXT NOT NULL,
  preservation_summary TEXT NOT NULL,
  badges TEXT NOT NULL,
  aliases TEXT NOT NULL,
  search_text TEXT NOT NULL,
  thumbnail_path TEXT NOT NULL,
  thumbnail_alt TEXT NOT NULL,
  featured_rank INTEGER,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE official_prompt_versions (
  prompt_id TEXT NOT NULL REFERENCES official_prompts(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL CHECK (version > 0),
  template_json TEXT NOT NULL,
  template_schema TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  normalized_prompt TEXT NOT NULL,
  negative_prompt TEXT,
  source_json TEXT NOT NULL,
  change_note TEXT,
  created_at TEXT NOT NULL,
  published_at TEXT NOT NULL,
  PRIMARY KEY (prompt_id, version),
  UNIQUE (content_hash)
);

CREATE TABLE official_prompt_facets (
  prompt_id TEXT NOT NULL REFERENCES official_prompts(id) ON DELETE CASCADE,
  facet_type TEXT NOT NULL,
  facet_value TEXT NOT NULL,
  PRIMARY KEY (prompt_id, facet_type, facet_value)
);

CREATE INDEX official_prompt_facets_lookup
  ON official_prompt_facets (facet_type, facet_value, prompt_id);

CREATE VIRTUAL TABLE official_prompt_fts USING fts5(
  prompt_id UNINDEXED,
  title,
  description,
  user_promise,
  aliases,
  search_text,
  tokenize = 'unicode61 remove_diacritics 2'
);
