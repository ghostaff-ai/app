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
model has no colours: the glow is the app's own shader. Hunyuan3D is not an option for
this: its licence excludes the EU (`docs/plans/ideas/gamification.md`).
