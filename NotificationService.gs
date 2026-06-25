// ============================================================
//  NotificationService.gs
//  Semua notifikasi dikendalikan oleh NOTIFICATIONS_ENABLED di Config.gs.
//  Terminologi: TPP = Tindakan Perbaikan dan Pencegahan (menggantikan CA)
// ============================================================

const APP_URL = ScriptApp.getService().getUrl();

function _appLink(page, params) {
  params = params || {};
  const qs = Object.keys(params)
    .map(function(k) { return k + '=' + encodeURIComponent(params[k]); })
    .join('&');
  return APP_URL + '?page=' + page + (qs ? '&' + qs : '');
}

function _findingInfo(result, agenda) {
  return `
    <table style="border-collapse:collapse;width:100%;font-size:13px;margin:16px 0;">
      <tr><td style="padding:6px;color:#666;width:160px;">Area</td>
          <td style="padding:6px;font-weight:bold;">${escapeHtml(agenda.dept)}</td></tr>
      <tr style="background:#f9f9f9;">
          <td style="padding:6px;color:#666;">Check Item</td>
          <td style="padding:6px;">#${result.nomor_persyaratan}.${result.check_item_no} — ${escapeHtml(result.check_item || '')}</td></tr>
      <tr><td style="padding:6px;color:#666;">Standar</td>
          <td style="padding:6px;">${escapeHtml(result.standar_check_item || '-')}</td></tr>
      <tr style="background:#f9f9f9;">
          <td style="padding:6px;color:#666;">Deskripsi Temuan</td>
          <td style="padding:6px;">${escapeHtml(result.deskripsi_temuan || '')}</td></tr>
      <tr><td style="padding:6px;color:#666;">Status</td>
          <td style="padding:6px;font-weight:bold;">${escapeHtml(result.status || '')}</td></tr>
    </table>`;
}


// ════════════════════════════════════════════════════════════
//  AUDIT FLOW
// ════════════════════════════════════════════════════════════

function notifyAuditStarted(agenda) {
  const auditees = parseCSV(agenda.auditee_emails);
  if (!auditees.length) return;
  const period     = getPeriodById(agenda.period_id);
  const namaPeriode = period ? period.nama_periode : 'IMS';
  const body = `
    <p>Pelaksanaan audit <strong>${escapeHtml(namaPeriode)}</strong> untuk area
    <strong>${escapeHtml(agenda.dept)}</strong> telah resmi dimulai dengan detail
    sebagai berikut:</p>
    <table style="border-collapse:collapse;width:100%;font-size:13px;margin:16px 0;">
      <tr><td style="padding:6px;color:#666;width:160px;">Area</td>
          <td style="padding:6px;font-weight:bold;">${escapeHtml(agenda.dept)}</td></tr>
      <tr style="background:#f9f9f9;">
          <td style="padding:6px;color:#666;">Tanggal Mulai</td>
          <td style="padding:6px;">${formatDatetimeWIB(agenda.started_at)}</td></tr>
      <tr><td style="padding:6px;color:#666;">Tim Auditor</td>
          <td style="padding:6px;">${escapeHtml(agenda.auditor_emails)}</td></tr>
      <tr style="background:#f9f9f9;">
          <td style="padding:6px;color:#666;">Area Sampling</td>
          <td style="padding:6px;">${escapeHtml(agenda.area_sampling || '-')}</td></tr>
    </table>
    <p>Mohon menyiapkan dokumen dan bukti yang diperlukan serta memberikan
    pendampingan kepada tim auditor selama proses berlangsung.</p>`;
  sendEmail(auditees,
    `AUDIT DIMULAI — ${agenda.dept}`,
    emailTemplate(`Audit Dimulai: ${agenda.dept}`, body));
}

