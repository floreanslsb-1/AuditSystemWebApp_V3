// ============================================================
//  Maintenance.gs
//  Helper script untuk maintenance manual — TIDAK di-expose
//  ke web app. Jalankan langsung dari Apps Script editor:
//  Run > checkOrphanFotoUrls (dry run dulu)
//  Run > fixOrphanFotoUrls   (setelah yakin dengan hasilnya)
// ============================================================


// ── CONFIG — ubah sesuai kebutuhan sebelum dijalankan ──────────

/** Nama dept yang mau dicek. Harus sama persis dengan nilai kolom dept di AUDIT_AGENDA. */
var MAINT_TARGET_DEPT = 'SOP - Production'; // e.g. 'Produksi', 'QC', 'IMS'

/**
 * Kosongkan = pakai periode AKTIF.
 * Isi period_id spesifik kalau mau cek periode lain
 * (e.g. periode yang sudah selesai tapi masih ada broken URL-nya).
 * e.g. 'PRD_INTERNAL_INTEGRASI_2026'
 */
var MAINT_TARGET_PERIOD_ID = '';

// ───────────────────────────────────────────────────────────────


// ════════════════════════════════════════════════════════════
//  ENTRY POINTS — run salah satu dari Apps Script editor
// ════════════════════════════════════════════════════════════

/**
 * DRY RUN — hanya log, tidak ubah apapun di sheet.
 * Jalankan ini dulu untuk lihat berapa banyak broken URL
 * sebelum memutuskan untuk fix.
 */
function checkOrphanFotoUrls() {
  _runMaintenance(true);
}

/**
 * FIX — hapus broken URL dari sheet.
 * Jalankan setelah checkOrphanFotoUrls dan sudah yakin dengan hasilnya.
 * HANYA menyentuh row di dept yang di-set di MAINT_TARGET_DEPT.
 */
function fixOrphanFotoUrls() {
  _runMaintenance(false);
}


// ════════════════════════════════════════════════════════════
//  CORE
// ════════════════════════════════════════════════════════════

