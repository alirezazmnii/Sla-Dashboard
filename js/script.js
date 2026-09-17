const DATA_URL = 'data/data.json';

let DATA = null;
let currentCategory = 'all';
let currentPeriod = 'all';
let charts = {}; // canvasId -> Chart instance

const CATEGORY_LABELS = { all: 'همه', freelancer: 'Freelancer', center_issue: 'Center Issue' };
const CHANGE_LIST_LIMIT = 20;
const WEEKS_PER_MONTH = 4;

function cssVar(name){
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function chartPalette(){
  return [
    cssVar('--accent') || '#00B4FF',
    cssVar('--accent-deep') || '#1656F5',
    cssVar('--good') || '#1FA971',
    cssVar('--warn') || '#E08A17',
    cssVar('--danger') || '#E0453F',
    cssVar('--violet') || '#7C5CE0',
    '#4FC3E8', '#E0A5D8', '#8FD16B', '#E0C05C'
  ];
}

async function loadData(){
  try{
    const res = await fetch(DATA_URL, { cache: 'no-store' });
    if(!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  }catch(err){
    document.querySelector('main').insertAdjacentHTML('afterbegin',
      `<div class="error-banner">خطا در بارگذاری داده‌ها (${err.message}). فایل data/data.json را بررسی کنید.</div>`);
    throw err;
  }
}

function renderMeta(data){
  const updated = data.generated_at
    ? new Date(data.generated_at).toLocaleString('fa-IR')
    : new Date().toLocaleDateString('fa-IR');
  document.getElementById('meta-updated').textContent = 'به‌روزرسانی: ' + updated;
}

function filteredOperators(){
  if(currentCategory === 'all') return DATA.operators;
  return DATA.operators.filter(o => o.category === currentCategory);
}

// ---------- Report period (weekly / monthly / all) ----------
function totalWeeksAvailable(){
  return (DATA.operators || []).reduce((max,o)=>Math.max(max, (o.weeks||[]).length), 0);
}

function setupPeriodSelector(){
  const numWeeks = totalWeeksAvailable();
  const sel = document.getElementById('periodSelect');
  const prev = sel.value || currentPeriod;
  let html = '<option value="all">کل بازه</option>';
  for(let w = 0; w < numWeeks; w++){
    html += `<option value="week:${w}">هفته ${w+1}</option>`;
  }
  const numMonths = Math.ceil(numWeeks / WEEKS_PER_MONTH);
  for(let m = 0; m < numMonths; m++){
    const start = m * WEEKS_PER_MONTH;
    const end = Math.min(start + WEEKS_PER_MONTH, numWeeks);
    html += `<option value="month:${m}">ماه ${m+1} (هفته ${start+1} تا ${end})</option>`;
  }
  sel.innerHTML = html;
  sel.value = prev;
  if(sel.value !== prev) sel.value = 'all'; // previous selection no longer valid (e.g. fewer weeks)
  currentPeriod = sel.value;
}

function periodWeekIndices(period, numWeeks){
  if(period === 'all' || !period) return Array.from({length: numWeeks}, (_,i)=>i);
  if(period.startsWith('week:')){
    return [parseInt(period.split(':')[1], 10)];
  }
  if(period.startsWith('month:')){
    const m = parseInt(period.split(':')[1], 10);
    const start = m * WEEKS_PER_MONTH;
    const end = Math.min(start + WEEKS_PER_MONTH, numWeeks);
    return Array.from({length: Math.max(0, end - start)}, (_,i)=>start+i);
  }
  return Array.from({length: numWeeks}, (_,i)=>i);
}

function operatorMetricsForWeeks(o, indices){
  const wks = o.weeks || [];
  const selected = indices.map(i=>wks[i]).filter(Boolean);
  const orders = selected.reduce((s,w)=>s+(w.orders||0),0);
  const avgScore = selected.length ? selected.reduce((s,w)=>s+(w.avg||0),0) / selected.length : 0;
  const oct = selected.length ? selected.reduce((s,w)=>s+(w.oct||0),0) / selected.length : 0;
  return { orders, avgScore, oct };
}

// Operators for the currently selected category AND report period, with
// total_orders/avg_score recomputed for just that period (everything else
// — salary, bug info, lead, company — is unaffected by the period).
function periodOperators(){
  const numWeeks = totalWeeksAvailable();
  const indices = periodWeekIndices(currentPeriod, numWeeks);
  return filteredOperators().map(o => {
    const m = operatorMetricsForWeeks(o, indices);
    return { ...o, total_orders: m.orders, avg_score: +m.avgScore.toFixed(2), _oct: m.oct };
  });
}

// ---------- Client-side aggregation (category-aware) ----------
function opAvgOct(o){
  const wks = o.weeks || [];
  return wks.length ? wks.reduce((s,w)=>s+(w.oct||0),0) / wks.length : 0;
}

function aggregateByLead(operators){
  const leads = [...new Set(operators.map(o=>o.lead).filter(Boolean))].sort();
  return leads.map(lead => {
    const subset = operators.filter(o=>o.lead===lead);
    const count = subset.length;
    const totalOrders = subset.reduce((s,o)=>s+(o.total_orders||0),0);
    const avgScore = count ? subset.reduce((s,o)=>s+(o.avg_score||0),0)/count : 0;
    const avgOct = count ? subset.reduce((s,o)=>s+(o._oct != null ? o._oct : opAvgOct(o)),0)/count : 0;
    const totalSalary = subset.reduce((s,o)=>s+(o.salary||0),0);
    const totalBugCount = subset.reduce((s,o)=>s+(o.bug_count||0),0);
    const totalBugPrice = subset.reduce((s,o)=>s+(o.bug_price||0),0);
    return { lead, count, totalOrders, avgOct, avgScore, totalSalary, totalBugCount, totalBugPrice };
  });
}

function aggregateByCompany(operators){
  const companies = [...new Set(operators.map(o=>o.company).filter(Boolean))].sort();
  return companies.map(company => {
    const subset = operators.filter(o=>o.company===company);
    const count = subset.length;
    const totalOrders = subset.reduce((s,o)=>s+(o.total_orders||0),0);
    const avgScore = count ? subset.reduce((s,o)=>s+(o.avg_score||0),0)/count : 0;
    const totalSalary = subset.reduce((s,o)=>s+(o.salary||0),0);
    return { company, count, totalOrders, avgScore, totalSalary };
  });
}

// ---------- KPIs ----------
function renderKPIs(){
  const operators = periodOperators();
  const totalOperators = operators.length;
  const totalOrders = operators.reduce((s,o)=>s+(o.total_orders||0),0);
  const avgScore = totalOperators ? (operators.reduce((s,o)=>s+(o.avg_score||0),0)/totalOperators) : 0;
  const totalSalary = operators.reduce((s,o)=>s+(o.salary||0),0);
  const totalBugCount = operators.reduce((s,o)=>s+(o.bug_count||0),0);
  const totalBugPrice = operators.reduce((s,o)=>s+(o.bug_price||0),0);

  const kpis = [
    {label:'تعداد کل اپراتورها', value: totalOperators.toLocaleString('en-US')},
    {label:'مجموع سفارشات', value: totalOrders.toLocaleString('en-US')},
    {label:'میانگین امتیاز کلی', value: avgScore.toFixed(2) + ' <small>از ۵</small>'},
    {label:'مجموع حقوق (Total Salary)', value: totalSalary.toLocaleString('en-US')},
    {label:'باگ‌های ثبت‌شده', value: totalBugCount.toLocaleString('en-US'), danger: totalBugCount > 0},
    {label:'مجموع مبلغ باگ‌ها', value: totalBugPrice.toLocaleString('en-US'), danger: totalBugPrice > 0},
  ];
  document.getElementById('kpi-row').innerHTML = kpis.map(k => `
    <div class="kpi${k.danger ? ' kpi-danger' : ''}">
      <div class="label">${k.label}</div>
      <div class="value num">${k.value}</div>
    </div>
  `).join('');
}

// ---------- Charts ----------
function destroyChart(id){
  if(charts[id]){ charts[id].destroy(); delete charts[id]; }
}

function barChart(id, labels, values, color, horizontal=false){
  destroyChart(id);
  const ctx = document.getElementById(id);
  charts[id] = new Chart(ctx, {
    type:'bar',
    data:{ labels, datasets:[{ data:values, backgroundColor:color, borderRadius:6, maxBarThickness:28 }] },
    options:{
      indexAxis: horizontal ? 'y' : 'x',
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{display:false} },
      scales:{
        x:{ grid:{display: horizontal}, ticks:{font:{size:11}} },
        y:{ grid:{display: !horizontal, color: cssVar('--line')}, ticks:{font:{size:11}}, beginAtZero:true }
      }
    }
  });
}

function renderCharts(){
  Chart.defaults.font.family = "'IRANSans', 'Vazirmatn', sans-serif";
  Chart.defaults.color = cssVar('--ink-soft') || '#8B93A1';
  Chart.defaults.borderColor = cssVar('--line') || '#262B33';

  const operators = periodOperators();
  const teamLeads = aggregateByLead(operators);
  const companies = aggregateByCompany(operators);

  barChart('chartScore', teamLeads.map(t=>t.lead), teamLeads.map(t=>+t.avgScore.toFixed(2)), cssVar('--good'));
  barChart('chartOrders', teamLeads.map(t=>t.lead), teamLeads.map(t=>t.totalOrders), cssVar('--accent'));
  barChart('chartOct', teamLeads.map(t=>t.lead), teamLeads.map(t=>+t.avgOct.toFixed(1)), cssVar('--warn'));
  barChart('chartSalary', teamLeads.map(t=>t.lead), teamLeads.map(t=>t.totalSalary), cssVar('--violet'));

  destroyChart('chartCompany');
  charts['chartCompany'] = new Chart(document.getElementById('chartCompany'), {
    type:'doughnut',
    data:{
      labels: companies.map(c=>c.company),
      datasets:[{
        data: companies.map(c=>c.count),
        backgroundColor: chartPalette(),
        borderColor: cssVar('--surface') || 'transparent', borderWidth:2
      }]
    },
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{ position:'right', labels:{ boxWidth:10, font:{size:10.5}, color: cssVar('--ink-soft') } } }
    }
  });

  destroyChart('chartBugs');
  const bugLeads = teamLeads.filter(t=>t.totalBugPrice > 0);
  const bugWrap = document.getElementById('chartBugs').parentElement;
  const oldBugNote = bugWrap.querySelector('.bugs-note');
  if(oldBugNote) oldBugNote.remove();
  if(!bugLeads.length){
    bugWrap.insertAdjacentHTML('beforeend',
      '<div class="bugs-note" style="color:var(--ink-faint);font-size:13px;padding:12px 0;">باگی با مبلغ ثبت‌شده در این بازه وجود نداره.</div>');
  } else {
    charts['chartBugs'] = new Chart(document.getElementById('chartBugs'), {
      type:'doughnut',
      data:{
        labels: bugLeads.map(t=>t.lead),
        datasets:[{
          data: bugLeads.map(t=>t.totalBugPrice),
          backgroundColor: chartPalette(),
          borderColor: cssVar('--surface') || 'transparent', borderWidth:2
        }]
      },
      options:{
        responsive:true, maintainAspectRatio:false,
        plugins:{ legend:{ position:'right', labels:{ boxWidth:10, font:{size:10.5}, color: cssVar('--ink-soft') } } }
      }
    });
  }

  renderTrendChart();
}

