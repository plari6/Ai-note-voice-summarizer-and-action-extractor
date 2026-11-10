# AI Voice Note Summarizer & Action Extractor

Turns long, rambling executive voice notes into a **clean task list**: every action item with its **owner**, **due date**, **priority** and the exact quote it came from, plus a summary, decisions, open questions, risks, and **ready-to-send delegation messages** for each person.

Built with **Node.js** and **Gemini multimodal audio**, wrapped in a multi-model fallback chain (several Gemini versions → Groq Whisper → other text models → keyword rules) so it keeps working when a model is busy, rate-limited or out of quota.

```
voice note (WhatsApp/Telegram voice, iPhone memo, mp3, Zoom mp4…)
   │
   ├─ transcribe ─ Gemini 3.6 → 3.5 → 3 preview → flash-latest → Groq Whisper → OpenAI   (cached by file hash)
   ├─ extract ──── Gemini → Groq Llama → NVIDIA → OpenRouter → Ollama → keyword rules      (cached by transcript)
   ├─ normalise ── due dates computed in code, owners/enums coerced, duplicates merged, sorted
   └─ deliver ──── Markdown · JSON · CSV · calendar (.ics) · Telegram · web page · webhook · Slack · task register
```

> The project card names "Gemini 2.0 Multimodal API". Gemini 2.0 models are retired (they return 404), so the defaults use current Gemini versions with the same audio input. Change them with `AUDIO_CHAIN` / `AI_CHAIN`.

## Quick start

```bash
npm install
node bin/voice-tasks.js demo                 # offline sample, no keys -> output/demo/
cp .env.example .env                         # add GEMINI_API_KEY (and GROQ_API_KEY for the free Whisper fallback)
node bin/voice-tasks.js doctor --ping        # checks keys and every model
node bin/voice-tasks.js process examples/voice-note-2026-11-10.wav
```

Node 20+. Install globally with `npm link` to get the `voice-tasks` command.

## What you get per note

| File | Contents |
|---|---|
| `<date>-<title>.md` | Summary, key points, tasks grouped **Yours / Delegated to X / Team / Unassigned**, task table, decisions, open questions, risks, ideas, people, delegation messages, full transcript |
| `.json` | Everything, machine-readable (schema below) |
| `.tasks.csv` | One row per task, opens in Excel / Google Sheets (formula-injection safe) |
| `.ics` | One all-day calendar entry per dated task; imports into Outlook, Google, Apple Calendar |
| `.transcript.txt` | `[mm:ss]` timestamped transcript |

See [examples/sample-report.md](examples/sample-report.md) for a full report from a 2½-minute CEO note (14 tasks, 4 people).

## Commands

```bash
voice-tasks process <files or folders...>    # alias: summarize
    --date 2026-11-10                         # resolves "tomorrow", "next Friday" (default: date in file name, else file time)
    --owner "Dana Levi" --context "CEO of Brightline; Sarah = Head of Sales"
    --vocab "Hartwell, Datafront, QBR"        # names the transcriber must spell right
    --language Arabic --output-language auto  # spoken language / task-list language ("auto" = same as note)
    --out output/client-x --json --no-write --refresh --no-ai
    --webhook https://hooks.zapier.com/...  --slack https://hooks.slack.com/...  --no-webhook
    --simulate-outage gemini                  # demo the fallback chain
voice-tasks transcribe note.m4a --save note.txt
voice-tasks tasks [--owner Sarah|me] [--today|--week|--overdue] [--done|--all] [--csv f] [--ics f] [--json]
voice-tasks done T1A2B3 [T4C5D6]   |   voice-tasks reopen T1A2B3
voice-tasks history
voice-tasks retry                             # notes queued while AI was down
voice-tasks watch ~/iCloudDrive/VoiceMemos    # process every new file dropped in a folder
voice-tasks telegram                          # bot: forward a voice note, get tasks back
voice-tasks serve --port 3000                 # API + record-in-browser page
voice-tasks doctor [--ping]
voice-tasks demo [--live|--rules]
```

Exit codes: `0` ok, `1` some files failed, `2` all failed / queued for retry.

**Inputs:** mp3, wav, m4a, aac, ogg/opus (WhatsApp & Telegram voice), flac, aiff, webm (browser recordings), mp4/mov (audio track); transcripts as txt, md, vtt, srt or Whisper/Otter JSON. Files up to 14 MB are sent inline, larger ones through the Gemini Files API (uploaded once, reused by every Gemini model in the chain, deleted afterwards).

## Ways in for an executive

1. **Telegram bot** (`voice-tasks telegram`): they forward a voice note from WhatsApp or record one in Telegram and get the task list, a calendar file, a CSV and forwardable messages back in about 20 seconds. Commands: `/tasks`, `/tasks Sarah`, `/today`, `/done T1A2B3`, `/pending`. Only chat ids in `TELEGRAM_ALLOWED_CHAT_IDS` can use it (send `/help` to see yours).
2. **Web page** (`voice-tasks serve`, open `/` on a phone): a record button, upload or paste box, results on the same page.
3. **Folder watch**: point it at the synced Voice Memos / Dropbox / OneDrive folder and every new recording is processed once its upload has finished.
4. **API** for Zapier/Make/n8n or an existing app:

```bash
curl -H "Authorization: Bearer $API_TOKEN" -F file=@memo.m4a -F date=2026-11-10 http://localhost:3000/api/notes
curl -H "Authorization: Bearer $API_TOKEN" -H "content-type: application/json" -d '{"text":"Sarah, send the deck by Friday..."}' http://localhost:3000/api/notes?format=md
GET  /api/tasks?status=open&owner=Sarah   GET /api/tasks.csv   GET /api/tasks.ics   POST /api/tasks/T1A2B3/done
GET  /api/notes   GET /health (model status, public)
```

