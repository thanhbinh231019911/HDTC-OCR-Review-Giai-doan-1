function getReviewPayload(caseId, token) {
  assertValidToken_(caseId, token);
  let data = getLatestFinalData(caseId) || getLatestExtractedData(caseId);
  if (!data) throw new Error('No review data for case ' + caseId);
  data = ensureTemplateDecisionFields_(data);
  data = applyOverridesToReviewJson(data, getOverrides(caseId));
  repairReviewDataFromFullOcr_(data, caseId);
  data = applyTemplateDecisionToReviewJson(data);
  data = validateReviewJson(data);
  return makeReviewPayloadForClient_(data);
}

function saveManualOverride(caseId, token, fieldPath, newValue, reason) {
  assertValidToken_(caseId, token);
  newValue = normalizeManualOverrideValueForStorage_(newValue);
  let data = getLatestFinalData(caseId) || getLatestExtractedData(caseId);
  if (!data) throw new Error('No review data for case ' + caseId);
  data = applyOverridesToReviewJson(data, getOverrides(caseId));
  repairReviewDataFromFullOcr_(data, caseId);
  const field = getByPath(data, fieldPath);
  if (!field || typeof field !== 'object' || !field.hasOwnProperty('final_value')) {
    throw new Error('Field path is not editable: ' + fieldPath);
  }
  const oldValue = field.final_value || '';
  appendSheetRow(SHEETS.REVIEW_OVERRIDES, {
    'Case ID': caseId,
    'Field Path': fieldPath,
    'Field Label': field.label || fieldPath,
    'Old Value': oldValue,
    'New Value': newValue,
    'Edited By': getActiveUserEmail(),
    'Edited At': nowIso(),
    'Reason': reason || ''
  });
  forceLatestOverrideNewValueAsText_(newValue);
  logAudit(caseId, 'MANUAL_OVERRIDE_SAVED', { field_path: fieldPath, old_value: oldValue, new_value: newValue });
  return { ok: true, field_path: fieldPath, new_value: newValue };
}

function normalizeManualOverrideValueForStorage_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]') return formatDateVi_(value);
  return value == null ? '' : String(value);
}

function repairReviewDataFromFullOcr_(data, caseId) {
  const fullOcr = getFullOcrTextMapsForCase_(caseId, data);
  repairIdentityIssueDatesInReviewJson(data, fullOcr.byFileName);
  repairAssetCertificateTitleInReviewJson(data, fullOcr.assetText);
  repairAssetIssuingAuthorityInReviewJson(data, fullOcr.assetText);
  repairAssetLandAddressInReviewJson(data, fullOcr.assetText);
  repairAssetUsageTermInReviewJson(data, fullOcr.assetText);
  repairAssetAreaWordsInReviewJson(data, fullOcr.assetText);
  return data;
}

function getFullOcrTextMapsForCase_(caseId, reviewJson) {
  const byFileName = {};
  const assetTexts = [];
  function addText(fileName, text, group) {
    fileName = String(fileName || '');
    text = String(text || '');
    if (!fileName || !text) return;
    byFileName[fileName] = byFileName[fileName] ? byFileName[fileName] + '\n\n' + text : text;
    const normalizedGroup = String(group || '').toLowerCase();
    if (normalizedGroup === 'asset' || /^asset/i.test(fileName)) assetTexts.push(text);
  }
  (reviewJson && reviewJson.ocr_results || []).forEach(function(item) {
    addText(item.file_name, item.text || item.text_preview || '', item.group);
  });
  try {
    const rows = getRowsByCaseId_(SHEETS.OCR_RESULTS, caseId);
    rows.forEach(function(row) {
      const fileName = row['File Name'] || '';
      const text = (row['OCR Text'] || '') || readOcrTextFileFromUrl_(row['OCR Text File URL'] || '');
      addText(fileName, text, inferOcrGroupFromFileName_(fileName));
    });
  } catch (err) {
    // Review must still load from the stored JSON if the OCR sheet cannot be read.
  }
  return {
    byFileName: byFileName,
    assetText: assetTexts.join('\n\n')
  };
}

function inferOcrGroupFromFileName_(fileName) {
  const name = String(fileName || '').toLowerCase();
  if (name.indexOf('secured_party__') === 0 || name.indexOf('secured_party') === 0) return 'secured_party';
  if (name.indexOf('obligor__') === 0 || name.indexOf('obligor') === 0) return 'obligor';
  if (name.indexOf('asset__') === 0 || name.indexOf('asset') === 0) return 'asset';
  return '';
}

function readOcrTextFileFromUrl_(url) {
  const fileId = extractDriveFileIdFromUrl_(url);
  if (!fileId) return '';
  try {
    return DriveApp.getFileById(fileId).getBlob().getDataAsString('UTF-8') || '';
  } catch (err) {
    return '';
  }
}

