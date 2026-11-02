# Chris Pereira (彭家荣) agent desk

A free, public MCP server and JSON API for AI agents working for **journalists, analysts, producers and event organisers**. It lets an agent find what China business expert Chris Pereira has said, quote him correctly, and reach him for comment, an interview, a briefing or a speaking invitation. No key or sign-in needed.

Chris Pereira is Founder and CEO of iMpact 美讯, former Senior Director of Global Public Affairs at Huawei, author of *Trust* (《信任》, 2026) and *Rebuild* (《新出海》, 2025), a Forbes Top 30 Innovator and a CES Innovation Awards judge, with 20+ years in China. More: [chrisjpereira.com](https://chrisjpereira.com/).

## Connect

| | |
|---|---|
| MCP server (streamable HTTP, no auth) | `https://www.impact5r.com/agents/mcp` |
| JSON API docs | `https://www.impact5r.com/agents/` |
| Guide for agents | https://chrisjpereira.com/agents/ |
| Official MCP registry | `com.impact5r/chris-pereira` |

Add it to Claude, ChatGPT or any MCP client as a remote server with the URL above.

## Tools

| Tool | What it does |
|---|---|
| `get_profile` | Bios, titles, suggested attribution, books, topics, languages, speaking topics and formats, press photos, contact routes |
| `search_quotes` | Search curated quotes; each has text, date, outlet, source link and a ready-made attribution |
| `search_coverage` | Search 225+ interviews, TV appearances, quotes and op-eds, with summaries |
| `send_inquiry` | Send a request straight to Chris: `media`, `analyst`, `speaking` or `other`. He replies by email, usually within 24 hours |

## Without MCP

```
POST https://www.impact5r.com/agents/inquiry
Content-Type: application/json

{
  "type": "speaking",
  "name": "Alex Organiser",
  "email": "alex@example.com",
  "organisation": "Example Summit",
  "event_name": "Example Summit 2027",
  "event_date": "2027-03-10",
  "city": "Singapore",
  "audience": "400 senior marketers",
  "format": "keynote, 25 min",
  "message": "We would like Chris to give a keynote on how Chinese brands build trust abroad."
}
```

Data files (free to use): [profile](https://chrisjpereira.com/api/profile.json) · [quotes](https://chrisjpereira.com/api/quotes.json) · [coverage](https://chrisjpereira.com/api/coverage.json) · [writing](https://chrisjpereira.com/api/writing.json) · [llms.txt](https://chrisjpereira.com/llms.txt)

## Quoting

Quote freely with attribution: **"Chris Pereira, Founder and CEO of iMpact"** (long form: "... and former Senior Director of Global Public Affairs at Huawei"). Please cite the source link given with each quote and don't present summaries as direct quotes. For a fresh comment, use `send_inquiry`.

## Code

`src/agents.js` is the Cloudflare Workers handler behind the endpoints (MCP JSON-RPC, inquiry intake with rate limits, search over the public data files). Recipients are set by configuration, not in the code. MIT licensed.
