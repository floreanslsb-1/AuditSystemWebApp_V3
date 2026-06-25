// ============================================================
//  Utils.gs
//  Helper functions — dipakai di seluruh project
// ============================================================


// ── ID Generator ─────────────────────────────────────────────────

/**
 * Generate unique ID dengan prefix dan timestamp
 * Dipakai untuk LOG, TPP, dan entitas internal lain
 */
function generateId(prefix) {
  const now = new Date();
  const datePart = Utilities.formatDate(now, 'Asia/Jakarta', 'yyyyMMdd_HHmmss');
  const randPart = Math.random().toString(36).substring(2, 6);
  return `${prefix}_${datePart}_${randPart}`;
}

/**
 * Buat slug dari teks bebas — uppercase, non-alphanumeric jadi _, max N karakter
 * @param {string} text
 * @param {number} maxLen  default 30
 */
function _slugify(text, maxLen) {
  maxLen = maxLen || 30;
  return String(text || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')  // non-alphanumeric → underscore
    .replace(/^_+|_+$/g, '')       // trim underscore di awal/akhir
    .substring(0, maxLen);
}

/**
 * Generate period_id dari nama periode yang dimasukkan koordinator
 * Format: PRD_[SLUG_NAMA]
 * e.g. "Internal Integrasi 2026" → "PRD_INTERNAL_INTEGRASI_2026"
 */
function generatePeriodId(namaPeriode) {
  return 'PRD_' + _slugify(namaPeriode, 40);
}

/**
 * Generate agenda_id dari period_id + nama dept area
 * Format: AGN_[SLUG_PERIOD]_[SLUG_DEPT]
 * e.g. period="PRD_INTERNAL_INTEGRASI_2026", dept="IMS" → "AGN_INTERNAL_INTEGRASI_2026_IMS"
 */
function generateAgendaId(periodId, dept) {
  const periodSlug = String(periodId || '').replace(/^PRD_/, '');
  const deptSlug   = _slugify(dept, 20);
  return 'AGN_' + periodSlug + '_' + deptSlug;
}

/**
 * Generate result_id dari nama dept + nomor urut dalam agenda
 * Format: RES_[SLUG_DEPT]_[NNN]
 * e.g. dept="IMS", counter=3 → "RES_IMS_003"
 * Aman karena result hanya ada dalam satu file periode (tidak cross-periode)
 */
function generateResultId(dept, counter) {
  const deptSlug = _slugify(dept, 20);
  return 'RES_' + deptSlug + '_' + String(counter).padStart(3, '0');
}


/**
 * Generate ID pendek berurutan berdasarkan jumlah data existing
 * Dipakai untuk ID yang human-readable: USR_001, AREA_003, dll
 * @param {string} prefix
 * @param {number} existingCount  jumlah row data yang sudah ada
 * @returns {string}
 */
function generateSequentialId(prefix, existingCount) {
  const num = String(existingCount + 1).padStart(3, '0');
  return `${prefix}_${num}`;
}


// ── Date & Time ──────────────────────────────────────────────────

/**
 * Timestamp sekarang dalam timezone Jakarta
 * @returns {string}  e.g. '2025-07-01 14:30:22'
 */
function now() {
  return new Date().toISOString(); // e.g. "2026-06-03T03:00:00.000Z"
}

/**
 * Format tanggal ke yyyy-MM-dd
 * @param {Date|string} date
 * @returns {string}
 */
function formatDate(date) {
  if (!date) return '';
  const d = (date instanceof Date) ? date : new Date(date);
  return Utilities.formatDate(d, 'Asia/Jakarta', 'yyyy-MM-dd');
}

/**
 * Format ISO timestamp ke "Senin, 08 Juni 2026 13.10 WIB"
 * Dipakai di email untuk semua field datetime
 * @param {string|Date} ts  ISO string atau Date object
 * @returns {string}
 */
function formatDatetimeWIB(ts) {
  if (!ts) return '-';
  const d = (ts instanceof Date) ? ts : new Date(ts);
  if (isNaN(d.getTime())) return String(ts);
  const HARI = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];
  const BULAN = ['Januari','Februari','Maret','April','Mei','Juni',
                 'Juli','Agustus','September','Oktober','November','Desember'];
  // Konversi ke WIB (UTC+7)
  const wib   = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  const hari  = HARI[wib.getUTCDay()];
  const tgl   = String(wib.getUTCDate()).padStart(2, '0');
  const bln   = BULAN[wib.getUTCMonth()];
  const thn   = wib.getUTCFullYear();
  const jam   = String(wib.getUTCHours()).padStart(2, '0');
  const mnt   = String(wib.getUTCMinutes()).padStart(2, '0');
  return `${hari}, ${tgl} ${bln} ${thn} ${jam}.${mnt} WIB`;
}

