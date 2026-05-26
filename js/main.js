const state = {
  data: [],
  filtered: [],
  map: null,
  clusterGroup: null,
  heatLayer: null,
  charts: {},
  sortKey: 'acq_date',
  sortAsc: false,
};

const SATELLITE_COLORS = {
  NPP: '#f59e0b', NOAA20: '#3b82f6', NOAA21: '#22c55e',
  Terra: '#ef4444', Aqua: '#a855f7',
};

const SATELLITE_LABELS = {
  NPP: 'NPP (VIIRS)', NOAA20: 'NOAA-20', NOAA21: 'NOAA-21',
  Terra: 'Terra (MODIS)', Aqua: 'Aqua (MODIS)',
};

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function formatTime(t) {
  if (!t) return '—';
  const s = t.toString().padStart(4, '0');
  return `${s.slice(0,2)}:${s.slice(2)}`;
}

function getConfidenceLabel(val) {
  if (val >= 80) return 'High';
  if (val >= 40) return 'Nominal';
  return 'Low';
}

function getConfidenceColor(val) {
  if (val >= 80) return '#22c55e';
  if (val >= 40) return '#f59e0b';
  return '#ef4444';
}

async function loadData() {
  const resp = await fetch('data/myanmar_fires.geojson');
  const geojson = await resp.json();
  state.data = geojson.features;
}

function getFilteredData() {
  const dateStart = document.getElementById('filterDateStart').value;
  const dateEnd = document.getElementById('filterDateEnd').value;
  const minConf = parseInt(document.getElementById('filterConfidence').value);
  const dayNight = document.getElementById('filterDayNight').value;
  const checkedSats = [...document.querySelectorAll('#satelliteFilters input:checked')].map(c => c.value);

  return state.data.filter(f => {
    const p = f.properties;
    if (dateStart && p.acq_date < dateStart) return false;
    if (dateEnd && p.acq_date > dateEnd) return false;
    if (p.confidence < minConf) return false;
    if (dayNight !== 'all' && p.daynight !== dayNight) return false;
    if (!checkedSats.includes(p.satellite)) return false;
    return true;
  });
}

function setDateRange() {
  const dates = state.data.map(f => f.properties.acq_date).sort();
  document.getElementById('filterDateStart').value = dates[0];
  document.getElementById('filterDateEnd').value = dates[dates.length - 1];
}

function updateStats() {
  const d = state.filtered;
  const total = d.length;
  const today = new Date().toISOString().slice(0,10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0,10);
  const last24h = d.filter(f => f.properties.acq_date === today || f.properties.acq_date === yesterday).length;
  const avgConf = total ? Math.round(d.reduce((s, f) => s + f.properties.confidence, 0) / total) : 0;
  const avgFRP = total ? (d.reduce((s, f) => s + f.properties.frp, 0) / total).toFixed(1) : '0.0';
  const sats = new Set(d.map(f => f.properties.satellite)).size;
  const day = d.filter(f => f.properties.daynight === 'D').length;
  const night = d.filter(f => f.properties.daynight === 'N').length;

  document.getElementById('statTotal').textContent = total.toLocaleString();
  document.getElementById('statLast24h').textContent = last24h;
  document.getElementById('statAvgConf').textContent = avgConf + '%';
  document.getElementById('statAvgFRP').textContent = avgFRP;
  document.getElementById('statSatellites').textContent = sats;
  document.getElementById('statDayNight').textContent = `${day} / ${night}`;
  document.getElementById('lastUpdated').textContent = `Updated: ${formatDate(new Date().toISOString().slice(0,10))}`;
}

