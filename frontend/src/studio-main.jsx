import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  Activity, Bot, Box, ChevronRight, CircleUserRound, Clock3, Cloud, Code2, Copy,
  Database, GitBranch, LayoutDashboard, LogOut, Mail, Menu, MoreHorizontal, Play,
  Plus, Radio, Save, Search, Settings, Sparkles, Trash2, Webhook, X, Zap
} from 'lucide-react';

import { api } from './api.js';
import { createStarterWorkflow, fromApiWorkflow, toApiWorkflow, updateNodeConfig } from './workflow.js';
import './studio.css';

const TOKEN_KEY = 'flowforge-token';
const NODE_META = {
  trigger: { icon: Zap, eyebrow: 'TRIGGER', detail: 'Manual or webhook input', color: '#f7b955' },
  ai: { icon: Sparkles, eyebrow: 'AI ACTION', detail: 'Generate with an LLM', color: '#8b83ff' },
  transform: { icon: Code2, eyebrow: 'TRANSFORM', detail: 'Map and format data', color: '#59b8ff' },
  output: { icon: Box, eyebrow: 'OUTPUT', detail: 'Return final result', color: '#4fd19d' }
};

function FlowNode({ type, data, selected }) {
  const meta = NODE_META[type] ?? NODE_META.transform;
  const Icon = meta.icon;
  return (
    <div className={`flow-node ${selected ? 'selected' : ''}`} style={{ '--node-color': meta.color }}>
      {type !== 'trigger' && <Handle type="target" position={Position.Left} />}
      <div className="node-icon"><Icon size={17} /></div>
      <div className="node-copy">
        <span>{meta.eyebrow}</span>
        <strong>{data.label}</strong>
        <small>{type === 'ai' ? data.config?.model : meta.detail}</small>
      </div>
      <button className="icon-button tiny"><MoreHorizontal size={15} /></button>
      {type !== 'output' && <Handle type="source" position={Position.Right} />}
    </div>
  );
}

const nodeTypes = {
  trigger: (props) => <FlowNode {...props} type="trigger" />,
  ai: (props) => <FlowNode {...props} type="ai" />,
  transform: (props) => <FlowNode {...props} type="transform" />,
  output: (props) => <FlowNode {...props} type="output" />
};

function AuthScreen({ onAuthenticated }) {
  const [mode, setMode] = useState('register');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = mode === 'register'
        ? await api.register(form)
        : await api.login({ email: form.email, password: form.password });
      localStorage.setItem(TOKEN_KEY, result.accessToken);
      onAuthenticated(result.accessToken, result.user);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-story">
        <a className="brand" href="/studio.html"><span><GitBranch size={19} /></span> FlowForge</a>
        <div className="auth-pitch">
          <div className="eyebrow"><span /> AUTOMATION, WITHOUT THE BUSYWORK</div>
          <h1>Build reliable AI workflows on a visual canvas.</h1>
          <p>Connect triggers, models, transformations, and destinations. Ship automations your team can inspect and trust.</p>
          <div className="mini-flow">
            <div><Webhook size={18} /><span>Webhook</span></div><ChevronRight size={16} />
            <div><Sparkles size={18} /><span>AI model</span></div><ChevronRight size={16} />
            <div><Mail size={18} /><span>Publish</span></div>
          </div>
        </div>
        <p className="auth-foot">Visual orchestration · Versioned runs · Local demo mode</p>
      </section>
      <section className="auth-panel">
        <form className="auth-card" onSubmit={submit}>
          <div className="mobile-brand"><GitBranch size={19} /> FlowForge</div>
          <span className="kicker">{mode === 'register' ? 'START BUILDING' : 'WELCOME BACK'}</span>
          <h2>{mode === 'register' ? 'Create your workspace' : 'Sign in to FlowForge'}</h2>
          <p>{mode === 'register' ? 'Your first AI pipeline is ready in under a minute.' : 'Continue building your automations.'}</p>
          {mode === 'register' && (
            <label>Full name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ada Lovelace" required /></label>
          )}
          <label>Email<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="you@company.com" required /></label>
          <label>Password<input type="password" minLength="8" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="At least 8 characters" required /></label>
          {error && <div className="form-error">{error}</div>}
          <button className="primary-button auth-submit" disabled={busy}>{busy ? 'Connecting…' : mode === 'register' ? 'Create workspace' : 'Sign in'} <ChevronRight size={16} /></button>
          <div className="auth-switch">
            {mode === 'register' ? 'Already have an account?' : 'New to FlowForge?'}
            <button type="button" onClick={() => { setMode(mode === 'register' ? 'login' : 'register'); setError(''); }}>
              {mode === 'register' ? 'Sign in' : 'Create account'}
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}

