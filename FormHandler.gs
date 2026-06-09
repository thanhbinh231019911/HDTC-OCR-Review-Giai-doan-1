function onFormSubmit(e) {
  setupSpreadsheet();
  const caseId = makeCaseId();
  try {
    const formData = formEventToData_(e);
    const token = randomToken();
    const reviewUrl = buildReviewUrl(caseId, token);
    const folders = createCaseFolders(caseId, formData.reviewEmail);

    appendSheetRow(SHEETS.RESPONSES, {
      'Timestamp': nowIso(),
      'Case ID': caseId,
      'Review Email': formData.reviewEmail,
      'Asset Type': formData.assetType,
      'Contract Type': formData.contractType,
      'Asset Count': formData.assetCount,
      'Bank Signer': formData.bankSigner,
      'Dispute Court': formData.disputeCourt,
      'Valuation Amount': formData.valuationAmount,
      'Raw Form JSON': jsonStringify(e && e.namedValues ? e.namedValues : {})
    });

    appendSheetRow(SHEETS.CASES, {
      'Case ID': caseId,
      'Review Email': formData.reviewEmail,
      'Status': CASE_STATUS.CREATED,
      'Drive Folder URL': folders.caseFolderUrl,
      'Review URL': reviewUrl,
      'Review Token Hash': sha256Hex(token),
      'Created At': nowIso()
    });
    logAudit(caseId, 'CASE_CREATED', { folders: folders, review_url_created: Boolean(reviewUrl) }, formData.reviewEmail);

    const uploadedFiles = copyUploadedFilesToCase(formData.fileIdsByGroup, folders);
    const ocrResults = ocrFilesForCase(caseId, uploadedFiles, folders);
    const ai = extractDataWithAi(caseId, formData, ocrResults, folders);
    let reviewJson = buildReviewJson(caseId, formData, ai.data, ocrResults);
    reviewJson.review.review_url = reviewUrl;
    reviewJson.review.token_hash = sha256Hex(token);
    reviewJson = validateReviewJson(reviewJson);

    const reviewFile = saveJsonFile(folders.subfolders['04_Review_Data'].id, caseId + '_review_data.json', reviewJson);
    appendSheetRow(SHEETS.EXTRACTED_DATA, {
      'Case ID': caseId,
      'JSON Data': reviewJson,
      'Validation Status': reviewJson.validation.status,
      'Missing Fields': reviewJson.validation.missing_fields,
      'Conflicts': reviewJson.validation.conflicts,
      'Warnings': reviewJson.validation.warnings,
      'AI JSON File URL': ai.fileUrl,
      'Created At': nowIso()
    });
    logAudit(caseId, 'REVIEW_DATA_CREATED', { review_file_url: reviewFile.url });

    sendReviewEmail(caseId, formData.reviewEmail, reviewUrl);
    updateCase(caseId, { 'Status': CASE_STATUS.REVIEW_SENT, 'Email Sent At': nowIso() });
    logAudit(caseId, 'REVIEW_EMAIL_SENT', { to: formData.reviewEmail });
  } catch (err) {
    logCaseError(caseId, err, 'onFormSubmit');
    throw err;
  }
}

function formEventToData_(e) {
  const nv = e && e.namedValues ? e.namedValues : {};
  const fields = CONFIG.FORM_FIELDS;
  const reviewEmail = getNamedValue(nv, fields.reviewEmail) || findEmailInNamedValues_(nv);
  const uploads = getUploadValuesByGroup_(nv, fields);
  return {
    reviewEmail: reviewEmail,
    assetType: getNamedValue(nv, fields.assetType),
    contractType: getNamedValue(nv, fields.contractType),
    assetCount: getNamedValue(nv, fields.assetCount),
    bankSigner: getNamedValue(nv, fields.bankSigner),
    disputeCourt: getNamedValue(nv, fields.disputeCourt),
    valuationAmount: getNamedValue(nv, fields.valuationAmount),
    fileIdsByGroup: {
      secured_party: extractFileIds(uploads.secured_party),
      obligor: extractFileIds(uploads.obligor),
      asset: extractFileIds(uploads.asset)
    }
  };
}

function findEmailInNamedValues_(namedValues) {
  const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
  const keys = Object.keys(namedValues || {});
  for (let i = 0; i < keys.length; i++) {
    const value = namedValues[keys[i]];
    const text = Array.isArray(value) ? value.join(' ') : String(value || '');
    const match = text.match(emailPattern);
    if (match) return match[0].trim();
  }
  return '';
}

function getUploadValuesByGroup_(namedValues, fields) {
  const exact = {
    secured_party: getNamedValue(namedValues, fields.securedPartyFiles),
    obligor: getNamedValue(namedValues, fields.obligorFiles),
    asset: getNamedValue(namedValues, fields.assetFiles)
  };
  const candidates = Object.keys(namedValues || [])
    .map(function(key) {
      return {
        key: key,
        key_norm: normalizeLooseKey_(key),
        value: getNamedValue(namedValues, key)
      };
    })
    .filter(function(item) {
      return extractFileIds(item.value).length > 0;
    });

  if (exact.secured_party && exact.obligor && exact.asset) return exact;

  const result = {
    secured_party: exact.secured_party,
    obligor: exact.obligor,
    asset: exact.asset
  };
  candidates.forEach(function(item) {
    if (!result.secured_party && isSecuredPartyUploadKey_(item.key_norm)) result.secured_party = item.value;
    else if (!result.obligor && isObligorUploadKey_(item.key_norm)) result.obligor = item.value;
    else if (!result.asset && isAssetUploadKey_(item.key_norm)) result.asset = item.value;
  });

  const unused = candidates
    .map(function(item) { return item.value; })
    .filter(function(value) {
      return value !== result.secured_party && value !== result.obligor && value !== result.asset;
    });

  if (!result.secured_party && unused.length) result.secured_party = unused.shift();
  if (!result.obligor && unused.length) result.obligor = unused.shift();
  if (!result.asset && unused.length) result.asset = unused.shift();

  console.log('Upload field mapping: ' + JSON.stringify({
    secured_party_files: extractFileIds(result.secured_party).length,
    obligor_files: extractFileIds(result.obligor).length,
    asset_files: extractFileIds(result.asset).length,
    candidate_keys: candidates.map(function(item) { return item.key; })
  }));
  return result;
}

function normalizeLooseKey_(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isSecuredPartyUploadKey_(key) {
  return key.indexOf('secured') >= 0
    || key.indexOf('bao dam') >= 0
    || key.indexOf('chu tai san') >= 0
    || key.indexOf('bảo đảm') >= 0;
}

function isObligorUploadKey_(key) {
  return key.indexOf('obligor') >= 0
    || key.indexOf('duoc bao dam') >= 0
    || key.indexOf('được bảo đảm') >= 0;
}

function isAssetUploadKey_(key) {
  return key.indexOf('asset') >= 0
    || key.indexOf('tai san') >= 0
    || key.indexOf('tài sản') >= 0;
}

function installFormSubmitTrigger() {
  const ss = SpreadsheetApp.getActive();
  ScriptApp.newTrigger('onFormSubmit').forSpreadsheet(ss).onFormSubmit().create();
}

function reinstallFormSubmitTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  let deleted = 0;
  triggers.forEach(function(trigger) {
    if (trigger.getHandlerFunction && trigger.getHandlerFunction() === 'onFormSubmit') {
      ScriptApp.deleteTrigger(trigger);
      deleted++;
    }
  });
  installFormSubmitTrigger();
  const message = 'Reinstalled onFormSubmit trigger. Deleted old triggers: ' + deleted;
  console.log(message);
  return message;
}