function notifyAuditCompletedAuditor(agenda, complyCount, nonComplyCount) {
  const recipients = [
    ...parseCSV(agenda.auditor_emails),
    ...parseCSV(agenda.auditee_emails),
  ].filter(function(v, i, a) { return v && a.indexOf(v) === i; });
  if (!recipients.length) return;
  const period      = getPeriodById(agenda.period_id);
  const namaPeriode = period ? period.nama_periode : 'IMS';
  const body = `
    <p>Pelaksanaan audit <strong>${escapeHtml(namaPeriode)}</strong> untuk area
    <strong>${escapeHtml(agenda.dept)}</strong> telah selesai dilaksanakan.
    Berikut ringkasan pelaksanaan:</p>
    <table style="border-collapse:collapse;width:100%;font-size:13px;margin:16px 0;">
      <tr><td style="padding:6px;color:#666;width:160px;">Area</td>
          <td style="padding:6px;font-weight:bold;">${escapeHtml(agenda.dept)}</td></tr>
      <tr style="background:#f9f9f9;">
          <td style="padding:6px;color:#666;">Tanggal Selesai</td>
          <td style="padding:6px;">${formatDatetimeWIB(agenda.agreement_at || now())}</td></tr>
      <tr><td style="padding:6px;color:#666;">Diselesaikan oleh</td>
          <td style="padding:6px;">${escapeHtml(agenda.agreement_by || '')}</td></tr>
      <tr style="background:#f9f9f9;">
          <td style="padding:6px;color:#666;">Auditee yang Hadir</td>
          <td style="padding:6px;">${escapeHtml(agenda.auditee_hadir_names || '-')}</td></tr>
      <tr><td style="padding:6px;color:#666;">Temuan Comply</td>
          <td style="padding:6px;">${complyCount} temuan</td></tr>
      <tr style="background:#f9f9f9;">
          <td style="padding:6px;color:#666;">Temuan Non Comply</td>
          <td style="padding:6px;font-weight:bold;">${nonComplyCount} temuan</td></tr>
    </table>
    <p>Temuan Non Comply akan diverifikasi terlebih dahulu oleh Koordinator sebelum
    dapat ditindaklanjuti. Anda akan mendapat notifikasi kembali setelah verifikasi
    selesai.</p>`;
  sendEmail(recipients,
    `AUDIT SELESAI — ${agenda.dept}`,
    emailTemplate(`Audit Selesai: ${agenda.dept}`, body));
}

function notifyAuditCompletedKoordinator(agenda, complyCount, nonComplyCount) {
  const koordinators = getAllKoordinators();
  if (!koordinators.length) return;
  const period      = getPeriodById(agenda.period_id);
  const namaPeriode = period ? period.nama_periode : 'IMS';
  const body = `
    <p>Pelaksanaan audit <strong>${escapeHtml(namaPeriode)}</strong> untuk area
    <strong>${escapeHtml(agenda.dept)}</strong> telah selesai dan foto persetujuan
    telah diupload. Terdapat <strong>${nonComplyCount} temuan Non Comply</strong>
    yang menunggu verifikasi Anda.</p>
    <table style="border-collapse:collapse;width:100%;font-size:13px;margin:16px 0;">
      <tr><td style="padding:6px;color:#666;width:160px;">Area</td>
          <td style="padding:6px;font-weight:bold;">${escapeHtml(agenda.dept)}</td></tr>
      <tr style="background:#f9f9f9;">
          <td style="padding:6px;color:#666;">Tanggal Selesai</td>
          <td style="padding:6px;">${formatDatetimeWIB(agenda.agreement_at || now())}</td></tr>
      <tr><td style="padding:6px;color:#666;">Diselesaikan oleh</td>
          <td style="padding:6px;">${escapeHtml(agenda.agreement_by || '')}</td></tr>
      <tr style="background:#f9f9f9;">
          <td style="padding:6px;color:#666;">Auditee yang Hadir</td>
          <td style="padding:6px;">${escapeHtml(agenda.auditee_hadir_names || '-')}</td></tr>
      <tr><td style="padding:6px;color:#666;">Temuan Comply</td>
          <td style="padding:6px;">${complyCount} temuan</td></tr>
      <tr style="background:#f9f9f9;">
          <td style="padding:6px;color:#666;">Temuan Non Comply</td>
          <td style="padding:6px;font-weight:bold;">${nonComplyCount} temuan</td></tr>
    </table>
    <p>Silakan verifikasi setiap temuan Non Comply. Anda dapat menyesuaikan deskripsi
    atau mengubah status temuan jika diperlukan sebelum diteruskan ke auditee.</p>`;
  sendEmail(koordinators.map(u => u.email),
    `VERIFIKASI TEMUAN DIPERLUKAN — AUDIT SELESAI | ${agenda.dept}`,
    emailTemplate(`Verifikasi Temuan Diperlukan: ${agenda.dept}`, body,
      'Verifikasi Temuan di My Task', _appLink('mytask')));
}

