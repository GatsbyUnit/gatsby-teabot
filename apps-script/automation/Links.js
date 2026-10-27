// Swap / title links at the end of future event descriptions. The title form rewrites the whole
// description, so the hourly sync puts the links back. Everything from LINK_MARK on is ours.
// Links never contain email addresses: the calendar is public.

const LINK_MARK = '🫖';

function ensure_links(event, row, ctx){
  var desc = event.getDescription() || '';
  var html = /<(br|p|a|div)\b/i.test(desc);
  var next = strip_links(desc) + links_footer(row, ctx, html);
  if (next === desc) return false;
  if (is_live(ctx, row.type)) event.setDescription(next);
  return true;
}

function strip_links(desc){
  var i = desc.indexOf(LINK_MARK);
  var base = i >= 0 ? desc.slice(0, i) : desc;
  return base.replace(/(\s|<br\s*\/?>)+$/i, '');
}

// With the personal page deployed, one link does it all (the page lets you pick your name and sends you
// your personal link); before that, prefilled links to the old forms.
function links_footer(row, ctx, html){
  var page = ctx.settings.PAGE_URL;
  if (page){
    if (html) return '<br><br>' + LINK_MARK + ' <a href="' + esc(page) + '">Swap your slot, add a title or set away dates</a>';
    return '\n\n' + LINK_MARK + ' Swap your slot, add a title or set away dates: ' + page;
  }
  var swap = swap_link(row, ctx);
  var title = PRESENTER_TYPES.indexOf(row.type) >= 0 ? title_link(row, ctx) : null;
  if (html){
    var s = '<br><br>' + LINK_MARK + ' Can\'t make it? <a href="' + esc(swap) + '">Swap your slot</a>';
    if (title) s += '<br>✏️ <a href="' + esc(title) + '">Add or edit the talk title</a>';
    return s;
  }
  var t = '\n\n' + LINK_MARK + ' Can\'t make it? Swap your slot: ' + swap;
  if (title) t += '\n✏️ Add or edit the talk title: ' + title;
  return t;
}

// fallback when PAGE_URL is not set: the old swap form, prefilled with date, type and duty
function swap_link(row, ctx){
  var duty = PRESENTER_TYPES.indexOf(row.type) >= 0 ? 'Presenter' : 'Tea preparation / Coffee cleaning';
  return OLD_SWAP_FORM_URL + '?usp=pp_url'
    + '&' + OLD_SWAP_FORM_ENTRIES.date + '=' + fmt_iso_date(row.start)
    + '&' + OLD_SWAP_FORM_ENTRIES.slot_type + '=' + encodeURIComponent(row.type)
    + '&' + OLD_SWAP_FORM_ENTRIES.duty + '=' + encodeURIComponent(duty);
}

// prefilled "Edit Talk Title / Description" form (date + talk type); null if the form can't be read
function title_link(row, ctx){
  if (ctx.title_form === undefined){
    try {
      ctx.title_form = FormApp.openByUrl(SpreadsheetApp.openById(TITLE_FORM_RESPONSE_SHEET_ID).getFormUrl());
    } catch (e) {
      log_row(ctx, 'links', '', null, 'title form unavailable', String(e));
      ctx.title_form = null;
    }
  }
  var form = ctx.title_form;
  if (!form) return null;
  var response = form.createResponse();
  form.getItems().forEach(function(item){
    var t = item.getTitle();
    try {
      if (t === 'Date of Talk' && item.getType() === FormApp.ItemType.DATE){
        response.withItemResponse(item.asDateItem().createResponse(row.start));
      } else if (t === 'Talk type' && item.getType() === FormApp.ItemType.MULTIPLE_CHOICE){
        response.withItemResponse(item.asMultipleChoiceItem().createResponse(row.type));
      } else if (t === 'Talk type' && item.getType() === FormApp.ItemType.LIST){
        response.withItemResponse(item.asListItem().createResponse(row.type));
      }
    } catch (e) {
      // e.g. the type is not one of the form's choices; leave that field empty
    }
  });
  return response.toPrefilledUrl();
}