function Sidebar({ user, onLogout, onNew, workflows, activeId, onSelect }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand"><span><GitBranch size={17} /></span><strong>FlowForge</strong><button className="icon-button"><Menu size={16} /></button></div>
      <button className="workspace-switch"><span className="workspace-logo">A</span><span><strong>Acme Studio</strong><small>Free workspace</small></span><ChevronRight size={15} /></button>
      <nav className="main-nav">
        <a className="active"><LayoutDashboard size={16} /> Workflows</a>
        <a><Activity size={16} /> Executions</a>
        <a><Database size={16} /> Connections</a>
        <a><Settings size={16} /> Settings</a>
      </nav>
      <div className="sidebar-section-title"><span>WORKFLOWS</span><button onClick={onNew}><Plus size={15} /></button></div>
      <div className="workflow-nav">
        {workflows.map((workflow) => (
          <button className={workflow.id === activeId ? 'active' : ''} key={workflow.id} onClick={() => onSelect(workflow.id)}>
            <span className={`status-dot ${workflow.status}`} />
            <span>{workflow.name}</span>
          </button>
        ))}
        {!workflows.length && <p className="empty-sidebar">No saved workflows yet.</p>}
      </div>
      <div className="sidebar-bottom">
        <div className="usage"><div><span>Monthly runs</span><strong>0 / 1,000</strong></div><div className="usage-bar"><span /></div></div>
        <button className="user-button"><span className="avatar">{user?.name?.[0]?.toUpperCase() ?? 'U'}</span><span><strong>{user?.name}</strong><small>{user?.email}</small></span><LogOut size={15} onClick={onLogout} /></button>
      </div>
    </aside>
  );
}

function NodeLibrary({ onAdd }) {
  const entries = [
    ['trigger', 'Webhook', Webhook, 'Receive an HTTP event'],
    ['ai', 'AI model', Bot, 'Generate or analyze text'],
    ['transform', 'Transform', Code2, 'Map your workflow data'],
    ['output', 'Output', Box, 'Return the final result']
  ];
  return (
    <aside className="node-library">
      <div className="panel-heading"><div><span className="kicker">BUILD</span><h3>Node library</h3></div><Plus size={16} /></div>
      <div className="library-search"><Search size={15} /><input placeholder="Search nodes…" /></div>
      <span className="library-label">CORE NODES</span>
      <div className="library-list">
        {entries.map(([type, label, Icon, description]) => (
          <button key={type} onClick={() => onAdd(type)}><span><Icon size={17} /></span><div><strong>{label}</strong><small>{description}</small></div><Plus size={14} /></button>
        ))}
      </div>
      <div className="library-tip"><Sparkles size={16} /><div><strong>Start with a trigger</strong><p>Every workflow needs one entry point and at least one output.</p></div></div>
    </aside>
  );
}

function Inspector({ node, onChange, onDelete }) {
  if (!node) {
    return <aside className="inspector empty-inspector"><CircleUserRound size={28} /><h3>Select a node</h3><p>Configure its model, prompt, and behavior here.</p></aside>;
  }
  const meta = NODE_META[node.type] ?? NODE_META.transform;
  const Icon = meta.icon;
  return (
    <aside className="inspector">
      <div className="inspector-title"><span className="node-icon" style={{ '--node-color': meta.color }}><Icon size={17} /></span><div><span>{meta.eyebrow}</span><h3>{node.data.label}</h3></div><button className="icon-button" onClick={onDelete}><Trash2 size={15} /></button></div>
      <div className="field-group"><label>Node name</label><input value={node.data.label} onChange={(e) => onChange({ label: e.target.value })} /></div>
      {node.type === 'trigger' && <div className="config-note"><Radio size={16} /><p>Manual trigger accepts the JSON input supplied when you run this workflow.</p></div>}
      {node.type === 'ai' && <>
        <div className="field-group"><label>Model</label><select value={node.data.config.model} onChange={(e) => onChange({ config: { ...node.data.config, model: e.target.value } })}>
          <option value="gpt-4o-mini">GPT-4o Mini</option><option value="gpt-4o">GPT-4o</option><option value="claude-3-5-sonnet">Claude 3.5 Sonnet</option><option value="deepseek-chat">DeepSeek V3</option>
        </select></div>
        <div className="field-group"><label>Prompt</label><textarea rows="8" value={node.data.config.prompt} onChange={(e) => onChange({ config: { ...node.data.config, prompt: e.target.value } })} /></div>
        <div className="variable-hint"><Code2 size={14} /> Use variables like <code>{'{{trigger.topic}}'}</code></div>
      </>}
      {node.type === 'transform' && <div className="field-group"><label>Template</label><textarea rows="8" value={node.data.config.template ?? '{{input}}'} onChange={(e) => onChange({ config: { ...node.data.config, template: e.target.value } })} /></div>}
      {node.type === 'output' && <div className="config-note"><Cloud size={16} /><p>The final value reaching this node becomes the execution output.</p></div>}
    </aside>
  );
}

