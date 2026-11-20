// Every email goes out as multipart: a formatted HTML part for normal mail clients and a plain-text
// part that reads well in terminal clients (mutt, alpine), which show text/plain.
//
// Messages are built from a small block list so both parts come from the same content:
//   'paragraph text'                       paragraph; [label](https://...) inside any text becomes a link
//                                          (HTML: clickable label; plain text: "label <url>"); **text** is bold
//                                          in HTML (plain text: the words alone)
//   {heading: 'text'}                      section heading
//   {items: ['a', 'b']}                    bullet list
//   {link: 'label', url: 'https://...'}    link on its own line
//   {table: [['Date', 'Tue 20 Oct'], ...]} two-column key/value table
//
// options.as: the email goes to the tsars in `to` as tsars (a rota type, a ROTAS key, a constants cell or 'tsar';
// see tsar_title). It then opens with their title, "Hi TNJC Tsar," (tsar_greeting).

function send_mail(to, subject, blocks, constants, options){
  options = options || {};
  var leave = options.no_leave ? '' : leave_url(to, options, constants);  // no_leave: someone not on the rotas
  var footer = [
    {rule: true},
    'Gatsby Tea Bot · [Gatsby Rotas](' + site_url(get_settings()) + ')' + (leave ? ' · [Leave the tea system (no longer a member of the Unit)](' + leave + ')' : '')
  ];
  var hi = '';
  try { hi = tsar_greeting(to, options.cc, options.as, constants); } catch (err) { Logger.log('greeting: ' + err); }
  var all = (hi ? [hi] : []).concat(blocks, footer);
  var mail = {
    to: to,
    subject: '[Gatsby Tea Bot] ' + subject,
    body: blocks_to_text(all),
    htmlBody: blocks_to_html(all),
    name: 'Gatsby Tea Bot'
  };
  if (options.reply_to) mail.replyTo = options.reply_to;
  if (options.cc) mail.cc = options.cc;
  MailApp.sendEmail(mail);
}

// ---- greeting the tsars ----

// the constants cell of each tsar, and the badge (Badges.js) whose label is their title
const TSAR_CELLS = [['admin_email', 'tsar'], ['tnjc_admin_email', 'TNJC'], ['mljc_admin_email', 'MLJC'], ['coffee_admin_email', 'Coffee Cleaning']];

// This address's title as a tsar ('TNJC Tsar'), '' for none. role (a rota type or ROTAS key, a constants cell, or
// 'tsar') picks the title for someone who holds several; any other role (the talks) is the tea tsar's.
function tsar_title(email, role, constants){
  email = String(email || '').trim().toLowerCase();
  if (!email) return '';
  var own = TSAR_CELLS.filter(function(c){ return c[0] === role || c[1] === role; })[0] || TSAR_CELLS[0];
  var cells = [own].concat(TSAR_CELLS.filter(function(c){ return c !== own; }));
  for (var i = 0; i < cells.length; i++){
    var holds = split_list(constants[cells[i][0]] || '').some(function(e){ return e.toLowerCase() === email; });
    if (holds) return ROYAL_BADGES[cells[i][1]].label;
  }
  return '';
}

// The first line of an email sent to tsars as tsars (as, see tsar_title), by their title only, so they see at once
// why it came to them: "Hi TNJC Tsar," or, with the tea tsar in cc, "Hi TNJC Tsar and Tea Tsar,". '' when nobody in
// to is a tsar. Also used by the Cron Jobs (TeaBot.tsar_greeting, without constants).
function tsar_greeting(to, cc, as, constants){
  if (!as) return '';
  constants = constants || get_global_constants();
  var titles = function(list){ return split_list(list || '').map(function(e){ return tsar_title(e, as, constants); }).filter(Boolean); };
  var parts = titles(to);
  if (!parts.length) return '';
  parts = parts.concat(titles(cc)).filter(function(t, i, a){ return a.indexOf(t) === i; });
  return 'Hi ' + (parts.length > 1 ? parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1] : parts[0]) + ',';
}

function blocks_to_text(blocks){
  var out = [];
  blocks.forEach(function(b){
    if (typeof b === 'string'){ out.push(wrap_text(inline_text(b), 72)); }
    else if (b.heading){ out.push(b.heading.toUpperCase()); }
    else if (b.items){ out.push(b.items.map(function(i){ return wrap_text('- ' + inline_text(i), 72, '  '); }).join('\n')); }
    else if (b.link){ out.push(b.link + ':\n  ' + b.url); }
    else if (b.table){
      var w = Math.max.apply(null, b.table.map(function(r){ return r[0].length; }));
      out.push(b.table.map(function(r){ return pad_right(r[0], w) + '  ' + inline_text(r[1]); }).join('\n'));
    }
    else if (b.rule){ out.push('--'); }
  });
  return out.join('\n\n') + '\n';
}

function blocks_to_html(blocks){
  var p = 'margin:0 0 14px 0;';
  var body = blocks.map(function(b){
    if (typeof b === 'string'){ return '<p style="' + p + '">' + inline_html(b).replace(/\n/g, '<br>') + '</p>'; }
    if (b.heading){ return '<h3 style="margin:20px 0 8px 0;font-size:15px;">' + esc(b.heading) + '</h3>'; }
    if (b.items){ return '<ul style="' + p + 'padding-left:20px;">' + b.items.map(function(i){ return '<li style="margin:0 0 4px 0;">' + inline_html(i) + '</li>'; }).join('') + '</ul>'; }
    if (b.link){ return '<p style="' + p + '"><a href="' + esc(b.url) + '" style="display:inline-block;padding:8px 14px;background:#1a73e8;color:#ffffff;text-decoration:none;border-radius:6px;">' + esc(b.link) + '</a></p>'; }
    if (b.table){ return '<table style="' + p + 'border-collapse:collapse;">' + b.table.map(function(r){ return '<tr><td style="padding:2px 16px 2px 0;color:#5f6368;">' + esc(r[0]) + '</td><td style="padding:2px 0;">' + inline_html(r[1]) + '</td></tr>'; }).join('') + '</table>'; }
    if (b.rule){ return '<hr style="border:none;border-top:1px solid #dadce0;margin:20px 0 10px 0;">'; }
    return '';
  }).join('\n');
  return '<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#202124;max-width:600px;">' + body + '</div>';
}

const INLINE_LINK = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
const INLINE_BOLD = /\*\*([^*]+)\*\*/g;

function inline_text(s){
  return String(s).replace(INLINE_LINK, '$1 <$2>').replace(INLINE_BOLD, '$1');
}

function inline_html(s){
  return esc(s).replace(INLINE_LINK, '<a href="$2" style="color:#1a73e8;">$1</a>').replace(INLINE_BOLD, '<strong>$1</strong>');
}

function esc(s){
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function pad_right(s, w){
  while (s.length < w) s += ' ';
  return s;
}

function wrap_text(s, width, indent){
  indent = indent || '';
  return String(s).split('\n').map(function(line){
    var words = line.split(' ');
    var lines = [];
    var cur = '';
    words.forEach(function(word){
      if (cur.length > 0 && (cur + ' ' + word).length > width){
        lines.push(cur);
        cur = indent + word;
      } else {
        cur = cur.length > 0 ? cur + ' ' + word : word;
      }
    });
    lines.push(cur);
    return lines.join('\n');
  }).join('\n');
}
