import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';

import { createApplication } from '../src/app.js';

async function startTestApp() {
  const application = createApplication({
    databaseUrl: ':memory:',
    jwtSecret: 'test-secret-with-enough-entropy',
    aiProvider: {
      async generate({ prompt }) {
        return { text: `AI result: ${prompt}`, usage: { inputTokens: 5, outputTokens: 7 } };
      }
    }
  });
  const server = application.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  return {
    application,
    server,
    baseUrl: `http://127.0.0.1:${address.port}`
  };
}

async function jsonRequest(baseUrl, path, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const payload = await response.json();
  return { response, payload };
}

const workflowPayload = {
  name: 'Launch content pipeline',
  description: 'Turns a brief into a campaign post',
  nodes: [
    { id: 'trigger', type: 'trigger', name: 'Brief', position: { x: 80, y: 180 }, config: {} },
    {
      id: 'ai-copy',
      type: 'ai',
      name: 'AI copywriter',
      position: { x: 380, y: 180 },
      config: { model: 'gpt-4o-mini', prompt: 'Write about {{trigger.topic}}' }
    },
    { id: 'output', type: 'output', name: 'Result', position: { x: 680, y: 180 }, config: {} }
  ],
  edges: [
    { id: 'e1', source: 'trigger', target: 'ai-copy' },
    { id: 'e2', source: 'ai-copy', target: 'output' }
  ]
};

test('workflow API supports authenticated CRUD and a persisted execution', async (t) => {
  const { application, server, baseUrl } = await startTestApp();
  t.after(() => {
    server.close();
    application.close();
  });

  const registration = await jsonRequest(baseUrl, '/api/auth/register', {
    method: 'POST',
    body: { name: 'Ada', email: 'ada@example.com', password: 'secure-password' }
  });
  assert.equal(registration.response.status, 201);
  assert.ok(registration.payload.accessToken);
  const token = registration.payload.accessToken;

  const created = await jsonRequest(baseUrl, '/api/workflows', {
    method: 'POST', token, body: workflowPayload
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.payload.workflow.version, 1);
  assert.equal(created.payload.workflow.status, 'draft');

  const listed = await jsonRequest(baseUrl, '/api/workflows', { token });
  assert.equal(listed.response.status, 200);
  assert.equal(listed.payload.workflows.length, 1);
  assert.equal(listed.payload.workflows[0].name, workflowPayload.name);

  const run = await jsonRequest(baseUrl, `/api/workflows/${created.payload.workflow.id}/run`, {
    method: 'POST', token, body: { input: { topic: 'reliable AI workflows' } }
  });
  assert.equal(run.response.status, 201);
  assert.equal(run.payload.execution.status, 'completed');
  assert.equal(run.payload.execution.output, 'AI result: Write about reliable AI workflows');
  assert.equal(run.payload.execution.steps.length, 3);

  const executions = await jsonRequest(baseUrl, `/api/workflows/${created.payload.workflow.id}/executions`, { token });
  assert.equal(executions.response.status, 200);
  assert.equal(executions.payload.executions.length, 1);
  assert.equal(executions.payload.executions[0].status, 'completed');
});

test('workflow API rejects unauthenticated access', async (t) => {
  const { application, server, baseUrl } = await startTestApp();
  t.after(() => {
    server.close();
    application.close();
  });

  const result = await jsonRequest(baseUrl, '/api/workflows');
  assert.equal(result.response.status, 401);
  assert.equal(result.payload.error.code, 'UNAUTHORIZED');
});
