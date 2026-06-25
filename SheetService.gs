// ============================================================
//  SheetService.gs — v2 FINAL (refactored + lengkap)
//
//  Perubahan dari v1:
//  - Hapus SESSIONS, FINDINGS, AGENDA_CHECKLIST
//  - AUDIT_RESULTS: 21 kolom, pre-populated saat agenda dibuat (Opsi B)
//  - session_id → agenda_id di semua sheet file audit
//  - finding_id → result_id di TPP_ITEMS dan APPROVAL_LOG
//  - Fungsi baru: populateAuditResults, startAudit, finishAudit,
//    submitAgreement, verifyFindings, resetAgendaData, archiveAgendaToFile,
//    getAuditResultsByAgenda, getFindingsByAgenda, updateResultField
//  - Fungsi lama yang tidak berubah tetap ada lengkap
// ============================================================


// ════════════════════════════════════════════════════════════
//  INTERNAL HELPERS
// ════════════════════════════════════════════════════════════

function _getMasterSS() {
  return SpreadsheetApp.openById(CONFIG.MASTER_SPREADSHEET_ID);
}
function _getMasterSheet(sheetName) {
  return _getMasterSS().getSheetByName(sheetName);
}
function _getAuditSS(spreadsheetId) {
  return SpreadsheetApp.openById(spreadsheetId);
}
function _getAuditSheet(spreadsheetId, sheetName) {
  return _getAuditSS(spreadsheetId).getSheetByName(sheetName);
}

// Baca sheet mulai baris 3 (baris 1: judul, baris 2: header)
function _sheetToObjects(sheet, headers) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 3) return [];
  const data = sheet.getRange(3, 1, lastRow - 2, headers.length).getValues();
  return data
    .filter(row => row[0] !== '')
    .map((row, i) => {
      const obj = { _rowIndex: i + 3 };
      headers.forEach((h, j) => { obj[h] = row[j]; });
      return obj;
    });
}

function _appendRow(sheet, rowData) {
  sheet.appendRow(rowData);
  return sheet.getLastRow();
}
function _updateRow(sheet, rowIndex, rowData) {
  sheet.getRange(rowIndex, 1, 1, rowData.length).setValues([rowData]);
}
function _updateCell(sheet, rowIndex, colIndex, value) {
  sheet.getRange(rowIndex, colIndex).setValue(value);
}

// Hapus semua baris di sheet file audit yang kolom ke-colIdx nilainya = matchValue
function _deleteRowsByColValue(spreadsheetId, sheetName, colIdx, matchValue) {
  var sheet = _getAuditSheet(spreadsheetId, sheetName);
  if (sheet.getLastRow() < 3) return 0;
  var data     = sheet.getRange(3, 1, sheet.getLastRow() - 2, colIdx + 1).getValues();
  var toDelete = [];
  data.forEach(function(row, i) {
    if (String(row[colIdx]) === String(matchValue)) toDelete.push(i + 3);
  });
  toDelete.reverse().forEach(function(r) { sheet.deleteRow(r); });
  return toDelete.length;
}

/**
 * Update foto_urls pada AUDIT_RESULTS secara langsung (tidak menunggu batch save).
 * Dipanggil segera setelah file Drive dihapus dari form audit.
 * foto_urls = col 16 (1-indexed), result_id = col 1. Data mulai row 3.
 */
function updateAuditResultFotoUrls(spreadsheetId, resultId, fotoUrls) {
  const sheet = _getAuditSheet(spreadsheetId, 'AUDIT_RESULTS');
  if (!sheet) throw new Error('Sheet AUDIT_RESULTS tidak ditemukan.');
  const lastRow = sheet.getLastRow();
  if (lastRow < 3) throw new Error('Tidak ada data di AUDIT_RESULTS.');
  const ids = sheet.getRange(3, 1, lastRow - 2, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(resultId)) {
      sheet.getRange(i + 3, 16).setValue(fotoUrls); // col 16 = foto_urls
      return;
    }
  }
  throw new Error('Result tidak ditemukan: ' + resultId);
}


// ════════════════════════════════════════════════════════════
//  MASTER — USERS
// ════════════════════════════════════════════════════════════

const USER_HEADERS = ['user_id', 'email', 'nama', 'roles', 'aktif'];
const USERS_CACHE_KEY = 'USERS_ALL';

function getCachedUsers() {
  const cache = CacheService.getScriptCache();
  if (_isCacheInvalidated(USERS_CACHE_KEY)) return _refreshUsersCache();
  const cached = cache.get(USERS_CACHE_KEY);
  if (cached) { try { return JSON.parse(cached); } catch(e) {} }
  return _refreshUsersCache();
}

function _refreshUsersCache() {
  const data = getAllUsers();
  try {
    CacheService.getScriptCache().put(USERS_CACHE_KEY, JSON.stringify(data), 21600);
  } catch(e) { console.warn('Users cache put failed:', e.message); }
  _setCacheMetaRow(USERS_CACHE_KEY, false);
  return data;
}

function invalidateUsersCache() {
  CacheService.getScriptCache().remove(USERS_CACHE_KEY);
  _setCacheMetaInvalidated(USERS_CACHE_KEY, true);
}

function getAllUsers() {
  return _sheetToObjects(_getMasterSheet(CONFIG.SHEETS.USERS), USER_HEADERS);
}

function getUserByEmail(email) {
  return getAllUsers().find(u => normalizeEmail(u.email) === normalizeEmail(email)) || null;
}

function createUser({ email, nama, roles }) {
  const sheet    = _getMasterSheet(CONFIG.SHEETS.USERS);
  const existing = getAllUsers();
  if (existing.find(u => normalizeEmail(u.email) === normalizeEmail(email)))
    throw new Error('Email ' + email + ' sudah terdaftar.');
  if (!isAllowedDomain(normalizeEmail(email)))
    throw new Error('Email harus menggunakan domain @' + CONFIG.ALLOWED_DOMAIN);
  const rolesArr   = parseRoles(roles);
  const validRoles = [CONFIG.ROLES.KOORDINATOR, CONFIG.ROLES.AUDITOR];
  const bad        = rolesArr.find(r => !validRoles.includes(r));
  if (bad) throw new Error('Role tidak valid: ' + bad + '. Pilih dari: ' + validRoles.join(', '));
  if (!rolesArr.length) throw new Error('Minimal satu role harus dipilih.');
  const user_id = generateSequentialId('USR', existing.length);
  _appendRow(sheet, [user_id, normalizeEmail(email), nama, toCSV(rolesArr), true]);
  invalidateUsersCache();
  return { user_id, email, nama, roles: rolesArr };
}

function updateUser(email, updates) {
  const sheet = _getMasterSheet(CONFIG.SHEETS.USERS);
  const users = getAllUsers();
  const user  = users.find(u => normalizeEmail(u.email) === normalizeEmail(email));
  if (!user) throw new Error('User ' + email + ' tidak ditemukan.');
  if (updates.roles !== undefined) {
    const rolesArr   = parseRoles(updates.roles);
    const validRoles = [CONFIG.ROLES.KOORDINATOR, CONFIG.ROLES.AUDITOR];
    rolesArr.forEach(r => {
      if (!validRoles.includes(r)) throw new Error('Role tidak valid: ' + r);
    });
    updates.roles = toCSV(rolesArr);
  }
  const C = CONFIG.COLS.USERS;
  if (updates.nama  !== undefined) _updateCell(sheet, user._rowIndex, C.NAMA  + 1, updates.nama);
  if (updates.email !== undefined) _updateCell(sheet, user._rowIndex, C.EMAIL + 1, normalizeEmail(updates.email));
  if (updates.roles !== undefined) _updateCell(sheet, user._rowIndex, C.ROLES + 1, updates.roles);
  invalidateUsersCache();
  return { success: true };
}

function deleteUser(email) {
  const sheet = _getMasterSheet(CONFIG.SHEETS.USERS);
  const user  = getAllUsers().find(u => normalizeEmail(u.email) === normalizeEmail(email));
  if (!user) throw new Error('User tidak ditemukan: ' + email);
  sheet.deleteRow(user._rowIndex);
  invalidateUsersCache();
  return { success: true };
}

function batchDeleteUsers(emails) {
  const sheet   = _getMasterSheet(CONFIG.SHEETS.USERS);
  const users   = getAllUsers();
  const targets = emails.map(e => normalizeEmail(e.trim())).filter(Boolean);
  const rows    = [];
  const skipped = [];
  targets.forEach(function(email) {
    const user = users.find(u => normalizeEmail(u.email) === email);
    if (!user) { skipped.push({ email, reason: 'User tidak ditemukan.' }); return; }
    rows.push(user._rowIndex);
  });
  rows.sort((a, b) => b - a).forEach(r => sheet.deleteRow(r));
  if (rows.length > 0) invalidateUsersCache();
  return { deleted: rows.length, skipped };
}

function batchCreateUsers(items) {
  const sheet          = _getMasterSheet(CONFIG.SHEETS.USERS);
  const existing       = getAllUsers();
  const existingEmails = existing.map(u => normalizeEmail(u.email));
  const validRoles     = [CONFIG.ROLES.KOORDINATOR, CONFIG.ROLES.AUDITOR];
  const rows    = [];
  const skipped = [];
  let   counter = existing.length;
  items.forEach(function(item) {
    const email = normalizeEmail((item.email || '').trim());
    const nama  = (item.nama || '').trim();
    if (!email || !nama) {
      skipped.push({ email: email || '(kosong)', reason: 'Email dan nama wajib diisi.' }); return;
    }
    if (!isAllowedDomain(email)) {
      skipped.push({ email, reason: 'Domain harus @' + CONFIG.ALLOWED_DOMAIN }); return;
    }
    if (existingEmails.includes(email)) {
      skipped.push({ email, reason: 'Email sudah terdaftar.' }); return;
    }
    const rolesArr    = parseRoles(item.roles || '');
    const invalidRole = rolesArr.find(r => !validRoles.includes(r));
    if (invalidRole || rolesArr.length === 0) {
      skipped.push({ email, reason: 'Role tidak valid. Gunakan: Koordinator, Auditor.' }); return;
    }
    const user_id = generateSequentialId('USR', counter++);
    existingEmails.push(email);
    rows.push([user_id, email, nama, toCSV(rolesArr), true]);
  });
  if (rows.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
    invalidateUsersCache(); 
  }
  return { created: rows.length, skipped };
}

