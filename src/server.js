// v17.1 – härdad server: .env, datumfix, överlapps‑kontroll, rate‑limit endast /api, helmet m/CSP, komprimering, manuell bokning
const path = require('path');
const fs = require('fs');
const https = require('https');
const crypto = require('crypto');
const axios = require('axios');

// ---- KORREKT .env ----
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const express = require('express');
const cookieParser = require('cookie-parser');
const qrcode = require('qrcode');
const cron = require('node-cron');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const nodemailer = require('nodemailer');

// ---- Konfig ----
const PORT = Number(process.env.PORT || 3001);
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin123';
const DAILY_RATE_SEK = Number(process.env.DAILY_RATE_SEK || 550);
const DATA_DIR = path.resolve(__dirname, '../data');
const BACKUP_DIR = path.resolve(__dirname, '../backups');
const PUBLIC_DIR = path.resolve(__dirname, '../public');
const BOOKINGS_FILE = path.join(DATA_DIR, 'bookings.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

// Skapa en HTTPS-agent som använder Swish-certifikatet
let swishAgent = null;
if (process.env.SWISH_CERT_PATH && process.env.SWISH_CERT_PASSWORD) {
  try {
    swishAgent = new https.Agent({
      pfx: fs.readFileSync(process.env.SWISH_CERT_PATH),
      passphrase: process.env.SWISH_CERT_PASSWORD,
    });
  } catch (err) {
    console.error('Kunde inte ladda Swish-certifikatet:', err.message);
  }
}

// ---- Datumutils ----
function parseLocalDate(yyyyMmDd) {
  const [y, m, d] = String(yyyyMmDd).split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setHours(0, 0, 0, 0);
  return dt;
}
function daysInclusive(startISO, endISO) {
  const s = parseLocalDate(startISO);
  const e = parseLocalDate(endISO);
  return Math.ceil((e - s) / (1000 * 60 * 60 * 24)) + 1;
}
function rangesOverlap(s1, e1, s2, e2) {
  const a1 = parseLocalDate(s1);
  const b1 = parseLocalDate(e1);
  const a2 = parseLocalDate(s2);
  const b2 = parseLocalDate(e2);
  return !(b1 < a2 || a1 > b2);
}

// ---- Data I/O ----
function loadBookings() {
  if (!fs.existsSync(BOOKINGS_FILE)) return { bookings: [], blocks: [] };
  try {
    return JSON.parse(fs.readFileSync(BOOKINGS_FILE, 'utf8'));
  } catch (e) {
    console.error('Kunde inte läsa bookings.json:', e.message);
    return { bookings: [], blocks: [] };
  }
}
function saveBookings(data) {
  const tmp = BOOKINGS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, BOOKINGS_FILE);
}

// ---- E‑post ----
let transporter = null;
try {
  if (process.env.SMTP_SERVICE && process.env.SMTP_USER && process.env.SMTP_PASS) {
    transporter = nodemailer.createTransport({
      service: process.env.SMTP_SERVICE,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });
  }
} catch (err) {
  console.warn('Kunde inte initiera mailtransport:', err.message);
}
async function safeSendMail(opts) {
  if (!transporter) {
    console.error('Mail-transporter är inte initierad. Kontrollera .env-inställningar.');
    return;
  }
  try {
    await transporter.sendMail(opts);
  } catch (e) {
    console.error('Mailfel:', e);
  }
}

// ---- App ----
const app = express();
const isProd = process.env.NODE_ENV === 'production';
app.set('trust proxy', 1);
app.use(compression());
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      "default-src": ["'self'"],
      "script-src": ["'self'"],
      "style-src": ["'self'"],
      "img-src": ["'self'", "data:"],
      "connect-src": ["'self'"],
      "object-src": ["'none'"],
      "frame-ancestors": ["'none'"],
      "form-action": ["'self'"],
      "base-uri": ["'self'"]
    }
  }
}));
app.use(express.json());
app.use(cookieParser());

const staticOptions = { index: 'start.html' };
app.use(express.static('public', staticOptions));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', apiLimiter);

const pendingBookings = Object.create(null);

cron.schedule('0 2 * * *', () => {
  const dateStr = new Date().toISOString().split('T')[0];
  const backupPath = path.join(BACKUP_DIR, `bookings-${dateStr}.json`);
  if (fs.existsSync(BOOKINGS_FILE)) {
    fs.copyFileSync(BOOKINGS_FILE, backupPath);
    const backups = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith('bookings-')).sort();
    while (backups.length > 30) {
      const oldFile = backups.shift();
      try { fs.unlinkSync(path.join(BACKUP_DIR, oldFile)); } catch {}
    }
    console.log('Backup skapad:', backupPath);
  }
});

