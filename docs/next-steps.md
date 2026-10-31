# Next steps

Written 2026-10-27, when the bot went live: what to watch before the repo goes public, what is already
public, and how one might move off Notion one day.

## Keeping the public repo clean
The repo is public since 2026-10-27 and starts from a fresh history. The first repo's history contains real
member emails and names (from the early tests), and GitHub keeps serving old commits even after a force-push, so
it was renamed to `gatsby-teabot-old` and archived as a private repo. Delete it when nobody needs it any more
(its Settings → Delete); never push its history, or the local tag `pre-public-history`, to the public repo.

What keeps this repo safe to be public:
- **No secrets.** The Notion token lives only in the constants sheet; the deploy credentials are the bot's clasp
  login in `~/.clasprc.json`, never in the repo. `backups/` (live edits saved by `deploy.py`, raw copies of old
  scripts, which can contain the old token) is git-ignored.
- **IDs are harmless while nothing is shared by link.** The sheets, forms and scripts named in the code belong to
  the bot account and are shared with nobody by link, so knowing an ID gives no access. Never share the
  constants sheet (Notion token) or the identity sheet (everyone's email and tea-page code) by link.
- **No member names or emails.** The only addresses are the bot accounts (gatsby.tea, gatsby.teabot); tests use
  made-up people. Don't paste real names, emails or log excerpts into code, tests, issues or commit messages.
- **Licence:** MIT (`LICENSE`); the scheduling algorithm is published with Kevin's agreement.

## What is already public, or close to it
- **The Notion Rotas pages are published** on gcnu.notion.site. Anyone with the link can read them without a
  Gatsby or Notion login, including the internal Zoom link (checked anonymously on 2026-10-27). The organisers'
  email addresses were taken off on 2026-10-27 (names only; people message them on Slack); keep it that way. The
  "Please do not share this page with anyone outside Gatsby" line is the only protection. For the tea tsar to
  decide: unpublish and invite members to the Notion workspace instead (everyone then needs a Notion account), or
  stay published but move the Zoom link off the page.
  Either way, check that search-engine indexing is off in the site settings.
- **The gatsby.tea calendar is not public** (its public feed returns 404); people see it because it is shared with
  them. Event descriptions contain the internal Zoom link, and with calendar invitations on (`INVITE_TYPES`) the
  guests' registered emails, so keep it that way.
- **The tea page's address is public** (gatsbyunit.github.io/gatsby-teabot, a static page in this repo). Without
  a code in the link it only offers to email your link to your registered address. The general link adds the unit
  key `PAGE_KEY` (Automation tab), which shows the names to pick from and allows leaving by name; if it spreads
  beyond the Unit, put a new value there (the calendar events follow within the hour).
- **Personal tea-page links work like passwords.** Whoever has one can swap that person's slots or change their
  registered email. They are only ever sent to the person themselves (single-person reminders, the "send me my
  link" email); calendar events carry the general page link with the unit key. If one leaks, clear that person's cell in column D
  of the identity sheet: the old link stops working at once, and the daily maintenance run issues a new code.

## Moving off Notion
Notion is still the source of truth, on purpose: the bot and the older Cron Jobs both read it, organisers like its
views, and the drift between Notion and the calendar is now handled by the hourly sync. This section is for
whoever later decides to make the system Google-only.

### When it is worth it
- The gcnu Notion workspace loses its owner, changes plan, or runs into the guest limit (the bot account is a
  guest there).
- Notion API trouble becomes frequent. So far: query results that lag a few seconds behind edits, and occasional
  network errors at night (the bot retries and only emails after three failed runs in a row).
- The tea tsar wants one account, token and permission model fewer.

It is not worth it for tidiness alone. The data layer of both Apps Script projects has to be rewritten, and the
fairness history must survive the move intact.

### Recommended path: move the editing first (agreed 2026-10-27, under way)
Done since (2026-10-31): the Gatsby Rotas site (`site/rotas/`, `Site.js`). The member pages moved off Notion
into the bot's "Gatsby Rotas pages" sheet, where tsars edit them on the site; the rota views read the Notion
databases live, and tsars edit slots, people and rota rules there too, written back into Notion. Notion now only
holds the databases.
Still open from the list below: eligibility-filtered dropdowns, the stale-row check, the edit log as an undo,
polling, and Google sign-in (the site signs people in by an emailed link instead).

Rather than moving the data first, move what organisers still edit in Notion by hand onto the tea page, while
Notion stays the store. Once nobody edits Notion directly, switching the store to a Sheet changes nothing anyone
sees.
1. **Editors on the tea page, still backed by Notion**, for organisers (their rota) and the tea tsar (all):
   - Slots: presenter and tea person (dropdowns offering only people eligible for that rota), guest speaker,
     tentative, add, delete. The calendar updates at once, and invalid entries are refused rather than caught by
     the hourly sync afterwards.
   - People: rota ticks, Active, exclusions, position (the "Who is on which rota" table made editable).
   - Rota rules.
   Every edit goes into the automation log, so an undo button can build on it. If two people edit the same row,
   the second save is refused when the row changed since it was loaded. Rough effort: slot editor about a day,
   people editor half a day, rules small.
   - **Near-live updates (polling).** Apps Script cannot push to an open page (no websockets), and GitHub Pages
     only serves the files, so the editor asks instead: while it is open and the tab is visible, the page calls a
     cheap `api_version` every ~15 seconds. It returns a change counter (Script Properties or CacheService) that
     every write bumps: the tea page, the hourly sync, Cron Jobs and, after the store switch, an installable
     onEdit trigger on the Sheet. When the counter has moved, the page fetches the rows changed since its version
     and redraws them; an open form keeps what the person typed and shows that the row changed underneath. The
     poll reads neither Notion nor the Sheet, so a few organisers editing at once stay far inside the free Apps
     Script quotas. Saves still go through the stale-row check above. About half a day on top of the editors.
2. **Sign in with Google**, so organisers needn't keep a personal link. The page gets a Google ID token (Google
   Identity Services; an OAuth client under gatsby.teabot allowing the github.io origin; scopes openid and email
   only, so no app verification), the bot verifies it and opens that person's page. Most registered addresses are
   @ucl.ac.uk (Microsoft), so add a one-time "Link my Google account" on the personal page (an extra
   identity-sheet column). About half a day, plus a quarter of an hour in Cloud Console.
3. **Then the store switch** described below (Target, Migration plan).

Not carried over from Notion: free-form views and filters, comments, and keystroke-level co-editing on the tea
page (it updates within seconds instead; true real-time would need a service such as Firebase, not worth it for
a rota). After the store switch, Google Sheets brings back live co-editing and version history for anyone who
edits the Sheet directly. The member guides stay on Notion (they need no API) or move to Google Docs shown on
github.io. (Done differently: the guides are on the Gatsby Rotas site now, edited in place by the tsars.)

### What Notion holds today
| Notion | Used for | Constants sheet |
|---|---|---|
| Schedule database | One row per slot: Date, Type, Title, Presenter and Tea (relations to People), Description, CSNJC, Guest speaker, Water filter (coffee only), GCal ID (link to the calendar event) | row 24 |
| People database | Name, Active, Position, TNJC, CSNJC, MLJC, Coffee, Excluded from research talk / tea talk / tea, Away Date Sheet (URL) | row 22 |
| Rota rules database | When newcomers join each rota (the "You are added to the rota when" table) | row 23 |
| Pages on gcnu.notion.site | Member guides and the toolbox pages (they point to the tea page) | row 25 |

The Notion page ID of a person is their ID everywhere: in the Presenter and Tea relations, in column A of the
identity sheet, and therefore behind the tea-page tokens (column D). The Notion
page ID of a slot is the row ID the tea page and the sync use.

### Target
- **One spreadsheet owned by gatsby.teabot** with tabs Schedule, People and Rota rules, same columns as now.
  Keep the Notion page IDs as the ID column, so tokens, away sheets, calendar links and the sync's saved state
  keep working; new rows get generated IDs.
- **Presenter and Tea columns hold names**, with a dropdown (data validation) from the People tab, so organisers
  can still edit by hand. The code maps names to IDs; names must stay unique (the People tab can enforce it).
- **The identity sheet merges into the People tab** (email, token). One copy of each person
  instead of two, and the Cron Jobs' people sync goes away.
- **Organiser views** become filter views per rota; the gatsby.tea calendar already is the calendar view.
- **Member guides** can stay on Notion as plain pages (no API or token needed), or move to a Google Site. Moving
  the data is the part that matters.

### Code to change
Most code works with row objects, not Notion pages, so the change is fairly contained:
- `automation/Notion.js` becomes a sheet store with the same operations: query slots, get one, patch one,
  create one, load people. `to_row()` in `Schedule.js` and `load_people()` in `People.js` are the only places
  that read Notion's property format.
- Call sites of `notion_*`: `Schedule.js` (queries), `WebApp.js` (page state, swaps, titles), `Events.js`
  (finalise, swaps), `Scheduler.js` (create and fill slots), `Sync.js` (schema check, copying hand edits back),
  `Reminders.js`, `Setup.js` (adds the Guest speaker property) and `Backup.js`.
- Notion's filtered queries become in-memory filters. The data is small (about 5,500 schedule rows in 2026);
  an Archive tab for past years keeps reads fast.
- Sheets has no row locking: wrap writes in `LockService.getScriptLock()`, because the hourly sync and the tea
  page can run at the same time.
- **The Cron Jobs project calls the Notion API directly**, with the token, in `AddNewPeopleToRota.js`,
  `SyncPeople.js`, `SaveTalksToOldFormat.js`, `UploadSlidesReminder.js` and `Utilities_TalkReminder.js` (all talk
  reminders). Port them, or better, move the reminders into the automation project and retire Cron Jobs. That
  was left out of the 2026 go-live to keep it small.
- `tests/run.js` fakes Notion responses; give it a fake sheet store instead.

### Status (2026-10-31): the store is built, the switch is not made yet
`apps-script/automation/Store.js` is the sheet store: the "Gatsby Rotas data" sheet in the bot's Drive, one tab
per database (same columns, Notion page IDs as the ID column), answering the same Notion API calls the code
already makes, so nothing else changed. Settings `STORE` (`notion` | `sheet`) and `NOTION_MIRROR` in the
Automation tab. The guides already left Notion (the "Gatsby Rotas pages" sheet, see `Site.js`). Steps:
1. Run `store_import_from_notion()` in the automation's editor: copies all three databases, history included.
   From then on every change the bot writes to Notion is copied into the sheet too.
2. Run `store_check()`: lists every field where Notion and the sheet differ (hand edits made in Notion directly
   are the expected ones; run the import again to pick them up).
3. Switch the Cron Jobs to the store: their four request helpers call `TeaBot.store_fetch` instead of
   `UrlFetchApp.fetch` (add the TeaBot library to their manifest; someone must open the project once and allow
   the new permissions, or their triggers stop). Not done yet, on purpose: it is only needed for the switch.
4. Ask organisers to stop editing the Notion databases (the site has editors for slots, people and rules),
   run the import once more, and set `STORE` to `sheet`. With `NOTION_MIRROR` = TRUE every change still goes to
   Notion first, so `STORE` = `notion` switches back without losing anything.
5. After a term: `NOTION_MIRROR` = FALSE, revoke the Notion token, archive the databases.

The original plan, for reference:

### Migration plan
1. Run `backup_all()` (`Backup.js`). It already copies the Schedule and People databases into a spreadsheet,
   which is the starting import. Import all history, not only future slots: the scheduler's fairness queue
   counts past turns.
2. Add a `STORE` setting (`notion` or `sheet`) to the Automation tab and build the sheet store behind it. Run
   with `DRY_RUN` on a copy for a week and compare the planned actions with the live Notion-backed run (the
   automation log records every action).
3. Cut over in one go: put a "now edited in the sheet" banner on the Notion databases and make them read-only,
   import once more, flip `STORE`, and switch the Cron Jobs the same day. Otherwise they keep reading a stale
   Notion and remind people about slots that have moved.
4. Remove the database views from the Notion Rotas page, or replace them with the embedded calendar.
5. After a term without problems, revoke the Notion integration token and archive the databases.

### Keep in mind
- Guest speakers are recorded as an empty Presenter plus the Guest speaker field, so the bumped presenter keeps
  their turn. Keep that meaning.
- The GCal ID on each slot is the only link to its calendar event. Losing it means the bot creates duplicates.
- The sync stores what it last saw for each calendar event (Script Properties, keyed by event ID, with a
  fingerprint of the slot). Stable slot IDs avoid a burst of "new" findings after the switch. The first look at
  each rota is silent anyway.
