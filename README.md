# News Without Doom

A calmer way to read the news: real headlines across the topics you follow,
summarized and stripped of the doom. Built on the
[DeepSpace SDK](https://deep.space).

**Live app:** https://news.app.space

## What it does
- Pulls live headlines from real RSS sources across topics like technology, business, and markets.
- Rewrites each item with a short, plain-language summary and a rating of how negative it is, so you can skim the substance without the alarm.
- Filters out off-topic noise and generates a per-topic brief of what's happening now and why it matters.
- Sign in to save the items you want to come back to.

## How it's built
A news pipeline fetches and parses topic RSS feeds, then enriches each headline
through the DeepSpace integrations proxy — an LLM call adds a context line, a
short summary, a negativity level, and a relevance check, and composes the topic
briefs. Saved items are stored per user in a `RecordRoom` Durable Object behind
a quick sign-in.

## Run your own

Deploy your own copy in three commands:

```sh
npm install
npx deepspace login     # one-time, opens a browser tab
npx deepspace deploy    # -> <name>.app.space
```

Auth, the database, real-time sync, and hosting all come from DeepSpace, so
there is nothing else to configure. Your subdomain is the `name` field in
`wrangler.toml`; change it for your own deployment.

Or build something new: apps like this are made by handing a prompt to a
coding agent — start at [deep.space/get-started](https://deep.space/get-started),
or scaffold from scratch: `npm create deepspace@latest my-app`.

---
*News Without Doom was built end-to-end by an AI agent on the DeepSpace SDK.
DeepSpace is laying the foundation for rebuilding the Internet in an AI-native
way — [deep.space](https://deep.space) · [docs](https://docs.deep.space).*
