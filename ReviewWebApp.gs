function doGet(e) {
  const template = HtmlService.createTemplateFromFile('Review');
  template.caseId = e.parameter.caseId || '';
  template.token = e.parameter.token || '';
  return template.evaluate()
    .setTitle('Review hồ sơ OCR')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function doPost(e) {
  try {
    const body = parseJsonSafe(e.postData && e.postData.contents, {});
    const result = reviewApi(body);
    return jsonResponse_({ ok: true, result: result });
  } catch (err) {
    return jsonResponse_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function reviewApi(body) {
  const action = body.action;
  if (action === 'getReview') {
    return getReviewPayload(body.caseId, body.token);
  }
  if (action === 'saveOverride') {
    return saveManualOverride(body.caseId, body.token, body.fieldPath, body.newValue, body.reason);
  }
  if (action === 'confirmField') {
    return confirmSingleField(body.caseId, body.token, body.fieldPath);
  }
  if (action === 'confirmReview') {
    return confirmReview(body.caseId, body.token, Boolean(body.forceConfirm));
  }
  if (action === 'getCaseImagePreview') {
    return getCaseImagePreview(body.caseId, body.token, body.fileId);
  }
  if (action === 'getCaseOcrText') {
    return getCaseOcrText(body.caseId, body.token, body.fileId, body.fileName);
  }
  if (action === 'listContractTemplates') {
    return listContractTemplatesForReview(body.caseId, body.token);
  }
  if (action === 'generateContracts') {
    return generateContractsForCase(body.caseId, body.token, body.templateCodes || []);
  }
  if (action === 'saveContractDraftInfo') {
    return saveContractDraftInfo(body.caseId, body.token, body.values || {});
  }
  throw new Error('Unknown action: ' + action);
}

function jsonResponse_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
