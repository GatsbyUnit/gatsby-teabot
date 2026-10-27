// Dropdown swap form: "Which slot?" and "Who is taking it over?", rebuilt daily from Notion.
// Names only (the form is open to anyone with the link); the label -> Notion id mapping lives in the
// log spreadsheet. A submission updates Notion and the calendar at once and emails both people.

function setup_swap_form(){
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('SWAP_FORM_ID')) return FormApp.openById(props.getProperty('SWAP_FORM_ID'));
  var form = FormApp.create('Gatsby Tea – swap a slot');
  form.setDescription(
    'Pick your slot and who is taking it over. Notion and the calendar update straight away, and you both get an email.\n' +
    'Agree the swap with the other person first. Slots that are still tentative cannot be swapped yet.'
  );
  form.setCollectEmail(false);
  form.setShowLinkToRespondAgain(true);
  form.setConfirmationMessage('Thanks! You will both get a confirmation email in a minute. If nothing arrives, reply to any tea bot email.');
  var slot = form.addListItem().setTitle('Which slot?').setRequired(true).setChoiceValues(['(loading)']);
  var person = form.addListItem().setTitle('Who is taking it over?').setRequired(true).setChoiceValues(['(loading)']);
  form.setAcceptingResponses(false);  // opened with open_swap_form() at go-live
  props.setProperty('SWAP_FORM_ID', form.getId());
  props.setProperty('SWAP_SLOT_ITEM_ID', String(slot.getId()));
  props.setProperty('SWAP_PERSON_ITEM_ID', String(person.getId()));
  return form;
}

function refresh_swap_form(){
  var constants = get_global_constants();
  try {
    var ctx = make_context(constants, get_settings());
    refresh_swap_choices(ctx);
  } catch (err) {
    notify_error('Swap form refresh', err, constants);
    throw err;
  }
}

function refresh_swap_choices(ctx){
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SWAP_FORM_ID')) return;
  var form = FormApp.openById(props.getProperty('SWAP_FORM_ID'));
  var today = start_of_today();
  var until = add_days(today, ctx.settings.swap_horizon_days);

  var slots = [];
  ctx.settings.swap_types.forEach(function(type){
    load_rows(type, today, until, ctx).forEach(function(row){
      if (is_tentative(row)) return;
      slot_duties(row).forEach(function(d){ slots.push(d); });
    });
  });
  slots.sort(function(a, b){ return a.row.start - b.row.start; });
  var slot_rows = unique_labels(slots.map(function(d){ return slot_label(d, ctx); })).map(function(label, i){
    return [label, slots[i].row.id, slots[i].duty, slots[i].person_id];
  });

  var active = Object.keys(ctx.people).map(function(id){ return ctx.people[id]; })
    .filter(function(p){ return p.active && p.name; })
    .sort(function(a, b){ return a.name.localeCompare(b.name); });
  var people_rows = unique_labels(active.map(function(p){ return p.name; })).map(function(label, i){
    return [label, active[i].id];
  });

  write_table(ctx, SWAP_SLOTS_TAB, slot_rows, 4);
  write_table(ctx, SWAP_PEOPLE_TAB, people_rows, 2);
  form.getItemById(Number(props.getProperty('SWAP_SLOT_ITEM_ID'))).asListItem()
    .setChoiceValues(slot_rows.length ? slot_rows.map(function(r){ return r[0]; }) : ['(no upcoming slots)']);
  form.getItemById(Number(props.getProperty('SWAP_PERSON_ITEM_ID'))).asListItem()
    .setChoiceValues(people_rows.map(function(r){ return r[0]; }));
}

// one entry per person-duty in a slot
function slot_duties(row){
  var out = [];
  if (PRESENTER_TYPES.indexOf(row.type) >= 0 && !row.guest){
    row.presenter_ids.forEach(function(id){ out.push({row: row, duty: 'presenter', person_id: id}); });
  }
  if (TEA_TYPES.indexOf(row.type) >= 0){
    row.tea_ids.forEach(function(id){ out.push({row: row, duty: 'tea', person_id: id}); });
  }
  return out;
}

