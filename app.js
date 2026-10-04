const pageContent = document.getElementById('page-content');
const pageNames = {
  dashboard: 'COMMAND OVERVIEW',
  fleet: 'FLEET',
  predictions: 'PREDICTIVE INSIGHTS',
  maintenance: 'MAINTENANCE',
  inventory: 'INVENTORY',
};

let currentPage = 'dashboard';
let fleetCache = [];

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
}

function toast(message, error = false) {
  const item = document.createElement('div');
  item.className = `toast${error ? ' error' : ''}`;
  item.textContent = message;
  document.getElementById('toast-region').append(item);
  window.setTimeout(() => item.remove(), 3600);
}

function formatDate(value) {
  if (!value) return '—';
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.valueOf()) ? '—' : new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(parsed);
}

function daysAgo(value) {
  const days = Math.max(0, Math.round((Date.now() - new Date(`${value}T00:00:00`).getTime()) / 86400000));
  return days === 0 ? 'Today' : `${days}d ago`;
}

function statusBadge(status) {
  return `<span class="status-badge ${String(status).toLowerCase()}">${escapeHtml(status)}</span>`;
}

function healthMarkup(health) {
  const level = health < 60 ? 'health-low' : health < 80 ? 'health-mid' : '';
  return `<div class="health-cell"><span class="health-track"><span class="${level}" style="width:${Math.max(0, Math.min(100, health))}%"></span></span><span class="health-value">${escapeHtml(health)}%</span></div>`;
}

function priorityBadge(priority) {
  const cls = priority === 'Urgent' ? 'urgent' : priority.toLowerCase();
  return `<span class="priority-badge ${cls}">${escapeHtml(priority)}</span>`;
}

function severityBadge(severity) {
  return `<span class="severity-badge ${severity.toLowerCase()}">${escapeHtml(severity)}</span>`;
}

function aircraftRows(aircraft) {
  if (!aircraft.length) return '<tr><td colspan="7" class="empty-state">No aircraft match this filter.</td></tr>';
  return aircraft.map((item) => `<tr>
    <td><span class="aircraft-id">${escapeHtml(item.id)}</span><span class="aircraft-model">${escapeHtml(item.model)}</span></td>
    <td>${escapeHtml(item.squadron)}</td><td>${escapeHtml(item.base)}</td>
    <td>${statusBadge(item.status)}</td><td>${healthMarkup(item.health)}</td>
    <td>${escapeHtml(Number(item.flight_hours).toLocaleString())} h</td><td>${formatDate(item.next_inspection)}</td>
  </tr>`).join('');
}

function chartMarkup(points) {
  const width = 650;
  const height = 170;
  const left = 33;
  const right = 8;
  const top = 15;
  const bottom = 27;
  const min = 60;
  const max = 100;
  const coords = points.map((point, index) => {
    const x = left + (index * (width - left - right)) / Math.max(1, points.length - 1);
    const y = top + ((max - point.value) / (max - min)) * (height - top - bottom);
    return { x, y, ...point };
  });
  const line = coords.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
  const area = `${line} L ${coords.at(-1)?.x || left} ${height - bottom} L ${coords[0]?.x || left} ${height - bottom} Z`;
  const lines = [60, 70, 80, 90, 100].map((value) => {
    const y = top + ((max - value) / (max - min)) * (height - top - bottom);
    return `<line class="chart-grid-line" x1="${left}" y1="${y}" x2="${width - right}" y2="${y}"/><text class="chart-y-label" x="0" y="${y + 3}">${value}%</text>`;
  }).join('');
  const labels = coords.map((point) => `<text class="chart-label" text-anchor="middle" x="${point.x}" y="${height - 7}">${escapeHtml(point.day)}</text>`).join('');
  const dots = coords.map((point, index) => index === coords.length - 1
    ? `<circle class="chart-point" cx="${point.x}" cy="${point.y}" r="4"/>` : '').join('');
  return `<svg class="availability-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Fleet availability trend over the last seven days">
    <defs><linearGradient id="chartFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#5a7bea" stop-opacity=".18"/><stop offset="100%" stop-color="#5a7bea" stop-opacity="0"/></linearGradient></defs>
    ${lines}<path class="chart-area" d="${area}"/><path class="chart-line" d="${line}"/>${dots}${labels}
  </svg>`;
}