function renderTrendChart(){
  const operators = filteredOperators();
  const wrap = document.getElementById('chartTrend').parentElement;
  const oldNote = wrap.querySelector('.trend-note');
  if(oldNote) oldNote.remove();

  const leads = [...new Set(operators.map(o=>o.lead))].filter(Boolean).sort();
  const numWeeks = operators.reduce((max,o)=>Math.max(max, (o.weeks||[]).length), 0);

  if(!leads.length || !numWeeks){
    destroyChart('chartTrend');
    wrap.insertAdjacentHTML('beforeend',
      '<div class="trend-note" style="color:var(--ink-faint);font-size:13px;padding:12px 0;">داده‌ای برای نمایش وجود نداره.</div>');
    return;
  }

  const labels = Array.from({length: numWeeks}, (_, i) => 'هفته ' + (i + 1));
  const palette = chartPalette();

  const datasets = leads.map((lead, i) => {
    const subset = operators.filter(o => o.lead === lead);
    const count = subset.length;
    const data = [];
    for(let w = 0; w < numWeeks; w++){
      const avg = count ? subset.reduce((s,o)=>s+(((o.weeks||[])[w] && o.weeks[w].avg) || 0),0) / count : 0;
      data.push(+avg.toFixed(2));
    }
    return {
      label: lead,
      data,
      borderColor: palette[i % palette.length],
      backgroundColor: palette[i % palette.length],
      spanGaps: true,
      tension: 0.3,
      pointRadius: 4,
      borderWidth: 2,
    };
  });

  destroyChart('chartTrend');
  charts['chartTrend'] = new Chart(document.getElementById('chartTrend'), {
    type:'line',
    data:{ labels, datasets },
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{ position:'bottom', labels:{ boxWidth:10, font:{size:10.5}, color: cssVar('--ink-soft') } } },
      scales:{
        x:{ grid:{color: cssVar('--line')}, ticks:{font:{size:11}} },
        y:{ grid:{color: cssVar('--line')}, ticks:{font:{size:11}}, suggestedMin:0, suggestedMax:5 }
      }
    }
  });
}

