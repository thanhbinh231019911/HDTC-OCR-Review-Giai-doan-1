function getReviewPayload(caseId, token) {
  assertValidToken_(caseId, token);
  let data = getLatestFinalData(caseId) || getLatestExtractedData(caseId);
  if (!data) throw new Error('No review data for case ' + caseId);
  data = ensureTemplateDecisionFields_(data);
  data = applyOverridesToReviewJson(data, getOverrides(caseId));
  repairReviewDataFromFullOcr_(data, caseId);
  data = applyTemplateDecisionToReviewJson(data);
  data = validateReviewJson(data);
  attachLandCertificateSemanticDocumentsForReview_(data, caseId);
  return makeReviewPayloadForClient_(data);
}

function attachLandCertificateSemanticDocumentsForReview_(data, caseId) {
  if (!data || typeof parseLandCertificateSemanticDocument_ !== 'function') return data;
  const fullOcr = getFullOcrTextMapsForCase_(caseId, data);
  const assets = data.assets || [];
  const allowAllAssetTexts = canUseSharedAssetOcr_(assets, { byFileName: fullOcr.assetTextByFileName || {} });
  assets.forEach(function(asset) {
    const scopedText = assetOcrTextForSemanticReview_(
      asset,
      fullOcr.assetText || '',
      fullOcr.assetTextByFileName || {},
      allowAllAssetTexts
    );
    if (asset && asset.certificate_semantic_document &&
        asset.certificate_semantic_document.source === 'OPENAI_VISION_SEMANTIC' &&
        asset.certificate_semantic_document.model === CONFIG.OPENAI_MODEL_LOCKED &&
        isCompleteLandCertificateSemanticDocumentForReview_(asset.certificate_semantic_document)) {
      overlayReviewAssetFieldsOntoSemanticDocument_(asset.certificate_semantic_document, asset);
      attachReviewTranscriptToSemanticDocument_(asset, scopedText);
      return;
    }
    if (!scopedText) {
      if (asset && asset.certificate_semantic_document) attachReviewTranscriptToSemanticDocument_(asset, '');
      return;
    }
    const title = String(
      asset && asset.certificate_title &&
      (asset.certificate_title.final_value || asset.certificate_title.ai_value) || ''
    ).trim();
    asset.certificate_semantic_document = parseLandCertificateSemanticDocument_(scopedText, {
      certificate_title: title,
      source: 'FULL_ASSET_OCR'
    });
    overlayReviewAssetFieldsOntoSemanticDocument_(asset.certificate_semantic_document, asset);
    attachReviewTranscriptToSemanticDocument_(asset, scopedText);
  });
  return data;
}

function isCompleteLandCertificateSemanticDocumentForReview_(document) {
  const pages = document && document.pages || [];
  let hasLandDetails = false;
  let hasAttachedAssets = false;
  pages.forEach(function(page) {
    (page.sections || []).forEach(function(section) {
      if (section.semantic === 'land_details') hasLandDetails = true;
      if (section.semantic === 'attached_assets') hasAttachedAssets = true;
    });
  });
  if (hasLandDetails || hasAttachedAssets) return true;
  return (document && document.items || []).some(function(item) {
    return [
      'land_plot_number',
      'map_sheet_number',
      'land_address',
      'area',
      'usage_purpose',
      'usage_term',
      'usage_form',
      'usage_origin',
      'house',
      'construction'
    ].indexOf(item && item.semantic_key) >= 0;
  });
}

function overlayReviewAssetFieldsOntoSemanticDocument_(document, asset) {
  if (!document || !asset || !asset.real_estate) return document;
  const overlays = [
    { key: 'certificate_number', label: 'Số GCN', field: asset.real_estate.certificate_number, confidence: 0.99 },
    { key: 'registry_number', label: 'Số vào sổ cấp GCN', field: asset.real_estate.registry_number, confidence: 0.99 },
    { key: 'issue_date', label: 'Ngày cấp', field: asset.real_estate.issue_date, confidence: 0.99 },
    { key: 'issuing_authority', label: 'Nơi cấp', field: asset.real_estate.issuing_authority, confidence: 0.99 }
  ];
  document.items = document.items || [];
  overlays.forEach(function(overlay) {
    const value = overlay.field && (overlay.field.final_value || overlay.field.ai_value) || '';
    if (!value) return;
    document.items.push({
      semantic_key: overlay.key,
      section_semantic: 'certificate_note',
      marker_raw: '',
      label_raw: overlay.label,
      label_canonical: overlay.label,
      value: value,
      value_raw: value,
      value_normalized: value,
      visual_order: 999999,
      confidence: overlay.confidence,
      evidence: {
        source: overlay.field.source || 'REVIEW_FIELD_OVERLAY'
      }
    });
  });
  return document;
}

function attachReviewTranscriptToSemanticDocument_(asset, sourceText) {
  const document = asset && asset.certificate_semantic_document;
  if (!document) return;
  if (hasLandReviewTranscriptEvidence_(document)) return;
  const lines = buildLandCertificateReviewTranscriptForAsset_(asset, sourceText);
  if (!lines.length) return;
  document.pages = document.pages || [];
  document.pages.unshift({
    page_index: -1000,
    layout: 'review_transcript',
    source_region: 'review_transcript',
    printed_lines: lines,
    sections: []
  });
  document.review_transcript_source = 'RAW_CERTIFICATE_TEXT';
}

function hasLandReviewTranscriptEvidence_(document) {
  return (document && document.pages || []).some(function(page) {
    if ((page.printed_lines || []).length) return true;
    return (page.sections || []).some(function(section) {
      return (section.raw_lines || []).length;
    });
  });
}

function buildLandCertificateReviewTranscriptForAsset_(asset, sourceText) {
  const re = asset && asset.real_estate || {};
  const title = reviewFieldValue_(asset && asset.certificate_title);
  const generation = certificateGenerationFromCompleteTitle_(title) ||
    inferLandCertificateGenerationFromLayout_(asset && asset.certificate_semantic_document && asset.certificate_semantic_document.generation || '');
  if (generation !== 'gcn_qsdd' && generation !== 'gcn_qsdd_qsh_nha_o_va_tsk') return [];
  const lines = [];
  appendReviewTranscriptRawLines_(lines, reviewFieldValue_(re.certificate_owner_raw_text));
  if (!lines.length) {
    lines.push('I. Người sử dụng đất, chủ sở hữu nhà ở và tài sản khác gắn liền với đất');
    appendReviewTranscriptRawLines_(lines, reviewFieldValue_(asset && asset.owner_identity_summary));
    appendReviewTranscriptRawLines_(lines, reviewFieldValue_(asset && asset.owner_address));
  }
  lines.push('II. Thửa đất, nhà ở và tài sản khác gắn liền với đất');
  lines.push('1. Thửa đất:');
  buildOldCertificateLandTranscriptLines_(re, sourceText).forEach(function(line) {
    lines.push(line);
  });
  buildOldCertificateAttachedTranscriptLines_(re, sourceText).forEach(function(line) {
    lines.push(line);
  });
  lines.push('III. Sơ đồ thửa đất, nhà ở và tài sản khác gắn liền với đất');
  const postIssue = reviewFieldValue_(re.post_issue_changes);
  if (postIssue) {
    lines.push('IV. Những thay đổi sau khi cấp Giấy chứng nhận');
    appendReviewTranscriptRawLines_(lines, postIssue);
  }
  return dedupeAdjacentReviewTranscriptLines_(lines);
}

function buildOldCertificateLandTranscriptLines_(re, sourceText) {
  const lines = [];
  const raw = [
    sourceText || '',
    reviewFieldValue_(re.certificate_land_raw_text),
    reviewFieldValue_(re.certificate_info_raw_text)
  ].join('\n');
  const plot = safeReviewTranscriptValue_(reviewFieldValue_(re.land_plot_number));
  const map = safeReviewTranscriptValue_(reviewFieldValue_(re.map_sheet_number));
  if (plot || map) {
    lines.push('a) ' + [
      plot ? 'Thửa đất số: ' + plot : '',
      map ? 'tờ bản đồ số: ' + map : ''
    ].filter(Boolean).join('; '));
  }
  const address = cleanupReviewLandAddress_(reviewFieldValue_(re.land_address));
  if (address) lines.push('b) Địa chỉ: ' + address);
  const area = safeReviewTranscriptValue_(reviewFieldValue_(re.area));
  const areaWords = safeReviewTranscriptValue_(reviewFieldValue_(re.area_in_words));
  if (area || areaWords) lines.push('c) Diện tích: ' + formatReviewAreaWithWords_(area, areaWords));
  buildReviewUsageFormLines_(re, raw).forEach(function(line) {
    lines.push(line);
  });
  const purpose = usagePurposeDisplayForReview_(re);
  if (purpose) lines.push('đ) Mục đích sử dụng: ' + purpose);
  const term = usageTermDisplayForReview_(re, raw);
  if (term) lines.push('e) Thời hạn sử dụng: ' + term);
  const origin = usageOriginDisplayForReview_(re, raw);
  if (origin) lines.push('g) Nguồn gốc sử dụng: ' + origin);
  return lines;
}

function buildReviewUsageFormLines_(re, raw) {
  const usageForm = safeReviewTranscriptValue_(reviewFieldValue_(re.usage_form));
  const purpose = safeReviewTranscriptValue_(reviewFieldValue_(re.usage_purpose));
  const area = safeReviewTranscriptValue_(reviewFieldValue_(re.area));
  const normalizedRaw = removeVietnameseAccents_(String(raw || '')).toLowerCase();
  if (usageForm && normalizedRaw.indexOf('chung') >= 0 && purpose && area) {
    return [
      'd) Hình thức sử dụng:',
      '   Riêng: ' + purpose + ' ' + area,
      '   Chung: ' + purpose + ' Không m²'
    ];
  }
  return usageForm ? ['d) Hình thức sử dụng: ' + capitalizeFirstReviewWord_(usageForm)] : [];
}

function usagePurposeDisplayForReview_(re) {
  const purpose = safeReviewTranscriptValue_(reviewFieldValue_(re.usage_purpose));
  const area = safeReviewTranscriptValue_(reviewFieldValue_(re.area));
  if (!purpose) return '';
  return area && purpose.indexOf(area) < 0 ? purpose + ': ' + area : purpose;
}

function usageTermDisplayForReview_(re, raw) {
  const purpose = safeReviewTranscriptValue_(reviewFieldValue_(re.usage_purpose));
  let term = safeReviewTranscriptValue_(reviewFieldValue_(re.usage_term));
  const normalizedRaw = removeVietnameseAccents_(String(raw || '')).toLowerCase();
  if (!term && normalizedRaw.indexOf('lau dai') >= 0) term = 'Lâu dài';
  if (!term) return '';
  return purpose && term.indexOf(purpose) < 0 ? purpose + ': ' + term : term;
}

function usageOriginDisplayForReview_(re, raw) {
  let origin = safeReviewTranscriptValue_(reviewFieldValue_(re.usage_origin));
  if (!origin) return '';
  origin = normalizeCertificatePunctuationSpacing_(origin);
  const normalizedRaw = removeVietnameseAccents_(String(raw || '')).toLowerCase();
  if (normalizedRaw.indexOf('"') >= 0 && origin.charAt(0) !== '"') {
    origin = '"' + origin.replace(/^"+|"+$/g, '') + '"';
  }
  return origin;
}