function alertRows(alerts, actions = true) {
  if (!alerts.length) return '<div class="empty-state">No active alerts. Fleet picture is clear.</div>';
  return alerts.map((alert) => `<div class="alert-row">
    <span class="severity-mark ${alert.severity.toLowerCase()}"></span>
    <div class="alert-copy"><strong>${escapeHtml(alert.component)} · ${escapeHtml(alert.aircraft_id)}</strong>
      <small>${escapeHtml(alert.title)} <span class="alert-rul">· ${daysAgo(alert.created_at)}</span></small></div>
    <div class="alert-meta"><b>${alert.rul_cycles === null ? '—' : `${escapeHtml(alert.rul_cycles)} cycles`}</b><span>${alert.risk_percent}% risk</span>
      ${actions && !alert.acknowledged ? `<button class="table-action" data-action="ack-alert" data-id="${alert.id}">Review</button>` : ''}</div>
  </div>`).join('');
}

function fleetTable(aircraft, compact = false) {
  const visible = compact ? aircraft.slice(0, 5) : aircraft;
  return `<table class="fleet-table"><thead><tr><th>Aircraft</th><th>Squadron</th><th>Base</th><th>Status</th><th>Health</th><th>Flight hours</th><th>Next inspection</th></tr></thead><tbody>${aircraftRows(visible)}</tbody></table>`;
}

function dashboardMarkup(data) {
  return `<div class="page-heading">
    <div><span class="eyebrow">DEMO FLEET · READINESS PICTURE</span><h1>Command overview</h1><p class="page-subtitle">A single view of fleet health, emerging issues, and maintenance readiness.</p></div>
    <div class="heading-actions"><button class="button-secondary" data-action="navigate" data-target="fleet">View fleet <span>→</span></button><button class="button-primary" data-action="new-order"><span>＋</span> New work order</button></div>
  </div>
  <div class="kpi-grid">
    <article class="kpi-card"><div class="kpi-topline">Fleet availability <span class="kpi-icon blue">↗</span></div><div class="kpi-bottom"><span class="kpi-value">${data.availability}%</span><span class="kpi-unit">mission capable</span></div><div class="kpi-foot"><strong>${data.available} of ${data.fleet_total}</strong> aircraft available</div></article>
    <article class="kpi-card"><div class="kpi-topline">Fleet size <span class="kpi-icon teal">✦</span></div><div class="kpi-bottom"><span class="kpi-value">${data.fleet_total}</span><span class="kpi-unit">aircraft</span></div><div class="kpi-foot">${data.fleet_total - data.available} in inspection or grounded</div></article>
    <article class="kpi-card"><div class="kpi-topline">AI risk flags <span class="kpi-icon amber">⌁</span></div><div class="kpi-bottom"><span class="kpi-value">${data.active_alerts}</span><span class="kpi-unit">need review</span></div><div class="kpi-foot"><span class="warn">${data.urgent_work_orders} urgent</span> open work orders</div></article>
    <article class="kpi-card"><div class="kpi-topline">Open work orders <span class="kpi-icon red">⚒</span></div><div class="kpi-bottom"><span class="kpi-value">${data.open_work_orders}</span><span class="kpi-unit">in workflow</span></div><div class="kpi-foot">Scheduled and in progress</div></article>
  </div>
  <div class="dashboard-grid">
    <section class="panel">
      <div class="panel-heading"><div><h2>Fleet availability</h2><p>Mission-capable aircraft · last 7 days</p></div><button class="panel-action" data-action="navigate" data-target="fleet">Fleet details →</button></div>
      <div class="chart-wrap"><div class="chart-summary"><strong>${data.availability}%</strong><span>Today</span></div>${chartMarkup(data.availability_history)}</div>
      <div class="chart-legend"><span class="legend-dot"></span> Mission capable <span class="legend-sub">Illustrative historical trend</span></div>
    </section>
    <section class="panel">
      <div class="panel-heading"><div><h2>AI condition alerts</h2><p>Local logistic model · ranked by sensor risk score</p></div><button class="panel-action" data-action="navigate" data-target="predictions">All insights →</button></div>
      <div class="alerts-list">${alertRows(data.alerts.slice(0, 4))}</div>
    </section>
  </div>
  <section class="panel fleet-panel">
    <div class="panel-heading"><div><h2>Fleet status</h2><p>Current aircraft health and next planned inspection</p></div><button class="panel-action" data-action="navigate" data-target="fleet">View all ${data.fleet_total} aircraft →</button></div>
    ${fleetTable(data.fleet, true)}
    <div class="table-footer"><span>Showing ${Math.min(data.fleet.length, 5)} of ${data.fleet_total} aircraft</span><span>Health index is synthetic demo data</span></div>
  <div class="section-note"><b>AI</b><span>The local logistic-regression demo scores four synthetic sensor signals. Its training labels and predictions are illustrative only; no real aircraft records or external AI service are used.</span></div>
  </section>`;
}

