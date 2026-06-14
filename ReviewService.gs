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
  repairIdentityIssueDatesWithVision_(data, caseId, fullOcr.byFileName);
  repairAssetCertificateTitleInReviewJson(data, fullOcr.assetText);
  repairAssetIssuingAuthorityInReviewJson(data, fullOcr.assetText);
  repairAssetLandAddressInReviewJson(data, fullOcr.assetText);
  repairAssetUsageTermInReviewJson(data, fullOcr.assetText);
  repairAssetAreaWordsInReviewJson(data, fullOcr.assetText);
  return data;
}

function repairIdentityIssueDatesWithVision_(data, caseId, ocrTextByFile) {
  if (!data || !caseId) return data;
  const apiKey = PropertiesService.getScriptProperties().getProperty(CONFIG.OPENAI_API_KEY_PROPERTY);
  if (!apiKey) return data;
  let rows = [];
  try {
    rows = getRowsByCaseId_(SHEETS.OCR_RESULTS, caseId);
  } catch (err) {
    return data;
  }
  const candidatesByFileName = {};
  rows.forEach(function(row) {
    const fileName = String(row['File Name'] || '');
    const fileId = String(row['File ID'] || '');
    if (!fileName || !fileId) return;
    candidatesByFileName[fileName] = {
      fileName: fileName,
      fileId: fileId,
      text: (row['OCR Text'] || '') || (ocrTextByFile && ocrTextByFile[fileName]) || ''
    };
  });
  function repairPerson(person) {
    if (!person || !person.id_issue_date || person.id_issue_date.manual_value) return;
    const id = normalizeId_(person.id_number && person.id_number.final_value);
    if (!id) return;
    const current = normalizeDateValue_(person.id_issue_date.final_value || person.id_issue_date.ai_value);
    const source = String(person.id_issue_date.source || '');
    const currentText = removeVietnameseAccents_(String(person.id_issue_date.final_value || '')).toLowerCase();
    if (current && source !== 'OCR_DATE_UNREADABLE' && currentText.indexOf('khong ro') < 0) return;
    const fileNames = Object.keys(candidatesByFileName);
    for (let i = 0; i < fileNames.length; i++) {
      const item = candidatesByFileName[fileNames[i]];
      if (!identityOcrContainsId_(item.text, id) || !isLikelyBackSideIdentityOcr_(item.text)) continue;
      const vision = readIdentityIssueDateFromImageWithOpenAi_(item.fileId, item.fileName);
      if (!vision.date) continue;
      person.id_issue_date.ai_value = vision.date;
      person.id_issue_date.final_value = vision.date;
      person.id_issue_date.source = item.fileName + ' | OPENAI_VISION_DATE';
      person.id_issue_date.confidence = vision.confidence || 0.92;
      return;
    }
  }
  (data.secured_parties || []).forEach(repairPerson);
  (data.obligors || []).forEach(repairPerson);
  return data;
}

