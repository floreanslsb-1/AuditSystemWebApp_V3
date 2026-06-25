// ============================================================
//  CacheService.gs — v2 (refactored)
//  Perubahan dari v1:
//  - Hapus: CacheService_getChecklistByAgenda() dan _refreshAgendaCache()
//    karena AGENDA_CHECKLIST sudah tidak ada — checklist di-snapshot
//    langsung ke AUDIT_RESULTS saat agenda dibuat (populateAuditResults)
//  - CacheService_forceRefresh() dan _refreshCache() juga dihapus
//    karena tidak ada lagi cache per-area untuk checklist
//  - Yang dipertahankan: CacheService_invalidateMaster(), invalidateProfileCache(),
//    dan semua helper CACHE_META sheet (_isCacheInvalidated, _setCacheMetaRow,
//    _setCacheMetaInvalidated) — masih dipakai oleh SheetService dan AuthService
// ============================================================


// ════════════════════════════════════════════════════════════
//  CHECKLIST MASTER — invalidasi saat master diubah
// ════════════════════════════════════════════════════════════

/**
 * Invalidasi cache checklist master.
 * Dipanggil oleh createChecklistItem, updateChecklistItem, batchDeleteChecklistItems,
 * dan batchCreateChecklistItems di SheetService setiap kali master diubah.
 */
function CacheService_invalidateMaster() {
  _setCacheMetaInvalidated('CHECKLIST_ALL', true);
  console.log('Checklist master cache invalidated.');
}


// ════════════════════════════════════════════════════════════
//  CACHE_META SHEET — helpers baca/tulis flag invalidasi
// ════════════════════════════════════════════════════════════

/**
 * Cek apakah cache key ditandai invalidated di sheet CACHE_META.
 * @param  {string}  cacheKey
 * @returns {boolean}
 */
function _isCacheInvalidated(cacheKey) {
  const sheet = _getMasterSheet(CONFIG.SHEETS.CACHE_META);
  if (sheet.getLastRow() < 4) return false;
  const data = sheet.getRange(4, 1, sheet.getLastRow() - 3, 3).getValues();
  const row  = data.find(r => r[0] === cacheKey);
  if (!row) return false;
  return row[2] === true || row[2] === 'TRUE';
}

/**
 * Update atau insert satu baris di CACHE_META.
 * @param {string}  cacheKey
 * @param {boolean} invalidated
 */
function _setCacheMetaRow(cacheKey, invalidated) {
  const sheet = _getMasterSheet(CONFIG.SHEETS.CACHE_META);
  if (sheet.getLastRow() >= 4) {
    const data = sheet.getRange(4, 1, sheet.getLastRow() - 3, 4).getValues();
    const idx  = data.findIndex(r => r[0] === cacheKey);
    if (idx !== -1) {
      const rowIndex = idx + 4;
      sheet.getRange(rowIndex, 2).setValue(now());
      sheet.getRange(rowIndex, 3).setValue(invalidated);
      return;
    }
  }
  sheet.appendRow([cacheKey, now(), invalidated, '']);
}

/**
 * Hanya update kolom invalidated di CACHE_META (tanpa menyentuh last_updated).
 * @param {string}  cacheKey
 * @param {boolean} invalidated
 */
function _setCacheMetaInvalidated(cacheKey, invalidated) {
  const sheet = _getMasterSheet(CONFIG.SHEETS.CACHE_META);
  if (sheet.getLastRow() < 4) {
    if (invalidated) sheet.appendRow([cacheKey, now(), true, '']);
    return;
  }
  const data = sheet.getRange(4, 1, sheet.getLastRow() - 3, 3).getValues();
  const idx  = data.findIndex(r => r[0] === cacheKey);
  if (idx !== -1) {
    sheet.getRange(idx + 4, 3).setValue(invalidated);
    if (invalidated) sheet.getRange(idx + 4, 2).setValue(now());
  } else if (invalidated) {
    sheet.appendRow([cacheKey, now(), true, '']);
  }
}

function clearAllCaches() {
  invalidateUsersCache();
  invalidateAreasCache();
  invalidatePeriodsCache();
  CacheService_invalidateMaster();
  console.log('Semua cache dikosongkan.');
}
