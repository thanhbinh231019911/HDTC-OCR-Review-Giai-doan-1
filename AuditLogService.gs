function logAudit(caseId, action, detail, user) {
  appendSheetRow(SHEETS.AUDIT_LOGS, {
    'Case ID': caseId,
    'Action': action,
    'Detail': typeof detail === 'string' ? detail : jsonStringify(detail || {}),
    'User': user || getActiveUserEmail(),
    'Timestamp': nowIso()
  });
}

function logCaseError(caseId, err, context) {
  const message = (context ? context + ': ' : '') + (err && err.stack ? err.stack : String(err));
  try {
    updateCase(caseId, { 'Status': CASE_STATUS.ERROR, 'Last Error': message.slice(0, 45000) });
  } catch (innerErr) {
    // Keep original error visible in Stackdriver even if the sheet update fails.
    console.error(innerErr);
  }
  logAudit(caseId, 'ERROR', message);
}