function getAllKoordinators() {
  return getAllUsers().filter(u => {
    const roles = parseRoles(u.roles);
    return roles.includes(CONFIG.ROLES.KOORDINATOR) && (u.aktif === true || u.aktif === 'TRUE');
  });
}

function getUniqueDepts() {
  return [...new Set(getActiveAreas().map(a => a.dept).filter(Boolean))].sort();
}


// ════════════════════════════════════════════════════════════
//  MASTER — AREAS
// ════════════════════════════════════════════════════════════

const AREA_HEADERS = [
  'area_id','kategori','dept',
  'dept_head_email','dept_head_name','area_sampling',
  'auditee_emails','auditee_names','aktif'
];

const AREAS_CACHE_KEY = 'AREAS_ALL';

function getAllAreas() {
  return _sheetToObjects(_getMasterSheet(CONFIG.SHEETS.AREAS), AREA_HEADERS);
}

function getActiveAreas() {
  return getAllAreas().filter(a => a.aktif === true || a.aktif === 'TRUE');
}

function getAreaById(areaId) {
  return getAllAreas().find(a => a.area_id === areaId) || null;
}

function getCachedAreas() {
  const cache = CacheService.getScriptCache();
  if (_isCacheInvalidated(AREAS_CACHE_KEY)) return _refreshAreasCache();
  const cached = cache.get(AREAS_CACHE_KEY);
  if (cached) { try { return JSON.parse(cached); } catch(e) {} }
  return _refreshAreasCache();
}

function _refreshAreasCache() {
  const data = getAllAreas();
  try {
    CacheService.getScriptCache().put(AREAS_CACHE_KEY, JSON.stringify(data), 21600);
  } catch(e) { console.warn('Areas cache put failed:', e.message); }
  _setCacheMetaRow(AREAS_CACHE_KEY, false);
  return data;
}

function invalidateAreasCache() {
  CacheService.getScriptCache().remove(AREAS_CACHE_KEY);
  _setCacheMetaInvalidated(AREAS_CACHE_KEY, true);
}

function createArea({ kategori, dept, dept_head_email, dept_head_name = '', area_sampling = '', auditee_emails = '', auditee_names = '' }) {
  const sheet    = _getMasterSheet(CONFIG.SHEETS.AREAS);
  const existing = getAllAreas();
  if (!isValidEnum(kategori, CONFIG.KATEGORI)) throw new Error('Kategori tidak valid: ' + kategori);
  const area_id = generateSequentialId('AREA', existing.length);
  _appendRow(sheet, [area_id, kategori, dept, dept_head_email, dept_head_name, area_sampling, auditee_emails, auditee_names, true]);
  invalidateAreasCache(); 
  return { area_id, kategori, dept };
}

function updateArea(areaId, updates) {
  const sheet = _getMasterSheet(CONFIG.SHEETS.AREAS);
  const area  = getAllAreas().find(a => a.area_id === areaId);
  if (!area) throw new Error('Area ' + areaId + ' tidak ditemukan.');
  const C = CONFIG.COLS.AREAS;
  if (updates.kategori        !== undefined) _updateCell(sheet, area._rowIndex, C.KATEGORI        + 1, updates.kategori);
  if (updates.dept            !== undefined) _updateCell(sheet, area._rowIndex, C.DEPT            + 1, updates.dept);
  if (updates.dept_head_email !== undefined) _updateCell(sheet, area._rowIndex, C.DEPT_HEAD_EMAIL + 1, updates.dept_head_email);
  if (updates.dept_head_name  !== undefined) _updateCell(sheet, area._rowIndex, C.DEPT_HEAD_NAME  + 1, updates.dept_head_name);
  if (updates.area_sampling   !== undefined) _updateCell(sheet, area._rowIndex, C.AREA_SAMPLING   + 1, updates.area_sampling);
  if (updates.auditee_emails  !== undefined) _updateCell(sheet, area._rowIndex, C.AUDITEE_EMAILS  + 1, updates.auditee_emails);
  if (updates.auditee_names   !== undefined) _updateCell(sheet, area._rowIndex, C.AUDITEE_NAMES   + 1, updates.auditee_names);
  if (updates.aktif           !== undefined) _updateCell(sheet, area._rowIndex, C.AKTIF           + 1, updates.aktif);
  invalidateAreasCache();
  // Invalidate semua profile cache agar isAuditee / isDeptHead langsung refresh
  invalidateAllProfileCaches();

  // ── Sync ke agenda aktif yang menggunakan area ini ──────────
  // Hanya sync kalau ada perubahan di auditee_emails atau dept_head_email
  if (updates.auditee_emails !== undefined || updates.dept_head_email !== undefined) {
    // Sync semua agenda non-COMPLETED — termasuk DONE, karena auditee masih perlu isi TPP
    const activeAgendas = getAllAgendas().filter(function(ag) {
      return ag.area_id === areaId;
    });
    if (activeAgendas.length > 0) {
      const agendaSheet = _getMasterSheet(CONFIG.SHEETS.AUDIT_AGENDA);
      const CA          = CONFIG.COLS.AUDIT_AGENDA;
      activeAgendas.forEach(function(ag) {
        if (updates.auditee_emails  !== undefined)
          _updateCell(agendaSheet, ag._rowIndex, CA.AUDITEE_EMAILS  + 1, updates.auditee_emails);
        if (updates.dept_head_email !== undefined)
          _updateCell(agendaSheet, ag._rowIndex, CA.DEPT_HEAD_EMAIL + 1, updates.dept_head_email);
        // Invalidate cache agenda per periode
        invalidateAgendasCache(ag.period_id);
      });
    }
  }

  return { success: true };
}

function deleteArea(areaId) {
  const sheet = _getMasterSheet(CONFIG.SHEETS.AREAS);
  const area  = getAllAreas().find(a => a.area_id === areaId);
  if (!area) throw new Error('Area tidak ditemukan: ' + areaId);
  sheet.deleteRow(area._rowIndex);
  invalidateAreasCache();
  return { success: true };
}

function batchDeleteAreas(areaIds) {
  const sheet   = _getMasterSheet(CONFIG.SHEETS.AREAS);
  const areas   = getAllAreas();
  const rows    = [];
  const skipped = [];
  areaIds.forEach(function(areaId) {
    const area = areas.find(a => a.area_id === areaId);
    if (!area) { skipped.push({ area_id: areaId, reason: 'Area tidak ditemukan.' }); return; }
    rows.push(area._rowIndex);
  });
  rows.sort((a, b) => b - a).forEach(r => sheet.deleteRow(r));
  if (rows.length > 0) invalidateAreasCache();
  return { deleted: rows.length, skipped };
}

function batchCreateAreas(items) {
  const sheet         = _getMasterSheet(CONFIG.SHEETS.AREAS);
  const existing      = getAllAreas();
  const existingDepts = existing.map(a => a.dept.toLowerCase().trim());
  const rows    = [];
  const skipped = [];
  let   counter = existing.length;
  items.forEach(function(item) {
    const dept     = (item.dept || '').trim();
    const kategori = (item.kategori || '').trim();
    if (!dept || !(item.dept_head_email || '').trim()) {
      skipped.push({ dept: dept || '(kosong)', reason: 'Dept dan Dept Head wajib diisi.' }); return;
    }
    if (!(item.auditee_emails || '').trim()) {
      skipped.push({ dept, reason: 'Auditee wajib diisi.' }); return;
    }
    if (!isValidEnum(kategori, CONFIG.KATEGORI)) {
      skipped.push({ dept, reason: 'Kategori tidak valid: ' + kategori }); return;
    }
    if (existingDepts.includes(dept.toLowerCase())) {
      skipped.push({ dept, reason: 'Dept sudah terdaftar.' }); return;
    }
    const area_id = generateSequentialId('AREA', counter++);
    existingDepts.push(dept.toLowerCase());
    rows.push([
      area_id, kategori, dept,
      item.dept_head_email || '', item.dept_head_name || '',
      item.area_sampling   || '',
      item.auditee_emails  || '', item.auditee_names  || '',
      true
    ]);
  });
  if (rows.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
    invalidateAreasCache();
  }
  return { created: rows.length, skipped };
}


// ════════════════════════════════════════════════════════════
//  MASTER — CHECKLIST_MASTER
// ════════════════════════════════════════════════════════════

const CHECKLIST_MASTER_HEADERS = [
  'item_id','tipe','kategori','nomor','aspek',
  'persyaratan','check_item','standar_check_item','labels','aktif'
];

function getAllChecklistMaster() {
  const sheet = _getMasterSheet(CONFIG.SHEETS.CHECKLIST_MASTER);
  if (sheet.getLastRow() < 3) return [];
  const data = sheet.getRange(3, 1, sheet.getLastRow() - 2, CHECKLIST_MASTER_HEADERS.length).getValues();
  return data.filter(r => r[0] !== '').map((row, i) => {
    const obj = { _rowIndex: i + 3 };
    CHECKLIST_MASTER_HEADERS.forEach((h, j) => { obj[h] = row[j]; });
    return obj;
  });
}

function getChecklistGeneral() {
  return getAllChecklistMaster()
    .filter(t => t.tipe === 'GENERAL' && (t.aktif === true || t.aktif === 'TRUE'))
    .sort((a, b) => Number(a.nomor) - Number(b.nomor));
}

function getChecklistKhusus(kategori) {
  return getAllChecklistMaster()
    .filter(t => t.tipe === 'KHUSUS' && t.kategori === kategori && (t.aktif === true || t.aktif === 'TRUE'))
    .sort((a, b) => Number(a.nomor) - Number(b.nomor));
}

