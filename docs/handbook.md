# Gatsby tea bot: organiser handbook

For the tea tsar and the rota organisers. What unit members need (rules, how to swap, add a title, set away
dates) is on the Gatsby Rotas pages on Notion (gcnu.notion.site); point people there rather than
repeating it. How the code is deployed is in the [README](../README.md).

## How it fits together
- **Notion** (Gatsby Rotas → Schedule, People) is the source of truth: who presents / does tea when.
- **The gatsby.tea calendar** is generated from Notion. Edits made by hand to an event's people are copied back into Notion every hour, so the rota stays fair. Relabelled events ("UPGRADE TALK: …") are left alone; cancelled ones are recorded as cancellations (see Everyday). A talk title or description edited in Notion is copied into the event description too (text typed straight into the calendar is kept until the Notion text changes).
- **The personal tea page** is where members swap slots, add titles and set away dates; you schedule from it too. Its link is at the end of every calendar event, and reminder emails include each person's own link. Page: https://script.google.com/macros/s/AKfycbxjB4wiJ-jluRobucTdMruvxRofOwb1TXVIxgIe_vnPr06t2gg3hybxrV8Rmfp9Ufmx/exec (without a personal link it lists everyone by name and emails the chosen person their link, showing the address half hidden).
- **Settings** are in the constants sheet: first tab = emails and IDs (the old scripts read it too); tab **Automation** = the bot's switches; tab **Automation reminders** = dated reminders for organisers.
- **Registered emails and tea-page tokens** are in the identity sheet (columns C, D); away dates in each person's away-date sheet, linked from their Notion page.