function notifyFindingsVerified(agenda, findings) {
  const auditees = parseCSV(agenda.auditee_emails);
  if (!auditees.length || !findings.length) return;
  const period      = getPeriodById(agenda.period_id);
  const namaPeriode = period ? period.nama_periode : 'IMS';
  const rows = findings.map(function(f) {
    return `<tr>
      <td style="padding:6px;border-bottom:1px solid #eee;white-space:nowrap;font-size:11px;color:#666;">
        ${escapeHtml(f.result_id || '')}</td>
      <td style="padding:6px;border-bottom:1px solid #eee;">${escapeHtml(f.check_item || '')}</td>
      <td style="padding:6px;border-bottom:1px solid #eee;">${escapeHtml(f.deskripsi_temuan || '')}</td>
    </tr>`;
  }).join('');
  const body = `
    <p>Hasil audit <strong>${escapeHtml(namaPeriode)}</strong> untuk area
    <strong>${escapeHtml(agenda.dept)}</strong> telah diverifikasi oleh Koordinator.
    Terdapat <strong>${findings.length} temuan Non Comply</strong> yang memerlukan
    tindak lanjut berupa pengisian Tindakan Perbaikan dan Pencegahan (TPP).</p>
    <p>Untuk setiap temuan, Anda wajib mengisi:</p>
    <ul style="font-size:13px;line-height:1.9;padding-left:20px;">
      <li><strong>Tindakan Perbaikan</strong> — tindakan segera untuk mengatasi temuan</li>
      <li><strong>Tindakan Pencegahan</strong> — rencana agar temuan tidak berulang</li>
      <li><strong>Target Penyelesaian</strong> — tanggal target implementasi selesai</li>
    </ul>
    <p style="font-weight:bold;margin-top:20px;">Daftar temuan yang perlu ditindaklanjuti:</p>
    <table style="border-collapse:collapse;width:100%;font-size:13px;">
      <thead>
        <tr style="background:#f0f0f0;">
          <th style="padding:8px;text-align:left;border-bottom:2px solid #ddd;">Result ID</th>
          <th style="padding:8px;text-align:left;border-bottom:2px solid #ddd;">Check Item</th>
          <th style="padding:8px;text-align:left;border-bottom:2px solid #ddd;">Deskripsi Temuan</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="margin-top:16px;">Silakan masuk ke sistem dan isi TPP untuk setiap temuan.</p>`;
  sendEmail(auditees,
    `TINDAK LANJUT DIPERLUKAN — HASIL AUDIT ${agenda.dept}`,
    emailTemplate(`Tindak Lanjut Diperlukan: ${agenda.dept}`, body,
      'Isi TPP di My Task', _appLink('mytask')));
}


// ════════════════════════════════════════════════════════════
//  TPP (TINDAKAN PERBAIKAN DAN PENCEGAHAN)
// ════════════════════════════════════════════════════════════

function notifyTPPSubmitted(agenda, result) {
  if (!agenda.dept_head_email) return;
  const body = `
    <p>Auditee area <strong>${escapeHtml(agenda.dept)}</strong> telah mengajukan
    Tindakan Perbaikan dan Pencegahan (TPP) untuk temuan berikut dan memerlukan
    persetujuan Anda sebagai tahap pertama.</p>
    ${_findingInfo(result, agenda)}
    <table style="border-collapse:collapse;width:100%;font-size:13px;">
      <tr><td style="padding:6px;color:#666;width:160px;">Target Penyelesaian</td>
          <td style="padding:6px;">${formatDateOnlyWIB(result.target_date)}</td></tr>
    </table>
    <p style="margin-top:16px;">Silakan tinjau dan berikan persetujuan atau
    penolakan beserta komentar pada sistem.</p>`;
  sendEmail(agenda.dept_head_email,
    `PERSETUJUAN DIPERLUKAN — TPP ${agenda.dept} | Temuan #${result.nomor_persyaratan}.${result.check_item_no}`,
    emailTemplate('Persetujuan TPP Diperlukan', body,
      'Tinjau & Setujui di My Task', _appLink('mytask', { result_id: result.result_id })));
}

