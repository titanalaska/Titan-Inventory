# Count mode — verifying the yard against the sheet

Design, 2026-09-19. Matt Walsh, Nursery & Field Operations Manager.

## The problem

The last nursery audit was 21–22 July 2026. Two months on, its numbers cannot be
trusted: material has moved between jobs (55 Yellow Potentilla off Baxter and 2
birch off Charter, both pulled to WSRCC because it starts first), deliveries have
landed, and a season of pulls has run through the yard.

That matters right now because Chris Dietrich has asked for a full 2027 tree and
shrub list "so we can compare with our inventory once we are done this fall."
That comparison — gross demand minus what Titan already owns — is the whole value
of the exercise, and it is worthless run against a stale count.

There is a second, deeper problem. The July audit is not merely old; it is
**unreadable**. Nothing in the sheet distinguishes a line somebody counted and
found correct from a line nobody ever looked at. Both just show a number. Any
audit that only records discrepancies recreates this failure on the day it is
finished.

## What this builds

A **Count** screen in the Titan Inventory PWA: a search box and a number pad.
Stand at a pallet, type three letters, pick the plant, punch the number, commit.

It is deliberately not a zone walk and not a list to step through.

## Why not a zone walk

The obvious design is to ride the existing zone navigator — open a zone, step
through its items. It was rejected for a physical reason.

The nursery is still on pallets, arranged loosely, pending the Maui lot being
cleared so the yard can be laid out properly. Matt has been consolidating pallets
toward one species each, but mixed pallets remain — roses and lilacs especially.

So the unit of the walk is the **pallet**, not the zone and not the species. You
count whatever is in front of you. A species can appear on three pallets and a
pallet can hold three species. Any UI that walks a predetermined list fights the
yard instead of following it.

This also means location capture is out of scope — see below.

## The central decision: Add or Replace

A species spread over three pallets is counted 12, then 8, then 6. The answer is
26. Naive "correct it on the spot" replacement leaves 6.

An earlier draft inferred intent from an item's last-audited date: audited before
today means replace, audited today means add. **This was rejected as dangerous.**
Count roses Monday to 26, find a missed pallet Tuesday, enter 6 — the rule
replaces and you silently have 6 roses. It looks like it worked.

Any rule that infers whether a count starts fresh or continues will eventually be
wrong, and will be wrong without saying so.

**So the app never infers.** The commit control is two buttons:

    [ Add to 26 ]      [ Replace with 6 ]

The operator picks one, every time. This costs nothing in the field — a button
was being pressed either way; it now states what it will do. It needs no session,
no dates, and no in-progress flags, and it behaves identically whether you come
back in ten minutes or three weeks. The multi-day resume problem disappears
because there is no state to resume.

## Verification is recorded, not just discrepancy

Every commit stamps the item as verified, whether or not the number changed.
Without this, the July failure repeats: a correct count and an unvisited line
remain indistinguishable.

Matches stamp the date and write **no** Change Log row. A walk of 86 plants must
not bury the log under 80-odd no-change entries. The stamp carries the fact that
somebody looked; the log carries the fact that something moved.

## Data model

The items sheet currently uses columns 0–10:

    0 id   1 category   2 name   3 qty   4 specs   5 estimated
    6 location   7 who   8 stamp   9 unit   10 photo

Two new columns:

    11 lastAudited    ISO date of the most recent verification
    12 auditedBy      name from the signed-in profile

These **must** be separate from columns 7 and 8. Those are written by
`bulkPull_` on every pull, so a pull would otherwise masquerade as a
verification — exactly the ambiguity this is meant to remove.

`plantType()` is derived client-side from the item, not stored, so a plant added
during a walk needs only name, category and specs to file itself correctly in the
zone tree.

## Backend

New actions on `doPost`, following the existing `bulkPull_` pattern —
`guard_(token)` for auth, `LockService` around the read-modify-write, one batched
Change Log write:

- **`auditCount`** — `{token, id, n, mode}` where mode is `add` or `replace`.
  Reads current qty, applies, writes qty plus columns 11 and 12. Logs an `AUDIT`
  row only when the value changed: `counted +8 — 12 → 20`.
- **`auditUndo`** — `{token, id, restore, expect}`. Sets qty back to `restore`,
  the value from before that entry. It takes the value rather than a delta
  because a delta cannot undo a Replace: reversing 40 → 12 means restoring 40,
  and the delta alone does not know that. `expect` is the value the entry left
  behind; if the sheet no longer holds it, someone else has touched the item in
  the meantime and the undo is refused rather than silently discarding their
  change.
- **`auditAdd`** — `{token, name, category, specs, n, unit}`. Creates an item and
  logs an `AUDIT` row recording that it was found in the yard rather than
  ordered.

The lock matters for the same reason it does on pulls: two phones must not both
read the same "before."

## Frontend

- **Count screen.** Search field, results as you type, number pad, two commit
  buttons. Landing on a species already touched shows its current count, so a
  double-count is visible rather than silent.
- **Recent entries**, newest first, each with a one-tap **undo**. Session-local:
  the Change Log holds the durable trail, these buttons are a convenience for
  fixing a fat-fingered number in the moment.
- **Add plant** for anything unlisted.
- **Stale filter** on the main item list — "not verified in 60 days." This is the
  part that stops the audit expiring the way July's did. A one-time count is a
  snapshot; a date on every line is a standing answer to what has not been seen.
- **Bilingual.** The app carries EN/ES strings throughout; roughly a dozen new
  ones are needed.

Writes post immediately with the UI updating optimistically, so tapping never
blocks. A failed write marks that row quietly and retries. Signal at the nursery
was confirmed adequate, so no offline queue is built.

## Out of scope

- **Location capture.** The audit is the one time somebody stands at every pallet,
  which makes it the cheapest moment to record where things are — the zone
  navigator currently cannot do better than "104" for 129 items. It is excluded
  anyway: the yard is mid-reorganisation pending the Maui lot, and pallet
  locations captured now are locations about to change. Revisit once the yard is
  laid out.
- **Offline queue.** Signal is adequate.
- **Draft or commit-at-end model.** Explicitly rejected — counts go live as they
  are entered. A walk abandoned halfway leaves counts better than it found them,
  and anything unreached keeps its old value and stays flagged unverified.
- **Session or walk objects.** Made unnecessary by the Add/Replace decision.

## Risks

- **Undo is session-local.** Close the app mid-walk and the per-entry undo
  buttons are gone. The Change Log still has every before→after, so nothing is
  unrecoverable, but the recovery is manual.
- **Add/Replace is a decision per entry.** It is the right trade — explicit beats
  silently wrong — but it is a decision made hundreds of times in a cold yard.
  Button labels must state the resulting number, not just the verb, so the choice
  can be made by glance rather than by thought.
- **`auditAdd` can create duplicates** under a slightly different name. Search
  results should surface near-matches before the add path is offered.

## Testing

- Add and Replace each produce the right arithmetic and the right log row.
- A match stamps columns 11 and 12 and writes no log row.
- Undo restores the previous value and logs the reversal.
- Two concurrent commits on one item do not lose an update.
- A walk left overnight and resumed behaves identically to one resumed instantly.
- Stale filter selects on column 11, and an item never audited reads as stale
  rather than as fresh.
