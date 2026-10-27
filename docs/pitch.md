# Gatsby Tea / TNJC system: proposed improvements

## How it works now
- **Notion is the master record.** The scheduling script (github.com/KevHH/gatsby_tea_scheduling, plus the Apps Scripts in the gatsby.tea Drive) reads it, and the fairness queue counts turns from it.
- **The calendar (gatsby.tea@gmail.com) is a copy.** It's only written when someone runs the "TNJC finalizing script", about every two months. Swaps made in Notion or through the swap form don't reach it, so organisers update the calendar by hand.
- **Swap form:** https://forms.gle/gAhQs4diAe6JBTHW7 asks for the original owner's email, the new owner's email, the date, the slot type and the duty type.
- **External speakers** go into CSNJC slots, and organisers rename the calendar event.

## Problems
1. Every change has to be made in two places, and the two drift apart. A swap made only in the calendar leaves Notion wrong, so the fairness queue skips or double-counts people.
2. Swapping means typing other people's registered emails, and few people know about the form.
3. Guest speakers aren't recorded in Notion. The internal person who was bumped still shows as having presented, so they lose their turn.
4. The organiser know-how lives in handed-down notes.

## Proposals (in priority order)
1. **Pre-filled swap links in every calendar event and duty email.** Add something like "Can't make it? Swap here → <link>". Field IDs for the existing form:
   `https://docs.google.com/forms/d/e/1FAIpQLSdhhA06B3jW4vdns7FTCop02oyIrW40PzaouHNrSN09aWn49Q/viewform?usp=pp_url&entry.1261681028=<owner email>&entry.1056180517=<new owner email>&entry.1526923741=<YYYY-MM-DD>&entry.129875296=<TNJC|MLJC|Tea Talk|…>&entry.918272115=<Presenter|Tea preparation / Coffee cleaning>`
2. **Dropdowns instead of typed emails.** Add an Apps Script on the form, run daily, that rebuilds the choices from Notion:
   - "Which slot?" lists upcoming slots, e.g. `Tue 20 Oct – TNJC – <name>`. This replaces the date, slot type and owner fields.
   - "Who's taking it?" lists active people for that slot type.
   - Show **names only**, never emails, because the form is public. Map names to emails behind the scenes.
   - Either change the response handler to understand the new answers, or have the script translate them into the old five fields.
3. **Daily automatic Notion → calendar sync** that also updates existing events, not just new ones. This removes the manual calendar step. It needs a "guest speaker" field on Notion slots first, or the sync will overwrite guest names.
4. **A reconciler for manual calendar edits.** It runs before the sync and uses the Calendar API's `syncToken` to find changed events. It parses `<Type>: <Name>` from each title and compares it with Notion:
   - The name is a different registered person → internal swap. Email the organiser and both people a pre-filled form link, or update Notion automatically.
   - The name isn't in the people database → external guest. Ask the organiser to mark the slot as a guest in Notion.
5. **An organiser handbook.** Make it a non-public sub-page of the TNJC Guide on Notion, linked from the top of each script. It should cover:
   - access setup (tea tsar, 2FA, Google Group admin)
   - the two-monthly scheduling run
   - the CSNJC rule for external speakers
   - adding first years in term 3 and removing graduates
   - no passwords in the text
   Also automate the reminders (two-monthly scheduling run, first years in term 3).

## Needed to build this
- The Notion integration token and database IDs the existing scripts use.
- The property names in the people and schedule databases.
- The bot's form-response handler and the code that writes the calendar.
