// One-off: moves the scripts and notebooks superseded on 2026-10-27 into one Drive folder of the bot
// account. Nothing is deleted: everything still opens and runs from the folder. Run archive_superseded()
// once from the editor; it logs what it moved. (Kept separate from "Gatsby Tea Automation" so that the
// live automation never needs access to all of Drive.)

const ARCHIVE_FOLDER = 'Gatsby tea – archive (superseded 2026-10-27)';

// standalone Apps Script projects (form- and sheet-bound scripts live inside their files and stay put)
const SUPERSEDED_SCRIPTS = {
  '1AAEN9kopB6KR60NGd-K6pfVlnE-WCttJ0goWkySS-5r1I1QjabIaPQgK': 'TNJC Finalizing Script (now: Finalise on the tea page)',
  '1dX4Wo7Ku83zDgUOTjNoX9UAb94kVeYoqA3RT-fbTKpxjqAzvULgdQBvS': 'MLJC Finalizing Script (now: Finalise on the tea page)',
  '18BBq-1hPYGbpvM3D1tWy-pvpyoaBTKWWLdHVdCa72v1xwbEXxatgiHR_': 'Coffee Finalizing Script (now: Finalise on the tea page)',
  '1PrbGcgj0zwOjXStVGH0V4jXzULlpbfLU7d-J0JK7NzNBoL_rsp3hYTs1': 'Gatsby Tea Scheduling Script = talks finalizing (now: Finalise on the tea page)',
  '19nRVquWevIEkti2vW_y7V9odBVYvMkB42OyCduR7JKROE0mCnJMEd10E': 'Copy of TNJC Finalizing Script (2023)',
  '1C2Uta_x2jJXWb8lBgFMCWv1CbAiI-u93LfAEROP0eIdDexsjcyJIwxYQ': 'Copy of Gatsby Tea Scheduling Script (2023)',
  '16EpA5hzohNrlya-KK_QK7CKhamT_9q6_tg2VTfRgZXwESMMrUpBZXlZ_': 'Copy of MLJC Finalizing Script (2023)',
  '1JpVgazZreE0gSS063Te2XqgSMS-86dUeA4VorQfUvyviKDK0BrgcHn_V': 'Copy of Coffee Finalizing Script (2023)',
  '16TKvwMoIWd72y0TG1mDlD7h50tc71vOTnL5R0yzDrF-E5_561SO4DdUd': 'Copy of Gatsby Tea Cron Jobs (2023)',
  '1rB8ZG-CG5kmKXGl2eEgCHtJsJ02tXd2Ba_pf4WjBCmGzCWu7ib--h96t': 'Backup: Gatsby Tea Cron Jobs (has an old Notion token typed in: rotate the token)'
};

// Colab notebooks (now: Create / Fill on the tea page)
const SUPERSEDED_NOTEBOOK_TITLES = [
  'TNJC Scheduling Script.ipynb', 'MLJC Scheduling Script.ipynb', 'Coffee Scheduling Script.ipynb', 'Gatsby Tea Scheduling Script.ipynb',
  'Gatsby Tea Scheduling Script_backup_20220425.ipynb', 'Backup: Refresh Notion Talk Date data.ipynb',
  'Backup: Script for Syncing Away Date Update from Old System.ipynb'
];

const SUPERSEDED_FORMS = {
  '1Pj-VOtLfaSlPmCpKFw9DqN0nqalaBZdYMdWwJ8-Y-ZI': 'Gatsby Tea – swap a slot (dropdown form, never opened; replaced by the tea page)'
};

function archive_superseded(){
  var folders = DriveApp.getFoldersByName(ARCHIVE_FOLDER);
  var folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(ARCHIVE_FOLDER);
  folder.setDescription('Scripts and notebooks replaced by "Gatsby Tea Automation" (tea page, calendar sync, scheduling) on 2026-10-27. ' +
                        'Nothing here is used any more, but everything still opens. Code and history: github.com/GatsbyUnit/gatsby-teabot');
  var moved = [], missing = [];
  var move = function(id, label){
    try {
      var f = DriveApp.getFileById(id);
      f.moveTo(folder);
      moved.push(label + ' (' + f.getName() + ')');
    } catch (e) {
      missing.push(label + ': ' + e.message);
    }
  };
  Object.keys(SUPERSEDED_SCRIPTS).forEach(function(id){ move(id, SUPERSEDED_SCRIPTS[id]); });
  Object.keys(SUPERSEDED_FORMS).forEach(function(id){ move(id, SUPERSEDED_FORMS[id]); });
  SUPERSEDED_NOTEBOOK_TITLES.forEach(function(title){
    var it = DriveApp.searchFiles('title = "' + title.replace(/"/g, '\\"') + '" and trashed = false');
    var n = 0;
    while (it.hasNext()){ var f = it.next(); move(f.getId(), 'notebook'); n++; }
    if (!n) missing.push('notebook "' + title + '" not found');
  });
  move(ScriptApp.getScriptId(), 'this archive helper');
  Logger.log('Archive folder: ' + folder.getUrl());
  Logger.log('Moved ' + moved.length + ':\n' + moved.join('\n'));
  if (missing.length) Logger.log('Not moved ' + missing.length + ':\n' + missing.join('\n'));
}