/**
 * Format ISO date / yyyy-MM-dd ke "Senin, 08 Juni 2026" (tanpa jam)
 * Dipakai di email untuk field target_date
 * @param {string|Date} ts
 * @returns {string}
 */
function formatDateOnlyWIB(ts) {
  if (!ts) return '-';
  const d = (ts instanceof Date) ? ts : new Date(ts);
  if (isNaN(d.getTime())) return String(ts);
  const HARI = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];
  const BULAN = ['Januari','Februari','Maret','April','Mei','Juni',
                 'Juli','Agustus','September','Oktober','November','Desember'];
  const wib  = new Date(d.getTime() + 7 * 60 * 60 * 1000);
  const hari = HARI[wib.getUTCDay()];
  const tgl  = String(wib.getUTCDate()).padStart(2, '0');
  const bln  = BULAN[wib.getUTCMonth()];
  const thn  = wib.getUTCFullYear();
  return `${hari}, ${tgl} ${bln} ${thn}`;
}

/**
 * Cek apakah sebuah lock sudah timeout
 * @param {string} lockedAt  timestamp string
 * @returns {boolean}
 */
function isLockExpired(lockedAt) {
  if (!lockedAt) return true;
  const lockTime = new Date(lockedAt).getTime();
  const timeoutMs = CONFIG.LOCK_TIMEOUT_MINUTES * 60 * 1000;
  return (Date.now() - lockTime) > timeoutMs;
}


// ── String & Array Helpers ───────────────────────────────────────

/**
 * Parse string comma-separated jadi array, trim tiap item
 * @param {string} str  e.g. 'a@x.com, b@x.com , c@x.com'
 * @returns {string[]}
 */
function parseCSV(str) {
  if (!str) return [];
  return String(str).split(',').map(s => s.trim()).filter(Boolean);
}

/**
 * Gabung array jadi string comma-separated
 * @param {string[]} arr
 * @returns {string}
 */
function toCSV(arr) {
  if (!Array.isArray(arr)) return '';
  return arr.filter(Boolean).join(',');
}

/**
 * Cek apakah email ada dalam string comma-separated
 * @param {string} csvEmails
 * @param {string} email
 * @returns {boolean}
 */
function emailInCSV(csvEmails, email) {
  return parseCSV(csvEmails).includes(email.trim().toLowerCase());
}

/**
 * Normalize email ke lowercase
 * @param {string} email
 * @returns {string}
 */
function normalizeEmail(email) {
  return (email || '').trim().toLowerCase();
}

/**
 * Escape HTML untuk mencegah XSS di output Web App
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}


// ── Response Builder ─────────────────────────────────────────────

/**
 * Standar response sukses untuk doPost/doGet handler
 * @param {*}      data     payload
 * @param {string} message  pesan opsional
 * @returns {Object}
 */
function successResponse(data, message = 'OK') {
  return { success: true, message, data };
}

/**
 * Standar response error
 * @param {string} message  pesan error
 * @param {number} code     error code opsional
 * @returns {Object}
 */
function errorResponse(message, code = 400) {
  return { success: false, message, code };
}

/**
 * Wrap response jadi ContentService JSON output
 * @param {Object} obj
 * @returns {ContentService.TextOutput}
 */
function jsonOutput(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}


// ── Email Sender ─────────────────────────────────────────────────

/**
 * Kirim notifikasi email
 * @param {string|string[]} to       satu email atau array
 * @param {string}          subject
 * @param {string}          htmlBody HTML body
 */
