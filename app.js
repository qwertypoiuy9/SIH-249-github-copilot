const pageContent = document.getElementById('page-content');
const pageNames = {
  dashboard: 'COMMAND OVERVIEW',
  fleet: 'FLEET',
  predictions: 'PREDICTIVE INSIGHTS',
  maintenance: 'MAINTENANCE',
  inventory: 'INVENTORY',
  integrations: 'DATA INTEGRATION',
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
  if (!aircraft.length) return '<tr><td colspan="8" class="empty-state">No aircraft match this filter.</td></tr>';
  return aircraft.map((item) => `<tr>
    <td><span class="aircraft-id">${escapeHtml(item.id)}</span><span class="aircraft-model">${escapeHtml(item.model)}</span></td>
    <td>${escapeHtml(item.squadron)}</td><td>${escapeHtml(item.base)}</td>
    <td>${statusBadge(item.status)}</td><td>${healthMarkup(item.health)}</td>
    <td>${item.ai_risk_percent === null || item.ai_risk_percent === undefined ? '<span class="muted-cell">No data</span>' : `<span class="risk-number ${item.ai_risk_percent >= 70 ? 'risk-high' : item.ai_risk_percent >= 50 ? 'risk-mid' : 'risk-low'}">${item.ai_risk_percent}%</span><span class="aircraft-model">${item.components_monitored} component${item.components_monitored === 1 ? '' : 's'}</span>`}</td>
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
  return `<table class="fleet-table"><thead><tr><th>Aircraft</th><th>Squadron</th><th>Base</th><th>Status</th><th>Health</th><th>AI risk</th><th>Flight hours</th><th>Next inspection</th></tr></thead><tbody>${aircraftRows(visible)}</tbody></table>`;
}

function sensorHistoryMarkup(history) {
  if (!history?.length) return '<span class="muted-cell">No sensor history</span>';
  const names = ['vibration_rms', 'thermal_deviation', 'pressure_drift', 'response_lag'];
  const colors = ['#5271df', '#e1a342', '#37a58a', '#9a68c5'];
  const width = 220;
  const height = 54;
  const paths = names.map((name, index) => {
    const points = history.map((sample, sampleIndex) => {
      const x = 3 + sampleIndex * (width - 6) / Math.max(history.length - 1, 1);
      const y = height - 4 - Math.max(0, Math.min(1, sample[name])) * (height - 8);
      return `${sampleIndex === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join(' ');
    return `<path d="${points}" fill="none" stroke="${colors[index]}" stroke-width="1.7" stroke-linecap="round"/>`;
  }).join('');
  return `<svg class="sensor-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Normalized sensor history across ${history.length} samples">${paths}</svg><span class="sensor-legend">${names.map((name, index) => `<span><i style="background:${colors[index]}"></i>${name.replaceAll('_', ' ')}</span>`).join('')}</span>`;
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
    <td>${escapeHtml(item.component)}<span class="aircraft-model">${escapeHtml(item.title)}</span><span class="model-signals">Driven by: ${item.top_signals.slice(0, 2).map((signal) => escapeHtml(signal.label)).join(' · ')}</span>
      <details class="sensor-details"><summary>${item.sample_count} samples · sensor history</summary>${sensorHistoryMarkup(item.history)}<span class="history-source">${escapeHtml(item.data_source)} · last sample ${formatDate(item.latest_observed_at)}</span></details>
      ${item.latest_maintenance_record ? `<span class="model-signals">Last technical record: ${escapeHtml(item.latest_maintenance_record.record_type)} · ${formatDate(item.latest_maintenance_record.performed_at)}</span>` : ''}</td><td>${severityBadge(item.severity)}</td>
    <td class="rul-cell">${item.rul_cycles === null ? 'Insufficient data' : `${escapeHtml(item.rul_cycles)} cycles`}<small>trend threshold estimate</small></td>
    <td><div class="health-cell"><span class="health-track"><span class="${item.risk_percent >= 70 ? 'health-low' : item.risk_percent >= 50 ? 'health-mid' : ''}" style="width:${item.risk_percent}%"></span></span><span class="health-value">${item.risk_percent}%</span></div><span class="aircraft-model">${item.sample_count} samples</span></td>
    <td>${item.acknowledged ? '<span class="muted-cell">Reviewed</span>' : `<button class="table-action" data-action="ack-alert" data-id="${item.id}">Acknowledge</button>`}</td>
    <td>${item.recommended_spare ? `<span class="model-signals">${escapeHtml(item.recommended_spare.on_hand)} × ${escapeHtml(item.recommended_spare.part)}</span>` : '<span class="model-signals">No mapped spare</span>'}
      <button class="table-action" data-action="order-from-alert" data-alert="${item.id}" data-aircraft="${escapeHtml(item.aircraft_id)}" data-component="${escapeHtml(item.component)}" data-agency="${escapeHtml(item.recommended_agency?.id || '')}" data-part="${escapeHtml(item.recommended_spare?.id || '')}">Plan work</button></td>
  </tr>`).join('');
  pageContent.innerHTML = `${pageHeading('COMPONENT DIGITAL TWIN', 'AI predictive insights', 'Each monitored component brings together sensor history, model risk, technical records, agency, and mapped spares.', '<span class="demo-pill">SYNTHETIC MODEL · NOT CERTIFIED</span>')}
    <section class="panel model-card"><div class="model-symbol">AI</div><div class="model-copy"><strong>${escapeHtml(model.name)}</strong><span>Version ${escapeHtml(model.version)} · trained locally on ${Number(model.training_samples).toLocaleString()} generated examples · ${model.features.length} sensor features</span></div><span class="model-status">RUNNING LOCALLY</span></section>
    <section class="panel table-panel"><div class="table-toolbar"><strong>Model assessments</strong><span>${predictions.length} component histories · highest risk first</span></div>
      <table class="data-table"><thead><tr><th>Aircraft</th><th>Component / leading signal</th><th>Model band</th><th>Est. threshold</th><th>Risk score</th><th>Review</th><th>Action</th></tr></thead><tbody>${rows || '<tr><td colspan="7" class="empty-state">No predictions available.</td></tr>'}</tbody></table>
      <div class="table-footer"><span>Trend estimates use the last 12 synthetic sensor samples</span><span>Model ${escapeHtml(model.version)}</span></div></section>
    <div class="section-note"><b>ⓘ</b><span><strong>Demo limitation:</strong> training examples, sensor values, labels, risk scores, and threshold-cycle estimates are synthetic and not validated. Do not use them for aircraft maintenance, safety, readiness, or operational decisions. Production use requires real authorized data, representative failure labels, independent validation, calibrated uncertainty, and qualified human approval.</span></div>`;
}

async function renderMaintenance() {
  const [orders, records] = await Promise.all([
    api('/api/work-orders'),
    api('/api/maintenance-history'),
  ]);
  const rows = orders.map((order) => `<tr>
    <td><span class="aircraft-id">WO-${String(order.id).padStart(4, '0')}</span><span class="aircraft-model">${escapeHtml(order.aircraft_id)} · ${escapeHtml(order.squadron)}</span></td>
    <td>${escapeHtml(order.title)}${order.component ? `<span class="aircraft-model">${escapeHtml(order.component)}</span>` : ''}</td><td>${priorityBadge(order.priority)}</td><td>${escapeHtml(order.agency_name || 'Unassigned')}</td>
    <td>${order.reserved_part ? `${escapeHtml(order.reserved_quantity)} × ${escapeHtml(order.reserved_part)}<span class="aircraft-model">${escapeHtml(order.reservation_status)}</span>` : '—'}</td><td>${formatDate(order.due_date)}</td>
    <td><select class="status-select" data-action="update-order" data-id="${order.id}" aria-label="Update work order status">${['Scheduled', 'In progress', 'Completed'].map((status) => `<option ${status === order.status ? 'selected' : ''}>${status}</option>`).join('')}</select></td>
    <td>${formatDate(order.created_at)}</td>
  </tr>`).join('');
  const recordRows = records.map((record) => `<tr><td><span class="aircraft-id">${escapeHtml(record.aircraft_id)}</span><span class="aircraft-model">${escapeHtml(record.model)}</span></td>
    <td>${escapeHtml(record.component)}</td><td>${escapeHtml(record.record_type)}</td><td>${formatDate(record.performed_at)}</td><td>${escapeHtml(record.agency)}</td>
    <td>${escapeHtml(record.reference)}<span class="aircraft-model">${escapeHtml(record.source)}</span></td><td>${escapeHtml(record.notes || '—')}</td></tr>`).join('');
  pageContent.innerHTML = `${pageHeading('WORK MANAGEMENT', 'Maintenance', 'Plan, assign, and track maintenance work orders.', '<button class="button-primary" data-action="new-order"><span>＋</span> Create work order</button>')}
    <section class="panel table-panel"><div class="table-toolbar"><strong>Work order register</strong><span>${orders.filter((order) => order.status !== 'Completed').length} active · ${orders.length} total</span></div>
      <table class="data-table"><thead><tr><th>Work order</th><th>Description</th><th>Priority</th><th>Agency</th><th>Reserved spare</th><th>Due date</th><th>Status</th><th>Created</th></tr></thead><tbody>${rows || '<tr><td colspan="8" class="empty-state">No work orders yet. Create one to get started.</td></tr>'}</tbody></table>
      <div class="table-footer"><span>Status updates are stored in the local demo database</span><span>Created from planning inputs</span></div></section>`;
  pageContent.insertAdjacentHTML('beforeend', `<section class="panel table-panel history-panel"><div class="table-toolbar"><strong>Technical history</strong><span>${records.length} aircraft/component records</span></div>
      <table class="data-table"><thead><tr><th>Aircraft</th><th>Component</th><th>Record</th><th>Date</th><th>Agency</th><th>Reference</th><th>Notes</th></tr></thead><tbody>${recordRows || '<tr><td colspan="7" class="empty-state">No technical records. Import a maintenance CSV to begin.</td></tr>'}</tbody></table>
      <div class="table-footer"><span>Source and reference retained for traceability</span><span>Verify against authoritative records</span></div></section>
      <div class="section-note"><b>ⓘ</b><span>Agency assignments and part suggestions are demonstrator workflow aids. Approved technical instructions and qualified personnel remain authoritative.</span></div>`);
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

const importDefinitions = [
  { type: 'aircraft', title: 'Aircraft register', description: 'Aircraft identity, squadron, base, status, service dates, flight hours, and health index.', example: 'id,model,squadron,base,status,flight_hours,last_service,health,next_inspection' },
  { type: 'telemetry', title: 'Health-monitoring telemetry', description: 'Time-stamped normalized sensor features. Each row is scored by the local model.', example: 'aircraft_id,component,observed_at,vibration_rms,thermal_deviation,pressure_drift,response_lag' },
  { type: 'maintenance', title: 'Technical records', description: 'Maintenance actions, agency, record reference, outcome notes, and aircraft/component.', example: 'aircraft_id,component,record_type,performed_at,agency,reference,notes' },
  { type: 'inventory', title: 'Spares inventory', description: 'Part identifiers, stock-on-hand, reorder thresholds, lead time, and store location.', example: 'id,part,part_number,category,on_hand,reorder_point,lead_days,location' },
];

async function renderIntegrations() {
  const integration = await api('/api/integrations');
  const sources = integration.data_sources.map((source) => `<article class="source-card">
    <div class="source-card-top"><span class="source-dot"></span><span class="source-status">${escapeHtml(source.status)}</span></div>
    <strong>${escapeHtml(source.label)}</strong><span class="source-count">${Number(source.records).toLocaleString()} records currently indexed</span>
  </article>`).join('');
  const imports = integration.recent_imports.map((item) => `<tr><td>${escapeHtml(item.import_type)}</td><td>${escapeHtml(item.file_name)}</td><td>${formatDate(item.imported_at.slice(0, 10))}</td><td>${item.accepted_rows}</td><td>${item.rejected_rows}</td></tr>`).join('');
  const cards = importDefinitions.map((definition) => `<article class="panel import-card">
    <div class="import-card-heading"><div><span class="eyebrow">CSV ADAPTER</span><h2>${escapeHtml(definition.title)}</h2></div><button class="table-action" data-action="download-template" data-type="${definition.type}">Download template</button></div>
    <p>${escapeHtml(definition.description)}</p>
    <code class="schema-code">${escapeHtml(definition.example)}</code>
    <label class="file-picker">Choose CSV file<input type="file" accept=".csv,text/csv" data-import-type="${definition.type}"></label>
    <div class="import-result" id="import-result-${definition.type}" aria-live="polite"></div>
  </article>`).join('');
  pageContent.innerHTML = `${pageHeading('DATA MESH · CONNECTIVITY', 'Data integration', 'Import disconnected fleet datasets, preserve provenance, and feed a unified component-health view.', '<span class="demo-pill">CSV CONNECTORS · NO LIVE FEEDS</span>')}
    <div class="integration-banner"><span class="integration-symbol">⇄</span><div><strong>One maintenance picture, four source domains</strong><p>Load approved synthetic or sanitized CSV exports. Aircraft IDs join telemetry, technical records, inventory, and work orders.</p></div></div>
    <div class="source-grid">${sources}</div>
    <div class="integration-limit"><strong>Integration boundary</strong><span>This demonstrator does not connect directly to aircraft, IMMOLS, e-MMS, ERP, or an OEM. CSV imports are the explicit adapter boundary; uploaded source, accepted rows, and rejected-row counts are audited. Sensor features must be normalized from 0 to 1 using an authorized, documented transformation before import.</span></div>
    <div class="import-grid">${cards}</div>
    <section class="panel table-panel import-history"><div class="table-toolbar"><strong>Import audit</strong><span>${integration.recent_imports.length} recent imports</span></div>
      <table class="data-table"><thead><tr><th>Dataset</th><th>File</th><th>Imported</th><th>Accepted</th><th>Rejected</th></tr></thead><tbody>${imports || '<tr><td colspan="5" class="empty-state">No CSV imports yet. Download a template to get started.</td></tr>'}</tbody></table></section>`;
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
      integrations: renderIntegrations,
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
    const [aircraft, agencies, parts] = await Promise.all([
      api('/api/aircraft'),
      api('/api/agencies'),
      api('/api/inventory'),
    ]);
    fleetCache = aircraft;
    document.getElementById('wo-agency').innerHTML = `<option value="">Unassigned</option>${agencies.map((agency) => `<option value="${escapeHtml(agency.id)}">${escapeHtml(agency.name)} · ${escapeHtml(agency.base)}</option>`).join('')}`;
    document.getElementById('wo-spare').innerHTML = `<option value="">No part reservation</option>${parts.map((part) => `<option value="${escapeHtml(part.id)}" ${part.on_hand < 1 ? 'disabled' : ''}>${escapeHtml(part.part)} · ${escapeHtml(part.part_number)} · ${part.on_hand} available</option>`).join('')}`;
  } catch (error) {
    return toast(error.message, true);
  }
  const select = document.getElementById('wo-aircraft');
  select.innerHTML = fleetCache.map((aircraft) => `<option value="${escapeHtml(aircraft.id)}" ${aircraft.id === aircraftId ? 'selected' : ''}>${escapeHtml(aircraft.id)} · ${escapeHtml(aircraft.model)}</option>`).join('');
  document.getElementById('wo-title').value = title;
  document.getElementById('wo-component').value = '';
  document.getElementById('wo-agency').value = '';
  document.getElementById('wo-spare').value = '';
  document.getElementById('wo-quantity').value = '1';
  document.getElementById('wo-notes').value = '';
  document.getElementById('wo-source-alert').value = '';
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
  if (kind === 'order-from-alert') {
    await showWorkOrderDialog(action.dataset.aircraft, `Inspect ${action.dataset.component}`);
    document.getElementById('wo-component').value = action.dataset.component;
    document.getElementById('wo-agency').value = action.dataset.agency;
    document.getElementById('wo-spare').value = action.dataset.part;
    document.getElementById('wo-source-alert').value = action.dataset.alert;
    document.getElementById('wo-priority').value = 'High';
    return;
  }
  if (kind === 'reserve-part') {
    action.disabled = true;
    try {
      await api(`/api/inventory/${encodeURIComponent(action.dataset.id)}/reserve`, { method: 'POST', body: JSON.stringify({ quantity: 1 }) });
      toast('One unit reserved in the local demo inventory.');
      await renderInventory();
    } catch (error) { action.disabled = false; toast(error.message, true); }
  }
  if (kind === 'download-template') {
    const definition = importDefinitions.find((item) => item.type === action.dataset.type);
    if (!definition) return;
    const sample = {
      aircraft: 'AC-DEMO-01,Demo aircraft,Demo squadron,Demo base,Available,10,2026-01-01,90,2026-12-01',
      telemetry: 'AC-104,Hydraulic pump,2026-10-04,0.45,0.38,0.51,0.22',
      maintenance: 'AC-104,Hydraulic pump,Inspection,2026-01-01,Demo agency,DEMO-REF-001,Synthetic example only',
      inventory: 'PART-DEMO-01,Demo component,DEMO-0001,General,4,2,14,Demo stores',
    }[definition.type];
    const blob = new Blob([`${definition.example}\n${sample}\n`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `airpower-${definition.type}-template.csv`;
    link.click();
    URL.revokeObjectURL(url);
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

document.addEventListener('change', async (event) => {
  const input = event.target.closest('[data-import-type]');
  if (!input || !input.files?.length) return;
  const type = input.dataset.importType;
  const file = input.files[0];
  let result;
  const report = (data) => {
    result = document.getElementById(`import-result-${type}`);
    result.className = `import-result${data.rejected_rows ? ' has-errors' : ''}`;
    result.innerHTML = `<strong>${data.accepted_rows} accepted · ${data.duplicate_rows} duplicates · ${data.rejected_rows} rejected</strong>${data.errors.map((item) => `<span>Line ${item.line}: ${escapeHtml(item.error)}</span>`).join('')}${data.error_limit_reached ? '<span>More row errors omitted.</span>' : ''}`;
  };
  result = document.getElementById(`import-result-${type}`);
  result.className = 'import-result pending';
  result.textContent = `Importing ${file.name}…`;
  try {
    const response = await fetch(`/api/import/${type}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/csv', 'X-Filename': file.name },
      body: file,
    });
    const data = await response.json();
    if (!response.ok && response.status !== 422) throw new Error(data.error || `Import failed (${response.status}).`);
    toast(`${type} import finished: ${data.accepted_rows} accepted, ${data.rejected_rows} rejected.`, Boolean(data.rejected_rows && !data.accepted_rows));
    await renderIntegrations();
    report(data);
  } catch (error) {
    result.className = 'import-result has-errors';
    result.textContent = error.message;
    toast(error.message, true);
  } finally {
    if (input.isConnected) input.value = '';
  }
});

document.getElementById('work-order-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const payload = Object.fromEntries(form.entries());
  payload.quantity = Number(payload.quantity);
  payload.source_alert_id = payload.source_alert_id ? Number(payload.source_alert_id) : null;
  if (!payload.inventory_id) payload.inventory_id = null;
  if (!payload.agency_id) payload.agency_id = null;
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