function notifyTPPToAuditors(agenda, result) {
  const auditors = parseCSV(agenda.auditor_emails);
  if (!auditors.length) return;
  const body = `
    <p>Dept Head telah menyetujui Tindakan Perbaikan dan Pencegahan (TPP) untuk
    temuan berikut. Diperlukan persetujuan dari salah satu Auditor sebagai tahap kedua.</p>
    ${_findingInfo(result, agenda)}
    <table style="border-collapse:collapse;width:100%;font-size:13px;">
      <tr><td style="padding:6px;color:#666;width:160px;">Target Penyelesaian</td>
          <td style="padding:6px;">${formatDateOnlyWIB(result.target_date)}</td></tr>
    </table>
    <p style="margin-top:16px;">Cukup satu Auditor dari tim yang memberikan persetujuan.
    Auditor lain akan menerima notifikasi informasi secara otomatis.</p>`;
  sendEmail(auditors,
    `PERSETUJUAN DIPERLUKAN — TPP (AUDITOR) ${agenda.dept} | Temuan #${result.nomor_persyaratan}.${result.check_item_no}`,
    emailTemplate('Persetujuan TPP oleh Auditor Diperlukan', body,
      'Tinjau & Setujui di My Task', _appLink('mytask', { result_id: result.result_id })));
}

function notifyTPPApprovedByAuditor(agenda, result, approverEmail) {
  const otherAuditors = parseCSV(agenda.auditor_emails)
    .filter(a => normalizeEmail(a) !== normalizeEmail(approverEmail));
  if (otherAuditors.length) {
    sendEmail(otherAuditors,
      `INFORMASI — TPP SUDAH DISETUJUI AUDITOR | ${agenda.dept}`,
      emailTemplate('Informasi: TPP Sudah Disetujui', `
        <p>Tindakan Perbaikan dan Pencegahan (TPP) untuk temuan berikut telah disetujui oleh
        <strong>${escapeHtml(approverEmail)}</strong> atas nama tim Auditor.
        Persetujuan Anda tidak diperlukan untuk temuan ini.</p>
        ${_findingInfo(result, agenda)}
        <p>Proses approval dilanjutkan ke tahap Koordinator.</p>`,
        'Lihat Dashboard', _appLink('dashboard')));
  }
  const koordinators = getAllKoordinators();
  if (!koordinators.length) return;
  const body = `
    <p>Dept Head dan Auditor telah menyetujui Tindakan Perbaikan dan Pencegahan (TPP)
    untuk temuan berikut. Diperlukan persetujuan final dari Koordinator sebelum
    auditee melanjutkan ke tahap implementasi.</p>
    ${_findingInfo(result, agenda)}
    <table style="border-collapse:collapse;width:100%;font-size:13px;">
      <tr><td style="padding:6px;color:#666;width:160px;">Target Penyelesaian</td>
          <td style="padding:6px;">${formatDateOnlyWIB(result.target_date)}</td></tr>
      <tr style="background:#f9f9f9;">
          <td style="padding:6px;color:#666;">Disetujui Dept Head</td>
          <td style="padding:6px;">Ya</td></tr>
      <tr><td style="padding:6px;color:#666;">Disetujui Auditor</td>
          <td style="padding:6px;">Ya</td></tr>
    </table>`;
  sendEmail(koordinators.map(u => u.email),
    `PERSETUJUAN FINAL DIPERLUKAN — TPP ${agenda.dept} | Temuan #${result.nomor_persyaratan}.${result.check_item_no}`,
    emailTemplate('Persetujuan Final TPP oleh Koordinator', body,
      'Tinjau & Setujui di My Task', _appLink('mytask', { result_id: result.result_id })));
}