function sendEmail(to, subject, htmlBody) {
  if (!CONFIG.NOTIFICATIONS_ENABLED) {
    console.log('[Notif DISABLED] To:', Array.isArray(to) ? to.join(',') : to, '| Subject:', subject);
    return;
  }

  const originalRecipients = Array.isArray(to) ? to.join(', ') : to;

  // ── TEST MODE: semua email diarahkan ke satu alamat ──────────
  // Selama CONFIG.TEST_MODE_EMAIL terisi, tidak ada satupun email
  // yang dikirim ke penerima asli — semua masuk ke alamat testing.
  if (CONFIG.TEST_MODE_EMAIL) {
    try {
      GmailApp.sendEmail(
        CONFIG.TEST_MODE_EMAIL,
        '[TEST] ' + subject,
        '',
        {
          htmlBody:
            '<div style="font-family:Arial,sans-serif;background:#fff3cd;border:2px solid #ffc107;' +
            'padding:12px 16px;border-radius:6px;margin-bottom:24px;font-size:12px;line-height:1.6">' +
            '<strong>⚠ TEST MODE AKTIF</strong><br>' +
            'Email ini seharusnya dikirim ke: <strong>' + originalRecipients + '</strong><br>' +
            'Selama TEST_MODE_EMAIL terisi di Config.gs, semua notifikasi akan diarahkan ke alamat ini.' +
            '</div>' + htmlBody,
          name: 'Audit System - Integrated Management System',
        }
      );
      console.log('[TEST MODE] Email dikirim ke ' + CONFIG.TEST_MODE_EMAIL + ' (asli: ' + originalRecipients + ') | Subject: ' + subject);
    } catch (e) {
      console.error('sendEmail TEST MODE error:', e.message);
    }
    return; // ← hard stop: tidak ada jalur lain ke GmailApp setelah ini
  }

  // ── PRODUCTION: kirim ke penerima asli ───────────────────────
  try {
    GmailApp.sendEmail(originalRecipients, subject, '', {
      htmlBody,
      name: 'Audit System - Integrated Management System',
    });
    console.log('[Notif SENT] To:', originalRecipients, '| Subject:', subject);
  } catch (e) {
    console.error('sendEmail error:', e.message);
  }
}

/**
 * Template email standar sistem
 * @param {string} title    judul utama
 * @param {string} body     konten HTML (paragraf, list, dll)
 * @param {string} ctaLabel teks tombol CTA (opsional)
 * @param {string} ctaUrl   URL tombol CTA (opsional)
 * @returns {string}        HTML string
 */
function emailTemplate(title, body, ctaLabel = '', ctaUrl = '') {
  const cta = ctaLabel && ctaUrl
    ? `<div style="margin:24px 0;">
         <a href="${ctaUrl}" style="background:#1F3864;color:#fff;padding:12px 24px;
            border-radius:4px;text-decoration:none;font-weight:bold;">${ctaLabel}</a>
       </div>`
    : '';
  return `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#333;">
      <div style="background:#1F3864;padding:18px 24px;">
        <div style="color:#fff;font-size:16px;font-weight:bold;margin-bottom:4px;">Audit System</div>
        <div style="color:rgba(255,255,255,.65);font-size:12px;">Integrated Management System</div>
      </div>
      <div style="padding:24px;border:1px solid #e0e0e0;border-top:none;">
        <h3 style="color:#1F3864;margin-top:0;">${title}</h3>
        ${body}
        ${cta}
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
        <p style="font-size:11px;color:#999;">
          Email ini dikirim otomatis oleh sistem. Jangan balas email ini.
        </p>
      </div>
    </div>`;
}


// ── Google Drive Helpers ─────────────────────────────────────────

/**
 * Ambil atau buat folder di Drive
 * @param {string}              name          nama folder
 * @param {DriveApp.Folder}     parentFolder  parent (opsional, default root)
 * @returns {DriveApp.Folder}
 */
function getOrCreateFolder(name, parentFolder = null) {
  const parent = parentFolder || DriveApp.getRootFolder();
  const folders = parent.getFoldersByName(name);
  if (folders.hasNext()) return folders.next();
  return parent.createFolder(name);
}

/**
 * Buat struktur folder untuk satu finding
 * Path: AUDIT_SYSTEM / {period_id} / {area_id} / {finding_id}
 * @param {string} periodId
 * @param {string} areaId
 * @param {string} findingId
 * @returns {DriveApp.Folder}
 */
function createFindingFolder(periodId, areaId, findingId) {
  const root    = getOrCreateFolder(CONFIG.DRIVE_ROOT_FOLDER_NAME);
  const period  = getOrCreateFolder(periodId, root);
  const area    = getOrCreateFolder(areaId, period);
  return getOrCreateFolder(findingId, area);
}

/**
 * Upload file ke folder finding
 * @param {string} base64Data   base64 encoded file content
 * @param {string} fileName
 * @param {string} mimeType
 * @param {DriveApp.Folder} folder
 * @returns {string}  URL file di Drive
 */
