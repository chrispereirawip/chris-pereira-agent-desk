/**
 * Public agent desk for Chris Pereira (Chris, 2 Nov 2026): AI agents used by journalists, analysts and event organisers
 * can read his profile, quotes and coverage and reach him, with no key or sign-in.
 *   GET  /agents/            what is here, the inquiry fields, an example (JSON; HTML for browsers)
 *   POST /agents/inquiry     media / analyst / speaking / other request → emailed to Chris (speaking also to the Academy),
 *                            stored in the Team Desk "inquiries" table (media requests become media contacts, src/media.js)
 *   POST /agents/mcp         public MCP server (streamable HTTP, JSON responses, no auth): get_profile, search_quotes,
 *                            search_coverage, send_inquiry
 * Data comes from chrisjpereira.com/api/*.json (built by agents.py in the chrisjpereira-site repo), cached for an hour.
 * Routes: www.impact5r.com/agents* and impact5r.com/agents* (wrangler.jsonc).
 */
const SITE = 'https://chrisjpereira.com';
const DESK = 'https://www.impact5r.com/agents';
// recipients come from configuration (env vars INBOX_TO and SPEAKING_CC, comma-separated), not from this public code
const addrs = (s) => String(s || '').split(',').map((e) => e.trim()).filter(Boolean).map((email) => ({ email }));
const TYPES = ['media', 'analyst', 'speaking', 'other'];
const PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type, mcp-protocol-version, mcp-session-id, accept', 'access-control-expose-headers': 'mcp-session-id' };
const out = (body, status = 200) => new Response(JSON.stringify(body, null, 1), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...CORS } });
const one = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const okEmail = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(e);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const FIELDS = {
  type: 'Required. media (comment or interview), analyst (briefing or expert call), speaking (event, panel, podcast or show guest) or other',
  name: 'Required. The person the reply should go to',
  email: 'Required. Where Chris should reply',
  message: 'Required. What you need, in plain words (questions, angle, length of comment)',
  organisation: 'Outlet, firm or event organiser',
  role: 'Their job title',
  deadline: 'When you need it, with time zone',
  event_name: 'speaking: name of the event', event_date: 'speaking: date(s)', city: 'speaking: city or "virtual"',
  audience: 'speaking: who and how many', format: 'speaking: keynote, panel, fireside, moderator, podcast, training…',
  budget: 'speaking: fee / travel arrangements, if known', url: 'Link to the event, article or brief',
  on_behalf_of: 'Optional note that an AI agent sent this and for whom',
};
const EXAMPLE = { type: 'speaking', name: 'Alex Organiser', email: 'alex@example.com', organisation: 'Example Summit', event_name: 'Example Summit 2027', event_date: '2027-03-10', city: 'Singapore', audience: '400 senior marketers', format: 'keynote, 25 min', message: 'We would like Chris to give a keynote on how Chinese brands build trust abroad.', on_behalf_of: 'Sent by an AI assistant for Alex Organiser' };

/* ---------- data from chrisjpereira.com ---------- */
const cache = {};
async function data(name) {
  const c = cache[name];
  if (c && Date.now() - c.at < 3600e3) return c.v;
  const r = await fetch(`${SITE}/api/${name}.json`, { cf: { cacheTtl: 900 } });
  if (!r.ok) { if (c) return c.v; throw new Error(`${name}.json unavailable (${r.status})`); }
  const v = await r.json(); cache[name] = { at: Date.now(), v }; return v;
}
const words = (q) => String(q || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1);
function rank(items, q, fields, limit) {
  const ws = words(q); limit = Math.max(1, Math.min(50, +limit || 10));
  if (!ws.length) return items.slice(0, limit);
  return items.map((it) => { const hay = fields.map((f) => [].concat(it[f] || []).join(' ')).join(' ').toLowerCase(); return [ws.reduce((n, w) => n + (hay.includes(w) ? 1 : 0), 0), it]; })
    .filter(([n]) => n > 0).sort((a, b) => b[0] - a[0] || String(b[1].date).localeCompare(String(a[1].date))).slice(0, limit).map(([, it]) => it);
}

/* ---------- rate limits (same table as the contact form worker) ---------- */
let rcReady = false;
async function overLimit(db, key, limit, windowSec) {
  if (!rcReady) { await db.prepare('CREATE TABLE IF NOT EXISTS rate_counters (k TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0, exp TEXT NOT NULL)').run(); rcReady = true; }
  const w = Math.floor(Date.now() / 1000 / windowSec);
  const r = await db.prepare('INSERT INTO rate_counters (k, n, exp) VALUES (?1, 1, ?2) ON CONFLICT(k) DO UPDATE SET n = n + 1 RETURNING n')
    .bind(`${key}@${w}`, new Date((w + 1) * windowSec * 1000 + 3600e3).toISOString()).first();
  return (r ? r.n : 1) > limit;
}