function updateMap() {
  const viewMode = document.querySelector('.map-btn.active')?.dataset.layer || 'clusters';

  if (state.clusterGroup) state.map.removeLayer(state.clusterGroup);
  if (state.heatLayer) state.map.removeLayer(state.heatLayer);

  const markers = L.markerClusterGroup({
    chunkedLoading: true,
    maxClusterRadius: 50,
    spiderfyOnMaxZoom: true,
    disableClusteringAtZoom: 15,
  });

  const heatPoints = [];

  state.filtered.forEach(f => {
    const p = f.properties;
    const lat = p.latitude, lng = p.longitude;

    if (viewMode === 'heatmap' || viewMode === 'both') {
      heatPoints.push([lat, lng, Math.min(p.frp / 100, 1)]);
    }

    if (viewMode === 'clusters' || viewMode === 'both') {
      const icon = L.divIcon({
        className: 'fire-marker',
        html: `<div style="width:10px;height:10px;border-radius:50%;background:${getConfidenceColor(p.confidence)};border:2px solid #fff;box-shadow:0 0 4px rgba(0,0,0,.5);"></div>`,
        iconSize: [10, 10],
        iconAnchor: [5, 5],
      });

      const marker = L.marker([lat, lng], { icon });
      const popupHtml = `
        <div class="popup-content">
          <b>Date:</b> ${formatDate(p.acq_date)} ${formatTime(p.acq_time)}<br>
          <b>Location:</b> ${lat.toFixed(4)}, ${lng.toFixed(4)}<br>
          <b>Satellite:</b> ${SATELLITE_LABELS[p.satellite] || p.satellite}<br>
          <b>Confidence:</b> <span style="color:${getConfidenceColor(p.confidence)}">${getConfidenceLabel(p.confidence)}</span> (${p.confidence}%)<br>
          <b>FRP:</b> ${p.frp.toFixed(1)} MW<br>
          <b>Brightness:</b> ${p.brightness.toFixed(1)} K<br>
          <b>Day/Night:</b> ${p.daynight === 'D' ? '☀️ Day' : '🌙 Night'}
        </div>`;
      marker.bindPopup(popupHtml);
      markers.addLayer(marker);
    }
  });

  if (viewMode === 'clusters' || viewMode === 'both') {
    state.map.addLayer(markers);
    state.clusterGroup = markers;
  }

  if (viewMode === 'heatmap' || viewMode === 'both') {
    if (heatPoints.length) {
      state.heatLayer = L.heatLayer(heatPoints, {
        radius: 25,
        blur: 15,
        maxZoom: 10,
        max: 1,
        gradient: { 0.4: 'blue', 0.6: 'lime', 0.8: 'yellow', 1.0: 'red' },
      });
      state.map.addLayer(state.heatLayer);
    }
  }
}

function updateDailyChart() {
  const ctx = document.getElementById('dailyChart').getContext('2d');
  if (state.charts.daily) state.charts.daily.destroy();

  const counts = {};
  state.filtered.forEach(f => {
    counts[f.properties.acq_date] = (counts[f.properties.acq_date] || 0) + 1;
  });
  const sorted = Object.entries(counts).sort((a, b) => a[0].localeCompare(b[0]));
  const labels = sorted.map(([d]) => formatDate(d));
  const values = sorted.map(([, v]) => v);

  state.charts.daily = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Fire Count',
        data: values,
        backgroundColor: '#f59e0b',
        borderColor: '#f59e0b',
        borderWidth: 1,
        borderRadius: 3,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#94a3b8', font: { size: 10 } }, grid: { color: '#334155' } },
        y: { ticks: { color: '#94a3b8', font: { size: 10 }, stepSize: 1 }, grid: { color: '#334155' }, beginAtZero: true },
      },
    },
  });
}

function updateConfidenceChart() {
  const ctx = document.getElementById('confidenceChart').getContext('2d');
  if (state.charts.confidence) state.charts.confidence.destroy();

  let low = 0, nominal = 0, high = 0;
  state.filtered.forEach(f => {
    const c = f.properties.confidence;
    if (c >= 80) high++;
    else if (c >= 40) nominal++;
    else low++;
  });

  state.charts.confidence = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Low (<40)', 'Nominal (40-79)', 'High (80+)'],
      datasets: [{
        data: [low, nominal, high],
        backgroundColor: ['#ef4444', '#f59e0b', '#22c55e'],
        borderWidth: 0,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { color: '#94a3b8', font: { size: 10 }, padding: 10 } },
      },
    },
  });
}

function updateTrendChart() {
  const ctx = document.getElementById('trendChart').getContext('2d');
  if (state.charts.trend) state.charts.trend.destroy();

  const dailyData = {};
  state.filtered.forEach(f => {
    const d = f.properties.acq_date;
    if (!dailyData[d]) dailyData[d] = { count: 0, totalFRP: 0 };
    dailyData[d].count++;
    dailyData[d].totalFRP += f.properties.frp;
  });
  const sorted = Object.entries(dailyData).sort((a, b) => a[0].localeCompare(b[0]));
  const labels = sorted.map(([d]) => formatDate(d));
  const counts = sorted.map(([, v]) => v.count);
  const frpVals = sorted.map(([, v]) => +v.totalFRP.toFixed(1));

  state.charts.trend = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Fire Count',
          data: counts,
          borderColor: '#f59e0b',
          backgroundColor: 'rgba(245,158,11,0.1)',
          borderWidth: 2,
          pointRadius: 4,
          pointBackgroundColor: '#f59e0b',
          fill: true,
          yAxisID: 'y',
        },
        {
          label: 'Total FRP (MW)',
          data: frpVals,
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59,130,246,0.1)',
          borderWidth: 2,
          pointRadius: 4,
          pointBackgroundColor: '#3b82f6',
          fill: true,
          yAxisID: 'y1',
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: '#94a3b8', font: { size: 10 }, padding: 12 } },
      },
      scales: {
        x: { ticks: { color: '#94a3b8', font: { size: 10 } }, grid: { color: '#334155' } },
        y: {
          type: 'linear', display: true, position: 'left',
          ticks: { color: '#94a3b8', font: { size: 10 } },
          grid: { color: '#334155' },
          beginAtZero: true,
        },
        y1: {
          type: 'linear', display: true, position: 'right',
          ticks: { color: '#94a3b8', font: { size: 10 } },
          grid: { drawOnChartArea: false },
          beginAtZero: true,
        },
      },
    },
  });
}