function uploadFileToDrive(base64Data, fileName, mimeType, folder) {
  Logger.log('[1-INPUT] fileName=' + fileName + ' mimeType=' + mimeType + ' base64Len=' + (base64Data ? base64Data.length : 'null'));

  var cleanBase64 = base64Data;
  var commaIdx = base64Data.indexOf(',');
  if (commaIdx >= 0) cleanBase64 = base64Data.substring(commaIdx + 1);
  cleanBase64 = cleanBase64.replace(/\s/g, '');
  Logger.log('[2-CLEAN] cleanBase64Len=' + cleanBase64.length + ' first16=' + cleanBase64.substring(0, 16) + ' last4=' + cleanBase64.substring(cleanBase64.length - 4));

  Logger.log('[3-PRE-DECODE] about to call Utilities.base64Decode');
  var decoded = Utilities.base64Decode(cleanBase64);
  Logger.log('[4-POST-DECODE] decodedLen=' + decoded.length);

  Logger.log('[5-PRE-BLOB] about to call Utilities.newBlob');
  var blob = Utilities.newBlob(decoded, mimeType || 'application/octet-stream', fileName);
  Logger.log('[6-POST-BLOB] blobName=' + blob.getName() + ' blobSize=' + blob.getBytes().length);

  Logger.log('[7-PRE-CREATE] about to call folder.createFile');
  var file = folder.createFile(blob);
  Logger.log('[8-POST-CREATE] fileId=' + file.getId());

  // setSharing ANYONE_WITH_LINK diblokir domain policy — pakai DOMAIN saja
  try {
    file.setSharing(DriveApp.Access.DOMAIN_WITH_LINK, DriveApp.Permission.VIEW);
  } catch(e) {
    Logger.log('[SHARING-WARN] setSharing gagal (non-fatal): ' + e.message);
    // Lanjut tanpa sharing — file tetap bisa diakses via service account
  }
  var url = 'https://drive.google.com/uc?export=view&id=' + file.getId();
  Logger.log('[9-DONE] url=' + url);
  return url;
}


// ── Validation Helpers ───────────────────────────────────────────

/**
 * Validasi format email
 * @param {string} email
 * @returns {boolean}
 */
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Validasi bahwa semua field required tidak kosong
 * @param {Object}   data
 * @param {string[]} requiredFields
 * @returns {{ valid: boolean, missing: string[] }}
 */
function validateRequired(data, requiredFields) {
  const missing = requiredFields.filter(f => !data[f] && data[f] !== false && data[f] !== 0);
  return { valid: missing.length === 0, missing };
}

/**
 * Cek apakah nilai masuk dalam enum yang diijinkan
 * @param {*}     value
 * @param {Array} allowed
 * @returns {boolean}
 */
function isValidEnum(value, allowed) {
  return allowed.includes(value);
}

/**
 * Ambil konten file Drive sebagai base64 data URI — server-side, bypass firewall IT.
 * Supports: https://drive.google.com/uc?export=view&id=FILE_ID
 *           https://drive.google.com/file/d/FILE_ID/view
 */
function getDriveFileBase64(fileUrl) {
  try {
    var fileId = null;
    var m1 = fileUrl.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    var m2 = fileUrl.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (m1) fileId = m1[1];
    else if (m2) fileId = m2[1];
    if (!fileId) throw new Error('File ID tidak ditemukan dari URL: ' + fileUrl);

    var cache = CacheService.getScriptCache();
    var cacheKey = 'driveimg_' + fileId;
    var cached = cache.get(cacheKey);
    if (cached) return cached;

    var file = DriveApp.getFileById(fileId);
    var blob = file.getBlob();
    var mime = blob.getContentType() || 'image/jpeg';
    var b64  = Utilities.base64Encode(blob.getBytes());
    var dataUri = 'data:' + mime + ';base64,' + b64;

    // Cache 6 jam
    try { cache.put(cacheKey, dataUri, 21600); } catch(e) { /* terlalu besar untuk cache, skip */ }
    return dataUri;
  } catch(e) {
    Logger.log('[getDriveFileBase64] gagal: ' + e.message + ' url=' + fileUrl);
    return null;
  }
}

/**
 * Hapus file dari Google Drive berdasarkan URL-nya.
 * Mendukung format:
 *   https://drive.google.com/uc?export=view&id=FILE_ID
 *   https://drive.google.com/file/d/FILE_ID/view
 * @param {string} fileUrl
 */
function deleteDriveFile(fileUrl) {
  try {
    var fileId = null;
    var m1 = fileUrl.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    var m2 = fileUrl.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (m1) fileId = m1[1];
    else if (m2) fileId = m2[1];
    if (!fileId) throw new Error('File ID tidak ditemukan dari URL: ' + fileUrl);
    DriveApp.getFileById(fileId).setTrashed(true);
    Logger.log('[deleteDriveFile] berhasil hapus fileId=' + fileId);
  } catch(e) {
    Logger.log('[deleteDriveFile] gagal: ' + e.message + ' url=' + fileUrl);
    throw e;
  }
}
