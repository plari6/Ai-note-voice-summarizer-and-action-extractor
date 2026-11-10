import { formatDue } from './dates.js';
import { htmlEscape, tasksCsv, toIcs, toTelegram } from './format.js';
import { extFromMime, localIsoDate } from './media.js';
import { TranscriptionError } from './pipeline.js';

const HELP = (chatId) => `<b>Voice note → task list</b>
Send or forward a voice note (WhatsApp/Telegram voice, audio file, or a transcript file) and I'll reply with the summary, tasks, owners and due dates, plus a calendar file.

Commands
/tasks - open tasks (all notes)
/tasks Sarah - one person's tasks
/today - due today or overdue
/done T1A2B3 - mark a task done
/pending - notes waiting for AI

Your chat id: <code>${chatId}</code>`;

/**
 * Telegram bot over long polling (no public URL needed). Only chats listed in
 * TELEGRAM_ALLOWED_CHAT_IDS may use it; voice notes are private.
 */
export function createTelegramBot({ token, pipeline, store, config, fetchImpl = fetch, log = console.log, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not set (create a bot with @BotFather).');
  const base = `https://api.telegram.org/bot${token}`;
  const allowed = new Set((config.telegram.allowed || []).map(String));
  let offset = 0;
  let running = false;

  async function api(method, params = {}) {
    const res = await fetchImpl(`${base}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params), signal: AbortSignal.timeout(method === 'getUpdates' ? 65_000 : 30_000) });
    const data = await res.json().catch(() => ({}));
    if (!data.ok) throw new Error(`Telegram ${method}: ${data.description || res.status}`);
    return data.result;
  }

  async function sendDocument(chatId, filename, content, caption = '') {
    const form = new FormData();
    form.append('chat_id', String(chatId));
    if (caption) form.append('caption', caption);
    form.append('document', new Blob([content]), filename);
    const res = await fetchImpl(`${base}/sendDocument`, { method: 'POST', body: form, signal: AbortSignal.timeout(30_000) });
    const data = await res.json().catch(() => ({}));
    if (!data.ok) throw new Error(`Telegram sendDocument: ${data.description || res.status}`);
  }

  const send = (chatId, text, extra = {}) => api('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra });

  async function download(fileId) {
    const f = await api('getFile', { file_id: fileId });
    const res = await fetchImpl(`https://api.telegram.org/file/bot${token}/${f.file_path}`, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`Telegram file download failed (${res.status})`);
    return { buffer: Buffer.from(await res.arrayBuffer()), path: f.file_path };
  }

  async function deliver(chatId, note) {
    for (const m of toTelegram(note)) await send(chatId, m);
    const dated = note.tasks.filter((t) => t.due_date);
    if (dated.length) await sendDocument(chatId, `tasks-${note.recorded_on}.ics`, toIcs(note.tasks.map((t) => ({ ...t, note_title: note.title })), { calendarName: note.title }), 'Open to add the deadlines to your calendar');
    await sendDocument(chatId, `tasks-${note.recorded_on}.csv`, tasksCsv(note.tasks, note));
    if (note.delegations.length) {
      const text = note.delegations.map((d) => `<b>To ${htmlEscape(d.owner)}</b>\n<pre>${htmlEscape(d.message)}</pre>`).join('\n\n');
      await send(chatId, `<b>Ready-to-forward messages</b>\n\n${text}`.slice(0, 4000));
    }
  }

  function boardText(tasks, title) {
    if (!tasks.length) return `${title}: nothing open.`;
    const today = localIsoDate(new Date(), config.timezone);
    const lines = tasks.slice(0, 40).map((t) => `${t.priority === 'high' ? '🔴' : t.priority === 'medium' ? '🟡' : '⚪'} ${htmlEscape(t.title)} → ${htmlEscape(t.owner)}${t.due_date ? ` · ${t.due_date < today ? '<b>OVERDUE</b> ' : ''}${htmlEscape(formatDue(t.due_date))}` : ''} <code>${t.id}</code>`);
    return `<b>${htmlEscape(title)}</b> (${tasks.length})\n${lines.join('\n')}${tasks.length > 40 ? `\n… and ${tasks.length - 40} more` : ''}`;
  }

  async function handleCommand(chatId, text) {
    const [cmd, ...args] = text.trim().split(/\s+/);
    const c = cmd.toLowerCase().replace(/@.*$/, '');
    const today = localIsoDate(new Date(), config.timezone);
    if (c === '/start' || c === '/help') return send(chatId, HELP(chatId));
    if (c === '/tasks') return send(chatId, boardText(store.listTasks({ owner: args.join(' ') || undefined, today }), args.length ? `Open tasks for ${args.join(' ')}` : 'Open tasks'));
    if (c === '/today') return send(chatId, boardText(store.listTasks({ dueWithin: 0, today }), 'Due today or overdue'));
    if (c === '/done') {
      if (!args.length) return send(chatId, 'Usage: /done T1A2B3 [T4C5D6 ...]');
      const changed = store.setTaskStatus(args, 'done');
      return send(chatId, changed.length ? `Done: ${changed.map((t) => htmlEscape(t.title)).join(', ')}` : 'No task with that id.');
    }
    if (c === '/pending') {
      const p = store.listPending();
      return send(chatId, p.length ? `${p.length} note(s) waiting for AI: ${p.map((x) => htmlEscape(x.name || x.id)).join(', ')}` : 'Nothing pending.');
    }
    return send(chatId, 'Unknown command. /help');
  }

  async function handleUpdate(update) {
    const msg = update.message || update.channel_post;
    if (!msg?.chat) return;
    const chatId = msg.chat.id;
    if (allowed.size && !allowed.has(String(chatId)) && !allowed.has(String(msg.from?.id))) {
      log(`Telegram: ignored chat ${chatId} (not in TELEGRAM_ALLOWED_CHAT_IDS)`);
      return send(chatId, `This bot is private. Ask the owner to add your chat id <code>${chatId}</code> to TELEGRAM_ALLOWED_CHAT_IDS.`);
    }
    const text = msg.text || '';
    if (text.startsWith('/')) return handleCommand(chatId, text);

    const media = msg.voice || msg.audio || msg.video_note || msg.video || msg.document;
    const date = localIsoDate(new Date((msg.forward_origin?.date || msg.forward_date || msg.date || Date.now() / 1000) * 1000), config.timezone);
    let input;
    if (media) {
      if (media.file_size > 20 * 1024 * 1024) return send(chatId, 'That file is over Telegram\'s 20 MB bot limit. Send a shorter recording or use the web upload.');
      const mime = media.mime_type || (msg.voice ? 'audio/ogg' : msg.video_note ? 'video/mp4' : '');
      const name = media.file_name || `telegram-${msg.message_id}${extFromMime(mime) || '.ogg'}`;
      await api('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});
      const status = await send(chatId, '🎧 Got it, transcribing and extracting tasks...').catch(() => null);
      const file = await download(media.file_id);
      input = { buffer: file.buffer, name, mime };
      try {
        const note = await pipeline.processInput(input, { date });
        if (status) await api('deleteMessage', { chat_id: chatId, message_id: status.message_id }).catch(() => {});
        return deliver(chatId, note);
      } catch (err) {
        if (err instanceof TranscriptionError) {
          store.addPending({ buffer: file.buffer, name, meta: { date, chat_id: chatId }, error: err.message });
          return send(chatId, `⏳ The transcription AI is busy right now. Your note is saved and I'll send the tasks automatically as soon as it is processed (retry every ${config.telegram.retryMinutes} min).`);
        }
        throw err;
      }
    }
    if (text.split(/\s+/).length >= 12) {
      const note = await pipeline.processInput({ text, name: `telegram-text-${msg.message_id}.txt` }, { date });
      return deliver(chatId, note);
    }
    return send(chatId, 'Send me a voice note (or paste a longer text) and I will turn it into tasks. /help');
  }

  async function retryLoop() {
    while (running) {
      await sleep(config.telegram.retryMinutes * 60_000);
      if (!running) break;
      await pipeline
        .retryPending({}, async (note, item) => {
          if (item.meta?.chat_id) await deliver(item.meta.chat_id, note);
        })
        .catch((err) => log(`Pending retry failed: ${err.message}`));
    }
  }

  return {
    handleUpdate,
    api,
    async start() {
      const me = await api('getMe');
      await api('setMyCommands', {
        commands: [
          { command: 'tasks', description: 'Open tasks (optionally for one person)' },
          { command: 'today', description: 'Due today or overdue' },
          { command: 'done', description: 'Mark a task done: /done T1A2B3' },
          { command: 'pending', description: 'Notes waiting for AI' },
          { command: 'help', description: 'How to use the bot' },
        ],
      }).catch(() => {});
      log(`Telegram bot @${me.username} is running. ${allowed.size ? `Allowed chats: ${[...allowed].join(', ')}` : 'WARNING: TELEGRAM_ALLOWED_CHAT_IDS is empty, anyone can use the bot.'}`);
      running = true;
      retryLoop();
      while (running) {
        let updates = [];
        try {
          updates = await api('getUpdates', { offset, timeout: 50, allowed_updates: ['message', 'channel_post'] });
        } catch (err) {
          log(`Telegram polling error: ${err.message}. Retrying in 5 s.`);
          await sleep(5000);
          continue;
        }
        for (const u of updates) {
          offset = u.update_id + 1;
          const chatId = (u.message || u.channel_post)?.chat?.id;
          // Each note is handled without blocking polling for the next message.
          handleUpdate(u).catch(async (err) => {
            log(`Telegram update ${u.update_id} failed: ${err.message}`);
            if (chatId) await send(chatId, `Sorry, that failed: ${htmlEscape(err.message).slice(0, 300)}`).catch(() => {});
          });
        }
      }
    },
    stop() {
      running = false;
    },
  };
}
