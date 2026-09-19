# Labeling the gold set

You're writing the answer key the extractors get graded against. **Read the raw forecast text yourself. Do not open the Shore app while labeling** — if you copy what the app shows, the eval grades our code against itself and proves nothing.

## Setup (5 minutes)

1. Open `eval/gold-template.csv` on GitHub → **Download raw file**.
2. In Google Sheets: **File → Import → Upload**, then pick the file.
3. Split the rows: one person takes the **odd** items (G01, G03, …), the other the **even** items (G02, G04, …). That spreads the slower prose items evenly.

## For each row

1. Open the forecast named in `file` — on GitHub, it's in `data/samples/`.
2. Find the zone: search the text for `zone_id` (e.g. `NCZ205`). The zone name appears right below it.
3. Find the `period` inside that zone's section — lines like `.REST OF TODAY...` or `.MONDAY...`.
4. If `sub_area` is filled in, use only that sub-area's line (e.g. `North of Cape Hatteras...Moderate.`).
5. Write the value for `field` into `gold_value`, using the formats below. Put your name in `labeler`.

## Allowed values

| field | write | examples |
|---|---|---|
| `ripCurrentRisk` | `None`, `Low`, `Moderate`, `High`, or `ABSENT` | `Rip Current Risk*...Moderate.` → `Moderate` |
| `thunderstormPotential` | `None`, `Low`, `Moderate`, `High`, or `ABSENT` | `Thunderstorm Potential**....None.` → `None` |
| `surfHeight` | `min-max` in feet, or `ABSENT` | `2 to 3 feet` → `2-3` · `Around 4 feet` → `4-4` · `1 foot or less` → `0-1` · `Less than 1 foot` → `0-1` |

## The one rule that matters most

**Label only what the text explicitly states. If the forecast doesn't state it for that period, write `ABSENT`.**

- Prose periods like `.MONDAY...Surf height around 2 feet. Mostly sunny.` state surf (`2-2`) but **no rip current risk** → `ABSENT`.
- `A chance of thunderstorms` is not a stated category → `thunderstormPotential` is `ABSENT`. Don't infer "Low" or "Moderate" from wording.
- If surf changes during the period (`Around 2 feet, subsiding to around 1 foot`), use the full range: `1-2`.

The `ABSENT` rows matter most. They test whether the AI invents values that aren't there — the failure we most need to catch.

## If you're unsure

Write your best answer and explain in `notes`. Disagreements between labelers are useful data, so don't guess silently.

When done: **File → Download → CSV**, and send it to Daksh to commit as `eval/gold.csv`.
