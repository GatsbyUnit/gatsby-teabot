# Next steps

Written 2026-10-27, when the bot went live: what to watch before the repo goes public, what is already
public, and (since 2026-11-11) how the move off Notion went and what is left of it.

## Keeping the public repo clean
The repo is public since 2026-10-27 and starts from a fresh history. The first repo's history contains real
member emails and names (from the early tests), and GitHub keeps serving old commits even after a force-push, so
it was renamed to `gatsby-teabot-old` and archived as a private repo. Delete it when nobody needs it any more
(its Settings → Delete); never push its history, or the local tag `pre-public-history`, to the public repo.

What keeps this repo safe to be public:
- **No secrets.** The old Notion token lives only in the constants sheet (row 21, until it is revoked); the deploy credentials are the bot's clasp
  login in `~/.clasprc.json`, never in the repo. `backups/` (live edits saved by `deploy.py`, raw copies of old
  scripts, which can contain the old token) is git-ignored.
- **IDs are harmless while nothing is shared by link.** The sheets, forms and scripts named in the code belong to
  the bot account and are shared with nobody by link, so knowing an ID gives no access. Never share the
  constants sheet or the identity sheet (everyone's email and tea-page code) by link.
- **No member names or emails.** The only addresses are the bot accounts (gatsby.tea, gatsby.teabot); tests use
  made-up people. Don't paste real names, emails or log excerpts into code, tests, issues or commit messages.
- **Licence:** MIT (`LICENSE`); the scheduling algorithm is published with Kevin's agreement.

## What is already public, or close to it
- **The old Notion Rotas pages are still published** on gcnu.notion.site until a workspace owner unpublishes
  them (see the move below). Anyone with the link can read them without a Gatsby or Notion login, including the
  internal Zoom link. The Gatsby Rotas site that replaced them shows nothing without signing in.
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

## The move off Notion (done 2026-11-11)
Everything left Notion in two steps: the member pages on 2026-10-31 (into the "Gatsby Rotas pages" sheet,
`Site.js`) and the rota data on 2026-11-11 (into the "Gatsby Rotas data" sheet, `Store.js`). Since then the bot,
the Rotas site, the tea page and the Cron Jobs (through the `TeaBot` library, `store_fetch`) read and write only
the bot's sheets; nothing calls Notion.

How: the "Gatsby Rotas data" sheet was filled from the three databases with all their history (the fair rota
counts past turns) and kept in step with every change the bot made for ten days. Right before the deploy that
made it the only store it was filled once more; `finish_notion_move()` then pointed what was left (constants row
25, five links in the pages, the setting and reminder texts) at the site.

Kept on purpose:
- Every row keeps its Notion page id as its id, and the tables keep the Notion database ids (constants rows
  22-24) as their names, so tea-page tokens, the identity sheet, away-date sheets, calendar links and the sync's
  saved state carried over unchanged. New rows get random ids of the same form.
- The code still speaks Notion's API (`notion_request`, `notion_query`, …) and `Store.js` answers it from the
  sheet. Renaming it all would touch every file for no gain.
- Each row's `url` is now its address on the site (`?slot=<id>`, `?person=<id>`): emails link it, and the Cron
  Jobs keep the person's in identity-sheet column A and in each away-date sheet (H2). Both match people by the
  id in the address, so the old Notion addresses there still work.
- Guest speakers are an empty Presenter plus the Guest speaker field, so the bumped presenter keeps their turn.
  The GCal ID on each slot is the only link to its calendar event: losing it makes the bot create duplicates.

Left to do:
1. Run `notion_leftovers()` in the automation's editor: it lists anything changed in Notion after the move
   ("Notion newer"); make those changes on the site. Again a week or two later.
2. Then a Notion workspace owner revokes the bot's integration (Settings → Connections) and unpublishes
   gcnu.notion.site, or leaves one page there pointing to the Rotas site; archive the databases. Clear constants
   row 21 (the token). After that `notion_http` and `notion_leftovers` can go.

Ideas not done: dropdowns that offer only people eligible for a rota, refusing a slot save when someone else
changed the slot since it was loaded, the edit log as an undo, and Google sign-in.