function generateChecklistId(tipe, kategori, existing) {
  const prefixMap = {
    'Laboratorium': 'L', 'Office': 'O', 'Maintenance': 'M',
    'Produksi': 'P', 'Gudang': 'W',
  };
  const prefix = tipe === 'GENERAL' ? 'G' : (prefixMap[kategori] || 'X');
  const count  = existing.filter(i => i && i.item_id && String(i.item_id).startsWith(prefix + '_')).length;
  return prefix + '_' + String(count + 1).padStart(3, '0');
}

function createChecklistItem({ tipe, kategori = '', nomor, aspek, persyaratan, check_item, standar_check_item = '', labels = '' }) {
  const sheet    = _getMasterSheet(CONFIG.SHEETS.CHECKLIST_MASTER);
  const existing = getAllChecklistMaster();
  const item_id  = generateChecklistId(tipe, kategori, existing);
  sheet.appendRow([item_id, tipe, kategori, nomor, aspek, persyaratan, check_item, standar_check_item, labels, true]);
  CacheService_invalidateMaster();
  return { item_id };
}

function updateChecklistItem(itemId, updates) {
  const sheet = _getMasterSheet(CONFIG.SHEETS.CHECKLIST_MASTER);
  const item  = getAllChecklistMaster().find(x => x.item_id === itemId);
  if (!item) throw new Error('Item ' + itemId + ' tidak ditemukan.');
  const C      = CONFIG.COLS.CHECKLIST_MASTER;
  const fields = ['tipe','kategori','nomor','aspek','persyaratan','check_item','standar_check_item','labels','aktif'];
  const cols   = [C.TIPE, C.KATEGORI, C.NOMOR, C.ASPEK, C.PERSYARATAN, C.CHECK_ITEM, C.STANDAR_CHECK_ITEM, C.LABELS, C.AKTIF];
  fields.forEach((f, i) => {
    if (updates[f] !== undefined) _updateCell(sheet, item._rowIndex, cols[i] + 1, updates[f]);
  });
  CacheService_invalidateMaster();
  return { success: true };
}

function batchDeleteChecklistItems(itemIds) {
  const sheet   = _getMasterSheet(CONFIG.SHEETS.CHECKLIST_MASTER);
  const items   = getAllChecklistMaster();
  const rows    = [];
  const skipped = [];
  itemIds.forEach(function(id) {
    const item = items.find(x => x.item_id === id);
    if (!item) { skipped.push({ item_id: id, reason: 'Item tidak ditemukan.' }); return; }
    rows.push(item._rowIndex);
  });
  rows.sort((a, b) => b - a).forEach(r => sheet.deleteRow(r));
  if (rows.length > 0) CacheService_invalidateMaster();
  return { deleted: rows.length, skipped };
}

function batchCreateChecklistItems(tipe, kategori, items) {
  const sheet    = _getMasterSheet(CONFIG.SHEETS.CHECKLIST_MASTER);
  const existing = getAllChecklistMaster();
  const sameScope = existing.filter(x =>
    x.tipe === tipe && (tipe === 'GENERAL' || x.kategori === kategori)
  );
  let nextNomor = sameScope.length > 0
    ? Math.max(...sameScope.map(x => Number(x.nomor) || 0)) + 1
    : 1;
  const rows    = [];
  const skipped = [];
  items.forEach(function(item) {
    const aspek       = (item.aspek || '').trim();
    const persyaratan = (item.persyaratan || '').trim();
    const check_item  = (item.check_item || '').trim();
    const standar     = (item.standar_check_item || '').trim();
    if (!aspek || !persyaratan || !check_item) {
      skipped.push({ check_item: check_item || '(kosong)', reason: 'Aspek, persyaratan, dan check item wajib diisi.' }); return;
    }
    const item_id = generateChecklistId(tipe, kategori, [...existing, ...rows.map(r => ({ item_id: r[0] }))]);
    rows.push([item_id, tipe, kategori, nextNomor++, aspek, persyaratan, check_item, standar, (item.labels || '').trim(), true]);
  });
  if (rows.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
    CacheService_invalidateMaster();
  }
  return { created: rows.length, skipped };
}


// ════════════════════════════════════════════════════════════
//  MASTER — AUDIT_REGISTRY
// ════════════════════════════════════════════════════════════

const REGISTRY_HEADERS = [
  'period_id','nama_periode','spreadsheet_id','spreadsheet_url',
  'tanggal_mulai','tanggal_selesai','status','created_by','created_at',
  'archived','archived_at','completed_at'
];

const PERIODS_CACHE_KEY = 'PERIODS_ALL';

function getCachedPeriods(includeArchived) {
  const cache = CacheService.getScriptCache();
  if (_isCacheInvalidated(PERIODS_CACHE_KEY)) return _refreshPeriodsCache(includeArchived);
  const cached = cache.get(PERIODS_CACHE_KEY);
  if (cached) {
    try {
      const all = JSON.parse(cached);
      return includeArchived ? all : all.filter(p => !p.archived || p.archived === 'FALSE' || p.archived === false);
    } catch(e) {}
  }
  return _refreshPeriodsCache(includeArchived);
}

function _refreshPeriodsCache(includeArchived) {
  const data = getAllPeriods(true); // selalu simpan semua (termasuk archived)
  try {
    CacheService.getScriptCache().put(PERIODS_CACHE_KEY, JSON.stringify(data), 21600);
  } catch(e) { console.warn('Periods cache put failed:', e.message); }
  _setCacheMetaRow(PERIODS_CACHE_KEY, false);
  return includeArchived ? data : data.filter(p => !p.archived || p.archived === 'FALSE' || p.archived === false);
}

function invalidatePeriodsCache() {
  CacheService.getScriptCache().remove(PERIODS_CACHE_KEY);
  _setCacheMetaInvalidated(PERIODS_CACHE_KEY, true);
}

function getAllPeriods(includeArchived) {
  const all = _sheetToObjects(_getMasterSheet(CONFIG.SHEETS.AUDIT_REGISTRY), REGISTRY_HEADERS);
  return includeArchived ? all : all.filter(p => !p.archived || p.archived === 'FALSE' || p.archived === false);
}

function getPeriodById(periodId) {
  return getAllPeriods(true).find(p => p.period_id === periodId) || null;
}

function getActivePeriod() {
  return getAllPeriods(false).find(p => p.status === CONFIG.PERIOD_STATUS.ACTIVE) || null;
}

function createPeriod({ namaPeriode, tanggalMulai, tanggalSelesai, createdBy }) {
  // Validasi nama tidak boleh kosong
  const namaTrim = (namaPeriode || '').trim();
  if (!namaTrim) throw new Error('Nama periode tidak boleh kosong.');

  // Validasi nama tidak boleh sama persis dengan yang sudah ada (case-insensitive)
  const existing = getAllPeriods(true);
  const duplikat = existing.find(p =>
    (p.nama_periode || '').trim().toLowerCase() === namaTrim.toLowerCase()
  );
  if (duplikat) throw new Error('Nama periode "' + namaTrim + '" sudah digunakan. Gunakan nama yang berbeda.');

  // Generate ID dari nama periode
  const period_id = generatePeriodId(namaTrim);

  // Cek ID tidak tabrakan (edge case: nama berbeda tapi slug identik)
  if (existing.find(p => p.period_id === period_id))
    throw new Error('ID periode "' + period_id + '" sudah ada. Coba gunakan nama yang lebih spesifik.');

  const { spreadsheet_id, spreadsheet_url } = _createAuditSpreadsheet(period_id, namaTrim);
  const sheet = _getMasterSheet(CONFIG.SHEETS.AUDIT_REGISTRY);
  _appendRow(sheet, [
    period_id, namaTrim, spreadsheet_id, spreadsheet_url,
    tanggalMulai, tanggalSelesai, CONFIG.PERIOD_STATUS.PLANNED,
    createdBy, now(), false, '', '',
  ]);
  invalidatePeriodsCache();
  return { period_id, spreadsheet_id, spreadsheet_url };
}

function updatePeriodStatus(periodId, status) {
  const sheet  = _getMasterSheet(CONFIG.SHEETS.AUDIT_REGISTRY);
  const period = getAllPeriods(true).find(p => p.period_id === periodId);
  if (!period) throw new Error('Period ' + periodId + ' tidak ditemukan.');
  const C = CONFIG.COLS.AUDIT_REGISTRY;
  _updateCell(sheet, period._rowIndex, C.STATUS + 1, status);
  if (status === CONFIG.PERIOD_STATUS.COMPLETED)
    _updateCell(sheet, period._rowIndex, C.COMPLETED_AT + 1, now());
  invalidatePeriodsCache();
  return { success: true };
}

function activatePeriod(periodId) {
  const existing = getAllPeriods(false).find(p => p.status === CONFIG.PERIOD_STATUS.ACTIVE);
  if (existing && existing.period_id !== periodId) {
    throw new Error('Sudah ada periode ACTIVE: ' + existing.nama_periode + '. Selesaikan dulu sebelum mengaktifkan yang baru.');
  }
  updatePeriodStatus(periodId, CONFIG.PERIOD_STATUS.ACTIVE);
  invalidatePeriodsCache();
  return { success: true };
}

function updatePeriod(periodId, updates) {
  const sheet  = _getMasterSheet(CONFIG.SHEETS.AUDIT_REGISTRY);
  const period = getAllPeriods(true).find(p => p.period_id === periodId);
  if (!period) throw new Error('Periode tidak ditemukan: ' + periodId);
  const C = CONFIG.COLS.AUDIT_REGISTRY;
  if (updates.nama_periode    !== undefined) _updateCell(sheet, period._rowIndex, C.NAMA_PERIODE    + 1, updates.nama_periode);
  if (updates.tanggal_mulai   !== undefined) _updateCell(sheet, period._rowIndex, C.TANGGAL_MULAI   + 1, updates.tanggal_mulai);
  if (updates.tanggal_selesai !== undefined) _updateCell(sheet, period._rowIndex, C.TANGGAL_SELESAI + 1, updates.tanggal_selesai);
  invalidatePeriodsCache();
  return { success: true };
}

