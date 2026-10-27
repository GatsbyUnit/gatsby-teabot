> Historical: the plan from the start of the project (October 2026). What was built is described in `docs/handbook.md`.

# Gatsby Tea system: implementation and transition plan

Owner: the TNJC organiser. Approved by the tea tsar on 2026-10-27. Access: via the tea tsar (bot accounts, 2FA) and the unit admin (calendar, mailing lists).

## Constraints
- **Google only, no server.** Everything runs as Apps Script owned by the shared gatsby.tea account, never by a personal account, so it survives handovers. Secrets go in Script Properties. A "Tea bot log" Google Sheet records every action and dry-run diff, so tsars can see what happened without going to GitHub.
- **GitHub for code.** One repo, ideally in a GitHub org with at least two admins rather than a personal account; we can ask Kevin to transfer `KevHH/gatsby_tea_scheduling`. Layout:
  - `scheduling/`: the existing Python script, plus tests
  - `apps-script/`: clasp projects
  - `docs/`: the handbook
- **Deployment.** Deploy with `clasp push`, manually at first. Later, optionally a GitHub Action with gatsby.tea clasp credentials stored as a secret, plus branch protection, because anyone who can merge can then run code as gatsby.tea. Once GitHub is the source, nobody edits in the Apps Script editor, or the next push overwrites it.
- **The system is shared.** Research and tea talks, MLJC, TNJC and coffee all use the same Notion databases, form and bot. Every component filters by `Type`, rolls out for TNJC first, and is widened after one clean cycle.

## What we already know about Notion (from the public schema)
- **Schedule:** Title, Date, Type, Presenter (relation), Tea (relation), CSNJC, Description, **GCal ID**. Each row is already linked to its calendar event, so sync and reconciliation can match by ID, not by fuzzy name matching.
- **People:** Name, Active, TNJC, CSNJC, MLJC, Coffee, the exclusion flags, Away Date Sheet, and logs. **There's no email column in the public view.** We need to find where the registered emails live.
- **Rule to keep:** talks with a "[Tentative]" title can't be changed through the form.

## Components
| # | Component | What it does | Risk |
|---|---|---|---|
| 1 | Swap links | Adds "Can't make it? Swap here" and "Add/edit title" pre-filled links to event descriptions and bot emails. Needs a template change in the finalizing script and a one-off backfill of future events. | Low |
| 2 | Swap form v2 | Two dropdowns, "Which slot?" (upcoming slots from Notion) and "Who's taking it?" (active people for that type), both showing names only. Rebuilt daily. Its own `onFormSubmit` handler updates the Notion Presenter or Tea field **and** the calendar event (via GCal ID), then emails both people. | Medium |
| 3 | Reconciler | Hourly. Uses the Calendar API `syncToken` to fetch only changed events, then compares each title with the one Notion implies. A different registered person is treated as a swap and goes through the same code path as the form. An unknown name is treated as a guest and goes into the new `Guest speaker` field. Starts in report-only mode. | Medium |
| 4 | Notion → Calendar sync | Daily. Rewrites future events from Notion, but only events whose ID is in Notion; hand-made events are never touched. Must reproduce the current title and description format exactly. Runs **after** the reconciler, so manual edits are pulled into Notion before they could be overwritten. | High: writes to the shared calendar |
| 5 | Organiser reminders | Emails the organiser when the schedule has 3 weeks left ("run scheduling"), at the start of term 3 ("add first years"), and in Sept/Oct ("remove graduates"). Presenter reminders already exist; we only add the swap and title links to them. | Low |
| 5b | Change registered email + calendar-based away dates | A sign-in form records the person's verified Google address, and a confirmation link goes to the old address before the change applies. Optionally the person shares free/busy with gatsby.tea, and the scheduler counts them away if they're busy at the slot time. Open question: regular meetings count as busy too. | Medium |
| 6 | Handbook | A non-public "Organiser handbook" sub-page of the TNJC Guide, plus `docs/` in the repo. Covers access, the scheduling run, deployment, and the names of Script Properties (not their values). | None |
| 7 | (Later) One-click scheduling | Port the scheduling algorithm (about 100 lines) to Apps Script, with GitHub Actions checking that it gives the same output as the Python version on past data. This replaces the 13-step Colab/finalizing routine with one menu action. | Medium |

