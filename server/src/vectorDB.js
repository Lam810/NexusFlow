import { createClient } from '@libsql/client';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS workflows (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    nodes TEXT NOT NULL,
    edges TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    filename TEXT,
    original_text TEXT,
    chunk_index INTEGER,
    chunk_text TEXT,
    embedding TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    file_size INTEGER,
    file_type TEXT,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    filename TEXT,
    original_text TEXT,
    file_size INTEGER,
    file_type TEXT,
    chunk_count INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS chat_history (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    workflow_id TEXT NOT NULL,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    embedding TEXT,
    timestamp INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS dynamics_data (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    embedding TEXT,
    metadata TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS user_model_configs (
    user_id TEXT PRIMARY KEY,
    base_url TEXT NOT NULL,
    model TEXT NOT NULL,
    embedding_model TEXT,
    api_key_encrypted TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS runtime_devices (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    token_hash TEXT UNIQUE NOT NULL,
    capabilities TEXT NOT NULL DEFAULT '{}',
    last_seen_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    revoked_at DATETIME,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS workflow_runs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    workflow_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    status TEXT NOT NULL,
    trigger_source TEXT NOT NULL DEFAULT 'manual',
    input_data TEXT,
    output_data TEXT,
    error TEXT,
    workflow_snapshot TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    claimed_at DATETIME,
    started_at DATETIME,
    completed_at DATETIME,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    FOREIGN KEY (device_id) REFERENCES runtime_devices (id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS workflow_run_steps (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    node_id TEXT NOT NULL,
    node_type TEXT NOT NULL,
    node_label TEXT NOT NULL,
    status TEXT NOT NULL,
    input_data TEXT,
    output_data TEXT,
    error TEXT,
    started_at DATETIME,
    completed_at DATETIME,
    duration_ms INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (run_id) REFERENCES workflow_runs (id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS runtime_permission_requests (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    node_id TEXT NOT NULL,
    capability TEXT NOT NULL,
    action_label TEXT NOT NULL,
    context_data TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    decision TEXT,
    requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    resolved_at DATETIME,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    FOREIGN KEY (run_id) REFERENCES workflow_runs (id) ON DELETE CASCADE,
    FOREIGN KEY (device_id) REFERENCES runtime_devices (id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS runtime_permission_grants (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    capability TEXT NOT NULL,
    action_label TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    revoked_at DATETIME,
    UNIQUE (user_id, device_id, capability),
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    FOREIGN KEY (device_id) REFERENCES runtime_devices (id) ON DELETE CASCADE
  )`,
];

const INDEX_STATEMENTS = [
  'CREATE INDEX IF NOT EXISTS idx_documents_user_file ON documents(user_id, filename)',
  'CREATE INDEX IF NOT EXISTS idx_documents_user_created ON documents(user_id, created_at)',
  'CREATE INDEX IF NOT EXISTS idx_files_user_created ON files(user_id, created_at)',
  'CREATE INDEX IF NOT EXISTS idx_chat_history_user_workflow ON chat_history(user_id, workflow_id)',
  'CREATE INDEX IF NOT EXISTS idx_chat_history_timestamp ON chat_history(timestamp)',
  'CREATE INDEX IF NOT EXISTS idx_dynamics_data_user_created ON dynamics_data(user_id, created_at)',
  'CREATE INDEX IF NOT EXISTS idx_dynamics_data_user_title ON dynamics_data(user_id, title)',
  'CREATE INDEX IF NOT EXISTS idx_runtime_devices_user_created ON runtime_devices(user_id, created_at)',
  'CREATE INDEX IF NOT EXISTS idx_workflow_runs_user_created ON workflow_runs(user_id, created_at)',
  'CREATE INDEX IF NOT EXISTS idx_workflow_runs_device_status ON workflow_runs(device_id, status, created_at)',
  'CREATE INDEX IF NOT EXISTS idx_workflow_run_steps_run_sequence ON workflow_run_steps(run_id, sequence)',
  'CREATE INDEX IF NOT EXISTS idx_permission_requests_user_status ON runtime_permission_requests(user_id, status, requested_at)',
  'CREATE INDEX IF NOT EXISTS idx_permission_requests_device_run ON runtime_permission_requests(device_id, run_id, requested_at)',
  'CREATE INDEX IF NOT EXISTS idx_permission_grants_user_device ON runtime_permission_grants(user_id, device_id, revoked_at)',
];

function resolveDatabaseUrl(value) {
  const source = String(value || 'vector_knowledge.db').trim();
  if (/^(?:file:|libsql:|https?:|:memory:)/i.test(source)) return source;
  return `file:${path.resolve(source).replaceAll('\\', '/')}`;
}

function parseJson(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  return JSON.parse(String(value));
}

function normalizeRow(row) {
  return Object.fromEntries(Object.entries(row));
}

function parseRuntimeDevice(row) {
  if (!row) return null;
  return { ...row, capabilities: parseJson(row.capabilities, {}) };
}

function parseWorkflowRun(row, includeSnapshot = false) {
  if (!row) return null;
  const result = {
    ...row,
    input: parseJson(row.input_data),
    output: parseJson(row.output_data),
  };
  delete result.input_data;
  delete result.output_data;
  if (includeSnapshot) result.workflow_snapshot = parseJson(row.workflow_snapshot, {});
  else delete result.workflow_snapshot;
  return result;
}

function parseWorkflowRunStep(row) {
  if (!row) return null;
  const result = {
    ...row,
    input: parseJson(row.input_data),
    output: parseJson(row.output_data),
  };
  delete result.input_data;
  delete result.output_data;
  return result;
}

function parsePermissionRequest(row) {
  if (!row) return null;
  const result = { ...row, context: parseJson(row.context_data, {}) };
  delete result.context_data;
  return result;
}

class VectorDB {
  constructor(database = process.env.TURSO_DATABASE_URL || process.env.DATABASE_PATH || 'vector_knowledge.db') {
    const config = typeof database === 'object' && database !== null ? database : { url: database };
    this.databaseUrl = resolveDatabaseUrl(config.url);
    this.isRemote = /^(?:libsql:|https?:)/i.test(this.databaseUrl);
    const authToken = config.authToken || process.env.TURSO_AUTH_TOKEN;
    if (this.isRemote && !authToken) throw new Error('TURSO_AUTH_TOKEN is required for a remote database.');
    this.db = config.client || createClient({
      url: this.databaseUrl,
      ...(authToken ? { authToken } : {}),
    });
    this.ready = this.init();
  }

  async init() {
    await this.db.batch(SCHEMA_STATEMENTS, 'write');
    await this.ensureColumn('documents', 'user_id', 'TEXT', false);
    await this.ensureColumn('files', 'user_id', 'TEXT', false);
    await this.ensureColumn('chat_history', 'user_id', 'TEXT', false);
    await this.ensureColumn('dynamics_data', 'user_id', 'TEXT', false);
    await this.db.batch(INDEX_STATEMENTS, 'write');
  }

  async ensureColumn(tableName, columnName, definition, waitForReady = true) {
    if (waitForReady) await this.ready;
    const columns = (await this.db.execute(`PRAGMA table_info(${tableName})`)).rows;
    if (columns.some(column => column.name === columnName)) return;
    try {
      await this.db.execute(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
    } catch (error) {
      if (!/duplicate column name/i.test(String(error?.message || error))) throw error;
    }
  }

  async execute(sql, args = []) {
    await this.ready;
    return this.db.execute({ sql, args });
  }

  async all(sql, args = []) {
    const result = await this.execute(sql, args);
    return result.rows.map(normalizeRow);
  }

  async get(sql, args = []) {
    const rows = await this.all(sql, args);
    return rows[0];
  }

  async run(sql, args = []) {
    const result = await this.execute(sql, args);
    return Number(result.rowsAffected || 0);
  }

  async insertDocument(userId, doc) {
    await this.run(
      `INSERT INTO documents (id, user_id, filename, original_text, chunk_index, chunk_text, embedding, file_size, file_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [doc.id, userId, doc.filename || 'unknown', doc.original_text || '', doc.chunk_index || 0,
        doc.chunk_text, JSON.stringify(doc.embedding), doc.file_size || 0, doc.file_type || 'txt']
    );
  }

  async insertFile(userId, fileInfo) {
    await this.run(
      `INSERT INTO files (id, user_id, filename, original_text, file_size, file_type, chunk_count)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [fileInfo.id, userId, fileInfo.filename, fileInfo.original_text, fileInfo.file_size,
        fileInfo.file_type, fileInfo.chunk_count]
    );
  }

  async getAllDocuments(userId) {
    return this.all(
      `SELECT id, filename, chunk_index, chunk_text, file_size, file_type, created_at
       FROM documents WHERE user_id = ? ORDER BY created_at DESC`,
      [userId]
    );
  }

  async getAllFiles(userId) {
    return this.all(
      `SELECT id, filename, file_size, file_type, chunk_count, created_at
       FROM files WHERE user_id = ? ORDER BY created_at DESC`,
      [userId]
    );
  }

  async getDocumentsByFilename(userId, filename) {
    return this.all(
      `SELECT id, filename, chunk_index, chunk_text, file_size, file_type, created_at
       FROM documents WHERE user_id = ? AND filename = ? ORDER BY chunk_index`,
      [userId, filename]
    );
  }

  async getDocumentEmbedding(userId, id) {
    const result = await this.get('SELECT embedding FROM documents WHERE user_id = ? AND id = ?', [userId, id]);
    return result ? parseJson(result.embedding) : null;
  }

  async getAllEmbeddings(userId) {
    const results = await this.all('SELECT id, chunk_text, embedding FROM documents WHERE user_id = ?', [userId]);
    return results.map(row => ({ id: row.id, text: row.chunk_text, embedding: parseJson(row.embedding, []) }));
  }

  async deleteFile(userId, filename) {
    await this.ready;
    const [documents, file] = await this.db.batch([
      { sql: 'DELETE FROM documents WHERE user_id = ? AND filename = ?', args: [userId, filename] },
      { sql: 'DELETE FROM files WHERE user_id = ? AND filename = ?', args: [userId, filename] },
    ], 'write');
    return { docsDeleted: Number(documents.rowsAffected), fileDeleted: Number(file.rowsAffected) };
  }

  async getStats(userId) {
    const [documents, files, size] = await Promise.all([
      this.get('SELECT COUNT(*) AS count FROM documents WHERE user_id = ?', [userId]),
      this.get('SELECT COUNT(*) AS count FROM files WHERE user_id = ?', [userId]),
      this.get('SELECT SUM(file_size) AS size FROM files WHERE user_id = ?', [userId]),
    ]);
    return {
      totalDocuments: Number(documents?.count || 0),
      totalFiles: Number(files?.count || 0),
      totalSize: Number(size?.size || 0),
    };
  }

  async searchSimilar(userId, queryEmbedding, topK = 5) {
    const documents = await this.getAllEmbeddings(userId);
    return documents
      .map(doc => ({ id: doc.id, text: doc.text, similarity: this.cosineSimilarity(queryEmbedding, doc.embedding) }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK);
  }

  cosineSimilarity(a, b) {
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < a.length && i < b.length; i += 1) {
      dot += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-8);
  }

  async createUser(username, email, passwordHash) {
    const id = `user_${randomUUID()}`;
    try {
      await this.run('INSERT INTO users (id, username, email, password_hash) VALUES (?, ?, ?, ?)', [id, username, email, passwordHash]);
      return { id, username, email };
    } catch (error) {
      if (error?.code === 'SQLITE_CONSTRAINT_UNIQUE' || /unique constraint/i.test(String(error?.message || error))) {
        throw new Error('用户名或邮箱已存在');
      }
      throw error;
    }
  }

  async getUserByUsername(username) {
    return this.get('SELECT * FROM users WHERE username = ?', [username]);
  }

  async getUserByEmail(email) {
    return this.get('SELECT * FROM users WHERE email = ?', [email]);
  }

  async getUserById(id) {
    return this.get('SELECT * FROM users WHERE id = ?', [id]);
  }

  async getUserModelConfig(userId) {
    return this.get(
      `SELECT user_id, base_url, model, embedding_model, api_key_encrypted, created_at, updated_at
       FROM user_model_configs WHERE user_id = ?`,
      [userId]
    );
  }

  async upsertUserModelConfig(userId, config) {
    await this.run(
      `INSERT INTO user_model_configs (user_id, base_url, model, embedding_model, api_key_encrypted)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         base_url = excluded.base_url,
         model = excluded.model,
         embedding_model = excluded.embedding_model,
         api_key_encrypted = excluded.api_key_encrypted,
         updated_at = CURRENT_TIMESTAMP`,
      [userId, config.baseUrl, config.model, config.embeddingModel || null, config.apiKeyEncrypted]
    );
    return this.getUserModelConfig(userId);
  }

  async deleteUserModelConfig(userId) {
    return (await this.run('DELETE FROM user_model_configs WHERE user_id = ?', [userId])) > 0;
  }

  async createWorkflow(userId, workflowId, name, nodes, edges) {
    await this.run('INSERT INTO workflows (id, user_id, name, nodes, edges) VALUES (?, ?, ?, ?, ?)', [workflowId, userId, name, JSON.stringify(nodes), JSON.stringify(edges)]);
    return { id: workflowId, name, nodes, edges };
  }

  async updateWorkflow(userId, workflowId, name, nodes, edges) {
    const changes = await this.run(
      `UPDATE workflows SET name = ?, nodes = ?, edges = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ?`,
      [name, JSON.stringify(nodes), JSON.stringify(edges), workflowId, userId]
    );
    return changes === 0 ? null : { id: workflowId, name, nodes, edges };
  }

  async getWorkflows(userId) {
    const workflows = await this.all(
      `SELECT id, name, nodes, edges, created_at, updated_at
       FROM workflows WHERE user_id = ? ORDER BY updated_at DESC`,
      [userId]
    );
    return workflows.map(workflow => ({
      ...workflow,
      nodes: parseJson(workflow.nodes, []),
      edges: parseJson(workflow.edges, []),
    }));
  }

  async getWorkflow(userId, workflowId) {
    const workflow = await this.get(
      `SELECT id, name, nodes, edges, created_at, updated_at
       FROM workflows WHERE id = ? AND user_id = ?`,
      [workflowId, userId]
    );
    return workflow ? {
      ...workflow,
      nodes: parseJson(workflow.nodes, []),
      edges: parseJson(workflow.edges, []),
    } : null;
  }

  async deleteWorkflow(userId, workflowId) {
    return (await this.run('DELETE FROM workflows WHERE id = ? AND user_id = ?', [workflowId, userId])) > 0;
  }

  async createRuntimeDevice(userId, { id, name, tokenHash, capabilities = {} }) {
    await this.run(
      `INSERT INTO runtime_devices (id, user_id, name, token_hash, capabilities)
       VALUES (?, ?, ?, ?, ?)`,
      [id, userId, name, tokenHash, JSON.stringify(capabilities)]
    );
    return this.getRuntimeDevice(userId, id);
  }

  async getRuntimeDevices(userId) {
    const rows = await this.all(
      `SELECT id, user_id, name, capabilities, last_seen_at, created_at, revoked_at
       FROM runtime_devices WHERE user_id = ? ORDER BY created_at DESC`,
      [userId]
    );
    return rows.map(parseRuntimeDevice);
  }

  async getRuntimeDevice(userId, deviceId) {
    return parseRuntimeDevice(await this.get(
      `SELECT id, user_id, name, capabilities, last_seen_at, created_at, revoked_at
       FROM runtime_devices WHERE id = ? AND user_id = ?`,
      [deviceId, userId]
    ));
  }

  async getRuntimeDeviceByTokenHash(tokenHash) {
    return parseRuntimeDevice(await this.get(
      `SELECT id, user_id, name, capabilities, last_seen_at, created_at, revoked_at
       FROM runtime_devices WHERE token_hash = ? AND revoked_at IS NULL`,
      [tokenHash]
    ));
  }

  async touchRuntimeDevice(deviceId, capabilities) {
    const hasCapabilities = capabilities && typeof capabilities === 'object' && !Array.isArray(capabilities);
    await this.run(
      `UPDATE runtime_devices
       SET last_seen_at = CURRENT_TIMESTAMP${hasCapabilities ? ', capabilities = ?' : ''}
       WHERE id = ? AND revoked_at IS NULL`,
      hasCapabilities ? [JSON.stringify(capabilities), deviceId] : [deviceId]
    );
  }

  async revokeRuntimeDevice(userId, deviceId) {
    await this.ready;
    const [device] = await this.db.batch([
      {
        sql: `UPDATE runtime_devices SET revoked_at = CURRENT_TIMESTAMP
              WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
        args: [deviceId, userId],
      },
      {
        sql: `UPDATE workflow_runs SET status = 'cancelled', completed_at = CURRENT_TIMESTAMP
              WHERE device_id = ? AND user_id = ? AND status IN ('queued', 'claimed', 'running')`,
        args: [deviceId, userId],
      },
      {
        sql: `UPDATE runtime_permission_requests
              SET status = 'expired', decision = 'device_revoked', resolved_at = CURRENT_TIMESTAMP
              WHERE device_id = ? AND user_id = ? AND status IN ('pending', 'allowed')`,
        args: [deviceId, userId],
      },
      {
        sql: `UPDATE runtime_permission_grants SET revoked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
              WHERE device_id = ? AND user_id = ? AND revoked_at IS NULL`,
        args: [deviceId, userId],
      },
    ], 'write');
    return Number(device.rowsAffected || 0) > 0;
  }

  async createWorkflowRun(userId, { id, workflowId, deviceId, triggerSource = 'manual', input, workflowSnapshot }) {
    await this.run(
      `INSERT INTO workflow_runs
       (id, user_id, workflow_id, device_id, status, trigger_source, input_data, workflow_snapshot)
       VALUES (?, ?, ?, ?, 'queued', ?, ?, ?)`,
      [id, userId, workflowId, deviceId, triggerSource, JSON.stringify(input ?? null), JSON.stringify(workflowSnapshot)]
    );
    return this.getWorkflowRun(userId, id);
  }

  async getWorkflowRuns(userId, limit = 50) {
    const rows = await this.all(
      `SELECT r.*, d.name AS device_name, COALESCE(w.name, json_extract(r.workflow_snapshot, '$.name')) AS workflow_name
       FROM workflow_runs r
       LEFT JOIN runtime_devices d ON d.id = r.device_id
       LEFT JOIN workflows w ON w.id = r.workflow_id AND w.user_id = r.user_id
       WHERE r.user_id = ? ORDER BY r.created_at DESC LIMIT ?`,
      [userId, limit]
    );
    return rows.map(row => parseWorkflowRun(row, false));
  }

  async getWorkflowRun(userId, runId, includeSnapshot = true) {
    const row = await this.get(
      `SELECT r.*, d.name AS device_name, COALESCE(w.name, json_extract(r.workflow_snapshot, '$.name')) AS workflow_name
       FROM workflow_runs r
       LEFT JOIN runtime_devices d ON d.id = r.device_id
       LEFT JOIN workflows w ON w.id = r.workflow_id AND w.user_id = r.user_id
       WHERE r.id = ? AND r.user_id = ?`,
      [runId, userId]
    );
    return parseWorkflowRun(row, includeSnapshot);
  }

  async getWorkflowRunWithSteps(userId, runId) {
    const run = await this.getWorkflowRun(userId, runId, true);
    if (!run) return null;
    const steps = await this.all(
      `SELECT id, run_id, sequence, node_id, node_type, node_label, status,
              input_data, output_data, error, started_at, completed_at, duration_ms, created_at
       FROM workflow_run_steps WHERE run_id = ? AND user_id = ? ORDER BY sequence ASC`,
      [runId, userId]
    );
    return { ...run, steps: steps.map(parseWorkflowRunStep) };
  }

  async cancelWorkflowRun(userId, runId) {
    await this.ready;
    const [run] = await this.db.batch([
      {
        sql: `UPDATE workflow_runs SET status = 'cancelled', completed_at = CURRENT_TIMESTAMP
              WHERE id = ? AND user_id = ? AND status IN ('queued', 'claimed', 'running')`,
        args: [runId, userId],
      },
      {
        sql: `UPDATE runtime_permission_requests
              SET status = 'expired', decision = 'run_cancelled', resolved_at = CURRENT_TIMESTAMP
              WHERE run_id = ? AND user_id = ? AND status IN ('pending', 'allowed')
                AND EXISTS (
                  SELECT 1 FROM workflow_runs
                  WHERE id = ? AND user_id = ? AND status = 'cancelled'
                )`,
        args: [runId, userId, runId, userId],
      },
    ], 'write');
    return Number(run.rowsAffected || 0) > 0;
  }

  async claimWorkflowRun(device) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const candidate = await this.get(
        `SELECT id FROM workflow_runs
         WHERE device_id = ? AND user_id = ? AND status = 'queued'
         ORDER BY created_at ASC LIMIT 1`,
        [device.id, device.user_id]
      );
      if (!candidate) return null;
      const claimed = await this.run(
        `UPDATE workflow_runs SET status = 'claimed', claimed_at = CURRENT_TIMESTAMP
         WHERE id = ? AND device_id = ? AND user_id = ? AND status = 'queued'`,
        [candidate.id, device.id, device.user_id]
      );
      if (claimed > 0) return this.getWorkflowRun(device.user_id, candidate.id, true);
    }
    return null;
  }

  async startWorkflowRun(device, runId) {
    const changed = await this.run(
      `UPDATE workflow_runs SET status = 'running', started_at = COALESCE(started_at, CURRENT_TIMESTAMP)
       WHERE id = ? AND device_id = ? AND user_id = ? AND status = 'claimed'`,
      [runId, device.id, device.user_id]
    );
    if (changed > 0) return this.getWorkflowRun(device.user_id, runId, true);
    const current = await this.getWorkflowRun(device.user_id, runId, true);
    return current?.device_id === device.id && current.status === 'running' ? current : null;
  }

  async addWorkflowRunStep(device, runId, step) {
    const run = await this.get(
      `SELECT id FROM workflow_runs
       WHERE id = ? AND device_id = ? AND user_id = ? AND status = 'running'`,
      [runId, device.id, device.user_id]
    );
    if (!run) return null;
    const sequenceRow = await this.get(
      'SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence FROM workflow_run_steps WHERE run_id = ?',
      [runId]
    );
    const id = `step_${randomUUID()}`;
    const sequence = Number(sequenceRow?.next_sequence || 1);
    await this.run(
      `INSERT INTO workflow_run_steps
       (id, run_id, user_id, sequence, node_id, node_type, node_label, status,
        input_data, output_data, error, started_at, completed_at, duration_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, runId, device.user_id, sequence, step.nodeId, step.nodeType, step.nodeLabel, step.status,
        JSON.stringify(step.input ?? null), JSON.stringify(step.output ?? null), step.error || null,
        step.startedAt || null, step.completedAt || null, step.durationMs ?? null]
    );
    return parseWorkflowRunStep(await this.get('SELECT * FROM workflow_run_steps WHERE id = ?', [id]));
  }

  async completeWorkflowRun(device, runId, { status, output, error }) {
    const changed = await this.run(
      `UPDATE workflow_runs
       SET status = ?, output_data = ?, error = ?, completed_at = CURRENT_TIMESTAMP
       WHERE id = ? AND device_id = ? AND user_id = ? AND status IN ('claimed', 'running')`,
      [status, JSON.stringify(output ?? null), error || null, runId, device.id, device.user_id]
    );
    return changed > 0 ? this.getWorkflowRun(device.user_id, runId, true) : null;
  }

  async getRuntimePermissionRequests(userId, limit = 100) {
    const rows = await this.all(
      `SELECT p.*, d.name AS device_name,
              COALESCE(w.name, json_extract(r.workflow_snapshot, '$.name')) AS workflow_name
       FROM runtime_permission_requests p
       JOIN workflow_runs r ON r.id = p.run_id AND r.user_id = p.user_id
       LEFT JOIN runtime_devices d ON d.id = p.device_id
       LEFT JOIN workflows w ON w.id = r.workflow_id AND w.user_id = p.user_id
       WHERE p.user_id = ?
       ORDER BY CASE WHEN p.status = 'pending' THEN 0 ELSE 1 END, p.requested_at DESC
       LIMIT ?`,
      [userId, limit]
    );
    return rows.map(parsePermissionRequest);
  }

  async getRuntimePermissionGrants(userId) {
    return this.all(
      `SELECT g.id, g.user_id, g.device_id, g.capability, g.action_label,
              g.created_at, g.updated_at, g.revoked_at, d.name AS device_name
       FROM runtime_permission_grants g
       LEFT JOIN runtime_devices d ON d.id = g.device_id
       WHERE g.user_id = ? AND g.revoked_at IS NULL
       ORDER BY g.updated_at DESC`,
      [userId]
    );
  }

  async getActiveRuntimePermissionGrant(device, capability) {
    return this.get(
      `SELECT id, user_id, device_id, capability, action_label, created_at, updated_at
       FROM runtime_permission_grants
       WHERE user_id = ? AND device_id = ? AND capability = ? AND revoked_at IS NULL`,
      [device.user_id, device.id, capability]
    );
  }

  async requestRuntimePermission(device, { runId, nodeId, capability, actionLabel, context }) {
    const run = await this.get(
      `SELECT id FROM workflow_runs
       WHERE id = ? AND user_id = ? AND device_id = ? AND status = 'running'`,
      [runId, device.user_id, device.id]
    );
    if (!run) return null;
    const existing = await this.get(
      `SELECT * FROM runtime_permission_requests
       WHERE user_id = ? AND device_id = ? AND run_id = ? AND node_id = ? AND capability = ?
         AND status IN ('pending', 'allowed')
       ORDER BY requested_at DESC LIMIT 1`,
      [device.user_id, device.id, runId, nodeId, capability]
    );
    if (existing) return parsePermissionRequest(existing);

    const grant = await this.getActiveRuntimePermissionGrant(device, capability);
    const id = `permission_${randomUUID()}`;
    await this.run(
      `INSERT INTO runtime_permission_requests
       (id, user_id, run_id, device_id, node_id, capability, action_label, context_data,
        status, decision, resolved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, device.user_id, runId, device.id, nodeId, capability, actionLabel,
        JSON.stringify(context || {}), grant ? 'allowed' : 'pending', grant ? 'existing_grant' : null,
        grant ? new Date().toISOString() : null]
    );
    return parsePermissionRequest(await this.get('SELECT * FROM runtime_permission_requests WHERE id = ?', [id]));
  }

  async getRuntimePermissionRequestForDevice(device, requestId) {
    return parsePermissionRequest(await this.get(
      `SELECT * FROM runtime_permission_requests
       WHERE id = ? AND user_id = ? AND device_id = ?`,
      [requestId, device.user_id, device.id]
    ));
  }

  async resolveRuntimePermissionRequest(userId, requestId, decision) {
    const request = await this.get(
      `SELECT * FROM runtime_permission_requests WHERE id = ? AND user_id = ? AND status = 'pending'`,
      [requestId, userId]
    );
    if (!request) return null;
    const status = decision === 'deny' ? 'denied' : 'allowed';
    const changed = await this.run(
      `UPDATE runtime_permission_requests
       SET status = ?, decision = ?, resolved_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ? AND status = 'pending'
         AND (? = 'deny' OR EXISTS (
           SELECT 1 FROM workflow_runs
           WHERE id = runtime_permission_requests.run_id AND user_id = ? AND status = 'running'
         ))`,
      [status, decision, requestId, userId, decision, userId]
    );
    if (changed === 0) return null;
    if (decision === 'allow_always') {
      await this.run(
        `INSERT INTO runtime_permission_grants
         (id, user_id, device_id, capability, action_label)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(user_id, device_id, capability) DO UPDATE SET
           action_label = excluded.action_label,
           updated_at = CURRENT_TIMESTAMP,
           revoked_at = NULL`,
        [`grant_${randomUUID()}`, userId, request.device_id, request.capability, request.action_label]
      );
    }
    return parsePermissionRequest(await this.get('SELECT * FROM runtime_permission_requests WHERE id = ?', [requestId]));
  }

  async expireRuntimePermissionRequest(device, requestId) {
    return (await this.run(
      `UPDATE runtime_permission_requests
       SET status = 'expired', decision = 'runtime_timeout', resolved_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ? AND device_id = ? AND status = 'pending'`,
      [requestId, device.user_id, device.id]
    )) > 0;
  }

  async revokeRuntimePermissionGrant(userId, grantId) {
    return (await this.run(
      `UPDATE runtime_permission_grants SET revoked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
      [grantId, userId]
    )) > 0;
  }

  async sanitizeStoredWorkflows(sanitizer) {
    const rows = await this.all('SELECT id, nodes FROM workflows');
    const updates = [];
    for (const row of rows) {
      try {
        const sanitized = JSON.stringify(sanitizer(parseJson(row.nodes, [])));
        if (sanitized !== row.nodes) {
          updates.push({ sql: 'UPDATE workflows SET nodes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', args: [sanitized, row.id] });
        }
      } catch {
        // Invalid legacy rows remain readable for manual recovery.
      }
    }
    if (updates.length > 0) await this.db.batch(updates, 'write');
    return updates.length;
  }

  async addDynamicData(userId, title, content, embedding, metadata = null) {
    const id = `dynamic_${randomUUID()}`;
    await this.run(
      `INSERT INTO dynamics_data (id, user_id, title, content, embedding, metadata) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, userId, title, content, embedding ? JSON.stringify(embedding) : null, metadata ? JSON.stringify(metadata) : null]
    );
    return { id, title, content, metadata };
  }

  async batchAddDynamicData(userId, items, embeddingFunc) {
    const results = [];
    const errors = [];
    for (const item of items) {
      try {
        const embedding = embeddingFunc ? item.embedding || null : null;
        results.push(await this.addDynamicData(userId, item.title, item.content, embedding, item.metadata));
      } catch (error) {
        errors.push({ item, error: error.message });
      }
    }
    return { success: results.length, failed: errors.length, results, errors };
  }

  async searchDynamicData(userId, queryEmbedding, topK = 5, threshold = 0.3) {
    const results = await this.all(
      `SELECT id, title, content, embedding, metadata, created_at
       FROM dynamics_data WHERE user_id = ? AND embedding IS NOT NULL ORDER BY created_at DESC`,
      [userId]
    );
    return results
      .map(item => ({
        id: item.id,
        title: item.title,
        content: item.content,
        metadata: parseJson(item.metadata),
        similarity: this.cosineSimilarity(queryEmbedding, parseJson(item.embedding, [])),
        created_at: item.created_at,
      }))
      .filter(item => item.similarity >= threshold)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK);
  }

  async getAllDynamicData(userId, limit = 100) {
    const results = await this.all(
      `SELECT id, title, content, metadata, created_at, updated_at
       FROM dynamics_data WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
      [userId, limit]
    );
    return results.map(row => ({ ...row, metadata: parseJson(row.metadata) }));
  }

  async getDynamicDataById(userId, id) {
    const result = await this.get(
      `SELECT id, title, content, embedding, metadata, created_at, updated_at
       FROM dynamics_data WHERE user_id = ? AND id = ?`,
      [userId, id]
    );
    return result ? { ...result, embedding: parseJson(result.embedding), metadata: parseJson(result.metadata) } : null;
  }

  async updateDynamicData(userId, id, title, content, embedding, metadata) {
    return (await this.run(
      `UPDATE dynamics_data SET title = ?, content = ?, embedding = ?, metadata = ?, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ? AND id = ?`,
      [title, content, embedding ? JSON.stringify(embedding) : null, metadata ? JSON.stringify(metadata) : null, userId, id]
    )) > 0;
  }

  async deleteDynamicData(userId, id) {
    return (await this.run('DELETE FROM dynamics_data WHERE user_id = ? AND id = ?', [userId, id])) > 0;
  }

  async clearAllDynamicData(userId) {
    return this.run('DELETE FROM dynamics_data WHERE user_id = ?', [userId]);
  }

  async getDynamicDataStats(userId) {
    const [total, withEmbedding] = await Promise.all([
      this.get('SELECT COUNT(*) AS count FROM dynamics_data WHERE user_id = ?', [userId]),
      this.get('SELECT COUNT(*) AS count FROM dynamics_data WHERE user_id = ? AND embedding IS NOT NULL', [userId]),
    ]);
    return { total: Number(total?.count || 0), withEmbedding: Number(withEmbedding?.count || 0) };
  }

  async saveChatHistory(userId, workflowId, question, answer, questionEmbedding, timestamp) {
    const id = `chat_${randomUUID()}`;
    const actualTimestamp = timestamp || Date.now();
    await this.run(
      `INSERT INTO chat_history (id, user_id, workflow_id, question, answer, embedding, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, userId, workflowId, question, answer, questionEmbedding ? JSON.stringify(questionEmbedding) : null, actualTimestamp]
    );
    return { id, workflowId, question, answer, timestamp: actualTimestamp };
  }

  async searchChatHistory(userId, queryEmbedding, workflowId, topK = 3) {
    const results = await this.all(
      `SELECT id, question, answer, embedding, timestamp FROM chat_history
       WHERE user_id = ? AND workflow_id = ? AND embedding IS NOT NULL ORDER BY timestamp DESC`,
      [userId, workflowId]
    );
    return results
      .map(chat => ({
        question: chat.question,
        answer: chat.answer,
        timestamp: Number(chat.timestamp),
        similarity: this.cosineSimilarity(queryEmbedding, parseJson(chat.embedding, [])),
      }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK);
  }

  async getChatHistory(userId, workflowId, limit = 50) {
    return this.all(
      `SELECT question, answer, timestamp FROM chat_history
       WHERE user_id = ? AND workflow_id = ? ORDER BY timestamp DESC LIMIT ?`,
      [userId, workflowId, limit]
    );
  }

  async clearChatHistory(userId, workflowId) {
    return this.run('DELETE FROM chat_history WHERE user_id = ? AND workflow_id = ?', [userId, workflowId]);
  }

  async getChatHistoryStats(userId, workflowId) {
    const result = await this.get('SELECT COUNT(*) AS count FROM chat_history WHERE user_id = ? AND workflow_id = ?', [userId, workflowId]);
    return { totalMessages: Number(result?.count || 0) };
  }

  async healthCheck() {
    await this.get('SELECT 1 AS ok');
    return true;
  }

  async close() {
    try {
      await this.ready;
    } finally {
      this.db.close();
    }
  }
}

export default VectorDB;
