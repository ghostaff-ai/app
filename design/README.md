# Design

Working files for the look of Ghostaff's characters. The decisions so far are in
`docs/plans/ideas/gamification.md` (on `develop`).

- `concepts.py` draws concept pictures from a round file in `concepts/` with a Gemini
  image model. Key: `GEMINI_API_KEY_DESIGN` in `secrets/inventory.yml`, written to
  `design/.env` by `secret env ghostaff-ai/app`.
- One round = a few different ideas, one picture each, so Álvaro can judge them before
  anything is drawn in bulk.