function readIdentityIssueDateFromImageWithOpenAi_(fileId, fileName) {
  try {
    const apiKey = PropertiesService.getScriptProperties().getProperty(CONFIG.OPENAI_API_KEY_PROPERTY);
    if (!apiKey) return { date: '', confidence: '' };
    const file = DriveApp.getFileById(fileId);
    const blob = file.getBlob();
    const contentType = blob.getContentType() || 'image/jpeg';
    if (contentType.indexOf('image/') !== 0) return { date: '', confidence: '' };
    const dataUrl = 'data:' + contentType + ';base64,' + Utilities.base64Encode(blob.getBytes());
    const payload = {
      model: PropertiesService.getScriptProperties().getProperty('OPENAI_VISION_MODEL') ||
        PropertiesService.getScriptProperties().getProperty('OPENAI_MODEL') ||
        CONFIG.OPENAI_MODEL_DEFAULT,
      input: [{
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: [
              'Read the Vietnamese ID card back-side image.',
              'Return only JSON: {"date":"dd/MM/yyyy or empty","confidence":0..1,"evidence":"short text seen"}.',
              'The field is issue date near labels "Ngày, tháng, năm / Date, month, year" or "Ngày, tháng, năm cấp / Date of issue".',
              'Do not infer from corrupted OCR. If the date is not visually clear, return empty date.',
              'Do not use birth date, expiry date, MRZ dates, or any other date.'
            ].join(' ')
          },
          { type: 'input_image', image_url: dataUrl }
        ]
      }],
      text: {
        format: {
          type: 'json_schema',
          name: 'identity_issue_date_from_image',
          strict: false,
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              date: { type: 'string' },
              confidence: { type: 'number' },
              evidence: { type: 'string' }
            },
            required: ['date']
          }
        }
      }
    };
    const response = withRetry('OpenAI vision issue date ' + fileName, function() {
      const res = UrlFetchApp.fetch(CONFIG.OPENAI_ENDPOINT, {
        method: 'post',
        contentType: 'application/json',
        headers: { Authorization: 'Bearer ' + apiKey },
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      });
      if (res.getResponseCode() >= 300) throw new Error(res.getContentText());
      return JSON.parse(res.getContentText());
    }, 2);
    const parsed = parseOpenAiJsonResponse_(response);
    const date = normalizeDateValue_(parsed && parsed.date);
    if (!date) return { date: '', confidence: '' };
    const confidence = Number(parsed.confidence || 0);
    if (confidence && confidence < 0.75) return { date: '', confidence: confidence };
    return { date: date, confidence: confidence || 0.92 };
  } catch (err) {
    return { date: '', confidence: '' };
  }
}

function suggestIdentityIssueDateCrop(caseId, token, fileId) {
  assertValidToken_(caseId, token);
  const apiKey = PropertiesService.getScriptProperties().getProperty(CONFIG.CLOUD_VISION_API_KEY_PROPERTY);
  if (!apiKey) return { ok: false, reason: 'MISSING_CLOUD_VISION_API_KEY' };
  const file = DriveApp.getFileById(fileId);
  const blob = file.getBlob();
  const contentType = blob.getContentType() || 'image/jpeg';
  if (contentType.indexOf('image/') !== 0) return { ok: false, reason: 'NOT_IMAGE' };
  const response = withRetry('Vision crop suggestion ' + file.getName(), function() {
    const res = UrlFetchApp.fetch('https://vision.googleapis.com/v1/images:annotate?key=' + encodeURIComponent(apiKey), {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({
        requests: [{
          image: { content: Utilities.base64Encode(blob.getBytes()) },
          features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
          imageContext: { languageHints: ['vi', 'en'] }
        }]
      }),
      muteHttpExceptions: true
    });
    if (res.getResponseCode() >= 300) throw new Error(res.getContentText());
    return JSON.parse(res.getContentText());
  }, 2);
  const annotation = response.responses && response.responses[0];
  const suggestion = suggestIdentityIssueDateCropFromVisionAnnotation_(annotation);
  return suggestion ? { ok: true, crop: suggestion } : { ok: false, reason: 'NO_CROP_ANCHOR' };
}

function ocrIdentityIssueDateCrop(caseId, token, dataUrl) {
  assertValidToken_(caseId, token);
  const apiKey = PropertiesService.getScriptProperties().getProperty(CONFIG.CLOUD_VISION_API_KEY_PROPERTY);
  if (!apiKey) return { date: '', raw_text: '', reason: 'MISSING_CLOUD_VISION_API_KEY' };
  const match = String(dataUrl || '').match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);
  if (!match) return { date: '', raw_text: '', reason: 'INVALID_IMAGE_DATA' };
  const response = withRetry('Vision OCR issue date crop', function() {
    const res = UrlFetchApp.fetch('https://vision.googleapis.com/v1/images:annotate?key=' + encodeURIComponent(apiKey), {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({
        requests: [{
          image: { content: match[1] },
          features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
          imageContext: { languageHints: ['vi', 'en'] }
        }]
      }),
      muteHttpExceptions: true
    });
    if (res.getResponseCode() >= 300) throw new Error(res.getContentText());
    return JSON.parse(res.getContentText());
  }, 2);
  const annotation = response.responses && response.responses[0] && response.responses[0].fullTextAnnotation;
  const text = annotation && annotation.text || '';
  const date = extractSingleValidDateFromIssueDateCrop_(text);
  return { date: date, raw_text: text, reason: date ? 'OK' : 'NO_SINGLE_VALID_DATE' };
}

