# Design

Working files for the look of Ghostaff's characters. The decisions so far are in
`docs/plans/ideas/gamification.md` (on `develop`).

- `concepts.py` draws concept pictures from a round file in `concepts/` with a Gemini
  image model. Key: `GEMINI_API_KEY_DESIGN` in `secrets/inventory.yml`, written to
  `design/.env` by `secret env ghostaff-ai/app`.
- One round = a few different ideas, one picture each, so Álvaro can judge them before
  anything is drawn in bulk.

## The 3D ghost (Blender)

The ghost the app shows is modelled by a script, not by hand: `design/blender/ghost.py`
builds the body, the arms and the Secretaría's props in Blender, run headless, and writes
the meshes the app loads (`apps/mobile/components/ghost/models/*.json`), plus
`ghost.blend` and `ghost.glb` for opening in Blender or another 3D tool, and preview
renders in `design/blender/renders/`.

```bash
blender -b -P design/blender/ghost.py -- --render
```

Blender 5.2 comes from the workstation setup (homelab `personal/workstation.yml`). The
model has no colours: the glow is the app's own shader. Each prop follows a picture
of it drawn alone (`design/concepts/props-round1/`), which shows its shape far more
clearly than the full character does. Hunyuan3D is not an option for
this: its licence excludes the EU (`docs/plans/ideas/gamification.md`).

**Nothing passes through anything else** (Álvaro, 2026-11-14): a prop held against
the head sits a small gap off it, a hand closes on what it holds without it coming
out the other side, and props never cross one another. Props held in a hand are
built in that arm's frame so they move with it, and an arm holding something to
the body does not fling up on a hop. After changing a model or a pose, check it:

```bash
blender -b -P design/blender/clash.py -- secretaria,redes
```

## Tripo's models

Since 2026-11-15 Álvaro also turns his pictures into 3D with Tripo
(studio.tripo3d.ai, account ghostaff.ai, Pro plan: models made on it are private and
ours to use; one coloured model costs 55 credits). Each ghost and each prop is made
from one picture, exported as GLB and dropped in the Ghostaff Drive; the originals
(about 1.2 million vertices, 50-70 MB each) stay there, in `ghosts/tripo/`.
`design/blender/tripo.py` makes the light copies the app loads, in `design/tripo/`:
turned to face the front, 1 unit tall standing on the ground, about 150,000
triangles (60,000 left the collar edges ragged), 2048 px textures. Fine places stay
at full detail (`KEEP` in `tripo.py`: the eyes, and the shirt collars of Finanzas and
Incorporación), because cutting them turned a collar's thin top edge into a fringe of
spikes and the eye rims ragged; those models end up at 200,000 to 520,000 triangles.
Where Tripo's views of a ghost meet on its head, the colour (and its normal map) jumped
in a hard line from front to back; `touchup.py` finds that jump and repaints a band
about 3.5 cm wide round it with colours that run smoothly across (`SEAMS`: where to
look per model, minus the bun and the hands; Redes' beret covers the place).
The objects painted into a whole ghost come out soft, with crooked letters, so
`swap.py` puts Tripo's own model of each object (the lone ones assemble.py uses, in
the same Drive folder) in its place: same spot, size and turn, measured from the old
object's front face. A held one (calculator, clipboard) is cut away first; a worn one
(badge, pocket) is pressed flat into the body, so no hole opens where the outlines
differ. Real letters go on top ("HOLA / Soy Gus", "1.250,00", "FINANZAS"). Done
for Incorporación and Finanzas (`SWAPS`); the ties and collars stay Tripo's.
Geometry is Draco-compressed (Blender's own encoder; the app decodes it with three.js's decoder in `apps/mobile/public/draco/`), 0.9 to 2.2 MB a model.

```bash
rclone copy drive-ghostaff:ghosts/tripo ~/Downloads/tripo/originals
blender -b -P design/blender/tripo.py -- ~/Downloads/tripo/originals
```

The app lights them with softer reflections than our own ghost (`StudioLight
blur`): sharp, the studio's light panels showed as a white stripe down every head.

The app's `/fantasma` screen shows them with a Tripo / Nuestro switch
(`TripoScene.tsx`). A Tripo model is one solid piece, so it comes alive as a whole,
in the shader: it sways like jelly (the top more than the hem, so what it holds sways
with it), the hem ripples, it breathes, squashes and stretches as it hops, and its
painted eyes blink. `design/blender/eyes.py` finds each model's eyes in its texture
(two dark ovals on the front of the head) and writes `design/tripo/eyes.json`, which
the app reads; a new model needs one run of it. A "Tono" switch tries it darker (A as
Tripo made it, B and C darker).

```bash
blender -b -P design/blender/eyes.py -- base,secretaria,redes,incorporacion,finanzas
```

Since 2026-11-15 (Álvaro: the assembled ones "don't look that good") the app shows
the whole models again; only Productor, which has no whole model yet, is the
assembled one. The arms of a whole model don't move on their own.

### Where this is going (Álvaro, 2026-11-15: "the best option for long term")

Every agent is assembled from the same parts instead of being one Tripo model each:
Tripo's bare base ghost, cut by Tripo's Segment tool into body and two arms (holes
closed with Fill Parts, Quick Cap), plus each agent's objects, each made alone by
Tripo from a Gemini picture of just that object (`concepts/agents-props-round1/`,
drawn with no text). Blender puts them together per agent: objects held in a hand
hang from that arm, so they move with it; worn ones (collar, scarf, jacket) sit on
the body. Labels and digits (calculator keys, badge, pocket plate) are added in
Blender as real text, since Tripo paints letters crooked. The arms then swing and
the eyes blink in the app as on our own ghost.

Built (2026-11-15) by `design/blender/assemble.py`, then set aside the same day for the
whole models, which look better (see above):

```bash
rclone copy drive-ghostaff:ghosts/tripo ~/Downloads/tripo/originals
blender -b -P design/blender/assemble.py -- ~/Downloads/tripo/originals            # all agents
blender -b -P design/blender/assemble.py -- ~/Downloads/tripo/originals try finanzas   # just renders
```

Each agent's arm poses, objects, where they sit and their text are in its `AGENTS`
entry; `FIX` squares up an object Tripo made turned. Worn things are fitted round the
body and pushed out of it, so nothing passes through. Out: `design/tripo/agents/<agent>.glb`
(what the app loads) and a picture of each in `design/tripo/agents/renders/`.