// ---------- Week-over-week change lists ----------
// invert=true means "lower is better" (used for OCT — less time per order is a win)
function fmtDelta(v, digits, invert){
  if(!isFinite(v)) v = 0;
  const s = (v > 0 ? '+' : '') + v.toFixed(digits);
  const isGood = invert ? v < 0 : v > 0;
  const isBad = invert ? v > 0 : v < 0;
  const color = isGood ? cssVar('--good') : (isBad ? cssVar('--danger') : 'var(--ink-faint)');
  return `<span style="color:${color}">${s}</span>`;
}

function changeMagnitude(dScore, dOct, dOrders){
  // weighted so score change (the main KPI) dominates the ranking,
  // while still letting big OCT/order swings surface
  return Math.abs(dScore) * 2 + Math.abs(dOct) / 10 + Math.abs(dOrders) / 100;
}

function setupChangeFilters(){
  const operators = filteredOperators();
  const leads = [...new Set(operators.map(o=>o.lead))].filter(Boolean).sort();
  ['opChangeLeadFilter','leadChangeLeadFilter'].forEach(id=>{
    const sel = document.getElementById(id);
    const prev = sel.value;
    sel.innerHTML = '<option value="">همه سرگروه‌ها</option>' +
      leads.map(l=>`<option value="${l}">${l}</option>`).join('');
    if(leads.includes(prev)) sel.value = prev;
  });
}

