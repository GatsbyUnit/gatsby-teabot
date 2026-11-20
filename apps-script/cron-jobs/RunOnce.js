// One-off (2026-11-20; remove after use): emails the tea tsar one copy of each reminder the Cron Jobs send to the
// people on duty (presentation, tea duty, upload your slides, coffee cleaning), as they look now, built from real
// upcoming slots. Nobody else is emailed: everyone on duty is replaced by the tea tsar (so the tea page line shows
// the tea tsar's own link), notices to the tea tsar are left out, and the subjects start with SAMPLE. Run from the editor.
function run_once_reminder_samples(){
  const constants = get_global_constants();
  const me = String(constants['admin_email']).split(',')[0].trim();
  const real_send = send_email, real_lookup = get_email_from_notion_id;
  const kinds = ['Presentation', 'Tea Duty', 'upload your slides', 'Coffee Cleaning'];
  const sent = {}, skipped = [];
  const started = Date.now(), time_left = function(){ return Date.now() - started < 4.5 * 60 * 1000; };
  var current = null, talk_day = null;
  send_email = function(email, title, body, c, reply){
    if (!talk_day && /(Research Talk|Tea Talk) Presentation/.test(title)) talk_day = current;
    var kind = kinds.filter(function(k){ return title.indexOf(k) >= 0; })[0];
    if (!kind || sent[kind]){ skipped.push(title); return; }
    real_send(me, 'SAMPLE ' + title, body, c, reply);
    sent[kind] = title;
  };
  get_email_from_notion_id = function(){ return [me]; };
  try {
    // the talk reminders go out 14 days and 7 days before a talk, and on the day: today's first, then other days
    var offsets = [0, 7, 14];
    for (var i = 1; i <= 42; i++) if (offsets.indexOf(i) < 0) offsets.push(i);
    for (var o = 0; o < offsets.length && time_left() && !(sent['Presentation'] && sent['Tea Duty'] && talk_day); o++){
      var d = offsets[o];
      current = new Date(started + d * 864e5);
      talkreminder(me, current, 'duty_people', d === 0 ? 'today' : d <= 10 ? 'next week' : 'the week after next', constants);
    }
    // the upload-slides reminder goes out on the day of a research or tea talk
    if (talk_day && time_left()) slidesreminder(me, talk_day, 'duty_people', constants);
    // the coffee reminder covers the week from Monday
    var monday = new Date(started);
    monday.setDate(monday.getDate() - (monday.getDay() + 6) % 7);
    for (var w = 0; w <= 6 && time_left() && !sent['Coffee Cleaning']; w++){
      talkreminder(me, new Date(monday.getTime() + w * 7 * 864e5), 'coffee_people', 'today', constants);
    }
  } finally {
    send_email = real_send;
    get_email_from_notion_id = real_lookup;
  }
  Logger.log('Sent to ' + me + ':\n' + kinds.map(function(k){ return k + ': ' + (sent[k] || 'no upcoming slot found'); }).join('\n') +
             '\nLeft out: ' + skipped.length);
}
