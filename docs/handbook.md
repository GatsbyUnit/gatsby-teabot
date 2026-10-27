# Gatsby tea bot: organiser handbook

## How it fits together
- **Notion** (Gatsby Rotas → Schedule, People) is the source of truth: who presents / does tea when.
- **The gatsby.tea calendar** is generated from Notion. Edits made by hand to an event's people are copied back into Notion every hour, so the rota stays fair. Relabelled ("UPGRADE TALK: …") and cancelled events are left alone.
- **The personal tea page** lets everyone swap their slots, add talk titles and set away dates. Its link is at the end of every calendar event, and reminder emails include each person's own link. Page: https://script.google.com/macros/s/AKfycbxjB4wiJ-jluRobucTdMruvxRofOwb1TXVIxgIe_vnPr06t2gg3hybxrV8Rmfp9Ufmx/exec (without a personal link it asks for your email and sends you yours).
- **Settings** are in the constants sheet: first tab = emails and IDs (the old scripts read it too); tab **Automation** = the bot's switches; tab **Automation reminders** = dated reminders for organisers.
- **Code** lives in github.com/GatsbyUnit/gatsby-teabot and runs as Apps Script under gatsby.teabot@gmail.com: "Gatsby Tea Automation" (all logic), "Gatsby Tea Page" (the web page only; it uses the automation as a library, because a web page can call every function of its own project), and the older "Gatsby Tea Cron Jobs" (reminders).

## Everyday
- **Someone can't do their slot:** they use their tea page (Swap). Notion, calendar and both people's inboxes are updated. Editing the calendar event or Notion by hand also works; the bot copies it across within the hour.
- **Guest speaker (TNJC / MLJC):** put their name in the event title ("TNJC: Jane Doe") or in Notion's "Guest speaker" field. The bumped presenter keeps their turn.
- **Pause the bot:** set `DRY_RUN` to `TRUE` in the Automation tab. Nothing else is needed.
- **Something odd:** the bot emails the rota organiser (or the tea tsar, if it can't tell who a name refers to). Errors in the bot itself go to the TNJC organiser with the tea tsar in cc. Everything it does is in the "Gatsby Tea Automation log" sheet in gatsby.teabot's Drive, with open calendar/Notion differences on its Mismatches tab.

## Scheduling (about every two months)
All on your tea page, Organiser section (the bot reminds you on Mondays when the schedule runs out):
1. **Create empty slots** for the date range (same days, times, CSNJC rule and coffee water-filter weeks as the old notebooks; existing slots are not duplicated).
2. In Notion, delete slots that are not needed (bank holidays, UCL closures, retreat, conference deadlines such as COSYNE). Pre-assign anyone you like; filled slots are left alone.
3. **Fill** the empty slots: Kevin's fairness algorithm with everyone's away dates (port checked against the original by `tests/crosscheck_scheduler.py`).
4. Check in Notion, then **Finalise** (puts them on the calendar; optionally emails the group the usual "schedule updated" email).

The old Colab notebooks and finalizing scripts are in the bot's Drive folder "Gatsby tea – archive (superseded 2026-10-27)".

## Once a year
- **October:** add new students to the gatsby-tnjc Google Group (Group → People → Add members; direct adding only works for Gmail addresses), and untick TNJC/CSNJC in Notion for people who left. The bot reminds the TNJC organiser on 1 Oct.
- **Third term:** add the first years as presenters (tick TNJC / CSNJC on their Notion page). Reminder on 22 Apr.

## Handing over
- Change the organiser emails in the constants sheet (first tab, column B).
- Access: gatsby.teabot / gatsby.tea logins and 2FA via the tea tsar.
- The tea page does not open in a browser that is signed into gatsby.teabot as a secondary account (Google redirect bug); use a private window or a browser profile without the bot account.

## Old forms
The old swap, title / Zoom and change-email Google Forms were closed on 2026-10-27 (they point to the tea page) and moved, with their response sheets, to the archive folder in the bot's Drive.

## Zoom and away calendars
- **Zoom:** people request it on their tea page (for their own talk, or for an upcoming external seminar). It emails the unit admin in row 28 of the constants sheet, with the requester as reply-to.
- **Away calendar (opt-in):** on the tea page, people can connect one Google Calendar they share with the bot as "See only free/busy". Every busy day in it counts as away, on the page and when filling slots. The calendar ID is stored in column E of the identity sheet.

## For whoever maintains the code
- Deploy with `python3 deploy/deploy.py` from a clean checkout of origin/main (it runs the tests, warns about and saves anything edited live, uploads, and updates the tea page). `--check` only compares.
- Don't edit "Gatsby Tea Automation" or "Gatsby Tea Cron Jobs" in the Apps Script editor: every file says so at the top, and the next deploy overwrites it. One-off fixes: see the top of `Setup.js`.
- Safe check: open `Checks.js` in the editor and press Run: `send_examples()` emails the TNJC organiser one example of every bot email.
- `backup_all()` (in `Backup.js`) snapshots calendar, Notion and sheets into a new spreadsheet.
