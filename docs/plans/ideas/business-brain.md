# The business brain: a catch-all you can ask anything

**Priority:** medium — not a new engine, but it may be the clearest way to explain what Ghostaff is for a small business
**Gate:** decision:whether this is mainly a feature, the way we tell the product, or both (see Open questions)

Jaime's idea (2026-11-18), written down loosely. Don't treat any detail here as decided.

## Goal

The owner of a small business or organisation sees Ghostaff as the business's personal assistant. They put anything about the business into it, and it can answer any question about the business.

## Context

- **Where it comes from:** at Órdago we have a business repo with a `business.md`. Jaime keeps putting every business document in it, and it can then answer any business question. The idea is to give every organisation that, and make sure they understand they have it.
- **Most of it already exists:** this is the **record**. It is the organisation's shared memory, in files with history, and the Incorporación agent already builds the first version from the links and documents people paste (AGENTS.md; [build-first-version.md](../ongoing/build-first-version.md)). There is a Registro tab, and the mic opens a thread with Secretaría.
- **What is missing:** a clear way in for "drop anything here" at any time, not only during onboarding, and for "ask me anything about your business". Plus a message that makes the owner get it.

## The idea

1. **A catch-all.** At any moment, the person drops in whatever they have: a PDF, a photo of an invoice, a link, a voice note ([voice.md](voice.md)), loose text. They don't sort it. An agent files it in the right place in the record and says where it went.
2. **Ask your business.** Any question («¿cuánto facturamos en octubre?», «¿con qué gestoría trabajamos?», «¿qué acordamos con el proveedor X?») gets an answer from the record, with a link to the source. It is the same loop as the weekly summary, where every sentence links to its source.
3. **Telling the product.** In onboarding and on the landing page, present Ghostaff first as the business's memory and assistant, and then as the team that does the work. The team becomes more useful the more you put into it.

## Open questions

1. **Feature, message or both.** Most of it might be explaining better what the record and Secretaría already do, rather than building something new.
2. **Where the catch-all lives in the app:** inside the mic and chat with Secretaría, in the Registro tab, as a share target from other apps (share sheet), or as an email address per organisation.
3. **Who files things:** Secretaría, Incorporación, or the department the item belongs to.
4. **Privacy within the organisation:** whether something dropped in by one person is visible to everyone, or follows the read and talk levels per agent from [team-chat.md](../ongoing/team-chat.md).
5. **The product plan:** if the message changes, `ghostaff-producto.md` in `ordago-app/business` should say so too.