function archivePeriod(periodId) {
  const sheet  = _getMasterSheet(CONFIG.SHEETS.AUDIT_REGISTRY);
  const period = getAllPeriods(true).find(p => p.period_id === periodId);
  if (!period) throw new Error('Periode tidak ditemukan: ' + periodId);
  if (period.status !== CONFIG.PERIOD_STATUS.COMPLETED)
    throw new Error('Hanya periode COMPLETED yang bisa diarsip.');
  const C = CONFIG.COLS.AUDIT_REGISTRY;
  _updateCell(sheet, period._rowIndex, C.ARCHIVED    + 1, true);
  _updateCell(sheet, period._rowIndex, C.ARCHIVED_AT + 1, now());
  invalidatePeriodsCache();
  return { success: true };
}

function restoreArchivedPeriod(periodId) {
  const sheet  = _getMasterSheet(CONFIG.SHEETS.AUDIT_REGISTRY);
  const period = getAllPeriods(true).find(p => p.period_id === periodId);
  if (!period) throw new Error('Periode tidak ditemukan: ' + periodId);
  const C = CONFIG.COLS.AUDIT_REGISTRY;
  _updateCell(sheet, period._rowIndex, C.ARCHIVED    + 1, false);
  _updateCell(sheet, period._rowIndex, C.ARCHIVED_AT + 1, '');
  invalidatePeriodsCache();
  return { success: true };
}

function deletePeriod(periodId) {
  const sheet  = _getMasterSheet(CONFIG.SHEETS.AUDIT_REGISTRY);
  const period = getAllPeriods(true).find(p => p.period_id === periodId);
  if (!period) throw new Error('Periode tidak ditemukan: ' + periodId);
  if (period.status === CONFIG.PERIOD_STATUS.ACTIVE)
    throw new Error('Periode ACTIVE tidak bisa dihapus.');
  if (period.status === CONFIG.PERIOD_STATUS.COMPLETED) {
    const completedAt = period.completed_at ? new Date(period.completed_at) : null;
    if (!completedAt) throw new Error('Tanggal completed tidak ditemukan. Hubungi administrator.');
    const earliestDelete = new Date(completedAt.getFullYear() + 4, 0, 1);
    if (new Date() < earliestDelete)
      throw new Error('Periode ini baru bisa dihapus mulai 1 Januari ' + (completedAt.getFullYear() + 4) + '.');
  }
  if (period.spreadsheet_id) {
    try { DriveApp.getFileById(period.spreadsheet_id).setTrashed(true); }
    catch(e) { console.warn('Gagal hapus file Drive:', e.message); }
  }
  const agendas = getAgendasByPeriod(periodId);
  if (agendas.length > 0) {
    const agendaSheet = _getMasterSheet(CONFIG.SHEETS.AUDIT_AGENDA);
    agendas.map(a => a._rowIndex).sort((a, b) => b - a).forEach(r => agendaSheet.deleteRow(r));
  }
  sheet.deleteRow(period._rowIndex);
  invalidatePeriodsCache();
  return { success: true };
}

function completePeriod(periodId, completedBy, force) {
  const period = getPeriodById(periodId);
  if (!period) throw new Error('Periode tidak ditemukan: ' + periodId);
  if (period.status === CONFIG.PERIOD_STATUS.COMPLETED)
    throw new Error('Periode sudah selesai.');

  // Tandai temuan yang sudah lewat target sebagai OVERDUE dulu
  try { markOverdueFindings(period.spreadsheet_id, periodId); }
  catch(e) { console.warn('markOverdue gagal:', e.message); }

  // Hitung temuan yang belum closed (masih dalam alur aktif)
  const FS = CONFIG.FINDING_STATUS;
  const openStatuses = [
    FS.PENDING_VERIFICATION,
    FS.OPEN,
    FS.TPP_OR_DEPT_HEAD, FS.TPP_OR_AUDITOR, FS.TPP_OR_KOORDINATOR,
    FS.OPEN_IMPL,
    FS.APP_DEPT_HEAD, FS.APP_AUDITOR, FS.APP_KOORDINATOR,
  ];
  const openFindings = getAuditResultsByPeriod(period.spreadsheet_id, periodId)
    .filter(function(r) { return openStatuses.indexOf(r.finding_status) !== -1; });

  // Masih ada yang open & belum di-force → minta konfirmasi ke frontend
  if (openFindings.length && !force) {
    return { requireConfirm: true, openCount: openFindings.length };
  }

  // Force: tandai sisa temuan belum CLOSED sebagai OVERDUE saat periode di-force-complete
  if (openFindings.length) {
    const sheetR = _getAuditSheet(period.spreadsheet_id, CONFIG.AUDIT_SHEETS.AUDIT_RESULTS);
    const C2     = CONFIG.AUDIT_COLS.AUDIT_RESULTS;
    openFindings.forEach(function(r) {
      _updateCell(sheetR, r._rowIndex, C2.FINDING_STATUS + 1, FS.OVERDUE);
    });
  }

  archiveAgendaToFile(periodId, period.spreadsheet_id);
  const sheet = _getMasterSheet(CONFIG.SHEETS.AUDIT_REGISTRY);
  const C     = CONFIG.COLS.AUDIT_REGISTRY;
  _updateCell(sheet, period._rowIndex, C.STATUS       + 1, CONFIG.PERIOD_STATUS.COMPLETED);
  _updateCell(sheet, period._rowIndex, C.COMPLETED_AT + 1, now());
  invalidatePeriodsCache();
  return { success: true };
}


// ════════════════════════════════════════════════════════════
//  MASTER — AUDIT_AGENDA
// ════════════════════════════════════════════════════════════

// PENTING: urutan kolom harus sama persis dengan sheet AUDIT_AGENDA di Master Spreadsheet
const AGENDA_HEADERS = [
  'agenda_id','period_id','area_id','dept','kategori',
  'auditor_emails','lead_auditor','auditee_emails','dept_head_email',
  'assigned_by','assigned_at',
  'status','started_by','started_at','area_sampling',
  'ofi',
  'agreement_foto_url','agreement_by','agreement_at','auditee_hadir_names'
];

function _agendaCacheKey(periodId) {
  return 'AGENDAS_' + periodId;
}

function getCachedAgendasByPeriod(periodId) {
  const key    = _agendaCacheKey(periodId);
  const cached = CacheService.getScriptCache().get(key);
  if (cached) { try { return JSON.parse(cached); } catch(e) {} }
  return _refreshAgendasCache(periodId);
}

function _refreshAgendasCache(periodId) {
  const data = getAllAgendas().filter(a => a.period_id === periodId);
  try {
    CacheService.getScriptCache().put(_agendaCacheKey(periodId), JSON.stringify(data), 21600);
  } catch(e) { console.warn('Agendas cache put failed:', e.message); }
  return data;
}

function invalidateAgendasCache(periodId) {
  if (!periodId) return;
  CacheService.getScriptCache().remove(_agendaCacheKey(periodId));
}

function getAllAgendas() {
  return _sheetToObjects(_getMasterSheet(CONFIG.SHEETS.AUDIT_AGENDA), AGENDA_HEADERS);
}

function getAgendasByPeriod(periodId) {
  return getAllAgendas().filter(a => a.period_id === periodId);
}

function getAgendaById(agendaId) {
  return getAllAgendas().find(a => a.agenda_id === agendaId) || null;
}

function getAgendaByAreaAndPeriod(areaId, periodId) {
  return getAllAgendas().find(a => a.area_id === areaId && a.period_id === periodId) || null;
}

function createAgenda({ periodId, areaId, auditorEmails, leadAuditor, assignedBy }) {
  const area = getAreaById(areaId);
  if (!area) throw new Error('Area tidak ditemukan: ' + areaId);
  if (getAgendaByAreaAndPeriod(areaId, periodId))
    throw new Error('Agenda untuk area ini sudah ada di periode ini.');
  const auditors = parseCSV(auditorEmails);
  if (!auditors.length) throw new Error('Minimal 1 auditor per area.');
  if (leadAuditor && !auditors.map(normalizeEmail).includes(normalizeEmail(leadAuditor)))
    throw new Error('Lead auditor harus merupakan salah satu dari auditor yang ditugaskan.');

  const agenda_id = generateAgendaId(periodId, area.dept);
  const sheet     = _getMasterSheet(CONFIG.SHEETS.AUDIT_AGENDA);
  const C         = CONFIG.COLS.AUDIT_AGENDA;
  const row       = new Array(Object.keys(C).length).fill('');
  row[C.AGENDA_ID]       = agenda_id;
  row[C.PERIOD_ID]       = periodId;
  row[C.AREA_ID]         = areaId;
  row[C.DEPT]            = area.dept;
  row[C.KATEGORI]        = area.kategori;
  row[C.AUDITOR_EMAILS]  = toCSV(auditors);
  row[C.LEAD_AUDITOR]    = leadAuditor || '';
  row[C.AUDITEE_EMAILS]  = area.auditee_emails  || '';
  row[C.DEPT_HEAD_EMAIL] = area.dept_head_email || '';
  row[C.ASSIGNED_BY]     = assignedBy;
  row[C.ASSIGNED_AT]     = now();
  row[C.STATUS]          = CONFIG.AGENDA_STATUS.PLANNED;
  _appendRow(sheet, row);
  invalidateAgendasCache(periodId);
  return { agenda_id };
}