function renderOperatorChangeList(){
  const leadFilter = document.getElementById('opChangeLeadFilter').value;
  let operators = filteredOperators();
  if(leadFilter) operators = operators.filter(o=>o.lead===leadFilter);

  const withDelta = operators.map(o=>{
    const wks = o.weeks || [];
    const prev = wks.length >= 2 ? wks[wks.length - 2] : null;
    const curr = wks.length >= 1 ? wks[wks.length - 1] : null;
    const ordersPrev = prev ? prev.orders : 0, ordersCurr = curr ? curr.orders : 0;
    const octPrev = prev ? prev.oct : 0, octCurr = curr ? curr.oct : 0;
    const avgPrev = prev ? prev.avg : 0, avgCurr = curr ? curr.avg : 0;
    const dOrders = ordersCurr - ordersPrev;
    const dOct = octCurr - octPrev;
    const dScore = avgCurr - avgPrev;
    return { ...o, ordersPrev, ordersCurr, octPrev, octCurr, avgPrev, avgCurr,
      dOrders, dOct, dScore, magnitude: changeMagnitude(dScore, dOct, dOrders) };
  });
  withDelta.sort((a,b)=> b.magnitude - a.magnitude);
  const rows = withDelta.slice(0, CHANGE_LIST_LIMIT);

  document.getElementById('opChangeCount').textContent =
    rows.length.toLocaleString('en-US') + ' از ' + withDelta.length.toLocaleString('en-US') + ' اپراتور';

  document.getElementById('opChangeBody').innerHTML = rows.map(o => `
    <tr>
      <td>${o.name}</td>
      <td>${o.lead || ''}</td>
      <td class="num">${(o.ordersPrev||0).toLocaleString('en-US')} ← ${(o.ordersCurr||0).toLocaleString('en-US')}</td>
      <td class="num">${fmtDelta(o.dOrders, 0)}</td>
      <td class="num">${(o.octPrev||0).toLocaleString('en-US')} ← ${(o.octCurr||0).toLocaleString('en-US')}</td>
      <td class="num">${fmtDelta(o.dOct, 1, true)}</td>
      <td class="num">${(o.avgPrev||0).toFixed(1)} ← ${(o.avgCurr||0).toFixed(1)}</td>
      <td class="num">${fmtDelta(o.dScore, 2)}</td>
    </tr>`).join('');
}