function saveAutoOcrFieldValue(caseId, token, fieldPath, newValue, source) {
  assertValidToken_(caseId, token);
  newValue = normalizeManualOverrideValueForStorage_(newValue);
  if (!newValue) return { ok: false, reason: 'EMPTY_VALUE' };
  let data = getLatestFinalData(caseId) || getLatestExtractedData(caseId);
  if (!data) throw new Error('No review data for case ' + caseId);
  data = applyOverridesToReviewJson(data, getOverrides(caseId));
  const field = getByPath(data, fieldPath);
  if (!field || typeof field !== 'object' || !field.hasOwnProperty('final_value')) {
    throw new Error('Field path is not editable: ' + fieldPath);
  }
  if (field.manual_value) return { ok: false, reason: 'HAS_MANUAL_VALUE' };
  const current = normalizeDateValue_(field.final_value || field.ai_value);
  if (current && String(field.final_value || '').indexOf('Không rõ') < 0) return { ok: false, reason: 'HAS_VALUE' };
  appendSheetRow(SHEETS.REVIEW_OVERRIDES, {
    'Case ID': caseId,
    'Field Path': fieldPath,
    'Field Label': field.label || fieldPath,
    'Old Value': field.final_value || '',
    'New Value': newValue,
    'Edited By': 'AUTO_OCR',
    'Edited At': nowIso(),
    'Reason': source || 'AUTO_OCR_IDENTITY_CROP'
  });
  logAudit(caseId, 'AUTO_OCR_FIELD_SAVED', { field_path: fieldPath, value: newValue, source: source || '' });
  return { ok: true, field_path: fieldPath, new_value: newValue };
}

function suggestIdentityIssueDateCropFromVisionAnnotation_(annotation) {
  const newIdCrop = suggestNewIdentityIssueDateCropFromVisionAnnotation_(annotation);
  if (newIdCrop) return newIdCrop;
  const words = collectVisionWords_(annotation);
  for (let i = 0; i < words.length; i++) {
    const text = String(words[i].text || '');
    const normalized = removeVietnameseAccents_(text).toLowerCase();
    const idx = normalized.indexOf('year') >= 0 ? normalized.indexOf('year') : normalized.indexOf('yea');
    if (idx < 0) continue;
    const box = words[i].box;
    const charCount = Math.max(text.length, 1);
    const startX = Math.max(0, Math.round(box.x + box.width * Math.min(0.9, (idx + 3) / charCount) - box.height * 0.15));
    const y = Math.max(0, Math.round(box.y - box.height * 0.45));
    return {
      x: startX,
      y: y,
      width: Math.max(8, Math.min(words[i].pageWidth - startX, Math.round(Math.max(box.height * 8, words[i].pageWidth * 0.16)))),
      height: Math.max(8, Math.min(words[i].pageHeight - y, Math.round(box.height * 1.8))),
      reason: 'old_cccd_year_anchor',
      anchor_text: text
    };
  }
  for (let j = 0; j < words.length; j++) {
    const normalizedWord = removeVietnameseAccents_(String(words[j].text || '')).toLowerCase().replace(/\s+/g, '');
    if (normalizedWord.indexOf('idvnm') < 0) continue;
    const mrz = words[j].box;
    const x = Math.max(0, Math.round(mrz.x + mrz.width * 0.52));
    const y = Math.max(0, Math.round(mrz.y - mrz.width * 0.62));
    return {
      x: x,
      y: y,
      width: Math.max(8, Math.min(words[j].pageWidth - x, Math.round(mrz.width * 0.36))),
      height: Math.max(8, Math.min(words[j].pageHeight - y, Math.round(mrz.width * 0.09))),
      reason: 'old_cccd_mrz_layout_year_region',
      anchor_text: words[j].text
    };
  }
  return null;
}

