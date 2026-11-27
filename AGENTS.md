# Notes for coding agents

## Keep the email load low

The unit gets a lot of email; the bot should add as little as it can. Before adding an email (or a recipient, or a
cc), ask whether the person has to do something because of it, or would be caught out not knowing.

- Tsars and organisers get email only when they need to act: a decision (a sign-off), something to fix (a name the
  bot can't place, a slot nobody is free for, a job that keeps failing), or people who could not be told (no
  registered address). No FYI copies, no "done" or "success" summaries: the log sheet records what the bot did.
- People on duty: one email per change that affects them; fold news into an email they get anyway where you can.
- Mailing lists (unit-wide, TNJC, MLJC, coffee): check back with the maintainer first.

## Pushing and deploying

You may push to `main` and deploy without checking back with the maintainer whenever that is sensible, for
example a bug fix or a change the maintainer has already asked for, once the tests pass (`node tests/run.js`).

    git push && PATH=/opt/homebrew/bin:$PATH python3 deploy/deploy.py --yes

Pushing `main` also publishes the site (GitHub Pages). After a deploy, check that the Pages run went green
(`gh run list`) and say what went live.

Check back first when a change:

- emails many people, or changes what the unit sees or is asked to do in a way they haven't been told about;
- changes settings (the constants sheet, the Automation tab) or deletes or rewrites rota data;
- needs a force-push or rewrites history;
- is only half done, or its tests fail.