function renderLeadChangeList(){
  const leadFilterVal = document.getElementById('leadChangeLeadFilter').value;
  const operators = filteredOperators();
  const allLeads = [...new Set(operators.map(o=>o.lead))].filter(Boolean).sort();
  const targetLeads = leadFilterVal ? allLeads.filter(l=>l===leadFilterVal) : allLeads;

  const rows = targetLeads.map(lead => {
    const subset = operators.filter(o=>o.lead===lead);
    const count = subset.length;
    const weekAvg = (weekIndexFromEnd, field) => {
      if(!count) return 0;
      const vals = subset.map(o=>{
        const wks = o.weeks || [];
        const w = wks[wks.length - weekIndexFromEnd];
        return w ? (w[field]||0) : 0;
      });
      return vals.reduce((a,b)=>a+b,0) / count;
    };
    const ordersPrev = subset.reduce((s,o)=>{
      const wks = o.weeks || []; const w = wks[wks.length-2];
      return s + (w ? (w.orders||0) : 0);
    }, 0);
    const ordersCurr = subset.reduce((s,o)=>{
      const wks = o.weeks || []; const w = wks[wks.length-1];
      return s + (w ? (w.orders||0) : 0);
    }, 0);
    const octPrev = weekAvg(2, 'oct'), octCurr = weekAvg(1, 'oct');
    const avgPrev = weekAvg(2, 'avg'), avgCurr = weekAvg(1, 'avg');
    const dOrders = ordersCurr - ordersPrev, dOct = octCurr - octPrev, dScore = avgCurr - avgPrev;
    return { lead, count, ordersPrev, ordersCurr, octPrev, octCurr, avgPrev, avgCurr, dOrders, dOct, dScore,
      magnitude: changeMagnitude(dScore, dOct, dOrders) };
  });
  rows.sort((a,b)=> b.magnitude - a.magnitude);
  const limited = rows.slice(0, CHANGE_LIST_LIMIT);

  document.getElementById('leadChangeCount').textContent =
    limited.length.toLocaleString('en-US') + ' از ' + rows.length.toLocaleString('en-US') + ' سرگروه';

  document.getElementById('leadChangeBody').innerHTML = limited.map(r => `
    <tr>
      <td>${r.lead}</td>
      <td class="num">${r.count.toLocaleString('en-US')}</td>
      <td class="num">${(r.ordersPrev||0).toLocaleString('en-US')} ← ${(r.ordersCurr||0).toLocaleString('en-US')}</td>
      <td class="num">${fmtDelta(r.dOrders, 0)}</td>
      <td class="num">${(r.octPrev||0).toFixed(1)} ← ${(r.octCurr||0).toFixed(1)}</td>
      <td class="num">${fmtDelta(r.dOct, 1, true)}</td>
      <td class="num">${(r.avgPrev||0).toFixed(2)} ← ${(r.avgCurr||0).toFixed(2)}</td>
      <td class="num">${fmtDelta(r.dScore, 2)}</td>
    </tr>`).join('');
}

