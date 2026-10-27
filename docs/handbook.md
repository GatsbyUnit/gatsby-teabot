# Gatsby tea bot: organiser handbook

For the tea tsar and the rota organisers. What unit members need (rules, how to swap, add a title, set away
dates, request Zoom) is on the Gatsby Rotas pages on Notion (gcnu.notion.site); point people there rather than
repeating it. How the code is deployed is in the [README](../README.md).

## How it fits together
- **Notion** (Gatsby Rotas → Schedule, People) is the source of truth: who presents / does tea when.
- **The gatsby.tea calendar** is generated from Notion. Edits made by hand to an event's people are copied back into Notion every hour, so the rota stays fair. Relabelled ("UPGRADE TALK: …") and cancelled events are left alone.
- **The personal tea page** is where members swap slots, add titles, set away dates and request Zoom; you schedule from it too. Its link is at the end of every calendar event, and reminder emails include each person's own link. Page: https://script.google.com/macros/s/AKfycbxjB4wiJ-jluRobucTdMruvxRofOwb1TXVIxgIe_vnPr06t2gg3hybxrV8Rmfp9Ufmx/exec (without a personal link it asks for your email and sends you yours).
- **Settings** are in the constants sheet: first tab = emails and IDs (the old scripts read it too); tab **Automation** = the bot's switches; tab **Automation reminders** = dated reminders for organisers.
- **Registered emails, tea-page tokens and away calendars** are in the identity sheet (columns C, D, E); away dates in each person's away-date sheet, linked from their Notion page.

## Everyday
- **Someone can't do their slot:** they swap it on their tea page. If they changed the calendar event or Notion by hand instead, that works too; the bot copies it across within the hour.
- **Guest speaker (TNJC / MLJC):** put their name in the event title ("TNJC: Jane Doe") or in Notion's "Guest speaker" field. The bumped presenter keeps their turn.
- **Zoom requests** from the tea page go to the unit admin in row 28 of the constants sheet, with the requester as reply-to.
- **Pause the bot:** set `DRY_RUN` to `TRUE` in the Automation tab. Nothing else is needed.
- **Something odd:** the bot emails the rota organiser (or the tea tsar, if it can't tell who a name refers to). Errors in the bot itself go to the TNJC organiser with the tea tsar in cc. Everything it does is in the "Gatsby Tea Automation log" sheet in gatsby.teabot's Drive, with open calendar/Notion differences on its Mismatches tab.

## Scheduling
When: as promised to members in the Notion guides (Gatsby Tea System, TNJC Guide, MLJC Guide). The bot also
reminds you on Mondays when a rota's schedule is about to run out. All steps are in the Organiser section of your
tea page:
1. **Create empty slots** for the date range (same days, times, CSNJC rule and coffee water-filter weeks as the old notebooks; existing slots are not duplicated).
2. In Notion, delete slots that are not needed (bank holidays, UCL closures, retreat, conference deadlines such as COSYNE). Pre-assign anyone you like; filled slots are left alone.
3. **Fill** the empty slots: Kevin's fairness algorithm with everyone's away dates (port checked against the original by `tests/crosscheck_scheduler.py`).
4. Check in Notion, then **Finalise** (puts them on the calendar; optionally emails the group the usual "schedule updated" email).

## Once a year
- **October:** add new students to the gatsby-tnjc Google Group (Group → People → Add members; direct adding only works for Gmail addresses), and untick TNJC/CSNJC in Notion for people who left. The bot reminds the TNJC organiser on 1 Oct.
- **Third term:** add the first years as presenters (tick TNJC / CSNJC on their Notion page). Reminder on 22 Apr.

## Handing over
- Change the organiser emails in the constants sheet (first tab, column B).
- Access: gatsby.teabot / gatsby.tea logins and 2FA via the tea tsar.
- The tea page does not open in a browser that is signed into gatsby.teabot as a secondary account (Google redirect bug); use a private window or a browser profile without the bot account.
- **The bot's Drive:** everything at the top level of My Drive is live, plus the `away_dates` folder (everyone's away-date sheets and their template) and `people_files` (people lists the Cron Jobs still write in the old cluster format). Everything else, from the scripts, forms and notebooks the bot replaced to the files of the systems before them, is in the folder "Gatsby tea – archive (superseded 2026-10-27)". "Shared with me" holds other people's files; leave them be.
