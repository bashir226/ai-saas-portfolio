import test from 'node:test';
import assert from 'node:assert/strict';

import { createStarterWorkflow, toApiWorkflow, updateNodeConfig } from '../src/workflow.js';

test('starter workflow creates a connected trigger, AI and output graph', () => {
  const workflow = createStarterWorkflow();

  assert.deepEqual(workflow.nodes.map((node) => node.type), ['trigger', 'ai', 'output']);
  assert.deepEqual(workflow.edges.map(({ source, target }) => [source, target]), [
    ['trigger', 'ai-copy'],
    ['ai-copy', 'output']
  ]);
});

test('updateNodeConfig changes one node without mutating the workflow', () => {
  const workflow = createStarterWorkflow();
  const updated = updateNodeConfig(workflow, 'ai-copy', { model: 'gpt-4o' });

  assert.equal(workflow.nodes[1].data.config.model, 'gpt-4o-mini');
  assert.equal(updated.nodes[1].data.config.model, 'gpt-4o');
  assert.notEqual(updated.nodes[1], workflow.nodes[1]);
  assert.equal(updated.nodes[0], workflow.nodes[0]);
});

test('toApiWorkflow strips visual-only node metadata', () => {
  const payload = toApiWorkflow(createStarterWorkflow());

  assert.deepEqual(payload.nodes[1], {
    id: 'ai-copy',
    type: 'ai',
    name: 'AI copywriter',
    position: { x: 410, y: 210 },
    config: {
      model: 'gpt-4o-mini',
      prompt: 'Create a concise launch post about {{trigger.topic}} for {{trigger.audience}}.'
    }
  });
  assert.equal('data' in payload.nodes[1], false);
});