function wireChangeListEvents(){
  document.getElementById('opChangeLeadFilter').addEventListener('change', renderOperatorChangeList);
  document.getElementById('leadChangeLeadFilter').addEventListener('change', renderLeadChangeList);
}

// ---------- Operators table ----------
function scoreColor(score){
  if(score >= 4) return {bg:'var(--good-soft)', fg:cssVar('--good')};
  if(score >= 2.5) return {bg:'var(--warn-soft)', fg:cssVar('--warn')};
  return {bg:'var(--danger-soft)', fg:cssVar('--danger')};
}

// Risk color scaled relative to the worst value currently on screen, so it
// stays meaningful regardless of the absolute numbers in the sheet.
function bugRiskColor(count, price, maxCount, maxPrice){
  const ratio = Math.max(maxCount ? count / maxCount : 0, maxPrice ? price / maxPrice : 0);
  if(ratio <= 0) return {bg:'transparent', fg:'var(--ink-faint)'};
  if(ratio < 0.34) return {bg:'var(--warn-soft)', fg:cssVar('--warn')};
  return {bg:'var(--danger-soft)', fg:cssVar('--danger')};
}

function setupTableControls(){
  const leadFilter = document.getElementById('leadFilter');
  const shiftFilter = document.getElementById('shiftFilter');
  leadFilter.innerHTML = '<option value="">همه سرگروه‌ها</option>';
  shiftFilter.innerHTML = '<option value="">همه شیفت‌ها</option>';

  const operators = filteredOperators();
  const uniqueLeads = [...new Set(operators.map(o=>o.lead))].filter(Boolean).sort();
  leadFilter.innerHTML += uniqueLeads.map(l=>`<option value="${l}">${l}</option>`).join('');

  const shiftCounts = {};
  operators.forEach(o => { if(o.shift) shiftCounts[o.shift] = (shiftCounts[o.shift]||0) + 1; });
  shiftFilter.innerHTML = `<option value="">همه شیفت‌ها (${operators.length.toLocaleString('en-US')})</option>` +
    Object.keys(shiftCounts).sort().map(s => `<option value="${s}">${s} (${shiftCounts[s].toLocaleString('en-US')})</option>`).join('');
}

let sortKey = 'avg_score', sortDir = 1;