Notion change needed: add a `Guest speaker` text property to Schedule. This is additive and shouldn't break the existing scripts, but check that they don't iterate over every property.

Can't automate: adding people to the `gatsby-tnjc` Google Group. Consumer googlegroups.com groups have no API, so this stays manual and goes in the handbook.

## Transition
**Principles:**
- Changes are additive.
- New pieces run in shadow mode before they write anything.
- One switch at a time, each with an `ENABLED` Script Property as a kill switch.
- The old form, finalizing script and manual steps keep working until the new path has survived one full scheduling cycle.

**Phase 0: buy-in, access, backup (this week)**
1. Send the proposal (`docs/pitch.md`) to the tea tsar and agree the scope, including whether to change the shared form for all rotas.
2. Get access to gatsby.tea and gatsby.teabot, and Notion edit rights (via the tea tsar).
3. **Inventory and backup before touching anything:**
   - `clasp clone` every Apps Script project in both accounts into the private repo.
   - Note where the scheduling run happens (probably Colab).
   - Export the Notion databases to CSV and the calendar to ICS.
4. Answer the open questions below and write the first handbook draft.

**Phase 1: quick wins, around the next scheduling run (~mid-Nov)**
- Add swap and title links to the finalizing-script template, backfill future TNJC events, and add the links to bot emails. (Component 1)
- Turn on the organiser reminders. (Component 5)
- Publish the handbook.

**Phase 2: shadow mode (2–3 weeks)**
- Run the reconciler and sync in dry-run mode, writing to the log Sheet only, and check their diffs against reality each week.
- Test real writes on a **copy** of the calendar first.

**Phase 3: switch over, TNJC first**
1. Go live with swap form v2 and announce it to `gatsby-tnjc`.
2. After 2 weeks, close the old form with a message that links to v2. This needs the tea tsar's agreement, since the form is unit-wide.
3. Reconciler goes live, emailing the organiser for every action it takes.
4. Sync goes live for `Type = TNJC`, and the "update the calendar manually" step comes out of the handbook.

**Phase 4: widen and review (next scheduling run, ~Jan)**
- Do the January scheduling run on the new path.
- If it's clean, extend to the other types together with their organisers (MLJC, coffee, and the tea tsar for tea and talks).
- Retire the old pieces, and consider the one-click scheduling port. (Component 7)

**Rollback:** turn off the kill switch or delete the trigger, and the old process still works. The Phase 0 backups cover any data damage.

**Communication:** one email per go-live, a short notice on the Notion "Change Presenter" page, and handbook updates on the same day.

## Open questions (for the tea tsar / the original author)
1. Where does each piece run, and under which account? (A Colab notebook for scheduling? Apps Script for finalizing? What handles form submissions?)
2. Where are people's registered emails stored?
3. Does the finalizing script only create events, or does it update existing ones too?
4. Are we OK changing the shared form for all rotas, or should the dropdown form start as TNJC-only?
5. GitHub: should Kevin transfer the repo to an org, or should we start a fresh one?
6. Does any other script depend on calendar event titles, e.g. for the announcement emails?

## Risks and limits
- **Apps Script quotas on a consumer account:** about 90 minutes of trigger runtime per day and about 100 email recipients per day. Group emails count as one recipient. Both are fine at this scale.
- **Notion API limit:** about 3 requests per second. Batch reads and cache the people list.
- **Exact formatting:** the sync must match the current event format exactly, or every run will rewrite every event.
- **Credentials:** keep the Notion token and clasp credentials out of the repo, and document who holds them.
