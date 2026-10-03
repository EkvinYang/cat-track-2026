# Cat Track — Memory for Physical AI

Cat Track gives every Caterpillar machine and job site a persistent memory. Field input (dictated voice notes, typed reports, photos, telemetry anomalies, repairs) is understood, woven into a growing **knowledge graph**, and turned into:

- **Alerts and action items** for the people on the job site
- **Recall** of similar past events across the fleet, plus the fixes that actually worked
- **Escalation to CAT Engineering** for mechanical failures, aggregated into fleet-wide cases
- **Feedback from the field.** Engineers push quick fixes back to crews, technicians report what fixed it, and every outcome changes how future fixes are ranked.

## Quick start

```bash
npm install
npm run demo        # server on :3000 + ngrok HTTPS tunnel, prints the phone link
# or
npm start           # local only: http://localhost:3000
npm run reseed      # wipe and regenerate the demo fleet + history
```

Optional: copy `.env.example` to `.env` and set `ANTHROPIC_API_KEY` to turn on Claude (`claude-opus-5-5`) for report understanding (including photos), the tool-using Q&A agent, and root-cause analysis. Without a key, a deterministic offline rule engine runs everything, so the demo never depends on the network.

Phones need **HTTPS** for the microphone and camera. The ngrok link provides it.

## The panels

| Path | Who | What |
|---|---|---|
| `/operator` | Operators and technicians (phone) | Unit ID box, **QR scanner**, unit data card, **big dictate button** (Web Speech API), photo attach, live site alerts, spoken guidance |
| `/site` | Site managers | Live alerts (ack / resolve and teach), crew action items by role, fleet health, live memory feed, telemetry simulator, agent chat |
| `/engineering` | CAT engineers | Fleet cases (model + component), field evidence, condition and fault-code distributions, AI root-cause analysis, **issue a quick fix to the field**, **plan a product update** |
| `/graph` | Everyone | The knowledge graph, growing live as reports arrive |
| `/asset?id=EX-0412` | Everyone | One machine's lifecycle memory, role-tailored insights (operator / technician / fleet manager), "ask this machine", neighborhood graph |
| `/tags` | Setup | Printable QR tags. Each one opens `/operator?unit=…` |

## Demo script (about 3 minutes)

1. Open `/` on the laptop and scan the QR code with a phone to get `/operator`.
2. On the phone, tap **Scan** and point it at a tag on `/tags` (e.g. **EX-0601**). The unit card loads with its health, hours and memory ("Part of fleet pattern: Cat 336 hydraulic hose leak…").
3. Tap the big **Dictate** button and say *"Boom hose is leaking again near the frame bracket, dripping steady, hot day."* Then tap **Send**.
4. Back on the laptop:
   - `/site` shows the alert flash in, with crew action items including *"Try known fix… (71% field success)"*.
   - `/engineering` shows case **Cat 336 — Hydraulic hose: leak** with one more report across 3 machines and 3 sites. Click **Analyze field evidence**, then **Issue quick fix to field**. Every site running a 336 gets the bulletin, and the phone shows it live.
   - `/graph` shows new nodes flashing in as the memory grows.
5. On `/site`, click **Resolve & log repair** on the alert, choose the known fix, and type what you did. That fix's success rate goes up, a repair record joins the machine's lifecycle, and its health recovers.
6. Turn on **Live telemetry** in `/site`. Simulated sensor anomalies go through the same pipeline.

## Architecture

```
server/
  index.js      Express API + SSE + static panels
  pipeline.js   ingest → extract → graph → recall → alerts/actions → engineering case → publish
  extract.js    Claude structured extraction (with machine memory as context) + offline rule engine
  vocab.js      canonical components / symptoms / conditions / hazards (keeps the graph consistent)
  graph.js      knowledge graph (nodes + weighted edges that strengthen on repeat observation)
  memory.js     similarity recall, Laplace-smoothed fix ranking, distilled asset facts, role insights
  agent.js      tool-using Claude agent (search_memory, get_machine, fleet_overview, find_fixes,
                create_action_item, notify_site, …) + offline fallback; case root-cause analysis
  telemetry.js  sensor simulator; threshold breaches become telemetry observations
  seed.js       11 machines, 3 sites, ~4 months of history replayed through the real pipeline
  db.js         node:sqlite (built in, no native deps) → data/cattrack.db
public/         plain HTML/CSS/JS panels (no build step); vis-network for graphs, jsQR for scanning
```

**How it learns from field outcomes:** each fix's confidence is `(worked + 1) / (worked + failed + 2)`. Thumbs up/down on the operator panel, choosing a fix when resolving an alert, and new repairs described in free text all update it. A new repair description becomes a new learned fix. Recurring problems, environmental correlations (e.g. *overheating* with *high ambient heat*) and fleet-pattern membership are distilled into each machine's memory.

All machines, people and history are demo data.