function slot_label(d, ctx){
  var name = ctx.people[d.person_id] ? ctx.people[d.person_id].name : '(unknown)';
  if (d.row.type === 'Coffee Cleaning'){
    return 'Coffee duty, week of ' + fmt_day(d.row.start) + ' · ' + name;
  }
  var type = d.row.type + (d.row.type === 'TNJC' && d.row.csnjc ? ' (CSNJC)' : '');
  return fmt_day(d.row.start) + ' · ' + type + ' · ' + (d.duty === 'tea' ? 'tea: ' : '') + name;
}

function unique_labels(labels){
  var seen = {};
  return labels.map(function(l){
    if (!(l in seen)){ seen[l] = 1; return l; }
    seen[l]++;
    return l + ' (' + seen[l] + ')';
  });
}

function swap_label_for_row(row, ctx){
  if (ctx.swap_slots === undefined) ctx.swap_slots = read_table(ctx, SWAP_SLOTS_TAB, 4);
  for (var i = 0; i < ctx.swap_slots.length; i++){
    var r = ctx.swap_slots[i];
    if (r[1] === row.id && r[2] === 'presenter') return r[0];
  }
  for (var i = 0; i < ctx.swap_slots.length; i++){
    if (ctx.swap_slots[i][1] === row.id) return ctx.swap_slots[i][0];
  }
  return null;
}

// installable trigger on the swap form
function on_swap_submit(e){
  var lock = LockService.getScriptLock();
  lock.waitLock(60 * 1000);
  var constants = get_global_constants();
  try {
    handle_swap_response(e.response, make_context(constants, get_settings()));
  } catch (err) {
    notify_error('Swap form', err, constants);
    throw err;
  } finally {
    lock.releaseLock();
  }
}

function handle_swap_response(response, ctx){
  var props = PropertiesService.getScriptProperties();
  var answers = {};
  response.getItemResponses().forEach(function(ir){ answers[ir.getItem().getId()] = ir.getResponse(); });
  var slot_label_text = answers[Number(props.getProperty('SWAP_SLOT_ITEM_ID'))];
  var person_label = answers[Number(props.getProperty('SWAP_PERSON_ITEM_ID'))];

  var slot = read_table(ctx, SWAP_SLOTS_TAB, 4).filter(function(r){ return r[0] === slot_label_text; })[0];
  var person = read_table(ctx, SWAP_PEOPLE_TAB, 2).filter(function(r){ return r[0] === person_label; })[0];
  var organiser = ctx.constants['tnjc_admin_email'];
  if (!slot || !person){
    send_mail(organiser, 'Swap form: could not match a response', ['Someone submitted the swap form, but the choices no longer match the current lists (they were probably refreshed in between). Nothing was changed.', {table: [['Slot', String(slot_label_text)], ['New person', String(person_label)]]}], ctx.constants);
    return;
  }

  var row = to_row(notion_get_page(slot[1], ctx.constants));
  var duty = slot[2];
  var from_id = slot[3];
  var to_id = person[1];
  try {
    apply_swap(row, duty, from_id, to_id, ctx);
  } catch (err) {
    var both = emails_of([from_id, to_id], ctx.people);
    var org = admin_email_for_type(row.type, ctx.constants);
    send_mail(both.length ? both.join(',') : org, 'Swap not done', [String(err.message || err), {table: [['Slot', fmt_day(row.start) + ', ' + row.type], ['From', names_of([from_id], ctx.people)[0]], ['To', names_of([to_id], ctx.people)[0]]]}, 'Reply to this email if you need help.'], ctx.constants, {reply_to: org});
    log_row(ctx, 'swap form', row.type, row.start, 'rejected', String(err.message || err));
    return;
  }
  refresh_swap_choices(ctx);
}