function updateAgenda(agendaId, updates) {
  const sheet  = _getMasterSheet(CONFIG.SHEETS.AUDIT_AGENDA);
  const agenda = getAgendaById(agendaId);
  if (!agenda) throw new Error('Agenda tidak ditemukan: ' + agendaId);
  const C = CONFIG.COLS.AUDIT_AGENDA;
  if (updates.auditor_emails       !== undefined) _updateCell(sheet, agenda._rowIndex, C.AUDITOR_EMAILS       + 1, updates.auditor_emails);
  if (updates.lead_auditor         !== undefined) _updateCell(sheet, agenda._rowIndex, C.LEAD_AUDITOR         + 1, updates.lead_auditor);
  if (updates.status               !== undefined) _updateCell(sheet, agenda._rowIndex, C.STATUS               + 1, updates.status);
  if (updates.started_by           !== undefined) _updateCell(sheet, agenda._rowIndex, C.STARTED_BY           + 1, updates.started_by);
  if (updates.started_at           !== undefined) _updateCell(sheet, agenda._rowIndex, C.STARTED_AT           + 1, updates.started_at);
  if (updates.area_sampling        !== undefined) _updateCell(sheet, agenda._rowIndex, C.AREA_SAMPLING        + 1, updates.area_sampling);
  if (updates.ofi                  !== undefined) _updateCell(sheet, agenda._rowIndex, C.OFI                  + 1, updates.ofi);
  if (updates.agreement_foto_url   !== undefined) _updateCell(sheet, agenda._rowIndex, C.AGREEMENT_FOTO_URL   + 1, updates.agreement_foto_url);
  if (updates.agreement_by         !== undefined) _updateCell(sheet, agenda._rowIndex, C.AGREEMENT_BY         + 1, updates.agreement_by);
  if (updates.agreement_at         !== undefined) _updateCell(sheet, agenda._rowIndex, C.AGREEMENT_AT         + 1, updates.agreement_at);
  if (updates.auditee_hadir_names  !== undefined) _updateCell(sheet, agenda._rowIndex, C.AUDITEE_HADIR_NAMES  + 1, updates.auditee_hadir_names);
  invalidateAgendasCache(agenda.period_id);
  return { success: true };
}

function deleteAgenda(agendaId, periodId) {
  const period = getPeriodById(periodId);
  const agenda = getAgendaById(agendaId);
  if (!agenda) throw new Error('Agenda tidak ditemukan: ' + agendaId);
  if (period && period.spreadsheet_id) {
    if (agenda.status === CONFIG.AGENDA_STATUS.STARTED) {
      // Reset data audit dulu (kosongkan Grup 3 & 4 AUDIT_RESULTS)
      resetAgendaData(period.spreadsheet_id, agendaId);
    } else {
      // PLANNED: hapus baris AUDIT_RESULTS yang belum terisi
      _deleteRowsByColValue(period.spreadsheet_id,
        CONFIG.AUDIT_SHEETS.AUDIT_RESULTS,
        CONFIG.AUDIT_COLS.AUDIT_RESULTS.AGENDA_ID, agendaId);
    }
  }
  _getMasterSheet(CONFIG.SHEETS.AUDIT_AGENDA).deleteRow(agenda._rowIndex);
  invalidateAgendasCache(periodId);
  return { success: true };
}

/**
 * Reset data audit agenda yang sudah STARTED:
 * kosongkan Grup 3 & 4 di AUDIT_RESULTS (jangan hapus row),
 * hapus REQUIREMENT_LOCKS, APPROVAL_LOG, TPP_ITEMS untuk agenda ini.
 * Reset status agenda ke PLANNED.
 */
function resetAgendaData(spreadsheetId, agendaId) {
  const sheet   = _getAuditSheet(spreadsheetId, CONFIG.AUDIT_SHEETS.AUDIT_RESULTS);
  const C       = CONFIG.AUDIT_COLS.AUDIT_RESULTS;
  const results = getAuditResultsByAgenda(spreadsheetId, agendaId);
  const clearCols = [
    C.STATUS, C.DESKRIPSI_TEMUAN, C.LOKASI_TEMUAN, C.FOTO_URLS, C.AUDITOR_EMAIL, C.SAVED_AT,
    C.FINDING_STATUS, C.TARGET_DATE, C.IS_OVERDUE, C.CLOSED_AT
  ];
  results.forEach(function(r) {
    clearCols.forEach(function(col) { _updateCell(sheet, r._rowIndex, col + 1, ''); });
    _deleteRowsByColValue(spreadsheetId,
      CONFIG.AUDIT_SHEETS.TPP_ITEMS,
      CONFIG.AUDIT_COLS.TPP_ITEMS.RESULT_ID, r.result_id);
  });
  _deleteRowsByColValue(spreadsheetId,
    CONFIG.AUDIT_SHEETS.REQUIREMENT_LOCKS,
    CONFIG.AUDIT_COLS.REQUIREMENT_LOCKS.AGENDA_ID, agendaId);
  _deleteRowsByColValue(spreadsheetId,
    CONFIG.AUDIT_SHEETS.APPROVAL_LOG,
    CONFIG.AUDIT_COLS.APPROVAL_LOG.AGENDA_ID, agendaId);
  const agendaForReset = getAgendaById(agendaId);
  if (agendaForReset) invalidateAgendasCache(agendaForReset.period_id);
  updateAgenda(agendaId, { status: CONFIG.AGENDA_STATUS.PLANNED, started_by: '', started_at: '' });
  return { success: true };
}

/**
 * Arsipkan semua agenda periode ke sheet AGENDA di file periode, lalu hapus dari MASTER.
 * Dipanggil saat periode di-complete.
 */
function archiveAgendaToFile(periodId, spreadsheetId) {
  const agendas = getAgendasByPeriod(periodId);
  if (!agendas.length) return { success: true, count: 0 };

  const ss         = _getAuditSS(spreadsheetId);
  var archiveSheet = ss.getSheetByName(CONFIG.AUDIT_SHEETS.AGENDA);
  if (!archiveSheet) {
    archiveSheet = ss.insertSheet(CONFIG.AUDIT_SHEETS.AGENDA);
    archiveSheet.getRange(1, 1).setValue('AGENDA ARSIP — ' + periodId);
    archiveSheet.getRange(2, 1, 1, AGENDA_HEADERS.length).setValues([AGENDA_HEADERS]);
    archiveSheet.setFrozenRows(2);
  }

  const rows = agendas.map(function(a) {
    return [
      a.agenda_id, a.period_id, a.area_id, a.dept, a.kategori,
      a.auditor_emails, a.lead_auditor, a.auditee_emails, a.dept_head_email,
      a.assigned_by, a.assigned_at,
      a.status, a.started_by, a.started_at, a.area_sampling,
      a.ofi || '',
      a.agreement_foto_url, a.agreement_by, a.agreement_at, a.auditee_hadir_names
    ];
  });
  archiveSheet.getRange(archiveSheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);

  const masterSheet = _getMasterSheet(CONFIG.SHEETS.AUDIT_AGENDA);
  agendas.map(a => a._rowIndex).sort((a, b) => b - a).forEach(r => masterSheet.deleteRow(r));
  invalidateAgendasCache(periodId);
  return { success: true, count: agendas.length };
}


// ════════════════════════════════════════════════════════════
//  FILE AUDIT — SETUP SHEETS
// ════════════════════════════════════════════════════════════

function _createAuditSpreadsheet(periodId, namaPeriode) {
  const rootFolder   = getOrCreateFolder(CONFIG.DRIVE_ROOT_FOLDER_NAME);
  const periodFolder = getOrCreateFolder(periodId, rootFolder);
  const ss           = SpreadsheetApp.create('AUDIT_' + periodId);
  const file         = DriveApp.getFileById(ss.getId());
  periodFolder.addFile(file);
  DriveApp.getRootFolder().removeFile(file);
  _setupAuditSheets(ss, periodId, namaPeriode);
  return { spreadsheet_id: ss.getId(), spreadsheet_url: ss.getUrl() };
}

function _setupAuditSheets(ss, periodId, namaPeriode) {
  const HEADERS = {
    AUDIT_RESULTS: [
      'result_id','agenda_id','period_id',
      'item_id','tipe','kategori','nomor_persyaratan','check_item_no',
      'aspek','persyaratan','check_item','standar_check_item',
      'status','deskripsi_temuan','lokasi_temuan','foto_urls','auditor_email','saved_at',
      'finding_status','target_date','is_overdue','closed_at',
    ],
    TPP_ITEMS: [
      'tpp_item_id','result_id','tipe',
      'deskripsi','submitted_by','submitted_at',
      'impl_foto_urls','impl_keterangan','impl_submitted_at','impl_submitted_by',
    ],
    REQUIREMENT_LOCKS: [
      'lock_id','agenda_id','nomor_persyaratan','locked_by','locked_at','status',
    ],
    APPROVAL_LOG: [
      'log_id','result_id','agenda_id','stage','level','action',
      'by_email','at','komentar','skipped','skip_reason',
    ],
    AGENDA: [
      'agenda_id','period_id','area_id','dept','kategori',
      'auditor_emails','lead_auditor','auditee_emails','dept_head_email',
      'assigned_by','assigned_at',
      'status','started_by','started_at','area_sampling',
      'ofi',
      'agreement_foto_url','agreement_by','agreement_at','auditee_hadir_names',
    ],
  };
  const COLORS = {
    AUDIT_RESULTS: '375623', TPP_ITEMS: 'E06C4B',
    REQUIREMENT_LOCKS: '7030A0', APPROVAL_LOG: '404040', AGENDA: '2E75B6',
  };
  const defaultSheet = ss.getSheets()[0];
  Object.entries(HEADERS).forEach(([name, headers]) => {
    const ws = ss.insertSheet(name);
    ws.setTabColor(COLORS[name] || '404040');
    ws.getRange(1, 1, 1, headers.length).merge();
    const titleCell = ws.getRange(1, 1);
    titleCell.setValue('AUDIT ' + namaPeriode + ' — Sheet: ' + name);
    titleCell.setBackground('#1F3864');
    titleCell.setFontColor('#FFFFFF');
    titleCell.setFontWeight('bold');
    const headerRange = ws.getRange(2, 1, 1, headers.length);
    headerRange.setValues([headers]);
    headerRange.setBackground('#1F3864');
    headerRange.setFontColor('#FFFFFF');
    headerRange.setFontWeight('bold');
    headerRange.setHorizontalAlignment('center');
    ws.setFrozenRows(2);
    ws.setColumnWidths(1, headers.length, 160);
  });
  try { ss.deleteSheet(defaultSheet); } catch(e) {}
  const infoSheet = ss.insertSheet('_INFO', 0);
  infoSheet.setTabColor('404040');
  infoSheet.getRange('A1').setValue('File Audit: ' + namaPeriode);
  infoSheet.getRange('A2').setValue('Period ID: ' + periodId);
  infoSheet.getRange('A3').setValue('Dibuat: ' + now());
  infoSheet.getRange('A4').setValue('⚠️ Jangan edit file ini secara manual.');
  infoSheet.getRange('A1:A4').setFontFamily('Arial').setFontSize(10);
  infoSheet.getRange('A1').setFontWeight('bold').setFontSize(13);
}


