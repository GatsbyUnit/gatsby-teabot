# gatsby-teabot

Automation for the Gatsby Unit tea / rota system (research and tea talks, MLJC, TNJC, coffee).

- **Source of truth:** the Notion "Gatsby Rotas" databases (Schedule, People).
- **Shared calendar:** gatsby.tea@gmail.com.
- **Runs as:** Google Apps Script under the shared bot account (no own server).
- **Scheduling algorithm:** https://github.com/KevHH/gatsby_tea_scheduling

See `PLAN.md` for the roadmap and transition plan, and `docs/` for the organiser handbook.

## Layout
- `apps-script/automation/`: the "Gatsby Tea Automation" Apps Script project: calendar ↔ Notion sync for all rotas, the personal tea page (`WebApp.js`, `Page.html`), finalising, organiser reminders. Settings and admin functions are described at the top of `Config.js` and `Setup.js`.
- `apps-script/archive-helper/`: one-off script that moved superseded scripts and notebooks into an archive folder.
- `apps-script/cron-jobs/`: the older "Gatsby Tea Cron Jobs" project (reminder emails, people sync, away-date sheets), now under version control.
- `inventory/`: read-only snapshot of the older bot scripts, for reference
- `tests/`: local tests (`node tests/run.js`) and the scheduler cross-check against the original Python (`python3 tests/crosscheck_scheduler.py`)
- `docs/handbook.md`: organiser handbook; `docs/pitch.md`: the original proposal

## Deploying
GitHub is the single source of truth for the projects in `deploy/projects.json` ("Gatsby Tea Automation" and
"Gatsby Tea Cron Jobs"). Every deployed file starts with a header naming the commit and saying not to edit it in
the Apps Script editor.

    python3 deploy/deploy.py --check   # is anything live different from GitHub?
    python3 deploy/deploy.py           # deploy what is on origin/main

The deploy refuses unless your checkout is clean and equal to origin/main, runs the tests, saves (to
`backups/drift/`) and shows anything that was edited live, uploads the complete project, verifies it and moves the
tea page to the new version. It uses the bot account's clasp login (`clasp login --user teabot`, once).

## Where things live
| What | Where |
|---|---|
| People, rota, schedule, titles, guest speakers | Notion (source of truth) |
| Registered emails | identity sheet (synced from Notion by the old Cron Jobs) |
| Settings: emails, IDs, Notion token | constants sheet, first tab |
| Automation switches (dry run / pause, rotas) and dated reminders | constants sheet, tabs **Automation** and **Automation reminders** |
| Code | this repo, deployed to Apps Script with clasp |
| Calendar | a copy of Notion; hand edits are pulled back into Notion |

Secrets never go in this repo.
