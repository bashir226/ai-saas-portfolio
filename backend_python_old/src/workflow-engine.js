const SUPPORTED_NODE_TYPES = new Set(['trigger', 'ai', 'transform', 'condition', 'output']);

export class WorkflowValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'WorkflowValidationError';
  }
}

function buildGraph(workflow) {
  const nodesById = new Map(workflow.nodes.map((node) => [node.id, node]));
  const incoming = new Map(workflow.nodes.map((node) => [node.id, []]));
  const outgoing = new Map(workflow.nodes.map((node) => [node.id, []]));

  for (const edge of workflow.edges) {
    if (!nodesById.has(edge.source) || !nodesById.has(edge.target)) {
      throw new WorkflowValidationError(`Edge ${edge.id ?? ''} references an unknown node.`);
    }
    if (edge.source === edge.target) {
      throw new WorkflowValidationError('Workflow contains a cycle: self-referencing edges are not allowed.');
    }
    incoming.get(edge.target).push(edge.source);
    outgoing.get(edge.source).push(edge.target);
  }

  return { nodesById, incoming, outgoing };
}

export function validateWorkflow(workflow) {
  if (!workflow || !Array.isArray(workflow.nodes) || !Array.isArray(workflow.edges)) {
    throw new WorkflowValidationError('Workflow must contain nodes and edges arrays.');
  }
  if (workflow.nodes.length < 2) {
    throw new WorkflowValidationError('Workflow must contain at least two nodes.');
  }

  const ids = new Set();
  for (const node of workflow.nodes) {
    if (!node.id || ids.has(node.id)) {
      throw new WorkflowValidationError('Every node must have a unique id.');
    }
    if (!SUPPORTED_NODE_TYPES.has(node.type)) {
      throw new WorkflowValidationError(`Unsupported node type: ${node.type}.`);
    }
    ids.add(node.id);
  }

  const triggers = workflow.nodes.filter((node) => node.type === 'trigger');
  if (triggers.length !== 1) {
    throw new WorkflowValidationError('Workflow must contain exactly one trigger node.');
  }

  const { incoming, outgoing } = buildGraph(workflow);
  const connected = new Set([triggers[0].id]);
  const queue = [triggers[0].id];
  while (queue.length) {
    const current = queue.shift();
    const neighbours = [...incoming.get(current), ...outgoing.get(current)];
    for (const neighbour of neighbours) {
      if (!connected.has(neighbour)) {
        connected.add(neighbour);
        queue.push(neighbour);
      }
    }
  }
  if (connected.size !== workflow.nodes.length) {
    throw new WorkflowValidationError('Workflow contains disconnected nodes.');
  }

  const indegree = new Map([...incoming].map(([nodeId, sources]) => [nodeId, sources.length]));
  const ready = workflow.nodes.filter((node) => indegree.get(node.id) === 0).map((node) => node.id);
  const order = [];
  while (ready.length) {
    const nodeId = ready.shift();
    order.push(nodeId);
    for (const target of outgoing.get(nodeId)) {
      indegree.set(target, indegree.get(target) - 1);
      if (indegree.get(target) === 0) ready.push(target);
    }
  }
  if (order.length !== workflow.nodes.length) {
    throw new WorkflowValidationError('Workflow contains a cycle.');
  }
  if (order[0] !== triggers[0].id) {
    throw new WorkflowValidationError('The trigger must be the first node in the workflow.');
  }

  return { order, ...buildGraph(workflow) };
}

function readPath(value, path) {
  return path.split('.').reduce((current, key) => current?.[key], value);
}

function interpolate(template, context) {
  return String(template ?? '').replace(/{{\s*([\w.-]+)\s*}}/g, (_, reference) => {
    const [nodeId, ...path] = reference.split('.');
    const value = path.length ? readPath(context[nodeId], path.join('.')) : context[nodeId];
    if (value === undefined) throw new Error(`Unknown workflow reference: ${reference}`);
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
  });
}

function latestInput(nodeId, incoming, context) {
  const sourceIds = incoming.get(nodeId);
  if (!sourceIds.length) return undefined;
  if (sourceIds.length === 1) return context[sourceIds[0]];
  return Object.fromEntries(sourceIds.map((sourceId) => [sourceId, context[sourceId]]));
}

export async function executeWorkflow({ workflow, input, provider, onStep }) {
  const { order, nodesById, incoming } = validateWorkflow(workflow);
  const context = {};
  const steps = [];
  const usage = { inputTokens: 0, outputTokens: 0 };

  for (const nodeId of order) {
    const node = nodesById.get(nodeId);
    const startedAt = new Date().toISOString();
    const started = { nodeId, name: node.name, type: node.type, status: 'running', startedAt };
    await onStep?.(started);

    try {
      let output;
      if (node.type === 'trigger') {
        output = input;
      } else if (node.type === 'ai') {
        const result = await provider.generate({
          model: node.config?.model ?? 'gpt-4o-mini',
          prompt: interpolate(node.config?.prompt, context),
          input: latestInput(nodeId, incoming, context)
        });
        output = result.text;
        usage.inputTokens += result.usage?.inputTokens ?? 0;
        usage.outputTokens += result.usage?.outputTokens ?? 0;
      } else if (node.type === 'transform') {
        output = interpolate(node.config?.template ?? '{{input}}', {
          ...context,
          input: latestInput(nodeId, incoming, context)
        });
      } else if (node.type === 'condition') {
        const value = latestInput(nodeId, incoming, context);
        output = Boolean(value);
      } else {
        output = latestInput(nodeId, incoming, context);
      }

      context[nodeId] = output;
      const completed = { ...started, status: 'completed', output, completedAt: new Date().toISOString() };
      steps.push(completed);
      await onStep?.(completed);
    } catch (error) {
      const failed = { ...started, status: 'failed', error: error.message, completedAt: new Date().toISOString() };
      steps.push(failed);
      await onStep?.(failed);
      return { status: 'failed', output: null, steps, usage, error: error.message };
    }
  }

  return {
    status: 'completed',
    output: context[order.at(-1)],
    steps,
    usage
  };
}