async function renderDashboard() {
  const data = await api('/api/dashboard');
  fleetCache = data.fleet;
  updateNavCounts(data);
  pageContent.innerHTML = dashboardMarkup(data);
}

function updateNavCounts(data) {
  document.getElementById('fleet-nav-count').textContent = data.fleet_total;
  document.getElementById('alert-nav-count').textContent = data.active_alerts;
}

function pageHeading(eyebrow, title, subtitle, action = '') {
  return `<div class="page-heading"><div><span class="eyebrow">${eyebrow}</span><h1>${title}</h1><p class="page-subtitle">${subtitle}</p></div>${action ? `<div class="heading-actions">${action}</div>` : ''}</div>`;
}

async function renderFleet(search = '', status = '') {
  const query = new URLSearchParams();
  if (search) query.set('q', search);
  if (status) query.set('status', status);
  const aircraft = await api(`/api/aircraft?${query}`);
  fleetCache = aircraft;
  pageContent.innerHTML = `${pageHeading('AIRCRAFT DIRECTORY', 'Fleet', 'Health, location, and service outlook across the demonstration fleet.', '<button class="button-primary" data-action="new-order"><span>＋</span> New work order</button>')}
    <div class="filters-row"><label class="search-box"><span>⌕</span><input id="fleet-search" type="search" placeholder="Search aircraft, squadron, base…" value="${escapeHtml(search)}"></label>
      <select class="filter-select" id="fleet-status"><option value="">All statuses</option><option ${status === 'Available' ? 'selected' : ''}>Available</option><option ${status === 'Inspection' ? 'selected' : ''}>Inspection</option><option ${status === 'Grounded' ? 'selected' : ''}>Grounded</option></select></div>
    <section class="panel table-panel"><div class="table-toolbar"><strong>Aircraft register</strong><span>${aircraft.length} aircraft</span></div>${fleetTable(aircraft)}<div class="table-footer"><span>Health scores are synthetic and not airworthiness determinations</span><span>Updated just now</span></div></section>
    <div class="section-note"><b>ⓘ</b><span>Availability is computed from the demo status labels. A real deployment must source readiness from approved maintenance and operations systems.</span></div>`;
}

