# Decision deck: find the card that frees the most attention, before Hoy ships it

**Priority:** medium — the decision card is what Hoy is made of (app-design.md, decisions 5–13), and it has not been tested on a person yet
**Gate:** blocked:Álvaro answers round 1's last 3 cards ([deck](https://claude.ai/artifact/TmAXYZULsg4dYPhyvSSnrx))
**Next:** once cards 7–9 are answered, finish round 1's row and shape round 2 from card 9 (the research rules)

Álvaro asked (2026-11-21) for a way to take decisions that leaves him the most attention: things he can see (a picture when it helps), always a choice with the preferred option pointed out, and in Ghostaff something as easy as swiping. We test it now, on his real decisions, with agent-skills' `decision-deck` skill (a claude.ai page with the cards in a store), and Ghostaff takes the shape that wins. The cards use the same fields as Hoy's card and Órdago's `por-decidir`, so nothing has to be rebuilt.

## The tension to settle with numbers

app-design.md decision 7 says **no swipe to answer**; swipe-to-hire.md wants swiping. Round 1 alternates: odd cards swipe (right takes the pick), even cards use named buttons. Swipe is only ever offered on a decision that can be undone.

## What the research says (2026-11-21, desk research, 20 sources)

- **Overload is conditional.** The jam study's effect averages out to about zero across 50 experiments (Scheibehenne 2010). It does happen when there is no clear best option, time is short, preferences are unformed and one must be picked (Chernev 2015): an agent's decision has all four. Keep 2–3 options, one marked.
- **A marked pick works as a default** (Jachimowicz 2019, d≈0.68, larger when it reads as an endorsement), and explanations raise acceptance whether the AI is right or wrong (Bansal 2021). Asking for the human's pick before showing the agent's cuts over-reliance (Buçinca 2021), at a cost in pleasantness. Use it only on high-stakes cards.
- **One checkable reason** helps; a reason that is hard to verify does nothing (Vasconcelos 2023).
- **Order biases a swiping queue:** acceptance fell about 27% from first to last profile (Pronk & Denissen 2020). Keep queues short, put the weightiest first, or shuffle.
- **Decision fatigue did not replicate** (Hagger 2016; Vohs 2021). The reason for short queues is time and order drift, not depletion.
- **In practice:** swipe is hard to discover and read as destructive (NN/g), so every swipe has a visible button and an undo; HEY's Screener and Linear's triage keep every answer reversible and offer «snooze».
- Sources: [Chernev 2015](https://doi.org/10.1016/j.jcps.2014.08.002), [Pronk & Denissen 2020](https://doi.org/10.1177/1948550619866189), [Buçinca 2021](https://arxiv.org/abs/2102.09692), [Vasconcelos 2023](https://arxiv.org/abs/2212.06823), [Bansal 2021](https://arxiv.org/abs/2006.14779), [NN/g on swipe](https://www.nngroup.com/articles/contextual-swipe/), [Linear triage](https://linear.app/docs/triage), [HEY Screener](https://help.hey.com/article/722-the-screener).

## What each round measures

Per card: seconds to answer, whether the context was opened, whether the pick was taken, swipe or button, take-backs, «Decide later». Over rounds: whether the pick is taken more on swipe cards (rubber-stamping), and whether take-backs follow fast answers.

## Rounds

| Round | Date | Cards | Shape | Median s | Picks taken | Context opened | Taken back |
|---|---|---|---|---|---|---|---|
| 1 | 2026-11-21 | 6 of 9 so far | swipe on odd cards, buttons on even; swipe-to-hire's 4 questions and the deck's own 5 | 10 (first card 237, reading the page) | 6 of 6 | 0 | 0 |

Round 1, first 6 cards: **he never swiped.** On all three swipe cards he pressed «Take my pick →». On the computer with a mouse, the button beside the card won; swipe has to be tried on the phone before it counts. Every pick taken, no context opened: either the cards were clear or the pick was rubber-stamped (open question 1).

## Open questions an experiment should answer

1. Does the marked pick get taken more on swipe than on buttons, and is it then taken back more?
2. Where is the stakes line above which «your pick first» pays off?
3. Does a picture beat text, or only when the decision turns on a quantity or time?
4. Is opening the context a sign of engagement or of a badly written card?