function buildOldCertificateAttachedTranscriptLines_(re, sourceText) {
  const source = [
    sourceText || '',
    reviewFieldValue_(re.certificate_attached_raw_text),
    reviewFieldValue_(re.certificate_info_raw_text)
  ].join('\n');
  const lines = [];
  const houseLines = extractOldHouseReviewLines_(source);
  if (houseLines.length) {
    houseLines.forEach(function(line) { lines.push(line); });
  } else {
    const houseValue = safeReviewTranscriptValue_(reviewFieldValue_(re.attached_assets));
    lines.push('2. Nhà ở:' + (houseValue ? ' ' + houseValue : ''));
  }
  const construction = extractReviewSectionHeadingAndValue_(source, /^3\s*[\).]?\s*c[oô]ng\s+tr/i, '3. Công trình xây dựng khác:');
  lines.push(construction || '3. Công trình xây dựng khác: -/-');
  const forest = extractReviewSectionHeadingAndValue_(source, /^4\s*[\).]?\s*r[uư]ng\s+s/i, '4. Rừng sản xuất là rừng trồng:');
  lines.push(forest || '4. Rừng sản xuất là rừng trồng: -/-');
  const crops = extractReviewSectionHeadingAndValue_(source, /^5\s*[\).]?\s*c[aâ]y\s+l/i, '5. Cây lâu năm:');
  lines.push(crops || '5. Cây lâu năm: -/-');
  const note = safeCertificateNoteTranscriptValue_(reviewFieldValue_(re.certificate_note));
  lines.push('6. Ghi chú:' + (note ? ' ' + note : ''));
  return lines;
}

function extractOldHouseReviewLines_(source) {
  const lines = reviewTranscriptCleanLines_(source).filter(function(line) {
    return !/^\[\/?LAND_OCR_/i.test(line);
  });
  let best = [];
  for (let i = 0; i < lines.length; i++) {
    const normalized = removeVietnameseAccents_(lines[i]).toLowerCase().replace(/\s+/g, ' ').trim();
    if (!/^2\s*[\).]?\s*nha\s*o\b/.test(normalized)) continue;
    const candidate = [];
    candidate.push('2. Nhà ở:');
    for (let j = i + 1; j < lines.length && candidate.length < 18; j++) {
      const nextNorm = removeVietnameseAccents_(lines[j]).toLowerCase().replace(/\s+/g, ' ').trim();
      if (/^3\s*[\).]?\s*cong\s+tr/.test(nextNorm) ||
          /^iii\s*[\).]/.test(nextNorm) ||
          /^4\s*[\).]?\s*rung\s+s/.test(nextNorm) ||
          /^5\s*[\).]?\s*cay\s+l/.test(nextNorm)) break;
      if (!isUsefulHouseReviewLine_(lines[j])) continue;
      candidate.push(normalizeHouseReviewLine_(lines[j]));
    }
    const joined = removeVietnameseAccents_(candidate.join(' ')).toLowerCase();
    const score = (joined.indexOf('dien tich xay dung') >= 0 ? 3 : 0) +
      (joined.indexOf('dien tich san') >= 0 ? 3 : 0) +
      (joined.indexOf('so tang') >= 0 ? 2 : 0) +
      candidate.length;
    if (score > best.score || !best.length) {
      best = candidate;
      best.score = score;
    }
  }
  if (best.length <= 1) return [];
  delete best.score;
  return dedupeAdjacentReviewTranscriptLines_(best);
}

function isUsefulHouseReviewLine_(line) {
  const value = String(line || '').trim();
  if (!value) return false;
  const normalized = removeVietnameseAccents_(value).toLowerCase();
  if (normalized.indexOf('uy ban nhan dan') >= 0 || normalized.indexOf('chu tich') >= 0) return false;
  if (/^\s*g\s*[\).:]?\s*nguon\s+goc\s+su\s+dung\b/.test(normalized)) return false;
  if (normalized.indexOf('cong nhan qsdd') >= 0) return false;
  if (normalized.indexOf('giao dat') >= 0 && normalized.indexOf('su dung dat') >= 0) return false;
  if (/^\d+(?:[,.]\d+)?$/.test(value)) return false;
  return true;
}

function normalizeHouseReviewLine_(line) {
  return String(line || '')
    .replace(/\s+/g, ' ')
    .replace(/\b40,0\s*m(?!²|2)\b/ig, '40,0 m²')
    .replace(/^"\s*-\s*\/\s*-\s*"$/g, '-/-')
    .trim();
}

function extractReviewSectionHeadingAndValue_(source, regex, fallbackHeading) {
  const lines = reviewTranscriptCleanLines_(source);
  for (let i = 0; i < lines.length; i++) {
    if (regex.test(lines[i])) return fallbackHeading + (/-\/-/.test(lines[i]) ? ' -/-' : '');
  }
  return '';
}

function appendReviewTranscriptRawLines_(out, value) {
  reviewTranscriptCleanLines_(value).forEach(function(line) {
    out.push(line);
  });
}

function reviewTranscriptCleanLines_(value) {
  return String(value || '').split(/\r?\n/).map(function(line) {
    return String(line || '').replace(/\s+/g, ' ').trim();
  }).filter(Boolean);
}

function dedupeAdjacentReviewTranscriptLines_(lines) {
  const out = [];
  (lines || []).forEach(function(line) {
    const value = String(line || '').replace(/\s+/g, ' ').trim();
    if (!value) return;
    const last = out.length ? out[out.length - 1] : '';
    if (removeVietnameseAccents_(last).toLowerCase() === removeVietnameseAccents_(value).toLowerCase()) return;
    out.push(value);
  });
  return out;
}

function reviewFieldValue_(field) {
  if (!field) return '';
  if (typeof field === 'object' && field.hasOwnProperty('final_value')) return String(field.final_value || field.ai_value || '').trim();
  return String(field || '').trim();
}

function safeReviewTranscriptValue_(value) {
  value = String(value || '').replace(/\s+/g, ' ').trim();
  if (!value) return '';
  const normalized = removeVietnameseAccents_(value).toLowerCase();
  if (value.indexOf('KhÃ') >= 0 || normalized.indexOf('khong ro') >= 0 || normalized.indexOf('de nghi') >= 0) return '';
  return value;
}

