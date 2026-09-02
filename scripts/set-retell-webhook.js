#!/usr/bin/env node
/**
 * Set every Retell agent's event webhook to the production DerteApp URL.
 *
 * Usage:
 *   RETELL_API_KEY=key_xxx node scripts/set-retell-webhook.js
 *
 * Target (strict): https://derteapp.onrender.com/api/webhooks/retell
 */
import process from 'node:process';

const TARGET = 'https://derteapp.onrender.com/api/webhooks/retell';
const EVENTS = ['call_started', 'call_ended', 'call_analyzed'];
const BASE = 'https://api.retellai.com';

const apiKey = process.env.RETELL_API_KEY?.trim();
if (!apiKey) {
  console.error('RETELL_API_KEY is required');
  process.exit(1);
}

async function retell(method, path, body) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!response.ok) {
    const err = new Error(`${method} ${path} → ${response.status}: ${text.slice(0, 400)}`);
    err.status = response.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function listAllAgents() {
  const agents = [];
  let paginationKey;
  for (;;) {
    const qs = new URLSearchParams({ limit: '100' });
    if (paginationKey) qs.set('pagination_key', paginationKey);
    // Newer API
    try {
      const page = await retell('POST', `/v2/list-agents?${qs}`, {});
      const items = page?.items ?? [];
      agents.push(...items);
      if (!page?.has_more) break;
      paginationKey = page.pagination_key;
      if (!paginationKey) break;
      continue;
    } catch (error) {
      if (error.status !== 404) throw error;
    }
    // Legacy fallback
    const legacy = await retell('GET', '/list-agents');
    return Array.isArray(legacy) ? legacy : legacy?.agents ?? legacy?.data ?? [];
  }
  return agents;
}

async function getAgent(agentId) {
  try {
    return await retell('GET', `/get-agent/${agentId}`);
  } catch (error) {
    if (error.status === 404) return await retell('GET', `/v2/get-agent/${agentId}`);
    throw error;
  }
}

async function updateAgent(agentId, payload) {
  try {
    return await retell('PATCH', `/update-agent/${agentId}`, payload);
  } catch (error) {
    if (error.status === 404) {
      return await retell('PATCH', `/v2/update-agent/${agentId}`, payload);
    }
    throw error;
  }
}

function summarize(agent) {
  return {
    agent_id: agent.agent_id,
    agent_name: agent.agent_name ?? agent.name,
    channel: agent.channel,
    webhook_url: agent.webhook_url ?? null,
    webhook_events: agent.webhook_events ?? null,
  };
}

const agents = await listAllAgents();
console.log(`[retell] found ${agents.length} agent(s)`);

const results = [];
for (const entry of agents) {
  const id = entry.agent_id;
  let before;
  try {
    before = summarize(await getAgent(id));
  } catch {
    before = summarize(entry);
  }

  const name = String(before.agent_name || '');
  const already =
    before.webhook_url === TARGET &&
    Array.isArray(before.webhook_events) &&
    EVENTS.every((e) => before.webhook_events.includes(e)) &&
    before.webhook_events.every((e) => EVENTS.includes(e));

  if (already) {
    console.log(`[skip] ${name} (${id}) already on target`);
    results.push({ ...before, updated: false, note: 'already_correct' });
    continue;
  }

  console.log(`[update] ${name} (${id}): ${before.webhook_url || '(none)'} → ${TARGET}`);
  const updated = await updateAgent(id, {
    webhook_url: TARGET,
    webhook_events: EVENTS,
  });
  results.push({
    ...summarize(updated?.agent ?? updated ?? { ...before, webhook_url: TARGET, webhook_events: EVENTS }),
    updated: true,
    previous_webhook_url: before.webhook_url,
  });
}

const wrong = results.filter((r) => r.webhook_url && r.webhook_url !== TARGET);
console.log('\n=== Summary ===');
console.log(JSON.stringify({ target: TARGET, count: results.length, results }, null, 2));
if (wrong.length) {
  console.error(`[retell] ${wrong.length} agent(s) still not on target URL`);
  process.exit(2);
}

const flow = results.filter((r) => /conversation\s*flow/i.test(String(r.agent_name || '')));
if (flow.length) {
  console.log(`[retell] Conversation Flow agent(s) OK: ${flow.map((r) => r.agent_id).join(', ')}`);
} else {
  console.log('[retell] No agent named like "Conversation Flow" found — all listed agents were updated anyway.');
}

console.log(`
NOTE: Account-level webhook (Settings → Webhooks) is dashboard-only.
Set it to the same URL and remove any secondary/test URLs.
`);
