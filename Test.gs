function clearAllCachesManual() {
  // Server-side CacheService
  invalidateUsersCache();
  invalidateAreasCache();
  invalidatePeriodsCache();
  CacheService_invalidateMaster();

  // Agenda cache — per period_id
  // Ambil semua periode lalu invalidate cache agendanya
  var periods = getAllPeriods(true);
  periods.forEach(function(p) {
    invalidateAgendasCache(p.period_id);
  });

  console.log('Semua cache server-side berhasil dikosongkan.');
  console.log('Periode yang di-invalidate: ' + periods.length);
}
