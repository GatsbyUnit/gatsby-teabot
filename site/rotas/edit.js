// Editing for the tsars, loaded only for them. Pages are edited in place: click any text, type, format it with
// the bar at the top, and save; slots, people and the rota rules have small forms where they are shown. The tea
// bot keeps the pages and writes the rota changes into Notion (apps-script/automation/Site.js).
'use strict';
(function () {
  const R = window.Rotas;
  const { esc } = R;
  const me = R.bundle().me;
  const $ = (sel, root = document) => root.querySelector(sel);
  const token = () => R.session()?.token;
  const HEX = /^[0-9a-f]{32}$/;

  function toast(text, error = false) {
    document.querySelector('.toast')?.remove();
    const el = document.createElement('div');
    el.className = 'toast' + (error ? ' error' : '');
    el.setAttribute('role', error ? 'alert' : 'status');
    el.textContent = text;
    document.body.append(el);
    setTimeout(() => el.remove(), error ? 7000 : 3500);
  }

  // =====================================================================================================
  // Pages
  // =====================================================================================================

  R.hooks.pageTools = (page) => me.pages && !page.error
    ? '<button type="button" class="edit-button" data-edit-page>✎ Edit this page</button>' : '';

  const KINDS = [
    ['p', 'Text'], ['h1', 'Heading 1'], ['h2', 'Heading 2'], ['h3', 'Heading 3'], ['ul', 'Bulleted list'],
    ['ol', 'Numbered list'], ['todo', 'To-do'], ['quote', 'Quote'], ['toggle', 'Toggle'],
  ];
  const TEXT_TYPES = new Set(['p', 'h1', 'h2', 'h3', 'ul', 'ol', 'todo', 'quote', 'callout', 'toggle']);
  // block elements that hold other blocks, and so are a parent
  const CONTAINER = 'details[data-id],details[data-new],li[data-id],li[data-new],blockquote[data-id],aside[data-id],section.column[data-id]';

  let editor = null; // the page being edited: {slug, article, before: Map, title, tmp}

  const blockOf = (el) => el.closest('[data-id],[data-new]');
  const isBlock = (el) => el.matches?.('[data-id],[data-new]') && (HEX.test(el.dataset.id || '') || el.dataset.new);
  const idOf = (el) => el.dataset.new || el.dataset.id;
  const typeOf = (el) => el.dataset.type;

  function editableOf(block) {
    const t = typeOf(block);
    if (t === 'p' || /^h[123]$/.test(t) && block.tagName !== 'DETAILS') return block;
    if (block.tagName === 'DETAILS') return $(':scope > summary .toggle-title', block);
    if (t === 'ul' || t === 'ol' || t === 'todo') return $(':scope > .li-text', block);
    if (t === 'quote' || t === 'callout') return $('.q-text', block);
    return null;
  }

  function makeEditable(el, placeholder = 'Type here') {
    el.contentEditable = 'true';
    el.dataset.editable = '';
    el.dataset.placeholder = placeholder;
    el.spellcheck = true;
  }

  // ---- rich text from what is on screen ----

  function domToRich(root) {
    const out = [];
    const push = (text, marks) => {
      text = text.replace(/​/g, '');
      if (!text) return;
      const last = out[out.length - 1];
      const same = last && ['b', 'i', 's', 'u', 'code', 'href', 'page', 'color'].every((k) => (last[k] || '') === (marks[k] || ''));
      if (same && !marks.page) last.text += text;
      else out.push({ text, ...Object.fromEntries(Object.entries(marks).filter(([, v]) => v)) });
    };
    const walk = (node, marks) => {
      if (node.nodeType === 3) return push(node.data, marks);
      if (node.nodeType !== 1 || node.classList.contains('avatar')) return;
      const tag = node.tagName;
      if (tag === 'BR') return push('\n', marks);
      const m = { ...marks };
      const weight = parseInt(node.style?.fontWeight, 10);
      if (tag === 'B' || tag === 'STRONG' || weight >= 600) m.b = true;
      if (tag === 'I' || tag === 'EM' || node.style?.fontStyle === 'italic') m.i = true;
      if (tag === 'S' || tag === 'DEL' || tag === 'STRIKE') m.s = true;
      if (tag === 'U') m.u = true;
      if (tag === 'CODE') m.code = true;
      if (node.dataset?.color) m.color = node.dataset.color;
      if (tag === 'A') {
        if (node.dataset.page) return push(node.textContent, { ...m, page: node.dataset.page });
        m.href = node.dataset.href || node.getAttribute('href') || '';
      }
      if (tag === 'DIV' || tag === 'P') { // pasted or browser-made line blocks become line breaks
        if (out.length && !out[out.length - 1].text.endsWith('\n')) push('\n', marks);
      }
      node.childNodes.forEach((c) => walk(c, m));
    };
    root.childNodes.forEach((c) => walk(c, {}));
    if (out.length) out[out.length - 1].text = out[out.length - 1].text.replace(/\n+$/, '');
    return out.filter((r) => r.text);
  }

  const cellsOf = (tr) => [...tr.children].map(domToRich);

  // ---- entering and leaving ----

  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-edit-page]')) startEditing();
    if (editor && e.target.closest('details.toggle > summary') && e.target.closest('article.editing')) e.preventDefault();
  });

  function startEditing() {
    const article = $('article.prose[data-page]');
    if (!article || editor) return;
    const slug = article.dataset.page;
    editor = { slug, article, before: new Map(), tmp: 0, title: null };
    article.classList.add('editing');
    $('[data-edit-page]')?.remove();
    for (const d of article.querySelectorAll('details.toggle')) d.open = true;
    for (const v of article.querySelectorAll('[data-view], figure, .table-wrap, .next-up')) v.contentEditable = 'false';
    for (const block of article.querySelectorAll('[data-id]')) {
      if (!HEX.test(block.dataset.id) || !TEXT_TYPES.has(typeOf(block))) continue;
      const el = editableOf(block);
      if (!el) continue;
      makeEditable(el);
      editor.before.set(block, JSON.stringify(domToRich(el)) + (typeOf(block) === 'todo' ? $('input', block).checked : ''));
    }
    for (const tr of article.querySelectorAll('tr[data-row]')) {
      for (const cell of tr.children) makeEditable(cell, '');
      editor.before.set(tr, JSON.stringify(cellsOf(tr)));
    }
    for (const box of article.querySelectorAll('.todo input')) box.disabled = false;
    const title = $('.page-title');
    if (title) { makeEditable(title, 'Untitled'); editor.title = title.textContent; }
    const bar = document.createElement('div');
    bar.className = 'edit-bar';
    bar.innerHTML = `
      <select data-kind aria-label="Kind of block">${KINDS.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
      <button type="button" class="icon-button fmt" data-cmd="bold" title="Bold (⌘B)">B</button>
      <button type="button" class="icon-button fmt i" data-cmd="italic" title="Italic (⌘I)">I</button>
      <button type="button" class="icon-button fmt s" data-cmd="strikeThrough" title="Strike through">S</button>
      <button type="button" class="icon-button" data-link title="Link (⌘K)">🔗 Link</button>
      <button type="button" class="icon-button" data-add title="Add a block below">＋ Block</button>
      <button type="button" class="icon-button" data-delete title="Delete this block">🗑 Delete</button>
      <span class="grow"></span><span class="status" aria-live="polite"></span>
      <button type="button" class="edit-button" data-cancel>Cancel</button>
      <button type="button" class="edit-button primary" data-save>Save</button>
      <span class="link-box" hidden><input type="url" placeholder="https://…" aria-label="Link address">
        <button type="button" class="edit-button small" data-link-ok>Apply</button>
        <button type="button" class="edit-button small" data-unlink>Remove link</button></span>`;
    article.before(bar);
    const hint = document.createElement('p');
    hint.className = 'edit-hint';
    hint.textContent = 'Click any text to change it. Enter starts a new block of the same kind, Shift+Enter a new line. Nothing changes for others until you save.';
    bar.after(hint);
    editor.bar = bar;
    editor.hint = hint;
    bar.addEventListener('mousedown', (e) => { if (!e.target.closest('select, input')) e.preventDefault(); }); // keep the text selection
    bar.addEventListener('click', onBar);
    $('[data-kind]', bar).addEventListener('change', (e) => changeKind(e.target.value));
    article.addEventListener('keydown', onKey);
    article.addEventListener('paste', onPaste);
    article.addEventListener('input', () => status('Unsaved changes'));
    article.addEventListener('change', () => status('Unsaved changes'));
    document.addEventListener('selectionchange', syncBar);
    window.addEventListener('beforeunload', guard);
    const first = article.querySelector('[data-editable]');
    first?.focus();
  }

  function guard(e) { if (editor && changes().length) { e.preventDefault(); e.returnValue = ''; } }

  function stopEditing() {
    document.removeEventListener('selectionchange', syncBar);
    window.removeEventListener('beforeunload', guard);
    editor = null;
    R.route();
  }

  const status = (text) => { if (editor) $('.status', editor.bar).textContent = text; };

  // the block the caret is in
  function current() {
    const sel = getSelection();
    const node = sel.rangeCount ? sel.getRangeAt(0).startContainer : null;
    const el = node && (node.nodeType === 1 ? node : node.parentElement);
    if (!el || !editor?.article.contains(el)) return null;
    const editable = el.closest('[data-editable]');
    const block = editable && blockOf(editable);
    return block && isBlock(block) ? { block, editable } : null;
  }

  function syncBar() {
    const c = current();
    const kind = $('[data-kind]', editor?.bar || document);
    if (!kind) return;
    kind.disabled = !c || typeOf(c.block) === 'callout' || hasChildren(c.block);
    if (c) kind.value = c.block.tagName === 'DETAILS' && typeOf(c.block) !== 'toggle' ? 'toggle' : typeOf(c.block);
  }

  function hasChildren(block) {
    if (block.tagName === 'P') return !!block.nextElementSibling?.classList.contains('indent');
    return !!block.querySelector('[data-id],[data-new]');
  }

  function onBar(e) {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.cmd) { document.execCommand(b.dataset.cmd); status('Unsaved changes'); }
    if (b.hasAttribute('data-link')) openLinkBox();
    if (b.hasAttribute('data-link-ok')) applyLink();
    if (b.hasAttribute('data-unlink')) { restoreSelection(); document.execCommand('unlink'); closeLinkBox(); }
    if (b.hasAttribute('data-add')) addBlock();
    if (b.hasAttribute('data-delete')) deleteBlock();
    if (b.hasAttribute('data-cancel')) {
      if (!changes().length || confirmInline(b, 'Discard your changes?', stopEditing)) stopEditing();
    }
    if (b.hasAttribute('data-save')) save();
  }

  // a second click confirms (no browser dialogs)
  function confirmInline(button, question, then) {
    if (button.dataset.armed) return true;
    button.dataset.armed = '1';
    const label = button.textContent;
    button.textContent = question;
    setTimeout(() => { button.textContent = label; delete button.dataset.armed; }, 4000);
    return false;
  }

  let savedRange = null;
  function openLinkBox() {
    const sel = getSelection();
    if (!current() || sel.isCollapsed) return toast('Select the words to link first.');
    savedRange = sel.getRangeAt(0).cloneRange();
    const box = $('.link-box', editor.bar);
    box.hidden = false;
    const a = sel.anchorNode?.parentElement?.closest('a');
    $('input', box).value = a ? (a.dataset.href || a.href) : '';
    $('input', box).focus();
  }
  function restoreSelection() {
    if (!savedRange) return;
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(savedRange);
  }
  function applyLink() {
    let url = $('.link-box input', editor.bar).value.trim();
    if (!url) return closeLinkBox();
    if (!/^(https?:|mailto:)/i.test(url)) url = (url.includes('@') && !url.includes('/') ? 'mailto:' : 'https://') + url;
    restoreSelection();
    document.execCommand('createLink', false, url);
    closeLinkBox();
    status('Unsaved changes');
  }
  function closeLinkBox() {
    $('.link-box', editor.bar).hidden = true;
    restoreSelection();
    savedRange = null;
  }

  // ---- making, changing and removing blocks ----

  function newBlock(type, html = '') {
    const tmp = `new${++editor.tmp}`;
    let el;
    if (type === 'ul' || type === 'ol' || type === 'todo') {
      el = document.createElement(type === 'todo' ? 'div' : 'li');
      if (type === 'todo') { el.className = 'todo'; el.innerHTML = '<input type="checkbox">'; }
      const span = document.createElement('span');
      span.className = 'li-text';
      span.innerHTML = html;
      el.append(span);
      makeEditable(span, type === 'todo' ? 'To-do' : 'List item');
    } else if (type === 'quote') {
      el = document.createElement('blockquote');
      el.innerHTML = `<p class="q-text">${html}</p>`;
      makeEditable(el.firstChild, 'Quote');
    } else if (type === 'toggle') {
      el = document.createElement('details');
      el.className = 'toggle';
      el.open = true;
      el.innerHTML = `<summary><span class="toggle-title">${html}</span></summary><div class="toggle-body"></div>`;
      makeEditable($('.toggle-title', el), 'Toggle');
    } else {
      el = document.createElement({ h1: 'h2', h2: 'h3', h3: 'h4' }[type] || 'p');
      el.innerHTML = html;
      makeEditable(el, /^h/.test(type) ? 'Heading' : 'Type here');
    }
    el.dataset.new = tmp;
    el.dataset.type = type;
    return el;
  }

  // puts a new block right after `ref` (a block), splitting a list if needed
  function placeAfter(ref, el) {
    const inList = ref.tagName === 'LI';
    const isItem = el.tagName === 'LI';
    if (inList && isItem && typeOf(ref) === typeOf(el)) return ref.after(el);
    if (isItem) {
      const list = document.createElement(typeOf(el));
      list.append(el);
      el = list;
    }
    if (inList) {
      const list = ref.parentElement;
      const rest = [...list.children].slice([...list.children].indexOf(ref) + 1);
      list.after(el);
      if (rest.length) {
        const tail = document.createElement(list.tagName.toLowerCase());
        tail.append(...rest);
        el.after(tail);
      }
      return;
    }
    const anchor = ref.tagName === 'P' && ref.nextElementSibling?.classList.contains('indent') ? ref.nextElementSibling : ref;
    anchor.after(el);
  }

  function focusStart(el, atEnd = false) {
    el.focus();
    const r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(!atEnd);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  }

  function addBlock(type = 'p') {
    const c = current();
    let el;
    if (c) {
      el = newBlock(type);
      placeAfter(c.block, el);
    } else {
      el = newBlock(type);
      editor.article.append(el);
    }
    focusStart(el.matches('[data-editable]') ? el : $('[data-editable]', el));
    status('Unsaved changes');
  }

  function deleteBlock() {
    const c = current();
    if (!c) return toast('Click into the block you want to delete first.');
    if (hasChildren(c.block)) return toast('This block has others inside it: delete those first.', true);
    const prev = previousEditable(c.editable);
    removeBlock(c.block);
    if (prev) focusStart(prev, true);
    status('Unsaved changes');
  }

  function removeBlock(block) {
    if (block.dataset.new) {
      const list = block.parentElement;
      block.remove();
      if (/^(UL|OL)$/.test(list.tagName) && !list.children.length) list.remove();
    } else {
      block.classList.add('is-deleted');
      block.dataset.deleted = '1';
      const ed = editableOf(block);
      if (ed) ed.contentEditable = 'false';
    }
  }

  function previousEditable(el) {
    const all = [...editor.article.querySelectorAll('[data-editable]')].filter((x) => !x.closest('.is-deleted'));
    return all[all.indexOf(el) - 1] || null;
  }

  // a block changing kind: the old one goes, a new one with the same text takes its place
  function changeKind(type) {
    const c = current();
    if (!c || typeOf(c.block) === type) return;
    if (hasChildren(c.block)) return toast('This block has others inside it, so it keeps its kind.', true);
    const el = newBlock(type, c.editable.innerHTML);
    placeAfter(c.block, el);
    removeBlock(c.block);
    focusStart(el.matches('[data-editable]') ? el : $('[data-editable]', el), true);
    status('Unsaved changes');
  }

  function onKey(e) {
    const c = current();
    if (!c) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openLinkBox(); return; }
    if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); save(); return; }
    if (c.editable.closest('td, th')) return; // table cells: plain typing
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      if (e.shiftKey) { document.execCommand('insertLineBreak'); return; }
      // a toggle's title: go into the toggle
      if (c.block.tagName === 'DETAILS') {
        const body = $('.toggle-body', c.block);
        const inside = body.querySelector('[data-editable]');
        if (inside) return focusStart(inside);
        const el = newBlock('p');
        body.append(el);
        return focusStart(el);
      }
      // the text after the caret moves to the new block
      const sel = getSelection();
      const r = sel.getRangeAt(0);
      r.deleteContents();
      const tail = document.createRange();
      tail.setStart(r.endContainer, r.endOffset);
      tail.setEnd(c.editable, c.editable.childNodes.length);
      const moved = tail.extractContents();
      const holder = document.createElement('div');
      holder.append(moved);
      const t = typeOf(c.block);
      const listy = ['ul', 'ol', 'todo'].includes(t);
      // Enter on an empty list item ends the list
      const type = listy && !c.editable.textContent.trim() && !holder.textContent.trim() ? 'p' : listy ? t : 'p';
      if (type === 'p' && listy && !c.editable.textContent.trim()) {
        const el = newBlock('p');
        placeAfter(c.block, el);
        removeBlock(c.block);
        return focusStart(el);
      }
      const el = newBlock(type, holder.innerHTML);
      placeAfter(c.block, el);
      focusStart(el.matches('[data-editable]') ? el : $('[data-editable]', el));
      status('Unsaved changes');
    }
    if (e.key === 'Backspace' && !c.editable.textContent && !c.editable.querySelector('br, img')) {
      if (c.editable.classList.contains('page-title')) return;
      e.preventDefault();
      if (hasChildren(c.block)) return;
      const prev = previousEditable(c.editable);
      removeBlock(c.block);
      if (prev) focusStart(prev, true);
      status('Unsaved changes');
    }
  }

  // pasted text comes in plain (no fonts or colours from elsewhere); links can be added with the bar
  function onPaste(e) {
    if (!current()) return;
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
    document.execCommand('insertText', false, text);
  }

  // ---- saving ----

  // the parent of a block element: the block around it, or the page
  function parentOf(el) {
    let p = el.parentElement;
    while (p && p !== editor.article) {
      if (p.classList.contains('indent') && p.previousElementSibling?.dataset.id) return p.previousElementSibling.dataset.id;
      if (p.matches(CONTAINER)) return idOf(p);
      p = p.parentElement;
    }
    return R.bundle().pages[editor.slug].id;
  }

  // the block right before it under the same parent (none: it goes first)
  function afterOf(el, parent, order) {
    const i = order.indexOf(el);
    for (let j = i - 1; j >= 0; j--) {
      if (order[j] === el) continue;
      if (parentOf(order[j]) === parent && !order[j].contains(el)) return idOf(order[j]);
    }
    return null;
  }

  function changes() {
    if (!editor) return [];
    const ops = [];
    const article = editor.article;
    const title = $('.page-title');
    if (title && title.textContent.trim() !== (editor.title || '').trim()) ops.push({ op: 'title', title: title.textContent.trim() });
    const order = [...article.querySelectorAll('[data-id],[data-new]')].filter(isBlock);
    for (const el of order) {
      if (el.dataset.new) {
        const ed = editableOf(el);
        const parent = parentOf(el);
        ops.push({ op: 'insert', tmp: el.dataset.new, parent, after: afterOf(el, parent, order), type: typeOf(el), rt: ed ? domToRich(ed) : [] });
      }
    }
    for (const [el, before] of editor.before) {
      if (el.tagName === 'TR') {
        if (el.closest('.is-deleted')) continue;
        const now = JSON.stringify(cellsOf(el));
        if (now !== before) ops.push({ op: 'cells', id: el.dataset.row, cells: cellsOf(el) });
        continue;
      }
      if (el.dataset.deleted) { ops.push({ op: 'delete', id: el.dataset.id }); continue; }
      const ed = editableOf(el);
      const checked = typeOf(el) === 'todo' ? $('input', el).checked : '';
      if (ed && JSON.stringify(domToRich(ed)) + checked !== before) ops.push({ op: 'update', id: el.dataset.id, rt: domToRich(ed), checked: checked === true });
    }
    return ops;
  }

  async function save() {
    const ops = changes();
    if (!ops.length) { toast('Nothing has changed.'); return stopEditing(); }
    const button = $('[data-save]', editor.bar);
    button.disabled = true;
    status('Saving…');
    try {
      const page = await R.api('api_site_edit_page', token(), editor.slug, ops);
      const b = R.bundle();
      R.keep({ ...b, pages: { ...b.pages, [editor.slug]: page } });
      toast('Saved.');
      stopEditing();
    } catch (err) {
      button.disabled = false;
      status('Not saved');
      toast(err.message, true);
    }
  }

  // =====================================================================================================
  // Slots
  // =====================================================================================================

  const mayEditSlot = (type) => me.slots.includes(type);
  // tsars edit their rota's slots; presenters add the title of their own talk (as on the tea page)
  R.hooks.slotButton = (s) => mayEditSlot(s.type)
    ? `<button type="button" class="icon-button" data-edit-slot="${s.id}" title="Edit this slot" aria-label="Edit this slot">✎</button>`
    : s.presenter.includes(me.person) && !s.tentative && !s.cancelled && s.startDate > Date.now() - 864e5
      ? `<button type="button" class="icon-button" data-edit-title="${s.id}" title="Add or change your talk title">✎ ${s.cleanTitle ? 'Edit title' : 'Add title'}</button>` : '';
  R.hooks.scheduleBar = () => me.slots.length ? '<button type="button" class="edit-button" data-add-slot>＋ Add a slot</button>' : '';

  const opts = () => R.loadData().options || {};
  const activePeople = () => R.loadData().people.filter((p) => p.active).sort((a, b) => a.name.localeCompare(b.name));

  function personSelect(id, role) {
    const people = activePeople();
    const extra = id && !people.some((p) => p.id === id) ? [R.loadData().peopleById.get(id)].filter(Boolean) : [];
    return `<select data-pick="${role}"><option value="">—</option>${[...extra, ...people].map((p) =>
      `<option value="${p.id}"${p.id === id ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select>`;
  }

  function pickers(ids, role) {
    const list = ids.length ? ids : [''];
    return `<div class="pickers" data-role="${role}">${list.map((id) => personSelect(id, role)).join('')}
      <button type="button" class="icon-button" data-more="${role}">＋ another</button></div>`;
  }

  const londonParts = (iso) => {
    const d = new Date(iso);
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
    const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
    return [day, time];
  };

  const DEFAULT_TIME = { 'Research Talk': '15:00', 'Tea Talk': '15:30', 'TNJC': '13:30', 'MLJC': '13:30', 'Just Tea': '15:30', 'Leaving Tea': '15:30', 'External Seminar': '16:00' };

  function slotForm(s) {
    const o = opts();
    const type = s.type;
    const allDay = type === 'Coffee Cleaning';
    let [day, time] = s.start ? (s.start.length === 10 ? [s.start, ''] : londonParts(s.start)) : ['', DEFAULT_TIME[type] || '13:30'];
    const endIso = s.end || '';
    let [endDay, endTime] = endIso ? (endIso.length === 10 ? [endIso, ''] : londonParts(endIso)) : ['', ''];
    if (s.draft) ({ day = day, time = time, endDay = endDay, endTime = endTime } = s.draft);
    const has = (list) => (list || []).includes(type);
    return `<form class="edit-form" data-slot-form="${s.id || ''}">
      <div class="row">
        <label>Kind<select name="type">${me.slots.map((t) => `<option${t === type ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
        <label>${allDay ? 'From' : 'Day'}<input type="date" name="day" value="${day}" required></label>
        ${allDay ? `<label>To<input type="date" name="end_day" value="${endDay}"></label>`
    : `<label>Starts<input type="time" name="time" value="${time}" step="300"></label><label>Ends<input type="time" name="end_time" value="${endTime}" step="300"></label>`}
      </div>
      ${allDay ? '' : `<label>Title<input class="title-input" name="title" value="${esc(s.title || '')}" placeholder="Title to be announced"></label>`}
      ${has(o.presenter_types) ? `<label>${type === 'TNJC' || type === 'MLJC' ? 'Presenter' : 'Speaker'}${pickers(s.presenter || [], 'presenter')}</label>` : ''}
      ${has(o.guest_types) || type === 'External Seminar' ? `<label>Guest speaker (not in the unit)<input name="guest" value="${esc(s.guest || '')}" placeholder="Name"></label>` : ''}
      ${has(o.tea_types) ? `<label>${allDay ? 'On duty' : 'Tea'}${pickers(s.tea || [], 'tea')}</label>` : ''}
      <div class="row">
        ${type === 'TNJC' ? `<label class="check"><input type="checkbox" name="csnjc"${s.csnjc ? ' checked' : ''}> CSNJC</label>` : ''}
        ${allDay ? `<label class="check"><input type="checkbox" name="water_filter"${s.water_filter ? ' checked' : ''}> Water filter week</label>` : ''}
      </div>
      ${allDay ? '' : `<label>Description<textarea name="description" placeholder="Abstract, paper, room…">${esc(s.description || '')}</textarea></label>`}
      <div class="actions"><button type="submit" class="edit-button primary">Save</button>
        <button type="button" class="edit-button" data-form-cancel>Cancel</button>
        ${s.id ? '<button type="button" class="edit-button" data-slot-delete title="For slots not needed. A finalised talk is better cancelled: set its title to Cancelled.">Remove slot</button>' : ''}
        <span class="error" role="alert"></span></div>
    </form>`;
  }

  function readSlot(form, s) {
    const f = form.elements;
    const type = f.type.value;
    const ids = (role) => [...form.querySelectorAll(`[data-pick="${role}"]`)].map((x) => x.value).filter(Boolean);
    const slot = { ...s, type, presenter: ids('presenter'), tea: ids('tea'), guest: f.guest?.value.trim() || '' };
    if (!f.day.value) throw new Error('Please give the day.');
    if (type === 'Coffee Cleaning') {
      // a coffee week runs Monday to Friday unless the form says otherwise
      const friday = new Date(f.day.value + 'T12:00:00Z');
      friday.setUTCDate(friday.getUTCDate() + 4);
      slot.start = f.day.value;
      slot.end = f.end_day?.value || friday.toISOString().slice(0, 10);
      slot.water_filter = !!f.water_filter?.checked;
    } else {
      if (!f.time.value) throw new Error('Please give the start time.');
      // without an end time, a slot lasts an hour
      const [h, m] = f.time.value.split(':').map(Number);
      const end = f.end_time.value || `${String(Math.min(23, h + 1)).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      slot.start = `${f.day.value}T${f.time.value}`;
      slot.end = `${f.day.value}T${end}`;
      slot.title = f.title.value.trim();
      slot.description = f.description.value.trim();
      slot.csnjc = !!f.csnjc?.checked;
    }
    return slot;
  }

  function openSlotForm(anchor, s, replace) {
    document.querySelectorAll('[data-slot-form]').forEach((x) => x.closest('.form-host')?.remove());
    const host = document.createElement('li');
    host.className = 'form-host';
    host.innerHTML = slotForm(s);
    if (replace) { anchor.hidden = true; anchor.after(host); } else anchor.prepend(host);
    const close = () => { host.remove(); if (replace) anchor.hidden = false; };
    host.addEventListener('change', (e) => {
      if (e.target.name !== 'type') return;
      const keep = readLoose($('form', host), s);
      host.innerHTML = slotForm({ ...keep, type: e.target.value });
      wire();
    });
    const wire = () => {
      const fm = $('form', host);
      fm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const err = $('.error', fm);
        err.textContent = '';
        let slot;
        try { slot = readSlot(fm, s); } catch (x) { err.textContent = x.message; return; }
        delete slot.draft;
        const button = $('[type=submit]', fm);
        button.disabled = true;
        button.textContent = 'Saving…';
        try {
          const saved = await R.api('api_site_save_slot', token(), slot);
          putItem('schedule', saved);
          toast('Saved to Notion. The calendar follows within the hour.');
        } catch (x) {
          err.textContent = x.message;
          button.disabled = false;
          button.textContent = 'Save';
        }
      });
      $('[data-form-cancel]', fm).addEventListener('click', close);
      $('[data-slot-delete]', fm)?.addEventListener('click', async (e) => {
        const b = e.currentTarget;
        if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Remove it for good?'; return; }
        b.disabled = true;
        try {
          await R.api('api_site_delete_slot', token(), s.id);
          const bb = R.bundle();
          R.keep({ ...bb, data: { ...bb.data, schedule: bb.data.schedule.filter((x) => x.id !== s.id) } });
          R.redrawViews();
          toast('Slot removed.');
        } catch (x) { $('.error', fm).textContent = x.message; b.disabled = false; }
      });
      fm.addEventListener('click', (e) => {
        const more = e.target.closest('[data-more]');
        if (more) more.insertAdjacentHTML('beforebegin', personSelect('', more.dataset.more));
      });
      $('input, select', fm)?.focus();
    };
    wire();
  }

  // what the form holds so far, to carry over when the kind of slot changes
  function readLoose(form, s) {
    const f = form.elements;
    const ids = (role) => [...form.querySelectorAll(`[data-pick="${role}"]`)].map((x) => x.value).filter(Boolean);
    const draft = { day: f.day.value };
    if (f.time) Object.assign(draft, { time: f.time.value, endTime: f.end_time.value });
    if (f.end_day) draft.endDay = f.end_day.value;
    return { ...s, title: f.title?.value ?? s.title, description: f.description?.value ?? s.description,
      guest: f.guest?.value ?? s.guest, presenter: ids('presenter'), tea: ids('tea'), draft };
  }

  document.addEventListener('click', (e) => {
    const edit = e.target.closest('[data-edit-slot]');
    if (edit) {
      const s = R.bundle().data.schedule.find((x) => x.id === edit.dataset.editSlot);
      if (s) openSlotForm(edit.closest('.slot'), s, true);
    }
    const add = e.target.closest('[data-add-slot]');
    if (add) {
      const body = add.closest('[data-view]').querySelector('.view-body');
      let list = body.querySelector('.slots');
      if (!list) { list = document.createElement('ol'); list.className = 'slots'; body.prepend(list); }
      openSlotForm(list, { type: me.slots[0], presenter: [], tea: [] }, false);
    }
  });

  // your own talk: title and description (the tea page's api_title, which also updates the calendar)
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-edit-title]');
    if (!b) return;
    const s = R.bundle().data.schedule.find((x) => x.id === b.dataset.editTitle);
    const li = b.closest('.slot');
    if (!s || !li) return;
    document.querySelectorAll('[data-title-form]').forEach((x) => x.closest('.form-host')?.remove());
    li.hidden = true;
    li.insertAdjacentHTML('afterend', `<li class="form-host"><form class="edit-form" data-title-form>
      <label>Talk title<input class="title-input" name="title" value="${esc(s.title.replace(/\[[^\]]*tentative\]/ig, '').trim())}" placeholder="Title of your talk"></label>
      <label>Description${s.type === 'TNJC' || s.type === 'MLJC' ? ' (for journal clubs, include the paper link)' : ''}<textarea name="description" placeholder="Abstract, paper link, …">${esc(s.description || '')}</textarea></label>
      <div class="actions"><button type="submit" class="edit-button primary">Save</button>
        <button type="button" class="edit-button" data-form-cancel>Cancel</button><span class="error" role="alert"></span></div></form></li>`);
    const host = li.nextElementSibling;
    const form = $('form', host);
    $('[data-form-cancel]', form).addEventListener('click', () => { host.remove(); li.hidden = false; });
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const button = $('[type=submit]', form);
      button.disabled = true;
      button.textContent = 'Saving…';
      try {
        const title = form.title.value.trim(), description = form.description.value.trim();
        const msg = await R.api('api_title', token(), s.id, title, description);
        putItem('schedule', { ...s, title, description });
        toast(msg);
      } catch (x) {
        $('.error', form).textContent = x.message;
        button.disabled = false;
        button.textContent = 'Save';
      }
    });
    form.title.focus();
  });

  // a saved item replaces its old copy (or joins the list), and every view shows it
  function putItem(list, item) {
    const b = R.bundle();
    const known = b.data[list].some((x) => x.id === item.id);
    const items = known ? b.data[list].map((x) => (x.id === item.id ? item : x)) : b.data[list].concat([item]);
    if (list === 'schedule') items.sort((x, y) => new Date(x.start.length === 10 ? x.start + 'T00:00:00' : x.start) - new Date(y.start.length === 10 ? y.start + 'T00:00:00' : y.start));
    R.keep({ ...b, data: { ...b.data, [list]: items } });
    if (new URLSearchParams(location.search).get('person')) R.route();
    else R.redrawViews();
  }

  // =====================================================================================================
  // People
  // =====================================================================================================

  const ROTAS = ['TNJC', 'CSNJC', 'MLJC', 'Coffee'];
  const EXEMPT = [['research', 'Research talks'], ['tea_talk', 'Tea talks'], ['tea', 'Tea']];
  const all = me.people.includes('all');

  R.hooks.personButton = (p, big) => me.people.length || p.id === me.person
    ? `<button type="button" class="${big ? 'edit-button' : 'icon-button'}" data-edit-person="${p.id}" title="Edit" aria-label="Edit ${esc(p.name)}">✎${big ? (me.people.length ? ' Edit' : ' Change my photo') : ''}</button>` : '';
  R.hooks.peopleBar = () => me.add_people ? '<button type="button" class="edit-button" data-add-person>＋ Add a person</button>' : '';

  // a picked image -> a small square JPEG (the face is usually in the upper part of a portrait)
  async function thumbnail(file) {
    const img = await createImageBitmap(file);
    const side = Math.min(img.width, img.height);
    const top = Math.max(0, Math.min(img.height - side, Math.round((img.height - side) * 0.3)));
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 160;
    canvas.getContext('2d').drawImage(img, (img.width - side) / 2, top, side, side, 0, 0, 160, 160);
    return canvas.toDataURL('image/jpeg', 0.82);
  }

  function photoField(p) {
    return `<div class="row photo-row">${R.avatar(p, 'avatar-lg')}
      <label class="photo-pick">Photo<input type="file" name="photo" accept="image/*"></label>
      ${p.id ? '<label class="check"><input type="checkbox" name="no_photo"> No photo</label>' : ''}</div>`;
  }

  function personForm(p) {
    const o = opts();
    const mine = ROTAS.filter((r) => all || me.people.includes(r));
    const tsar = me.people.length > 0;
    return `<form class="edit-form" data-person-form="${p.id || ''}">
      ${p.id ? photoField(p) : ''}
      ${all ? `<div class="row"><label>Name<input class="title-input" name="name" value="${esc(p.name || '')}" required></label>
        <label>Position<select name="position"><option value=""></option>${(o.positions || []).map((x) => `<option${x === p.position ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select></label>
        <label>Joined<input type="date" name="joined" value="${esc(p.joined || '')}"></label></div>` : `<strong>${esc(p.name)}</strong>`}
      ${tsar ? `<div class="row">${mine.map((r) => `<label class="check"><input type="checkbox" name="rota" value="${r}"${(p.rotas || []).includes(r) ? ' checked' : ''}> ${r}</label>`).join('')}</div>` : ''}
      ${all ? `<div class="row"><span class="muted">Exempt from</span>${EXEMPT.map(([k, l]) => `<label class="check"><input type="checkbox" name="excluded" value="${k}"${(p.excluded || []).includes(k) ? ' checked' : ''}> ${l}</label>`).join('')}</div>
        <label class="check"><input type="checkbox" name="active"${p.active || !p.id ? ' checked' : ''}> On the rotas (active)</label>` : ''}
      <div class="actions"><button type="submit" class="edit-button primary">Save</button>
        <button type="button" class="edit-button" data-form-cancel>Cancel</button><span class="error" role="alert"></span></div>
    </form>`;
  }

  function openPersonForm(anchor, p, mode) {
    document.querySelectorAll('[data-person-form]').forEach((x) => x.closest('.form-host')?.remove());
    const host = document.createElement(anchor.tagName === 'LI' || anchor.tagName === 'UL' ? 'li' : 'div');
    host.className = 'form-host';
    host.innerHTML = personForm(p);
    if (mode === 'replace') { anchor.hidden = true; anchor.after(host); } else if (mode === 'prepend') anchor.prepend(host); else anchor.after(host);
    const form = $('form', host);
    const close = () => { host.remove(); anchor.hidden = false; };
    $('[data-form-cancel]', form).addEventListener('click', close);
    const pick = form.elements.photo;
    pick?.addEventListener('change', async () => {
      if (!pick.files[0]) return;
      try {
        form.dataset.photo = await thumbnail(pick.files[0]);
        const box = $('.photo-row .avatar', form);
        box.classList.remove('avatar-mono');
        box.innerHTML = `<img src="${form.dataset.photo}" alt="">`;
        if (form.elements.no_photo) form.elements.no_photo.checked = false;
      } catch { $('.error', form).textContent = 'That file could not be read as a picture.'; }
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = form.elements;
      const checked = (name) => [...form.querySelectorAll(`[name="${name}"]:checked`)].map((x) => x.value);
      const person = { ...p, rotas: [...(p.rotas || []).filter((r) => !(all || me.people.includes(r))), ...checked('rota')] };
      if (all) Object.assign(person, { name: f.name.value.trim(), position: f.position.value, joined: f.joined.value || null, excluded: checked('excluded'), active: f.active.checked });
      const err = $('.error', form);
      const button = $('[type=submit]', form);
      button.disabled = true;
      button.textContent = 'Saving…';
      try {
        const photo = form.dataset.photo || (f.no_photo?.checked ? '' : null);
        if (photo !== null && p.id) R.setPhoto(p.id, photo, await R.api('api_site_save_photo', token(), p.id, photo));
        if (me.people.length) {
          const saved = await R.api('api_site_save_person', token(), person);
          putItem('people', saved);
        } else {
          R.route();
        }
        toast(me.people.length ? 'Saved.' : 'Photo saved.');
      } catch (x) {
        err.textContent = x.message;
        button.disabled = false;
        button.textContent = 'Save';
      }
    });
    $('input, select', form)?.focus();
  }

  document.addEventListener('click', (e) => {
    const edit = e.target.closest('[data-edit-person]');
    if (edit) {
      const p = R.loadData().peopleById.get(edit.dataset.editPerson);
      const card = edit.closest('.person-card');
      if (p && card) openPersonForm(card, p, 'replace');
      else if (p) openPersonForm(edit.closest('.page-head'), p, 'after');
    }
    if (e.target.closest('[data-add-person]')) {
      const list = e.target.closest('[data-view]').querySelector('.people');
      if (list) openPersonForm(list, { rotas: [], excluded: [], active: true }, 'prepend');
    }
  });

  // =====================================================================================================
  // Rota rules
  // =====================================================================================================

  if (me.rules) {
    R.hooks.ruleCell = (r, k) => {
      const choices = (opts().rules || {})[k] || [];
      return `<select class="rule-select" data-rule="${r.id}" data-key="${k}" aria-label="${esc(r.position)}: ${k}">
        <option value=""></option>${choices.map((c) => `<option${c === r[k] ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select>`;
    };
    document.addEventListener('change', async (e) => {
      const sel = e.target.closest('[data-rule]');
      if (!sel) return;
      sel.disabled = true;
      try {
        const saved = await R.api('api_site_save_rule', token(), { id: sel.dataset.rule, [sel.dataset.key]: sel.value });
        const b = R.bundle();
        R.keep({ ...b, data: { ...b.data, rota_rules: b.data.rota_rules.map((x) => (x.id === saved.id ? { ...x, ...saved } : x)) } });
        toast('Saved to Notion.');
      } catch (x) {
        toast(x.message, true);
      }
      R.redrawViews();
    });
  }

})();
