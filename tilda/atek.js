/* =====================================================================
   A·TEK — движок блоков для Tilda
   Данные: Google Таблица → Apps Script (JSON). Ничего не нужно
   перепубликовывать в Tilda: правите таблицу — сайт обновляется.

   Блоки на страницах (вставляются в T123):
     <div data-atek="catalog"></div>                  каталог с фильтрами
     <div data-atek="product" data-sku=""></div>      карточка товара (?sku= или data-sku)
     <div data-atek="featured" data-limit="8"></div>  подборка товаров
     <div data-atek="news"></div>                     лента новостей
     <div data-atek="news-item"></div>                новость (?id= или data-id)
     <header data-atek="header">…</header>            шапка: меню, корзина
   ===================================================================== */
(function () {
  'use strict';
  if (window.__atekLoaded) return; window.__atekLoaded = true;

  var CFG = Object.assign({
    api: '',                    // URL веб-приложения Apps Script (…/exec)
    catalogPage: '/catalog',
    productPage: '/product',
    newsPage: '/news',
    newsItemPage: '/news-item',
    perPage: 24,
    openCartOnAdd: false,       // true — сразу открывать корзину Tilda после добавления
    ymId: null,                 // номер счётчика Метрики для цели atek_lead (необязательно)
    demo: null                  // тестовые данные для превью без таблицы
  }, window.ATEK || {});

  // ------------------------------------------------------------------
  // Иконки (фирменная линейная графика: линия + точка)
  // ------------------------------------------------------------------
  var O = '#F47735', B = '#4263C7';
  var ICO = {
    vision: '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="32" cy="32" r="27"/><path d="M22 21.5a15 15 0 0 0 0 21M42 21.5a15 15 0 0 1 0 21"/><circle data-accent cx="32" cy="32" r="5.5" fill="' + O + '" stroke="none"/></svg>',
    access: '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M21 28v-7a11 11 0 0 1 22 0v7"/><rect x="13" y="28" width="38" height="28" rx="7"/><circle data-accent cx="32" cy="40" r="4.5" fill="' + O + '" stroke="none"/><path d="M32 43v6" stroke="' + O + '" stroke-width="3"/></svg>',
    smart: '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"><path d="M10 30 32 11l22 19v25H10z"/><path d="M45 19l7-7" stroke="' + B + '"/><circle cx="54" cy="10" r="3.2" stroke="' + B + '"/><circle data-accent cx="32" cy="38" r="5.5" fill="' + O + '" stroke="none"/></svg>',
    fix: '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 9h34M17 9c0 5 30 5 30 0"/><path d="M27 14v33l5 7 5-7V14"/><path d="M27 22l10-4M27 30l10-4M27 38l10-4M27 46l10-4"/><circle cx="32" cy="55" r="3" stroke="' + O + '"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>',
    cart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h2l2.2 11h11l2-8H6.4"/><circle cx="9" cy="19.5" r="1.4"/><circle cx="17" cy="19.5" r="1.4"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h15M13 6l6 6-6 6"/></svg>',
    back: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12H5M11 6l-6 6 6 6"/></svg>',
    doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>'
  };

  var LINES = {
    vision: { name: 'Vision', sub: 'Видеонаблюдение' },
    access: { name: 'Access', sub: 'Контроль доступа' },
    smart:  { name: 'Smart',  sub: 'Умный дом' },
    fix:    { name: 'Fix',    sub: 'Крепёж и монтаж' }
  };
  var LVL = {
    1: { c: '#34806B', t: 'Простой монтаж' },
    2: { c: '#D7A23B', t: 'Нужны базовые навыки' },
    3: { c: '#B8524A', t: 'Монтаж специалистом' }
  };

  // ------------------------------------------------------------------
  // Утилиты
  // ------------------------------------------------------------------
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function qs(k) { return new URLSearchParams(location.search).get(k) || ''; }
  var CUR = '₽', LOW = 5;
  function money(n) { return new Intl.NumberFormat('ru-RU').format(Math.round(n || 0)) + ' ' + CUR; }
  function dateRu(s) {
    var d = new Date(s); if (isNaN(d)) return esc(s);
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  }
  function productUrl(p) { return p.page_url || (CFG.productPage + '?sku=' + encodeURIComponent(p.sku)); }
  function newsUrl(n) { return n.page_url || (CFG.newsItemPage + '?id=' + encodeURIComponent(n.id)); }
  function safeUrl(u) { u = String(u || '').trim(); return /^(https?:\/\/|\/|#)/i.test(u) ? u : ''; }
  function plural(n, a, b, c) { n = Math.abs(n) % 100; var n1 = n % 10; return n > 10 && n < 20 ? c : n1 > 1 && n1 < 5 ? b : n1 === 1 ? a : c; }

  function stockHtml(p) {
    if (p.stock <= 0) return '<span class="atek-stock atek-stock--out">Под заказ</span>';
    if (p.stock <= LOW) return '<span class="atek-stock atek-stock--low">Мало · ' + p.stock + ' ' + esc(p.unit) + '</span>';
    return '<span class="atek-stock">В наличии</span>';
  }
  function lvlHtml(n, full) {
    var l = LVL[n]; if (!l) return '';
    var bars = ''; for (var i = 1; i <= 3; i++) bars += '<i class="' + (i <= n ? 'on' : '') + '"></i>';
    return '<span class="atek-lvl" style="--c:' + l.c + '" title="' + l.t + '"><b>0' + n + '</b>' +
      (full ? l.t : '<span class="atek-lvl-bars">' + bars + '</span>') + '</span>';
  }
  function imgOrPh(src, line, alt) {
    if (src) return '<img src="' + esc(src) + '" alt="' + esc(alt || '') + '" loading="lazy">';
    return '<div class="atek-ph">' + (ICO[line] || ICO.vision) + '</div>';
  }

  // Мини-разметка для описаний и новостей:
  // пустая строка = абзац, **жирный**, [текст](ссылка), строки «- » = список, «### » = подзаголовок, ![](картинка)
  function md(src) {
    return String(src || '').trim().split(/\n\s*\n/).map(function (block) {
      var lines = block.split('\n');
      if (lines.every(function (l) { return /^\s*[-•]\s+/.test(l); }))
        return '<ul>' + lines.map(function (l) { return '<li>' + inline(l.replace(/^\s*[-•]\s+/, '')) + '</li>'; }).join('') + '</ul>';
      var m = block.match(/^!\[(.*?)\]\((.+?)\)$/);
      if (m && safeUrl(m[2])) return '<img src="' + esc(m[2]) + '" alt="' + esc(m[1]) + '" loading="lazy">';
      if (/^###\s/.test(block)) return '<h3>' + inline(block.replace(/^###\s/, '')) + '</h3>';
      return '<p>' + lines.map(inline).join('<br>') + '</p>';
    }).join('');
    function inline(t) {
      var out = '', re = /\[([^\]]+)\]\(([^)\s]+)\)/g, last = 0, mm;
      while ((mm = re.exec(t))) {
        out += bold(esc(t.slice(last, mm.index)));
        var u = safeUrl(mm[2]);
        out += u ? '<a href="' + esc(u) + '"' + (/^https?:/.test(u) ? ' target="_blank" rel="noopener"' : '') + '>' + esc(mm[1]) + '</a>' : esc(mm[0]);
        last = re.lastIndex;
      }
      return out + bold(esc(t.slice(last)));
    }
    function bold(t) { return t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>'); }
  }
  function parseSpecs(s) {
    return String(s || '').split(/\n|\|/).map(function (l) {
      var i = l.indexOf(':'); return i > 0 ? [l.slice(0, i).trim(), l.slice(i + 1).trim()] : null;
    }).filter(Boolean);
  }
  function parseDocs(s) {
    return String(s || '').split('\n').map(function (l) {
      l = l.trim(); if (!l) return null;
      var parts = l.split('|'); var url = safeUrl((parts[1] || parts[0]).trim());
      return url ? { title: parts[1] ? parts[0].trim() : 'Документ', url: url } : null;
    }).filter(Boolean);
  }

  // ------------------------------------------------------------------
  // Данные: мгновенно из кэша браузера, затем свежие из таблицы
  // ------------------------------------------------------------------
  var LS = 'atek_data_v1', DATA = null, subs = [];
  function onData(fn) { subs.push(fn); if (DATA) fn(DATA); }
  function setData(d, fromCache) {
    if (!d || !d.products) return;
    if (DATA && DATA.version === d.version && !fromCache) return;   // ничего не поменялось
    DATA = d; index(d);
    if (d.settings) { CUR = d.settings.currency || CUR; LOW = +d.settings.low_stock || LOW; }
    subs.forEach(function (fn) { try { fn(d); } catch (e) { console.error('[A·TEK]', e); } });
  }
  function index(d) {
    d.bySku = {}; (d.products || []).forEach(function (p) { d.bySku[p.sku] = p; });
    d.catById = {}; (d.categories || []).forEach(function (c) { d.catById[c.id] = c; });
  }
  var loading = false;
  function load() {
    if (loading) return; loading = true;
    if (CFG.demo) { setData(CFG.demo); return; }
    if (!CFG.api) { console.warn('[A·TEK] Не задан window.ATEK.api'); return; }
    try { var c = JSON.parse(localStorage.getItem(LS)); if (c) setData(c, true); } catch (e) {}
    fetch(CFG.api + '?only=all', { redirect: 'follow' })
      .then(function (r) { return r.json(); })
      .catch(function () { return jsonp(CFG.api + '?only=all'); })
      .then(function (d) {
        var changed = !DATA || DATA.version !== d.version;
        try { localStorage.setItem(LS, JSON.stringify(d)); } catch (e) {}
        if (changed) { DATA = null; setData(d); }
      })
      .catch(function (e) { console.error('[A·TEK] не удалось загрузить данные', e); failAll(); });
  }
  function jsonp(url) {
    return new Promise(function (res, rej) {
      var cb = 'atekcb' + Date.now(), s = document.createElement('script');
      window[cb] = function (d) { res(d); delete window[cb]; s.remove(); };
      s.onerror = rej; s.src = url + '&callback=' + cb; document.head.appendChild(s);
    });
  }
  function failAll() {
    if (DATA) return;
    $$('[data-atek]').forEach(function (el) {
      if (el.getAttribute('data-atek') !== 'header') el.innerHTML = '<div class="atek-wrap"><div class="atek-empty">Не удалось загрузить данные. Обновите страницу.</div></div>';
    });
  }

  // ------------------------------------------------------------------
  // Корзина: используем корзину Tilda (блок ST100), если она есть на странице
  // ------------------------------------------------------------------
  function addToCart(p, qty) {
    qty = Math.max(1, qty || 1);
    if (p.stock <= 0) { openRequest('request', [{ sku: p.sku, qty: qty }], 'Товар под заказ', 'Сообщим срок поставки и цену.'); return false; }
    if (typeof window.tcart__addProduct === 'function') {
      window.tcart__addProduct({ name: p.name, price: p.price, img: p.image || '', sku: p.sku, quantity: qty, amount: p.price * qty });
      if (CFG.openCartOnAdd && typeof window.tcart__openCart === 'function') window.tcart__openCart();
      toast('Добавлено в корзину'); updateCartCount(); return true;
    }
    if (document.querySelector('.t706')) {   // корзина есть, но API ещё не готово — штатная ссылка Tilda
      var a = document.createElement('a');
      a.href = '#order:' + String(p.name).replace(/[=:]/g, ' ') + '=' + p.price;
      document.body.appendChild(a); a.click(); a.remove(); return true;
    }
    // Корзины нет — оформляем через заявку
    openRequest('order', [{ sku: p.sku, qty: qty }], 'Оформить заказ', 'Менеджер подтвердит наличие и доставку.');
    return true;
  }
  function cartCount() {
    var t = window.tcart; if (!t || !t.products) return 0;
    return t.products.reduce(function (s, p) { return s + (+p.quantity || 1); }, 0);
  }
  function updateCartCount() { $$('[data-atek-cart-count]').forEach(function (b) { var n = cartCount(); b.textContent = n ? n : ''; }); }
  function openCart() {
    if (typeof window.tcart__openCart === 'function') return window.tcart__openCart();
    var icon = $('.t706__carticon'); if (icon) return icon.click();
    location.href = CFG.catalogPage;
  }

  // ------------------------------------------------------------------
  // Заявка / оптовый запрос / заказ без корзины → Google Таблица + письмо
  // ------------------------------------------------------------------
  var modal;
  function openRequest(type, items, title, sub) {
    if (!modal) {
      modal = document.createElement('div');
      modal.className = 'atek atek-modal';
      modal.innerHTML = '<div class="atek-modal-box" role="dialog" aria-modal="true">' +
        '<button class="atek-icon-btn atek-modal-close" aria-label="Закрыть">' + ICO.close + '</button>' +
        '<h3></h3><p class="atek-muted atek-modal-sub"></p>' +
        '<form class="atek-form" novalidate>' +
        '<div class="atek-form-items" hidden></div>' +
        '<input name="name" placeholder="Имя *" autocomplete="name" required>' +
        '<input name="phone" type="tel" placeholder="Телефон *" autocomplete="tel">' +
        '<input name="email" type="email" placeholder="E-mail" autocomplete="email">' +
        '<input name="company" placeholder="Компания / ИНН" autocomplete="organization">' +
        '<textarea name="comment" rows="3" placeholder="Комментарий"></textarea>' +
        '<input class="atek-hp" name="website" tabindex="-1" autocomplete="off">' +
        '<button class="atek-btn atek-btn--primary" type="submit">Отправить</button>' +
        '<div class="atek-form-msg">Нажимая «Отправить», вы соглашаетесь на обработку персональных данных.</div>' +
        '</form></div>';
      document.body.appendChild(modal);
      modal.addEventListener('click', function (e) { if (e.target === modal || e.target.closest('.atek-modal-close')) closeModal(); });
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });
      $('form', modal).addEventListener('submit', submitRequest);
    }
    modal._type = type; modal._items = items || [];
    $('h3', modal).textContent = title || 'Оставить заявку';
    $('.atek-modal-sub', modal).textContent = sub || 'Ответим в течение рабочего дня.';
    var box = $('.atek-form-items', modal);
    if (modal._items.length && DATA) {
      box.hidden = false;
      box.innerHTML = modal._items.map(function (i) { var p = DATA.bySku[i.sku]; return p ? esc(p.name) + ' × ' + i.qty : ''; }).join('<br>');
    } else box.hidden = true;
    var msg = $('.atek-form-msg', modal); msg.classList.remove('is-err');
    $('button[type=submit]', modal).disabled = false;
    modal.classList.add('is-open'); setTimeout(function () { $('input[name=name]', modal).focus(); }, 50);
  }
  function closeModal() { if (modal) modal.classList.remove('is-open'); }
  function submitRequest(e) {
    e.preventDefault();
    var f = e.target, btn = $('button[type=submit]', f), msg = $('.atek-form-msg', f);
    var d = { type: modal._type, items: modal._items, page: location.href };
    ['name', 'phone', 'email', 'company', 'comment', 'website'].forEach(function (k) { d[k] = f[k].value.trim(); });
    if (!d.name || (!d.phone && !d.email)) { msg.textContent = 'Укажите имя и телефон или e-mail'; msg.classList.add('is-err'); return; }
    btn.disabled = true; btn.textContent = 'Отправляем…';
    var send = CFG.api && !CFG.demo
      ? fetch(CFG.api, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(d) }).then(function (r) { return r.json(); })
      : new Promise(function (r) { setTimeout(function () { r({ ok: true }); }, 600); });
    send.then(function (r) {
      if (!r.ok) throw new Error(r.error || 'Ошибка');
      f.reset(); closeModal(); toast('Заявка отправлена — скоро свяжемся');
      if (CFG.ymId && window.ym) window.ym(CFG.ymId, 'reachGoal', 'atek_lead');
    }).catch(function (err) {
      msg.textContent = 'Не отправилось: ' + err.message + '. Попробуйте ещё раз или позвоните нам.'; msg.classList.add('is-err');
    }).then(function () { btn.disabled = false; btn.textContent = 'Отправить'; });
  }

  var toastEl, toastT;
  function toast(t) {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'atek-toast'; document.body.appendChild(toastEl); }
    toastEl.textContent = t; toastEl.classList.add('is-show');
    clearTimeout(toastT); toastT = setTimeout(function () { toastEl.classList.remove('is-show'); }, 2600);
  }

  // ------------------------------------------------------------------
  // Карточка товара в сетке
  // ------------------------------------------------------------------
  function cardHtml(p) {
    var line = LINES[p.line];
    var sale = p.price_old && p.price_old > p.price ? '<span class="atek-sale">−' + Math.round(100 - p.price / p.price_old * 100) + '%</span>' : '';
    return '<article class="atek-card">' +
      '<a class="atek-card-img" href="' + esc(productUrl(p)) + '">' + imgOrPh(p.image, p.line, p.name) +
        '<span class="atek-card-tags"><span style="display:flex;gap:6px">' + lvlHtml(p.difficulty) + (p.series === 'PRO' ? '<span class="atek-pro">PRO</span>' : '') + '</span>' + sale + '</span></a>' +
      '<div class="atek-card-body">' +
        '<div class="atek-card-line">' + (line ? 'A·TEK ' + line.name : '') + '</div>' +
        '<a class="atek-card-name" href="' + esc(productUrl(p)) + '">' + esc(p.name) + '</a>' +
        stockHtml(p) +
        '<div class="atek-card-foot"><div class="atek-price">' + (p.price ? money(p.price) : 'Цена по запросу') + '</div>' +
        '<button class="atek-card-add" data-add="' + esc(p.sku) + '" aria-label="' + (p.stock > 0 ? 'В корзину' : 'Запросить') + '" title="' + (p.stock > 0 ? 'В корзину' : 'Под заказ — запросить') + '">' + ICO.plus + '</button></div>' +
      '</div></article>';
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-add]'); if (!b || !DATA) return;
    e.preventDefault();
    var p = DATA.bySku[b.getAttribute('data-add')];
    if (p && addToCart(p, 1) && p.stock > 0) {
      b.classList.add('is-added'); b.innerHTML = ICO.check;
      setTimeout(function () { b.classList.remove('is-added'); b.innerHTML = ICO.plus; }, 1500);
    }
  });
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-atek-request]'); if (!b) return;
    e.preventDefault(); openRequest(b.getAttribute('data-atek-request') || 'request', [], b.getAttribute('data-title'), b.getAttribute('data-sub'));
  });

  // ------------------------------------------------------------------
  // КАТАЛОГ
  // ------------------------------------------------------------------
  function initCatalog(el) {
    var st = {
      line: qs('line') || el.getAttribute('data-line') || '', cat: qs('cat'), q: qs('q'),
      sort: qs('sort') || 'default', stock: qs('stock') === '1', lvl: qs('lvl'), pro: qs('pro') === '1',
      shown: +(el.getAttribute('data-per-page') || CFG.perPage)
    };
    var per = st.shown;
    el.innerHTML = '<div class="atek-grid">' + new Array(9).join('<div class="atek-skel" style="aspect-ratio:3/4"></div>') + '</div>';
    var built = false;

    onData(function (d) {
      if (!built) build(d); else renderList();
    });

    function build(d) {
      built = true;
      var tabs = '<button class="atek-tab" data-line="">Все товары</button>' + Object.keys(LINES).map(function (k) {
        return '<button class="atek-tab" data-line="' + k + '">' + ICO[k] + LINES[k].name + '</button>';
      }).join('');
      el.innerHTML =
        '<div class="atek-cat-head"><div><div class="atek-eyebrow">Каталог</div><h1 class="atek-h2" style="margin-top:12px" data-title>Продукция A·TEK</h1></div></div>' +
        '<div class="atek-tabs" data-tabs>' + tabs + '</div>' +
        '<div class="atek-chips" data-cats></div>' +
        '<div class="atek-toolbar">' +
          '<label class="atek-search">' + ICO.search + '<input type="search" placeholder="Поиск по названию или артикулу" data-q></label>' +
          '<select class="atek-select" data-sort aria-label="Сортировка">' +
            '<option value="default">По популярности</option><option value="price_asc">Сначала дешевле</option>' +
            '<option value="price_desc">Сначала дороже</option><option value="name">По названию</option></select>' +
          '<select class="atek-select" data-lvl aria-label="Сложность монтажа"><option value="">Любой монтаж</option>' +
            '<option value="1">01 · Простой</option><option value="2">02 · Базовые навыки</option><option value="3">03 · Специалист</option></select>' +
          '<label class="atek-toggle"><input type="checkbox" data-pro> PRO</label>' +
          '<label class="atek-toggle"><input type="checkbox" data-stock> В наличии</label>' +
          '<span class="atek-count" data-count></span>' +
        '</div>' +
        '<div class="atek-grid" data-list></div><div class="atek-more" data-more></div>';

      $('[data-q]', el).value = st.q; $('[data-sort]', el).value = st.sort; $('[data-lvl]', el).value = st.lvl;
      $('[data-stock]', el).checked = st.stock; $('[data-pro]', el).checked = st.pro;

      $('[data-tabs]', el).addEventListener('click', function (e) {
        var b = e.target.closest('[data-line]'); if (!b) return;
        st.line = b.getAttribute('data-line'); st.cat = ''; reset();
      });
      $('[data-cats]', el).addEventListener('click', function (e) {
        var b = e.target.closest('[data-cat]'); if (!b) return;
        var c = b.getAttribute('data-cat'); st.cat = st.cat === c ? '' : c; reset();
      });
      var t; $('[data-q]', el).addEventListener('input', function (e) { clearTimeout(t); t = setTimeout(function () { st.q = e.target.value.trim(); reset(); }, 200); });
      $('[data-sort]', el).addEventListener('change', function (e) { st.sort = e.target.value; reset(); });
      $('[data-lvl]', el).addEventListener('change', function (e) { st.lvl = e.target.value; reset(); });
      $('[data-stock]', el).addEventListener('change', function (e) { st.stock = e.target.checked; reset(); });
      $('[data-pro]', el).addEventListener('change', function (e) { st.pro = e.target.checked; reset(); });
      $('[data-more]', el).addEventListener('click', function (e) { if (e.target.closest('button')) { st.shown += per; renderList(); } });
      renderList();
    }
    function reset() { st.shown = per; syncUrl(); renderList(); }
    function syncUrl() {
      var u = new URL(location.href);
      [['line', st.line], ['cat', st.cat], ['q', st.q], ['sort', st.sort === 'default' ? '' : st.sort],
       ['lvl', st.lvl], ['stock', st.stock ? '1' : ''], ['pro', st.pro ? '1' : '']].forEach(function (kv) {
        kv[1] ? u.searchParams.set(kv[0], kv[1]) : u.searchParams.delete(kv[0]);
      });
      try { history.replaceState(null, '', u); } catch (e) {}
    }
    function renderList() {
      var d = DATA;
      $$('[data-tabs] .atek-tab', el).forEach(function (b) { b.classList.toggle('is-active', b.getAttribute('data-line') === st.line); });
      var cats = (d.categories || []).filter(function (c) { return !st.line || c.line === st.line; });
      $('[data-cats]', el).innerHTML = cats.map(function (c) {
        return '<button class="atek-chip' + (st.cat === c.id ? ' is-active' : '') + '" data-cat="' + esc(c.id) + '">' + esc(c.name) + '</button>';
      }).join('');
      $('[data-title]', el).textContent = st.cat && d.catById[st.cat] ? d.catById[st.cat].name
        : st.line ? 'A·TEK ' + LINES[st.line].name + ' — ' + LINES[st.line].sub.toLowerCase() : 'Продукция A·TEK';

      var q = st.q.toLowerCase();
      var list = d.products.filter(function (p) {
        return (!st.line || p.line === st.line) && (!st.cat || p.category === st.cat) &&
          (!st.stock || p.stock > 0) && (!st.pro || p.series === 'PRO') && (!st.lvl || String(p.difficulty) === st.lvl) &&
          (!q || (p.name + ' ' + p.sku + ' ' + (p.short || '')).toLowerCase().indexOf(q) >= 0);
      });
      var s = st.sort;
      list.sort(function (a, b) {
        if (s === 'price_asc') return a.price - b.price;
        if (s === 'price_desc') return b.price - a.price;
        if (s === 'name') return String(a.name).localeCompare(b.name, 'ru');
        return (b.stock > 0) - (a.stock > 0) || a.sort - b.sort;   // сначала то, что в наличии
      });
      $('[data-count]', el).textContent = list.length + ' ' + plural(list.length, 'товар', 'товара', 'товаров');
      $('[data-list]', el).innerHTML = list.length ? list.slice(0, st.shown).map(cardHtml).join('')
        : '<div class="atek-empty" style="grid-column:1/-1">Ничего не нашлось. Попробуйте изменить фильтры.</div>';
      $('[data-more]', el).innerHTML = list.length > st.shown
        ? '<button class="atek-btn atek-btn--ghost">Показать ещё ' + Math.min(per, list.length - st.shown) + '</button>' : '';
    }
  }

  // ------------------------------------------------------------------
  // ПОДБОРКА ТОВАРОВ (главная, «похожие»)
  // ------------------------------------------------------------------
  function initFeatured(el) {
    var limit = +(el.getAttribute('data-limit') || 8), line = el.getAttribute('data-line') || '';
    var skus = (el.getAttribute('data-skus') || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    el.innerHTML = '<div class="atek-grid">' + new Array(limit + 1).join('<div class="atek-skel" style="aspect-ratio:3/4"></div>') + '</div>';
    onData(function (d) {
      var list = skus.length ? skus.map(function (s) { return d.bySku[s]; }).filter(Boolean)
        : d.products.filter(function (p) { return (!line || p.line === line) && p.stock > 0; });
      el.innerHTML = '<div class="atek-grid">' + list.slice(0, limit).map(cardHtml).join('') + '</div>';
    });
  }

  // ------------------------------------------------------------------
  // СТРАНИЦА ТОВАРА
  // ------------------------------------------------------------------
  function initProduct(el) {
    var sku = el.getAttribute('data-sku') || qs('sku');
    el.innerHTML = '<div class="atek-pp"><div class="atek-skel" style="aspect-ratio:1/1"></div><div class="atek-skel" style="height:420px"></div></div>';
    onData(function (d) {
      var p = d.bySku[sku];
      if (!p) {
        el.innerHTML = '<div class="atek-empty"><h2 class="atek-h3" style="margin-bottom:12px">Товар не найден</h2>' +
          '<p style="margin-bottom:24px">Возможно, он снят с продажи.</p><a class="atek-btn atek-btn--primary" href="' + esc(CFG.catalogPage) + '">В каталог ' + ICO.arrow + '</a></div>';
        return;
      }
      var line = LINES[p.line] || { name: '', sub: '' }, cat = d.catById[p.category];
      var imgs = [p.image].concat(p.gallery || []).filter(Boolean);
      var specs = parseSpecs(p.specs), docs = parseDocs(p.docs);
      var qty = 1;

      el.innerHTML =
        '<nav class="atek-crumbs"><a href="' + esc(CFG.catalogPage) + '">Каталог</a>' +
          (line.name ? '<span><a href="' + esc(CFG.catalogPage) + '?line=' + p.line + '">' + line.name + '</a></span>' : '') +
          (cat ? '<span><a href="' + esc(CFG.catalogPage) + '?line=' + p.line + '&cat=' + encodeURIComponent(cat.id) + '">' + esc(cat.name) + '</a></span>' : '') + '</nav>' +
        '<div class="atek-pp">' +
          '<div><div class="atek-gal-main" data-main>' + imgOrPh(imgs[0], p.line, p.name) + '</div>' +
            (imgs.length > 1 ? '<div class="atek-gal-thumbs">' + imgs.map(function (s, i) {
              return '<button class="' + (i ? '' : 'is-active') + '" data-img="' + esc(s) + '"><img src="' + esc(s) + '" alt=""></button>'; }).join('') + '</div>' : '') +
          '</div>' +
          '<div class="atek-pp-info">' +
            '<div class="atek-pp-brand">' + (ICO[p.line] ? '<span style="width:28px;height:28px;display:inline-flex">' + ICO[p.line] + '</span>' : '') +
              '<b>A·TEK ' + line.name + '</b>' + esc(line.sub) + '</div>' +
            '<h1>' + esc(p.name) + '</h1><div class="atek-pp-sku">Артикул: ' + esc(p.sku) + '</div>' +
            '<div class="atek-pp-marks">' + lvlHtml(p.difficulty, true) + (p.series === 'PRO' ? '<span class="atek-pro">PRO · Профессиональная серия</span>' : '') + '</div>' +
            (p.short ? '<p class="atek-pp-short">' + esc(p.short) + '</p>' : '') +
            '<div class="atek-buy">' +
              '<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">' +
                '<div class="atek-price">' + (p.price ? money(p.price) : 'Цена по запросу') +
                  (p.price_old > p.price ? '<s>' + money(p.price_old) + '</s>' : '') + '</div>' + stockHtml(p) + '</div>' +
              '<div class="atek-buy-row">' +
                (p.stock > 0 ? '<div class="atek-qty"><button data-q="-1" aria-label="Меньше">−</button><input type="number" min="1" value="1" data-qty aria-label="Количество"><button data-q="1" aria-label="Больше">+</button></div>' : '') +
                '<button class="atek-btn atek-btn--primary" data-buy>' + (p.stock > 0 ? 'В корзину' : 'Запросить срок поставки') + '</button>' +
              '</div>' +
              '<div class="atek-buy-row"><button class="atek-btn atek-btn--ghost atek-btn--sm" data-opt>Оптовая цена для монтажников</button></div>' +
              '<div class="atek-buy-note"><span>Гарантия производителя</span><span>Техподдержка на всех этапах</span></div>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="atek-ptabs"><div class="atek-ptabs-nav">' +
          (p.description ? '<button data-tab="desc">Описание</button>' : '') +
          (specs.length ? '<button data-tab="specs">Характеристики</button>' : '') +
          (docs.length ? '<button data-tab="docs">Документы</button>' : '') + '</div>' +
          (p.description ? '<div class="atek-ptab atek-rich" data-pane="desc">' + md(p.description) + '</div>' : '') +
          (specs.length ? '<div class="atek-ptab" data-pane="specs"><table class="atek-specs">' + specs.map(function (s) {
            return '<tr><td>' + esc(s[0]) + '</td><td>' + esc(s[1]) + '</td></tr>'; }).join('') + '</table></div>' : '') +
          (docs.length ? '<div class="atek-ptab atek-docs" data-pane="docs">' + docs.map(function (x) {
            return '<a href="' + esc(x.url) + '" target="_blank" rel="noopener">' + ICO.doc + esc(x.title) + '</a>'; }).join('') + '</div>' : '') +
        '</div>' +
        '<div data-related></div>';

      var first = $('.atek-ptabs-nav button', el);
      if (first) { first.classList.add('is-active'); $('[data-pane="' + first.getAttribute('data-tab') + '"]', el).classList.add('is-active'); }
      $('.atek-ptabs-nav', el).addEventListener('click', function (e) {
        var b = e.target.closest('[data-tab]'); if (!b) return;
        $$('.atek-ptabs-nav button', el).forEach(function (x) { x.classList.toggle('is-active', x === b); });
        $$('.atek-ptab', el).forEach(function (x) { x.classList.toggle('is-active', x.getAttribute('data-pane') === b.getAttribute('data-tab')); });
      });
      el.onclick = function (e) {
        var t = e.target.closest('[data-img]');
        if (t) { $('[data-main]', el).innerHTML = '<img src="' + esc(t.getAttribute('data-img')) + '" alt="' + esc(p.name) + '">';
          $$('[data-img]', el).forEach(function (x) { x.classList.toggle('is-active', x === t); }); }
        var q = e.target.closest('[data-q]');
        if (q) { var i = $('[data-qty]', el); i.value = Math.max(1, (+i.value || 1) + (+q.getAttribute('data-q'))); }
        if (e.target.closest('[data-buy]')) { var inp = $('[data-qty]', el); addToCart(p, inp ? +inp.value || 1 : 1); }
        if (e.target.closest('[data-opt]')) openRequest('opt', [{ sku: p.sku, qty: ($('[data-qty]', el) || {}).value || 1 }], 'Оптовая цена', 'Для монтажных организаций и партнёров — пришлём условия и прайс.');
      };

      // Похожие товары
      var rel = d.products.filter(function (x) { return x.sku !== p.sku && x.category === p.category; });
      if (rel.length < 4) rel = rel.concat(d.products.filter(function (x) { return x.sku !== p.sku && x.line === p.line && rel.indexOf(x) < 0; }));
      if (rel.length) $('[data-related]', el).innerHTML = '<h2 class="atek-h2" style="margin:72px 0 28px">С этим товаром смотрят</h2><div class="atek-grid">' + rel.slice(0, 4).map(cardHtml).join('') + '</div>';

      // SEO: заголовок, описание, разметка Product
      if (!el.hasAttribute('data-keep-title')) document.title = p.name + ' — A·TEK ' + line.name;
      setMeta('description', p.short || p.name);
      setJsonLd({
        '@context': 'https://schema.org', '@type': 'Product', name: p.name, sku: p.sku,
        brand: { '@type': 'Brand', name: 'A·TEK' }, description: p.short || '', image: imgs,
        offers: { '@type': 'Offer', priceCurrency: 'RUB', price: p.price, url: location.href,
          availability: p.stock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/PreOrder' }
      });
    });
  }
  function setMeta(name, content) {
    var m = $('meta[name="' + name + '"]'); if (!m) { m = document.createElement('meta'); m.name = name; document.head.appendChild(m); }
    m.content = content;
  }
  function setJsonLd(o) {
    var s = $('#atek-ld'); if (!s) { s = document.createElement('script'); s.type = 'application/ld+json'; s.id = 'atek-ld'; document.head.appendChild(s); }
    s.textContent = JSON.stringify(o);
  }

  // ------------------------------------------------------------------
  // НОВОСТИ
  // ------------------------------------------------------------------
  var RINGS = '<svg viewBox="0 0 200 200" fill="none"><g stroke="' + B + '" stroke-width="2"><path d="M100 30a70 70 0 1 1 0 140"/><path d="M100 55a45 45 0 1 1 0 90"/><path d="M100 78a22 22 0 1 1 0 44"/></g><circle cx="100" cy="100" r="9" fill="' + O + '"/></svg>';
  function newsCard(n, wide) {
    return '<a class="atek-news-card' + (wide ? ' atek-news-card--wide' : '') + '" href="' + esc(newsUrl(n)) + '">' +
      '<div class="atek-news-cover">' + (n.cover ? '<img src="' + esc(n.cover) + '" alt="" loading="lazy">' : '<div class="atek-cover-ph">' + RINGS + '</div>') + '</div>' +
      '<div class="atek-news-body"><div class="atek-news-meta"><span>' + dateRu(n.date) + '</span>' + (n.tag ? '<span class="atek-news-tag">' + esc(n.tag) + '</span>' : '') + '</div>' +
      '<h3>' + esc(n.title) + '</h3>' + (n.excerpt ? '<p>' + esc(n.excerpt) + '</p>' : '') + '</div></a>';
  }
  function initNews(el) {
    var limit = +(el.getAttribute('data-limit') || 0), filters = el.getAttribute('data-filters') !== '0',
        feature = el.getAttribute('data-feature') !== '0' && !limit, tag = qs('tag');
    el.innerHTML = '<div class="atek-news-grid">' + new Array(4).join('<div class="atek-skel" style="height:360px"></div>') + '</div>';
    onData(function (d) {
      var all = d.news || [];
      var tags = []; all.forEach(function (n) { if (n.tag && tags.indexOf(n.tag) < 0) tags.push(n.tag); });
      function render() {
        var list = all.filter(function (n) { return !tag || n.tag === tag; });
        if (limit) list = list.slice(0, limit);
        el.innerHTML = (filters && tags.length > 1 ? '<div class="atek-chips" style="margin:0 0 28px">' +
            ['' ].concat(tags).map(function (t) { return '<button class="atek-chip' + (t === tag ? ' is-active' : '') + '" data-tag="' + esc(t) + '">' + (t ? esc(t) : 'Все') + '</button>'; }).join('') + '</div>' : '') +
          (list.length ? '<div class="atek-news-grid">' + list.map(function (n, i) { return newsCard(n, feature && i === 0 && !tag); }).join('') + '</div>'
            : '<div class="atek-empty">Новостей пока нет.</div>');
      }
      el.onclick = function (e) {
        var b = e.target.closest('[data-tag]'); if (!b) return;
        tag = b.getAttribute('data-tag');
        var u = new URL(location.href); tag ? u.searchParams.set('tag', tag) : u.searchParams.delete('tag'); try { history.replaceState(null, '', u); } catch (e) {}
        render();
      };
      render();
    });
  }
  function initNewsItem(el) {
    var id = el.getAttribute('data-id') || qs('id');
    el.innerHTML = '<div class="atek-article"><div class="atek-skel" style="height:60px;margin-bottom:20px"></div><div class="atek-skel" style="height:360px"></div></div>';
    onData(function (d) {
      var all = d.news || [], i = -1;
      all.forEach(function (n, k) { if (n.id === id) i = k; });
      var n = all[i];
      if (!n) { el.innerHTML = '<div class="atek-empty">Новость не найдена. <a class="atek-link" href="' + esc(CFG.newsPage) + '">Все новости</a></div>'; return; }
      var more = all.filter(function (x) { return x !== n; }).slice(0, 3);
      el.innerHTML = '<article class="atek-article">' +
        '<a class="atek-back" href="' + esc(CFG.newsPage) + '">' + ICO.back + 'Все новости</a>' +
        '<div class="atek-news-meta" style="margin-bottom:16px"><span>' + dateRu(n.date) + '</span>' + (n.tag ? '<span class="atek-news-tag">' + esc(n.tag) + '</span>' : '') + '</div>' +
        '<h1 class="atek-h1">' + esc(n.title) + '</h1>' +
        '<div class="atek-article-cover">' + (n.cover ? '<img src="' + esc(n.cover) + '" alt="">' : '<div class="atek-cover-ph">' + RINGS + '</div>') + '</div>' +
        '<div class="atek-rich">' + md(n.body || n.excerpt) + '</div></article>' +
        (more.length ? '<h2 class="atek-h2" style="margin:80px 0 28px">Другие новости</h2><div class="atek-news-grid">' + more.map(function (x) { return newsCard(x); }).join('') + '</div>' : '');
      if (!el.hasAttribute('data-keep-title')) document.title = n.title + ' — A·TEK';
      setMeta('description', n.excerpt || n.title);
    });
  }

  // ------------------------------------------------------------------
  // ШАПКА
  // ------------------------------------------------------------------
  function initHeader(el) {
    var burger = $('.atek-burger', el);
    if (burger) burger.addEventListener('click', function () { el.classList.toggle('is-open'); });
    $$('.atek-nav a', el).forEach(function (a) {
      var h = a.getAttribute('href'); if (h && h !== '/' && location.pathname.indexOf(h) === 0) a.classList.add('is-active');
    });
    $$('[data-atek-cart]', el).forEach(function (b) { b.addEventListener('click', function (e) { e.preventDefault(); openCart(); }); });
    $$('[data-atek-search]', el).forEach(function (f) {
      f.addEventListener('submit', function (e) { e.preventDefault(); location.href = CFG.catalogPage + '?q=' + encodeURIComponent($('input', f).value); });
    });
    updateCartCount(); setInterval(updateCartCount, 1500);
  }

  // ------------------------------------------------------------------
  // Запуск
  // ------------------------------------------------------------------
  var INIT = { catalog: initCatalog, product: initProduct, featured: initFeatured, news: initNews, 'news-item': initNewsItem, header: initHeader };
  function boot() {
    var need = false;
    $$('[data-atek]').forEach(function (el) {
      if (el.__atek) return; el.__atek = true;
      var t = el.getAttribute('data-atek'); if (INIT[t]) { INIT[t](el); if (t !== 'header') need = true; }
    });
    if (need && !DATA) load();
  }
  window.ATEK_API = { reload: function () { DATA = null; loading = false; load(); }, addToCart: addToCart, openRequest: openRequest, boot: boot };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  window.addEventListener('load', boot);   // Tilda иногда дорисовывает блоки после DOMContentLoaded
})();
