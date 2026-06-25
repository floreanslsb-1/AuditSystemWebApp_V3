// ============================================================
//  ApprovalService.gs — v3
//  Perubahan dari v2:
//  - finding_status sebagai single source of truth untuk stage & level
//  - processApproval: hapus stage, level, skipLevel, skipReason dari signature
//  - Stage & level di-derive dari finding_status via STATUS_FLOW map
//  - Hapus _handleSkip (fitur skip Koordinator dihapus)
//  - Hapus _nextLevel (tidak relevan — status sudah embed next step)
//  - Hapus APPROVAL_CHAIN constant
//  - _validateApprover: validasi berdasarkan finding_status vs profile
//    + lock check untuk Auditor (pakai resultId bukan agendaId)
//  - _handleReject: rollback status dari flow.reject, bukan hardcode
//  - _handleApprove: notif sudah pakai nama fungsi TPP yang benar
//  - massApprove: hapus stage & level dari signature
// ============================================================

// STATUS_FLOW pakai string literal — tidak bergantung pada load order CONFIG
const STATUS_FLOW = {
  'TPP_OR_DEPT_HEAD':   { stage: 'TPP',  level: 'DeptHead',    next: 'TPP_OR_AUDITOR',     reject: 'OPEN'      },
  'TPP_OR_AUDITOR':     { stage: 'TPP',  level: 'Auditor',     next: 'TPP_OR_KOORDINATOR', reject: 'OPEN'      },
  'TPP_OR_KOORDINATOR': { stage: 'TPP',  level: 'Koordinator', next: 'OPEN_IMPL',           reject: 'OPEN'      },
  'APP_DEPT_HEAD':      { stage: 'IMPL', level: 'DeptHead',    next: 'APP_AUDITOR',         reject: 'OPEN_IMPL' },
  'APP_AUDITOR':        { stage: 'IMPL', level: 'Auditor',     next: 'APP_KOORDINATOR',     reject: 'OPEN_IMPL' },
  'APP_KOORDINATOR':    { stage: 'IMPL', level: 'Koordinator', next: 'CLOSED',              reject: 'OPEN_IMPL' },
};

/**
 * Proses approval (approve/reject) untuk satu result.
 * Stage & level di-derive dari finding_status — tidak perlu dari frontend.
 */
function processApproval({ spreadsheetId, resultId, agendaId, action, byEmail, komentar }) {
  komentar = komentar || '';

  const result = getAuditResultsByAgenda(spreadsheetId, agendaId)
    .find(r => r.result_id === resultId);
  if (!result) throw new Error('Result ' + resultId + ' tidak ditemukan.');

  const flow = STATUS_FLOW[result.finding_status];
  if (!flow) throw new Error('Status temuan tidak valid untuk approval: ' + result.finding_status);

  const agenda = getAgendaById(agendaId);
  if (!agenda) throw new Error('Agenda ' + agendaId + ' tidak ditemukan.');

  _validateApprover(agenda, flow.level, byEmail, result.finding_status, spreadsheetId, result.result_id);

  if (action === CONFIG.APPROVAL_STATUS.REJECTED) {
    return _handleReject({ spreadsheetId, result, agenda, flow, byEmail, komentar });
  }
  return _handleApprove({ spreadsheetId, result, agenda, flow, byEmail, komentar });
}

/**
 * Mass approve — Koordinator approve banyak result sekaligus.
 * Stage & level di-derive dari finding_status masing-masing result.
 */
function massApprove({ spreadsheetId, resultIds, agendaIds, byEmail, komentar }) {
  komentar = komentar || '';
  const results = [];
  resultIds.forEach(function(resultId, i) {
    try {
      processApproval({
        spreadsheetId,
        resultId,
        agendaId: agendaIds[i] || agendaIds[0],
        action:   CONFIG.APPROVAL_STATUS.APPROVED,
        byEmail,
        komentar,
      });
      results.push({ result_id: resultId, success: true });
    } catch(err) {
      results.push({ result_id: resultId, success: false, reason: err.message });
    }
  });
  return { results, approved: results.filter(r => r.success).length };
}


// ── Handlers ─────────────────────────────────────────────────────

