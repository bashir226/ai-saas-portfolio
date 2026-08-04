import test from 'node:test';
import assert from 'node:assert/strict';

import { executeWorkflow, validateWorkflow } from '../src/workflow-engine.js';

const workflow = {
  nodes: [
    { id: 'trigger', type: 'trigger', name: 'Form input', config: {} },
    {
      id: 'prompt',
      type: 'ai',
      name: 'Generate campaign',
      config: {
        model: 'gpt-4o-mini',
        prompt: 'Create a launch post about {{trigger.topic}} for {{trigger.audience}}.'
      }
    },
    { id: 'output', type: 'output', name: 'Publish result', config: {} }
  ],
  edges: [
    { id: 'edge-trigger-prompt', source: 'trigger', target: 'prompt' },
    { id: 'edge-prompt-output', source: 'prompt', target: 'output' }
  ]
};

test('executeWorkflow runs a DAG and resolves data references between nodes', async () => {
  const calls = [];
  const provider = {
    async generate({ model, prompt }) {
      calls.push({ model, prompt });
      return { text: `Generated: ${prompt}`, usage: { inputTokens: 12, outputTokens: 8 } };
    }
  };

  const result = await executeWorkflow({
    workflow,
    input: { topic: 'AI agents', audience: 'product teams' },
    provider
  });

  assert.equal(result.status, 'completed');
  assert.deepEqual(calls, [{
    model: 'gpt-4o-mini',
    prompt: 'Create a launch post about AI agents for product teams.'
  }]);
  assert.equal(result.output, 'Generated: Create a launch post about AI agents for product teams.');
  assert.deepEqual(result.steps.map((step) => step.status), ['completed', 'completed', 'completed']);
  assert.deepEqual(result.usage, { inputTokens: 12, outputTokens: 8 });
});

test('validateWorkflow rejects cycles before execution', () => {
  const cyclic = {
    ...workflow,
    edges: [
      ...workflow.edges,
      { id: 'edge-output-prompt', source: 'output', target: 'prompt' }
    ]
  };

  assert.throws(() => validateWorkflow(cyclic), /cycle/i);
});

test('validateWorkflow rejects disconnected nodes', () => {
  const disconnected = {
    ...workflow,
    nodes: [...workflow.nodes, { id: 'orphan', type: 'output', name: 'Orphan', config: {} }]
  };

  assert.throws(() => validateWorkflow(disconnected), /disconnected/i);
});