function renderTable() {
  const tbody = document.getElementById('tableBody');
  document.getElementById('tableCount').textContent = `(${state.filtered.length} events)`;

  const sorted = [...state.filtered].sort((a, b) => {
    const va = a.properties[state.sortKey];
    const vb = b.properties[state.sortKey];
    if (typeof va === 'number') return state.sortAsc ? va - vb : vb - va;
    return state.sortAsc ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
  });

  tbody.innerHTML = sorted.map(f => {
    const p = f.properties;
    return `<tr>
      <td>${formatDate(p.acq_date)}</td>
      <td>${formatTime(p.acq_time)}</td>
      <td>${p.latitude.toFixed(4)}</td>
      <td>${p.longitude.toFixed(4)}</td>
      <td><span style="color:${SATELLITE_COLORS[p.satellite] || '#fff'}">${SATELLITE_LABELS[p.satellite] || p.satellite}</span></td>
      <td><span style="color:${getConfidenceColor(p.confidence)}">${getConfidenceLabel(p.confidence)}</span> (${p.confidence}%)</td>
      <td>${p.frp.toFixed(1)}</td>
      <td>${p.brightness.toFixed(1)}</td>
      <td>${p.daynight === 'D' ? 'Day' : 'Night'}</td>
    </tr>`;
  }).join('');
}

function applyFilters() {
  state.filtered = getFilteredData();
  updateStats();
  updateMap();
  updateDailyChart();
  updateConfidenceChart();
  updateTrendChart();
  renderTable();
}

function initMap() {
  state.map = L.map('map', {
    center: [20.5, 96.5],
    zoom: 6,
    zoomControl: true,
  });

  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 19,
  }).addTo(state.map);

  L.control.scale({ position: 'bottomleft', metric: true }).addTo(state.map);
}

function initCharts() {
  Chart.defaults.color = '#94a3b8';
  Chart.defaults.font.family = "'Segoe UI', system-ui, sans-serif";
}

function initEvents() {
  document.getElementById('filterDateStart').addEventListener('change', applyFilters);
  document.getElementById('filterDateEnd').addEventListener('change', applyFilters);
  document.getElementById('filterConfidence').addEventListener('input', (e) => {
    document.getElementById('confidenceLabel').textContent = e.target.value + '%';
    applyFilters();
  });
  document.getElementById('filterDayNight').addEventListener('change', applyFilters);
  document.querySelectorAll('#satelliteFilters input').forEach(cb => cb.addEventListener('change', applyFilters));

  document.querySelectorAll('.map-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.map-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      applyFilters();
    });
  });

  document.getElementById('resetFilters').addEventListener('click', () => {
    setDateRange();
    document.getElementById('filterConfidence').value = 0;
    document.getElementById('confidenceLabel').textContent = '0%';
    document.getElementById('filterDayNight').value = 'all';
    document.querySelectorAll('#satelliteFilters input').forEach(cb => cb.checked = true);
    applyFilters();
  });

  document.querySelectorAll('#dataTable th').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (state.sortKey === key) state.sortAsc = !state.sortAsc;
      else { state.sortKey = key; state.sortAsc = true; }
      document.querySelectorAll('#dataTable th').forEach(h => { h.classList.remove('sort-asc', 'sort-desc'); });
      th.classList.add(state.sortAsc ? 'sort-asc' : 'sort-desc');
      renderTable();
    });
  });
}

async function init() {
  await loadData();
  setDateRange();
  initMap();
  initCharts();
  initEvents();
  applyFilters();
  setTimeout(() => state.map.invalidateSize(), 200);
}

document.addEventListener('DOMContentLoaded', init);