`POST /api/notes` returns `202 {queued:true}` when no transcription model is available, so the recording is kept and processed later.

## Integrations

- **Webhook** (`WEBHOOK_URL`): `POST {event:"voice_note.processed", note, tasks[]}` with optional `X-Voice-Tasks-Signature: sha256=<HMAC>` (`WEBHOOK_SECRET`). In Zapier/Make/n8n, loop over `tasks` to create Asana, ClickUp, Monday, Todoist, Jira, Trello, Notion or HubSpot tasks, and map `owner` → assignee and `due_date` → due date. Retries on 5xx/429.
- **Slack** (`SLACK_WEBHOOK_URL`): summary + task list block message.
- **Calendar**: `.ics` per note, and `voice-tasks tasks --ics all.ics` for the whole register.

## How reliability works

| Situation | What happens |
|---|---|
| Gemini 503 / 429 / slow | next Gemini version (each has its own quota), then Groq Whisper; cooldowns skip a failing model for a while |
| Daily quota used up | that model is parked until reset (Google returns the delay) |
| Model returns broken JSON | the next text model is asked |
| All text models down | **keyword extractor** still returns tasks, owners, due dates and priorities (marked "keyword rules"; re-run with `--refresh` later) |
| All audio models down | the recording is **queued**; `retry`, the bot and the watcher process it automatically and the bot sends the result to the chat |
| Same file again | transcript and analysis come from the cache (no cost); task status (done) is kept |

## Correctness choices

- **Due dates are computed by code, not by the model.** The model returns the spoken phrase ("by next Friday") and `src/dates.js` resolves it against the recording date. Conventions: "Friday" = the next Friday after the recording; "this Friday" = this week's; "next Friday" = next week's; "next week" = next Monday; "end of week" = this Friday; also EOD/EOM/EOQ, "in 3 business days", "within two weeks", "Nov 15", "the 25th". If the phrase is in another language, the model's date is used (`due_source: "model"`).
- Owners are normalised: speaker → `Me`, "we/the team" → `Team`, names title-cased, `OWNER_NAME` recognised as Me.
- Repeated requests in a long note are merged (`mentions: 2`); dependencies ("after the proposal") become task ids.
- A medium task due on the recording day is raised to high.
- Task ids are stable per note, so re-processing keeps "done" status.

## JSON schema (per note)

```jsonc
{
  "id": "b6cc…", "title": "…", "recorded_on": "2026-11-10", "language": "English", "duration_seconds": 140,
  "summary": "…", "key_points": ["…"],
  "tasks": [{
    "id": "T2AF558", "title": "Send revised Hartwell proposal…", "details": "…",
    "owner": "Sarah", "owner_type": "self|delegate|team|unassigned",
    "due_date": "2026-11-12", "due_phrase": "by Thursday", "due_source": "phrase|model|",
    "priority": "high|medium|low", "category": "sales_clients|finance|meeting|…",
    "depends_on": ["T…"], "source_quote": "…", "timestamp": "00:14", "confidence": 0.97, "mentions": 2, "status": "open"
  }],
  "decisions": [{ "decision": "…", "timestamp": "00:46" }], "open_questions": [], "people": [{ "name": "Omar", "role": "CFO" }],
  "risks": [], "ideas": [],
  "delegations": [{ "owner": "Jake", "task_ids": ["…"], "subject": "…", "message": "Hi Jake,…" }],
  "stats": { "tasks": 14, "mine": 4, "delegated": 9, "team": 1, "unassigned": 0, "high": 6, "with_due": 11 },
  "transcript_engine": "gemini:gemini-3.6-flash", "analysis_engine": "gemini:gemini-3.6-flash", "warnings": [], "transcript": "…"
}
```

## Configuration

All settings live in `.env` (see [.env.example](.env.example)). The most useful ones for a client:

- `OWNER_NAME`, `NOTE_CONTEXT` (role, company, who is who) and `VOCABULARY` (names to spell right) noticeably improve owners and titles.
- `OUTPUT_LANGUAGE=auto` keeps the task list in the language of the note (Arabic, French, German, etc.).
- `TIMEZONE` decides what "today" means for the Telegram bot and API.
- For paying clients use a **paid Gemini key** as the first link: free-tier prompts may be used by Google to improve products, and free daily caps are small. Keep the free providers behind it as redundancy.

## Deploy

```bash
docker build -t voice-tasks .
docker run -d --env-file .env -v voice-data:/data -p 3000:3000 voice-tasks            # API + page
docker run -d --env-file .env -v voice-data:/data voice-tasks telegram                 # bot (no public URL needed)
```

Data lives in `DATA_DIR` (cache, `tasks.json` register, `notes.json`, `pending/`). Voice notes are sensitive: keep `API_TOKEN` and `TELEGRAM_ALLOWED_CHAT_IDS` set, and run it on infrastructure the client controls.

## Development

```bash
npm test        # 56 tests, no network or keys (fake providers and fetch)
```

`src/` layout: `transcriber.js` + `transcription/` (audio chain), `analyzer.js` + `prompts.js` (text chain), `rules.js` (no-AI fallback), `analysis.js` (normalising, dedup, delegations), `dates.js`, `pipeline.js`, `store.js`, `format.js`, `integrations.js`, `telegram.js`, `server.js` + `page.js`, `watch.js`, `ai/` (multi-model fallback router).

## License

MIT