async function renderPredictions() {
  const [predictions, model] = await Promise.all([
    api('/api/predictions'),
    api('/api/model'),
  ]);
  const rows = predictions.map((item) => `<tr>
    <td><span class="aircraft-id">${escapeHtml(item.aircraft_id)}</span><span class="aircraft-model">${escapeHtml(item.model)} · ${escapeHtml(item.squadron)}</span></td>
    <td>${escapeHtml(item.component)}<span class="aircraft-model">${escapeHtml(item.title)}</span><span class="model-signals">Driven by: ${item.top_signals.slice(0, 2).map((signal) => escapeHtml(signal.label)).join(' · ')}</span></td><td>${severityBadge(item.severity)}</td>
    <td class="rul-cell">${item.rul_cycles === null ? 'Insufficient data' : `${escapeHtml(item.rul_cycles)} cycles`}<small>trend threshold estimate</small></td>
    <td><div class="health-cell"><span class="health-track"><span class="${item.risk_percent >= 70 ? 'health-low' : item.risk_percent >= 50 ? 'health-mid' : ''}" style="width:${item.risk_percent}%"></span></span><span class="health-value">${item.risk_percent}%</span></div><span class="aircraft-model">${item.sample_count} samples</span></td>
    <td>${item.acknowledged ? '<span class="muted-cell">Reviewed</span>' : `<button class="table-action" data-action="ack-alert" data-id="${item.id}">Acknowledge</button>`}</td>
    <td><button class="table-action" data-action="order-from-alert" data-aircraft="${escapeHtml(item.aircraft_id)}" data-component="${escapeHtml(item.component)}">Plan work</button></td>
  </tr>`).join('');
  pageContent.innerHTML = `${pageHeading('CONDITION MONITORING', 'AI predictive insights', 'A locally trained model scores sensor-history trends and shows which signals contribute most.', '<span class="demo-pill">SYNTHETIC MODEL · NOT CERTIFIED</span>')}
    <section class="panel model-card"><div class="model-symbol">AI</div><div class="model-copy"><strong>${escapeHtml(model.name)}</strong><span>Version ${escapeHtml(model.version)} · trained locally on ${Number(model.training_samples).toLocaleString()} generated examples · ${model.features.length} sensor features</span></div><span class="model-status">RUNNING LOCALLY</span></section>
    <section class="panel table-panel"><div class="table-toolbar"><strong>Model assessments</strong><span>${predictions.length} component histories · highest risk first</span></div>
      <table class="data-table"><thead><tr><th>Aircraft</th><th>Component / leading signal</th><th>Model band</th><th>Est. threshold</th><th>Risk score</th><th>Review</th><th>Action</th></tr></thead><tbody>${rows || '<tr><td colspan="7" class="empty-state">No predictions available.</td></tr>'}</tbody></table>
      <div class="table-footer"><span>Trend estimates use the last 12 synthetic sensor samples</span><span>Model ${escapeHtml(model.version)}</span></div></section>
    <div class="section-note"><b>ⓘ</b><span><strong>Demo limitation:</strong> training examples, sensor values, labels, risk scores, and threshold-cycle estimates are synthetic and not validated. Do not use them for aircraft maintenance, safety, readiness, or operational decisions. Production use requires real authorized data, representative failure labels, independent validation, calibrated uncertainty, and qualified human approval.</span></div>`;
}

async function renderMaintenance() {
  const orders = await api('/api/work-orders');
  const rows = orders.map((order) => `<tr>
    <td><span class="aircraft-id">WO-${String(order.id).padStart(4, '0')}</span><span class="aircraft-model">${escapeHtml(order.aircraft_id)} · ${escapeHtml(order.squadron)}</span></td>
    <td>${escapeHtml(order.title)}</td><td>${priorityBadge(order.priority)}</td><td>${formatDate(order.due_date)}</td>
    <td><select class="status-select" data-action="update-order" data-id="${order.id}" aria-label="Update work order status">${['Scheduled', 'In progress', 'Completed'].map((status) => `<option ${status === order.status ? 'selected' : ''}>${status}</option>`).join('')}</select></td>
    <td>${formatDate(order.created_at)}</td>
  </tr>`).join('');
  pageContent.innerHTML = `${pageHeading('WORK MANAGEMENT', 'Maintenance', 'Plan, assign, and track maintenance work orders.', '<button class="button-primary" data-action="new-order"><span>＋</span> Create work order</button>')}
    <section class="panel table-panel"><div class="table-toolbar"><strong>Work order register</strong><span>${orders.filter((order) => order.status !== 'Completed').length} active · ${orders.length} total</span></div>
      <table class="data-table"><thead><tr><th>Work order</th><th>Description</th><th>Priority</th><th>Due date</th><th>Status</th><th>Created</th></tr></thead><tbody>${rows || '<tr><td colspan="6" class="empty-state">No work orders yet. Create one to get started.</td></tr>'}</tbody></table>
      <div class="table-footer"><span>Status updates are stored in the local demo database</span><span>Created from planning inputs</span></div></section>`;
}

