// Third round (2026-10-27): tidies the bot's My Drive so that the top level holds only what is live. The
// folders and files of the old system go into the archive folder; the TNJC paper list, which the TNJC Guide
// on Notion links to, comes out of _TNJC scheduling to the top level. Everything is moved by ID, and the live
// scripts find their folders by ID too, so they are unaffected. Run tidy_drive() once from the editor.
const TO_TOP_LEVEL = {
  '1TE2lvanIATgRgLkokq4xinqdOydk4IGmX1x0P3UXCK4': 'Gatsby TNJC Paper List (linked from the TNJC Guide on Notion)'
};

const OLD_SYSTEM_FOLDERS = {
  '1KRVefQY9n2-FcATnTNkMqAd3QjTIvzeT': '_backups (2023 copies of the old forms, notebooks and sheets)',
  '1jNsu5ETLrboyH98vbr_NxkT4CL16O-wm': '_Coffee scheduling (output of the old coffee notebook)',
  '12EpwbBayLt9en8BMfbAHKXHpsOxLyiYK': '_MLJC scheduling (empty)',
  '1ksefaQdcD3YpdSDsGwdhmOjKwTErv1tA': '_Research and Tea Talks scheduling (empty)',
  '1hrtvuAngpqzAUjUAYMU-ZOvl0-exCuZf': '_TNJC scheduling (a 2023 copy of the paper list)',
  '1pReeSvlqgzaB8nz6i5TG-8iIM-pnZBC1': 'instructions_for_old_system (2021)',
  '1M1EYuFPgU-ElVHUip5dB9XMZTyN8dXSg': 'schedule_files (cluster-format schedules, 2003 to 2021)',
  '18F9rbZ0dExwvRom-HXeNkeBLaEvZKKtB': 'away_dates/cluster_format (last used in 2022)'
};

const OLD_SYSTEM_FILES = {
  '11p79kQIQzKZNNGOVQuGuOG7i1WdfGdJgn-g-BNgvXLI': 'Zoom request form (closed; Zoom is requested on the tea page now)',
  '18OG6_kRs28PpV8Z14NLZWYhQ3FU0139WfBy7jfMEc0s': 'responses of the Zoom request form',
  '17SSTq9jgYnkY5uZBG0BznWqpSjg7ZeuYiWStTSQBThI': 'backup of everything, taken just before the switch-over',
  '1C9XLss4N9XPDX8Ykq77GLe2M6oRd--JyycySh2L9Tmo': 'Untitled spreadsheet (empty, created 2026-05-05)'
};

function tidy_drive(){
  var archive = DriveApp.getFoldersByName(ARCHIVE_FOLDER).next();
  archive.setDescription('Everything the tea bot replaced on 2026-10-27 (scripts, forms, Colab notebooks) and the files of the ' +
                         'systems before it. Nothing here is used any more, but everything still opens. Live: the files at the ' +
                         'top level of My Drive, plus the away_dates and people_files folders. Code: github.com/GatsbyUnit/gatsby-teabot');
  var moved = [], failed = [];
  var move = function(get, id, label, to){
    try {
      get(id).moveTo(to);
      moved.push(label);
    } catch (e) {
      failed.push(label + ': ' + e.message);
    }
  };
  var file = function(id){ return DriveApp.getFileById(id); };
  var folder = function(id){ return DriveApp.getFolderById(id); };
  var root = DriveApp.getRootFolder();
  Object.keys(TO_TOP_LEVEL).forEach(function(id){ move(file, id, TO_TOP_LEVEL[id] + ' -> top level', root); });
  Object.keys(OLD_SYSTEM_FOLDERS).forEach(function(id){ move(folder, id, OLD_SYSTEM_FOLDERS[id], archive); });
  Object.keys(OLD_SYSTEM_FILES).forEach(function(id){ move(file, id, OLD_SYSTEM_FILES[id], archive); });
  Logger.log('Moved ' + moved.length + ':\n' + moved.join('\n'));
  if (failed.length) Logger.log('Not moved ' + failed.length + ':\n' + failed.join('\n'));
  var top = [], it = root.getFolders();
  while (it.hasNext()) top.push(it.next().getName() + '/');
  it = root.getFiles();
  while (it.hasNext()) top.push(it.next().getName());
  Logger.log('Top level of My Drive now:\n' + top.sort().join('\n'));
}
