import { SERVICES, ENVIRONMENT, ACTIONS, aiInput, validateExplanation } from './core.mjs';

export async function boundedJson(response, cap = 256 * 1024) {
  if (!response.ok) throw new Error(`HTTP_${response.status}`);
  if (!response.body) throw new Error('EMPTY_RESPONSE');
  const reader = response.body.getReader(); const parts = []; let bytes = 0;
  try {
    for (;;) { const { done, value } = await reader.read(); if (done) break;
      bytes += value.byteLength; if (bytes > cap) throw new Error('RESPONSE_TOO_LARGE'); parts.push(value); }
    const joined = new Uint8Array(bytes); let offset = 0;
    for (const part of parts) { joined.set(part, offset); offset += part.byteLength; }
    return JSON.parse(new TextDecoder().decode(joined));
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

// Exactly four fixed read-only queries per cycle, no user/model-supplied GraphQL.
export async function collectRailway(token, request = fetch) {
  if (!token) throw new Error('RAILWAY_PROJECT_TOKEN_REQUIRED');
  const signal = AbortSignal.timeout(20_000);
  const query = async (document, variables = {}) => {
    const response = await request('https://backboard.railway.com/graphql/v2', {
      method: 'POST', redirect: 'error', signal,
      headers: { 'content-type': 'application/json', 'Project-Access-Token': token },
      body: JSON.stringify({ query: document, variables }),
    });
    const body = await boundedJson(response);
    if (body.errors || !body.data) throw new Error('RAILWAY_READ_FAILED');
    return body.data;
  };
  const fields = SERVICES.map(service => `${service.name}: serviceInstance(serviceId: "${service.id}", environmentId: "${ENVIRONMENT}") { latestDeployment { id status } }`).join('\n');
  const data = await query(`query WatchdogDeployments { ${fields} }`);
  const snapshot = {};
  // Sequential calls share the total deadline. Never retry or write platform state.
  for (const service of SERVICES) {
    const deployment = data[service.name]?.latestDeployment;
    if (!deployment) { snapshot[service.name] = { error: true }; continue; }
    try {
      const filter = '"existing_token_scanner_cycle" OR "factory=v2-current" OR "[ArcLive] scan" OR "TELEGRAM_ACCEPTED" OR "aborted due to timeout" OR "request timed out" OR "request took too long" OR "ETIMEDOUT" OR "delivery failed"';
      const result = await query('query WatchdogLogs($deploymentId: String!, $filter: String!, $startDate: DateTime!) { deploymentLogs(deploymentId: $deploymentId, limit: 200, filter: $filter, startDate: $startDate) { timestamp message severity } }',
        { deploymentId: deployment.id, filter, startDate: new Date(Date.now() - 10 * 60_000).toISOString() });
      if (!Array.isArray(result.deploymentLogs)) throw new Error('MALFORMED_LOGS');
      snapshot[service.name] = { deployment, logs: result.deploymentLogs, truncated: result.deploymentLogs.length >= 200 };
    } catch { snapshot[service.name] = { error: true }; }
  }
  return snapshot;
}

export async function explainGemini(key, model, report, request = fetch) {
  if (!key || !/^gemini-[a-zA-Z0-9.-]+$/.test(model)) throw new Error('GEMINI_CONFIGURATION_REQUIRED');
  const schema = { type: 'object', properties: {
    hypothesis: { type: 'string', enum: ['PROVIDER_FAILURE_POSSIBLE', 'SCAN_PROGRESS_UNVERIFIED', 'DELIVERY_FAILURE_OBSERVED', 'MONITOR_ACCESS_UNAVAILABLE'] },
    nextCheck: { type: 'string', enum: ACTIONS },
    evidenceIds: { type: 'array', items: { type: 'string' } },
  }, required: ['hypothesis', 'nextCheck', 'evidenceIds'] };
  const response = await request(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: 'You are a read-only operations analyst. Choose ONE supported hypothesis and a next diagnostic check using only supplied evidence IDs. Missing scan evidence is not proof of a stopped scanner. A successful deployment is not proof of healthy delivery. No tools, trades, restarts, writes or safety approvals are available.' }] },
      contents: [{ role: 'user', parts: [{ text: JSON.stringify(aiInput(report)) }] }],
      generationConfig: { maxOutputTokens: 1024, responseMimeType: 'application/json', responseJsonSchema: schema },
    }),
  });
  const body = await boundedJson(response, 32 * 1024);
  const candidate = body.candidates?.[0];
  if (candidate?.finishReason !== 'STOP') throw new Error('GEMINI_INCOMPLETE_RESULT');
  const text = candidate.content?.parts?.map(part => part.text ?? '').join('');
  const explanation = validateExplanation(JSON.parse(text), report);
  if (!explanation) throw new Error('GEMINI_UNSUPPORTED_RESULT');
  return explanation;
}
