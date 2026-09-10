const DATA_URL = 'data/data.json';

let DATA = null;
let currentCategory = 'all';
let charts = {}; // canvasId -> Chart instance

const CATEGORY_LABELS = { all: 'همه', freelancer: 'Freelancer', center_issue: 'Center Issue' };
const CHANGE_LIST_LIMIT = 20;

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

// ---------- Client-side aggregation (category-aware) ----------
function aggregateByLead(operators){
  const leads = [...new Set(operators.map(o=>o.lead).filter(Boolean))].sort();
  return leads.map(lead => {
    const subset = operators.filter(o=>o.lead===lead);
    const count = subset.length;
    const totalOrders = subset.reduce((s,o)=>s+(o.total_orders||0),0);
    const avgScore = count ? subset.reduce((s,o)=>s+(o.avg_score||0),0)/count : 0;
    const avgOct = count ? subset.reduce((s,o)=>s+(((o.oct1||0)+(o.oct2||0))/2),0)/count : 0;
    return { lead, count, totalOrders, avgOct, avgScore };
  });
}

function aggregateByCompany(operators){
  const companies = [...new Set(operators.map(o=>o.company).filter(Boolean))].sort();
  return companies.map(company => {
    const subset = operators.filter(o=>o.company===company);
    const count = subset.length;
    const totalOrders = subset.reduce((s,o)=>s+(o.total_orders||0),0);
    const avgScore = count ? subset.reduce((s,o)=>s+(o.avg_score||0),0)/count : 0;
    return { company, count, totalOrders, avgScore };
  });
}

