# gatsby-teabot

Automation for the Gatsby Unit tea / rota system: research and tea talks, tea, MLJC, TNJC (with CSNJC),
coffee cleaning and external seminars. It runs as Google Apps Script under the shared bot account
(gatsby.teabot@gmail.com), with no server of its own.

What to read where (each topic lives in one place only):
- **Unit members:** the Gatsby Rotas site (https://gatsbyunit.github.io/gatsby-teabot/rotas/), which shows the
  Gatsby Rotas pages on Notion (gcnu.notion.site) live: rules, guides, the schedule, and how to swap, add a title or
  set away dates.
- **Organisers and the tea tsar:** [docs/handbook.md](docs/handbook.md): how the parts fit together, scheduling,
  yearly jobs, handing over.
- **New organiser or tea tsar:** the handover guide at the end of the [handbook](docs/handbook.md#handing-over-a-guide-for-new-organisers-and-tea-tsars).
- **Whoever maintains the code:** this file.
- **Next steps:** [docs/next-steps.md](docs/next-steps.md): keeping this public repo clean, what else is public
  (personal data on the Notion site, tea-page links), and how one might move off Notion.

## The setup at a glance

<p align="center"><img src="docs/setup.svg" width="820" alt="Unit members and organisers use the tea page, which uses Gatsby Tea Automation as a library. The automation syncs with Notion every hour, keeps the gatsby.tea calendar in step and uses Google Sheets; the Cron Jobs read Notion and send reminders. Hand edits to the calendar are copied back to Notion. GitHub deploys the Apps Script projects."></p>

Notion decides who does what and when; the calendar is a copy that the bot keeps in step, and hand edits to it are
copied back. The [handbook](docs/handbook.md) explains each part.

## Layout
- `apps-script/automation/`: "Gatsby Tea Automation", all the logic: calendar ↔ Notion sync, scheduling and
  finalising, emails, organiser reminders, and everything behind the tea page. Settings are described at the top
  of `Config.js`, one-off admin functions in `Setup.js`.
- `site/`: the tea page itself, a static page on GitHub Pages (https://gatsbyunit.github.io/gatsby-teabot/),
  published by `.github/workflows/pages.yml` whenever it changes. It is not served by Apps Script because Apps
  Script web pages don't open for people signed in to several Google accounts. Its address is public, so without the
  personal code or the unit key (`PAGE_KEY`) in the link it only offers to email your link to your registered address.
- `site/rotas/`: the Gatsby Rotas site (https://gatsbyunit.github.io/gatsby-teabot/rotas/): the member guides and
  the rota views, read live from Notion by `apps-script/automation/Site.js`, so Notion and the site never differ.
  Members sign in by picking their name and opening the link the bot emails them (valid for an hour); the browser
  then keeps the unit key and their tea-page token for six months (the tea page's own memory of them works too).
  Tsars edit pages (in place), slots, people, rota rules and coffee duties there; the bot writes each change
  straight into Notion and notes it in the log sheet. Static files only, like the tea page; `edit.js` loads only
  for tsars. Developed against a local stand-in for `Site.js` that is not part of this repo.
- `apps-script/page/`: "Gatsby Tea Page", the tea page's back end (web app): `doPost` with thin `api_*` wrappers,
  and a `doGet` that points old links to the new address. It uses the automation as the library `TeaBot`,
  because a web page can call every top-level function of its own project; a test makes sure it exposes
  nothing else.
- `apps-script/cron-jobs/`: the older "Gatsby Tea Cron Jobs" (talk reminders, people sync, away-date sheets,
  adding newcomers to rotas), now under version control.
- `apps-script/archive-helper/`: one-off functions that moved everything superseded into the archive folder in
  the bot's Drive. It is the only project with access to all of the bot's Drive, so the live ones don't need it.
- `deploy/`: `deploy.py` and `projects.json`.
- `tests/`: `node tests/run.js`, and `python3 tests/crosscheck_scheduler.py`, which runs the scheduler port
  against Kevin's original `script.py` on random inputs.

## Deploying
GitHub is the single source of truth for the four projects in `deploy/projects.json`. Every deployed file
starts with a header naming the commit and saying not to edit it in the Apps Script editor.

    python3 deploy/deploy.py --check   # is anything live different from GitHub?
    python3 deploy/deploy.py           # deploy what is on origin/main

The deploy refuses unless your checkout is clean and equal to origin/main, runs the tests, saves (to
`backups/drift/`) and shows anything that was edited live, uploads the complete project through the Apps Script
API, verifies it and moves the tea page to the new version. It uses the bot account's clasp login
(`clasp login --user teabot`, once). CI (GitHub Actions) only runs the tests; it never deploys.

Useful from the Apps Script editor:
- `send_examples()` in `Checks.js` emails the TNJC organiser one example of every bot email.
- `backup_all()` in `Backup.js` snapshots the calendar, Notion and the sheets into a new spreadsheet.

## Where the data lives
| What | Where |
|---|---|
| People, rota, schedule, titles, guest speakers | Notion (source of truth) |
| Registered emails, tea-page tokens | identity sheet (the Cron Jobs add a row per new person; the tea tsar fills in the email, people change it on their tea page) |
| Away dates | one sheet per person, linked from their Notion page |
| Emails, IDs, Notion token | constants sheet, first tab |
| Automation switches (dry run / pause, rotas) and dated reminders | constants sheet, tabs **Automation** and **Automation reminders** |
| Calendar | a copy of Notion; hand edits are pulled back into Notion |

Secrets never go in this repo. The sheets and scripts it names are owned by the bot account and not shared by
link, so their IDs here give nobody access.

## Credits and licence
MIT licence (see `LICENSE`). The scheduling algorithm is a port of Kevin's
[KevHH/gatsby_tea_scheduling](https://github.com/KevHH/gatsby_tea_scheduling). The Cron Jobs and the scripts the
bot replaced come from earlier tea tsars.