function notifyTPPFullyApproved(agenda, result) {
  const auditees = parseCSV(agenda.auditee_emails);
  if (!auditees.length) return;
  const body = `
    <p>Tindakan Perbaikan dan Pencegahan (TPP) yang Anda ajukan untuk temuan berikut
    telah disetujui oleh seluruh pihak (Dept Head, Auditor, dan Koordinator).</p>
    ${_findingInfo(result, agenda)}
    <table style="border-collapse:collapse;width:100%;font-size:13px;">
      <tr><td style="padding:6px;color:#666;width:160px;">Target Penyelesaian</td>
          <td style="padding:6px;">${formatDateOnlyWIB(result.target_date)}</td></tr>
    </table>
    <p style="margin-top:16px;">Laksanakan tindakan perbaikan sesuai rencana yang telah
    disetujui, kemudian upload bukti implementasi pada sistem sebelum tanggal target.</p>`;
  sendEmail(auditees,
    `TPP DISETUJUI — LANJUTKAN KE IMPLEMENTASI | Temuan #${result.nomor_persyaratan}.${result.check_item_no}`,
    emailTemplate('TPP Disetujui: Lanjutkan ke Implementasi', body,
      'Upload Bukti Implementasi di My Task', _appLink('mytask', { result_id: result.result_id })));
}


// ════════════════════════════════════════════════════════════
//  IMPLEMENTASI
// ════════════════════════════════════════════════════════════

function notifyImplSubmitted(agenda, result) {
  if (!agenda.dept_head_email) return;
  const body = `
    <p>Auditee area <strong>${escapeHtml(agenda.dept)}</strong> telah mengunggah bukti
    implementasi untuk temuan berikut dan memerlukan persetujuan Anda.</p>
    ${_findingInfo(result, agenda)}
    <p>Silakan tinjau bukti implementasi yang telah diupload dan berikan persetujuan
    atau penolakan beserta komentar.</p>`;
  sendEmail(agenda.dept_head_email,
    `PERSETUJUAN DIPERLUKAN — IMPLEMENTASI ${agenda.dept} | Temuan #${result.nomor_persyaratan}.${result.check_item_no}`,
    emailTemplate('Persetujuan Implementasi Diperlukan', body,
      'Tinjau Bukti & Setujui di My Task', _appLink('mytask', { result_id: result.result_id })));
}

function notifyImplToAuditors(agenda, result) {
  const auditors = parseCSV(agenda.auditor_emails);
  if (!auditors.length) return;
  const body = `
    <p>Dept Head telah menyetujui bukti implementasi untuk temuan berikut.
    Diperlukan persetujuan dari salah satu Auditor.</p>
    ${_findingInfo(result, agenda)}
    <p>Cukup satu Auditor dari tim yang memberikan persetujuan.
    Auditor lain akan menerima notifikasi informasi secara otomatis.</p>`;
  sendEmail(auditors,
    `PERSETUJUAN DIPERLUKAN — IMPLEMENTASI (AUDITOR) ${agenda.dept} | Temuan #${result.nomor_persyaratan}.${result.check_item_no}`,
    emailTemplate('Persetujuan Implementasi oleh Auditor Diperlukan', body,
      'Tinjau Bukti & Setujui di My Task', _appLink('mytask', { result_id: result.result_id })));
}

function notifyImplApprovedByAuditor(agenda, result, approverEmail) {
  const otherAuditors = parseCSV(agenda.auditor_emails)
    .filter(a => normalizeEmail(a) !== normalizeEmail(approverEmail));
  if (otherAuditors.length) {
    sendEmail(otherAuditors,
      `INFORMASI — IMPLEMENTASI SUDAH DISETUJUI AUDITOR | ${agenda.dept}`,
      emailTemplate('Informasi: Implementasi Sudah Disetujui', `
        <p>Bukti implementasi untuk temuan berikut telah disetujui oleh
        <strong>${escapeHtml(approverEmail)}</strong>. Persetujuan Anda tidak diperlukan.</p>
        ${_findingInfo(result, agenda)}
        <p>Proses dilanjutkan ke tahap persetujuan final Koordinator untuk penutupan temuan.</p>`,
        'Lihat Dashboard', _appLink('dashboard')));
  }
  const koordinators = getAllKoordinators();
  if (!koordinators.length) return;
  const body = `
    <p>Dept Head dan Auditor telah menyetujui bukti implementasi untuk temuan berikut.
    Diperlukan persetujuan final dari Koordinator untuk resmi menutup temuan ini.</p>
    ${_findingInfo(result, agenda)}
    <table style="border-collapse:collapse;width:100%;font-size:13px;">
      <tr style="background:#f9f9f9;">
          <td style="padding:6px;color:#666;width:160px;">Disetujui Dept Head</td>
          <td style="padding:6px;">Ya</td></tr>
      <tr><td style="padding:6px;color:#666;">Disetujui Auditor</td>
          <td style="padding:6px;">Ya</td></tr>
    </table>`;
  sendEmail(koordinators.map(u => u.email),
    `PERSETUJUAN FINAL DIPERLUKAN — PENUTUPAN TEMUAN ${agenda.dept} | Temuan #${result.nomor_persyaratan}.${result.check_item_no}`,
    emailTemplate('Persetujuan Final: Penutupan Temuan', body,
      'Tinjau & Tutup Temuan di My Task', _appLink('mytask', { result_id: result.result_id })));
}