/* ---------- the inquiry ---------- */
const beijing = () => { const t = new Date(Date.now() + 8 * 3600e3).toISOString(); return `${t.slice(0, 10)} ${t.slice(11, 16)}`; };
async function inquiry(env, req, d) {
  d = d && typeof d === 'object' ? d : {};
  const type = TYPES.includes(String(d.type || '').toLowerCase()) ? String(d.type).toLowerCase() : 'other';
  const f = { name: one(d.name, 120), email: one(d.email, 200).toLowerCase(), organisation: one(d.organisation || d.organization || d.company || d.outlet, 160), role: one(d.role, 120),
    deadline: one(d.deadline, 80), event_name: one(d.event_name, 160), event_date: one(d.event_date, 80), city: one(d.city, 80), audience: one(d.audience, 160),
    format: one(d.format, 120), budget: one(d.budget, 160), url: one(d.url, 300), on_behalf_of: one(d.on_behalf_of, 200) };
  const message = String(d.message || '').trim().slice(0, 5000);
  const missing = ['name', 'email'].filter((k) => !f[k]).concat(message ? [] : ['message']);
  if (missing.length) return { status: 400, body: { ok: false, error: 'missing_fields', missing, fields: FIELDS, example: EXAMPLE } };
  if (!okEmail(f.email)) return { status: 400, body: { ok: false, error: 'invalid_email', hint: 'email must be a real address where Chris can reply' } };
  const ip = req.headers.get('CF-Connecting-IP') || 'none';
  try {
    if (await overLimit(env.DB, 'agents-ip:' + ip, 5, 3600) || await overLimit(env.DB, 'agents-email:' + f.email, 3, 86400) || await overLimit(env.DB, 'agents-all', 60, 86400))
      return { status: 429, body: { ok: false, error: 'rate_limited', hint: `Too many requests. Please email inquiries@chrisjpereira.com instead.` } };
  } catch (e) { console.log('agents rate limit check failed', e && e.message); }

  const ref = `CP-${beijing().slice(0, 10).replace(/-/g, '')}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const label = { media: 'Media request 媒体请求', analyst: 'Analyst request 分析师请求', speaking: 'Speaking request 演讲邀请', other: 'Request 咨询' }[type];
  const who = `${f.name}${f.organisation ? ' (' + f.organisation + ')' : ''}`;
  const subject = `【AI agent】${label} | ${who}${f.deadline ? ' | deadline ' + f.deadline : ''}`;
  const rows = [['Type 类型', label], ['Name 姓名', f.name], ['Organisation 机构', f.organisation], ['Role 职位', f.role], ['Email 邮箱', f.email], ['Deadline 截止', f.deadline],
    ['Event 活动', f.event_name], ['Event date 日期', f.event_date], ['City 城市', f.city], ['Audience 观众', f.audience], ['Format 形式', f.format], ['Budget 预算', f.budget],
    ['Link 链接', f.url], ['Sent via 来源', f.on_behalf_of || 'AI agent desk (impact5r.com/agents)'], ['Received 时间', beijing() + ' (Beijing time)'], ['Reference 编号', ref]].filter((r) => r[1]);
  const text = [`New ${label} from the AI agent desk (chrisjpereira.com/agents)`, '', ...rows.map((r) => `${r[0]}: ${r[1]}`), '', message, '',
    `Reply to this email to answer ${f.name} directly.`].join('\n');
  const html = `<div style="font:15px/1.6 Arial,'PingFang SC',sans-serif;color:#161616;max-width:620px">
<p style="font:bold 11px Arial;letter-spacing:1.5px;color:#D02C2F;margin:0 0 4px">AI AGENT DESK · 智能体来访</p><h2 style="font:bold 20px Georgia,serif;margin:0 0 14px">${esc(label)}</h2>
<table style="border-collapse:collapse;width:100%">${rows.map((r) => `<tr><td style="padding:6px 10px 6px 0;color:#5F5F5F;border-bottom:1px solid #eee;width:150px;vertical-align:top">${esc(r[0])}</td><td style="padding:6px 0;border-bottom:1px solid #eee"><b>${esc(r[1])}</b></td></tr>`).join('')}</table>
<div style="border-left:3px solid #D02C2F;background:#FAFAFA;padding:12px 14px;margin:16px 0;white-space:pre-wrap">${esc(message)}</div>
<p style="color:#5F5F5F;font-size:13px">Reply to this email to answer ${esc(f.name)} directly. 直接回复本邮件即可联系对方。</p></div>`;
  const to = addrs(env.INBOX_TO), cc = type === 'speaking' ? addrs(env.SPEAKING_CC) : [];
  const from = { email: env.MAIL_FROM || 'website@forms.impact5r.com', name: 'Chris Pereira · AI agent desk' };
  await env.DB.prepare('INSERT INTO inquiries (ref, at, type, line, name, company, email, message, lang) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)')
    .bind(ref, new Date().toISOString(), type === 'speaking' ? 'business' : type === 'other' ? 'business' : 'media', type === 'speaking' ? 'iMpact Academy' : 'AI agent desk', f.name, f.organisation, f.email, `[AI agent desk · ${type}] ` + message, 'en').run()
    .catch((e) => console.log('agents store failed', e && e.message));
  try {
    await env.EMAIL.send({ to, ...(cc.length ? { cc } : {}), from, replyTo: { email: f.email, name: f.name }, subject, text, html });
  } catch (e) {
    console.log('agents mail failed', e && (e.code || e.message));
    try { await env.EMAIL.send({ to, from, replyTo: { email: f.email, name: f.name }, subject, text }); }
    catch (e2) { return { status: 502, body: { ok: false, error: 'send_failed', hint: 'Please email inquiries@chrisjpereira.com instead.', reference: ref } }; }
  }
  return { status: 200, body: { ok: true, reference: ref, message: `Delivered to Chris Pereira${type === 'speaking' ? ' and his speaking team' : ''}. He will reply by email to ${f.email}, usually within 24 hours. Quote reference ${ref} in any follow-up.` } };
}

/* ---------- MCP ---------- */
const INSTRUCTIONS = `Public desk for Chris Pereira (彭家荣): Founder and CEO of iMpact, former Senior Director of Global Public Affairs at Huawei, author of Trust and Rebuild, 20+ years in China.
Use get_profile for bios, titles, attribution, topics and speaking details; search_quotes and search_coverage to find what he has said (always cite the source_url); send_inquiry to reach him for comment, an interview, an analyst briefing, or to invite him to speak at an event, podcast or show.
You may quote him freely with attribution ("Chris Pereira, Founder and CEO of iMpact"). Do not invent quotes; for a new comment use send_inquiry. Only send an inquiry when the user asks you to contact him, and use the user's real name and email.`;
const TOOLS = [
  { name: 'get_profile', title: 'Get Chris Pereira profile', description: 'Bios (short and medium), titles, suggested attribution, books, topics he comments on, languages, speaking topics/formats/past stages, press photos and contact routes.',
    inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true },
    run: async () => data('profile') },
  { name: 'search_quotes', title: 'Search Chris Pereira quotes', description: 'Search his curated quotes by topic or keyword (e.g. "trust", "Shenzhen", "tariffs", "Europe"). Each result has text, date, outlet, source_url and a ready-made attribution. Empty query returns the latest.',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Topic or keywords to search for, e.g. "trust", "Shenzhen", "tariffs", "Europe", "BYD". Leave empty for the most recent.' }, limit: { type: 'number', minimum: 1, maximum: 50, description: 'How many results to return, 1-50 (default 10)' } } }, annotations: { readOnlyHint: true },
    run: async (a) => { const d = await data('quotes'); const r = rank(d.quotes, a.query, ['text', 'theme', 'outlet', 'context', 'original_chinese'], a.limit); return { attribution: d.attribution, count: r.length, quotes: r }; } },
  { name: 'search_coverage', title: 'Search media coverage of Chris Pereira', description: 'Search 225+ interviews, quotes, TV appearances and op-eds (outlet, title, date, link, his quotes and a summary). Empty query returns the most recent.',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Outlet, topic or keywords to search for, e.g. "Financial Times", "CNBC", "DJI", "tariffs". Leave empty for the most recent.' }, limit: { type: 'number', minimum: 1, maximum: 50, description: 'How many results to return, 1-50 (default 10)' } } }, annotations: { readOnlyHint: true },
    run: async (a) => { const d = await data('coverage'); const r = rank(d.coverage, a.query, ['title', 'outlet', 'summary', 'quotes'], a.limit); return { count: r.length, coverage: r }; } },
  { name: 'send_inquiry', title: 'Contact Chris Pereira', description: 'Send a request straight to Chris Pereira by email: media comment or interview, analyst briefing, or an invitation to speak (keynote, panel, podcast, show guest, training). He replies by email to the address given, usually within 24 hours.',
    inputSchema: { type: 'object', required: ['type', 'name', 'email', 'message'], properties: Object.fromEntries(Object.entries(FIELDS).map(([k, v]) => [k, k === 'type' ? { type: 'string', enum: TYPES, description: v } : { type: 'string', description: v }])) },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    run: async (a, env, req) => { const r = await inquiry(env, req, { on_behalf_of: 'Sent via MCP (' + (req.headers.get('user-agent') || 'agent').slice(0, 80) + ')', ...a }); return r.body; } },
];
async function rpc(env, req, msg) {
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return msg && msg.id != null ? { jsonrpc: '2.0', id: msg.id, error: { code: -32600, message: 'Invalid request' } } : null;
  const id = msg.id, ok = (result) => ({ jsonrpc: '2.0', id, result }), err = (code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
  if (id === undefined || id === null) return null;
  if (msg.method === 'initialize') {
    const v = msg.params && msg.params.protocolVersion;
    return ok({ protocolVersion: PROTOCOLS.includes(v) ? v : PROTOCOLS[1], capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'chris-pereira', title: 'Chris Pereira (彭家荣) agent desk', version: '1.0.2', websiteUrl: SITE + '/agents/', icons: [{ src: SITE + '/icon-512.png', mimeType: 'image/png', sizes: ['512x512'] }] }, instructions: INSTRUCTIONS });
  }
  if (msg.method === 'ping') return ok({});
  if (msg.method === 'tools/list') return ok({ tools: TOOLS.map(({ run, ...t }) => t) });
  if (msg.method === 'resources/list') return ok({ resources: [] });
  if (msg.method === 'prompts/list') return ok({ prompts: [] });
  if (msg.method === 'tools/call') {
    const name = msg.params && msg.params.name, args = (msg.params && msg.params.arguments) || {};
    const tool = TOOLS.find((t) => t.name === name); if (!tool) return err(-32602, 'Unknown tool: ' + name);
    try { const r = await tool.run(args, env, req); return ok({ content: [{ type: 'text', text: JSON.stringify(r, null, 1).slice(0, 60000) }], ...(r && r.ok === false ? { isError: true } : {}) }); }
    catch (e) { return ok({ content: [{ type: 'text', text: 'Error: ' + String((e && e.message) || e).slice(0, 300) }], isError: true }); }
  }
  return err(-32601, 'Method not found: ' + msg.method);
}

