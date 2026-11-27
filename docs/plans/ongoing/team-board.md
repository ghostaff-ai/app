# Equipo as a board of ghosts, and the agent's page first

**Priority:** high — Equipo looked like a list of chats, so the product reads as «another ChatGPT» (Jaime and Álvaro, WhatsApp audios of 2026-11-26)
**Gate:** none
**Next:** Jaime looks at it on the branch `feat/team-board` (local stack, web at phone width) before it lands

Jaime, 2026-11-27, after three rounds of mockups in a session: «tiene que quedar en la pantalla principal más claro los agentes que tienen, lo que están haciendo, en el medio las decisiones, igual que hasta ahora, y luego además cuando entras en los agentes, pues que también salgan las decisiones, si tienes que hacer algo, lo que ha hecho [...] y si le das a escribir, que te saliese ya un chat con él». It follows the founders' audios of 2026-11-26: Álvaro «quitamos la lista de chats y ponemos a los fantasmas en una oficina»; Jaime «no tiene que ser una lista de chats [...] tienen que ser más entidades [...] el fantasma que quiera decir algo, que tenga una notificación arriba». The approved mockup is a picture, not in the repo: `~/Desktop/ghostaff/capturas/propuesta-equipo-2026-11-27.png` (and its `.html`).

## Decisions (Jaime, 2026-11-27)

1. **The tabs stay Equipo · Decisiones · Empresa**, Decisiones in the middle. No talk button in the bar: the mic lives in each chat.
2. **Equipo on a phone, top to bottom:** General first (the people's chat, as today: once there are two people), then the main agent (Secretaría) as a wide card that opens her chat (its line: what she has for you, else the last thing said in her chat, signed, else her job), then the other agents **large, two per row**, each its ghost on a small stage with its department's light. The last tile is «Contratar», as simple as today's «Añadir agente».
3. **What each ghost is doing shows above it**, one tag: «Te espera» when a decision of theirs waits (with how many when more than one), else «Trabajando…» while a run or a reply is under way, else «Nuevo» when its chat has something unread, else nothing. Signal colour only for «Te espera».
4. **A tap on an agent opens its page, which starts with what matters**: the ghost in 3D with its tag, its decisions waiting (tap one to answer it), «Últimamente» (what its runs of the last 7 days say they did, newest first), and a main button «Escribir» that opens its chat. The settings (Rutinas, Memoria, Quién puede, Herramientas, Quitar) follow below, as today.
5. **No @ inside an agent's chat**: everyone there is talking to that agent, which already answers any message that mentions nobody (`whoAnswers`, team-chat decision 9). @ is for bringing another agent in, from General or from another agent's chat.
6. **The desktop keeps its list**: the column beside the open chat stays `TeamList` (desktop-web.md, decision 5).
7. **Secretaría needs another name** (Jaime and Álvaro, 2026-11-26). Not this plan: the name is the founders' to pick.

The ghosts' stage could be more 3D (Jaime: «me falta como algo más 3D, pero bueno, está bien»); the page's ghost is already the live 3D model.

## Tasks

- [ ] `agentStatus` (pure, unit-tested): waiting decisions, working, unread → the tag.
- [ ] Data: open decisions by agent (`useInbox`), working agents (`agent_runs` running, `messages` working), the agent's recent runs (new `listAgentRuns`, RLS already lets whoever sees the agent read them).
- [ ] `components/team/`: `GhostStage`, `AgentTile`, `LeadCard`, `GeneralCard`; `TeamBoard` for the phone's Equipo, keeping the test IDs the end-to-end flows use (`general`, `agent-secretaria`, `add-agent`, `no-ai`).
- [ ] The agent's page: the overview on top and «Escribir».
- [ ] Jest for the status and the board; check on the web at phone width against the local stack.
