const API_URL =
  'https://api.coingecko.com/api/v3/coins/markets' +
  '?vs_currency=usd&order=market_cap_desc&per_page=10&page=1&price_change_percentage=24h';
const REFRESH_INTERVAL_MS = 60_000;
const REQUEST_TIMEOUT_MS = 15_000;
const COLUMN_COUNT = 6;

const elements = {
  table: document.getElementById('rates-table'),
  body: document.getElementById('rates-body'),
  status: document.getElementById('status'),
  error: document.getElementById('error'),
  errorText: document.getElementById('error-text'),
  refreshBtn: document.getElementById('refresh-btn'),
  retryBtn: document.getElementById('retry-btn'),
  lastUpdated: document.getElementById('last-updated'),
};

const priceFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
});
const smallPriceFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumSignificantDigits: 4,
});
const capFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 2,
});
const percentFormatter = new Intl.NumberFormat('ru-RU', {
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
  signDisplay: 'exceptZero',
});
const timeFormatter = new Intl.DateTimeFormat('ru-RU', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

let isLoading = false;
let hasData = false;
let timerId = null;

function formatPrice(value) {
  if (typeof value !== 'number') return '—';
  return value < 1 ? smallPriceFormatter.format(value) : priceFormatter.format(value);
}

function createCell(text, { className = '', label = '' } = {}) {
  const td = document.createElement('td');
  td.textContent = text;
  if (className) td.className = className;
  if (label) td.dataset.label = label;
  return td;
}

function createNameCell(coin) {
  const td = createCell('', { className: 'cell-name' });
  const wrapper = document.createElement('span');
  wrapper.className = 'coin';

  if (typeof coin.image === 'string' && coin.image.startsWith('https://')) {
    const img = document.createElement('img');
    img.src = coin.image;
    img.alt = '';
    img.width = 24;
    img.height = 24;
    img.loading = 'lazy';
    wrapper.append(img);
  }

  const name = document.createElement('span');
  name.textContent = String(coin.name ?? '');
  wrapper.append(name);
  td.append(wrapper);
  return td;
}

function createChangeCell(change) {
  if (typeof change !== 'number') {
    return createCell('—', { className: 'num', label: '24 ч' });
  }
  const isUp = change > 0;
  const isDown = change < 0;
  const arrow = isUp ? '▲ ' : isDown ? '▼ ' : '';
  const td = createCell(`${arrow}${percentFormatter.format(change)}%`, {
    className: `num ${isUp ? 'change--up' : isDown ? 'change--down' : ''}`.trim(),
    label: '24 ч',
  });
  // Стрелка — визуальная подсказка, скринридеру даём словесное описание
  const direction = isUp ? 'рост' : isDown ? 'падение' : 'без изменений';
  td.setAttribute('aria-label', `${direction} ${percentFormatter.format(Math.abs(change))}%`);
  return td;
}

function createRow(coin) {
  const tr = document.createElement('tr');
  tr.append(
    createCell(String(coin.market_cap_rank ?? '—'), { className: 'num cell-rank' }),
    createNameCell(coin),
    createCell(String(coin.symbol ?? ''), { className: 'symbol cell-symbol' }),
    createCell(formatPrice(coin.current_price), { className: 'num', label: 'Цена' }),
    createChangeCell(coin.price_change_percentage_24h),
    createCell(
      typeof coin.market_cap === 'number' ? capFormatter.format(coin.market_cap) : '—',
      { className: 'num', label: 'Капитализация' },
    ),
  );
  return tr;
}

function renderSkeleton(rows = 10) {
  const fragment = document.createDocumentFragment();
  for (let i = 0; i < rows; i += 1) {
    const tr = document.createElement('tr');
    tr.className = 'skeleton';
    tr.setAttribute('aria-hidden', 'true');
    for (let j = 0; j < COLUMN_COUNT; j += 1) tr.append(document.createElement('td'));
    fragment.append(tr);
  }
  elements.body.replaceChildren(fragment);
}

function renderCoins(coins) {
  const fragment = document.createDocumentFragment();
  coins.forEach((coin) => fragment.append(createRow(coin)));
  elements.body.replaceChildren(fragment);
}

function setLoading(loading) {
  isLoading = loading;
  elements.refreshBtn.disabled = loading;
  elements.retryBtn.disabled = loading;
  elements.refreshBtn.setAttribute('aria-busy', String(loading));
  elements.table.setAttribute('aria-busy', String(loading));
  elements.status.textContent = loading ? 'Загрузка данных…' : '';
}

function showError(message) {
  elements.errorText.textContent = message;
  elements.error.hidden = false;
}

function hideError() {
  elements.error.hidden = true;
  elements.errorText.textContent = '';
}

function updateTimestamp(date) {
  elements.lastUpdated.dateTime = date.toISOString();
  elements.lastUpdated.textContent = timeFormatter.format(date);
}

async function fetchCoins() {
  const response = await fetch(API_URL, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (response.status === 429) {
    throw new Error('Превышен лимит запросов к CoinGecko. Попробуйте через минуту.');
  }
  if (!response.ok) {
    throw new Error(`Сервер вернул ошибку ${response.status}.`);
  }

  const data = await response.json();
  if (!Array.isArray(data)) {
    throw new Error('Получен неожиданный формат данных.');
  }
  return data;
}

function getErrorMessage(error) {
  if (error.name === 'TimeoutError') return 'Сервер не ответил вовремя.';
  if (error instanceof TypeError) return 'Нет соединения с сервером. Проверьте интернет.';
  return error.message || 'Неизвестная ошибка.';
}

async function loadData() {
  if (isLoading) return;

  setLoading(true);
  hideError();
  if (!hasData) renderSkeleton();

  try {
    const coins = await fetchCoins();
    renderCoins(coins);
    hasData = true;
    updateTimestamp(new Date());
  } catch (error) {
    const suffix = hasData ? ' Показаны последние полученные данные.' : '';
    showError(`Не удалось загрузить курсы. ${getErrorMessage(error)}${suffix}`);
    if (!hasData) elements.body.replaceChildren();
  } finally {
    setLoading(false);
  }
}

function scheduleAutoRefresh() {
  clearInterval(timerId);
  timerId = setInterval(() => {
    if (!document.hidden) loadData();
  }, REFRESH_INTERVAL_MS);
}

function handleManualRefresh() {
  loadData();
  scheduleAutoRefresh();
}

elements.refreshBtn.addEventListener('click', handleManualRefresh);
elements.retryBtn.addEventListener('click', handleManualRefresh);

// Если вкладка была скрыта дольше интервала — сразу обновляем при возврате
document.addEventListener('visibilitychange', () => {
  const lastIso = elements.lastUpdated.dateTime;
  const stale = !lastIso || Date.now() - Date.parse(lastIso) >= REFRESH_INTERVAL_MS;
  if (!document.hidden && stale) handleManualRefresh();
});

loadData();
scheduleAutoRefresh();