function RunDrawer({ open, onClose, onRun, busy, execution, input, setInput }) {
  return (
    <div className={`run-drawer ${open ? 'open' : ''}`}>
      <div className="drawer-header"><div><span className="kicker">TEST WORKFLOW</span><h3>Run with input</h3></div><button className="icon-button" onClick={onClose}><X size={17} /></button></div>
      <label>Input JSON<textarea rows="7" value={input} onChange={(e) => setInput(e.target.value)} /></label>
      <button className="primary-button run-submit" onClick={onRun} disabled={busy}><Play size={15} /> {busy ? 'Running…' : 'Run workflow'}</button>
      {execution && <div className={`execution-result ${execution.status}`}>
        <div><span className="status-dot active" /><strong>{execution.status}</strong><small>{execution.steps.length} steps</small></div>
        <pre>{typeof execution.output === 'string' ? execution.output : JSON.stringify(execution.output, null, 2)}</pre>
        <div className="token-row"><span>Input {execution.usage.inputTokens} tokens</span><span>Output {execution.usage.outputTokens} tokens</span></div>
      </div>}
    </div>
  );
}

function Studio({ token, user, onLogout }) {
  const [workflows, setWorkflows] = useState([]);
  const [workflow, setWorkflow] = useState(createStarterWorkflow());
  const [activeId, setActiveId] = useState(null);
  const [selectedId, setSelectedId] = useState('ai-copy');
  const [saving, setSaving] = useState(false);
  const [runOpen, setRunOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [execution, setExecution] = useState(null);
  const [runInput, setRunInput] = useState('{\n  "topic": "AI workflow reliability",\n  "audience": "product teams"\n}');
  const [toast, setToast] = useState('');

  const selectedNode = workflow.nodes.find((node) => node.id === selectedId);
  useEffect(() => {
    api.listWorkflows(token).then(({ workflows: items }) => {
      setWorkflows(items);
      if (items[0]) { setActiveId(items[0].id); setWorkflow(fromApiWorkflow(items[0])); }
    }).catch((error) => setToast(error.message));
  }, [token]);
  useEffect(() => { if (toast) { const timer = setTimeout(() => setToast(''), 3000); return () => clearTimeout(timer); } }, [toast]);

  const onNodesChange = useCallback((changes) => setWorkflow((current) => ({ ...current, nodes: applyNodeChanges(changes, current.nodes) })), []);
  const onEdgesChange = useCallback((changes) => setWorkflow((current) => ({ ...current, edges: applyEdgeChanges(changes, current.edges) })), []);
  const onConnect = useCallback((connection) => setWorkflow((current) => ({ ...current, edges: addEdge({ ...connection, animated: true }, current.edges) })), []);

  function newWorkflow() {
    setActiveId(null); setWorkflow(createStarterWorkflow()); setSelectedId('ai-copy'); setExecution(null); setToast('New draft created');
  }
  function selectWorkflow(id) {
    const item = workflows.find((entry) => entry.id === id);
    if (item) { setActiveId(id); setWorkflow(fromApiWorkflow(item)); setSelectedId(item.nodes[0]?.id); setExecution(null); }
  }
  function updateSelected(patch) {
    setWorkflow((current) => ({ ...current, nodes: current.nodes.map((node) => node.id === selectedId ? { ...node, data: { ...node.data, ...patch } } : node) }));
  }
  function deleteSelected() {
    if (!selectedId || workflow.nodes.length <= 2) return;
    setWorkflow((current) => ({ ...current, nodes: current.nodes.filter((node) => node.id !== selectedId), edges: current.edges.filter((edge) => edge.source !== selectedId && edge.target !== selectedId) }));
    setSelectedId(null);
  }
  function addNode(type) {
    const id = `${type}-${Date.now()}`;
    const meta = NODE_META[type];
    const config = type === 'ai' ? { model: 'gpt-4o-mini', prompt: 'Analyze {{trigger.topic}}' } : type === 'transform' ? { template: '{{input}}' } : {};
    setWorkflow((current) => ({ ...current, nodes: [...current.nodes, { id, type, position: { x: 360 + current.nodes.length * 35, y: 100 + current.nodes.length * 45 }, data: { label: meta.detail, config } }] }));
    setSelectedId(id);
  }
  async function saveWorkflow() {
    setSaving(true);
    try {
      const payload = toApiWorkflow(workflow);
      const { workflow: saved } = activeId ? await api.updateWorkflow(token, activeId, payload) : await api.createWorkflow(token, payload);
      setActiveId(saved.id); setWorkflow(fromApiWorkflow(saved));
      setWorkflows((items) => [saved, ...items.filter((item) => item.id !== saved.id)]);
      setToast('Workflow saved');
    } catch (error) { setToast(error.message); } finally { setSaving(false); }
  }
  async function runWorkflow() {
    setRunning(true); setExecution(null);
    try {
      let id = activeId;
      if (!id) {
        const { workflow: saved } = await api.createWorkflow(token, toApiWorkflow(workflow));
        id = saved.id; setActiveId(id); setWorkflows((items) => [saved, ...items]); setWorkflow(fromApiWorkflow(saved));
      }
      const { execution: result } = await api.runWorkflow(token, id, JSON.parse(runInput));
      setExecution(result); setToast(result.status === 'completed' ? 'Execution completed' : 'Execution failed');
    } catch (error) { setToast(error instanceof SyntaxError ? 'Input must be valid JSON' : error.message); } finally { setRunning(false); }
  }

  return (
    <div className="studio-shell">
      <Sidebar user={user} onLogout={onLogout} onNew={newWorkflow} workflows={workflows} activeId={activeId} onSelect={selectWorkflow} />
      <main className="workspace">
        <header className="topbar">
          <div className="breadcrumb"><span>Workflows</span><ChevronRight size={14} /><input value={workflow.name} onChange={(e) => setWorkflow({ ...workflow, name: e.target.value })} /></div>
          <div className="topbar-actions"><span className="draft-pill"><span /> Draft</span><button className="secondary-button" onClick={saveWorkflow} disabled={saving}><Save size={15} /> {saving ? 'Saving…' : 'Save'}</button><button className="primary-button" onClick={() => setRunOpen(true)}><Play size={14} /> Run</button></div>
        </header>
        <div className="editor-layout">
          <NodeLibrary onAdd={addNode} />
          <section className="canvas-wrap">
            <div className="canvas-toolbar"><button><Search size={15} /> Find node <kbd>⌘ K</kbd></button><span>{workflow.nodes.length} nodes · {workflow.edges.length} connections</span></div>
            <ReactFlow nodes={workflow.nodes} edges={workflow.edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect} onNodeClick={(_, node) => setSelectedId(node.id)} fitView minZoom={0.35} maxZoom={1.7}>
              <Background color="rgba(255,255,255,.08)" gap={22} size={1} />
              <MiniMap nodeColor={(node) => NODE_META[node.type]?.color ?? '#777'} maskColor="rgba(8,9,10,.78)" />
              <Controls showInteractive={false} />
            </ReactFlow>
            <div className="canvas-status"><span><span className="live-dot" /> Autosaved locally</span><span><Clock3 size={13} /> Version {workflow.version ?? 1}</span></div>
          </section>
          <Inspector node={selectedNode} onChange={updateSelected} onDelete={deleteSelected} />
        </div>
      </main>
      <RunDrawer open={runOpen} onClose={() => setRunOpen(false)} onRun={runWorkflow} busy={running} execution={execution} input={runInput} setInput={setRunInput} />
      {toast && <div className="toast"><span className="live-dot" />{toast}</div>}
    </div>
  );
}

function App() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(!token);
  useEffect(() => {
    if (!token) return;
    api.me(token).then(({ user: current }) => { setUser(current); setReady(true); }).catch(() => { localStorage.removeItem(TOKEN_KEY); setToken(null); setReady(true); });
  }, [token]);
  if (!ready) return <div className="boot-screen"><GitBranch size={24} /> Loading FlowForge…</div>;
  if (!token) return <AuthScreen onAuthenticated={(nextToken, nextUser) => { setToken(nextToken); setUser(nextUser); }} />;
  return <Studio token={token} user={user} onLogout={() => { localStorage.removeItem(TOKEN_KEY); setToken(null); setUser(null); }} />;
}

createRoot(document.getElementById('studio-root')).render(<App />);
