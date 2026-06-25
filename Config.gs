// ============================================================
//  Config.gs — v2 (refactored)
//  Perubahan dari v1:
//  - AUDIT_SHEETS: hapus SESSIONS, FINDINGS, AGENDA_CHECKLIST
//                  tambah AGENDA (arsip dari master)
//  - COLS.AUDIT_AGENDA: tambah kolom operasional session
//  - AUDIT_COLS.AUDIT_RESULTS: 21 kolom baru (gabungan result + finding + checklist)
//  - AUDIT_COLS.TPP_ITEMS: finding_id → result_id
//  - AUDIT_COLS.APPROVAL_LOG: finding_id → result_id, hapus session_id
//  - AUDIT_COLS.REQUIREMENT_LOCKS: session_id → agenda_id
//  - Hapus AUDIT_COLS.SESSIONS, FINDINGS, AGENDA_CHECKLIST
//  - Hapus SESSION_STATUS (tidak ada lagi)
// ============================================================

const CONFIG = {

  MASTER_SPREADSHEET_ID: '1l2U7tp04J5zx8oDCPnLie8a3g-FOQzeS9hppPBTgkAU',
  ALLOWED_DOMAIN:        'wingscorp.com',
  DRIVE_ROOT_FOLDER_NAME:'AUDIT_SYSTEM',

  // ── Sheet names di Master Spreadsheet ───────────────────────
  SHEETS: {
    USERS:            'USERS',
    AREAS:            'AREAS',
    CHECKLIST_MASTER: 'CHECKLIST_MASTER',
    AUDIT_REGISTRY:   'AUDIT_REGISTRY',
    AUDIT_AGENDA:     'AUDIT_AGENDA',
    CACHE_META:       'CACHE_META',
  },

  // ── Sheet names di file audit per-periode ───────────────────
  AUDIT_SHEETS: {
    AUDIT_RESULTS:     'AUDIT_RESULTS',     // satu-satunya sheet data audit utama
    TPP_ITEMS:         'TPP_ITEMS',         // tindak lanjut per temuan
    REQUIREMENT_LOCKS: 'REQUIREMENT_LOCKS', // locking saat audit berlangsung
    APPROVAL_LOG:      'APPROVAL_LOG',      // log approval chain
    AGENDA:            'AGENDA',            // arsip AUDIT_AGENDA saat periode selesai
  },

  // ── Roles ────────────────────────────────────────────────────
  ROLES: {
    KOORDINATOR: 'Koordinator',
    AUDITOR:     'Auditor',
    AUDITEE:     'Auditee',
    VIEWER:      'Viewer',
  },

  KATEGORI: ['Office', 'Laboratorium', 'Maintenance', 'Produksi', 'Gudang'],
  ASPEK:    ['Plan', 'Do', 'Check', 'Action'],

  // ── Status enums ─────────────────────────────────────────────

  FINDING_STATUS: {
    PENDING_VERIFICATION: 'PENDING_VERIFICATION',
    OPEN:                 'OPEN',
    TPP_OR_DEPT_HEAD:     'TPP_OR_DEPT_HEAD',
    TPP_OR_AUDITOR:       'TPP_OR_AUDITOR',
    TPP_OR_KOORDINATOR:   'TPP_OR_KOORDINATOR',
    OPEN_IMPL:            'OPEN_IMPL',
    APP_DEPT_HEAD:        'APP_DEPT_HEAD',
    APP_AUDITOR:          'APP_AUDITOR',
    APP_KOORDINATOR:      'APP_KOORDINATOR',
    CLOSED:               'CLOSED',
    OVERDUE:              'OVERDUE', // Set saat Koordinator force-complete periode
  },

  AGENDA_STATUS: {
    PLANNED: 'PLANNED', // koordinator assign, auditor belum mulai
    STARTED: 'STARTED', // auditor sudah mulai, belum submit
    DONE:    'DONE',    // auditor submit + agreement selesai
  },

  PERIOD_STATUS: {
    PLANNED:   'PLANNED',
    ACTIVE:    'ACTIVE',
    COMPLETED: 'COMPLETED',
  },

  RESULT_STATUS: {
    COMPLY:     'Comply',
    NON_COMPLY: 'Non Comply',
  },

  APPROVAL_STATUS: {
    PENDING:  'PENDING',
    APPROVED: 'APPROVED',
    REJECTED: 'REJECTED',
  },

  TPP_ITEM_TYPE: {
    CORRECTION:        'CORRECTION',
    CORRECTIVE_ACTION: 'CORRECTIVE_ACTION',
  },

  IS_OVERDUE: false, // disabled — akan diaktifkan saat logic overdue diimplementasi

  NOTIFICATIONS_ENABLED: true,   // ← set false untuk disable semua notifikasi
  TEST_MODE_EMAIL: '', // ← kosongkan ('') untuk production

  LOCK_TIMEOUT_MINUTES: 60,
  CACHE_TTL_SECONDS:    21600,

  // ── Kolom Master Spreadsheet ─────────────────────────────────
  COLS: {
    USERS: {
      USER_ID: 0, EMAIL: 1, NAMA: 2, ROLES: 3, AKTIF: 4,
    },

    AREAS: {
      AREA_ID: 0, KATEGORI: 1, DEPT: 2,
      DEPT_HEAD_EMAIL: 3, DEPT_HEAD_NAME: 4,
      AREA_SAMPLING: 5,
      AUDITEE_EMAILS: 6, AUDITEE_NAMES: 7,
      AKTIF: 8,
    },

    CHECKLIST_MASTER: {
      ITEM_ID: 0, TIPE: 1, KATEGORI: 2, NOMOR: 3, ASPEK: 4,
      PERSYARATAN: 5, CHECK_ITEM: 6, STANDAR_CHECK_ITEM: 7, LABELS: 8, AKTIF: 9,
    },

    AUDIT_REGISTRY: {
      PERIOD_ID: 0, NAMA_PERIODE: 1, SPREADSHEET_ID: 2, SPREADSHEET_URL: 3,
      TANGGAL_MULAI: 4, TANGGAL_SELESAI: 5, STATUS: 6,
      CREATED_BY: 7, CREATED_AT: 8,
      ARCHIVED: 9, ARCHIVED_AT: 10, COMPLETED_AT: 11,
    },

    // AUDIT_AGENDA — diperluas, menggantikan SESSIONS
    // Grup 1: identitas agenda
    // Grup 2: detail area & checklist
    // Grup 3: operasional audit (diisi saat/setelah audit berjalan)
    AUDIT_AGENDA: {
      // Grup 1 — identitas
      AGENDA_ID:    0,
      PERIOD_ID:    1,
      AREA_ID:      2,
      DEPT:         3,
      KATEGORI:     4,

      // Grup 2 — assignment
      AUDITOR_EMAILS:  5,
      LEAD_AUDITOR:    6,
      AUDITEE_EMAILS:  7,   // dari AREAS
      DEPT_HEAD_EMAIL: 8,   // snapshot dari AREAS
      ASSIGNED_BY:     9,
      ASSIGNED_AT:     10,
      // JADWAL_TANGGAL dihapus

      // Grup 3 — operasional (diisi saat audit berjalan)
      STATUS:        11,    // PLANNED / STARTED / DONE
      STARTED_BY:    12,
      STARTED_AT:    13,
      AREA_SAMPLING: 14,   // snapshot dari AREAS

      // Grup 4 — agreement (diisi saat auditor selesai)
      OFI:                  15,  // Opportunity for Improvement — free text
      AGREEMENT_FOTO_URL:   16,
      AGREEMENT_BY:         17,
      AGREEMENT_AT:         18,
      AUDITEE_HADIR_NAMES:  19,
    },

    CACHE_META: {
      CACHE_KEY: 0, LAST_UPDATED: 1, INVALIDATED: 2, KETERANGAN: 3,
    },
  },

  // ── Kolom file audit per-periode ────────────────────────────
  AUDIT_COLS: {

    // AUDIT_RESULTS — 21 kolom, gabungan result + finding + checklist snapshot
    // Baris dibuat saat agenda dibuat (Opsi B), di-populate per check item
    AUDIT_RESULTS: {
      // Grup 1 — identitas baris
      RESULT_ID:   0,   // PK unik per check item per agenda
      AGENDA_ID:   1,   // FK ke AUDIT_AGENDA (master) / AGENDA (arsip)
      PERIOD_ID:   2,   // untuk query lintas agenda tanpa join

      // Grup 2 — snapshot checklist (dari CHECKLIST_MASTER saat agenda dibuat)
      ITEM_ID:            3,
      TIPE:               4,   // GENERAL / KHUSUS
      KATEGORI:           5,
      NOMOR_PERSYARATAN:  6,
      CHECK_ITEM_NO:      7,   // urutan 1,2,3... dalam satu persyaratan
      ASPEK:              8,   // Plan / Do / Check / Action
      PERSYARATAN:        9,   // teks klausul
      CHECK_ITEM:         10,  // teks pertanyaan audit
      STANDAR_CHECK_ITEM: 11,  // kriteria/referensi standar

      // Grup 3 — diisi auditor saat audit (awalnya kosong)
      STATUS:           12,  // kosong → Comply / Non Comply
      DESKRIPSI_TEMUAN: 13,  // diisi kalau Non Comply
      LOKASI_TEMUAN:    14,  // diisi kalau Non Comply — free text lokasi
      FOTO_URLS:        15,  // diisi kalau Non Comply
      AUDITOR_EMAIL:    16,  // siapa yang mengisi
      SAVED_AT:         17,  // kapan terakhir diisi/diubah

      // Grup 4 — tindak lanjut temuan (hanya terisi untuk Non Comply)
      FINDING_STATUS: 18,
      TARGET_DATE:    19,
      IS_OVERDUE:     20,
      CLOSED_AT:      21,
    },

    // TPP_ITEMS — result_id menggantikan finding_id
    TPP_ITEMS: {
      TPP_ITEM_ID:      0,
      RESULT_ID:        1,  // FK ke AUDIT_RESULTS (sebelumnya finding_id)
      TIPE:             2,  // CORRECTION / CORRECTIVE_ACTION
      DESKRIPSI:        3,
      SUBMITTED_BY:     4,
      SUBMITTED_AT:     5,
      IMPL_FOTO_URLS:   6,
      IMPL_KETERANGAN:  7,
      IMPL_SUBMITTED_AT: 8,
      IMPL_SUBMITTED_BY: 9,
    },

    // REQUIREMENT_LOCKS — agenda_id menggantikan session_id
    REQUIREMENT_LOCKS: {
      LOCK_ID:           0,
      AGENDA_ID:         1,  // sebelumnya session_id
      NOMOR_PERSYARATAN: 2,
      LOCKED_BY:         3,
      LOCKED_AT:         4,
      STATUS:            5,
    },

    // APPROVAL_LOG — result_id menggantikan finding_id, hapus session_id (derive dari result)
    APPROVAL_LOG: {
      LOG_ID:      0,
      RESULT_ID:   1,  // sebelumnya finding_id
      AGENDA_ID:   2,  // sebelumnya session_id
      STAGE:       3,
      LEVEL:       4,
      ACTION:      5,
      BY_EMAIL:    6,
      AT:          7,
      KOMENTAR:    8,
      SKIPPED:     9,
      SKIP_REASON: 10,
    },

    // AGENDA — sheet arsip di file periode (read-only, copy dari AUDIT_AGENDA master)
    // Kolom identik dengan COLS.AUDIT_AGENDA
    AGENDA: {
      AGENDA_ID:    0,
      PERIOD_ID:    1,
      AREA_ID:      2,
      DEPT:         3,
      KATEGORI:     4,
      AUDITOR_EMAILS:    5,
      LEAD_AUDITOR:      6,
      AUDITEE_EMAILS:    7,
      DEPT_HEAD_EMAIL:   8,
      ASSIGNED_BY:       9,
      ASSIGNED_AT:       10,
      STATUS:            11,
      STARTED_BY:        12,
      STARTED_AT:        13,
      AREA_SAMPLING:     14,
      OFI:               15,
      AGREEMENT_FOTO_URL:   16,
      AGREEMENT_BY:         17,
      AGREEMENT_AT:         18,
      AUDITEE_HADIR_NAMES:  19,
    },
  },
};