function extractDriveFileIdFromUrl_(url) {
  url = String(url || '');
  const patterns = [
    /\/d\/([a-zA-Z0-9_-]{20,})/,
    /[?&]id=([a-zA-Z0-9_-]{20,})/,
    /open\?id=([a-zA-Z0-9_-]{20,})/
  ];
  for (let i = 0; i < patterns.length; i++) {
    const match = url.match(patterns[i]);
    if (match) return match[1];
  }
  return '';
}

function forceLatestOverrideNewValueAsText_(newValue) {
  const sheet = getSheet(SHEETS.REVIEW_OVERRIDES);
  const headers = getHeaders_(sheet);
  const row = sheet.getLastRow();
  const col = headers.indexOf('New Value') + 1;
  if (row > 1 && col > 0) {
    sheet.getRange(row, col).setNumberFormat('@').setValue(String(newValue == null ? '' : newValue));
  }
}

function saveContractDraftInfo(caseId, token, values) {
  assertValidToken_(caseId, token);
  values = values || {};
  const allowed = {
    'contract_info.asset_type': true,
    'contract_info.contract_type': true,
    'contract_info.asset_count': true,
    'contract_info.valuation_amount': true,
    'contract_info.bank_signer': true,
    'contract_info.bank_signer_title': true,
    'contract_info.bank_unit_address': true,
    'contract_info.dispute_court': true,
    'contract_info.cif_customer': true,
    'contract_info.contract_date': true,
    'contract_info.contract_sequence': true,
    'contract_info.valuation_land_amount': true,
    'contract_info.valuation_house_amount': true,
    'contract_info.valuation_total_amount': true,
    'contract_info.contract_draft_saved': true,
    'contract_info.actual_asset_differs_from_certificate': true,
    'contract_info.actual_asset_difference_description': true,
    'contract_info.actual_house_asset': true
  };
  let data = getLatestFinalData(caseId) || getLatestExtractedData(caseId);
  if (!data) throw new Error('No review data for case ' + caseId);
  data = ensureTemplateDecisionFields_(data);
  data = applyOverridesToReviewJson(data, getOverrides(caseId));
  repairReviewDataFromFullOcr_(data, caseId);
  Object.keys(values).forEach(function(fieldPath) {
    if (!allowed[fieldPath]) return;
    const field = getByPath(data, fieldPath);
    if (!field || typeof field !== 'object' || !field.hasOwnProperty('final_value')) return;
    const newValue = values[fieldPath] == null ? '' : String(values[fieldPath]);
    const oldValue = field.final_value || '';
    if (String(oldValue) === String(newValue)) return;
    appendSheetRow(SHEETS.REVIEW_OVERRIDES, {
      'Case ID': caseId,
      'Field Path': fieldPath,
      'Field Label': field.label || fieldPath,
      'Old Value': oldValue,
      'New Value': newValue,
      'Edited By': getActiveUserEmail(),
      'Edited At': nowIso(),
      'Reason': 'CONTRACT_DRAFT_INFO'
    });
  });
  logAudit(caseId, 'CONTRACT_DRAFT_INFO_SAVED', { fields: Object.keys(values) });
  return getReviewPayload(caseId, token);
}

function confirmSingleField(caseId, token, fieldPath) {
  assertValidToken_(caseId, token);
  let data = getLatestFinalData(caseId) || getLatestExtractedData(caseId);
  data = applyOverridesToReviewJson(data, getOverrides(caseId));
  repairReviewDataFromFullOcr_(data, caseId);
  const field = getByPath(data, fieldPath);
  if (!field || typeof field !== 'object' || !field.hasOwnProperty('final_value')) {
    throw new Error('Field path is not confirmable: ' + fieldPath);
  }
  field.confirmed = true;
  logAudit(caseId, 'FIELD_CONFIRMED', { field_path: fieldPath, value: field.final_value });
  return data;
}

function confirmReview(caseId, token, forceConfirm) {
  assertValidToken_(caseId, token);
  let data = getLatestExtractedData(caseId);
  if (!data) throw new Error('No extracted data for case ' + caseId);
  data = ensureTemplateDecisionFields_(data);
  data = applyOverridesToReviewJson(data, getOverrides(caseId));
  repairReviewDataFromFullOcr_(data, caseId);
  data = applyTemplateDecisionToReviewJson(data);
  data = validateReviewJson(data);
  const hasSeriousIssues = data.validation.missing_fields.length || data.validation.conflicts.length;
  if (hasSeriousIssues && !forceConfirm) {
    return {
      ok: false,
      requires_force: true,
      message: 'Hồ sơ còn trường thiếu hoặc mâu thuẫn nghiêm trọng.',
      data: data
    };
  }
  const status = hasSeriousIssues ? CASE_STATUS.REVIEW_CONFIRMED_WITH_WARNINGS : CASE_STATUS.REVIEW_CONFIRMED;
  data.review.status = status;
  data.review.confirmed_by = getActiveUserEmail();
  data.review.confirmed_at = nowIso();
  data = applyTemplateDecisionToReviewJson(data);
  data.final_confirmed_data = buildFinalConfirmedData(data);
  const folders = getCaseFoldersFromCaseRow_(caseId);
  const finalFile = saveJsonFile(folders.finalFolderId, caseId + '_final_confirmed_data.json', data);
  appendSheetRow(SHEETS.FINAL_DATA, {
    'Case ID': caseId,
    'Final JSON': data,
    'Review Status': status,
    'Confirmed By': data.review.confirmed_by,
    'Confirmed At': data.review.confirmed_at,
    'Final JSON File URL': finalFile.url
  });
  updateCase(caseId, { 'Status': status, 'Review Confirmed At': data.review.confirmed_at });
  logAudit(caseId, 'REVIEW_CONFIRMED', { status: status, final_file_url: finalFile.url });
  return { ok: true, requires_force: false, message: 'Đã xác nhận dữ liệu.', data: data };
}

