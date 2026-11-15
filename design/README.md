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
triangles (60,000 left the collar edges ragged), 2048 px textures, about 5 MB each.

```bash
rclone copy drive-ghostaff:ghosts/tripo ~/Downloads/tripo/models
blender -b -P design/blender/tripo.py -- ~/Downloads/tripo/models
```

The app's `/fantasma` screen shows them with a Tripo / Nuestro switch
(`TripoScene.tsx`). A Tripo model is one solid piece: it spins, floats and hops as a
whole and its hem ripples (in the shader), but its arms and eyes don't move on their own. A "Tono" switch tries it darker (A as Tripo made it, B and C darker).