// ---- Auth ----
function requireAdmin(req, res, next) {
  if (req.cookies.admin === 'true') return next();
  res.status(401).json({ error: 'Unauthorized' });
}
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    res.cookie('admin', 'true', {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProd,
      maxAge: 12 * 60 * 60 * 1000
    });
    return res.json({ success: true });
  }
  res.status(401).json({ success: false });
});
app.post('/api/logout', (req, res) => {
  res.clearCookie('admin', {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd
  });
  res.json({ success: true });
});

// ---- API ----
app.get('/api/availability', (req, res) => { res.json(loadBookings()); });
app.get('/api/calendar', requireAdmin, (req, res) => { res.json(loadBookings()); });

// Ny route för att kolla betalningsstatus
app.get('/api/payment-status/:id', (req, res) => {
    const { id } = req.params;
    const data = loadBookings();

    // Kolla om bokningen finns bland de slutförda (betalda) bokningarna
    const isPaid = data.bookings.some(b => b.id === id);

    if (isPaid) {
        res.json({ status: 'PAID' });
    } else {
        res.json({ status: 'PENDING' });
    }
});

app.post('/api/remove', requireAdmin, (req, res) => {
  const { id } = req.body || {};
  const data = loadBookings();
  const before = { b: data.bookings.length, bl: data.blocks.length };
  data.bookings = data.bookings.filter(b => b.id !== id);
  data.blocks = data.blocks.filter(b => b.id !== id);
  saveBookings(data);
  res.json({ success: true, removed: { bookings: before.b - data.bookings.length, blocks: before.bl - data.blocks.length } });
});
app.post('/api/block', requireAdmin, (req, res) => {
  const { startDate, endDate } = req.body || {};
  if (!startDate || !endDate) return res.status(400).json({ error: 'startDate och endDate krävs' });
  const data = loadBookings();
  const hasCollision = [...data.bookings, ...data.blocks].some(r => rangesOverlap(startDate, endDate, r.startDate, r.endDate));
  if (hasCollision) return res.status(409).json({ error: 'Intervallet krockar med befintlig bokning/block.' });
  const id = Date.now().toString();
  data.blocks.push({ id, startDate, endDate });
  saveBookings(data);
  res.json({ success: true, id });
});

// Manuell + Swish-bokning i samma endpoint
app.post('/api/book', async (req, res) => {
  const { startDate, endDate, name, phone, email, manual } = req.body || {};
  if (!startDate || !endDate || !name || !phone || !email) {
    return res.status(400).json({ error: 'Alla fält krävs.' });
  }

  const cleanStart = String(startDate).split('T')[0];
  const cleanEnd = String(endDate).split('T')[0];

  const data = loadBookings();
  const collision = [...data.bookings, ...data.blocks].some(r => rangesOverlap(cleanStart, cleanEnd, r.startDate, r.endDate));
  if (collision) return res.status(409).json({ error: 'Valt intervall är upptaget.' });

  const id = Date.now().toString();
  const booking = { id, startDate: cleanStart, endDate: cleanEnd, name, phone, email };

  const dayCount = daysInclusive(booking.startDate, booking.endDate);
  const totalPrice = dayCount * DAILY_RATE_SEK;

  if (manual && req.cookies.admin === 'true') {
    data.bookings.push(booking);
    saveBookings(data);
    await safeSendMail({
      from: process.env.MAIL_FROM,
      to: process.env.ADMIN_EMAIL || process.env.SMTP_USER,
      subject: 'Ny manuell bokning',
      text: `Namn: ${booking.name}\nDatum: ${booking.startDate} – ${booking.endDate}\nTotalsumma: ${totalPrice} kr`
    });
    return res.json({ success: true, booking });
  }

  if (!swishAgent) {
    return res.status(500).json({ error: 'Swish-betalning är inte konfigurerad korrekt på servern.' });
  }

  const instructionUUID = crypto.randomUUID();
  console.log('Skapade Swish-förfrågan med UUID:', instructionUUID);

  const cleanPhone = String(phone).trim();
const cleanPayeeAlias = String(process.env.SWISH_PAYEE_ALIAS).trim();
const amountAsString = totalPrice.toFixed(2);

  const swishPayload = {
  payeePaymentReference: booking.id,
  callbackUrl: `https://personallagenhet.se/api/swish-callback`,
  payerAlias: cleanPhone, // Använd den rensade variabeln
  payeeAlias: cleanPayeeAlias, // Använd den rensade variabeln
  amount: amountAsString, // Använd strängen istället för talet
  currency: 'SEK',
  message: `Bokning Fackens lgh ${booking.startDate}`
  };

  console.log('Skickar följande payload till Swish:', swishPayload);

  try {
  const response = await axios.put(
  `${process.env.SWISH_API_URL}/api/v2/paymentrequests/${instructionUUID}`, // <--- /api är tillbaka!
  swishPayload,
  { httpsAgent: swishAgent }
);

    const paymentRequestToken = response.headers['paymentrequesttoken'];
    
    //QRkod 
    const qrCode = await qrcode.toDataURL(paymentRequestToken);
    
    pendingBookings[instructionUUID] = booking;

    setTimeout(() => { if (pendingBookings[instructionUUID]) delete pendingBookings[instructionUUID]; }, 5 * 60 * 1000);

     res.json({ paymentRequestToken, qrCode, bookingId: booking.id });

  } catch (err) {
    console.error('Fel vid skapande av Swish-betalning:', err.response ? err.response.data : err.message);
    res.status(500).json({ error: 'Kunde inte initiera betalning med Swish.' });
  }
}); // <-- HÄR SLUTAR /api/book-ROUTEN

