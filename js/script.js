const DATA_URL = 'data/data.json';

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

function renderKPIs(data){
  const totalOperators = data.operators.length;
  const totalOrders = data.operators.reduce((s,o)=>s+(o.total_orders||0),0);
  const avgScore = totalOperators ? (data.operators.reduce((s,o)=>s+(o.avg_score||0),0)/totalOperators) : 0;
  const totalBugs = (data.bugs.find(b=>b[0].includes('مجموع')) || [null,0])[1];
  const totalSalary = data.total_salary ?? data.operators.reduce((s,o)=>s+(o.salary||0),0);

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

function barChart(ctx, labels, values, color, horizontal=false){
  return new Chart(ctx, {
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

function renderCharts(data){
  Chart.defaults.font.family = "'IRANSans', 'Vazirmatn', sans-serif";
  Chart.defaults.color = '#8B93A1';
  Chart.defaults.borderColor = '#262B33';

  const teamLeads = data.team_leads; // [name, count, totalOrders, avgOct, avgScore]
  barChart(document.getElementById('chartScore'),
    teamLeads.map(t=>t[0]), teamLeads.map(t=>+t[4].toFixed(2)), '#33D6BC');

  barChart(document.getElementById('chartOrders'),
    teamLeads.map(t=>t[0]), teamLeads.map(t=>t[2]), '#7C93F0');

  barChart(document.getElementById('chartOct'),
    teamLeads.map(t=>t[0]), teamLeads.map(t=>+t[3].toFixed(1)), '#F0A94E');

  const companies = data.companies; // [name, count, totalOrders, avgScore]
  new Chart(document.getElementById('chartCompany'), {
    type:'doughnut',
    data:{
      labels: companies.map(c=>c[0]),
      datasets:[{
        data: companies.map(c=>c[1]),
        backgroundColor:['#33D6BC','#7C93F0','#F0A94E','#E8615C','#B48CE0','#4FC3E8','#E0A5D8','#8FD16B','#E0C05C','#C79BE0'],
        borderColor:'#161A1F', borderWidth:2
      }]
    },
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{ position:'right', labels:{ boxWidth:10, font:{size:10.5}, color:'#8B93A1' } } }
    }
  });
}

function renderTable(data){
  const tbody = document.getElementById('opsBody');
  const searchBox = document.getElementById('searchBox');
  const leadFilter = document.getElementById('leadFilter');
  const companyFilter = document.getElementById('companyFilter');
  const rowCount = document.getElementById('rowCount');

  const uniqueLeads = [...new Set(data.operators.map(o=>o.lead))].sort();
  const uniqueCompanies = [...new Set(data.operators.map(o=>o.company))].sort();
  leadFilter.innerHTML += uniqueLeads.map(l=>`<option value="${l}">${l}</option>`).join('');
  companyFilter.innerHTML += uniqueCompanies.map(c=>`<option value="${c}">${c}</option>`).join('');

  let sortKey = 'total_orders', sortDir = -1;

  function scoreColor(score){
    if(score >= 4) return {bg:'rgba(51,214,188,0.15)', fg:'#33D6BC'};
    if(score >= 2.5) return {bg:'rgba(240,169,78,0.15)', fg:'#F0A94E'};
    return {bg:'rgba(232,97,92,0.15)', fg:'#E8615C'};
  }

  function render(){
    const q = searchBox.value.trim();
    const lead = leadFilter.value;
    const company = companyFilter.value;
    let rows = data.operators.filter(o =>
      (!q || o.name.includes(q)) &&
      (!lead || o.lead === lead) &&
      (!company || o.company === company)
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
      </tr>`;
    }).join('');
  }

  document.querySelectorAll('table.ops thead th').forEach(th=>{
    th.addEventListener('click', ()=>{
      const key = th.dataset.key;
      if(sortKey === key){ sortDir *= -1; } else { sortKey = key; sortDir = 1; }
      document.querySelectorAll('table.ops thead th .arrow').forEach(a=>a.remove());
      th.innerHTML += `<span class="arrow">${sortDir===1?'▲':'▼'}</span>`;
      render();
    });
  });

  [searchBox, leadFilter, companyFilter].forEach(el => el.addEventListener('input', render));
  render();
}

(async function init(){
  const data = await loadData();
  renderMeta(data);
  renderKPIs(data);
  renderCharts(data);
  renderTable(data);
})();