// ════════════════════════════════════════════════════════════
//  FILE AUDIT — AUDIT_RESULTS
// ════════════════════════════════════════════════════════════

const AUDIT_RESULT_HEADERS = [
  'result_id','agenda_id','period_id',
  'item_id','tipe','kategori','nomor_persyaratan','check_item_no',
  'aspek','persyaratan','check_item','standar_check_item',
  'status','deskripsi_temuan','lokasi_temuan','foto_urls','auditor_email','saved_at',
  'finding_status','target_date','is_overdue','closed_at',
];

function getAuditResultsByAgenda(spreadsheetId, agendaId) {
  const sheet = _getAuditSheet(spreadsheetId, CONFIG.AUDIT_SHEETS.AUDIT_RESULTS);
  if (sheet.getLastRow() < 3) return [];
  const data = sheet.getRange(3, 1, sheet.getLastRow() - 2, AUDIT_RESULT_HEADERS.length).getValues();
  const C    = CONFIG.AUDIT_COLS.AUDIT_RESULTS;
  const results = [];
  data.forEach(function(row, i) {
    if (row[0] === '' || String(row[C.AGENDA_ID]) !== String(agendaId)) return;
    const obj = { _rowIndex: i + 3 };
    AUDIT_RESULT_HEADERS.forEach(function(h, j) { obj[h] = row[j]; });
    results.push(obj);
  });
  return results;
}

function getAuditResultsByPeriod(spreadsheetId, periodId) {
  const sheet = _getAuditSheet(spreadsheetId, CONFIG.AUDIT_SHEETS.AUDIT_RESULTS);
  if (sheet.getLastRow() < 3) return [];
  const data = sheet.getRange(3, 1, sheet.getLastRow() - 2, AUDIT_RESULT_HEADERS.length).getValues();
  const C    = CONFIG.AUDIT_COLS.AUDIT_RESULTS;
  const results = [];
  data.forEach(function(row, i) {
    if (row[0] === '') return;
    if (periodId && String(row[C.PERIOD_ID]) !== String(periodId)) return;
    const obj = { _rowIndex: i + 3 };
    AUDIT_RESULT_HEADERS.forEach(function(h, j) { obj[h] = row[j]; });
    results.push(obj);
  });
  return results;
}

// Ambil hanya Non Comply / OFI untuk satu agenda (tampilan verifikasi)
function getFindingsByAgenda(spreadsheetId, agendaId) {
  return getAuditResultsByAgenda(spreadsheetId, agendaId).filter(r =>
    r.status === CONFIG.RESULT_STATUS.NON_COMPLY
  );
}

// Tandai temuan yang sudah melewati target_date sebagai OVERDUE
function markOverdueFindings(spreadsheetId, periodId) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const overdueStatuses = [
    // Disabled — overdue logic akan diimplementasi nanti
    // CONFIG.FINDING_STATUS.OPEN,
    // CONFIG.FINDING_STATUS.TPP_OR_DEPT_HEAD,
    // CONFIG.FINDING_STATUS.TPP_OR_AUDITOR,
    // CONFIG.FINDING_STATUS.TPP_OR_KOORDINATOR,
    // CONFIG.FINDING_STATUS.OPEN_IMPL,
    // CONFIG.FINDING_STATUS.APP_DEPT_HEAD,
    // CONFIG.FINDING_STATUS.APP_AUDITOR,
    // CONFIG.FINDING_STATUS.APP_KOORDINATOR,
  ];
  const sheet   = _getAuditSheet(spreadsheetId, CONFIG.AUDIT_SHEETS.AUDIT_RESULTS);
  const results = getAuditResultsByPeriod(spreadsheetId, periodId);
  const C       = CONFIG.AUDIT_COLS.AUDIT_RESULTS;
  results.forEach(function(r) {
    if (!overdueStatuses.includes(r.finding_status)) return;
    if (!r.target_date) return;
    var td = new Date(r.target_date);
    td.setHours(0, 0, 0, 0);
    if (td < today) {
      _updateCell(sheet, r._rowIndex, C.FINDING_STATUS + 1, CONFIG.FINDING_STATUS.OVERDUE);
    }
  });
}

// Ambil semua Non Comply lintas agenda untuk satu periode (dashboard)
function getAllFindingsByPeriod(spreadsheetId, periodId) {
  return getAuditResultsByPeriod(spreadsheetId, periodId).filter(r =>
    r.status === CONFIG.RESULT_STATUS.NON_COMPLY
  );
}

/**
 * Populate AUDIT_RESULTS saat agenda dibuat / diedit (Opsi B).
 * Row dibuat segera, kolom Grup 3 & 4 kosong — diisi saat audit berlangsung.
 * Kalau dipanggil ulang (edit agenda), hapus row lama dulu.
 */
function populateAuditResults(agendaId, itemIds, spreadsheetId, periodId) {
  const sheet    = _getAuditSheet(spreadsheetId, CONFIG.AUDIT_SHEETS.AUDIT_RESULTS);
  const allItems = getAllChecklistMaster();
  const C        = CONFIG.AUDIT_COLS.AUDIT_RESULTS;

  _deleteRowsByColValue(spreadsheetId,
    CONFIG.AUDIT_SHEETS.AUDIT_RESULTS, C.AGENDA_ID, agendaId);

  const selected = allItems
    .filter(i => itemIds.includes(i.item_id))
    .sort((a, b) => {
      if (a.tipe !== b.tipe) return a.tipe === 'GENERAL' ? -1 : 1;
      return Number(a.nomor) - Number(b.nomor);
    });
  if (!selected.length) return { success: true, count: 0 };

  const agendaForResult = getAgendaById(agendaId);
  const deptForResult   = agendaForResult ? (agendaForResult.dept || agendaId) : agendaId;
  let   resultCounter   = 0;
  const ciCounterMap = {};
  const rows = selected.map(function(item) {
    if (!ciCounterMap[item.nomor]) ciCounterMap[item.nomor] = 0;
    ciCounterMap[item.nomor]++;
    resultCounter++;
    const row = new Array(AUDIT_RESULT_HEADERS.length).fill('');
    row[C.RESULT_ID]          = generateResultId(deptForResult, resultCounter);
    row[C.AGENDA_ID]          = agendaId;
    row[C.PERIOD_ID]          = periodId;
    row[C.ITEM_ID]            = item.item_id;
    row[C.TIPE]               = item.tipe;
    row[C.KATEGORI]           = item.kategori;
    row[C.NOMOR_PERSYARATAN]  = item.nomor;
    row[C.CHECK_ITEM_NO]      = ciCounterMap[item.nomor];
    row[C.ASPEK]              = item.aspek;
    row[C.PERSYARATAN]        = item.persyaratan;
    row[C.CHECK_ITEM]         = item.check_item;
    row[C.STANDAR_CHECK_ITEM] = item.standar_check_item || '';
    return row;
  });
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  return { success: true, count: rows.length };
}

/**
 * Update satu check item hasil audit (update Grup 3).
 * Row sudah ada sejak agenda dibuat — tinggal update.
 */
function saveCheckItemResult({ period_id, agenda_id, result_id, status, deskripsi_temuan, lokasi_temuan, foto_urls, auditor_email }) {
  console.log('[SCI] result_id=' + result_id + ' agenda_id=' + agenda_id + ' status=' + status + ' foto_len=' + (foto_urls||'').length);
  const reg = getPeriodById(period_id);
  if (!reg) throw new Error('Periode tidak ditemukan: ' + period_id);
  const sheet   = _getAuditSheet(reg.spreadsheet_id, CONFIG.AUDIT_SHEETS.AUDIT_RESULTS);
  const results = getAuditResultsByAgenda(reg.spreadsheet_id, agenda_id);
  const result  = results.find(r => String(r.result_id) === String(result_id));
  if (!result) throw new Error('Result tidak ditemukan: result_id=' + result_id + ' agenda_id=' + agenda_id + ' total=' + results.length);

  const row = result._rowIndex;
  const maxRow = sheet.getLastRow();
  const maxCol = sheet.getLastColumn();
  console.log('[saveCheckItemResult] row=' + row + ' maxRow=' + maxRow + ' maxCol=' + maxCol + ' C.STATUS=' + CONFIG.AUDIT_COLS.AUDIT_RESULTS.STATUS);
  if (!row || row < 3) throw new Error('_rowIndex invalid: ' + row);
  if (row > maxRow) throw new Error('_rowIndex ' + row + ' melebihi lastRow ' + maxRow);

  const C = CONFIG.AUDIT_COLS.AUDIT_RESULTS;

const _status  = String(status == null ? '' : status);
  const _desc    = String(deskripsi_temuan == null ? '' : deskripsi_temuan);
  const _lokasi  = String(lokasi_temuan == null ? '' : lokasi_temuan);
  const _foto    = String(foto_urls == null ? '' : foto_urls);
  const _email   = String(auditor_email == null ? '' : auditor_email);
  const _saved   = String(now() == null ? '' : now());

  // Tulis 6 kolom sekaligus (STATUS..SAVED_AT) — atomic & cepat
  console.log('[PRE_SETVALUES] row=' + row + ' status=' + _status + ' descLen=' + _desc.length + ' lokasiLen=' + _lokasi.length + ' fotoLen=' + _foto.length + ' email=' + _email + ' startCol=' + (C.STATUS + 1) + ' maxCol=' + maxCol);
  try {
    sheet.getRange(row, C.STATUS + 1, 1, 6)
         .setValues([[_status, _desc, _lokasi, _foto, _email, _saved]]);
    console.log('[SETVALUES_OK] row=' + row);
  } catch (e) {
    console.error('[SETVALUES_FAIL] row=' + row +
                    ' status=' + JSON.stringify(_status) +
                    ' descLen=' + _desc.length +
                    ' lokasiLen=' + _lokasi.length +
                    ' fotoLen=' + _foto.length +
                    ' email=' + JSON.stringify(_email) +
                    ' startCol=' + (C.STATUS + 1) +
                    ' maxCol=' + maxCol +
                    ' :: ' + e.message);
    throw new Error('setValues row=' + row +
                    ' status=' + JSON.stringify(_status) +
                    ' descLen=' + _desc.length +
                    ' lokasiLen=' + _lokasi.length +
                    ' fotoLen=' + _foto.length +
                    ' email=' + JSON.stringify(_email) +
                    ' :: ' + e.message);
  }

  if (_status === CONFIG.RESULT_STATUS.COMPLY) {
    try {
      sheet.getRange(row, C.FINDING_STATUS + 1, 1, 4)
           .setValues([['', '', '', '']]);
    } catch (e) {
      throw new Error('clear finding fields row=' + row + ' :: ' + e.message);
    }
  }

  return { result_id: result.result_id, status: _status };
}