async function renderInventory() {
  const parts = await api('/api/inventory');
  const lowStock = parts.filter((part) => part.on_hand <= part.reorder_point).length;
  const rows = parts.map((part) => {
    const percentage = Math.min(100, Math.round((part.on_hand / Math.max(1, part.reorder_point * 2)) * 100));
    const level = part.on_hand <= part.reorder_point ? 'low' : part.on_hand <= part.reorder_point * 1.5 ? 'mid' : '';
    return `<tr><td><span class="aircraft-id">${escapeHtml(part.part)}</span><span class="aircraft-model">${escapeHtml(part.part_number)}</span></td>
      <td>${escapeHtml(part.category)}</td><td>${escapeHtml(part.location)}</td>
      <td class="${part.on_hand <= part.reorder_point ? 'stock-warning' : 'stock-ok'}">${part.on_hand} units</td>
      <td><div class="health-cell"><span class="progress-track"><span class="${level}" style="width:${percentage}%"></span></span><span class="health-value">${part.on_hand <= part.reorder_point ? 'Reorder' : 'In stock'}</span></div></td>
      <td>${part.lead_days} days</td><td><button class="table-action" data-action="reserve-part" data-id="${escapeHtml(part.id)}" ${part.on_hand < 1 ? 'disabled' : ''}>Reserve 1</button></td>
    </tr>`;
  }).join('');
  pageContent.innerHTML = `${pageHeading('SUPPLY READINESS', 'Inventory', 'A demonstration view of selected service parts and stock thresholds.')}
    <div class="kpi-grid">
      <article class="kpi-card"><div class="kpi-topline">Tracked part types <span class="kpi-icon blue">▤</span></div><div class="kpi-bottom"><span class="kpi-value">${parts.length}</span><span class="kpi-unit">items</span></div><div class="kpi-foot">Across 3 sample storage locations</div></article>
      <article class="kpi-card"><div class="kpi-topline">Below reorder point <span class="kpi-icon ${lowStock ? 'amber' : 'teal'}">!</span></div><div class="kpi-bottom"><span class="kpi-value">${lowStock}</span><span class="kpi-unit">items</span></div><div class="kpi-foot">${lowStock ? '<span class="warn">Review replenishment</span>' : 'All sample stock at threshold'}</div></article>
    </div>
    <section class="panel table-panel"><div class="table-toolbar"><strong>Selected parts</strong><span>${parts.reduce((sum, part) => sum + part.on_hand, 0)} total sample units</span></div>
      <table class="data-table"><thead><tr><th>Part</th><th>Category</th><th>Location</th><th>On hand</th><th>Stock health</th><th>Lead time</th><th>Action</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="table-footer"><span>All inventory counts and locations are synthetic</span><span>Reservations update local demo stock</span></div></section>
    <div class="section-note"><b>ⓘ</b><span>Real supply-chain integration needs authoritative inventory sources, role-based approval, and audited reservation workflows.</span></div>`;
}

async function renderPage() {
  currentPage = location.hash.slice(1) || 'dashboard';
  if (!pageNames[currentPage]) currentPage = 'dashboard';
  document.getElementById('breadcrumb-current').textContent = pageNames[currentPage];
  document.querySelectorAll('.nav-link').forEach((link) => link.classList.toggle('active', link.dataset.page === currentPage));
  document.getElementById('sidebar').classList.remove('open');
  pageContent.innerHTML = '<div class="loading-state"><span class="loader"></span> Loading fleet picture…</div>';
  try {
    const renderers = {
      dashboard: renderDashboard,
      fleet: () => renderFleet(),
      predictions: renderPredictions,
      maintenance: renderMaintenance,
      inventory: renderInventory,
    };
    await renderers[currentPage]();
    if (currentPage !== 'dashboard') {
      try {
        updateNavCounts(await api('/api/dashboard'));
      } catch (error) {
        toast(`Sidebar counts could not refresh: ${error.message}`, true);
      }
    }
  } catch (error) {
    pageContent.innerHTML = `<div class="panel empty-state">Unable to load this view. ${escapeHtml(error.message)} <button class="table-action" data-action="refresh">Try again</button></div>`;
  }
}

