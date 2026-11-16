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
look per model, minus the bun and the hands, above Productor's headphones; Redes' beret covers the place).
The objects painted into a whole ghost come out soft, with crooked letters, so
`swap.py` also makes a second copy, `<name>-swap.glb`, with Tripo's own model of each
object (the lone ones assemble.py uses, in the same Drive folder) in its place: same
spot, size and turn, measured from the old object's front face. The old one never
shows next to the new: one held in a hand (calculator, clipboard) or as thin as a
badge is pushed back inside the new one (the fingers in front stay); a worn one with
a different outline (the pocket and its pen) is pressed flat into the body and painted
over in the body's colours round it (Tripo's mesh is in loose pieces, so "round it" is
found by distance). Real letters go on top ("HOLA / Soy Gus", "1.250,00",
"FINANZAS"). Done for Incorporación and Finanzas (`SWAPS`); the app's "Objetos" switch
shows either copy. The ties and collars stay Tripo's.

Where each new object sits can also be set by hand (Álvaro, 2026-11-16) on the
placing page (the Taller; its first tab, "Ver resultado", shows every finished
ghost with the app's own shader, lights and movement, with switches for the
objects, the tone and the smoothing; the models without smoothing come from
`TRIPO_NO_MARKS=1 TRIPO_OUT=<dir> blender -b -P design/blender/tripo.py -- <src>`), a Claude artifact (https://claude.ai/artifact/So36Lc9dohc8gz2i7JDgin):
each ghost as Tripo made it with the new objects where `swap.py` puts them, to move,
turn and size, plus two boxes drawn from the front: fingers that stay in front, and
more of the old object to hide. `placing.py` makes its files (the page serves no
`.glb`, so each model goes as a script holding it in base64); what is saved there is
fetched as JSON and turned into `design/blender/place.json` by `place_from_page.py`,
which `swap.py` reads before its own guess. Finanzas' three objects, placed by hand over the old ones, already hide them, so the old ones stay as they are (`keep_old`; pushing and pressing them away spoilt it). The same page has a second tab,
"Marcar fallos", with all six ghosts: Álvaro paints over flaws, each stroke tagged
line, smudge, spikes or other, with a note, and saved as points in Blender's space
(`marks` in the page's store). Each kind gets its own fix (blend the colours across,
repaint from round it, smooth the shape, look by hand); a kind that keeps coming
back gets a finder of its own, as the head line did. First round (2026-11-16, Finanzas' collar edges and eye
rims, one spot on Incorporación): the roughness was Tripo's normal map, not the
shape, so `tripo.py` flattens the bumps under each stroke (`marks.json`, from the
page's saved marks; `touchup.smooth_marks`). Other tries (more detail kept, the colour blended, the shape
smoothed gently or freely) are made with `TRIPO_FIX` and shown side by side on the
Taller page's "Arreglo de tus marcas" switch. Álvaro picked **Más detalle**
(`detail`, now the default): what he saw as rough was our cutting of triangles
on the collar and round the eyes, so those keep their full detail.

**Lighter copies** (`design/blender/light.py`, 2026-11-16): Tripo's ghosts are a
dense, even mesh with the detail in the shape; an artist would use a simple shell
and put the detail in pictures. `light.py` does that to a built model: the body
cut evenly to N triangles, unwrapped afresh, and the full model's colour, relief
and shine baked onto it (the swapped objects cut to a quarter). Incorporación goes
from 820,000 triangles to 25,000 or 60,000; the file only from 2.2 to about 1.3 MB,
since the pictures are most of it then. On the Taller page's "Peso" switch for him to judge.

```bash
blender -b -P design/blender/light.py -- design/tripo/incorporacion.glb <out.glb> 25000
```

**Visual tries go to Álvaro, not the bin** (2026-11-16): every attempt at a visual
fix is put in front of him to compare, the ones that look worse included; say
which you'd pick and why, and let him decide.

```bash
blender -b -P design/blender/placing.py -- ~/Downloads/tripo/originals <out>
blender -b -P design/blender/place_from_page.py -- <folder of saved placements>
```
Geometry is Draco-compressed (Blender's own encoder; the app decodes it with three.js's decoder in `apps/mobile/public/draco/`), 0.9 to 2.3 MB a model.

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
blender -b -P design/blender/eyes.py -- base,secretaria,redes,incorporacion,finanzas,productor
```

Since 2026-11-15 (Álvaro: the assembled ones "don't look that good") the app shows
the whole models again, all six (Productor's whole model came on 2026-11-16; Tripo
made it looking along -Y, so `TURN` in `tripo.py` turns it to the front). The arms of
a whole model don't move on their own.

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