function _handleApprove({ spreadsheetId, result, agenda, flow, byEmail, komentar }) {
  const FS = CONFIG.FINDING_STATUS;
  const C  = CONFIG.AUDIT_COLS.AUDIT_RESULTS;

  appendApprovalLog(spreadsheetId, {
    result_id:   result.result_id,
    agenda_id:   agenda.agenda_id,
    stage:       flow.stage,
    level:       flow.level,
    action:      'APPROVED',
    by_email:    byEmail,
    komentar,
    skipped:     false,
    skip_reason: '',
  });

  if (flow.next === FS.CLOSED) {
    // APP_KOORDINATOR approve → CLOSED
    updateResultField(spreadsheetId, result.result_id, C.FINDING_STATUS, FS.CLOSED);
    updateResultField(spreadsheetId, result.result_id, C.CLOSED_AT, now());
    try { notifyFindingClosed(agenda, result); } catch(e) {}
    _checkAgendaAllClosed(spreadsheetId, agenda.agenda_id);

  } else if (flow.next === FS.OPEN_IMPL) {
    // TPP_OR_KOORDINATOR approve → OPEN_IMPL
    updateResultField(spreadsheetId, result.result_id, C.FINDING_STATUS, FS.OPEN_IMPL);
    try { notifyTPPFullyApproved(agenda, result); } catch(e) {}

  } else {
    // Maju ke level berikutnya
    updateResultField(spreadsheetId, result.result_id, C.FINDING_STATUS, flow.next);
    try {
      if (flow.next === FS.TPP_OR_AUDITOR)     notifyTPPToAuditors(agenda, result);
      if (flow.next === FS.TPP_OR_KOORDINATOR) notifyTPPApprovedByAuditor(agenda, result, byEmail);
      if (flow.next === FS.APP_AUDITOR)        notifyImplToAuditors(agenda, result);
      if (flow.next === FS.APP_KOORDINATOR)    notifyImplApprovedByAuditor(agenda, result, byEmail);
    } catch(e) { console.warn('Notif approval gagal:', e.message); }
  }

  return { success: true, nextStatus: flow.next };
}

function _handleReject({ spreadsheetId, result, agenda, flow, byEmail, komentar }) {
  const C = CONFIG.AUDIT_COLS.AUDIT_RESULTS;

  appendApprovalLog(spreadsheetId, {
    result_id:   result.result_id,
    agenda_id:   agenda.agenda_id,
    stage:       flow.stage,
    level:       flow.level,
    action:      'REJECTED',
    by_email:    byEmail,
    komentar,
    skipped:     false,
    skip_reason: '',
  });

  // Rollback ke status awal berdasarkan flow.reject
  // TPP apapun levelnya → OPEN, IMPL apapun levelnya → OPEN_IMPL
  updateResultField(spreadsheetId, result.result_id, C.FINDING_STATUS, flow.reject);

  try { notifyRejected(agenda, result, flow.stage, byEmail, komentar); } catch(e) {}

  return { success: true, rejected: true, rollbackStatus: flow.reject };
}


// ── Validators ───────────────────────────────────────────────────

function _validateApprover(agenda, level, email, findingStatus, spreadsheetId, resultId) {
  if (level === 'DeptHead') {
    if (normalizeEmail(agenda.dept_head_email) !== normalizeEmail(email)) {
      throw new Error('Anda bukan Dept Head untuk area ini.');
    }

  } else if (level === 'Auditor') {
    if (!emailInCSV(agenda.auditor_emails, email)) {
      throw new Error('Anda bukan Auditor untuk agenda ini.');
    }
    // Lock check: apakah auditor lain sudah approve di stage & result ini
    const stage = findingStatus.startsWith('TPP_') ? 'TPP' : 'IMPL';
    try {
      const logs = getApprovalLogByResult(spreadsheetId, resultId);
      const alreadyApproved = logs.find(function(l) {
        return l.stage  === stage       &&
               l.level  === 'Auditor'  &&
               l.action === 'APPROVED' &&
               normalizeEmail(l.by_email) !== normalizeEmail(email);
      });
      if (alreadyApproved) {
        throw new Error(
          'Approval sudah diambil oleh ' +
          alreadyApproved.by_email.split('@')[0] +
          '. Tidak perlu tindakan dari Anda.'
        );
      }
    } catch(e) {
      if (e.message.includes('Approval sudah diambil')) throw e;
      console.warn('Lock check gagal (non-fatal):', e.message);
    }

  } else if (level === 'Koordinator') {
    const user = getUserByEmail(email);
    if (!user || !parseRoles(user.roles).includes(CONFIG.ROLES.KOORDINATOR)) {
      throw new Error('Hanya Koordinator yang dapat approve di level ini.');
    }
  }
}


// ── Utilities ────────────────────────────────────────────────────

/**
 * Cek apakah semua finding di agenda ini sudah CLOSED.
 * Dipanggil setelah setiap APP_KOORDINATOR approve.
 */
function _checkAgendaAllClosed(spreadsheetId, agendaId) {
  const FS       = CONFIG.FINDING_STATUS;
  const findings = getFindingsByAgenda(spreadsheetId, agendaId);
  if (!findings.length) return false;

  const allClosed = findings.every(function(f) {
    return f.finding_status === FS.CLOSED || f.finding_status === FS.OVERDUE;
  });

  if (allClosed) {
    console.log('[ApprovalService] Semua finding agenda ' + agendaId + ' sudah CLOSED.');
    try {
      const ag = getAgendaById(agendaId);
      const koordinators = getAllKoordinators();
      if (ag && koordinators.length) {
        const subject = '[Audit System] Semua Temuan Closed — ' + ag.dept;
        const body    = 'Semua temuan untuk area ' + ag.dept +
                        ' sudah ditutup (CLOSED).\n\nSalam,\nSistem Audit Internal';
        sendEmail(
          koordinators.map(function(u) { return u.email; }),
          subject,
          emailTemplate('Semua Temuan Closed', '<p>' + body + '</p>')
        );
      }
    } catch(e) { console.warn('Notif all closed gagal:', e.message); }
  }

  return allClosed;
}