function cleanupReviewLandAddress_(value) {
  value = safeReviewTranscriptValue_(value).replace(/["']?\s*-\s*\/\s*-\s*["']?\s*$/g, '').trim();
  if (!value) return '';
  const parts = value.split(/(?=Tổ\s+\d+\s+Phường)/i).map(function(part) {
    return part.trim();
  }).filter(Boolean);
  if (parts.length > 1) {
    const seen = {};
    value = parts.filter(function(part) {
      const key = removeVietnameseAccents_(part).toLowerCase();
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    }).join(' ');
  }
  return normalizeCertificatePunctuationSpacing_(value);
}

function formatReviewAreaWithWords_(area, words) {
  area = safeReviewTranscriptValue_(area);
  words = safeReviewTranscriptValue_(words);
  if (area && words) return area + ' (Bằng chữ: ' + words + ')';
  return area || (words ? '(Bằng chữ: ' + words + ')' : '');
}

function safeCertificateNoteTranscriptValue_(value) {
  value = safeReviewTranscriptValue_(value);
  if (!value) return '';
  const normalized = removeVietnameseAccents_(value).toLowerCase();
  if (normalized.indexOf('hang muc') >= 0 && normalized.indexOf('so vao so') >= 0) return '';
  if (normalized.indexOf('thua dat so') >= 0 && normalized.indexOf('cong trinh xay dung khac') >= 0) return '';
  return value;
}

function capitalizeFirstReviewWord_(value) {
  value = String(value || '').trim();
  return value ? value.charAt(0).toLocaleUpperCase('vi-VN') + value.slice(1) : '';
}

function assetOcrTextForSemanticReview_(asset, fullAssetOcrText, assetTextByFileName, allowAllFiles) {
  const byFileName = assetTextByFileName || {};
  const fileNames = Object.keys(byFileName);
  if (allowAllFiles) return fileNames.map(function(name) { return byFileName[name]; }).filter(Boolean).join('\n\n');
  const sourceFiles = [];
  if (typeof collectAiSourceFiles_ === 'function') collectAiSourceFiles_(asset, sourceFiles);
  const matched = [];
  sourceFiles.forEach(function(fileName) {
    if (byFileName[fileName] && matched.indexOf(byFileName[fileName]) < 0) matched.push(byFileName[fileName]);
  });
  if (matched.length) return matched.join('\n\n');
  const realEstate = asset && asset.real_estate || {};
  const certificate = normalizeCertificateCodeValue_(
    realEstate.certificate_number &&
    (realEstate.certificate_number.final_value || realEstate.certificate_number.ai_value) || ''
  );
  const registry = normalizeRegistryCodeValue_(
    realEstate.registry_number &&
    (realEstate.registry_number.final_value || realEstate.registry_number.ai_value) || ''
  );
  fileNames.forEach(function(fileName) {
    const text = String(byFileName[fileName] || '');
    const compact = removeVietnameseAccents_(text).replace(/[^a-z0-9]+/gi, '').toUpperCase();
    if ((certificate && compact.indexOf(certificate.toUpperCase()) >= 0) ||
        (registry && compact.indexOf(registry.replace(/[^A-Z0-9]/gi, '').toUpperCase()) >= 0)) {
      if (matched.indexOf(text) < 0) matched.push(text);
    }
  });
  if (matched.length) return matched.join('\n\n');
  if (fileNames.length === 1) return byFileName[fileNames[0]];
  return '';
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
  repairUnsafeLandCertificateFieldsInReviewJson(data, fullOcr.assetText);
  repairAssetCertificateCodesInReviewJson(data, fullOcr.assetText);
  repairAssetIssueDateInReviewJson(data, fullOcr.assetText);
  repairAssetIssuingAuthorityInReviewJson(data, fullOcr.assetText);
  repairAssetPlotAndMapSheetInReviewJson(data, fullOcr.assetText);
  repairAssetLandAddressInReviewJson(data, fullOcr.assetText, fullOcr.assetTextByFileName);
  repairAssetAreaInReviewJson(data, fullOcr.assetText);
  repairAssetUsageFormInReviewJson(data, fullOcr.assetText);
  repairAssetUsagePurposeInReviewJson(data, fullOcr.assetText);
  repairAssetUsageTermInReviewJson(data, fullOcr.assetText);
  repairAssetUsageOriginInReviewJson(data, fullOcr.assetText, fullOcr.assetTextByFileName);
  repairAssetAreaWordsInReviewJson(data, fullOcr.assetText);
  repairAssetPostIssueChangesInReviewJson(data, fullOcr.assetText, fullOcr.assetTextByFileName);
  repairAssetCertificateNoteInReviewJson(data, fullOcr.assetText);
  repairAssetAttachedAssetsInReviewJson(data, fullOcr.assetText, fullOcr.assetTextByFileName);
  repairAssetOwnerIdentityInReviewJson(data, fullOcr.assetText, fullOcr.assetTextByFileName);
  repairAssetOwnerAddressInReviewJson(data, fullOcr.assetText);
  return data;
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

function suggestLandRegistryCrop(caseId, token, fileId) {
  assertValidToken_(caseId, token);
  const apiKey = PropertiesService.getScriptProperties().getProperty(CONFIG.CLOUD_VISION_API_KEY_PROPERTY);
  if (!apiKey) return { ok: false, reason: 'MISSING_CLOUD_VISION_API_KEY' };
  const file = DriveApp.getFileById(fileId);
  if (isPdfMime_(file.getMimeType())) return { ok: false, reason: 'PDF_PREVIEW_FALLBACK' };
  const blob = file.getBlob();
  const contentType = blob.getContentType() || 'image/jpeg';
  if (contentType.indexOf('image/') !== 0) return { ok: false, reason: 'NOT_IMAGE' };
  const response = withRetry('Vision land registry crop suggestion ' + file.getName(), function() {
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
  const suggestion = suggestLandRegistryCodeCropFromVisionAnnotation_(annotation) ||
    suggestLandRegistryCropFromVisionAnnotation_(annotation);
  return suggestion ? { ok: true, crop: suggestion } : { ok: false, reason: 'NO_REGISTRY_ANCHOR' };
}

function suggestLandRegistryCropFromImage(caseId, token, dataUrl) {
  assertValidToken_(caseId, token);
  const apiKey = PropertiesService.getScriptProperties().getProperty(CONFIG.CLOUD_VISION_API_KEY_PROPERTY);
  if (!apiKey) return { ok: false, reason: 'MISSING_CLOUD_VISION_API_KEY' };
  const match = String(dataUrl || '').match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);
  if (!match) return { ok: false, reason: 'INVALID_IMAGE_DATA' };
  const response = withRetry('Vision land registry crop suggestion from image', function() {
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
  const annotation = response.responses && response.responses[0];
  const suggestion = suggestLandRegistryCodeCropFromVisionAnnotation_(annotation) ||
    suggestLandRegistryCropFromVisionAnnotation_(annotation);
  return suggestion ? { ok: true, crop: suggestion } : { ok: false, reason: 'NO_REGISTRY_ANCHOR' };
}

function suggestLandIssueDateCropFromImage(caseId, token, dataUrl) {
  assertValidToken_(caseId, token);
  const apiKey = PropertiesService.getScriptProperties().getProperty(CONFIG.CLOUD_VISION_API_KEY_PROPERTY);
  if (!apiKey) return { ok: false, reason: 'MISSING_CLOUD_VISION_API_KEY' };
  const match = String(dataUrl || '').match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);
  if (!match) return { ok: false, reason: 'INVALID_IMAGE_DATA' };
  const response = withRetry('Vision land issue date crop suggestion from image', function() {
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
  const annotation = response.responses && response.responses[0];
  const suggestion = suggestLandIssueDateCropFromVisionAnnotation_(annotation);
  return suggestion ? { ok: true, crop: suggestion } : { ok: false, reason: 'NO_ISSUE_DATE_ANCHOR' };
}

function suggestLandCertificateNumberCropFromImage(caseId, token, dataUrl) {
  assertValidToken_(caseId, token);
  const apiKey = PropertiesService.getScriptProperties().getProperty(CONFIG.CLOUD_VISION_API_KEY_PROPERTY);
  if (!apiKey) return { ok: false, reason: 'MISSING_CLOUD_VISION_API_KEY' };
  const match = String(dataUrl || '').match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);
  if (!match) return { ok: false, reason: 'INVALID_IMAGE_DATA' };
  const response = withRetry('Vision land certificate number crop suggestion', function() {
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
  const annotation = response.responses && response.responses[0];
  const suggestion = suggestLandCertificateNumberCropFromVisionAnnotation_(annotation);
  return suggestion ? { ok: true, crop: suggestion } : { ok: false, reason: 'NO_CERTIFICATE_NUMBER_ANCHOR' };
}

function ocrLandRegistryCrop(caseId, token, dataUrl) {
  assertValidToken_(caseId, token);
  const apiKey = PropertiesService.getScriptProperties().getProperty(CONFIG.CLOUD_VISION_API_KEY_PROPERTY);
  if (!apiKey) return { registry_number: '', raw_text: '', reason: 'MISSING_CLOUD_VISION_API_KEY' };
  const match = String(dataUrl || '').match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);
  if (!match) return { registry_number: '', raw_text: '', reason: 'INVALID_IMAGE_DATA' };
  const response = withRetry('Vision OCR land registry crop', function() {
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
  const printedFillDetected = hasPrintedRegistryFillLineFromAnnotation_(annotation);
  const registry = extractLandRegistryNumberFromCropText_(text, printedFillDetected);
  return {
    registry_number: registry,
    raw_text: text,
    has_registry_label: hasRegistryLabelInCropText_(text),
    printed_fill_detected: printedFillDetected,
    character_evidence: collectRegistryCharacterEvidence_(annotation),
    reason: registry ? 'OK' : 'NO_FULL_REGISTRY_NUMBER'
  };
}

function hasRegistryLabelInCropText_(text) {
  const normalized = removeVietnameseAccents_(String(text || ''))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return /so vao so cap (?:gcn|giay chung nhan)/.test(normalized);
}

function collectRegistryCharacterEvidence_(annotation) {
  const out = [];
  const prefixes = /^(?:CS|CT|CN|CH|CL|HX|VP|DC|DL)/i;
  (annotation && annotation.pages || []).forEach(function(page) {
    (page.blocks || []).forEach(function(block) {
      (block.paragraphs || []).forEach(function(paragraph) {
        (paragraph.words || []).forEach(function(word) {
          const symbols = word.symbols || [];
          const text = symbols.map(function(symbol) { return symbol.text || ''; }).join('');
          const compact = text.replace(/[^0-9A-Z]+/gi, '');
          if (!prefixes.test(compact) && !/^\d{3,}$/.test(compact)) return;
          out.push({
            text: text,
            symbols: symbols.map(function(symbol) {
              return {
                text: symbol.text || '',
                confidence: Number(symbol.confidence || 0)
              };
            })
          });
        });
      });
    });
  });
  return out.slice(0, 8);
}

function hasPrintedRegistryFillLineFromAnnotation_(annotation) {
  const dots = [];
  (annotation && annotation.pages || []).forEach(function(page) {
    (page.blocks || []).forEach(function(block) {
      (block.paragraphs || []).forEach(function(paragraph) {
        (paragraph.words || []).forEach(function(word) {
          (word.symbols || []).forEach(function(symbol) {
            if (String(symbol.text || '') !== '.') return;
            const vertices = symbol.boundingBox && symbol.boundingBox.vertices || [];
            if (!vertices.length) return;
            const xs = vertices.map(function(v) { return Number(v.x || 0); });
            const ys = vertices.map(function(v) { return Number(v.y || 0); });
            dots.push({
              x: (Math.min.apply(null, xs) + Math.max.apply(null, xs)) / 2,
              y: (Math.min.apply(null, ys) + Math.max.apply(null, ys)) / 2,
              height: Math.max.apply(null, ys) - Math.min.apply(null, ys)
            });
          });
        });
      });
    });
  });
  if (dots.length < 4) return false;
  for (let i = 0; i < dots.length; i++) {
    const row = dots.filter(function(dot) {
      return Math.abs(dot.y - dots[i].y) <= Math.max(4, dots[i].height * 0.8);
    }).sort(function(a, b) { return a.x - b.x; });
    if (row.length < 4) continue;
    const gaps = [];
    for (let j = 1; j < row.length; j++) {
      const gap = row[j].x - row[j - 1].x;
      if (gap > 0) gaps.push(gap);
    }
    if (gaps.length < 3) continue;
    const average = gaps.reduce(function(sum, gap) { return sum + gap; }, 0) / gaps.length;
    const regular = gaps.filter(function(gap) {
      return gap >= average * 0.45 && gap <= average * 1.8;
    }).length;
    if (regular >= 3) return true;
  }
  return false;
}

function ocrA4LandCertificateCrop(caseId, token, dataUrl, cropType) {
  assertValidToken_(caseId, token);
  const apiKey = PropertiesService.getScriptProperties().getProperty(CONFIG.CLOUD_VISION_API_KEY_PROPERTY);
  if (!apiKey) return { issue_date: '', usage_purpose: '', usage_term: '', raw_text: '', reason: 'MISSING_CLOUD_VISION_API_KEY' };
  const match = String(dataUrl || '').match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);
  if (!match) return { issue_date: '', usage_purpose: '', usage_term: '', raw_text: '', reason: 'INVALID_IMAGE_DATA' };
  const response = withRetry('Vision OCR A4 certificate crop ' + String(cropType || ''), function() {
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
  const geometryText = buildVisionGeometryText_(annotation);
  const text = geometryText || annotation && annotation.text || '';
  const result = {
    certificate_number: '',
    issue_date: '',
    land_plot_number: '',
    map_sheet_number: '',
    land_address: '',
    area: '',
    area_in_words: '',
    usage_purpose: '',
    usage_term: '',
    usage_form: '',
    usage_origin: '',
    layout: 'unknown',
    raw_text: text,
    reason: text ? 'OK' : 'NO_TEXT'
  };
  if (cropType === 'certificate_number') {
    result.certificate_number = extractLandCertificateNumberFromCropText_(text);
  }
  if (cropType === 'issue_date' || !cropType) {
    result.issue_date = extractRealEstateIssueDateFromPlainText_(text);
  }
  if (cropType === 'land_fields' || !cropType) {
    const fields = extractAllLandFieldsFromFocusedCrop_(text);
    result.land_plot_number = fields.land_plot_number || '';
    result.map_sheet_number = fields.map_sheet_number || '';
    result.land_address = fields.land_address || '';
    result.area = fields.area || '';
    result.area_in_words = fields.area_in_words || '';
    result.usage_purpose = fields.usage_purpose || '';
    result.usage_term = fields.usage_term || '';
    result.usage_form = fields.usage_form || '';
    result.usage_origin = fields.usage_origin || '';
    result.layout = classifyLandCertificatePageText_(text).layout;
  }
  logA4AutoOcrDebug_(caseId, 'AUTO_OCR_A4_CROP_RESULT', {
    crop_type: cropType || '',
    raw_length: text.length,
    issue_date_found: Boolean(result.issue_date),
    usage_purpose_found: Boolean(result.usage_purpose),
    usage_term_found: Boolean(result.usage_term),
    usage_form_found: Boolean(result.usage_form),
    usage_origin_found: Boolean(result.usage_origin),
    reason: result.reason,
    excerpt: text.slice(0, 300)
  });
  console.log(JSON.stringify({
    action: 'LAND_LABEL_CROP_OCR',
    crop_type: cropType || '',
    usage_purpose: result.usage_purpose,
    usage_term: result.usage_term,
    usage_form: result.usage_form,
    excerpt: text.slice(0, 180)
  }));
  return result;
}

function ocrLandCriticalFieldCropWithAi(caseId, token, dataUrl, cropType) {
  assertValidToken_(caseId, token);
  const allowed = ['certificate_number', 'registry_number', 'issue_date', 'land_plot_number', 'map_sheet_number', 'land_address', 'area', 'area_in_words', 'usage_purpose', 'usage_term', 'usage_form', 'usage_origin'];
  if (allowed.indexOf(String(cropType || '')) < 0) return { value: '', reason: 'UNSUPPORTED_CROP_TYPE' };
  if (!/^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(String(dataUrl || ''))) {
    return { value: '', reason: 'INVALID_IMAGE_DATA' };
  }
  const apiKey = PropertiesService.getScriptProperties().getProperty(CONFIG.OPENAI_API_KEY_PROPERTY);
  if (!apiKey) return { value: '', reason: 'MISSING_OPENAI_API_KEY' };
  const instructions = {
    certificate_number: 'Transcribe only the printed certificate serial, usually a short letter prefix followed by 6 to 9 digits. Do not return the registry number.',
    registry_number: 'Transcribe only the handwritten or printed value after the registry label. Preserve visible isolated punctuation and omit the surrounding printed dotted fill line.',
    issue_date: 'Transcribe only the complete certificate issue date from the line containing ngay, thang, nam. Return it as DD/MM/YYYY.',
    land_plot_number: 'Transcribe only the land plot number after the printed label Thua dat so.',
    map_sheet_number: 'Transcribe only the map sheet number after the printed label To ban do so.',
    land_address: 'Transcribe only the complete land address after the printed label Dia chi. Preserve all line continuations.',
    area: 'Transcribe only the numeric land area and its square-metre unit after the printed label Dien tich.',
    area_in_words: 'Transcribe only the area written in words after the printed label Bang chu.',
    usage_purpose: 'Transcribe only the complete value after the printed land-type or usage-purpose label. Preserve all land types, quantities, punctuation, and line continuations.',
    usage_term: 'Transcribe only the complete value after the printed usage-term label. Preserve all dates, punctuation, and line continuations.',
    usage_form: 'Transcribe only the complete value after the printed usage-form label. Do not include adjacent map, signature, date, or other field text.',
    usage_origin: 'Transcribe only the complete value after the printed usage-origin label. Preserve all wrapped continuations and do not include the next numbered section.'
  };
  const payload = {
    model: CONFIG.OPENAI_MODEL_LOCKED,
    input: [{
      role: 'user',
      content: [
        {
          type: 'input_text',
          text: instructions[cropType] + ' Copy exactly from the crop. Do not infer missing characters. If any required character is unreadable, return an empty value.'
        },
        { type: 'input_image', image_url: dataUrl }
      ]
    }],
    text: {
      format: {
        type: 'json_schema',
        name: 'land_critical_field_crop',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: { value: { type: 'string' } },
          required: ['value']
        }
      }
    }
  };
  const response = withRetry('OpenAI land critical field crop ' + cropType, function() {
    const res = UrlFetchApp.fetch(CONFIG.OPENAI_ENDPOINT, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + apiKey },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    if (res.getResponseCode() >= 300) throw new Error(res.getContentText());
    return JSON.parse(res.getContentText());
  }, CONFIG.MAX_API_RETRIES);
  const parsed = parseOpenAiJsonResponse_(response);
  let value = String(parsed && parsed.value || '').trim();
  if (cropType === 'certificate_number') value = normalizeCertificateSerialValue_(value);
  if (cropType === 'registry_number') value = normalizeRegistryCodeValue_(value);
  if (cropType === 'issue_date') value = normalizeDateValue_(value);
  if (cropType === 'land_plot_number') value = extractLandPlotNumberFromIndexedValue_(value);
  if (cropType === 'map_sheet_number') value = extractMapSheetNumberFromIndexedValue_(value);
  if (cropType === 'land_address') value = cleanupLandAddressCertificateValue_(value);
  if (cropType === 'land_address' && isUnsafeLandAddressValue_(value)) {
    return { ok: false, reason: 'UNSAFE_LAND_ADDRESS_CONTEXT' };
  }
  if (cropType === 'area') value = normalizeRealEstateAreaValue_(value);
  if (cropType === 'usage_purpose') value = cleanupIndexedCertificateValue_(value);
  if (cropType === 'usage_term') value = normalizeRealEstateUsageTerm_(cleanupIndexedCertificateValue_(value));
  if (cropType === 'usage_form') value = normalizeRealEstateUsageForm_(cleanupIndexedCertificateValue_(value));
  if (cropType === 'usage_origin') value = cleanupUsageOriginCertificateValue_(value);
  return { value: value, reason: value ? 'OK' : 'UNREADABLE' };
}

function extractLandCertificateNumberFromCropText_(text) {
  const compact = String(text || '').replace(/\s+/g, ' ').trim();
  const candidates = compact.match(/\b[A-ZĐ?]{1,3}\s*[0-9]{6,9}\b/gi) || [];
  for (let i = 0; i < candidates.length; i++) {
    const value = normalizeCertificateSerialValue_(candidates[i]);
    if (value && !isRegistryNumberLike_(value)) return value;
  }
  return '';
}

function extractA4LandFieldsFromFocusedCrop_(text) {
  const source = String(text || '');
  const landType = findSemanticLandFieldValue_(source, ['loai dat']);
  const usagePurpose = findSemanticLandFieldValue_(source, ['muc dich su dung']);
  return {
    usage_purpose: landType
      ? normalizeLandTypeAreaUnits_(cleanupIndexedCertificateValue_(landType))
      : cleanupIndexedCertificateValue_(usagePurpose),
    usage_term: normalizeRealEstateUsageTerm_(cleanupIndexedCertificateValue_(findSemanticLandFieldValue_(source, ['thoi han su dung']))),
    usage_form: normalizeRealEstateUsageForm_(cleanupIndexedCertificateValue_(findSemanticLandFieldValue_(source, ['hinh thuc su dung'])))
  };
}

function extractAllLandFieldsFromFocusedCrop_(text) {
  const source = String(text || '');
  const indexed = extractRealEstateIndexedLandFields_(source);
  const basic = extractA4LandFieldsFromFocusedCrop_(source);
  return {
    land_plot_number: /\d/.test(String(indexed.land_plot_number || ''))
      ? indexed.land_plot_number
      : extractLandPlotNumberFromFocusedOcrText_(source),
    map_sheet_number: indexed.map_sheet_number || '',
    land_address: indexed.land_address || '',
    area: indexed.area || '',
    area_in_words: extractAreaWordsFromCertificateText_(source) || '',
    usage_purpose: indexed.usage_purpose || basic.usage_purpose || '',
    usage_term: indexed.usage_term || basic.usage_term || '',
    usage_form: indexed.usage_form || basic.usage_form || '',
    usage_origin: indexed.usage_origin || cleanupUsageOriginCertificateValue_(findSemanticLandFieldValue_(source, ['nguon goc su dung']))
  };
}

function extractLandPlotNumberFromFocusedOcrText_(text) {
  const normalized = removeVietnameseAccents_(String(text || '')).toLowerCase().replace(/\s+/g, ' ');
  const match = normalized.match(/\bth(?:ua|ura|ira)\s+dat\s+so\s*[:;,.]?\s*([0-9]+(?:[./-][0-9]+)?)/i);
  return match ? match[1] : '';
}

function analyzeLandPageImage(caseId, token, dataUrl) {
  assertValidToken_(caseId, token);
  const apiKey = PropertiesService.getScriptProperties().getProperty(CONFIG.CLOUD_VISION_API_KEY_PROPERTY);
  if (!apiKey) return { rotation: 0, split_candidate: false, reason: 'MISSING_CLOUD_VISION_API_KEY' };
  const match = String(dataUrl || '').match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);
  if (!match) return { rotation: 0, split_candidate: false, reason: 'INVALID_IMAGE_DATA' };
  const response = withRetry('Vision analyze land page geometry', function() {
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
  const rotation = typeof estimateVisionDisplayRotation_ === 'function'
    ? estimateVisionDisplayRotation_(annotation)
    : 0;
  const page = annotation && annotation.pages && annotation.pages[0];
  const rawWidth = Number(page && page.width || 0);
  const rawHeight = Number(page && page.height || 0);
  const normalizedWidth = rotation === 90 || rotation === 270 ? rawHeight : rawWidth;
  const normalizedHeight = rotation === 90 || rotation === 270 ? rawWidth : rawHeight;
  const wordCount = collectVisionWords_(annotation).length;
  const pageRegions = suggestLandPageRegionsFromVisionAnnotation_(annotation, rotation);
  return {
    rotation: rotation,
    split_candidate: pageRegions.length === 2,
    page_regions: pageRegions,
    page_width: normalizedWidth,
    page_height: normalizedHeight,
    word_count: wordCount,
    reason: annotation ? 'OK' : 'NO_TEXT'
  };
}

function suggestLandTextFieldCropFromImage(caseId, token, dataUrl, fieldKey) {
  assertValidToken_(caseId, token);
  const apiKey = PropertiesService.getScriptProperties().getProperty(CONFIG.CLOUD_VISION_API_KEY_PROPERTY);
  if (!apiKey) return { ok: false, reason: 'MISSING_CLOUD_VISION_API_KEY' };
  const match = String(dataUrl || '').match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/);
  if (!match) return { ok: false, reason: 'INVALID_IMAGE_DATA' };
  const response = withRetry('Vision suggest land text field crop ' + String(fieldKey || ''), function() {
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
  const crop = suggestLandTextFieldCropFromVisionAnnotation_(annotation, fieldKey);
  console.log(JSON.stringify({
    action: 'LAND_LABEL_CROP_SUGGEST',
    field_key: String(fieldKey || ''),
    found: Boolean(crop),
    reason: crop && crop.reason || '',
    anchor: crop && crop.anchor_text || ''
  }));
  return crop ? { ok: true, crop: crop } : { ok: false, reason: 'LABEL_NOT_FOUND' };
}

function suggestLandTextFieldCropFromVisionAnnotation_(annotation, fieldKey) {
  const aliasesByField = {
    land_plot_number: [['thua', 'dat', 'so'], ['thira', 'dat', 'so'], ['thura', 'dat', 'so']],
    map_sheet_number: [['to', 'ban', 'do', 'so']],
    land_address: [['dia', 'chi']],
    area: [['dien', 'tich']],
    area_in_words: [['bang', 'chu']],
    usage_purpose: [['loai', 'dat'], ['muc', 'dich', 'su', 'dung']],
    usage_term: [['thoi', 'han', 'su', 'dung']],
    usage_form: [['hinh', 'thuc', 'su', 'dung']],
    usage_origin: [['nguon', 'goc', 'su', 'dung']]
  };
  const allAliases = Object.keys(aliasesByField).reduce(function(out, key) {
    return out.concat(aliasesByField[key]);
  }, []).concat([
    ['nha', 'o'],
    ['cong', 'trinh', 'xay', 'dung', 'khac'],
    ['rung', 'san', 'xuat'],
    ['cay', 'lau', 'nam'],
    ['ghi', 'chu']
  ]);
  const aliases = aliasesByField[fieldKey] || [];
  if (!aliases.length) return null;
  const words = collectVisionWords_(annotation);
  const normalizedWords = words.map(function(word) {
    return removeVietnameseAccents_(String(word.text || '')).toLowerCase().replace(/[^a-z0-9]+/g, '');
  });
  function matchAliasAt(index, alias) {
    if (index + alias.length > normalizedWords.length) return false;
    for (let j = 0; j < alias.length; j++) {
      if (normalizedWords[index + j] !== alias[j]) return false;
    }
    return true;
  }
  let startIndex = -1;
  let matchedAlias = null;
  for (let i = 0; i < words.length && startIndex < 0; i++) {
    for (let a = 0; a < aliases.length; a++) {
      if (matchAliasAt(i, aliases[a])) {
        startIndex = i;
        matchedAlias = aliases[a];
        break;
      }
    }
  }
  if (startIndex < 0 || !matchedAlias) return null;
  const labelWords = words.slice(startIndex, startIndex + matchedAlias.length);
  const labelBox = mergeVisionRects_(labelWords.map(function(word) { return word.box; }));
  let nextLabelIndex = -1;
  for (let i = startIndex + matchedAlias.length; i < words.length; i++) {
    const candidate = words[i];
    if (candidate.pageIndex !== words[startIndex].pageIndex) break;
    let matched = false;
    for (let a = 0; a < allAliases.length; a++) {
      if (matchAliasAt(i, allAliases[a])) {
        matched = true;
        break;
      }
    }
    if (!matched) continue;
    if (candidate.box.y > labelBox.y + labelBox.height * 0.45 ||
        Math.abs(candidate.box.y - labelBox.y) <= labelBox.height * 0.45 && candidate.box.x > labelBox.x + labelBox.width) {
      nextLabelIndex = i;
      break;
    }
  }
  const pageWidth = words[startIndex].pageWidth;
  const pageHeight = words[startIndex].pageHeight;
  const padX = Math.max(10, Math.round(labelBox.height * 0.8));
  const padY = Math.max(8, Math.round(labelBox.height * 0.7));
  const x = Math.max(0, Math.round(labelBox.x - padX));
  const y = Math.max(0, Math.round(labelBox.y - padY));
  let right = pageWidth;
  let bottom = Math.min(pageHeight, Math.round(labelBox.y + labelBox.height * 4.2));
  if (nextLabelIndex >= 0) {
    const nextBox = words[nextLabelIndex].box;
    if (Math.abs(nextBox.y - labelBox.y) <= labelBox.height * 0.55 && nextBox.x > labelBox.x) {
      right = Math.max(x + 8, Math.round(nextBox.x - padX));
      bottom = Math.min(pageHeight, Math.round(labelBox.y + labelBox.height * 2.2));
    } else {
      bottom = Math.max(y + 8, Math.round(nextBox.y - padY * 0.4));
    }
  }
  const minimumLineFactors = {
    land_plot_number: 3.0,
    map_sheet_number: 3.0,
    land_address: 4.2,
    area: 3.2,
    area_in_words: 4.2,
    usage_origin: 4.2
  };
  if (minimumLineFactors[fieldKey]) {
    bottom = Math.min(pageHeight, Math.max(bottom, Math.round(labelBox.y + labelBox.height * minimumLineFactors[fieldKey])));
  }
  return {
    x: x,
    y: y,
    width: Math.max(8, Math.min(pageWidth - x, right - x)),
    height: Math.max(8, Math.min(pageHeight - y, bottom - y)),
    reason: 'vision_land_label_' + fieldKey,
    anchor_text: labelWords.map(function(word) { return word.text; }).join(' ')
  };
}

function isLikelyFacingPageSpread_(annotation, rotation) {
  return suggestLandPageRegionsFromVisionAnnotation_(annotation, rotation).length === 2;
}

function suggestLandPageRegionsFromVisionAnnotation_(annotation, rotation) {
  const words = collectVisionWords_(annotation);
  if (words.length < 20) return [];
  const page = annotation && annotation.pages && annotation.pages[0];
  const rawWidth = Number(page && page.width || 0);
  const rawHeight = Number(page && page.height || 0);
  const normalizedWidth = rotation === 90 || rotation === 270 ? rawHeight : rawWidth;
  const normalizedHeight = rotation === 90 || rotation === 270 ? rawWidth : rawHeight;
  if (!normalizedWidth || !normalizedHeight || normalizedWidth <= normalizedHeight * 1.12) return [];
  const normalizedWords = words.map(function(word) {
    const box = typeof normalizeVisionRectForRotation_ === 'function'
      ? normalizeVisionRectForRotation_(word.box, rawWidth, rawHeight, rotation)
      : word.box;
    return {
      text: word.text,
      box: box,
      centerX: box.x + box.width / 2,
      centerY: box.y + box.height / 2
    };
  });
  let left = 0;
  let right = 0;
  normalizedWords.forEach(function(word) {
    if (word.centerX < normalizedWidth * 0.46) left++;
    else if (word.centerX > normalizedWidth * 0.54) right++;
  });
  if (left < 8 || right < 8) return [];
  const binCount = 40;
  const bins = new Array(binCount).fill(0);
  normalizedWords.forEach(function(word) {
    const start = Math.max(0, Math.floor(word.box.x / normalizedWidth * binCount));
    const end = Math.min(binCount - 1, Math.floor((word.box.x + word.box.width) / normalizedWidth * binCount));
    for (let i = start; i <= end; i++) bins[i]++;
  });
  let gutterBin = Math.floor(binCount / 2);
  let gutterScore = Infinity;
  for (let i = Math.floor(binCount * 0.34); i <= Math.ceil(binCount * 0.66); i++) {
    const score = bins[i] * 3 + (bins[i - 1] || 0) + (bins[i + 1] || 0) + Math.abs(i - binCount / 2) * 0.08;
    if (score < gutterScore) {
      gutterScore = score;
      gutterBin = i;
    }
  }
  const boundary = Math.round((gutterBin + 0.5) / binCount * normalizedWidth);
  const overlap = Math.max(12, Math.round(normalizedWidth * 0.025));
  function regionForSide(sideWords, x, width, name) {
    const bounds = mergeVisionRects_(sideWords.map(function(word) { return word.box; }));
    const padY = Math.max(12, Math.round(normalizedHeight * 0.025));
    const top = bounds && isFinite(bounds.y) ? Math.max(0, Math.round(bounds.y - padY)) : 0;
    const bottom = bounds && isFinite(bounds.y + bounds.height)
      ? Math.min(normalizedHeight, Math.round(bounds.y + bounds.height + padY))
      : normalizedHeight;
    return {
      x: Math.max(0, x),
      y: 0,
      width: Math.min(normalizedWidth - Math.max(0, x), width),
      height: normalizedHeight,
      content_y: top,
      content_height: Math.max(1, bottom - top),
      region: name
    };
  }
  return [
    regionForSide(normalizedWords.filter(function(word) { return word.centerX <= boundary + overlap; }), 0, boundary + overlap, 'left'),
    regionForSide(normalizedWords.filter(function(word) { return word.centerX >= boundary - overlap; }), boundary - overlap, normalizedWidth - boundary + overlap, 'right')
  ];
}

function extractA4LandCertificateFieldsFromStoredOcr(caseId, token, fileId, fileName) {
  const ocr = getCaseOcrText(caseId, token, fileId, fileName);
  const text = String(ocr.text || '');
  const normalized = removeVietnameseAccents_(text).toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ');
  const looksA4 = normalized.indexOf('quyen so huu tai san gan lien voi dat') >= 0 ||
    normalized.indexOf('2 thong tin thua dat') >= 0 && normalized.indexOf('3 thong tin tai san gan lien voi dat') >= 0;
  const result = {
    file_id: ocr.file_id || fileId || '',
    file_name: ocr.file_name || fileName || '',
    issue_date: '',
    usage_purpose: '',
    usage_term: '',
    raw_length: text.length,
    reason: text ? (looksA4 ? 'OK' : 'NOT_A4_TEXT') : 'NO_TEXT'
  };
  if (looksA4) {
    const fields = extractRealEstateIndexedLandFields_(text);
    result.issue_date = extractRealEstateIssueDate_(text) || '';
    result.usage_purpose = fields.usage_purpose || '';
    result.usage_term = fields.usage_term || '';
  }
  logA4AutoOcrDebug_(caseId, 'AUTO_OCR_A4_STORED_TEXT_RESULT', {
    file_name: result.file_name,
    raw_length: result.raw_length,
    issue_date_found: Boolean(result.issue_date),
    usage_purpose_found: Boolean(result.usage_purpose),
    usage_term_found: Boolean(result.usage_term),
    reason: result.reason
  });
  return result;
}

function logA4AutoOcrDebug_(caseId, action, detail) {
  try {
    logAudit(caseId, action, detail || {});
  } catch (err) {
    console.warn('Cannot log A4 auto OCR debug: ' + err);
  }
}

function saveAutoOcrFieldValue(caseId, token, fieldPath, newValue, source) {
  assertValidToken_(caseId, token);
  newValue = normalizeManualOverrideValueForStorage_(newValue);
  if (!newValue) return { ok: false, reason: 'EMPTY_VALUE' };
  let data = getLatestFinalData(caseId) || getLatestExtractedData(caseId);
  if (!data) throw new Error('No review data for case ' + caseId);
  data = applyOverridesToReviewJson(data, getOverrides(caseId));
  repairReviewDataFromFullOcr_(data, caseId);
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

function saveAutoOcrA4LandFieldValue(caseId, token, fieldPath, newValue, currentValue, source) {
  assertValidToken_(caseId, token);
  const pathMatch = String(fieldPath || '').match(/^assets\[\d+\]\.real_estate\.(usage_purpose|usage_term|usage_form)$/);
  if (!pathMatch) throw new Error('Field path is not an A4 land text field: ' + fieldPath);
  if (getLatestFinalData(caseId)) return { ok: false, reason: 'CASE_FINALIZED' };
  const fieldKey = pathMatch[1];
  if (fieldKey === 'usage_purpose') {
    const cleaned = cleanupIndexedCertificateValue_(newValue);
    newValue = String(source || '').indexOf('_loai_dat') >= 0 || String(source || '').indexOf('AUTO_OCR_A4_') === 0
      ? normalizeLandTypeAreaUnits_(cleaned)
      : cleaned;
  }
  if (fieldKey === 'usage_term') newValue = normalizeRealEstateUsageTerm_(cleanupIndexedCertificateValue_(newValue));
  if (fieldKey === 'usage_form') newValue = normalizeRealEstateUsageForm_(cleanupIndexedCertificateValue_(newValue));
  if (!newValue) return { ok: false, reason: 'EMPTY_VALUE' };
  const manualOverride = getOverrides(caseId).some(function(item) {
    return item.field_path === fieldPath && item.edited_by !== 'AUTO_OCR';
  });
  if (manualOverride) return { ok: false, reason: 'HAS_MANUAL_OVERRIDE' };
  let data = getLatestExtractedData(caseId);
  if (!data) throw new Error('No extracted review data for case ' + caseId);
  repairReviewDataFromFullOcr_(data, caseId);
  const field = getByPath(data, fieldPath);
  if (!field || typeof field !== 'object' || !field.hasOwnProperty('final_value')) {
    throw new Error('Field path is not editable: ' + fieldPath);
  }
  if (field.manual_value) return { ok: false, reason: 'HAS_MANUAL_VALUE' };
  const storedCurrent = String(field.final_value || field.ai_value || '').trim();
  field.ai_value = newValue;
  field.final_value = newValue;
  field.manual_value = '';
  field.source = source || 'AUTO_OCR_A4_GEOMETRY_CROP';
  field.confidence = 0.92;
  field.confirmed = false;
  field.evidence = 'High-resolution crop reconstructed from OCR word coordinates';
  data = validateReviewJson(data);
  appendSheetRow(SHEETS.EXTRACTED_DATA, {
    'Case ID': caseId,
    'JSON Data': data,
    'Validation Status': data.validation.status,
    'Missing Fields': data.validation.missing_fields,
    'Conflicts': data.validation.conflicts,
    'Warnings': data.validation.warnings,
    'AI JSON File URL': '',
    'Created At': nowIso()
  });
  logAudit(caseId, 'AUTO_OCR_A4_LAND_FIELD_SAVED', {
    field_path: fieldPath,
    old_value: storedCurrent,
    new_value: newValue,
    source: field.source
  });
  return { ok: true, field_path: fieldPath, new_value: newValue };
}

function saveAutoOcrA4LandFieldValues(caseId, token, values) {
  assertValidToken_(caseId, token);
  if (getLatestFinalData(caseId)) return { ok: false, reason: 'CASE_FINALIZED' };
  const items = (values || []).filter(function(item) {
    return item && /^assets\[\d+\]\.real_estate\.(land_plot_number|map_sheet_number|land_address|area|area_in_words|usage_purpose|usage_term|usage_form|usage_origin)$/.test(String(item.fieldPath || ''));
  });
  if (!items.length) return { ok: false, reason: 'NO_VALUES' };
  const manualPaths = {};
  getOverrides(caseId).forEach(function(item) {
    if (item.edited_by !== 'AUTO_OCR') manualPaths[item.field_path] = true;
  });
  let data = getLatestExtractedData(caseId);
  if (!data) throw new Error('No extracted review data for case ' + caseId);
  repairReviewDataFromFullOcr_(data, caseId);
  const saved = [];
  items.forEach(function(item) {
    const fieldPath = String(item.fieldPath || '');
    if (manualPaths[fieldPath]) return;
    const field = getByPath(data, fieldPath);
    if (!field || typeof field !== 'object' || !field.hasOwnProperty('final_value') || field.manual_value) return;
    const fieldKey = fieldPath.match(/\.(land_plot_number|map_sheet_number|land_address|area|area_in_words|usage_purpose|usage_term|usage_form|usage_origin)$/)[1];
    let newValue = cleanupIndexedCertificateValue_(item.newValue);
    if (fieldKey === 'land_plot_number') newValue = extractLandPlotNumberFromIndexedValue_(newValue);
    if (fieldKey === 'map_sheet_number') newValue = extractMapSheetNumberFromIndexedValue_(newValue);
    if (fieldKey === 'land_address') newValue = cleanupLandAddressCertificateValue_(newValue);
    if (fieldKey === 'area') newValue = normalizeRealEstateAreaValue_(newValue);
    if (fieldKey === 'area_in_words') newValue = cleanupIndexedCertificateValue_(newValue).replace(/^[()]+|[()]+$/g, '').trim();
    if (fieldKey === 'usage_purpose') newValue = normalizeLandTypeAreaUnits_(newValue);
    if (fieldKey === 'usage_term') newValue = normalizeRealEstateUsageTerm_(newValue);
    if (fieldKey === 'usage_form') newValue = normalizeRealEstateUsageForm_(newValue);
    if (fieldKey === 'usage_origin') newValue = cleanupUsageOriginCertificateValue_(newValue);
    if (!newValue) return;
    if (fieldKey === 'land_address' && isUnsafeLandAddressValue_(newValue)) return;
    field.ai_value = newValue;
    field.final_value = newValue;
    field.manual_value = '';
    field.source = item.source || 'AUTO_OCR_LAND_LABEL_CROP_V2';
    field.confidence = 0.92;
    field.confirmed = false;
    field.evidence = 'Focused high-resolution label crop consensus';
    saved.push({ field_path: fieldPath, new_value: newValue, source: field.source });
  });
  if (!saved.length) return { ok: false, reason: 'NO_SAVABLE_VALUES' };
  data = validateReviewJson(data);
  appendSheetRow(SHEETS.EXTRACTED_DATA, {
    'Case ID': caseId,
    'JSON Data': data,
    'Validation Status': data.validation.status,
    'Missing Fields': data.validation.missing_fields,
    'Conflicts': data.validation.conflicts,
    'Warnings': data.validation.warnings,
    'AI JSON File URL': '',
    'Created At': nowIso()
  });
  logAudit(caseId, 'AUTO_OCR_LAND_LABEL_FIELDS_SAVED', { fields: saved });
  return { ok: true, saved: saved };
}

function saveAutoOcrRegistryValue(caseId, token, fieldPath, newValue, currentValue, readings, verificationMode) {
  assertValidToken_(caseId, token);
  if (!/^assets\[\d+\]\.real_estate\.registry_number$/.test(String(fieldPath || ''))) {
    throw new Error('Field path is not a registry number: ' + fieldPath);
  }
  if (getLatestFinalData(caseId)) return { ok: false, reason: 'CASE_FINALIZED' };
  const consensus = registryCropConsensus_(readings || []);
  const candidate = normalizeRegistryCodeValue_(newValue);
  if (!candidate || !isPlausibleRegistryCode_(candidate)) return { ok: false, reason: 'INVALID_REGISTRY_VALUE' };
  if (!consensus.value || consensus.value !== candidate || consensus.count < 2) {
    return { ok: false, reason: 'NO_REGISTRY_CROP_CONSENSUS' };
  }
  const manualOverride = getOverrides(caseId).some(function(item) {
    return item.field_path === fieldPath && item.edited_by !== 'AUTO_OCR';
  });
  if (manualOverride) return { ok: false, reason: 'HAS_MANUAL_OVERRIDE' };
  let data = getLatestExtractedData(caseId);
  if (!data) throw new Error('No extracted review data for case ' + caseId);
  repairReviewDataFromFullOcr_(data, caseId);
  const field = getByPath(data, fieldPath);
  if (!field || typeof field !== 'object' || !field.hasOwnProperty('final_value')) {
    throw new Error('Field path is not editable: ' + fieldPath);
  }
  const storedCurrent = normalizeRegistryCodeValue_(field.final_value || field.ai_value || '');
  const expectedCurrent = normalizeRegistryCodeValue_(currentValue || '');
  if (expectedCurrent && storedCurrent && expectedCurrent !== storedCurrent) {
    return { ok: false, reason: 'STALE_REGISTRY_VALUE' };
  }
  field.ai_value = candidate;
  field.final_value = candidate;
  field.manual_value = '';
  const focusedPageVerification = verificationMode === 'PAGE_FOCUSED' || verificationMode === 'PAGE_ANCHORED';
  field.source = focusedPageVerification
    ? 'AUTO_OCR_LAND_REGISTRY_ANCHORED_PAGE_CROP_CONSENSUS_V5'
    : 'AUTO_OCR_LAND_REGISTRY_CROP_CONSENSUS';
  field.confidence = 0.92;
  field.confirmed = false;
  field.evidence = focusedPageVerification
    ? 'Normalized high-resolution page crop consensus across multiple color renderings'
    : 'Focused registry OCR consensus: ' + consensus.count + ' crops';
  data = validateReviewJson(data);
  appendSheetRow(SHEETS.EXTRACTED_DATA, {
    'Case ID': caseId,
    'JSON Data': data,
    'Validation Status': data.validation.status,
    'Missing Fields': data.validation.missing_fields,
    'Conflicts': data.validation.conflicts,
    'Warnings': data.validation.warnings,
    'AI JSON File URL': '',
    'Created At': nowIso()
  });
  logAudit(caseId, 'AUTO_OCR_REGISTRY_SAVED', {
    field_path: fieldPath,
    old_value: storedCurrent,
    new_value: candidate,
    consensus_count: consensus.count,
    verification_mode: focusedPageVerification ? 'PAGE_ANCHORED' : 'LEGACY_CROP',
    readings: consensus.readings
  });
  return {
    ok: true,
    field_path: fieldPath,
    new_value: candidate,
    consensus_count: consensus.count
  };
}

function saveAutoOcrIssueDateValue(caseId, token, fieldPath, newValue, currentValue, readings) {
  assertValidToken_(caseId, token);
  if (!/^assets\[\d+\]\.real_estate\.issue_date$/.test(String(fieldPath || ''))) {
    throw new Error('Field path is not a land issue date: ' + fieldPath);
  }
  if (getLatestFinalData(caseId)) return { ok: false, reason: 'CASE_FINALIZED' };
  const candidate = normalizeDateValue_(newValue);
  if (!candidate || !isStrictDateValue_(candidate)) return { ok: false, reason: 'INVALID_ISSUE_DATE' };
  const consensus = issueDateCropConsensus_(readings || []);
  if (!consensus.value || consensus.value !== candidate || consensus.count < 2) {
    return { ok: false, reason: 'NO_ISSUE_DATE_CROP_CONSENSUS' };
  }
  const manualOverride = getOverrides(caseId).some(function(item) {
    return item.field_path === fieldPath && item.edited_by !== 'AUTO_OCR';
  });
  if (manualOverride) return { ok: false, reason: 'HAS_MANUAL_OVERRIDE' };
  let data = getLatestExtractedData(caseId);
  if (!data) throw new Error('No extracted review data for case ' + caseId);
  repairReviewDataFromFullOcr_(data, caseId);
  const field = getByPath(data, fieldPath);
  if (!field || typeof field !== 'object' || !field.hasOwnProperty('final_value')) {
    throw new Error('Field path is not editable: ' + fieldPath);
  }
  if (field.manual_value) return { ok: false, reason: 'HAS_MANUAL_VALUE' };
  const storedCurrent = normalizeDateValue_(field.final_value || field.ai_value || '');
  const expectedCurrent = normalizeDateValue_(currentValue || '');
  if (expectedCurrent && storedCurrent && expectedCurrent !== storedCurrent) {
    return { ok: false, reason: 'STALE_ISSUE_DATE_VALUE' };
  }
  if (String(field.source || '').indexOf('AUTO_OCR_LAND_ISSUE_DATE_CROP_CONSENSUS_V2') === 0 && storedCurrent === candidate) {
    return { ok: true, field_path: fieldPath, new_value: candidate, consensus_count: consensus.count };
  }
  field.ai_value = candidate;
  field.final_value = candidate;
  field.manual_value = '';
  field.source = 'AUTO_OCR_LAND_ISSUE_DATE_CROP_CONSENSUS_V2';
  field.confidence = 0.92;
  field.confirmed = false;
  field.evidence = 'Normalized high-resolution issue-date crop consensus across multiple color renderings';
  data = validateReviewJson(data);
  appendSheetRow(SHEETS.EXTRACTED_DATA, {
    'Case ID': caseId,
    'JSON Data': data,
    'Validation Status': data.validation.status,
    'Missing Fields': data.validation.missing_fields,
    'Conflicts': data.validation.conflicts,
    'Warnings': data.validation.warnings,
    'AI JSON File URL': '',
    'Created At': nowIso()
  });
  logAudit(caseId, 'AUTO_OCR_ISSUE_DATE_SAVED', {
    field_path: fieldPath,
    old_value: storedCurrent,
    new_value: candidate,
    consensus_count: consensus.count,
    readings: consensus.readings
  });
  return {
    ok: true,
    field_path: fieldPath,
    new_value: candidate,
    consensus_count: consensus.count
  };
}

function saveAutoOcrCertificateNumberValue(caseId, token, fieldPath, newValue, currentValue, readings) {
  assertValidToken_(caseId, token);
  if (!/^assets\[\d+\]\.real_estate\.certificate_number$/.test(String(fieldPath || ''))) {
    throw new Error('Field path is not a certificate number: ' + fieldPath);
  }
  if (getLatestFinalData(caseId)) return { ok: false, reason: 'CASE_FINALIZED' };
  const candidate = normalizeCertificateSerialValue_(newValue);
  const consensus = certificateNumberCropConsensus_(readings || []);
  if (!candidate || !consensus.value || consensus.value !== candidate || consensus.count < 2) {
    return { ok: false, reason: 'NO_CERTIFICATE_NUMBER_CROP_CONSENSUS' };
  }
  const manualOverride = getOverrides(caseId).some(function(item) {
    return item.field_path === fieldPath && item.edited_by !== 'AUTO_OCR';
  });
  if (manualOverride) return { ok: false, reason: 'HAS_MANUAL_OVERRIDE' };
  let data = getLatestExtractedData(caseId);
  if (!data) throw new Error('No extracted review data for case ' + caseId);
  repairReviewDataFromFullOcr_(data, caseId);
  const field = getByPath(data, fieldPath);
  if (!field || typeof field !== 'object' || !field.hasOwnProperty('final_value')) {
    throw new Error('Field path is not editable: ' + fieldPath);
  }
  if (field.manual_value) return { ok: false, reason: 'HAS_MANUAL_VALUE' };
  const storedCurrent = normalizeCertificateSerialValue_(field.final_value || field.ai_value || '');
  const expectedCurrent = normalizeCertificateSerialValue_(currentValue || '');
  if (expectedCurrent && storedCurrent && expectedCurrent !== storedCurrent) {
    return { ok: false, reason: 'STALE_CERTIFICATE_NUMBER_VALUE' };
  }
  field.ai_value = candidate;
  field.final_value = candidate;
  field.manual_value = '';
  field.source = 'AUTO_OCR_LAND_CERTIFICATE_NUMBER_ANCHORED_CROP_CONSENSUS';
  field.confidence = 0.94;
  field.confirmed = false;
  field.evidence = 'Anchored certificate-number crop consensus';
  data = validateReviewJson(data);
  appendSheetRow(SHEETS.EXTRACTED_DATA, {
    'Case ID': caseId,
    'JSON Data': data,
    'Validation Status': data.validation.status,
    'Missing Fields': data.validation.missing_fields,
    'Conflicts': data.validation.conflicts,
    'Warnings': data.validation.warnings,
    'AI JSON File URL': '',
    'Created At': nowIso()
  });
  logAudit(caseId, 'AUTO_OCR_CERTIFICATE_NUMBER_SAVED', {
    field_path: fieldPath,
    old_value: storedCurrent,
    new_value: candidate,
    readings: consensus.readings
  });
  return { ok: true, field_path: fieldPath, new_value: candidate, consensus_count: consensus.count };
}

function certificateNumberCropConsensus_(readings) {
  const counts = {};
  const normalizedReadings = [];
  (readings || []).forEach(function(value) {
    const normalized = normalizeCertificateSerialValue_(value);
    if (!/^[A-ZĐ?]{1,3}[0-9]{6,9}$/i.test(normalized) || isRegistryNumberLike_(normalized)) return;
    normalizedReadings.push(normalized);
    counts[normalized] = (counts[normalized] || 0) + 1;
  });
  const ranked = Object.keys(counts).sort(function(a, b) {
    return counts[b] - counts[a] || a.localeCompare(b);
  });
  if (!ranked.length) return { value: '', count: 0, readings: normalizedReadings };
  const top = ranked[0];
  const runnerUpCount = ranked.length > 1 ? counts[ranked[1]] : 0;
  if (counts[top] < 2 || counts[top] === runnerUpCount) {
    return { value: '', count: counts[top], readings: normalizedReadings };
  }
  return { value: top, count: counts[top], readings: normalizedReadings };
}

function issueDateCropConsensus_(readings) {
  const counts = {};
  (readings || []).forEach(function(value) {
    const normalized = normalizeDateValue_(value);
    if (!normalized || !isStrictDateValue_(normalized)) return;
    counts[normalized] = (counts[normalized] || 0) + 1;
  });
  const ranked = Object.keys(counts).sort(function(a, b) {
    return counts[b] - counts[a] || a.localeCompare(b);
  });
  return ranked.length ? { value: ranked[0], count: counts[ranked[0]], readings: readings } : { value: '', count: 0, readings: readings };
}

function registryCropConsensus_(readings) {
  const counts = {};
  const normalizedReadings = [];
  (readings || []).forEach(function(value) {
    const normalized = normalizeRegistryCodeValue_(value);
    if (!normalized || !isPlausibleRegistryCode_(normalized)) return;
    normalizedReadings.push(normalized);
    counts[normalized] = (counts[normalized] || 0) + 1;
  });
  const ranked = Object.keys(counts).sort(function(a, b) {
    return counts[b] - counts[a] || a.localeCompare(b);
  });
  if (!ranked.length) return { value: '', count: 0, readings: normalizedReadings };
  const top = ranked[0];
  const runnerUpCount = ranked.length > 1 ? counts[ranked[1]] : 0;
  if (counts[top] < 2 || counts[top] === runnerUpCount) {
    return { value: '', count: counts[top], readings: normalizedReadings };
  }
  return { value: top, count: counts[top], readings: normalizedReadings };
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

function suggestLandCertificateNumberCropFromVisionAnnotation_(annotation) {
  const words = collectVisionWords_(annotation);
  const matches = [];
  for (let i = 0; i < words.length; i++) {
    for (let count = 1; count <= 3 && i + count <= words.length; count++) {
      const group = words.slice(i, i + count);
      const compact = group.map(function(word) { return String(word.text || ''); }).join('').replace(/[^0-9A-ZĐ?]/gi, '');
      if (!/^[A-ZĐ?]{1,3}[0-9]{6,9}$/i.test(compact) || isRegistryNumberLike_(compact)) continue;
      const box = mergeVisionRects_(group.map(function(word) { return word.box; }));
      const pageWidth = words[i].pageWidth;
      const pageHeight = words[i].pageHeight;
      if (!box || box.y < pageHeight * 0.45) continue;
      matches.push({ value: compact, box: box, pageWidth: pageWidth, pageHeight: pageHeight });
    }
  }
  if (!matches.length) return null;
  matches.sort(function(a, b) {
    return b.box.y - a.box.y || a.box.x - b.box.x || b.value.length - a.value.length;
  });
  const match = matches[0];
  const box = match.box;
  const padX = Math.max(10, Math.round(box.height * 1.2));
  const padY = Math.max(8, Math.round(box.height * 1.0));
  const x = Math.max(0, Math.round(box.x - padX));
  const y = Math.max(0, Math.round(box.y - padY));
  return {
    x: x,
    y: y,
    width: Math.max(8, Math.min(match.pageWidth - x, Math.round(box.width + padX * 2))),
    height: Math.max(8, Math.min(match.pageHeight - y, Math.round(box.height + padY * 2))),
    page_width: match.pageWidth,
    page_height: match.pageHeight,
    reason: 'vision_certificate_number_focused',
    anchor_text: match.value
  };
}

function suggestLandRegistryCropFromVisionAnnotation_(annotation) {
  const words = collectVisionWords_(annotation);
  for (let i = 0; i < words.length; i++) {
    const windowWords = words.slice(i, Math.min(words.length, i + 7));
    const normalized = windowWords.map(function(word) {
      return removeVietnameseAccents_(String(word.text || '')).toLowerCase().replace(/[^a-z0-9]+/g, '');
    }).join(' ');
    if (!/so\s+vao\s+so\s+cap\s+(?:gcn|giay\s+chung\s+nhan)/.test(normalized)) continue;
    const labelRects = windowWords.slice(0, Math.min(windowWords.length, 5)).map(function(word) { return word.box; });
    const labelBox = mergeVisionRects_(labelRects);
    const pageWidth = words[i].pageWidth;
    const pageHeight = words[i].pageHeight;
    const x = Math.max(0, Math.round(labelBox.x - labelBox.height * 0.4));
    const y = Math.max(0, Math.round(labelBox.y - labelBox.height * 1.6));
    const width = Math.max(8, Math.min(pageWidth - x, Math.round(Math.max(labelBox.width * 2.4, pageWidth * 0.55))));
    const height = Math.max(8, Math.min(pageHeight - y, Math.round(labelBox.height * 5.2)));
    return {
      x: x,
      y: y,
      width: width,
      height: height,
      label_box: {
        x: Math.round(labelBox.x),
        y: Math.round(labelBox.y),
        width: Math.round(labelBox.width),
        height: Math.round(labelBox.height)
      },
      page_width: pageWidth,
      page_height: pageHeight,
      reason: 'land_registry_label',
      anchor_text: windowWords.map(function(word) { return word.text; }).join(' ')
    };
  }
  return null;
}

function suggestLandRegistryCodeCropFromVisionAnnotation_(annotation) {
  const words = collectVisionWords_(annotation);
  for (let i = 0; i < words.length; i++) {
    const windowWords = words.slice(i, Math.min(words.length, i + 12));
    const normalized = windowWords.slice(0, 7).map(function(word) {
      return removeVietnameseAccents_(String(word.text || '')).toLowerCase().replace(/[^a-z0-9]+/g, '');
    }).join(' ');
    if (!/so\s+vao\s+so\s+cap\s+(?:gcn|giay\s+chung\s+nhan)/.test(normalized)) continue;
    for (let j = 4; j < windowWords.length; j++) {
      let matched = null;
      for (let count = 1; count <= 4 && j + count <= windowWords.length; count++) {
        const group = windowWords.slice(j, j + count);
        const candidate = group.map(function(word) { return String(word.text || ''); }).join('').replace(/\s+/g, '');
        if (!/^(?:CS|CT|CN|CH|CL|HX|VP|DC|DL)[.\/-]*[0-9A-Z.\/-]{2,24}$/i.test(candidate) ||
            !/\d/.test(candidate.slice(2))) continue;
        const groupBox = mergeVisionRects_(group.map(function(word) { return word.box; }));
        const firstBox = group[0].box;
        const lastBox = group[group.length - 1].box;
        const baselineTolerance = Math.max(firstBox.height, lastBox.height) * 1.5;
        if (Math.abs(firstBox.y - lastBox.y) > baselineTolerance) continue;
        matched = { candidate: candidate, box: groupBox, word: group[0] };
        break;
      }
      if (!matched) continue;
      const candidate = matched.candidate;
      const box = matched.box;
      const pageWidth = matched.word.pageWidth;
      const pageHeight = matched.word.pageHeight;
      const padX = Math.max(6, Math.round(box.height * 0.8));
      const padY = Math.max(6, Math.round(box.height * 0.9));
      const x = Math.max(0, Math.round(box.x - padX));
      const y = Math.max(0, Math.round(box.y - padY));
      return {
        x: x,
        y: y,
        width: Math.max(8, Math.min(pageWidth - x, Math.round(box.width + padX * 2))),
        height: Math.max(8, Math.min(pageHeight - y, Math.round(box.height + padY * 2))),
        code_box: {
          x: Math.round(box.x),
          y: Math.round(box.y),
          width: Math.round(box.width),
          height: Math.round(box.height)
        },
        page_width: pageWidth,
        page_height: pageHeight,
        reason: 'vision_registry_code_focused',
        anchor_text: candidate
      };
    }
  }
  return null;
}

function suggestLandIssueDateCropFromVisionAnnotation_(annotation) {
  const words = collectVisionWords_(annotation);
  for (let i = 0; i < words.length; i++) {
    const windowWords = words.slice(i, Math.min(words.length, i + 12));
    const normalized = windowWords.map(function(word) {
      return removeVietnameseAccents_(String(word.text || '')).toLowerCase().replace(/[^a-z0-9]+/g, '');
    }).join(' ');
    const hasDateLine = /ngay\s+\d{1,2}\s+thang\s+\d{1,2}\s+nam/.test(normalized) ||
      /hoa\s+binh\s+ngay\s+\d{1,2}\s+thang/.test(normalized) ||
      /ngay\s+\d{1,2}\s+thang/.test(normalized) && /nam\s+\d{2,4}/.test(normalized);
    if (!hasDateLine) continue;
    const local = windowWords.map(function(word) {
      return removeVietnameseAccents_(String(word.text || '')).toLowerCase().replace(/[^a-z0-9]+/g, '');
    });
    let ngayIndex = local.findIndex(function(value) { return value === 'ngay'; });
    if (ngayIndex < 0) ngayIndex = local.findIndex(function(value) { return value.indexOf('ngay') >= 0; });
    let namIndex = -1;
    for (let n = Math.max(0, ngayIndex); n < local.length; n++) {
      if (local[n] === 'nam' || local[n].indexOf('nam') >= 0) {
        namIndex = n;
        break;
      }
    }
    const from = ngayIndex >= 0 ? Math.max(0, ngayIndex - 3) : 0;
    const to = namIndex >= 0 ? Math.min(windowWords.length, namIndex + 3) : windowWords.length;
    const dateWords = windowWords.slice(from, Math.max(from + 1, to));
    const rects = dateWords.map(function(word) { return word.box; });
    const box = mergeVisionRects_(rects);
    const pageWidth = words[i].pageWidth;
    const pageHeight = words[i].pageHeight;
    const padX = Math.max(12, Math.round(box.height * 3.0));
    const padY = Math.max(8, Math.round(box.height * 1.2));
    const x = Math.max(0, Math.round(box.x - padX));
    const y = Math.max(0, Math.round(box.y - padY));
    return {
      x: x,
      y: y,
      width: Math.max(8, Math.min(pageWidth - x, Math.round(box.width + padX * 2))),
      height: Math.max(8, Math.min(pageHeight - y, Math.round(box.height + padY * 2))),
      page_width: pageWidth,
      page_height: pageHeight,
      reason: 'vision_land_issue_date_line',
      anchor_text: dateWords.map(function(word) { return word.text; }).join(' ')
    };
  }
  return null;
}

function extractLandRegistryNumberFromCropText_(text, printedFillDetected) {
  const raw = String(text || '').replace(/\r?\n+/g, ' ').replace(/\s+/g, ' ').trim();
  const fromLabel = extractRealEstateRegistryNumber_(raw);
  if (fromLabel) return normalizeRegistryCodeValue_(fromLabel, printedFillDetected);
  return normalizeRegistryCodeValue_(raw, printedFillDetected);
}

function collectVisionWords_(annotation) {
  const out = [];
  const fullAnnotation = annotation && annotation.fullTextAnnotation || annotation;
  const pages = fullAnnotation && fullAnnotation.pages || [];
  pages.forEach(function(page, pageIndex) {
    const pageWidth = Number(page.width || 0);
    const pageHeight = Number(page.height || 0);
    (page.blocks || []).forEach(function(block) {
      (block.paragraphs || []).forEach(function(paragraph) {
        (paragraph.words || []).forEach(function(word) {
          const text = (word.symbols || []).map(function(symbol) { return symbol.text || ''; }).join('');
          const box = visionBoundingRect_(word.boundingBox);
          if (text && box) out.push({
            text: text,
            box: box,
            topEdgeSlope: visionTopEdgeSlope_(word.boundingBox),
            pageIndex: pageIndex,
            pageWidth: pageWidth,
            pageHeight: pageHeight,
            centerX: box.x + box.width / 2,
            centerY: box.y + box.height / 2
          });
        });
      });
    });
  });
  return out;
}

function buildVisionGeometryText_(annotation) {
  const words = collectVisionWords_(annotation);
  if (!words.length) return '';
  const pageGroups = {};
  words.forEach(function(word) {
    pageGroups[word.pageIndex] = pageGroups[word.pageIndex] || [];
    pageGroups[word.pageIndex].push(word);
  });
  return Object.keys(pageGroups).sort(function(a, b) { return Number(a) - Number(b); }).map(function(pageIndex) {
    const slopes = pageGroups[pageIndex].map(function(word) { return word.topEdgeSlope; })
      .filter(function(slope) { return isFinite(slope) && Math.abs(slope) <= 0.35; })
      .sort(function(a, b) { return a - b; });
    const pageSlope = slopes.length ? slopes[Math.floor(slopes.length / 2)] : 0;
    pageGroups[pageIndex].forEach(function(word) {
      word.lineCenterY = word.centerY - pageSlope * word.centerX;
    });
    const pageWords = pageGroups[pageIndex].slice().sort(function(a, b) {
      return a.lineCenterY - b.lineCenterY || a.centerX - b.centerX;
    });
    const lines = [];
    pageWords.forEach(function(word) {
      let bestLine = null;
      let bestDistance = Infinity;
      lines.forEach(function(line) {
        const distance = Math.abs(word.lineCenterY - line.centerY);
        const tolerance = Math.max(8, Math.min(word.box.height, line.averageHeight) * 0.58);
        if (distance <= tolerance && distance < bestDistance) {
          bestLine = line;
          bestDistance = distance;
        }
      });
      if (!bestLine) {
        lines.push({
          words: [word],
          centerY: word.lineCenterY,
          averageHeight: Math.max(1, word.box.height)
        });
        return;
      }
      bestLine.words.push(word);
      const count = bestLine.words.length;
      bestLine.centerY = (bestLine.centerY * (count - 1) + word.lineCenterY) / count;
      bestLine.averageHeight = (bestLine.averageHeight * (count - 1) + Math.max(1, word.box.height)) / count;
    });
    return lines.sort(function(a, b) { return a.centerY - b.centerY; }).map(function(line) {
      return line.words.sort(function(a, b) { return a.centerX - b.centerX; })
        .map(function(word) { return word.text; })
        .join(' ')
        .replace(/\s+([,.;:])/g, '$1')
        .trim();
    }).filter(Boolean).join('\n');
  }).filter(Boolean).join('\n');
}

function visionTopEdgeSlope_(box) {
  const vertices = box && box.vertices || [];
  if (vertices.length < 2) return 0;
  const dx = Number(vertices[1].x || 0) - Number(vertices[0].x || 0);
  if (!dx) return 0;
  return (Number(vertices[1].y || 0) - Number(vertices[0].y || 0)) / dx;
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
  const assetTextByFileName = {};
  const anonymousAssetTexts = [];
  function addText(fileName, text, group, preferFullText) {
    fileName = String(fileName || '');
    text = String(text || '');
    if (!text) return;
    if (fileName && (preferFullText || !byFileName[fileName])) byFileName[fileName] = text;
    const normalizedGroup = String(group || '').toLowerCase();
    if (normalizedGroup === 'asset' || /^asset/i.test(fileName) || isLandCertificateOcrText_(text)) {
      if (fileName) {
        if (preferFullText || !assetTextByFileName[fileName]) assetTextByFileName[fileName] = text;
      } else {
        anonymousAssetTexts.push(text);
      }
    }
  }
  (reviewJson && reviewJson.ocr_results || []).forEach(function(item) {
    addText(item.file_name, item.text || item.text_preview || '', item.group, false);
  });
  try {
    const rows = getRowsByCaseId_(SHEETS.OCR_RESULTS, caseId);
    rows.forEach(function(row) {
      const fileName = row['File Name'] || '';
      const text = (row['OCR Text'] || '') || readOcrTextFileFromUrl_(row['OCR Text File URL'] || '');
      addText(fileName, text, inferOcrGroupFromFileName_(fileName), true);
    });
  } catch (err) {
    // Review must still load from the stored JSON if the OCR sheet cannot be read.
  }
  return {
    byFileName: byFileName,
    assetTextByFileName: assetTextByFileName,
    assetText: Object.keys(assetTextByFileName).map(function(fileName) {
      return assetTextByFileName[fileName];
    }).concat(anonymousAssetTexts).join('\n\n')
  };
}

function inferOcrGroupFromFileName_(fileName) {
  const name = String(fileName || '').toLowerCase();
  if (name.indexOf('secured_party__') === 0 || name.indexOf('secured_party') === 0) return 'secured_party';
  if (name.indexOf('obligor__') === 0 || name.indexOf('obligor') === 0) return 'obligor';
  if (name.indexOf('asset__') === 0 || name.indexOf('asset') === 0) return 'asset';
  return '';
}

function isLandCertificateOcrText_(text) {
  const normalized = removeVietnameseAccents_(String(text || ''))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return false;
  let score = 0;
  if (normalized.indexOf('giay chung nhan') >= 0) score += 3;
  if (normalized.indexOf('quyen su dung dat') >= 0) score += 3;
  if (normalized.indexOf('thua dat') >= 0) score += 2;
  if (normalized.indexOf('to ban do') >= 0) score += 2;
  if (normalized.indexOf('dien tich') >= 0 && normalized.indexOf('hinh thuc su dung') >= 0) score += 2;
  if (normalized.indexOf('so vao so cap gcn') >= 0 || normalized.indexOf('so vao so cap giay chung nhan') >= 0) score += 2;
  if (normalized.indexOf('so tai nguyen') >= 0 && normalized.indexOf('moi truong') >= 0) score += 1;
  return score >= 4;
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
  if (isPdfMime_(mimeType)) {
    const pdfPreview = getDrivePdfFirstPagePreviewBlob_(fileId, file.getName());
    if (pdfPreview) {
      const previewBlob = resizeImageBlobForReview_(pdfPreview);
      return {
        file_id: fileId,
        file_name: file.getName(),
        mime_type: previewBlob.getContentType() || 'image/jpeg',
        is_image: true,
        is_pdf_preview: true,
        data_url: 'data:' + (previewBlob.getContentType() || 'image/jpeg') + ';base64,' + Utilities.base64Encode(previewBlob.getBytes())
      };
    }
  }
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

function getDrivePdfFirstPagePreviewBlob_(fileId, fileName) {
  try {
    const metadata = Drive.Files.get(fileId);
    let thumbnailUrl = metadata && metadata.thumbnailLink || '';
    if (!thumbnailUrl) {
      thumbnailUrl = 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(fileId) + '&sz=w2400';
    } else {
      thumbnailUrl = thumbnailUrl
        .replace(/=s\d+(?:-c)?$/i, '=s2400')
        .replace(/([?&])sz=[^&]+/i, '$1sz=w2400');
    }
    const response = UrlFetchApp.fetch(thumbnailUrl, {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true
    });
    if (response.getResponseCode() >= 300) return null;
    const blob = response.getBlob();
    if (String(blob.getContentType() || '').indexOf('image/') !== 0) return null;
    return blob.setName((fileName || 'certificate') + '_page_1_preview.jpg');
  } catch (err) {
    console.warn('Cannot create PDF first-page preview for ' + fileId + ': ' + err);
    return null;
  }
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

function getCasePdfData(caseId, token, fileId) {
  assertValidToken_(caseId, token);
  const data = getLatestFinalData(caseId) || getLatestExtractedData(caseId);
  if (!data) throw new Error('No review data for case ' + caseId);
  const allowed = (data.ocr_results || []).some(function(item) {
    return item.file_id === fileId;
  });
  if (!allowed) throw new Error('PDF file is not part of this case');
  const file = DriveApp.getFileById(fileId);
  if (!isPdfMime_(file.getMimeType())) throw new Error('File is not a PDF');
  const blob = file.getBlob();
  const bytes = blob.getBytes();
  if (bytes.length > 20 * 1024 * 1024) throw new Error('PDF exceeds the 20 MB review-rendering limit');
  return {
    file_name: file.getName(),
    mime_type: blob.getContentType() || 'application/pdf',
    base64: Utilities.base64Encode(bytes)
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
