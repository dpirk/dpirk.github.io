(function(){
  const msg = document.getElementById('admin-message');
  const listEl = document.getElementById('booking-list');
  const detailsEl = document.getElementById('selected-details');
  const statsYearEl = document.getElementById('stats-year');
  const bookingsChartEl = document.getElementById('bookings-chart');
  const revenueChartEl = document.getElementById('revenue-chart');

  const $ = (s) => document.querySelector(s);

  

  // ===== Helpers =====
  async function fetchJSON(url, opts){
    const res = await fetch(url, opts);
    if(!res.ok) throw new Error(await res.text());
    return res.json();
  }

  // Vänta tills sidan har laddat klart
document.addEventListener('DOMContentLoaded', () => {
  const themeToggle = document.getElementById('theme-toggle');

  themeToggle.addEventListener('click', () => {
    // Växla klassen .dark-mode på <html>-elementet
    document.documentElement.classList.toggle('dark-mode');

    // (Vi lägger till logik för att spara valet i nästa steg)
  });
});

// admin.js
document.addEventListener('DOMContentLoaded', () => {
  const themeToggle = document.getElementById('theme-toggle');
  const htmlElement = document.documentElement;

  themeToggle.addEventListener('click', () => {
    htmlElement.classList.toggle('dark-mode');

    // Spara valet i localStorage
    if (htmlElement.classList.contains('dark-mode')) {
      localStorage.setItem('theme', 'dark');
      themeToggle.innerHTML = "☀️ Byt till ljust läge";
    } else {
      localStorage.setItem('theme', 'light');
      themeToggle.innerHTML = "🌙 Byt till mörkt läge";
    }
  });

  // Uppdatera knappens text vid sidladdning
  if (localStorage.getItem('theme') === 'dark') {
    themeToggle.innerHTML = "☀️ Byt till ljust läge";
  } else {
    themeToggle.innerHTML = "🌙 Byt till mörkt läge";
  }
});

  // ===== Lista över bokningar/block =====
  function renderList(data){
    const lines = [];
    lines.push('<ul>');
    data.bookings.forEach(b=>{
      lines.push(`<li><strong>Bokning</strong> ${b.startDate} – ${b.endDate} · ${b.name} <button data-id="${b.id}" data-type="booking" class="remove">Ta bort</button></li>`);
    });
    data.blocks.forEach(b=>{
      lines.push(`<li><strong>Block</strong> ${b.startDate} – ${b.endDate} <button data-id="${b.id}" data-type="block" class="remove">Ta bort</button></li>`);
    });
    lines.push('</ul>');
    listEl.innerHTML = lines.join('');

    listEl.querySelectorAll('.remove').forEach(btn => {
      btn.addEventListener('click', async (e)=>{
        if (!confirm('Är du säker på att du vill ta bort denna bokning?')) return;
        const id = e.currentTarget.getAttribute('data-id');
        try {
          await fetchJSON('/api/remove', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ id })
          });
          msg.textContent = 'Posten togs bort';
          msg.style.color = 'green';
          await loadAll();
        } catch(err){
          msg.textContent = 'Kunde inte ta bort.';
          msg.style.color = 'red';
        }
      });
    });
  }

  // ===== Kalender =====
  function renderCalendar(data){
    if(!window.FullCalendar){
      msg.textContent = 'FullCalendar kunde inte laddas (CSP/script).';
      msg.style.color = 'red';
      return;
    }
    const el = document.getElementById('admin-calendar');
    el.innerHTML = '';

    const events = [];
    data.bookings.forEach(r => {
      const end = new Date(r.endDate); end.setDate(end.getDate()+1);
      events.push({
        title: r.name,
        start: r.startDate,
        end: end.toISOString().split('T')[0],
        color:'#ff8a80',
        display:'block',
        extendedProps:{ type:'booking', item:r, phone:r.phone, email:r.email }
      });
    });
    data.blocks.forEach(r => {
      const end = new Date(r.endDate); end.setDate(end.getDate()+1);
      events.push({
        title: 'Block',
        start: r.startDate,
        end: end.toISOString().split('T')[0],
        color:'#b0bec5',
        display:'background',
        extendedProps:{ type:'block', item:r }
      });
    });

    const cal = new FullCalendar.Calendar(el, {
      initialView: 'dayGridMonth',
      firstDay: 1,
      locale: 'sv',
      selectable: false,
      events,
      dateClick(info){
        detailsEl.innerHTML = `<p>Datum: <strong>${info.dateStr}</strong></p><p>Klicka på ett namn i kalendern för detaljer.</p>`;
      },
      eventClick(info){
        const ev = info.event;
        const { title, extendedProps } = ev;
        if (extendedProps.type === 'booking') {
          const b = extendedProps.item;
          detailsEl.innerHTML = `
            <p><strong>${title}</strong></p>
            <p>Period: ${b.startDate} – ${b.endDate}</p>
            <p>Tel: ${b.phone || '-'}</p>
            <p>E‑post: ${b.email || '-'}</p>
          `;
        } else {
          detailsEl.innerHTML = `<p><strong>Blockerat</strong></p>`;
        }
      }
    });
    cal.render();
  }

  // ===== Statistik (Chart.js 4) =====
  let bookingsChartInstance;
  let revenueChartInstance;

  function renderStats(stats) {
  if (!window.Chart) { msg.textContent = 'Chart.js kunde inte laddas'; msg.style.color = 'red'; return; }

  statsYearEl.textContent = stats.year;
  const labels = ['Jan','Feb','Mar','Apr','Maj','Jun','Jul','Aug','Sep','Okt','Nov','Dec'];
  const counts = stats.months.map(m => m.count);
  const revenue = stats.months.map(m => m.revenue);

  // Rensa gamla grafer om de finns
  if (bookingsChartInstance) { bookingsChartInstance.destroy(); bookingsChartInstance = null; }
  if (revenueChartInstance) { revenueChartInstance.destroy(); revenueChartInstance = null; }

  // Lås storlek för tydlighet
  bookingsChartEl.width  = bookingsChartEl.offsetWidth || 1000;
  bookingsChartEl.height = 420;
  revenueChartEl.width   = revenueChartEl.offsetWidth || 1000;
  revenueChartEl.height  = 420;

  // Bokningar (staplar)
  bookingsChartInstance = new Chart(bookingsChartEl, {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Bokningar', data: counts, backgroundColor: '#42a5f5', borderColor: '#1e88e5', borderWidth: 1 }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top', labels: { font: { size: 12 } } },
        tooltip: { mode: 'index', intersect: false }
      },
      scales: {
        y: { beginAtZero: true, ticks: { font: { size: 12 } } },
        x: { ticks: { maxRotation: 0, autoSkip: true, font: { size: 12 } } }
      }
    }
  });

  // Intäkt (linje)
  revenueChartInstance = new Chart(revenueChartEl, {
    type: 'line',
    data: { labels, datasets: [{ label: 'Intäkt (kr)', data: revenue, borderColor: '#66bb6a', backgroundColor: 'rgba(102,187,106,0.15)', borderWidth: 2, pointRadius: 3, pointHoverRadius: 5, tension: 0.3, fill: true }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top', labels: { font: { size: 12 } } },
        tooltip: { mode: 'index', intersect: false }
      },
      scales: {
        y: { beginAtZero: true, ticks: { font: { size: 12 } } },
        x: { ticks: { maxRotation: 0, autoSkip: true, font: { size: 12 } } }
      }
    }
  });

  const totB = stats.totalBookings; const totR = stats.totalRevenue;
  document.getElementById('year-summary').textContent = `Totalt ${totB} bokningar · ${totR} kr`;
}


  // ===== PDF: endast datum och namn (6 veckor framåt) =====
  async function downloadPDF(){
    if(!window.jspdf || !window.jspdf.jsPDF){ msg.textContent = 'jsPDF saknas'; msg.style.color = 'red'; return; }
    const { jsPDF } = window.jspdf;
    const data = await fetchJSON('/api/calendar');

    const doc = new jsPDF();
    doc.setFontSize(14); doc.text('Bokningar – kommande 6 veckor', 14, 16);

    const today = new Date(); today.setHours(0,0,0,0);
    const to = new Date(today); to.setDate(today.getDate()+42);

    let y = 26;
    const rows = data.bookings.map(b=>({ start:b.startDate, end:b.endDate, namn:b.name }));
    const inRange = rows.filter(r=> new Date(r.start) <= to && new Date(r.end) >= today );

    doc.setFontSize(11);
    doc.text(['Start','Slut','Namn'].join(' | '), 14, y); y += 6;
    inRange.forEach(r=>{ doc.text([r.start, r.end, r.namn].join(' | '), 14, y); y += 6; if(y>280){ doc.addPage(); y=20; } });

    doc.save('bokningar_6_veckor.pdf');
  }

  // ===== Hämta allt (kalender + lista + statistik) =====
  async function loadAll(){
    console.log('loadAll anropad', new Date().toISOString());
    try {
      const data = await fetchJSON('/api/calendar');
      renderCalendar(data);
      renderList(data);
    } catch(err) {
      msg.textContent = 'Kunde inte läsa kalenderdata (är du inloggad?).';
      msg.style.color = 'red';
    }

    try {
      const stats = await fetchJSON('/api/statistics');
      renderStats(stats);
    } catch(err) {
      console.error('Kunde inte ladda statistik', err);
    }
    
  }

  // ===== Manuell bokning (utan Swish) =====
  document.getElementById('manual-booking')?.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const name = document.getElementById('manual-name').value.trim();
    const phone = document.getElementById('manual-phone').value.trim();
    const email = document.getElementById('manual-email').value.trim();
    const startDate = document.getElementById('manual-start').value;
    const endDate = document.getElementById('manual-end').value;
    try {
      await fetchJSON('/api/book', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ startDate, endDate, name, phone, email, manual: true })
      });
      msg.textContent = 'Bokning skapad.';
      msg.style.color = 'green';
      await loadAll();
    } catch(err) {
      msg.textContent = 'Kunde inte skapa bokning.';
      msg.style.color = 'red';
    }
  });

  // ===== Knapp-händelser =====
  document.getElementById('download-pdf')?.addEventListener('click', downloadPDF);
  document.getElementById('logout')?.addEventListener('click', async ()=>{
    try { await fetchJSON('/api/logout', { method:'POST' }); location.href = 'login.html'; } catch {}
  });

  // ===== Init =====
  loadAll();
})();