// ---- CALLBACK-ROUTE FÖR SWISH ----
app.post('/api/swish-callback', (req, res) => {
  const paymentData = req.body;
  console.log('Swish Callback mottagen:', paymentData);

  const booking = pendingBookings[paymentData.id];

  if (booking && paymentData.status === 'PAID') {
    const data = loadBookings();
    const collision = [...data.bookings, ...data.blocks].some(r => rangesOverlap(booking.startDate, booking.endDate, r.startDate, r.endDate));

    if (!collision) {
        data.bookings.push(booking);
        saveBookings(data);
        console.log(`Bokning ${booking.id} slutförd och sparad.`);

        // ---- SKICKA BEKRÄFTELSEMAIL ----
        const dayCount = daysInclusive(booking.startDate, booking.endDate);
        const totalPrice = dayCount * DAILY_RATE_SEK;
        const fmt = (iso) => { const d = parseLocalDate(iso); return `${String(d.getDate()).padStart(2,'0')}-${String(d.getMonth()+1).padStart(2,'0')}-${d.getFullYear()}`; };
        const htmlMail = `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:20px;border:1px solid #ddd;border-radius:8px;">
            <h2 style="color:#003366;">Bokningsbekräftelse – Fackens lägenhet 722 Huvudsta</h2>
            <p>Hej <strong>${booking.name}</strong>,</p>
            <p>Din bokning är nu bekräftad för perioden:</p>
            <p style="font-size:16px;color:#003366;"><strong>${fmt(booking.startDate)} – ${fmt(booking.endDate)}</strong></p>
            <p><strong>Totalkostnad:</strong> ${totalPrice} kr (${DAILY_RATE_SEK} kr per dag)</p>
            <p style="font-size:14px;line-height:1.5;">Kom ihåg att ta med eget sänglinne och handdukar. Nyckel hämtas/lämnas på Infocenter Kalix kommun.</p>
            <p>Tack för din bokning!</p>
          </div>`;
        safeSendMail({ from: process.env.MAIL_FROM || 'Fackens <no-reply@example.com>', to: booking.email, subject: 'Bokningsbekräftelse – Fackens lägenhet 722 Huvudsta', html: htmlMail });
        safeSendMail({ from: process.env.MAIL_FROM || 'Fackens <no-reply@example.com>', to: process.env.ADMIN_EMAIL || process.env.SMTP_USER || '', subject: 'Ny bokning bekräftad', text: `Namn: ${booking.name}\nDatum: ${booking.startDate} – ${booking.endDate}\nTel: ${booking.phone}\nE‑post: ${booking.email}\nSumma: ${totalPrice} kr` });

    } else {
        console.warn(`Kollision upptäckt för Swish-betalning, bokning ${booking.id} slutförs ej.`);
    }
    delete pendingBookings[paymentData.id];
  } else if (booking) {
    delete pendingBookings[paymentData.id];
  }

  res.status(200).send();
}); // <-- HÄR SLUTAR /api/swish-callback-ROUTEN

app.get('/api/statistics', requireAdmin, (req, res) => {
  const data = loadBookings();
  const year = new Date().getFullYear();
  const months = Array.from({ length: 12 }, () => ({ count: 0, revenue: 0 }));
  data.bookings.forEach(b => {
    const start = parseLocalDate(b.startDate); const end = parseLocalDate(b.endDate);
    if (start.getFullYear() !== year && end.getFullYear() !== year) return;
    const days = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
    const idx = start.getMonth();
    months[idx].count += 1; months[idx].revenue += days * DAILY_RATE_SEK;
  });
  const totalBookings = months.reduce((s, m) => s + m.count, 0);
  const totalRevenue = months.reduce((s, m) => s + m.revenue, 0);
  res.json({ year, months, totalBookings, totalRevenue });
});

app.get('/api/ping', (_req, res) => res.json({ ok: true }));

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Serverfel' });
});

app.listen(PORT, () => console.log(`Servern körs på port ${PORT}`));