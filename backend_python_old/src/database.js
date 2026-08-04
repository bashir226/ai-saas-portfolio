import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

function parseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function mapWorkflow(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    description: row.description,
    status: row.status,
    version: row.version,
    nodes: parseJson(row.nodes_json, []),
    edges: parseJson(row.edges_json, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapExecution(row) {
  if (!row) return null;
  return {
    id: row.id,
    workflowId: row.workflow_id,
    status: row.status,
    input: parseJson(row.input_json, {}),
    output: parseJson(row.output_json, null),
    steps: parseJson(row.steps_json, []),
    usage: parseJson(row.usage_json, { inputTokens: 0, outputTokens: 0 }),
    error: row.error,
    startedAt: row.started_at,
    completedAt: row.completed_at
  };
}

export function createDatabase(databaseUrl) {
  const db = new DatabaseSync(databaseUrl);
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS workflows (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft',
      version INTEGER NOT NULL DEFAULT 1,
      nodes_json TEXT NOT NULL,
      edges_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS workflows_user_updated_idx ON workflows(user_id, updated_at DESC);
    CREATE TABLE IF NOT EXISTS executions (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      input_json TEXT NOT NULL,
      output_json TEXT,
      steps_json TEXT NOT NULL,
      usage_json TEXT NOT NULL,
      error TEXT,
      started_at TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS executions_workflow_started_idx ON executions(workflow_id, started_at DESC);
  `);

  const statements = {
    insertUser: db.prepare('INSERT INTO users (id, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)'),
    userByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
    userById: db.prepare('SELECT * FROM users WHERE id = ?'),
    insertWorkflow: db.prepare(`INSERT INTO workflows
      (id, user_id, name, description, status, version, nodes_json, edges_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    workflowsByUser: db.prepare('SELECT * FROM workflows WHERE user_id = ? ORDER BY updated_at DESC'),
    workflowById: db.prepare('SELECT * FROM workflows WHERE id = ? AND user_id = ?'),
    updateWorkflow: db.prepare(`UPDATE workflows SET name = ?, description = ?, status = ?, version = version + 1,
      nodes_json = ?, edges_json = ?, updated_at = ? WHERE id = ? AND user_id = ?`),
    deleteWorkflow: db.prepare('DELETE FROM workflows WHERE id = ? AND user_id = ?'),
    insertExecution: db.prepare(`INSERT INTO executions
      (id, workflow_id, status, input_json, output_json, steps_json, usage_json, error, started_at, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    executionsByWorkflow: db.prepare('SELECT * FROM executions WHERE workflow_id = ? ORDER BY started_at DESC LIMIT 50')
  };

  return {
    createUser({ name, email, passwordHash }) {
      const user = { id: randomUUID(), name, email: email.toLowerCase(), createdAt: new Date().toISOString() };
      statements.insertUser.run(user.id, user.name, user.email, passwordHash, user.createdAt);
      return user;
    },
    findUserByEmail(email) {
      const row = statements.userByEmail.get(email.toLowerCase());
      return row ? { id: row.id, name: row.name, email: row.email, passwordHash: row.password_hash, createdAt: row.created_at } : null;
    },
    findUserById(id) {
      const row = statements.userById.get(id);
      return row ? { id: row.id, name: row.name, email: row.email, createdAt: row.created_at } : null;
    },
    createWorkflow(userId, data) {
      const now = new Date().toISOString();
      const workflow = {
        id: randomUUID(), userId, name: data.name, description: data.description ?? '', status: data.status ?? 'draft',
        version: 1, nodes: data.nodes, edges: data.edges, createdAt: now, updatedAt: now
      };
      statements.insertWorkflow.run(workflow.id, userId, workflow.name, workflow.description, workflow.status,
        workflow.version, JSON.stringify(workflow.nodes), JSON.stringify(workflow.edges), now, now);
      return workflow;
    },
    listWorkflows(userId) {
      return statements.workflowsByUser.all(userId).map(mapWorkflow);
    },
    findWorkflow(id, userId) {
      return mapWorkflow(statements.workflowById.get(id, userId));
    },
    updateWorkflow(id, userId, data) {
      statements.updateWorkflow.run(data.name, data.description ?? '', data.status ?? 'draft', JSON.stringify(data.nodes),
        JSON.stringify(data.edges), new Date().toISOString(), id, userId);
      return this.findWorkflow(id, userId);
    },
    deleteWorkflow(id, userId) {
      return statements.deleteWorkflow.run(id, userId).changes > 0;
    },
    createExecution(workflowId, input, result, startedAt) {
      const execution = {
        id: randomUUID(), workflowId, status: result.status, input, output: result.output, steps: result.steps,
        usage: result.usage, error: result.error ?? null, startedAt, completedAt: new Date().toISOString()
      };
      statements.insertExecution.run(execution.id, workflowId, execution.status, JSON.stringify(input),
        JSON.stringify(execution.output), JSON.stringify(execution.steps), JSON.stringify(execution.usage),
        execution.error, startedAt, execution.completedAt);
      return execution;
    },
    listExecutions(workflowId) {
      return statements.executionsByWorkflow.all(workflowId).map(mapExecution);
    },
    close() {
      db.close();
    }
  };
}
