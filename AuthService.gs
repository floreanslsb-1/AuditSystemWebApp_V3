// ============================================================
//  AuthService.gs — v2 (refactored)
//  Perubahan dari v1:
//  - Tidak ada perubahan logic — semua fungsi sama persis
//  - canAccessArea(): tidak lagi cek getSessionsByPeriod,
//    cukup cek getAgendasByPeriod (agenda.auditor_emails)
//    karena SESSIONS sudah tidak ada
//  - _buildProfile(): auditorAreas tetap [] — derive dari agenda
//    saat canAccessArea dipanggil, bukan saat build profile
//  - _getAuditorAreas(): tetap ada, pakai getAgendasByPeriod
//    (tidak berubah karena sudah pakai agenda bukan session)
// ============================================================


// ════════════════════════════════════════════════════════════
//  CORE AUTH
// ════════════════════════════════════════════════════════════

/**
 * Ambil email user yang sedang login.
 */
function getCurrentUserEmail() {
  return Session.getActiveUser().getEmail().toLowerCase();
}

/**
 * Cek apakah email dari domain yang diizinkan.
 */
function isAllowedDomain(email) {
  return email.endsWith('@' + CONFIG.ALLOWED_DOMAIN);
}

/**
 * Parse roles dari string comma-separated.
 * @param   {string}   rolesStr  e.g. 'Koordinator,Auditor'
 * @returns {string[]}
 */
function parseRoles(rolesStr) {
  if (!rolesStr) return [];
  return String(rolesStr).split(',').map(r => r.trim()).filter(Boolean);
}

/**
 * Cek apakah roles array mengandung role tertentu.
 */
function hasRole(roles, role) {
  return roles.includes(role);
}

/**
 * Ambil profil lengkap user yang sedang login.
 * Di-cache 5 menit di ScriptCache.
 * @returns {Object} userProfile
 */
function getCurrentUserProfile() {
  const email    = getCurrentUserEmail();
  const cacheKey = 'PROFILE_' + email.replace(/[^a-z0-9]/gi, '_');
  const cache    = CacheService.getScriptCache();

  // Coba ambil dari cache dulu
  try {
    const cached = cache.get(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed && parsed.email === email) return parsed;
    }
  } catch(e) {
    console.warn('Profile cache read failed:', e.message);
  }

  // Cek domain
  if (!isAllowedDomain(email)) {
    return {
      email,
      nama:         email,
      roles:        [],
      isAuthorized: false,
      error:        'Akses hanya untuk email @' + CONFIG.ALLOWED_DOMAIN,
    };
  }

  // Cek di sheet USERS
  const user    = getUserByEmail(email);
  const profile = !user
    ? _buildProfile(email, email.split('@')[0], [], true, 'viewer')
    : _buildProfile(email, user.nama, parseRoles(user.roles), true, 'active');

  // Simpan ke cache (5 menit)
  try {
    cache.put(cacheKey, JSON.stringify(profile), 300);
  } catch(e) {
    console.warn('Profile cache write failed:', e.message);
  }

  return profile;
}

/**
 * Invalidasi cache profile untuk email tertentu.
 * Panggil ini setelah UPDATE_USER atau DELETE_USER.
 */
function invalidateProfileCache(email) {
  const cacheKey = 'PROFILE_' + (email || '').toLowerCase().replace(/[^a-z0-9]/gi, '_');
  try { CacheService.getScriptCache().remove(cacheKey); } catch(e) {}
}

function invalidateAllProfileCaches() {
  // ScriptCache tidak support wildcard delete — pakai invalidate semua user
  // yang auditee_emails-nya berubah
  // Cara paling efektif: hapus semua profile cache dengan iterasi semua users
  try {
    const users = getAllUsers();
    const cache = CacheService.getScriptCache();
    users.forEach(function(u) {
      const key = 'PROFILE_' + (u.email || '').toLowerCase().replace(/[^a-z0-9]/gi, '_');
      cache.remove(key);
    });
    // Invalidate juga area-based profiles (auditee & depthead yang tidak di USERS)
    const areas = getAllAreas();
    areas.forEach(function(a) {
      if (a.dept_head_email) {
        const key = 'PROFILE_' + a.dept_head_email.toLowerCase().replace(/[^a-z0-9]/gi, '_');
        cache.remove(key);
      }
      if (a.auditee_emails) {
        a.auditee_emails.split(',').forEach(function(email) {
          email = email.trim();
          if (email) {
            const key = 'PROFILE_' + email.toLowerCase().replace(/[^a-z0-9]/gi, '_');
            cache.remove(key);
          }
        });
      }
    });
  } catch(e) {
    console.warn('invalidateAllProfileCaches failed (non-fatal):', e.message);
  }
}