// ---------- KPIs ----------
function renderKPIs(){
  const operators = filteredOperators();
  const totalOperators = operators.length;
  const totalOrders = operators.reduce((s,o)=>s+(o.total_orders||0),0);
  const avgScore = totalOperators ? (operators.reduce((s,o)=>s+(o.avg_score||0),0)/totalOperators) : 0;
  const totalBugs = (DATA.bugs.find(b=>b[0].includes('مجموع')) || [null,0])[1];
  const totalSalary = operators.reduce((s,o)=>s+(o.salary||0),0);

  const kpis = [
    {label:'تعداد کل اپراتورها', value: totalOperators.toLocaleString('en-US'), accent:'var(--teal)'},
    {label:'مجموع سفارشات (۲ هفته)', value: totalOrders.toLocaleString('en-US'), accent:'var(--indigo)'},
    {label:'میانگین امتیاز کلی', value: avgScore.toFixed(2) + ' <small>از ۵</small>', accent:'var(--amber)'},
    {label:'مجموع حقوق (Total Salary)', value: totalSalary.toLocaleString('en-US'), accent:'var(--violet)'},
    {label:'باگ‌های ثبت‌شده', value: totalBugs.toLocaleString('en-US'), accent: totalBugs>0 ? 'var(--coral)':'var(--teal)'},
  ];
  document.getElementById('kpi-row').innerHTML = kpis.map(k => `
    <div class="kpi" style="--accent:${k.accent}">
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
        y:{ grid:{display: !horizontal, color:'#1D2229'}, ticks:{font:{size:11}}, beginAtZero:true }
      }
    }
  });
}

function renderCharts(){
  Chart.defaults.font.family = "'IRANSans', 'Vazirmatn', sans-serif";
  Chart.defaults.color = '#8B93A1';
  Chart.defaults.borderColor = '#262B33';

  const operators = filteredOperators();
  const teamLeads = aggregateByLead(operators);
  const companies = aggregateByCompany(operators);

  barChart('chartScore', teamLeads.map(t=>t.lead), teamLeads.map(t=>+t.avgScore.toFixed(2)), '#33D6BC');
  barChart('chartOrders', teamLeads.map(t=>t.lead), teamLeads.map(t=>t.totalOrders), '#7C93F0');
  barChart('chartOct', teamLeads.map(t=>t.lead), teamLeads.map(t=>+t.avgOct.toFixed(1)), '#F0A94E');

  destroyChart('chartCompany');
  charts['chartCompany'] = new Chart(document.getElementById('chartCompany'), {
    type:'doughnut',
    data:{
      labels: companies.map(c=>c.company),
      datasets:[{
        data: companies.map(c=>c.count),
        backgroundColor:['#33D6BC','#7C93F0','#F0A94E','#E8615C','#B48CE0','#4FC3E8','#E0A5D8','#8FD16B','#E0C05C','#C79BE0'],
        borderColor:'#161A1F', borderWidth:2
      }]
    },
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{ position:'right', labels:{ boxWidth:10, font:{size:10.5}, color:'#8B93A1' } } }
    }
  });

  renderTrendChart();
}

function renderTrendChart(){
  const operators = filteredOperators();
  const wrap = document.getElementById('chartTrend').parentElement;
  const oldNote = wrap.querySelector('.trend-note');
  if(oldNote) oldNote.remove();

  const leads = [...new Set(operators.map(o=>o.lead))].filter(Boolean).sort();

  if(!leads.length){
    destroyChart('chartTrend');
    wrap.insertAdjacentHTML('beforeend',
      '<div class="trend-note" style="color:var(--muted);font-size:13px;padding:12px 0;">داده‌ای برای نمایش وجود نداره.</div>');
    return;
  }

  const palette = ['#33D6BC','#7C93F0','#F0A94E','#E8615C','#B48CE0','#4FC3E8','#E0A5D8','#8FD16B','#E0C05C','#C79BE0'];

  const datasets = leads.map((lead, i) => {
    const subset = operators.filter(o => o.lead === lead);
    const count = subset.length;
    const avg1 = count ? subset.reduce((s,o)=>s+(o.avg1||0),0) / count : 0;
    const avg2 = count ? subset.reduce((s,o)=>s+(o.avg2||0),0) / count : 0;
    return {
      label: lead,
      data: [+avg1.toFixed(2), +avg2.toFixed(2)],
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
    data:{ labels: ['هفته ۱', 'هفته ۲'], datasets },
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{ position:'bottom', labels:{ boxWidth:10, font:{size:10.5}, color:'#8B93A1' } } },
      scales:{
        x:{ grid:{color:'#1D2229'}, ticks:{font:{size:11}} },
        y:{ grid:{color:'#1D2229'}, ticks:{font:{size:11}}, suggestedMin:0, suggestedMax:5 }
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
  const color = isGood ? '#33D6BC' : (isBad ? '#E8615C' : 'var(--muted)');
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
    const dOrders = (o.orders2||0) - (o.orders1||0);
    const dOct = (o.oct2||0) - (o.oct1||0);
    const dScore = (o.avg2||0) - (o.avg1||0);
    return { ...o, dOrders, dOct, dScore, magnitude: changeMagnitude(dScore, dOct, dOrders) };
  });
  withDelta.sort((a,b)=> b.magnitude - a.magnitude);
  const rows = withDelta.slice(0, CHANGE_LIST_LIMIT);

  document.getElementById('opChangeCount').textContent =
    rows.length.toLocaleString('en-US') + ' از ' + withDelta.length.toLocaleString('en-US') + ' اپراتور';

  document.getElementById('opChangeBody').innerHTML = rows.map(o => `
    <tr>
      <td>${o.name}</td>
      <td>${o.lead || ''}</td>
      <td class="num">${(o.orders1||0).toLocaleString('en-US')} ← ${(o.orders2||0).toLocaleString('en-US')}</td>
      <td class="num">${fmtDelta(o.dOrders, 0)}</td>
      <td class="num">${(o.oct1||0).toLocaleString('en-US')} ← ${(o.oct2||0).toLocaleString('en-US')}</td>
      <td class="num">${fmtDelta(o.dOct, 1, true)}</td>
      <td class="num">${(o.avg1||0).toFixed(1)} ← ${(o.avg2||0).toFixed(1)}</td>
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
    const avgOf = key => count ? subset.reduce((s,o)=>s+(o[key]||0),0) / count : 0;
    const orders1 = subset.reduce((s,o)=>s+(o.orders1||0),0);
    const orders2 = subset.reduce((s,o)=>s+(o.orders2||0),0);
    const oct1 = avgOf('oct1'), oct2 = avgOf('oct2');
    const avg1 = avgOf('avg1'), avg2 = avgOf('avg2');
    const dOrders = orders2 - orders1, dOct = oct2 - oct1, dScore = avg2 - avg1;
    return { lead, count, orders1, orders2, oct1, oct2, avg1, avg2, dOrders, dOct, dScore,
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
      <td class="num">${r.orders1.toLocaleString('en-US')} ← ${r.orders2.toLocaleString('en-US')}</td>
      <td class="num">${fmtDelta(r.dOrders, 0)}</td>
      <td class="num">${r.oct1.toFixed(1)} ← ${r.oct2.toFixed(1)}</td>
      <td class="num">${fmtDelta(r.dOct, 1, true)}</td>
      <td class="num">${r.avg1.toFixed(2)} ← ${r.avg2.toFixed(2)}</td>
      <td class="num">${fmtDelta(r.dScore, 2)}</td>
    </tr>`).join('');
}

function wireChangeListEvents(){
  document.getElementById('opChangeLeadFilter').addEventListener('change', renderOperatorChangeList);
  document.getElementById('leadChangeLeadFilter').addEventListener('change', renderLeadChangeList);
}

// ---------- Operators table ----------
function scoreColor(score){
  if(score >= 4) return {bg:'rgba(51,214,188,0.15)', fg:'#33D6BC'};
  if(score >= 2.5) return {bg:'rgba(240,169,78,0.15)', fg:'#F0A94E'};
  return {bg:'rgba(232,97,92,0.15)', fg:'#E8615C'};
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

  let rows = filteredOperators().filter(o =>
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
  tbody.innerHTML = rows.map(o => {
    const sc = scoreColor(o.avg_score);
    return `<tr>
      <td>${o.name}</td>
      <td>${o.company}</td>
      <td>${o.lead}</td>
      <td>${o.shift}</td>
      <td class="num">${(o.total_orders||0).toLocaleString('en-US')}</td>
      <td><span class="score-pill num" style="background:${sc.bg};color:${sc.fg}">${o.avg_score.toFixed(2)}</span></td>
      <td class="num">${(o.salary||0).toLocaleString('en-US')}</td>
      <td class="num">${(o.bug_price||0).toLocaleString('en-US')}</td>
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

(async function init(){
  DATA = await loadData();
  renderMeta(DATA);
  wireCategorySwitch();
  wireTableEvents();
  wireChangeListEvents();
  renderAll();
})();
