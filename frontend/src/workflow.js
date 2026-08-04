export function createStarterWorkflow() {
  return {
    name: 'Launch content pipeline',
    description: 'Turn a product brief into a ready-to-publish campaign message.',
    status: 'draft',
    nodes: [
      {
        id: 'trigger',
        type: 'trigger',
        position: { x: 90, y: 210 },
        data: { label: 'Campaign brief', config: {} }
      },
      {
        id: 'ai-copy',
        type: 'ai',
        position: { x: 410, y: 210 },
        data: {
          label: 'AI copywriter',
          config: {
            model: 'gpt-4o-mini',
            prompt: 'Create a concise launch post about {{trigger.topic}} for {{trigger.audience}}.'
          }
        }
      },
      {
        id: 'output',
        type: 'output',
        position: { x: 730, y: 210 },
        data: { label: 'Publish result', config: {} }
      }
    ],
    edges: [
      { id: 'edge-trigger-ai', source: 'trigger', target: 'ai-copy', animated: true },
      { id: 'edge-ai-output', source: 'ai-copy', target: 'output', animated: true }
    ]
  };
}

export function updateNodeConfig(workflow, nodeId, patch) {
  return {
    ...workflow,
    nodes: workflow.nodes.map((node) => node.id === nodeId
      ? { ...node, data: { ...node.data, config: { ...node.data.config, ...patch } } }
      : node)
  };
}

export function toApiWorkflow(workflow) {
  return {
    name: workflow.name,
    description: workflow.description,
    status: workflow.status ?? 'draft',
    nodes: workflow.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      name: node.data.label,
      position: node.position,
      config: node.data.config ?? {}
    })),
    edges: workflow.edges.map(({ id, source, target }) => ({ id, source, target }))
  };
}

export function fromApiWorkflow(workflow) {
  return {
    ...workflow,
    nodes: workflow.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      position: node.position,
      data: { label: node.name, config: node.config ?? {} }
    })),
    edges: workflow.edges.map((edge) => ({ ...edge, animated: true }))
  };
}