function notifyFindingClosed(agenda, result) {
  const recipients = [
    ...parseCSV(agenda.auditee_emails),
    ...parseCSV(agenda.auditor_emails),
    agenda.dept_head_email,
    ...getAllKoordinators().map(u => u.email),
  ].filter(function(v, i, a) { return v && a.indexOf(v) === i; });
  const body = `
    <p>Temuan berikut telah resmi ditutup (CLOSED) setelah seluruh tahapan tindak
    lanjut diselesaikan dan disetujui.</p>
    ${_findingInfo(result, agenda)}
    <table style="border-collapse:collapse;width:100%;font-size:13px;">
      <tr><td style="padding:6px;color:#666;width:160px;">Ditutup pada</td>
          <td style="padding:6px;">${formatDatetimeWIB(now())}</td></tr>
    </table>
    <p style="margin-top:16px;">Terima kasih atas kerja sama semua pihak dalam
    menyelesaikan tindak lanjut temuan audit ini.</p>`;
  sendEmail(recipients,
    `TEMUAN CLOSED — ${agenda.dept} | Temuan #${result.nomor_persyaratan}.${result.check_item_no}`,
    emailTemplate('Temuan Resmi Ditutup', body,
      'Lihat Dashboard', _appLink('dashboard')));
}

function notifyRejected(agenda, result, stage, rejecterEmail, komentar) {
  const allParties = [
    ...parseCSV(agenda.auditee_emails),
    ...parseCSV(agenda.auditor_emails),
    agenda.dept_head_email,
  ].filter(function(v, i, a) { return v && a.indexOf(v) === i; });
  const stageLabel   = stage === 'TPP' ? 'Tindakan Perbaikan dan Pencegahan (TPP)' : 'Implementasi';
  const stageSubject = stage === 'TPP' ? 'TPP' : 'IMPLEMENTASI';
  const body = `
    <p><strong>${escapeHtml(stageLabel)}</strong> untuk temuan berikut telah
    <strong>ditolak</strong> dan perlu diperbaiki sebelum diajukan kembali.</p>
    ${_findingInfo(result, agenda)}
    <table style="border-collapse:collapse;width:100%;font-size:13px;">
      <tr><td style="padding:6px;color:#666;width:160px;">Ditolak oleh</td>
          <td style="padding:6px;">${escapeHtml(rejecterEmail)}</td></tr>
      <tr style="background:#f9f9f9;">
          <td style="padding:6px;color:#666;">Alasan Penolakan</td>
          <td style="padding:6px;">${escapeHtml(komentar) || '-'}</td></tr>
    </table>
    <p style="margin-top:16px;">Auditee dimohon memperbaiki dan mengajukan ulang.
    Proses approval akan dimulai kembali dari tahap Dept Head.</p>`;
  sendEmail(allParties,
    `DITOLAK — ${stageSubject} ${agenda.dept} | Temuan #${result.nomor_persyaratan}.${result.check_item_no}`,
    emailTemplate(`${stageLabel} Ditolak`, body,
      'Perbaiki & Ajukan Ulang di My Task', _appLink('mytask', { result_id: result.result_id })));
}