/**
 * Update satu kolom AUDIT_RESULTS by result_id.
 * Dipakai oleh approval flow, verifikasi, dan TPP.
 */
function updateResultField(spreadsheetId, resultId, colIndex, value) {
  const sheet   = _getAuditSheet(spreadsheetId, CONFIG.AUDIT_SHEETS.AUDIT_RESULTS);
  const lastRow = sheet.getLastRow();
  if (lastRow < 3) throw new Error('AUDIT_RESULTS kosong.');
  const data = sheet.getRange(3, 1, lastRow - 2, 1).getValues();
  let rowIndex = -1;
  data.forEach((row, i) => { if (row[0] === resultId) rowIndex = i + 3; });
  if (rowIndex < 0) throw new Error('Result tidak ditemukan: ' + resultId);
  _updateCell(sheet, rowIndex, colIndex + 1, value);
  return { success: true };
}


// ════════════════════════════════════════════════════════════
//  AUDIT FLOW — START, FINISH, AGREEMENT
// ════════════════════════════════════════════════════════════

/**
 * Auditor mulai audit.
 * Tidak ada lagi sheet SESSIONS — cukup update AUDIT_AGENDA.
 */
function startAudit({ agendaId, periodId, areaId, startedBy }) {
  const agenda = getAgendaById(agendaId);
  if (!agenda) throw new Error('Agenda tidak ditemukan: ' + agendaId);
  if (agenda.status === CONFIG.AGENDA_STATUS.DONE)
    throw new Error('Audit untuk area ini sudah selesai.');
  if (agenda.status === CONFIG.AGENDA_STATUS.STARTED)
    return { agenda_id: agendaId, already_started: true };
  const area = getAreaById(areaId);
  updateAgenda(agendaId, {
    status:        CONFIG.AGENDA_STATUS.STARTED,
    started_by:    startedBy,
    started_at:    now(),
    area_sampling: area ? (area.area_sampling || '') : '',
  });
  try { notifyAuditStarted(getAgendaById(agendaId)); } catch(e) { console.warn('Notif audit started gagal:', e.message); }
  return { agenda_id: agendaId };
}

/**
 * Validasi semua check item sudah diisi, kirim notifikasi agreement ke auditee.
 */
function finishAudit(periodId, agendaId, auditorEmail) {
  const reg = getPeriodById(periodId);
  if (!reg) throw new Error('Periode tidak ditemukan: ' + periodId);
  const agenda = getAgendaById(agendaId);
  if (!agenda) throw new Error('Agenda tidak ditemukan: ' + agendaId);
  if (agenda.status !== CONFIG.AGENDA_STATUS.STARTED)
    throw new Error('Audit belum dimulai atau sudah selesai.');

  const results = getAuditResultsByAgenda(reg.spreadsheet_id, agendaId);
  const total   = results.length;
  const filled  = results.filter(r => r.status !== '').length;
  if (filled < total)
    throw new Error((total - filled) + ' check item belum diisi. Selesaikan semua sebelum mengakhiri audit.');
  return { success: true };
}

/**
 * Auditor upload foto agreement → status agenda DONE, finding_status → PENDING_VERIFICATION.
 */
function submitAgreement(spreadsheetId, agendaId, agreementFotoUrl, agreementBy, ofi, auditeeHadirNames) {
  const agenda = getAgendaById(agendaId);
  if (!agenda) throw new Error('Agenda tidak ditemukan: ' + agendaId);
  // Guard double submit — kalau sudah DONE, tolak
  if (agenda.status === CONFIG.AGENDA_STATUS.DONE)
    throw new Error('Agreement sudah disubmit oleh auditor lain. Audit ini sudah selesai.');
  updateAgenda(agendaId, {
    status:              CONFIG.AGENDA_STATUS.DONE,
    agreement_foto_url:  agreementFotoUrl,
    agreement_by:        agreementBy,
    agreement_at:        now(),
    ofi:                 ofi || '',
    auditee_hadir_names: auditeeHadirNames || '',
  });
  const sheet   = _getAuditSheet(spreadsheetId, CONFIG.AUDIT_SHEETS.AUDIT_RESULTS);
  const results = getAuditResultsByAgenda(spreadsheetId, agendaId);
  const C       = CONFIG.AUDIT_COLS.AUDIT_RESULTS;
  results.forEach(function(r) {
    if (r.status === CONFIG.RESULT_STATUS.NON_COMPLY) {
      _updateCell(sheet, r._rowIndex, C.FINDING_STATUS + 1, CONFIG.FINDING_STATUS.PENDING_VERIFICATION);
    }
  });
  try {
    const nonComplyCount = results.filter(r => r.status === CONFIG.RESULT_STATUS.NON_COMPLY).length;
    const complyCount    = results.filter(r => r.status === CONFIG.RESULT_STATUS.COMPLY).length;
    const updatedAgenda  = getAgendaById(agendaId);
    notifyAuditCompletedAuditor(updatedAgenda, complyCount, nonComplyCount);
    notifyAuditCompletedKoordinator(updatedAgenda, complyCount, nonComplyCount);
  } catch(e) { console.warn('Notifikasi agreement gagal (non-fatal):', e.message); }
  return { success: true };
}


// ════════════════════════════════════════════════════════════
//  AUDIT FLOW — VERIFIKASI KOORDINATOR
// ════════════════════════════════════════════════════════════

/**
 * updates: Array<{ result_id, final_status, deskripsi_temuan }>
 * final_status: 'Non Comply' | 'Comply' (hapus temuan → ubah ke Comply)
 */
function verifyFindings(spreadsheetId, agendaId, updates, verifiedBy) {
  const sheet   = _getAuditSheet(spreadsheetId, CONFIG.AUDIT_SHEETS.AUDIT_RESULTS);
  const results = getAuditResultsByAgenda(spreadsheetId, agendaId);
  const C       = CONFIG.AUDIT_COLS.AUDIT_RESULTS;
  updates.forEach(function(upd) {
    const result = results.find(r => r.result_id === upd.result_id);
    if (!result) { console.warn('[verifyFindings] result_id tidak ditemukan:', upd.result_id); return; }
    if (result.finding_status !== CONFIG.FINDING_STATUS.PENDING_VERIFICATION) {
      console.warn('[verifyFindings] bukan PENDING_VERIFICATION:', upd.result_id); return;
    }
    if (upd.final_status === CONFIG.RESULT_STATUS.COMPLY) {
      _updateCell(sheet, result._rowIndex, C.STATUS           + 1, CONFIG.RESULT_STATUS.COMPLY);
      _updateCell(sheet, result._rowIndex, C.DESKRIPSI_TEMUAN + 1, '');
      _updateCell(sheet, result._rowIndex, C.LOKASI_TEMUAN    + 1, '');
      _updateCell(sheet, result._rowIndex, C.FOTO_URLS        + 1, '');
      _updateCell(sheet, result._rowIndex, C.AUDITOR_EMAIL    + 1, verifiedBy);
      _updateCell(sheet, result._rowIndex, C.SAVED_AT         + 1, now());
      _updateCell(sheet, result._rowIndex, C.FINDING_STATUS   + 1, '');
      _updateCell(sheet, result._rowIndex, C.TARGET_DATE      + 1, '');
      _updateCell(sheet, result._rowIndex, C.IS_OVERDUE + 1, '');
      _updateCell(sheet, result._rowIndex, C.CLOSED_AT        + 1, '');
    } else {
      // Non Comply tetap → set OPEN, update field yang diubah koordinator
      _updateCell(sheet, result._rowIndex, C.FINDING_STATUS   + 1, CONFIG.FINDING_STATUS.OPEN);
      if (upd.deskripsi_temuan !== undefined)
        _updateCell(sheet, result._rowIndex, C.DESKRIPSI_TEMUAN + 1, upd.deskripsi_temuan);
      if (upd.lokasi_temuan !== undefined)
        _updateCell(sheet, result._rowIndex, C.LOKASI_TEMUAN    + 1, upd.lokasi_temuan);
      if (upd.foto_urls !== undefined)
        _updateCell(sheet, result._rowIndex, C.FOTO_URLS        + 1, upd.foto_urls);
      _updateCell(sheet, result._rowIndex, C.AUDITOR_EMAIL     + 1, verifiedBy);
      _updateCell(sheet, result._rowIndex, C.SAVED_AT          + 1, now());
    }
  });
  // Kirim notifikasi ke auditee untuk mengisi TPP
    try {
      const openFindings = getAuditResultsByAgenda(spreadsheetId, agendaId)
        .filter(function(r) { return r.finding_status === CONFIG.FINDING_STATUS.OPEN; });
      if (openFindings.length > 0) {
        const ag = getAgendaById(agendaId);
        if (ag) notifyFindingsVerified(ag, openFindings);
      }
    } catch(e) { console.warn('Notif requestTPP gagal:', e.message); }

  return { success: true, verified: updates.length };
}


