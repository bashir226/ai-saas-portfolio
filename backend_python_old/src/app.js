import { createServer } from 'node:http';

import { createAiProvider } from './ai-provider.js';
import { createDatabase } from './database.js';
import { executeWorkflow, validateWorkflow, WorkflowValidationError } from './workflow-engine.js';
import { hashPassword, signToken, verifyPassword, verifyToken } from './security.js';

const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS'
};

function send(response, status, payload) {
  response.writeHead(status, jsonHeaders);
  response.end(JSON.stringify(payload));
}

function apiError(response, status, code, message, details) {
  send(response, status, { error: { code, message, ...(details ? { details } : {}) } });
}

async function readJson(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 1_000_000) throw Object.assign(new Error('Request body is too large.'), { status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('Request body must be valid JSON.'), { status: 400 });
  }
}

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, createdAt: user.createdAt };
}

function validateCredentials(data, includeName = false) {
  if (includeName && (typeof data.name !== 'string' || data.name.trim().length < 2)) {
    return 'Name must contain at least 2 characters.';
  }
  if (typeof data.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
    return 'A valid email address is required.';
  }
  if (typeof data.password !== 'string' || data.password.length < 8) {
    return 'Password must contain at least 8 characters.';
  }
  return null;
}

function validateWorkflowPayload(data) {
  if (typeof data.name !== 'string' || !data.name.trim()) {
    throw new WorkflowValidationError('Workflow name is required.');
  }
  validateWorkflow({ nodes: data.nodes, edges: data.edges });
  return {
    name: data.name.trim().slice(0, 120),
    description: String(data.description ?? '').trim().slice(0, 500),
    status: data.status === 'active' ? 'active' : 'draft',
    nodes: data.nodes,
    edges: data.edges
  };
}

function matchPath(pathname, pattern) {
  const names = [];
  const expression = pattern.replace(/:([A-Za-z]+)/g, (_, name) => {
    names.push(name);
    return '([^/]+)';
  });
  const match = pathname.match(new RegExp(`^${expression}$`));
  return match ? Object.fromEntries(names.map((name, index) => [name, decodeURIComponent(match[index + 1])])) : null;
}

export function createApplication({
  databaseUrl = process.env.DATABASE_URL ?? './flowforge.db',
  jwtSecret = process.env.JWT_SECRET ?? 'development-secret-change-me-before-production',
  aiProvider = createAiProvider()
} = {}) {
  const repository = createDatabase(databaseUrl);

  async function handler(request, response) {
    if (request.method === 'OPTIONS') return send(response, 204, {});

    const url = new URL(request.url, 'http://localhost');
    const { pathname } = url;

    try {
      if (request.method === 'GET' && pathname === '/api/health') {
        return send(response, 200, { status: 'ok', service: 'flowforge-api' });
      }

      if (request.method === 'POST' && pathname === '/api/auth/register') {
        const data = await readJson(request);
        const invalid = validateCredentials(data, true);
        if (invalid) return apiError(response, 400, 'VALIDATION_ERROR', invalid);
        if (repository.findUserByEmail(data.email)) {
          return apiError(response, 409, 'EMAIL_EXISTS', 'An account with this email already exists.');
        }
        const user = repository.createUser({
          name: data.name.trim(),
          email: data.email.trim(),
          passwordHash: hashPassword(data.password)
        });
        const accessToken = signToken({ sub: user.id }, jwtSecret);
        return send(response, 201, { user: publicUser(user), accessToken });
      }

      if (request.method === 'POST' && pathname === '/api/auth/login') {
        const data = await readJson(request);
        const invalid = validateCredentials(data);
        if (invalid) return apiError(response, 400, 'VALIDATION_ERROR', invalid);
        const user = repository.findUserByEmail(data.email);
        if (!user || !verifyPassword(data.password, user.passwordHash)) {
          return apiError(response, 401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
        }
        const accessToken = signToken({ sub: user.id }, jwtSecret);
        return send(response, 200, { user: publicUser(user), accessToken });
      }

      const authorization = request.headers.authorization ?? '';
      const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
      const payload = verifyToken(token, jwtSecret);
      const user = payload ? repository.findUserById(payload.sub) : null;
      if (!user) return apiError(response, 401, 'UNAUTHORIZED', 'Authentication is required.');

      if (request.method === 'GET' && pathname === '/api/me') {
        return send(response, 200, { user: publicUser(user) });
      }

      if (request.method === 'GET' && pathname === '/api/workflows') {
        return send(response, 200, { workflows: repository.listWorkflows(user.id) });
      }

      if (request.method === 'POST' && pathname === '/api/workflows') {
        const data = validateWorkflowPayload(await readJson(request));
        return send(response, 201, { workflow: repository.createWorkflow(user.id, data) });
      }

      const executionListParams = matchPath(pathname, '/api/workflows/:id/executions');
      if (executionListParams && request.method === 'GET') {
        const workflow = repository.findWorkflow(executionListParams.id, user.id);
        if (!workflow) return apiError(response, 404, 'NOT_FOUND', 'Workflow was not found.');
        return send(response, 200, { executions: repository.listExecutions(workflow.id) });
      }

      const runParams = matchPath(pathname, '/api/workflows/:id/run');
      if (runParams && request.method === 'POST') {
        const workflow = repository.findWorkflow(runParams.id, user.id);
        if (!workflow) return apiError(response, 404, 'NOT_FOUND', 'Workflow was not found.');
        const data = await readJson(request);
        const startedAt = new Date().toISOString();
        const result = await executeWorkflow({ workflow, input: data.input ?? {}, provider: aiProvider });
        const execution = repository.createExecution(workflow.id, data.input ?? {}, result, startedAt);
        return send(response, 201, { execution });
      }

      const workflowParams = matchPath(pathname, '/api/workflows/:id');
      if (workflowParams) {
        const workflow = repository.findWorkflow(workflowParams.id, user.id);
        if (!workflow) return apiError(response, 404, 'NOT_FOUND', 'Workflow was not found.');
        if (request.method === 'GET') return send(response, 200, { workflow });
        if (request.method === 'PUT') {
          const data = validateWorkflowPayload(await readJson(request));
          return send(response, 200, { workflow: repository.updateWorkflow(workflow.id, user.id, data) });
        }
        if (request.method === 'DELETE') {
          repository.deleteWorkflow(workflow.id, user.id);
          return send(response, 200, { success: true });
        }
      }

      return apiError(response, 404, 'NOT_FOUND', 'Route was not found.');
    } catch (error) {
      if (error instanceof WorkflowValidationError) {
        return apiError(response, 422, 'INVALID_WORKFLOW', error.message);
      }
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return apiError(response, 409, 'CONFLICT', 'This resource already exists.');
      }
      console.error(error);
      return apiError(response, error.status ?? 500, 'INTERNAL_ERROR', error.status ? error.message : 'Unexpected server error.');
    }
  }

  return {
    listen(...args) {
      return createServer(handler).listen(...args);
    },
    close() {
      repository.close();
    }
  };
}
