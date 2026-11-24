# Notes for coding agents

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
