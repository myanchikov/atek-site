/**
 * A·TEK — API сайта из Google Таблицы
 * ------------------------------------------------------------
 * Что делает:
 *   GET  (сайт читает)  → JSON с товарами, категориями, новостями
 *   POST (сайт пишет)   → заявки / заказы в лист «Заявки» + письмо менеджеру
 *   Меню «A·TEK»        → обновление цен и остатков из листа «Импорт» или по ссылке
 *
 * Установка: см. README.md, раздел 1.
 */

// ===== Названия листов =====
const SH = {
  products: 'Товары',
  categories: 'Категории',
  news: 'Новости',
  settings: 'Настройки',
  requests: 'Заявки',
  import: 'Импорт',
  log: 'Журнал',
};

// ===== Колонки (первая строка каждого листа) =====
const COLS = {
  products: ['sku', 'active', 'name', 'line', 'category', 'price', 'price_old', 'stock', 'unit',
             'difficulty', 'series', 'image', 'gallery', 'short', 'description', 'specs', 'docs', 'sort', 'page_url'],
  categories: ['id', 'name', 'line', 'sort'],
  news: ['id', 'published', 'date', 'title', 'tag', 'cover', 'excerpt', 'body', 'page_url'],
  settings: ['key', 'value', 'comment'],
  requests: ['date', 'type', 'status', 'name', 'phone', 'email', 'company', 'comment', 'items', 'total', 'page'],
  import: ['sku', 'price', 'stock', 'price_old'],
  log: ['date', 'sku', 'field', 'old', 'new', 'source'],
};

// =====================================================================
//  API
// =====================================================================