function getCaseImagePreview(caseId, token, fileId) {
  assertValidToken_(caseId, token);
  const data = getLatestFinalData(caseId) || getLatestExtractedData(caseId);
  if (!data) throw new Error('No review data for case ' + caseId);
  const allowed = (data.ocr_results || []).some(function(item) {
    return item.file_id === fileId;
  });
  if (!allowed) throw new Error('File is not part of this case');
  const file = DriveApp.getFileById(fileId);
  const mimeType = file.getMimeType();
  if (mimeType.indexOf('image/') !== 0) {
    return {
      file_id: fileId,
      file_name: file.getName(),
      mime_type: mimeType,
      is_image: false,
      data_url: ''
    };
  }
  const blob = resizeImageBlobForReview_(file.getBlob());
  return {
    file_id: fileId,
    file_name: file.getName(),
    mime_type: blob.getContentType() || mimeType,
    is_image: true,
    data_url: 'data:' + (blob.getContentType() || mimeType) + ';base64,' + Utilities.base64Encode(blob.getBytes())
  };
}

function getCaseOcrText(caseId, token, fileId, fileName) {
  assertValidToken_(caseId, token);
  const data = getLatestFinalData(caseId) || getLatestExtractedData(caseId);
  if (!data) throw new Error('No review data for case ' + caseId);
  const allowed = (data.ocr_results || []).some(function(item) {
    return (fileId && item.file_id === fileId) || (fileName && item.file_name === fileName);
  });
  if (!allowed) throw new Error('OCR file is not part of this case');
  const rows = getRowsByCaseId_(SHEETS.OCR_RESULTS, caseId);
  for (let i = rows.length - 1; i >= 0; i--) {
    const rowFileName = rows[i]['File Name'] || '';
    const rowFileId = rows[i]['File ID'] || '';
    if ((fileId && rowFileId === fileId) || (fileName && rowFileName === fileName)) {
      return {
        file_id: rowFileId,
        file_name: rowFileName,
        text: rows[i]['OCR Text'] || ''
      };
    }
  }
  return {
    file_id: fileId || '',
    file_name: fileName || '',
    text: ''
  };
}

function makeReviewPayloadForClient_(data) {
  const copy = JSON.parse(JSON.stringify(data || {}));
  copy.ocr_results = (copy.ocr_results || []).map(function(item) {
    item.text_preview = makeClientOcrPreview_(item.text_preview || '');
    return item;
  });
  trimLongReviewStringsForClient_(copy);
  return copy;
}

function makeClientOcrPreview_(text) {
  text = String(text || '');
  const maxChars = 900;
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + '\n...[OCR_TEXT_TRUNCATED_CLIENT]';
}

function trimLongReviewStringsForClient_(value) {
  if (!value || typeof value !== 'object') return;
  Object.keys(value).forEach(function(key) {
    const item = value[key];
    if (typeof item === 'string' && item.length > 5000) {
      value[key] = item.slice(0, 5000) + '\n...[LONG_TEXT_TRUNCATED_CLIENT]';
      return;
    }
    if (item && typeof item === 'object') trimLongReviewStringsForClient_(item);
  });
}

function resizeImageBlobForReview_(blob) {
  try {
    return ImagesService.openImage(blob)
      .resize(1200, 1600)
      .getBlob()
      .setName(blob.getName() || 'review_image');
  } catch (err) {
    return blob;
  }
}

function assertValidToken_(caseId, token) {
  const row = getCaseRow(caseId);
  if (!row) throw new Error('Invalid case');
  const expected = row['Review Token Hash'];
  if (!token || sha256Hex(token) !== expected) throw new Error('Invalid review token');
}

function getCaseFoldersFromCaseRow_(caseId) {
  const row = getCaseRow(caseId);
  const caseFolderUrl = row['Drive Folder URL'];
  const match = String(caseFolderUrl).match(/[-\w]{25,}/);
  if (!match) throw new Error('Cannot detect case folder ID from URL: ' + caseFolderUrl);
  const caseFolder = DriveApp.getFolderById(match[0]);
  const finalFolder = getOrCreateChildFolder_(caseFolder, '05_Final_Data');
  return { caseFolderId: caseFolder.getId(), finalFolderId: finalFolder.getId() };
}