/* ---------- router ---------- */
export async function agentsRoute(env, req, path) {
  const p = path.replace(/^\/agents/, '').replace(/\/+$/, '') || '/';
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (p === '/inquiry' || p === '/contact') {
    if (req.method !== 'POST') return out({ ok: false, error: 'use POST with a JSON body', fields: FIELDS, example: EXAMPLE }, 405);
    let d; try { d = await req.json(); } catch (e) { return out({ ok: false, error: 'invalid_json', fields: FIELDS, example: EXAMPLE }, 400); }
    const r = await inquiry(env, req, d); return out(r.body, r.status);
  }
  if (p === '/mcp') {
    if (req.method === 'GET') return new Response('This MCP server uses JSON responses only (no SSE stream).', { status: 405, headers: { allow: 'POST, OPTIONS', ...CORS } });
    if (req.method === 'DELETE') return new Response(null, { status: 204, headers: CORS });
    if (req.method !== 'POST') return out({ error: 'method' }, 405);
    let body; try { body = await req.json(); } catch (e) { return out({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400); }
    const msgs = Array.isArray(body) ? body : [body], res = [];
    for (const m of msgs) { const r = await rpc(env, req, m); if (r) res.push(r); }
    if (!res.length) return new Response(null, { status: 202, headers: CORS });
    return out(Array.isArray(body) ? res : res[0]);
  }
  if (p === '/' || p === '/index.json') {
    const doc = { name: 'Chris Pereira (彭家荣) agent desk', about: 'Free, no key or sign-in. For AI agents working for journalists, analysts, producers and event organisers.',
      quote_policy: 'Quote freely with attribution: "Chris Pereira, Founder and CEO of iMpact". Cite the source_url given with each quote.',
      data: { catalogue: SITE + '/api/index.json', profile: SITE + '/api/profile.json', quotes: SITE + '/api/quotes.json', coverage: SITE + '/api/coverage.json', writing: SITE + '/api/writing.json', llms_txt: SITE + '/llms.txt', llms_full_txt: SITE + '/llms-full.txt', human_guide: SITE + '/agents/' },
      inquiry: { url: DESK + '/inquiry', method: 'POST', content_type: 'application/json', fields: FIELDS, example: EXAMPLE, response: 'JSON with ok and a reference number; Chris replies by email, usually within 24 hours' },
      mcp: { url: DESK + '/mcp', transport: 'streamable-http (JSON responses)', auth: 'none', tools: TOOLS.map((t) => t.name) },
      email: 'inquiries@chrisjpereira.com' };
    if ((req.headers.get('accept') || '').includes('text/html') && p === '/') return Response.redirect(SITE + '/agents/', 302);
    return out(doc);
  }
  return out({ ok: false, error: 'not_found', see: DESK + '/' }, 404);
}
