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
  if (action === 'resendLabReviewEmail') {
    return resendLabReviewEmail(body.caseId, body.token);
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
  if (action === 'getCasePdfData') {
    return getCasePdfData(body.caseId, body.token, body.fileId);
  }
  if (action === 'suggestIdentityIssueDateCrop') {
    return suggestIdentityIssueDateCrop(body.caseId, body.token, body.fileId);
  }
  if (action === 'ocrIdentityIssueDateCrop') {
    return ocrIdentityIssueDateCrop(body.caseId, body.token, body.dataUrl);
  }
  if (action === 'suggestLandRegistryCrop') {
    return suggestLandRegistryCrop(body.caseId, body.token, body.fileId);
  }
  if (action === 'suggestLandRegistryCropFromImage') {
    return suggestLandRegistryCropFromImage(body.caseId, body.token, body.dataUrl);
  }
  if (action === 'suggestLandIssueDateCropFromImage') {
    return suggestLandIssueDateCropFromImage(body.caseId, body.token, body.dataUrl);
  }
  if (action === 'suggestLandCertificateNumberCropFromImage') {
    return suggestLandCertificateNumberCropFromImage(body.caseId, body.token, body.dataUrl);
  }
  if (action === 'suggestLandTextFieldCropFromImage') {
    return suggestLandTextFieldCropFromImage(body.caseId, body.token, body.dataUrl, body.fieldKey);
  }
  if (action === 'analyzeLandPageImage') {
    return analyzeLandPageImage(body.caseId, body.token, body.dataUrl);
  }
  if (action === 'ocrLandRegistryCrop') {
    return ocrLandRegistryCrop(body.caseId, body.token, body.dataUrl);
  }
  if (action === 'ocrA4LandCertificateCrop') {
    return ocrA4LandCertificateCrop(body.caseId, body.token, body.dataUrl, body.cropType);
  }
  if (action === 'ocrLandCriticalFieldCropWithAi') {
    return ocrLandCriticalFieldCropWithAi(body.caseId, body.token, body.dataUrl, body.cropType);
  }
  if (action === 'extractA4LandCertificateFieldsFromStoredOcr') {
    return extractA4LandCertificateFieldsFromStoredOcr(body.caseId, body.token, body.fileId, body.fileName);
  }
  if (action === 'saveAutoOcrFieldValue') {
    return saveAutoOcrFieldValue(body.caseId, body.token, body.fieldPath, body.newValue, body.source);
  }
  if (action === 'saveAutoOcrA4LandFieldValue') {
    return saveAutoOcrA4LandFieldValue(
      body.caseId,
      body.token,
      body.fieldPath,
      body.newValue,
      body.currentValue,
      body.source
    );
  }
  if (action === 'saveAutoOcrA4LandFieldValues') {
    return saveAutoOcrA4LandFieldValues(body.caseId, body.token, body.values || []);
  }
  if (action === 'saveAutoOcrRegistryValue') {
    return saveAutoOcrRegistryValue(
      body.caseId,
      body.token,
      body.fieldPath,
      body.newValue,
      body.currentValue,
      body.readings || [],
      body.verificationMode
    );
  }
  if (action === 'saveAutoOcrIssueDateValue') {
    return saveAutoOcrIssueDateValue(
      body.caseId,
      body.token,
      body.fieldPath,
      body.newValue,
      body.currentValue,
      body.readings || []
    );
  }
  if (action === 'saveAutoOcrCertificateNumberValue') {
    return saveAutoOcrCertificateNumberValue(
      body.caseId,
      body.token,
      body.fieldPath,
      body.newValue,
      body.currentValue,
      body.readings || []
    );
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
