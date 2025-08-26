// === Navigering utan inline handlers (CSP-safe) ===
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('nav-book')?.addEventListener('click', () => {
    location.href = 'index.html';
  });
  document.getElementById('nav-pics')?.addEventListener('click', () => {
    location.href = 'bilder.html';
  });
  document.getElementById('nav-info')?.addEventListener('click', () => {
    location.href = 'information.html';
  });
});

// === Datumhjälpare ===
function parseLocalDate(dateString) {
  const [year, month, day] = dateString.toString().split('-').map(Number);
  const d = new Date(year, month - 1, day);
  d.setHours(0, 0, 0, 0);
  return d;
}
// DD-MM-YYYY (om du vill visa för användare)
function formatDateDisplay(dateString) {
  const [year, month, day] = dateString.toString().split('-');
  return `${day}-${month}-${year}`;
}

// === Huvudlogik ===
document.addEventListener('DOMContentLoaded', async () => {
  const calendarEl = document.getElementById('calendar');
  const selectedRangeEl = document.getElementById('selected-range');
  const message = document.getElementById('message');
  const bookingForm = document.getElementById('booking-form');
  const bookBtn = bookingForm.querySelector('button');
  const qrImg = document.getElementById('swish-qr');
  const swishLink = document.getElementById('swish-link');
  const paymentSection = document.getElementById('payment-section');

  let startDate = null, endDate = null;
  let calendar;
  let events = [];
  let unavailableRanges = [];

  // Hjälpfunktion för att visa datum i YYYY-MM-DD
  function formatDateISO(date) {
    const d = new Date(date);
    return d.toISOString().split('T')[0];
  }

  // Markera valda datum med grön ram
  function showSelection(start, end) {
    document.querySelectorAll('.fc-daygrid-day.selected-day')
      .forEach(cell => cell.classList.remove('selected-day'));

    if (!start) return;

    const finalEnd = end || start;
    const s = new Date(start);
    const e = new Date(finalEnd);

    const cells = document.querySelectorAll('.fc-daygrid-day[data-date]');
    cells.forEach(cell => {
      const date = new Date(cell.getAttribute('data-date'));
      if (date >= s && date <= e) {
        cell.classList.add('selected-day');
      }
    });
  }

  async function loadAvailability() {
    const res = await fetch('/api/availability');
    const data = await res.json();
    events = [];
    unavailableRanges = [];

    data.bookings.forEach(r => {
      const end = new Date(r.endDate);
      end.setDate(end.getDate() + 1);
      events.push({
        start: r.startDate,
        end: end.toISOString().split('T')[0],
        color: 'red',
        display: 'background'
      });
      unavailableRanges.push({ start: r.startDate, end: r.endDate });
    });

    data.blocks.forEach(r => {
      const end = new Date(r.endDate);
      end.setDate(end.getDate() + 1);
      events.push({
        start: r.startDate,
        end: end.toISOString().split('T')[0],
        color: 'red',
        display: 'background'
      });
      unavailableRanges.push({ start: r.startDate, end: r.endDate });
    });

    // Gråa ut allt som passerat
    const today = new Date();
    today.setHours(0,0,0,0);
    const pastEnd = new Date(today);
    pastEnd.setDate(today.getDate() - 1);
    events.push({
      start: '1970-01-01',
      end: pastEnd.toISOString().split('T')[0],
      color: '#e0e0e0',
      display: 'background'
    });
  }

  function isOverlapping(start, end) {
    const s = new Date(start);
    const e = new Date(end);
    return unavailableRanges.some(r => {
      const rs = new Date(r.start);
      const re = new Date(r.end);
      return !(e < rs || s > re);
    });
  }

  function isBlocked(dateVal) {
    const d = new Date(dateVal);
    return unavailableRanges.some(r => {
      return d >= new Date(r.start) && d <= new Date(r.end);
    });
  }

  await loadAvailability();

  const calendarOptions = {
    initialView: 'dayGridMonth',
    firstDay: 1,
    locale: 'sv',
    selectable: false,
    eventBackgroundColor: 'transparent',
    eventDisplay: 'block',

    dateClick: (info) => {
      const clickedDate = new Date(info.dateStr);
      const today = new Date();
      today.setHours(0,0,0,0);

      // Ignorera klick på datum i det förflutna
      if (clickedDate < today) return;

      // Blockera datum som är bokade eller blockerade
      if (isBlocked(clickedDate)) {
        selectedRangeEl.textContent = '';
        showSelection(null, null);
        message.textContent = 'Datumet är bokat och kan inte väljas.';
        message.style.color = 'red';
        bookBtn.disabled = true;
        return;
      }

      // Ny startpunkt om inget slutdatum är valt (eller båda redan satta)
      if (!startDate || (startDate && endDate)) {
        startDate = clickedDate;
        endDate = null;
        selectedRangeEl.textContent = `Valt: ${formatDateISO(startDate)}`;
        message.textContent = '';
        bookBtn.disabled = false;
        showSelection(startDate, null);
      }
      // Annars sätt slutdatum om det är giltigt
      else if (!endDate) {
        if (new Date(clickedDate) < new Date(startDate)) {
          startDate = clickedDate;
          endDate = null;
          selectedRangeEl.textContent = `Valt: ${formatDateISO(startDate)}`;
          message.textContent = '';
          bookBtn.disabled = false;
          showSelection(startDate, null);
          return;
        }

        // Om intervallet korsar bokade/blockerade datum, återställ
        if (isOverlapping(startDate, clickedDate)) {
          message.textContent = 'Intervallet korsar bokade datum. Välj igen.';
          message.style.color = 'red';
          startDate = null;
          endDate = null;
          selectedRangeEl.textContent = '';
          showSelection(null, null);
          bookBtn.disabled = true;
          return;
        }

        // Annars sätt slutdatum och markera intervallet
        endDate = clickedDate;
        selectedRangeEl.textContent = `Valt: ${formatDateISO(startDate)} – ${formatDateISO(endDate)}`;
        message.textContent = '';
        bookBtn.disabled = false;
        showSelection(startDate, endDate);
      }
    },
    events
  };

  // Se till att FullCalendar finns (om CSP blockerat script)
  if (!window.FullCalendar) {
    message.textContent = 'Kunde inte ladda kalendern (CSP eller script-fel).';
    message.style.color = 'red';
    return;
  }

  calendar = new FullCalendar.Calendar(calendarEl, calendarOptions);
  calendar.render();

  bookingForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!startDate) return;

    const finalEndDate = endDate || startDate;
    const today = new Date();
    today.setHours(0,0,0,0);

    // Säkerhet: blockera bokning i det förflutna
    if (new Date(startDate) < today || new Date(finalEndDate) < today) {
      message.textContent = 'Ogiltig bokning – datumet har redan passerat.';
      message.style.color = 'red';
      return;
    }

    const name = document.getElementById('name').value.trim();
    const phone = document.getElementById('phone').value.trim();
    const email = document.getElementById('email').value.trim();

    const res = await fetch('/api/book', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ startDate, endDate: finalEndDate, name, phone, email })
    });

    if (res.ok) {
      const { qrCode, swishUri } = await res.json();
      qrImg.src = qrCode;
      swishLink.href = swishUri;
      paymentSection.style.display = 'block';

      message.textContent = 'Väntar på betalning via Swish...';
      message.style.color = 'orange';

      setTimeout(async () => {
        await loadAvailability();
        calendar.removeAllEvents();
        events.forEach(e => calendar.addEvent(e));

        message.textContent = 'Bokningen är nu bekräftad!';
        message.style.color = 'green';
        paymentSection.style.display = 'none';
      }, 6000);

      startDate = endDate = null;
      selectedRangeEl.textContent = '';
      bookingForm.reset();
      showSelection(null, null);
      bookBtn.disabled = true;
    } else {
      const err = await res.json();
      message.textContent = err.error || 'Ett fel uppstod vid bokningen.';
      message.style.color = 'red';
    }
  });
});