// ════════════════════════════════════════════════════════════
//  FILE AUDIT — REQUIREMENT_LOCKS
// ════════════════════════════════════════════════════════════

const LOCK_HEADERS = ['lock_id','agenda_id','nomor_persyaratan','locked_by','locked_at','status'];

function getLocks(spreadsheetId, agendaId) {
  const sheet = _getAuditSheet(spreadsheetId, CONFIG.AUDIT_SHEETS.REQUIREMENT_LOCKS);
  if (sheet.getLastRow() < 3) return [];
  const data = sheet.getRange(3, 1, sheet.getLastRow() - 2, LOCK_HEADERS.length).getValues();
  const rows = data
    .filter(r => r[0] !== '' && String(r[1]) === String(agendaId))
    .map(row => {
      const obj = { _rowIndex: data.indexOf(row) + 3 };
      LOCK_HEADERS.forEach((h, j) => { obj[h] = row[j]; });
      return obj;
    });
  // Cleanup lock expired yang masih LOCKED
  rows.forEach(function(l) {
    if (l.status === 'LOCKED' && isLockExpired(l.locked_at)) {
      _updateCell(sheet, l._rowIndex, 6, 'RELEASED');
      l.status = 'RELEASED';
    }
  });
  return rows;
}

function lockRequirement(spreadsheetId, agendaId, nomorPersyaratan, auditorEmail) {
  const sheet  = _getAuditSheet(spreadsheetId, CONFIG.AUDIT_SHEETS.REQUIREMENT_LOCKS);
  const locks  = getLocks(spreadsheetId, agendaId);
  const active = locks.find(l =>
    Number(l.nomor_persyaratan) === Number(nomorPersyaratan) && l.status === 'LOCKED'
  );
  if (active) {
    if (isLockExpired(active.locked_at)) {
      _updateCell(sheet, active._rowIndex, 6, 'RELEASED');
    } else if (active.locked_by !== auditorEmail) {
      return { locked: false, lockedBy: active.locked_by };
    } else {
      _updateCell(sheet, active._rowIndex, 5, now());
      return { locked: true, lockedBy: auditorEmail, renewed: true };
    }
  }
  const lock_id = generateId('LCK');
  _appendRow(sheet, [lock_id, agendaId, nomorPersyaratan, auditorEmail, now(), 'LOCKED']);
  return { locked: true, lockedBy: auditorEmail };
}

function releaseLock(spreadsheetId, agendaId, nomorPersyaratan, auditorEmail) {
  const sheet = _getAuditSheet(spreadsheetId, CONFIG.AUDIT_SHEETS.REQUIREMENT_LOCKS);
  const lock  = getLocks(spreadsheetId, agendaId).find(l =>
    Number(l.nomor_persyaratan) === Number(nomorPersyaratan) &&
    l.locked_by === auditorEmail && l.status === 'LOCKED'
  );
  if (lock) { _updateCell(sheet, lock._rowIndex, 6, 'RELEASED'); return { success: true }; }
  return { success: false, message: 'Lock tidak ditemukan.' };
}


// ════════════════════════════════════════════════════════════
//  FILE AUDIT — TPP_ITEMS
// ════════════════════════════════════════════════════════════

const TPP_ITEM_HEADERS = [
  'tpp_item_id','result_id','tipe',
  'deskripsi','submitted_by','submitted_at',
  'impl_foto_urls','impl_keterangan','impl_submitted_at','impl_submitted_by',
];

function getTppItemsByResult(spreadsheetId, resultId) {
  const sheet = _getAuditSheet(spreadsheetId, CONFIG.AUDIT_SHEETS.TPP_ITEMS);
  if (sheet.getLastRow() < 3) return [];
  const data = sheet.getRange(3, 1, sheet.getLastRow() - 2, TPP_ITEM_HEADERS.length).getValues();
  return data
    .filter(r => r[0] !== '' && String(r[1]) === String(resultId))
    .map(row => {
      const obj = { _rowIndex: data.indexOf(row) + 3 };
      TPP_ITEM_HEADERS.forEach((h, j) => { obj[h] = row[j]; });
      return obj;
    });
}

function getTppItemsByAgenda(spreadsheetId, agendaId) {
  const findings = getFindingsByAgenda(spreadsheetId, agendaId);
  const result   = [];
  findings.forEach(function(f) {
    getTppItemsByResult(spreadsheetId, f.result_id)
      .forEach(function(i) { i._result = f; result.push(i); });
  });
  return result;
}

function submitTpp(spreadsheetId, resultId, agendaId, items, targetDate, submittedBy) {
  const sheet = _getAuditSheet(spreadsheetId, CONFIG.AUDIT_SHEETS.TPP_ITEMS);
  _deleteRowsByColValue(spreadsheetId,
    CONFIG.AUDIT_SHEETS.TPP_ITEMS,
    CONFIG.AUDIT_COLS.TPP_ITEMS.RESULT_ID, resultId);
  const rows = items.map(function(item) {
    return [generateId('TPP'), resultId, item.tipe, item.deskripsi, submittedBy, now(), '', '', '', ''];
  });
  if (rows.length > 0)
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  const C = CONFIG.AUDIT_COLS.AUDIT_RESULTS;
  updateResultField(spreadsheetId, resultId, C.TARGET_DATE,    targetDate);
  updateResultField(spreadsheetId, resultId, C.FINDING_STATUS, CONFIG.FINDING_STATUS.TPP_OR_DEPT_HEAD);
  // is_overdue: tidak diset saat ini — disabled
  appendApprovalLog(spreadsheetId, {
    result_id: resultId, agenda_id: agendaId,
    stage: 'TPP', level: 'AUDITEE', action: 'SUBMITTED',
    by_email: submittedBy, skipped: false, skip_reason: '',
  });
  // Kirim notifikasi ke DeptHead
  try {
    const ag  = getAgendaById(agendaId);
    const res = getAuditResultsByAgenda(spreadsheetId, agendaId).find(r => r.result_id === resultId)
      || { result_id: resultId, nomor_persyaratan: '-', check_item_no: '-', target_date: targetDate };
    if (ag) notifyTPPSubmitted(ag, res);
  } catch(e) { console.warn('Notifikasi TPP submitted gagal:', e.message); }

  return { success: true, tpp_item_count: rows.length };
}

function submitTppItemImpl(spreadsheetId, tppItemId, implFotoUrls, implKeterangan, submittedBy) {
  const sheet = _getAuditSheet(spreadsheetId, CONFIG.AUDIT_SHEETS.TPP_ITEMS);
  if (sheet.getLastRow() < 3) throw new Error('TPP item tidak ditemukan.');
  const data = sheet.getRange(3, 1, sheet.getLastRow() - 2, TPP_ITEM_HEADERS.length).getValues();
  let rowIndex = -1;
  data.forEach((row, i) => { if (row[0] === tppItemId) rowIndex = i + 3; });
  if (rowIndex < 0) throw new Error('TPP item tidak ditemukan: ' + tppItemId);
  const C = CONFIG.AUDIT_COLS.TPP_ITEMS;
  _updateCell(sheet, rowIndex, C.IMPL_FOTO_URLS    + 1, toCSV(implFotoUrls));
  _updateCell(sheet, rowIndex, C.IMPL_KETERANGAN   + 1, implKeterangan || '');
  _updateCell(sheet, rowIndex, C.IMPL_SUBMITTED_AT + 1, now());
  _updateCell(sheet, rowIndex, C.IMPL_SUBMITTED_BY + 1, submittedBy);
  return { success: true };
}

function allTppItemsImplSubmitted(spreadsheetId, resultId) {
  const items = getTppItemsByResult(spreadsheetId, resultId);
  if (!items.length) return false;
  return items.every(i => !!i.impl_submitted_at);
}


// ════════════════════════════════════════════════════════════
//  FILE AUDIT — APPROVAL_LOG
// ════════════════════════════════════════════════════════════

const APPROVAL_LOG_HEADERS = [
  'log_id','result_id','agenda_id','stage','level','action',
  'by_email','at','komentar','skipped','skip_reason',
];

function appendApprovalLog(spreadsheetId, { result_id, agenda_id, stage, level, action, by_email, komentar, skipped, skip_reason }) {
  const sheet  = _getAuditSheet(spreadsheetId, CONFIG.AUDIT_SHEETS.APPROVAL_LOG);
  const log_id = generateId('LOG');
  _appendRow(sheet, [
    log_id, result_id, agenda_id, stage, level, action,
    by_email, now(), komentar || '', skipped || false, skip_reason || '',
  ]);
  return { log_id };
}

function getApprovalLogByResult(spreadsheetId, resultId) {
  const sheet = _getAuditSheet(spreadsheetId, CONFIG.AUDIT_SHEETS.APPROVAL_LOG);
  if (sheet.getLastRow() < 3) return [];
  const data = sheet.getRange(3, 1, sheet.getLastRow() - 2, APPROVAL_LOG_HEADERS.length).getValues();
  return data
    .filter(r => r[0] !== '' && String(r[1]) === String(resultId))
    .map(row => {
      const obj = { _rowIndex: data.indexOf(row) + 3 };
      APPROVAL_LOG_HEADERS.forEach((h, j) => { obj[h] = row[j]; });
      return obj;
    });
}