function _runMaintenance(dryRun) {
  // ── 1. Resolve periode ────────────────────────────────────
  var period = MAINT_TARGET_PERIOD_ID
    ? getPeriodById(MAINT_TARGET_PERIOD_ID)
    : getActivePeriod();

  if (!period || !period.spreadsheet_id) {
    Logger.log('[MAINT] ERROR: Periode tidak ditemukan. Cek MAINT_TARGET_PERIOD_ID.');
    return;
  }

  Logger.log('====================================================');
  Logger.log('[MAINT] ' + (dryRun ? 'DRY RUN — tidak ada yang diubah' : 'FIX MODE — akan update sheet'));
  Logger.log('[MAINT] Periode  : ' + period.period_id + ' (' + (period.nama_periode || '-') + ')');
  Logger.log('[MAINT] Dept     : ' + MAINT_TARGET_DEPT);
  Logger.log('[MAINT] File     : ' + period.spreadsheet_id);
  Logger.log('====================================================');

  // ── 2. Cari agenda IDs untuk dept ini ────────────────────
  var allAgendas = getAgendasByPeriod(period.period_id);
  var targetAgendas = allAgendas.filter(function(a) {
    return a.dept === MAINT_TARGET_DEPT;
  });

  if (!targetAgendas.length) {
    Logger.log('[MAINT] WARN: Tidak ada agenda untuk dept "' + MAINT_TARGET_DEPT + '".');
    Logger.log('[MAINT] Dept yang tersedia: ' + _mnt_uniqueDepts(allAgendas).join(', '));
    return;
  }

  var targetAgendaIds = targetAgendas.map(function(a) { return a.agenda_id; });
  Logger.log('[MAINT] Agenda ditemukan (' + targetAgendaIds.length + '): ' + targetAgendaIds.join(', '));

  // ── 3. Baca AUDIT_RESULTS ─────────────────────────────────
  var sheet = SpreadsheetApp.openById(period.spreadsheet_id)
    .getSheetByName('AUDIT_RESULTS');

  if (!sheet) {
    Logger.log('[MAINT] ERROR: Sheet AUDIT_RESULTS tidak ditemukan di spreadsheet ini.');
    return;
  }

  var lastRow = sheet.getLastRow();
  if (lastRow < 3) {
    Logger.log('[MAINT] INFO: Sheet kosong (lastRow=' + lastRow + '). Tidak ada data.');
    return;
  }

  // Baca semua kolom yang ada (pakai lastColumn agar aman lintas schema)
  var totalCols = sheet.getLastColumn();
  var data = sheet.getRange(3, 1, lastRow - 2, totalCols).getValues();
  Logger.log('[MAINT] Total row dibaca: ' + data.length + ' | Total kolom: ' + totalCols);

  // ── 4. Kolom foto yang dicek ──────────────────────────────
  // Deteksi otomatis dari header row (row 2) agar tidak hardcode index
  var headerRow = sheet.getRange(2, 1, 1, totalCols).getValues()[0];
  var FOTO_COL_NAMES = ['foto_urls', 'impl_correction_foto_urls', 'impl_corrective_action_foto_urls'];
  var FOTO_COLS = [];
  headerRow.forEach(function(h, i) {
    if (FOTO_COL_NAMES.indexOf(String(h).trim()) !== -1) {
      FOTO_COLS.push({ name: String(h).trim(), idx: i });
    }
  });

  if (!FOTO_COLS.length) {
    Logger.log('[MAINT] WARN: Tidak ada kolom foto ditemukan di header. Cek sheet AUDIT_RESULTS.');
    return;
  }
  Logger.log('[MAINT] Kolom foto ditemukan: ' + FOTO_COLS.map(function(c){ return c.name + '(col' + (c.idx+1) + ')'; }).join(', '));

  // ── 5. Scan per row ───────────────────────────────────────
  var totalUrlChecked = 0;
  var totalUrlBroken  = 0;
  var totalRowFixed   = 0;
  var report          = [];

  data.forEach(function(row, i) {
    var resultId = String(row[0]  || '').trim();
    var agendaId = String(row[1]  || '').trim();
    var rowIndex = i + 3; // 1-indexed sheet row

    // Skip kalau bukan agenda dept target
    if (!resultId || targetAgendaIds.indexOf(agendaId) === -1) return;

    var rowHadFix = false;

    FOTO_COLS.forEach(function(col) {
      var raw = String(row[col.idx] || '').trim();
      if (!raw) return;

      var urls   = raw.split(',').filter(function(u) { return u.trim(); });
      var valid  = [];
      var broken = [];

      urls.forEach(function(url) {
        url = url.trim();
        var fileId = _mnt_extractFileId(url);

        if (!fileId) {
          Logger.log('[SKIP] row=' + rowIndex + ' result_id=' + resultId +
            ' | ' + col.name + ' | format tidak dikenal: ' + url);
          valid.push(url);
          return;
        }

        totalUrlChecked++;
        var status = _mnt_fileStatus(fileId);
        if (status === 'ok') {
          valid.push(url);
        } else {
          broken.push(url);
          totalUrlBroken++;
          Logger.log('[BROKEN] row=' + rowIndex + ' result_id=' + resultId +
            ' | ' + col.name + ' | fileId=' + fileId + ' | reason=' + status + ' | url=' + url);
          report.push({
            row:       rowIndex,
            result_id: resultId,
            col:       col.name,
            fileId:    fileId,
            reason:    status,
          });
        }
      });

      // Fix: update cell hanya kalau ada URL yang broken dan bukan dry run
      if (broken.length > 0 && !dryRun) {
        sheet.getRange(rowIndex, col.idx + 1).setValue(valid.join(','));
        rowHadFix = true;
        Logger.log('[FIXED] row=' + rowIndex + ' result_id=' + resultId +
          ' | ' + col.name +
          ' | dihapus=' + broken.length +
          ' | tersisa=' + valid.length);
      }
    });

    if (rowHadFix) totalRowFixed++;
  });

  // ── 6. Ringkasan ──────────────────────────────────────────
  Logger.log('====================================================');
  Logger.log('[MAINT] SELESAI');
  Logger.log('[MAINT] Total URL dicek   : ' + totalUrlChecked);
  Logger.log('[MAINT] Total URL broken  : ' + totalUrlBroken);
  Logger.log('[MAINT] Row diupdate      : ' + totalRowFixed);

  if (totalUrlBroken === 0) {
    Logger.log('[MAINT] ✓ Semua URL valid. Tidak ada orphan.');
  } else if (dryRun) {
    Logger.log('[MAINT] ⚠ DRY RUN — belum ada yang diubah.');
    Logger.log('[MAINT]   Jalankan fixOrphanFotoUrls() untuk fix otomatis.');
  } else {
    Logger.log('[MAINT] ✓ Fix selesai. ' + totalUrlBroken + ' URL dihapus dari sheet.');
  }
  Logger.log('====================================================');
}


// ════════════════════════════════════════════════════════════
//  PRIVATE HELPERS (prefix _mnt_ agar tidak konflik)
// ════════════════════════════════════════════════════════════

/**
 * Ekstrak Google Drive file ID dari berbagai format URL.
 * Supports:
 *   https://drive.google.com/uc?export=view&id=FILE_ID
 *   https://drive.google.com/file/d/FILE_ID/view
 * @param  {string} url
 * @returns {string|null}
 */
function _mnt_extractFileId(url) {
  var m1 = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  var m2 = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (m1) return m1[1];
  if (m2) return m2[1];
  return null;
}

/**
 * Cek status file Drive:
 *   'ok'      → file ada dan tidak di trash
 *   'trashed' → file ada tapi sudah di trash (dihapus manual dari Drive)
 *   'missing' → file tidak ditemukan / permanently deleted / no access
 *
 * @param  {string} fileId
 * @returns {'ok'|'trashed'|'missing'}
 */
function _mnt_fileStatus(fileId) {
  try {
    var file = DriveApp.getFileById(fileId);
    return file.isTrashed() ? 'trashed' : 'ok';
  } catch(e) {
    return 'missing';
  }
}

/**
 * Ambil list unique dept dari array agenda.
 */
function _mnt_uniqueDepts(agendas) {
  var depts = {};
  agendas.forEach(function(a) { if (a.dept) depts[a.dept] = true; });
  return Object.keys(depts).sort();
}