function suggestNewIdentityIssueDateCropFromVisionAnnotation_(annotation) {
  const words = collectVisionWords_(annotation);
  for (let i = 0; i < words.length - 2; i++) {
    const a = removeVietnameseAccents_(String(words[i].text || '')).toLowerCase();
    const b = removeVietnameseAccents_(String(words[i + 1].text || '')).toLowerCase();
    const c = removeVietnameseAccents_(String(words[i + 2].text || '')).toLowerCase();
    if (!(a === 'date' && b === 'of' && c.indexOf('issue') === 0)) continue;
    const box = mergeVisionRects_([words[i].box, words[i + 1].box, words[i + 2].box]);
    const pageWidth = words[i].pageWidth;
    const pageHeight = words[i].pageHeight;
    const height = Math.round(box.height * 2.4);
    const width = Math.round(Math.max(box.width * 1.5, box.height * 9));
    const x = Math.max(0, Math.round(box.x + box.width / 2 - width / 2));
    const y = Math.max(0, Math.round(box.y + box.height * 0.85));
    return {
      x: x,
      y: y,
      width: Math.max(8, Math.min(width, pageWidth - x)),
      height: Math.max(8, Math.min(height, pageHeight - y)),
      reason: 'new_can_cuoc_date_of_issue_label',
      anchor_text: [words[i].text, words[i + 1].text, words[i + 2].text].join(' ')
    };
  }
  return null;
}

function collectVisionWords_(annotation) {
  const out = [];
  const pages = annotation && annotation.fullTextAnnotation && annotation.fullTextAnnotation.pages || [];
  pages.forEach(function(page) {
    const pageWidth = Number(page.width || 0);
    const pageHeight = Number(page.height || 0);
    (page.blocks || []).forEach(function(block) {
      (block.paragraphs || []).forEach(function(paragraph) {
        (paragraph.words || []).forEach(function(word) {
          const text = (word.symbols || []).map(function(symbol) { return symbol.text || ''; }).join('');
          const box = visionBoundingRect_(word.boundingBox);
          if (text && box) out.push({ text: text, box: box, pageWidth: pageWidth, pageHeight: pageHeight });
        });
      });
    });
  });
  return out;
}

function visionBoundingRect_(box) {
  const vertices = box && box.vertices || [];
  if (!vertices.length) return null;
  const xs = vertices.map(function(v) { return Number(v.x || 0); });
  const ys = vertices.map(function(v) { return Number(v.y || 0); });
  const minX = Math.min.apply(null, xs);
  const maxX = Math.max.apply(null, xs);
  const minY = Math.min.apply(null, ys);
  const maxY = Math.max.apply(null, ys);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function mergeVisionRects_(rects) {
  rects = (rects || []).filter(Boolean);
  const minX = Math.min.apply(null, rects.map(function(rect) { return rect.x; }));
  const minY = Math.min.apply(null, rects.map(function(rect) { return rect.y; }));
  const maxX = Math.max.apply(null, rects.map(function(rect) { return rect.x + rect.width; }));
  const maxY = Math.max.apply(null, rects.map(function(rect) { return rect.y + rect.height; }));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function extractSingleValidDateFromIssueDateCrop_(text) {
  const out = [];
  String(text || '').replace(/(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})/g, function(match) {
    const date = normalizeDateValue_(match);
    if (isValidIdentityDate_(date) && out.indexOf(date) === -1) out.push(date);
    return match;
  });
  String(text || '').replace(/(?:^|\D)(\d{8})(?=\D|$)/g, function(match, digits) {
    const date = normalizeCompactIssueDateDigits_(digits);
    if (date && out.indexOf(date) === -1) out.push(date);
    return match;
  });
  return out.length === 1 ? out[0] : '';
}

function isValidIdentityDate_(date) {
  const match = String(date || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return false;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (year < 1900 || year > 2099 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const daysInMonth = [31, isLeapYear_(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return day <= daysInMonth;
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