function renderTable(){
  const tbody = document.getElementById('opsBody');
  const searchBox = document.getElementById('searchBox');
  const leadFilter = document.getElementById('leadFilter');
  const shiftFilter = document.getElementById('shiftFilter');
  const scoreMin = document.getElementById('scoreMin');
  const scoreMax = document.getElementById('scoreMax');
  const rowCount = document.getElementById('rowCount');

  const q = searchBox.value.trim();
  const lead = leadFilter.value;
  const shift = shiftFilter.value;
  const min = scoreMin.value !== '' ? parseFloat(scoreMin.value) : -Infinity;
  const max = scoreMax.value !== '' ? parseFloat(scoreMax.value) : Infinity;

  let rows = periodOperators().filter(o =>
    (!q || o.name.includes(q)) &&
    (!lead || o.lead === lead) &&
    (!shift || o.shift === shift) &&
    (o.avg_score >= min && o.avg_score <= max)
  );
  rows.sort((a,b)=>{
    let va = a[sortKey], vb = b[sortKey];
    if(typeof va === 'string') return va.localeCompare(vb,'fa') * sortDir;
    return ((va||0) - (vb||0)) * sortDir;
  });
  rowCount.textContent = rows.length.toLocaleString('en-US') + ' اپراتور';
  const maxBugCount = rows.reduce((m,o)=>Math.max(m, o.bug_count||0), 0);
  const maxBugPrice = rows.reduce((m,o)=>Math.max(m, o.bug_price||0), 0);
  tbody.innerHTML = rows.map(o => {
    const sc = scoreColor(o.avg_score);
    const bc = bugRiskColor(o.bug_count||0, o.bug_price||0, maxBugCount, maxBugPrice);
    return `<tr>
      <td>${o.name}</td>
      <td>${o.company}</td>
      <td>${o.lead}</td>
      <td>${o.shift}</td>
      <td class="num">${(o.total_orders||0).toLocaleString('en-US')}</td>
      <td><span class="score-pill num" style="background:${sc.bg};color:${sc.fg}">${o.avg_score.toFixed(2)}</span></td>
      <td class="num">${(o.salary||0).toLocaleString('en-US')}</td>
      <td class="num"><span class="score-pill num" style="background:${bc.bg};color:${bc.fg}">${(o.bug_count||0).toLocaleString('en-US')}</span></td>
      <td class="num"><span class="score-pill num" style="background:${bc.bg};color:${bc.fg}">${(o.bug_price||0).toLocaleString('en-US')}</span></td>
    </tr>`;
  }).join('');
}

function wireTableEvents(){
  document.querySelectorAll('table.ops thead th').forEach(th=>{
    th.addEventListener('click', ()=>{
      const key = th.dataset.key;
      if(sortKey === key){ sortDir *= -1; } else { sortKey = key; sortDir = 1; }
      document.querySelectorAll('table.ops thead th .arrow').forEach(a=>a.remove());
      th.innerHTML += `<span class="arrow">${sortDir===1?'▲':'▼'}</span>`;
      renderTable();
    });
  });
  ['searchBox','leadFilter','shiftFilter','scoreMin','scoreMax'].forEach(id=>{
    document.getElementById(id).addEventListener('input', renderTable);
  });
}

// ---------- Category switch ----------
function renderAll(){
  renderKPIs();
  renderCharts();
  setupTableControls();
  renderTable();
  setupChangeFilters();
  renderOperatorChangeList();
  renderLeadChangeList();
}

function wireCategorySwitch(){
  document.querySelectorAll('#categorySwitch button').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      document.querySelectorAll('#categorySwitch button').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      currentCategory = btn.dataset.category;
      renderAll();
    });
  });
}

function wirePeriodSelector(){
  document.getElementById('periodSelect').addEventListener('change', (e)=>{
    currentPeriod = e.target.value;
    renderAll();
  });
}

function wireThemeToggle(){
  const btn = document.getElementById('themeToggle');
  if(!btn) return;
  btn.addEventListener('click', ()=>{
    const html = document.documentElement;
    const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', next);
    try{ localStorage.setItem('dashboardTheme', next); }catch(e){}
    // chart colors are read live from CSS variables, so re-render to pick up the new theme
    if(DATA) renderCharts();
  });
}

(async function init(){
  DATA = await loadData();
  renderMeta(DATA);
  setupPeriodSelector();
  wireCategorySwitch();
  wireTableEvents();
  wireChangeListEvents();
  wirePeriodSelector();
  wireThemeToggle();
  renderAll();
})();