function doGet(e) {
  const p = (e && e.parameter) || {};
  const only = p.only || 'all';                 // all | products | news
  const ver = getVersion_();
  const key = 'api_' + ver + '_' + only;

  let json = cacheGet_(key);
  if (!json) {
    json = JSON.stringify(buildPayload_(only, ver));
    cachePut_(key, json, getSetting_('cache_minutes', 10) * 60);
  }
  if (p.callback) { // JSONP-запасной вариант
    return ContentService.createTextOutput(p.callback + '(' + json + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

function buildPayload_(only, ver) {
  const out = { version: ver, updated: new Date().toISOString() };
  const s = settingsMap_();
  out.settings = {
    currency: s.currency || '₽',
    low_stock: Number(s.low_stock || 5),
    phone: s.phone || '',
    email_public: s.email_public || '',
  };
  if (only === 'all' || only === 'products') {
    out.categories = readSheet_(SH.categories)
      .filter(r => r.id)
      .sort((a, b) => num_(a.sort) - num_(b.sort));
    out.products = readSheet_(SH.products)
      .filter(r => r.sku && isOn_(r.active))
      .map(r => ({
        sku: String(r.sku).trim(),
        name: r.name,
        line: String(r.line || '').toLowerCase().trim(),
        category: r.category,
        price: num_(r.price),
        price_old: num_(r.price_old) || null,
        stock: num_(r.stock),
        unit: r.unit || 'шт',
        difficulty: num_(r.difficulty) || null,
        series: String(r.series || '').toUpperCase().trim(),
        image: img_(r.image),
        gallery: String(r.gallery || '').split(/[\n,]+/).map(s => img_(s.trim())).filter(Boolean),
        short: r.short,
        description: r.description,
        specs: r.specs,
        docs: r.docs,
        sort: num_(r.sort),
        page_url: r.page_url || '',
      }))
      .sort((a, b) => a.sort - b.sort);
  }
  if (only === 'all' || only === 'news') {
    out.news = readSheet_(SH.news)
      .filter(r => r.id && isOn_(r.published))
      .map(r => ({
        id: String(r.id).trim(),
        date: r.date instanceof Date ? Utilities.formatDate(r.date, 'Europe/Moscow', 'yyyy-MM-dd') : String(r.date || ''),
        title: r.title, tag: r.tag, cover: img_(r.cover),
        excerpt: r.excerpt, body: r.body, page_url: r.page_url || '',
      }))
      .sort((a, b) => (a.date < b.date ? 1 : -1));
  }
  return out;
}

// ----- Приём заявок и заказов -----
function doPost(e) {
  try {
    const d = JSON.parse(e.postData.contents || '{}');
    if (d.website) return json_({ ok: true });                 // honeypot: боты заполняют скрытое поле
    const name = clip_(d.name, 100), phone = clip_(d.phone, 40), email = clip_(d.email, 100);
    if (!name || (!phone && !email)) return json_({ ok: false, error: 'Укажите имя и телефон или e-mail' });

    // Пересчитываем сумму по ценам из таблицы, а не из браузера
    const bySku = {};
    readSheet_(SH.products).forEach(r => { bySku[String(r.sku).trim()] = r; });
    let total = 0;
    const items = (Array.isArray(d.items) ? d.items : []).slice(0, 100).map(it => {
      const r = bySku[String(it.sku).trim()];
      const qty = Math.max(1, Math.min(100000, parseInt(it.qty, 10) || 1));
      const price = r ? num_(r.price) : 0;
      total += price * qty;
      return (r ? r.name : '?') + ' [' + it.sku + '] × ' + qty + (price ? ' = ' + price * qty : '');
    });

    const type = d.type === 'order' ? 'Заказ' : (d.type === 'opt' ? 'Опт' : 'Заявка');
    const lock = LockService.getScriptLock(); lock.waitLock(10000);
    sheet_(SH.requests).appendRow([new Date(), type, 'Новая', name, phone, email,
      clip_(d.company, 150), clip_(d.comment, 2000), items.join('\n'), total || '', clip_(d.page, 300)]);
    lock.releaseLock();

    const to = getSetting_('email', '');
    if (to) {
      MailApp.sendEmail(to, 'A·TEK: ' + type + ' с сайта — ' + name,
        [type, 'Имя: ' + name, 'Телефон: ' + phone, 'E-mail: ' + email, 'Компания: ' + clip_(d.company, 150),
         'Комментарий: ' + clip_(d.comment, 2000), '', items.join('\n'), total ? 'Итого: ' + total : '',
         'Страница: ' + clip_(d.page, 300)].join('\n'));
    }
    return json_({ ok: true });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

// =====================================================================
//  ОБНОВЛЕНИЕ ЦЕН И ОСТАТКОВ
// =====================================================================

/** Лист «Импорт»: вставьте колонки sku | price | stock | price_old (любые можно оставить пустыми). */
function importFromSheet() {
  const rows = readSheet_(SH.import).filter(r => r.sku !== '');
  const res = applyUpdates_(rows, 'лист Импорт');
  sheet_(SH.import).getRange(2, 1, Math.max(1, sheet_(SH.import).getLastRow() - 1), COLS.import.length).clearContent();
  toast_('Обновлено позиций: ' + res.changed + ', не найдено SKU: ' + res.missing.length +
    (res.missing.length ? ' (' + res.missing.slice(0, 10).join(', ') + ')' : ''));
}

/** Скачивает CSV по ссылке из Настроек (feed_url): колонки sku;price;stock (разделитель ; или ,). */
function importFromUrl() {
  const url = getSetting_('feed_url', '');
  if (!url) return toast_('В листе «Настройки» не заполнен feed_url');
  const text = UrlFetchApp.fetch(url, { muteHttpExceptions: true }).getContentText('UTF-8');
  const delim = (text.split('\n')[0].match(/;/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
  const data = Utilities.parseCsv(text, delim);
  const head = data.shift().map(h => String(h).trim().toLowerCase());
  const rows = data.map(r => { const o = {}; head.forEach((h, i) => o[h] = r[i]); return o; });
  const res = applyUpdates_(rows, 'feed_url');
  toast_('Фид: обновлено ' + res.changed + ', не найдено ' + res.missing.length);
}

function applyUpdates_(rows, source) {
  const sh = sheet_(SH.products);
  const values = sh.getDataRange().getValues();
  const head = values[0].map(String);
  const iSku = head.indexOf('sku');
  const idx = {};
  for (let r = 1; r < values.length; r++) idx[String(values[r][iSku]).trim()] = r;

  const log = [], missing = [];
  let changed = 0;
  rows.forEach(u => {
    const sku = String(u.sku).trim();
    const r = idx[sku];
    if (r === undefined) { missing.push(sku); return; }
    let touched = false;
    ['price', 'stock', 'price_old'].forEach(f => {
      if (u[f] === undefined || u[f] === '' || u[f] === null) return;
      const c = head.indexOf(f); if (c < 0) return;
      const nv = num_(u[f]);
      if (num_(values[r][c]) !== nv) {
        log.push([new Date(), sku, f, values[r][c], nv, source]);
        values[r][c] = nv; touched = true;
      }
    });
    if (touched) changed++;
  });
  if (changed) {
    sh.getRange(1, 1, values.length, head.length).setValues(values);
    if (log.length) sheet_(SH.log).getRange(sheet_(SH.log).getLastRow() + 1, 1, log.length, 6).setValues(log);
    bumpVersion_();
  }
  return { changed, missing };
}

// =====================================================================
//  МЕНЮ, ТРИГГЕРЫ, ПЕРВИЧНАЯ НАСТРОЙКА
// =====================================================================

function onOpen() {
  SpreadsheetApp.getUi().createMenu('A·TEK')
    .addItem('Обновить сайт сейчас', 'refreshSite')
    .addSeparator()
    .addItem('Импорт цен/остатков из листа «Импорт»', 'importFromSheet')
    .addItem('Импорт цен/остатков по ссылке (feed_url)', 'importFromUrl')
    .addSeparator()
    .addItem('Первичная настройка (один раз)', 'setup')
    .addToUi();
}

/** Любая правка в таблице → сайт получит новые данные при следующем открытии страницы. */
function onEditInstalled(e) {
  const name = e && e.range && e.range.getSheet().getName();
  if ([SH.products, SH.categories, SH.news, SH.settings].indexOf(name) >= 0) bumpVersion_();
}

function refreshSite() { bumpVersion_(); toast_('Готово: сайт покажет свежие данные'); }

/** Запускается по расписанию, если заполнен feed_url. */
function hourlyFeed() { if (getSetting_('feed_url', '')) importFromUrl(); }

function setup() {
  const ss = SpreadsheetApp.getActive();
  Object.keys(SH).forEach(k => {
    let sh = ss.getSheetByName(SH[k]);
    if (!sh) {
      sh = ss.insertSheet(SH[k]);
      sh.getRange(1, 1, 1, COLS[k].length).setValues([COLS[k]]).setFontWeight('bold').setBackground('#24272C').setFontColor('#FFFFFF');
      sh.setFrozenRows(1);
      const demo = DEMO[k];
      if (demo && demo.length) sh.getRange(2, 1, demo.length, demo[0].length).setValues(demo);
    }
  });
  const def = ss.getSheetByName('Лист1') || ss.getSheetByName('Sheet1');
  if (def && ss.getSheets().length > 1) ss.deleteSheet(def);

  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('onEditInstalled').forSpreadsheet(ss).onEdit().create();
  ScriptApp.newTrigger('hourlyFeed').timeBased().everyHours(1).create();
  bumpVersion_();
  toast_('Готово. Теперь: Развернуть → Новое развертывание → Веб-приложение (доступ: все).');
}

// =====================================================================
//  ДЕМО-ДАННЫЕ (создаются один раз при setup, потом заменяйте своими)
// =====================================================================
const DEMO = {
  categories: [
    ['cameras', 'IP-камеры', 'vision', 1], ['nvr', 'Регистраторы', 'vision', 2],
    ['readers', 'Считыватели', 'access', 3], ['locks', 'Замки', 'access', 4],
    ['smart-cams', 'Умные камеры', 'smart', 5], ['sensors', 'Датчики', 'smart', 6],
    ['fasteners', 'Крепёж', 'fix', 7], ['tools', 'Инструмент', 'fix', 8],
  ],
  products: [
    ['VIS-B2-28', 1, 'IP-камера цилиндрическая 2 Мп', 'vision', 'cameras', 4890, 5490, 34, 'шт', 2, '', '', '',
      'Уличная камера 2 Мп с ИК-подсветкой до 30 м и PoE', 'Надёжная уличная камера для частных домов и небольших объектов. Питание по PoE, запись на карту памяти, защита IP67.',
      'Разрешение: 2 Мп\nОбъектив: 2,8 мм\nИК-подсветка: до 30 м\nПитание: PoE / 12 В\nЗащита: IP67', '', 10, ''],
    ['VIS-B4-PRO', 1, 'IP-камера 4 Мп с аналитикой', 'vision', 'cameras', 9890, '', 3, 'шт', 3, 'PRO', '', '',
      'Детекция людей и авто, моторизованный объектив 2,8–12 мм', 'Профессиональная камера для коммерческих объектов: интеллектуальная аналитика, WDR 120 дБ, встроенный микрофон.',
      'Разрешение: 4 Мп\nОбъектив: 2,8–12 мм, моторизованный\nАналитика: люди, авто, пересечение линии\nWDR: 120 дБ\nЗащита: IP67, IK10', '', 20, ''],
    ['VIS-NVR8', 1, 'Видеорегистратор 8 каналов', 'vision', 'nvr', 7490, '', 12, 'шт', 2, '', '', '',
      '8 каналов до 8 Мп, 1 HDD до 10 ТБ', 'Сетевой регистратор для небольших систем. Удалённый просмотр со смартфона.',
      'Каналы: 8\nРазрешение записи: до 8 Мп\nHDD: 1 × до 10 ТБ\nВыходы: HDMI, VGA', '', 30, ''],
    ['ACC-KP-01', 1, 'Считыватель с клавиатурой', 'access', 'readers', 3290, '', 58, 'шт', 2, '', '', '',
      'Карты EM-Marine / Mifare + PIN-код', 'Антивандальный считыватель для офисов и подъездов. Подсветка клавиатуры, интерфейс Wiegand.',
      'Карты: EM-Marine, Mifare\nИнтерфейс: Wiegand 26/34\nЗащита: IP65\nПитание: 12 В', '', 40, ''],
    ['ACC-ML-280', 1, 'Электромагнитный замок 280 кг', 'access', 'locks', 2590, '', 0, 'шт', 3, 'PRO', '', '',
      'Усилие удержания 280 кг, датчик состояния', 'Замок для металлических и деревянных дверей, с датчиком состояния двери.',
      'Усилие: 280 кг\nПитание: 12 В\nТок: 500 мА\nДатчик двери: есть', '', 50, ''],
    ['SMT-CAM-IN', 1, 'Умная камера для дома', 'smart', 'smart-cams', 2990, 3490, 120, 'шт', 1, '', '', '',
      'Wi-Fi, двусторонняя связь, управление со смартфона', 'Подключается за 5 минут: поставьте на полку, отсканируйте QR-код в приложении — готово.',
      'Разрешение: 2 Мп\nСвязь: Wi-Fi 2,4 ГГц\nАудио: двустороннее\nХранение: microSD / облако', '', 60, ''],
    ['SMT-PIR-01', 1, 'Датчик движения', 'smart', 'sensors', 1490, '', 7, 'шт', 1, '', '', '',
      'Беспроводной, до 2 лет от батарейки', 'Датчик для сценариев умного дома: свет, уведомления, сигнализация.',
      'Дальность: 9 м\nУгол: 110°\nПитание: CR123A\nСвязь: Zigbee 3.0', '', 70, ''],
    ['FIX-DWL-50', 1, 'Дюбель-крюк 8×50, 50 шт', 'fix', 'fasteners', 390, '', 800, 'уп', 1, '', '', '',
      'Для монтажа камер и боксов на бетон и кирпич', 'Нейлоновый дюбель с оцинкованным шурупом.',
      'Размер: 8 × 50 мм\nМатериал: нейлон / оцинкованная сталь\nВ упаковке: 50 шт', '', 80, ''],
    ['FIX-SET-07', 1, 'Набор отвёрток монтажника, 7 шт', 'fix', 'tools', 1890, '', 25, 'набор', 1, 'PRO', '', '',
      'Шлицевые и PH, пенал в комплекте', 'Набор из «Капсулы монтажника»: диэлектрические рукоятки, магнитные наконечники.',
      'Количество: 7 шт\nТипы: SL, PH\nРукоять: двухкомпонентная\nПенал: в комплекте', '', 90, ''],
  ],
  news: [
    ['kapsula', 1, '2026-09-20', 'Представляем «Капсулу монтажника»', 'Продукты', '',
      'Сумка, пенал, органайзер и инструменты в одном наборе — всё, что нужно на объекте.',
      'Мы собрали набор, который монтажник берёт на каждый объект.\n\nВ «Капсулу» входят сумка, пенал с отвёртками, подсумок, органайзер, коврик и многоразовые стяжки.\n\nНабор доступен **для партнёров** с оптовыми условиями.', ''],
    ['vision-pro', 1, '2026-09-05', 'Новая камера A·TEK Vision PRO 4 Мп', 'Vision', '',
      'Аналитика людей и автомобилей и моторизованный объектив.',
      'Камера рассчитана на коммерческие объекты.\n\nВстроенная аналитика снижает число ложных тревог, а моторизованный объектив позволяет настроить угол обзора удалённо.', ''],
    ['packaging', 1, '2026-08-18', 'Новая маркировка упаковки: уровни монтажа', 'Компания', '',
      'Цифра 01–03 на коробке показывает, насколько сложен монтаж.',
      'На упаковке появилась навигация: **01** — простой монтаж, **02** — нужны базовые навыки, **03** — монтаж специалистом.\n\nОтдельно отмечаем профессиональную серию **PRO**.', ''],
  ],
  settings: [
    ['email', '', 'Куда присылать заявки и заказы'],
    ['email_public', 'info@a-tec.su', 'E-mail на сайте'],
    ['phone', '+7 (000) 000-00-00', 'Телефон на сайте'],
    ['currency', '₽', ''],
    ['low_stock', 5, 'До скольких штук писать «Мало»'],
    ['cache_minutes', 10, 'Кэш на сервере; правки в таблице сбрасывают его сразу'],
    ['feed_url', '', 'CSV поставщика/1С: sku;price;stock — обновляется раз в час'],
  ],
};

// =====================================================================
//  ВСПОМОГАТЕЛЬНОЕ
// =====================================================================
function sheet_(name) { return SpreadsheetApp.getActive().getSheetByName(name); }

function readSheet_(name) {
  const sh = sheet_(name); if (!sh) return [];
  const v = sh.getDataRange().getValues();
  const head = v.shift().map(h => String(h).trim());
  return v.map(r => { const o = {}; head.forEach((h, i) => { if (h) o[h] = r[i]; }); return o; });
}

function settingsMap_() {
  const m = {}; readSheet_(SH.settings).forEach(r => { if (r.key) m[String(r.key).trim()] = r.value; }); return m;
}
function getSetting_(k, def) { const v = settingsMap_()[k]; return (v === undefined || v === '') ? def : v; }

function num_(v) {
  if (typeof v === 'number') return v;
  const n = parseFloat(String(v || '').replace(/\s| /g, '').replace(',', '.'));
  return isNaN(n) ? 0 : n;
}
function isOn_(v) { return v === true || v === 1 || /^(1|да|yes|true|y|\+)$/i.test(String(v).trim()); }
function clip_(v, n) { return String(v || '').trim().slice(0, n); }

/** Ссылку «поделиться» из Google Диска превращает в прямую ссылку на картинку. */
function img_(u) {
  u = String(u || '').trim(); if (!u) return '';
  const m = u.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?id=)([\w-]{20,})/);
  return m ? 'https://drive.google.com/thumbnail?id=' + m[1] + '&sz=w1200' : u;
}

function getVersion_() { return PropertiesService.getScriptProperties().getProperty('ver') || '1'; }
function bumpVersion_() { PropertiesService.getScriptProperties().setProperty('ver', String(Date.now())); }

// Кэш с разбиением на куски (лимит CacheService — 100 КБ на ключ)
function cachePut_(key, str, sec) {
  const c = CacheService.getScriptCache(), size = 90000, parts = {};
  const n = Math.ceil(str.length / size);
  for (let i = 0; i < n; i++) parts[key + '_' + i] = str.substr(i * size, size);
  parts[key] = String(n);
  try { c.putAll(parts, Math.min(21600, sec)); } catch (e) {}
}
function cacheGet_(key) {
  const c = CacheService.getScriptCache(); const n = c.get(key); if (!n) return null;
  const keys = []; for (let i = 0; i < +n; i++) keys.push(key + '_' + i);
  const got = c.getAll(keys); let s = '';
  for (const k of keys) { if (got[k] == null) return null; s += got[k]; }
  return s;
}

function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function toast_(m) { try { SpreadsheetApp.getActive().toast(m, 'A·TEK', 8); } catch (e) { Logger.log(m); } }
