// The rotas' mailing lists (constants sheet: TNJC, CSNJC, MLJC and coffee lists). They are consumer Google Groups,
// whose members no Google API can change, so the bot can't keep them in step itself. Instead, whenever someone joins
// or leaves a rota (on the site, by leaving the tea system, or with a new address), the rota's organiser gets one
// email saying exactly whom to add to or remove from which list, with a link to the group's members page.

// rota -> [constants key of its list, constants key of whoever looks after it]
const ROTA_LISTS = {TNJC: ['tnjc_email', 'tnjc_admin_email'], CSNJC: ['csnjc_email', 'tnjc_admin_email'],
                    MLJC: ['mljc_email', 'mljc_admin_email'], Coffee: ['coffee_email', 'coffee_admin_email']};
const LIST_ROTAS = ['TNJC', 'CSNJC', 'MLJC', 'Coffee'];

// the lists someone belongs on: active and ticked for the rota (p as load_people has it; null = nobody)
function list_rotas(p){
  return p && p.active ? LIST_ROTAS.filter(function(r){ return p[r.toLowerCase()]; }) : [];
}

// What changes on the lists between two states of a person (null before: new; after inactive: left):
// [{rota, action: 'add' | 'remove' | 'replace', why: 'left' | 'off' (removes), name, email, old (replace)}]
function list_moves(before, after){
  var was = list_rotas(before), is = list_rotas(after);
  var old_email = String(before && before.email || ''), new_email = String(after && after.email || '');
  var moved = old_email.toLowerCase() !== new_email.toLowerCase();
  var out = [];
  LIST_ROTAS.forEach(function(rota){
    var w = was.indexOf(rota) >= 0, i = is.indexOf(rota) >= 0;
    if (w && !i && old_email) out.push({rota: rota, action: 'remove', why: after && after.active ? 'off' : 'left', name: before.name, email: old_email});
    if (!w && i) out.push({rota: rota, action: 'add', name: after.name, email: new_email});
    if (w && i && moved){
      if (old_email && new_email) out.push({rota: rota, action: 'replace', name: after.name, email: new_email, old: old_email});
      else if (new_email) out.push({rota: rota, action: 'add', name: after.name, email: new_email});
    }
  });
  return out;
}

// One email per organiser with everything to change on their lists. intro: who did what ("Lena Weber changed …").
function list_todo(moves, constants, intro){
  var mails = {};
  (moves || []).forEach(function(m){
    var keys = ROTA_LISTS[m.rota];
    var list = String(constants[keys[0]] || '').trim();
    var to = String(constants[keys[1]] || constants['admin_email'] || '').trim();
    if (!list || !to) return;
    var mail = mails[to] = mails[to] || {lists: {}, order: [], n: 0};
    if (!mail.lists[list]){ mail.lists[list] = {rota: m.rota, lines: []}; mail.order.push(list); }
    mail.lists[list].lines.push(list_line(m));
    mail.n++;
  });
  Object.keys(mails).forEach(function(to){
    var mail = mails[to];
    var blocks = [intro + ' The tea bot can\'t change Google Groups itself, so please update ' + (mail.order.length === 1 ? 'this mailing list' : 'these mailing lists') + ' by hand:'];
    mail.order.forEach(function(list){
      var g = list.match(/^([^@,;\s]+)@googlegroups\.com$/i);
      blocks.push({heading: mail.lists[list].rota + ': ' + list});
      blocks.push({items: mail.lists[list].lines});
      if (g) blocks.push('[Open its members](https://groups.google.com/g/' + g[1] + '/members)');
    });
    blocks.push('In the group: "Add members" (Gmail addresses can be added directly, other addresses get an invitation they accept); to remove someone, tick them on the members page and remove them.');
    try { send_mail(to, 'Mailing list: ' + mail.n + ' change' + (mail.n === 1 ? '' : 's') + ' to make', blocks, constants); }
    catch (err) { Logger.log('mailing list note to ' + to + ': ' + err); }
  });
}

function list_line(m){
  if (m.action === 'replace') return 'Replace ' + m.old + ' with ' + m.email + ' (' + m.name + '\'s new address)';
  if (m.action === 'add') return 'Add ' + m.name + (m.email ? ' <' + m.email + '>' : ' (no address registered yet: add them once they have one)');
  return 'Remove ' + m.name + ' <' + m.email + '>' + (m.why === 'left' ? ' (no longer on the rotas)' : ' (taken off ' + m.rota + '; keep them if they still want its emails)');
}

// a person as load_people has them (tnjc, csnjc, mljc, coffee, active, name, email), with changes on top
function list_person(before, changes){
  var p = Object.assign({tnjc: false, csnjc: false, mljc: false, coffee: false, active: true, name: '', email: ''}, before || {});
  Object.keys(changes || {}).forEach(function(k){ if (changes[k] !== undefined) p[k] = changes[k]; });
  return p;
}
