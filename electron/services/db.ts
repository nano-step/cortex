import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { mkdirSync, existsSync } from 'fs'

let db: Database.Database | null = null

function getDbPath(): string {
  const userDataPath = app.getPath('userData')
  const dbDir = join(userDataPath, 'cortex-data')
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true })
  }
  return join(dbDir, 'cortex.db')
}

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(getDbPath())
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    initSchema(db)
  }
  return db
}

export function closeDb(): void {
  if (db) {
    db.close()
    db = null
  }
}

function initSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      brain_name TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS repositories (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      source_type TEXT NOT NULL CHECK(source_type IN ('local', 'github', 'jira', 'confluence')),
      source_path TEXT NOT NULL,
      branch TEXT DEFAULT 'main',
      active_branch TEXT NOT NULL DEFAULT 'main',
      last_indexed_sha TEXT,
      last_indexed_at INTEGER,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'indexing', 'ready', 'error')),
      error_message TEXT,
      total_files INTEGER DEFAULT 0,
      total_chunks INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS chunks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      repo_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      language TEXT NOT NULL,
      chunk_type TEXT NOT NULL,
      name TEXT,
      content TEXT NOT NULL,
      line_start INTEGER NOT NULL,
      line_end INTEGER NOT NULL,
      token_estimate INTEGER NOT NULL,
      dependencies TEXT DEFAULT '[]',
      exports TEXT DEFAULT '[]',
      metadata TEXT DEFAULT '{}',
      embedding BLOB,
      branch TEXT NOT NULL DEFAULT 'main',
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (repo_id) REFERENCES repositories(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_chunks_project ON chunks(project_id);
    CREATE INDEX IF NOT EXISTS idx_chunks_repo ON chunks(repo_id);
    CREATE INDEX IF NOT EXISTS idx_chunks_file ON chunks(relative_path);
    CREATE INDEX IF NOT EXISTS idx_chunks_type ON chunks(chunk_type);
    CREATE INDEX IF NOT EXISTS idx_chunks_name ON chunks(name);


    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT 'New Conversation',
      mode TEXT NOT NULL DEFAULT 'engineering' CHECK(mode IN ('pm', 'engineering')),
      branch TEXT NOT NULL DEFAULT 'main',
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
      content TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'engineering',
      context_chunks TEXT DEFAULT '[]',
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      project_id TEXT,
      user_action TEXT,
      details TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS github_tokens (
      id TEXT PRIMARY KEY,
      token_encrypted TEXT NOT NULL,
      scope TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS project_directory_trees (
      project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
      tree_text TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS repository_directory_trees (
      repo_id TEXT PRIMARY KEY REFERENCES repositories(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      tree_text TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_repo_trees_project ON repository_directory_trees(project_id);

    CREATE TABLE IF NOT EXISTS project_atlassian_configs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      site_url TEXT NOT NULL,
      email TEXT NOT NULL,
      api_token_encrypted TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      UNIQUE(project_id)
    );

    -- Self-Learning Engine tables

    CREATE TABLE IF NOT EXISTS feedback_signals (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      message_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      signal_type TEXT NOT NULL CHECK(signal_type IN ('thumbs_up', 'thumbs_down', 'copy', 'follow_up_quick', 'follow_up_slow', 'no_follow_up')),
      query TEXT NOT NULL,
      chunk_ids TEXT NOT NULL DEFAULT '[]',
      metadata TEXT DEFAULT '{}',
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_feedback_project ON feedback_signals(project_id);
    CREATE INDEX IF NOT EXISTS idx_feedback_message ON feedback_signals(message_id);

    CREATE TABLE IF NOT EXISTS training_pairs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      query TEXT NOT NULL,
      chunk_id TEXT NOT NULL,
      label REAL NOT NULL CHECK(label >= -1.0 AND label <= 1.0),
      source TEXT NOT NULL CHECK(source IN ('thumbs_up', 'thumbs_down', 'copy', 'implicit_positive', 'implicit_negative')),
      weight REAL NOT NULL DEFAULT 1.0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_training_project ON training_pairs(project_id);
    CREATE INDEX IF NOT EXISTS idx_training_chunk ON training_pairs(chunk_id);

    CREATE TABLE IF NOT EXISTS learning_metrics (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      metric_type TEXT NOT NULL,
      value REAL NOT NULL,
      details TEXT DEFAULT '{}',
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_metrics_project ON learning_metrics(project_id);

    CREATE TABLE IF NOT EXISTS learned_weights (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      chunk_id TEXT NOT NULL,
      query_hash TEXT NOT NULL,
      score_adjustment REAL NOT NULL DEFAULT 0.0,
      confidence REAL NOT NULL DEFAULT 0.0,
      hit_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      UNIQUE(project_id, chunk_id, query_hash)
    );
    CREATE INDEX IF NOT EXISTS idx_weights_project ON learned_weights(project_id);
    CREATE INDEX IF NOT EXISTS idx_weights_lookup ON learned_weights(project_id, query_hash);

    CREATE TABLE IF NOT EXISTS query_patterns (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      pattern TEXT NOT NULL,
      matched_paths TEXT NOT NULL DEFAULT '[]',
      frequency INTEGER NOT NULL DEFAULT 1,
      last_used_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_patterns_project ON query_patterns(project_id);

    CREATE TABLE IF NOT EXISTS prompt_variants (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      variant_name TEXT NOT NULL,
      template TEXT NOT NULL,
      few_shot_examples TEXT NOT NULL DEFAULT '[]',
      score REAL NOT NULL DEFAULT 0.0,
      usage_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_variants_project ON prompt_variants(project_id);
  `)

  // Migrations: add columns that may not exist in older databases
  const migrations = [
    `ALTER TABLE repositories ADD COLUMN branch TEXT DEFAULT 'main'`,
    `ALTER TABLE repositories ADD COLUMN active_branch TEXT NOT NULL DEFAULT 'main'`,
    `ALTER TABLE chunks ADD COLUMN branch TEXT NOT NULL DEFAULT 'main'`,
    `ALTER TABLE conversations ADD COLUMN branch TEXT NOT NULL DEFAULT 'main'`,
    `ALTER TABLE conversations ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0`,
    `CREATE TABLE IF NOT EXISTS repositories_new (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      source_type TEXT NOT NULL CHECK(source_type IN ('local', 'github', 'jira', 'confluence')),
      source_path TEXT NOT NULL,
      branch TEXT DEFAULT 'main',
      active_branch TEXT NOT NULL DEFAULT 'main',
      last_indexed_sha TEXT,
      last_indexed_at INTEGER,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'indexing', 'ready', 'error')),
      error_message TEXT,
      total_files INTEGER DEFAULT 0,
      total_chunks INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    )`,
    `INSERT OR IGNORE INTO repositories_new SELECT * FROM repositories`,
    `DROP TABLE IF EXISTS repositories`,
    `ALTER TABLE repositories_new RENAME TO repositories`
  ]
  for (const sql of migrations) {
    try {
      database.exec(sql)
    } catch {
      // Column already exists — ignore
    }
  }

  // Create indexes that depend on migrated columns
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_chunks_branch ON chunks(branch);
  `)
}

// --- CRUD helpers ---

export interface DbProject {
  id: string
  name: string
  brain_name: string
  created_at: number
  updated_at: number
}

export interface DbRepository {
  id: string
  project_id: string
  source_type: 'local' | 'github'
  source_path: string
  branch: string
  active_branch: string
  last_indexed_sha: string | null
  last_indexed_at: number | null
  status: 'pending' | 'indexing' | 'ready' | 'error'
  error_message: string | null
  total_files: number
  total_chunks: number
  created_at: number
}

export interface DbChunk {
  id: string
  project_id: string
  repo_id: string
  file_path: string
  relative_path: string
  language: string
  chunk_type: string
  name: string | null
  content: string
  line_start: number
  line_end: number
  token_estimate: number
  dependencies: string
  exports: string
  metadata: string
  embedding: Buffer | null
  branch: string
  created_at: number
}

export interface DbProjectAtlassianConfig {
  id: string
  project_id: string
  site_url: string
  email: string
  api_token_encrypted: string
  created_at: number
  updated_at: number
}

export const projectQueries = {
  create: (db: Database.Database) =>
    db.prepare('INSERT INTO projects (id, name, brain_name) VALUES (?, ?, ?)'),

  getAll: (db: Database.Database) =>
    db.prepare('SELECT * FROM projects ORDER BY updated_at DESC'),

  getById: (db: Database.Database) =>
    db.prepare('SELECT * FROM projects WHERE id = ?'),

  delete: (db: Database.Database) =>
    db.prepare('DELETE FROM projects WHERE id = ?'),

  updateName: (db: Database.Database) =>
    db.prepare('UPDATE projects SET name = ?, updated_at = unixepoch() * 1000 WHERE id = ?')
}

export const repoQueries = {
  create: (db: Database.Database) =>
    db.prepare(
      'INSERT INTO repositories (id, project_id, source_type, source_path, branch) VALUES (?, ?, ?, ?, ?)'
    ),

  getByProject: (db: Database.Database) =>
    db.prepare('SELECT * FROM repositories WHERE project_id = ? ORDER BY created_at DESC'),

  updateStatus: (db: Database.Database) =>
    db.prepare('UPDATE repositories SET status = ?, error_message = ? WHERE id = ?'),

  updateIndexed: (db: Database.Database) =>
    db.prepare(
      'UPDATE repositories SET last_indexed_sha = ?, last_indexed_at = ?, status = ?, total_files = ?, total_chunks = ? WHERE id = ?'
    ),

  updateActiveBranch: (db: Database.Database) =>
    db.prepare('UPDATE repositories SET active_branch = ? WHERE id = ?'),

  delete: (db: Database.Database) =>
    db.prepare('DELETE FROM repositories WHERE id = ?'),
}

export const chunkQueries = {
  insert: (db: Database.Database) =>
    db.prepare(`
      INSERT INTO chunks (id, project_id, repo_id, file_path, relative_path, language, chunk_type, name, content, line_start, line_end, token_estimate, dependencies, exports, metadata, branch)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),

  getByProject: (db: Database.Database) =>
    db.prepare('SELECT * FROM chunks WHERE project_id = ?'),

  getByRepo: (db: Database.Database) =>
    db.prepare('SELECT * FROM chunks WHERE repo_id = ?'),

  deleteByRepo: (db: Database.Database) =>
    db.prepare('DELETE FROM chunks WHERE repo_id = ?'),

  deleteByFile: (db: Database.Database) =>
    db.prepare('DELETE FROM chunks WHERE repo_id = ? AND relative_path = ?'),

  searchByContent: (db: Database.Database) =>
    db.prepare(
      'SELECT * FROM chunks WHERE project_id = ? AND content LIKE ? LIMIT ?'
    ),

  searchByName: (db: Database.Database) =>
    db.prepare(
      'SELECT * FROM chunks WHERE project_id = ? AND name LIKE ? LIMIT ?'
    ),

  countByProject: (db: Database.Database) =>
    db.prepare('SELECT COUNT(*) as count FROM chunks WHERE project_id = ?'),

  updateEmbedding: (db: Database.Database) =>
    db.prepare('UPDATE chunks SET embedding = ? WHERE id = ?'),

  getByRepoBranch: (db: Database.Database) =>
    db.prepare('SELECT * FROM chunks WHERE repo_id = ? AND branch = ?'),

  deleteByRepoBranch: (db: Database.Database) =>
    db.prepare('DELETE FROM chunks WHERE repo_id = ? AND branch = ?'),

  deleteByFileBranch: (db: Database.Database) =>
    db.prepare('DELETE FROM chunks WHERE repo_id = ? AND relative_path = ? AND branch = ?'),

  searchByContentBranch: (db: Database.Database) =>
    db.prepare(
      'SELECT * FROM chunks WHERE project_id = ? AND branch = ? AND content LIKE ? LIMIT ?'
    ),

  searchByNameBranch: (db: Database.Database) =>
    db.prepare(
      'SELECT * FROM chunks WHERE project_id = ? AND branch = ? AND name LIKE ? LIMIT ?'
    )
    }

export const repoTreeQueries = {
  upsert: (db: Database.Database) =>
    db.prepare(
      `INSERT OR REPLACE INTO repository_directory_trees (repo_id, project_id, tree_text, updated_at)
       VALUES (?, ?, ?, ?)`
    ),

  getByProject: (db: Database.Database) =>
    db.prepare(
      'SELECT rt.*, r.source_path FROM repository_directory_trees rt JOIN repositories r ON rt.repo_id = r.id WHERE rt.project_id = ? ORDER BY r.created_at'
    ),

  getByRepo: (db: Database.Database) =>
    db.prepare('SELECT * FROM repository_directory_trees WHERE repo_id = ?'),
}

export const conversationQueries = {
  create: (db: Database.Database) =>
    db.prepare('INSERT INTO conversations (id, project_id, title, mode, branch) VALUES (?, ?, ?, ?, ?)'),

  getById: (db: Database.Database) =>
    db.prepare('SELECT * FROM conversations WHERE id = ?'),

  getByProject: (db: Database.Database) =>
    db.prepare('SELECT * FROM conversations WHERE project_id = ? ORDER BY pinned DESC, updated_at DESC'),

  updateTitle: (db: Database.Database) =>
    db.prepare('UPDATE conversations SET title = ?, updated_at = unixepoch() * 1000 WHERE id = ?'),

  touch: (db: Database.Database) =>
    db.prepare('UPDATE conversations SET updated_at = unixepoch() * 1000 WHERE id = ?'),

  delete: (db: Database.Database) =>
    db.prepare('DELETE FROM conversations WHERE id = ?'),

  getByProjectAndBranch: (db: Database.Database) =>
    db.prepare('SELECT * FROM conversations WHERE project_id = ? AND branch = ? ORDER BY pinned DESC, updated_at DESC'),

  togglePin: (db: Database.Database) =>
    db.prepare('UPDATE conversations SET pinned = CASE WHEN pinned = 1 THEN 0 ELSE 1 END WHERE id = ?'),
}

export const messageQueries = {
  create: (db: Database.Database) =>
    db.prepare('INSERT INTO messages (id, conversation_id, role, content, mode, context_chunks) VALUES (?, ?, ?, ?, ?, ?)'),

  getByConversation: (db: Database.Database) =>
    db.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC'),

  updateContent: (db: Database.Database) =>
    db.prepare('UPDATE messages SET content = ? WHERE id = ?')
}

// --- Self-Learning Engine query helpers ---

export interface DbFeedbackSignal {
  id: string
  project_id: string
  message_id: string
  conversation_id: string
  signal_type: 'thumbs_up' | 'thumbs_down' | 'copy' | 'follow_up_quick' | 'follow_up_slow' | 'no_follow_up'
  query: string
  chunk_ids: string
  metadata: string
  created_at: number
}

export interface DbTrainingPair {
  id: string
  project_id: string
  query: string
  chunk_id: string
  label: number
  source: string
  weight: number
  created_at: number
}

export interface DbLearnedWeight {
  id: string
  project_id: string
  chunk_id: string
  query_hash: string
  score_adjustment: number
  confidence: number
  hit_count: number
  created_at: number
  updated_at: number
}

export interface DbQueryPattern {
  id: string
  project_id: string
  pattern: string
  matched_paths: string
  frequency: number
  last_used_at: number
  created_at: number
}

export interface DbPromptVariant {
  id: string
  project_id: string
  variant_name: string
  template: string
  few_shot_examples: string
  score: number
  usage_count: number
  created_at: number
  updated_at: number
}

export interface DbLearningMetric {
  id: string
  project_id: string
  metric_type: string
  value: number
  details: string
  created_at: number
}

export const feedbackQueries = {
  insert: (db: Database.Database) =>
    db.prepare(
      'INSERT INTO feedback_signals (id, project_id, message_id, conversation_id, signal_type, query, chunk_ids, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ),

  getByProject: (db: Database.Database) =>
    db.prepare('SELECT * FROM feedback_signals WHERE project_id = ? ORDER BY created_at DESC LIMIT ?'),

  getByMessage: (db: Database.Database) =>
    db.prepare('SELECT * FROM feedback_signals WHERE message_id = ?'),

  countByProject: (db: Database.Database) =>
    db.prepare('SELECT COUNT(*) as count FROM feedback_signals WHERE project_id = ?'),

  getRecentPositive: (db: Database.Database) =>
    db.prepare(
      `SELECT * FROM feedback_signals WHERE project_id = ? AND signal_type IN ('thumbs_up', 'copy', 'no_follow_up') ORDER BY created_at DESC LIMIT ?`
    ),

  getRecentNegative: (db: Database.Database) =>
    db.prepare(
      `SELECT * FROM feedback_signals WHERE project_id = ? AND signal_type IN ('thumbs_down', 'follow_up_quick') ORDER BY created_at DESC LIMIT ?`
    )
}

export const trainingPairQueries = {
  insert: (db: Database.Database) =>
    db.prepare(
      'INSERT INTO training_pairs (id, project_id, query, chunk_id, label, source, weight) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ),

  getByProject: (db: Database.Database) =>
    db.prepare('SELECT * FROM training_pairs WHERE project_id = ? ORDER BY created_at DESC LIMIT ?'),

  countByProject: (db: Database.Database) =>
    db.prepare('SELECT COUNT(*) as count FROM training_pairs WHERE project_id = ?'),

  getPositive: (db: Database.Database) =>
    db.prepare('SELECT * FROM training_pairs WHERE project_id = ? AND label > 0 LIMIT ?'),

  getNegative: (db: Database.Database) =>
    db.prepare('SELECT * FROM training_pairs WHERE project_id = ? AND label < 0 LIMIT ?')
}

export const learnedWeightQueries = {
  upsert: (db: Database.Database) =>
    db.prepare(
      `INSERT INTO learned_weights (id, project_id, chunk_id, query_hash, score_adjustment, confidence, hit_count, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, unixepoch() * 1000)
       ON CONFLICT(project_id, chunk_id, query_hash) DO UPDATE SET
         score_adjustment = (learned_weights.score_adjustment * learned_weights.hit_count + excluded.score_adjustment) / (learned_weights.hit_count + 1),
         confidence = MIN(1.0, learned_weights.confidence + 0.05),
         hit_count = learned_weights.hit_count + 1,
         updated_at = unixepoch() * 1000`
    ),

  getByQueryHash: (db: Database.Database) =>
    db.prepare('SELECT * FROM learned_weights WHERE project_id = ? AND query_hash = ?'),

  getAll: (db: Database.Database) =>
    db.prepare('SELECT * FROM learned_weights WHERE project_id = ? ORDER BY hit_count DESC LIMIT ?'),

  countByProject: (db: Database.Database) =>
    db.prepare('SELECT COUNT(*) as count FROM learned_weights WHERE project_id = ?')
}

export const queryPatternQueries = {
  upsert: (db: Database.Database) =>
    db.prepare(
      `INSERT INTO query_patterns (id, project_id, pattern, matched_paths, frequency, last_used_at)
       VALUES (?, ?, ?, ?, 1, unixepoch() * 1000)
       ON CONFLICT(id) DO UPDATE SET
         frequency = query_patterns.frequency + 1,
         last_used_at = unixepoch() * 1000`
    ),

  getByProject: (db: Database.Database) =>
    db.prepare('SELECT * FROM query_patterns WHERE project_id = ? ORDER BY frequency DESC LIMIT ?'),

  getFrequent: (db: Database.Database) =>
    db.prepare('SELECT * FROM query_patterns WHERE project_id = ? AND frequency >= ? ORDER BY frequency DESC LIMIT ?')
}

export const promptVariantQueries = {
  insert: (db: Database.Database) =>
    db.prepare(
      'INSERT INTO prompt_variants (id, project_id, variant_name, template, few_shot_examples, score) VALUES (?, ?, ?, ?, ?, ?)'
    ),

  getByProject: (db: Database.Database) =>
    db.prepare('SELECT * FROM prompt_variants WHERE project_id = ? ORDER BY score DESC LIMIT ?'),

  getBest: (db: Database.Database) =>
    db.prepare('SELECT * FROM prompt_variants WHERE project_id = ? ORDER BY score DESC LIMIT 1'),

  updateScore: (db: Database.Database) =>
    db.prepare(
      'UPDATE prompt_variants SET score = ?, usage_count = usage_count + 1, updated_at = unixepoch() * 1000 WHERE id = ?'
    )
}

export const learningMetricsQueries = {
  insert: (db: Database.Database) =>
    db.prepare(
      'INSERT INTO learning_metrics (id, project_id, metric_type, value, details) VALUES (?, ?, ?, ?, ?)'
    ),

  getByProject: (db: Database.Database) =>
    db.prepare('SELECT * FROM learning_metrics WHERE project_id = ? ORDER BY created_at DESC LIMIT ?'),

  getByType: (db: Database.Database) =>
    db.prepare('SELECT * FROM learning_metrics WHERE project_id = ? AND metric_type = ? ORDER BY created_at DESC LIMIT ?'),

  getLatest: (db: Database.Database) =>
    db.prepare('SELECT * FROM learning_metrics WHERE project_id = ? AND metric_type = ? ORDER BY created_at DESC LIMIT 1')
}

export const atlassianConfigQueries = {
  getByProject: (db: Database.Database) =>
    db.prepare('SELECT * FROM project_atlassian_configs WHERE project_id = ?'),

  upsert: (db: Database.Database) =>
    db.prepare(
      `INSERT INTO project_atlassian_configs (id, project_id, site_url, email, api_token_encrypted, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id) DO UPDATE SET
         site_url = excluded.site_url,
         email = excluded.email,
         api_token_encrypted = excluded.api_token_encrypted,
         updated_at = excluded.updated_at`
    ),

  deleteByProject: (db: Database.Database) =>
    db.prepare('DELETE FROM project_atlassian_configs WHERE project_id = ?')
}
