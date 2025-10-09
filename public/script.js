// === Huvudlogik ===
document.addEventListener('DOMContentLoaded', async () => {
    // --- BEFINTLIGA ELEMENT ---
    const calendarEl = document.getElementById('calendar');
    const selectedRangeEl = document.getElementById('selected-range');
    const message = document.getElementById('message');
    const bookingForm = document.getElementById('booking-form');

    // --- NYA ELEMENT FÖR SWISH-FLÖDET ---
    const payButton = document.getElementById('pay-button');
    const formError = document.getElementById('form-error');
    const swishWaitingContainer = document.getElementById('swish-waiting-container');
    const swishQrCode = document.getElementById('swish-qr-code');
    const statusText = document.getElementById('payment-status-text');
    const cancelPaymentButton = document.getElementById('cancel-payment-button');

    let startDate = null, endDate = null;
    let calendar;
    let events = [];
    let unavailableRanges = [];
    let pollingInterval; // Håller koll på vår "fråge-loop"

    // Hjälpfunktion för att visa datum i YYYY-MM-DD
    function formatDateISO(date) {
        return new Date(date).toISOString().split('T')[0];
    }

    // Markera valda datum med grön bakgrund
    function showSelection(start, end) {
        document.querySelectorAll('.fc-daygrid-day.selected-day').forEach(cell => cell.classList.remove('selected-day'));
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

    // Ladda tillgänglighet från servern
    async function loadAvailability() {
        const res = await fetch('/api/availability');
        const data = await res.json();
        events = [];
        unavailableRanges = [];

        const allRanges = [...data.bookings, ...data.blocks];
        allRanges.forEach(r => {
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
        
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        events.push({
            start: '1970-01-01',
            end: today.toISOString().split('T')[0],
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
    
    // ---- LADDA IN ALLT FRÅN START ----
    await loadAvailability();

    calendar = new FullCalendar.Calendar(calendarEl, {
        initialView: 'dayGridMonth',
        firstDay: 1,
        locale: 'sv',
        events: events,
        dateClick: (info) => {
            const clickedDate = new Date(info.dateStr);
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            if (clickedDate < today) return;
            
            const isBooked = unavailableRanges.some(r => {
                const d = new Date(info.dateStr);
                return d >= new Date(r.start) && d <= new Date(r.end);
            });

            if (isBooked) {
                // ... logik för att hantera klick på bokat datum ...
                return;
            }

            if (!startDate || (startDate && endDate)) {
                startDate = clickedDate;
                endDate = null;
            } else {
                if (clickedDate < startDate) {
                    startDate = clickedDate;
                    endDate = null;
                } else if (isOverlapping(startDate, clickedDate)) {
                    // ... logik för att hantera överlapp ...
                    return;
                } else {
                    endDate = clickedDate;
                }
            }
            
            // Uppdatera UI baserat på val
            if (startDate && !endDate) {
                selectedRangeEl.textContent = `Valt: ${formatDateISO(startDate)}`;
                payButton.disabled = false;
            } else if (startDate && endDate) {
                selectedRangeEl.textContent = `Valt: ${formatDateISO(startDate)} – ${formatDateISO(endDate)}`;
                payButton.disabled = false;
            }
            showSelection(startDate, endDate);
            message.textContent = '';
        }
    });
    calendar.render();


    // ---- NY SUBMIT-HANTERARE FÖR SWISH-FLÖDET ----
    bookingForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!startDate) return;

        // 1. Inaktivera knapp och visa vänteläge
        payButton.disabled = true;
        payButton.textContent = 'Skapar betalning...';
        formError.textContent = '';
        
        const finalEndDate = endDate || startDate;
        const formData = new FormData(bookingForm);
        const data = Object.fromEntries(formData.entries());
        data.startDate = formatDateISO(startDate);
        data.endDate = formatDateISO(finalEndDate);

        try {
            // 2. Anropa servern för att skapa Swish-betalningen
            const response = await fetch('/api/book', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error || 'Något gick fel.');
            }

            // 3. Visa QR-kod och försök starta Swish-appen
            bookingForm.style.display = 'none';
            swishWaitingContainer.style.display = 'block';
            swishQrCode.src = result.qrCode;

            window.location.href = `swish://paymentrequest?token=${result.paymentRequestToken}`;
            
            // 4. Börja "polla" för att se om betalningen är klar
            startPolling(result.bookingId);

        } catch (error) {
            formError.textContent = error.message;
            payButton.disabled = false;
            payButton.textContent = 'Slutför bokning och betala med Swish';
        }
    });

    // ---- NY POLLING-FUNKTION ----
    function startPolling(bookingId) {
        statusText.textContent = "Väntar på bekräftelse i Swish-appen...";
        
        pollingInterval = setInterval(async () => {
            try {
                const res = await fetch(`/api/payment-status/${bookingId}`);
                const data = await res.json();
                
                if (data.status === 'PAID') {
                    clearInterval(pollingInterval);
                    // Omdirigera till en "tack"-sida (skapa en success.html)
                    window.location.href = '/success.html'; 
                }
            } catch (err) {
                // Ignorera enstaka nätverksfel, fortsätt polla
                console.warn('Polling-fel:', err);
            }
        }, 3000); // Fråga var 3:e sekund
        
        // Stoppa efter 5 minuter om inget händer
        setTimeout(() => {
            clearInterval(pollingInterval);
            if (swishWaitingContainer.style.display === 'block') {
                 statusText.textContent = "Betalningen avbröts eller tog för lång tid.";
                 cancelPaymentButton.textContent = "Försök igen";
            }
        }, 5 * 60 * 1000);
    }
    
    // ---- NY AVBRYT-KNAPP-LOGIK ----
    cancelPaymentButton.addEventListener('click', () => {
        clearInterval(pollingInterval);
        swishWaitingContainer.style.display = 'none';
        bookingForm.style.display = 'block';
        payButton.disabled = false;
        payButton.textContent = 'Slutför bokning och betala med Swish';
        formError.textContent = '';
    });
});