/**
 * Build profile object dengan semua derived fields.
 */
function _buildProfile(email, nama, roles, isAuthorized, status) {
  // Cek DeptHead & Auditee dari AREAS cache
  const cachedAreas   = getCachedAreas();
  const deptHeadAreas = cachedAreas
    .filter(a => normalizeEmail(a.dept_head_email) === normalizeEmail(email))
    .map(a => a.area_id);
  const isDeptHead    = deptHeadAreas.length > 0;

  const auditeeArea   = cachedAreas.find(a =>
    a.auditee_emails && emailInCSV(a.auditee_emails, email)
  );
  const isAuditee     = !!auditeeArea || isDeptHead;
  const auditeeAreaId = auditeeArea ? auditeeArea.area_id : null;

  // Auditor & Koordinator dari roles USERS
  const isAuditor     = hasRole(roles, CONFIG.ROLES.AUDITOR);
  const isKoordinator = hasRole(roles, CONFIG.ROLES.KOORDINATOR);

  // Relevant areas untuk dashboard filter
  // auditorAreas dikosongkan di sini — di-derive dari agenda saat canAccessArea dipanggil
  const relevantAreas = _getRelevantAreas(email, roles, deptHeadAreas, [], auditeeAreaId);

  return {
    email, nama, roles,
    aktif:        status === 'active',
    status,
    isAuthorized,
    isKoordinator,
    isDeptHead,
    isAuditor,
    isAuditee,
    isViewer:     !isKoordinator && !isDeptHead && !isAuditor && !isAuditee,
    deptHeadAreas,
    auditorAreas:  [], // di-derive per-request via canAccessArea
    auditeeAreaId,
    relevantAreas,
  };
}


// ════════════════════════════════════════════════════════════
//  ACCESS CONTROL
// ════════════════════════════════════════════════════════════

/**
 * Middleware — lempar error jika tidak punya akses.
 * @param {string[]} allowedFlags  e.g. ['isKoordinator', 'isAuditor']
 * @param {Object}   profile
 */
function requireAccess(allowedFlags, profile) {
  if (!profile.isAuthorized) throw new Error(profile.error || 'Tidak terotorisasi.');
  if (profile.isKoordinator) return; // Koordinator selalu lolos
  const hasAccess = allowedFlags.some(flag => profile[flag] === true);
  if (!hasAccess) throw new Error('Akses ditolak untuk role Anda.');
}

/**
 * Cek apakah user punya akses ke area tertentu di periode tertentu.
 * Tidak lagi pakai SESSIONS — cukup cek AUDIT_AGENDA.
 */
function canAccessArea(profile, areaId, periodId) {
  if (!profile.isAuthorized) return false;
  if (profile.isKoordinator) return true; // Koordinator akses semua

  // DeptHead area ini
  if (profile.deptHeadAreas && profile.deptHeadAreas.includes(areaId)) return true;

  // Auditor yang di-assign ke agenda area ini di periode ini
  if (periodId) {
    const agenda = getAgendaByAreaAndPeriod(areaId, periodId);
    if (agenda && emailInCSV(agenda.auditor_emails, profile.email)) return true;
  }

  // Auditee — hanya bisa akses area spesifik tempat dia terdaftar
  if (profile.isAuditee && profile.auditeeAreaId === areaId) return true;

  // Viewer — bisa lihat tapi tidak bisa submit (read-only check ada di masing-masing action)
  return true;
}


// ════════════════════════════════════════════════════════════
//  INTERNAL HELPERS
// ════════════════════════════════════════════════════════════

/**
 * Ambil area yang di-assign sebagai auditor di periode tertentu.
 * Dipakai oleh _getRelevantAreas.
 */
function _getAuditorAreas(email, periodId) {
  if (!periodId) return [];
  return getAgendasByPeriod(periodId)
    .filter(a => emailInCSV(a.auditor_emails, email))
    .map(a => a.area_id);
}

/**
 * Kumpulkan semua area yang relevan untuk user.
 * Dipakai di dashboard untuk default filter.
 */
function _getRelevantAreas(email, roles, deptHeadAreas, auditorAreas, auditeeAreaId) {
  // Koordinator → semua area
  if (hasRole(roles, CONFIG.ROLES.KOORDINATOR)) {
    return getCachedAreas().map(a => a.area_id);
  }

  const areas = new Set();

  deptHeadAreas.forEach(id => areas.add(id));
  auditorAreas.forEach(id => areas.add(id));
  if (auditeeAreaId) areas.add(auditeeAreaId);

  // Kalau tidak ada area spesifik → Viewer, tampilkan semua
  if (areas.size === 0) {
    return getCachedAreas().map(a => a.area_id);
  }

  return [...areas];
}
