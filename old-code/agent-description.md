# News Without Doom

A calm news briefing app that fetches RSS feeds from trusted sources (BBC, Reuters, TechCrunch, The Verge, Wired, ESPN, CNN, CNBC), enriches headlines with AI, and synthesizes them into a structured "Today's Context" brief.

## Features
- Topic selection: Tech, Business, Science, Markets, Sports, Local
- Negativity filter: Off, Light (no high-negativity), Strict (low only)
- AI-enriched headlines with calm rewrites and context lines
- Structured daily brief: What's Happening Now, Key Players, Watch Next, Why It Matters, Viewpoints
- Read More accordion: expands each brief bullet with a detailed AI summary
- Save for Later: bookmark headlines to a persistent drawer
- Headline detail modal with full context and summary

## UI Structure
- **Nav bar**: News (home) and Permissions links, user badge
- **Home page (`/`)**: Topic chips, filter controls, Today's Context dark card with bullets, Top Headlines collapsible list
- **Permissions page (`/permissions`)**: RBAC permission matrix for all collections

## User Flows
1. Select a topic → app fetches RSS feeds → enriches with AI → displays brief and headlines
2. Click "Read more" on a brief bullet → AI generates 6-8 line summary from source articles
3. Click "Save" on any headline → stored in local saved drawer (session state)
4. Click a headline card → modal shows title, context line, summary, and link to original article
5. Click "Refresh" → re-fetches and re-enriches the current topic