async function showWorkOrderDialog(aircraftId = '', title = '') {
  try {
    fleetCache = await api('/api/aircraft');
  } catch (error) {
    return toast(error.message, true);
  }
  const select = document.getElementById('wo-aircraft');
  select.innerHTML = fleetCache.map((aircraft) => `<option value="${escapeHtml(aircraft.id)}" ${aircraft.id === aircraftId ? 'selected' : ''}>${escapeHtml(aircraft.id)} · ${escapeHtml(aircraft.model)}</option>`).join('');
  document.getElementById('wo-title').value = title;
  document.getElementById('wo-priority').value = 'Routine';
  document.getElementById('wo-date').value = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  document.getElementById('work-order-dialog').showModal();
}

document.addEventListener('click', async (event) => {
  const action = event.target.closest('[data-action]');
  if (!action) return;
  const kind = action.dataset.action;
  if (kind === 'navigate') {
    location.hash = action.dataset.target;
    return;
  }
  if (kind === 'new-order') return showWorkOrderDialog();
  if (kind === 'refresh') return renderPage();
  if (kind === 'ack-alert') {
    action.disabled = true;
    try {
      await api(`/api/alerts/${action.dataset.id}/acknowledge`, { method: 'POST', body: '{}' });
      toast('Prediction marked as reviewed.');
      await renderPage();
    } catch (error) { action.disabled = false; toast(error.message, true); }
  }
  if (kind === 'order-from-alert') return showWorkOrderDialog(action.dataset.aircraft, `Inspect ${action.dataset.component}`);
  if (kind === 'reserve-part') {
    action.disabled = true;
    try {
      await api(`/api/inventory/${encodeURIComponent(action.dataset.id)}/reserve`, { method: 'POST', body: JSON.stringify({ quantity: 1 }) });
      toast('One unit reserved in the local demo inventory.');
      await renderInventory();
    } catch (error) { action.disabled = false; toast(error.message, true); }
  }
});

document.addEventListener('change', async (event) => {
  if (event.target.id === 'fleet-status') {
    await renderFleet(document.getElementById('fleet-search')?.value || '', event.target.value);
  }
  if (event.target.matches('[data-action="update-order"]')) {
    const select = event.target;
    try {
      await api(`/api/work-orders/${select.dataset.id}/status`, { method: 'POST', body: JSON.stringify({ status: select.value }) });
      toast('Work order status updated.');
      await renderMaintenance();
    } catch (error) { toast(error.message, true); }
  }
});

let searchTimer;
document.addEventListener('input', (event) => {
  if (event.target.id !== 'fleet-search') return;
  window.clearTimeout(searchTimer);
  const search = event.target.value;
  searchTimer = window.setTimeout(async () => {
    const status = document.getElementById('fleet-status')?.value || '';
    const selection = document.getElementById('fleet-search')?.selectionStart ?? search.length;
    try {
      await renderFleet(search, status);
      const updatedSearch = document.getElementById('fleet-search');
      updatedSearch?.focus();
      updatedSearch?.setSelectionRange(selection, selection);
    } catch (error) { toast(error.message, true); }
  }, 180);
});

document.getElementById('work-order-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const payload = Object.fromEntries(form.entries());
  try {
    await api('/api/work-orders', { method: 'POST', body: JSON.stringify(payload) });
    document.getElementById('work-order-dialog').close();
    toast('Work order created.');
    await renderPage();
  } catch (error) { toast(error.message, true); }
});

document.getElementById('cancel-work-order').addEventListener('click', () => document.getElementById('work-order-dialog').close());
document.getElementById('close-dialog').addEventListener('click', () => document.getElementById('work-order-dialog').close());
document.getElementById('refresh-button').addEventListener('click', renderPage);
document.getElementById('mobile-menu').addEventListener('click', () => document.getElementById('sidebar').classList.toggle('open'));
document.getElementById('today-label').textContent = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date());
window.addEventListener('hashchange', renderPage);

async function updateSystemStatus() {
  const status = document.getElementById('system-status');
  try {
    await api('/api/health');
    status.classList.remove('offline', 'checking');
    status.innerHTML = '<span class="pulse-dot"></span> SYSTEM ONLINE';
    status.title = 'Local API is responding';
  } catch (error) {
    status.classList.remove('checking');
    status.classList.add('offline');
    status.innerHTML = '<span class="pulse-dot"></span> API OFFLINE';
    status.title = error.message;
  }
}

window.setInterval(updateSystemStatus, 15000);
updateSystemStatus();
renderPage();
