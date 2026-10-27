// Second round (2026-10-27): the old Google Forms, now closed and pointing to the tea page, with their
// response sheets (their scripts are attached to them and move along).
const SUPERSEDED_FORMS_2 = {
  '1jLwlHqK75zCRn51LKvhmei8oumaYuYejfso0jiIdo9s': 'old swap form (Change Presenter / Tea Person)',
  '1IbNu8Q49KBNweiDMDGUT_krXF-1trHet55d02XJGENw': 'old title / description / Zoom request form',
  '1GW2dMrzBzBHVBXkPx3cjTgAKWwry14I6rVCCTOYJNW4': 'old change-email form',
  '1AwdUBzdb5aDjs6koyd3seyRuQaaxDZmbpu1Yc5mvgno': 'responses of the old swap form',
  '1XeSjwN9z9WnkW4_4E8Cocbr-bmGHIMwEPfKshbxKOCw': 'responses of the old title / Zoom form',
  '1r3d9RVVr_yNcB1qx9sVP05j6Z7iWU1kXIbeVOXvuXlo': 'responses of the old change-email form'
};

function archive_old_forms(){
  var folder = DriveApp.getFoldersByName(ARCHIVE_FOLDER).next();
  var moved = [], missing = [];
  Object.keys(SUPERSEDED_FORMS_2).forEach(function(id){
    try {
      var f = DriveApp.getFileById(id);
      f.moveTo(folder);
      moved.push(SUPERSEDED_FORMS_2[id] + ' (' + f.getName() + ')');
    } catch (e) {
      missing.push(SUPERSEDED_FORMS_2[id] + ': ' + e.message);
    }
  });
  Logger.log('Moved ' + moved.length + ':\n' + moved.join('\n'));
  if (missing.length) Logger.log('Not moved ' + missing.length + ':\n' + missing.join('\n'));
}