## Everyday
- **Someone can't do their slot:** they ask a colleague on their tea page. The colleague accepts with one click (from the email or their own tea page); only then do Notion, the calendar and both inboxes change. No answer after a day: the requester is reminded. Less than a day before the slot, a swap goes through straight away. Requests wait in the automation's Script Properties ("swapreq:…") until answered, withdrawn or the slot has passed. Changing the calendar event or Notion by hand still works too; the bot copies it across within the hour.
- **Guest speaker (TNJC / MLJC):** put their name in the event title ("TNJC: Jane Doe") or in Notion's "Guest speaker" field. The bumped presenter keeps their turn. To show who hosts them, add "Host: <name>" to the slot's Description in Notion.
- **Upgrade, rotation and other special talks (research / tea talk slots):** rename the calendar event, e.g. "UPGRADE TALK: Name TEA: Name". Any label works; the bot only compares the names, and keeps the label if names change later. Same presenter as in Notion: nothing else happens. A different presenter is recorded in Notion like a swap, so it counts as their talk and the bumped person keeps their turn (both get an email). If it should not count for the rota (the tea tsar's call), cancel the slot (below) and put the special talk on the calendar as a separate event: the bot never touches events that are not linked to a Notion slot.
- **Cancelling a talk (a last resort; a swap is always better):** presenters who really can't find anyone can cancel on their tea page (a small "Nobody can take over?" below the buttons; it asks who they asked and offers the swap again). Organisers cancel by deleting the calendar event or renaming it to "… CANCELLED"; a deleted event is acted on once it is still gone an hour later. Either way the slot stays in Notion, titled "Cancelled", without its presenter, so they keep their turn and are scheduled again soon; tea duty stays; the presenter and tea person get one email with the organiser in cc; there is no group reminder. Writing "Cancelled" in Notion yourself only makes the bot leave the slot alone; then take the presenter off and rename the event yourself.
- **Cancelling a just tea:** delete or rename its calendar event the same way. The tea person is taken off (keeping their turn) and gets one email with the organiser in cc. Other tea-only slots (leaving tea, external seminars, coffee) are not cancelled this way; a deleted event is only reported.
- **Calendar invitations:** for the rotas in `INVITE_TYPES` (Automation tab), the presenter and the tea person are guests of their slot's event, so it shows up in their own calendar. The bot keeps the guest list in step: after a swap or cancellation Google sends the old person a cancellation and the new one an invitation; guests you add by hand are left alone. **Declining changes nothing in the rota** (Outlook's out-of-office and deleting the invitation decline on their own): whoever declines gets one email that the slot is still theirs and how to swap, with the organiser in cc if the slot is less than a week away. Anyone who can see the gatsby.tea calendar's event details can see the guests' registered emails. Safety cap: one person gets at most 10 invitations or cancellations from the bot in any 24 hours; more would be a bug, so the rest is held back and the tea tsar is emailed. To stop invitations altogether, empty `INVITE_TYPES`.
- **Someone leaves the tea system:** every bot email ends with "Leave the tea system", which opens a page explaining that this is only about the tea system (not Gatsby's mailing lists) and asks them to confirm. Leaving marks them inactive in Notion, clears their registered email and tea-page code, drops their swap requests, and tells the organisers about any upcoming slots they still hold (else the tea tsar). To undo: tick Active on their Notion page and put their email back in column C of the identity sheet.
- **Who is on which rota:** on your tea page, "Who is on which rota" (below the Organiser section): everyone active with the rotas they can be scheduled for (the same rules as scheduling and the swap list), their upcoming slots and whether an email is registered.
- **Zoom:** every talk's calendar event carries the unit's Zoom link (constants sheet, row 11): in the description, and as the event's location unless someone typed a room there. There are no Zoom requests any more.
- **Pause the bot:** set `DRY_RUN` to `TRUE` in the Automation tab. Nothing else is needed.
- **Something odd:** the bot emails the rota organiser (or the tea tsar, if it can't tell who a name refers to). Errors in the bot itself go to the TNJC organiser with the tea tsar in cc. Everything it does is in the "Gatsby Tea Automation log" sheet in gatsby.teabot's Drive, with open calendar/Notion differences on its Mismatches tab.

## Scheduling
When: as promised to members in the Notion guides (Gatsby Tea System, TNJC Guide, MLJC Guide). The bot also
reminds you on Mondays when a rota's schedule is about to run out. In the Organiser section of your tea page:
1. **Plan these dates:** creates the slots (same days, times, CSNJC rule and coffee water-filter weeks as the old notebooks; England and Wales bank holidays are skipped; existing slots are kept) and fills them with Kevin's fairness algorithm and everyone's away dates (port checked against the original by `tests/crosscheck_scheduler.py`).
2. **Check in Notion:** delete slots that are not needed (UCL closures, retreat, conference deadlines such as COSYNE) and change anyone you like. "Fill … empty slots again" refills any slot you cleared.
3. **Finalise:** puts them on the calendar; optionally emails the group the usual "schedule updated" email.

**Who counts for whom:** turns are counted per rota from Notion. The swap list shows the people on that rota first (TNJC / CSNJC / MLJC / Coffee ticks, the "Excluded from …" boxes, "Included only for JCs / coffee"), then everyone else. Whoever is recorded as doing a duty has had their turn; if someone outside the rota steps in, the slot counts for nobody and the person who handed it over keeps their turn.

## Once a year
- **October:** add new students to the gatsby-tnjc Google Group (Group → People → Add members; direct adding only works for Gmail addresses), and untick TNJC/CSNJC in Notion for people who left. The bot reminds the TNJC organiser on 1 Oct.
- **Third term:** add the first years as presenters (tick TNJC / CSNJC on their Notion page). Reminder on 22 Apr.

## Handing over: a guide for new organisers and tea tsars
The bot looks up who organises what by email, so most of a handover is changing one cell and checking that the
new person can see their tools. Work through it together with the person you take over from.

**1. Make the bot know you (outgoing and incoming together)**
1. In the constants sheet, first tab, column B, replace the outgoing address with yours: row 2 = tea tsar (also
   gets the research / tea talk, just tea, leaving tea and external seminar mail), 3 = MLJC, 4 = TNJC (also gets
   the bot's error emails), 5 = coffee. This decides who gets reminders, digests and cancellations, and who sees
   the Organiser section on the tea page.
2. Use the same address in the identity sheet (column C, your row): the tea page shows organiser tools only when
   your registered email matches column B. Then get your link from the tea page (pick your name).
3. Open your tea page and check that the Organiser section shows your rota, and "Show the table" under "Who is on which rota" works.
4. Update the Contact box on the Gatsby Rotas page in Notion (names only; people message organisers on Slack).

**2. Access you need**
- **Notion:** edit access to Gatsby Rotas (Schedule and People databases), from the outgoing person or the tea tsar.
- **The bot accounts:** the tea tsar holds the gatsby.tea (calendar) and gatsby.teabot (scripts, Drive, sheets)
  logins and their 2FA. Organisers rarely need them; the tea tsar does.
- **Mailing lists:** TNJC: owner of the gatsby-tnjc Google Group. The unit-wide list and access to the calendar
  for members are run by the unit's admin, not the bot.
- **Code (only whoever maintains the bot):** the GatsbyUnit GitHub organisation, and the steps in the README.

**3. Learn the routine (first weeks)**
- Read Everyday and Scheduling above; for members' questions, point them to the Notion guides.
- Look at the Automation tab of the constants sheet (switches, with explanations) and the Automation reminders
  tab (dated reminders; change the rota column if duties move between organisers).
- Skim the "Gatsby Tea Automation log" sheet now and then; its Mismatches tab lists open calendar / Notion
  differences.
- Your first scheduling round: Plan these dates, check in Notion, Finalise (see Scheduling).

**4. Before the outgoing person leaves**
- Hand over open items: tentative slots not yet finalised, anything on the Mismatches tab, unanswered emails.
- If they leave Gatsby altogether, they can use "Leave the tea system" on their tea page (or untick Active on
  their Notion page) once their slots are handed over.
- New tea tsar: change the bot accounts' passwords and 2FA, and rotate the Notion token if the outgoing tsar had
  it (constants sheet, first tab; see docs/next-steps.md).

**Good to know**
- **The tea page** is a static page on GitHub Pages (`PAGE_URL`); its address alone shows nothing. Personal links carry the person's code, the general link (calendar events, emails to several people) carries the unit key `PAGE_KEY` (Automation tab). If the general link ever spreads beyond the Unit, put new random letters and digits in `PAGE_KEY`: the calendar events get the new link within the hour, and links already sent stop working. Old links to the script.google.com address show a link to the new page.
- **The bot's Drive:** everything at the top level of My Drive is live, plus the `away_dates` folder (everyone's away-date sheets and their template) and `people_files` (people lists the Cron Jobs still write in the old cluster format). Everything else, from the scripts, forms and notebooks the bot replaced to the files of the systems before them, is in the folder "Gatsby tea – archive (superseded 2026-10-27)". "Shared with me" holds other people's files; leave them be. The Apps Script dashboard (script.google.com) lists every project regardless of folder: the starred ones (Automation, Page, Cron Jobs) are live, the archive helper only ran the clean-up, and everything named "[archived] …" belongs to the archive. Projects marked "empty, can be deleted" hold nothing but the default `myFunction`.
