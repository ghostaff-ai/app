# The chat, as good as WhatsApp

**Priority:** high — people talk in Ghostaff the way they talk in WhatsApp, or they go back to WhatsApp (and Telegram)
**Gate:** blocked:ghostaff-ai/app#94 (General), which this builds on; phase 1 is stacked on it
**Next:** phase 1 on `feat/chat-look`, stacked on `feat/general-chat`

Jaime (2026-11-26), after trying General on the web: «es feísima la interfaz». Days, times, emoji, replying to one message and files are missing; the audio box is ugly; holding the mic should record, and keep recording for a long note. «Revisa cómo es la interfaz de WhatsApp y haz una interfaz y mete funcionalidades igual de top». It covers General ([general-chat.md](general-chat.md)) and every chat with an agent ([group-chat-per-agent.md](../ongoing/group-chat-per-agent.md)): one set of components for both.

The drawn version he approved: [mockup in the session of 2026-11-26] — a chat with a day separator, time and ticks in every bubble, a voice note with its waveform and speed, a quoted reply, reactions, «1 mensaje sin leer» and «Álvaro está grabando un audio…»; the long-press menu (reactions row, Responder, Copiar, Reenviar a un agente, Fijar, Editar, Eliminar); and a locked recording with pause, plus the attach sheet (Documento, Fotos, Cámara).

## What WhatsApp does that we take (2026)

- **Bubbles**: yours right, theirs left, a tail on the first of a run, the time inside at the bottom right, ticks on yours (one: sent; two blue: read). In a group, the sender's name in its own colour on the first of a run.
- **Days**: «Hoy», «Ayer», the weekday within a week, then the date, as a pill between messages. «N mensajes sin leer» where you left off; a button to jump to the newest, with how many arrived.
- **Voice notes**: hold the mic to record, release to send; slide left to cancel; slide up to lock and record hands-free, with pause and resume, then send or bin. The bubble: play, a waveform you can drag along, the length, speed 1× / 1.5× / 2×, a dot until you have played someone else's note. No transcript in sight in General.
- **Replying and reacting**: swipe a message right to reply (the quote sits above the box and in the bubble; a tap on it goes to the original). Long-press: six quick reactions plus any emoji, and Responder, Copiar, Reenviar a un agente, Fijar, Editar (15 minutes), Eliminar («Se eliminó este mensaje»). An emoji button in the box.
- **Files**: a clip for documents and photos (several at once, with a caption) and the camera; photos inline with a full-screen viewer, documents as a card with name, type and size. Each chat's «Archivos, enlaces y documentos».
- **Presence and search**: «está escribiendo…» / «está grabando un audio…» in the header, a search in the chat, link previews.
- **Left out**: stickers and GIFs, status, calls, wallpapers, disappearing messages, polls, location, contacts.

## Decisions

Jaime, 2026-11-26 (all my picks):

1. **Four phases, one pull request each, in this order**: (1) the look and the audio; (2) reply, reactions, the message menu and emoji; (3) files; (4) presence, search and link previews.
2. **Files live per chat and in Empresa**: each chat's «Archivos, enlaces y documentos», as in WhatsApp, and Empresa › Archivos with everything from the chats the person may read. One store (a private bucket in the EU), which the agents read too.
3. **An agent writes in a bubble, like a contact**: on the left, with its ghost, its name, the time and its formatting (lists, bold), a wider bubble for long answers. It reverses team-chat.md decision 3 («agents flat») and the layout of its step 5; the ink text of step 5 stays.
4. **Hold to record** (Jaime's words, «si mantengo pulsado el audio se tiene que mantener pulsado para grabar uno largo»): it replaces voice.md decision 2 (tap to start, then send or cancel). A short tap says «Mantén pulsado para grabar».
5. **No transcript under a voice note in General** (Jaime). In a chat with an agent it stays one tap away, «Transcripción», since it is what the agent read.

My calls, stated so they can be undone:

- **Read ticks**: two blue ticks when everyone else in the chat has read your message, never who; one tick otherwise. It relaxes the rule in `follows_thread` that nobody learns another's read marks, to this one aggregate, as WhatsApp does in a group.
- **No new native module** in phase 1: the gestures (hold, slide, swipe) use React Native's own responder, as the decision deck does, so it ships over the air. The waveform comes from the recorder's metering, kept on the note (`VoicePart.waveform`, optional; older notes draw a steady one from their id).
- **The mic and send share the round button**, as in WhatsApp: the mic while the box is empty, send once there is text. It replaces the composer's mic beside send.

## Phase 1: the look and the audio (`feat/chat-look`)

- `components/chat/Bubble.tsx`: the bubble (side, tail on the first of a run, the sender's name and colour in a group, the time and ticks inside), used by people and agents alike.
- `components/chat/DaySeparator.tsx`, `lib/chat.ts` (`dayLabel`, `withDays`: the list with its separators and the unread divider).
- `components/chat/VoiceNote.tsx`: play, waveform (drag to seek), length, speed, the unplayed dot; no transcript in General; «Transcripción» behind a tap in an agent's chat.
- `components/chat/Composer.tsx`, `lib/hooks/useVoiceNote.ts`: one round button (mic or send); hold to record, slide left to cancel, slide up to lock; locked: timer, live waveform, bin, pause/resume, send; the recorder's metering kept as the waveform.
- Read ticks: `supabase/migrations/<ts>_read_ticks.sql`, `thread_read_by_all(thread)` (for each of the caller's own messages, whether every other reader has read it), and its pgTAP test.
- The scroll button with the count of new messages; the unread divider from the person's read mark when the chat opened.
- Jest for the day labels, the list with separators, the bubble's time and ticks, the composer's hold, slide and lock; the Maestro flows that tap the old mic or look for the old layout updated.

Phases 2 to 4 are written against that day's code when each starts.
