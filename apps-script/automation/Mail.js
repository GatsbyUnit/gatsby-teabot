// Every email goes out as multipart: a formatted HTML part for normal mail clients and a plain-text
// part that reads well in terminal clients (mutt, alpine), which show text/plain.
//
// Messages are built from a small block list so both parts come from the same content:
//   'paragraph text'                       paragraph; [label](https://...) inside any text becomes a link
//                                          (HTML: clickable label; plain text: "label <url>")
//   {heading: 'text'}                      section heading
//   {items: ['a', 'b']}                    bullet list
//   {link: 'label', url: 'https://...'}    link on its own line
//   {table: [['Date', 'Tue 20 Oct'], ...]} two-column key/value table

function send_mail(to, subject, blocks, constants, options){
  options = options || {};
  var footer = [
    {rule: true},
    'Gatsby Tea Bot · [Gatsby Rotas on Notion](' + constants['notion_site_url'] + ')'
  ];
  var all = blocks.concat(footer);
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

function inline_text(s){
  return String(s).replace(INLINE_LINK, '$1 <$2>');
}

function inline_html(s){
  return esc(s).replace(INLINE_LINK, '<a href="$2" style="color:#1a73e8;">$1</a>');
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
