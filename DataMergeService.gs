function buildReviewJson(caseId, formData, aiData, ocrResults) {
  const normalized = normalizeAiData_(aiData || {}, ocrResults || []);
  const reviewJson = {
    schema_version: '1.0.0',
    case_id: caseId,
    contract_info: {
      review_email: makeField('Email nháº­n Review', '', formData.reviewEmail, '', 'FORM', ''),
      asset_type: makeField('Loáº¡i tÃ i sáº£n', '', formData.assetType, '', 'FORM', ''),
      contract_type: makeField('Loáº¡i há»£p Ä‘á»“ng', '', formData.contractType, '', 'FORM', ''),
      asset_count: makeField('Sá»‘ lÆ°á»£ng tÃ i sáº£n báº£o Ä‘áº£m', '', formData.assetCount, '', 'FORM', ''),
      bank_signer: makeField('NgÆ°á»i kÃ½ há»£p Ä‘á»“ng táº¡i ngÃ¢n hÃ ng', '', formData.bankSigner, '', 'FORM', ''),
      dispute_court: makeField('TÃ²a Ã¡n xá»­ lÃ½ tranh cháº¥p', '', formData.disputeCourt, '', 'FORM', ''),
      valuation_amount: makeField('GiÃ¡ trá»‹ Ä‘á»‹nh giÃ¡', '', formData.valuationAmount, '', 'FORM', ''),
      valuation_land_amount: makeField('GiÃ¡ trá»‹ Ä‘áº¥t', '', '', '', 'CONTRACT_DRAFT', ''),
      valuation_house_amount: makeField('GiÃ¡ trá»‹ nhÃ ', '', '', '', 'CONTRACT_DRAFT', ''),
      valuation_total_amount: makeField('Tá»•ng giÃ¡ trá»‹ tÃ i sáº£n', '', '', '', 'CONTRACT_DRAFT', ''),
      contract_draft_saved: makeField('ÄÃ£ lÆ°u thÃ´ng tin soáº¡n tháº£o há»£p Ä‘á»“ng', '', '', '', 'CONTRACT_DRAFT', ''),
      cif_customer: makeField('CIF khÃ¡ch hÃ ng', '', '', '', 'CONTRACT_DRAFT', ''),
      contract_date: makeField('NgÃ y há»£p Ä‘á»“ng', '', '', '', 'CONTRACT_DRAFT', ''),
      contract_sequence: makeField('Sá»‘ thá»© tá»± há»£p Ä‘á»“ng', '', '', '', 'CONTRACT_DRAFT', ''),
      actual_asset_differs_from_certificate: makeField('TÃ i sáº£n thá»±c táº¿ cÃ³ khÃ¡c thÃ´ng tin trÃªn bÃ¬a Ä‘áº¥t khÃ´ng', '', '', '', 'CONTRACT_DRAFT', ''),
      actual_asset_difference_description: makeField('MÃ´ táº£ pháº§n sai khÃ¡c giá»¯a tÃ i sáº£n thá»±c táº¿ vÃ  bÃ¬a Ä‘áº¥t', '', '', '', 'CONTRACT_DRAFT', ''),
      actual_house_asset: makeField('TÃ i sáº£n lÃ  nhÃ  thá»±c táº¿ náº¿u sai khÃ¡c vá»›i bÃ¬a Ä‘áº¥t', '', '', '', 'CONTRACT_DRAFT', ''),
      requires_template_5: makeField('Cáº§n láº­p thÃªm máº«u 5', '', '', '', 'TEMPLATE_DECISION', ''),
      reason_requires_template_5: makeField('LÃ½ do cáº§n láº­p thÃªm máº«u 5', '', '', '', 'TEMPLATE_DECISION', ''),
      template_4_code: makeField('MÃ£ máº«u 4 dá»± kiáº¿n', '', '', '', 'TEMPLATE_DECISION', ''),
      template_5_code: makeField('MÃ£ máº«u 5 dá»± kiáº¿n', '', '', '', 'TEMPLATE_DECISION', '')
    },
    secured_parties: normalized.secured_parties,
    obligors: normalized.obligors,
    assets: normalized.assets,
    ocr_results: ocrResults.map(function(item) {
      return {
        file_name: item.file_name,
        file_id: item.file_id,
        file_type: item.file_type,
        group: item.group,
        status: item.status,
        confidence: item.confidence,
        orientation_degrees: item.orientation_degrees || 0,
        text_file_url: item.text_file_url,
        has_text: Boolean(item.text),
        id_numbers: extractVietnamIdNumbers_(item.text || ''),
        text_preview: makeOcrPreview_(item.text)
      };
    }),
    validation: {
      status: 'PENDING',
      missing_fields: [],
      conflicts: normalized.conflicts || [],
      warnings: normalized.warnings || []
    },
    review: {
      status: 'PENDING_REVIEW',
      review_url: '',
      token_hash: '',
      sent_at: '',
      confirmed_by: '',
      confirmed_at: ''
    },
    manual_overrides: [],
    audit_logs: [],
    final_confirmed_data: {}
  };
  applyFormPriorityRules_(reviewJson);
  repairUnsafeLandCertificateFieldsInReviewJson(reviewJson, (ocrResults || [])
    .filter(function(item) { return item.group === 'asset'; })
    .map(function(item) { return item.text || item.text_preview || ''; })
    .join('\n'));
  repairAssetIssueDateInReviewJson(reviewJson, (ocrResults || [])
    .filter(function(item) { return item.group === 'asset'; })
    .map(function(item) { return item.text || item.text_preview || ''; })
    .join('\n'));
  repairAssetOwnerAddressInReviewJson(reviewJson, (ocrResults || [])
    .filter(function(item) { return item.group === 'asset'; })
    .map(function(item) { return item.text || item.text_preview || ''; })
    .join('\n'));
  repairAssetCertificateNoteInReviewJson(reviewJson, (ocrResults || [])
    .filter(function(item) { return item.group === 'asset'; })
    .map(function(item) { return item.text || item.text_preview || ''; })
    .join('\n'));
  applyTemplateDecisionToReviewJson(reviewJson);
  reviewJson.final_confirmed_data = buildFinalConfirmedData(reviewJson);
  return reviewJson;
}

function makeOcrPreview_(text) {
  text = text || '';
  const maxChars = 6000;
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + '\n...[OCR_TEXT_TRUNCATED]';
}

function applyOverridesToReviewJson(reviewJson, overrides) {
  (overrides || []).forEach(function(override) {
    const field = getByPath(reviewJson, override.field_path);
    if (field && typeof field === 'object' && field.hasOwnProperty('final_value')) {
      field.manual_value = override.new_value;
      field.final_value = override.new_value || field.ai_value || field.form_value || '';
      field.confirmed = true;
    }
  });
  reviewJson.manual_overrides = overrides || [];
  reviewJson.final_confirmed_data = buildFinalConfirmedData(reviewJson);
  return reviewJson;
}

function repairIdentityIssueDatesInReviewJson(reviewJson, ocrTextByFileOverride) {
  if (!reviewJson) return reviewJson;
  const ocrTextByFile = ocrTextByFileOverride || buildOcrTextMapFromReviewJson_(reviewJson);
  function repairPerson(person) {
    if (!person || !person.id_issue_date) return;
    clearInvalidIdentityIssueDateValue_(person.id_issue_date);
    const id = normalizeId_(person.id_number && person.id_number.final_value);
    if (!id) return;
    const documentType = person.id_document_type && person.id_document_type.final_value;
    const inferred = extractIssueDateByIdentityNumberFromOcr_(id, ocrTextByFile, documentType);
    if (inferred.date) {
      person.id_issue_date.ai_value = inferred.date;
      person.id_issue_date.source = inferred.file_name || person.id_issue_date.source || 'OCR_ID_MATCH';
      person.id_issue_date.confidence = Math.max(Number(person.id_issue_date.confidence || 0), 0.9);
      if (!person.id_issue_date.manual_value) person.id_issue_date.final_value = inferred.date;
    }
    rejectUnverifiedIdentityIssueDate_(person, ocrTextByFile, documentType);
  }
  (reviewJson.secured_parties || []).forEach(repairPerson);
  (reviewJson.obligors || []).forEach(repairPerson);
  return reviewJson;
}

function buildOcrTextMapFromReviewJson_(reviewJson) {
  const ocrTextByFile = {};
  (reviewJson.ocr_results || []).forEach(function(item) {
    if (item && item.file_name) ocrTextByFile[item.file_name] = item.text || item.text_preview || '';
  });
  return ocrTextByFile;
}

function repairAssetAreaWordsInReviewJson(reviewJson, fullAssetOcrText) {
  if (!reviewJson) return reviewJson;
  const assetText = fullAssetOcrText || (reviewJson.ocr_results || [])
    .filter(function(item) { return item.group === 'asset'; })
    .map(function(item) { return item.text || item.text_preview || ''; })
    .join('\n');
  const areaWords = extractAreaWordsFromCertificateText_(assetText);
  if (!areaWords) return reviewJson;
  (reviewJson.assets || []).forEach(function(asset) {
    const field = asset && asset.real_estate && asset.real_estate.area_in_words;
    if (!field || !field.hasOwnProperty('final_value')) return;
    if (field.manual_value || field.final_value || field.ai_value) return;
    field.ai_value = areaWords;
    field.final_value = areaWords;
    field.source = field.source || 'OCR_ASSET_TEXT';
    field.confidence = field.confidence || 0.82;
  });
  return reviewJson;
}

function clearInvalidIdentityIssueDateValue_(field) {
  if (!field || field.manual_value) return;
  const value = String(field.final_value || field.ai_value || '').trim();
  if (!/^\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}$/.test(value)) return;
  if (normalizeDateValue_(value)) return;
  field.ai_value = '';
  field.final_value = 'KhÃ´ng rÃµ, Ä‘á» nghá»‹ sá»­a thá»§ cÃ´ng';
  field.source = field.source || 'OCR_DATE_INVALID';
  field.confidence = '';
}

function repairAssetCertificateTitleInReviewJson(reviewJson, fullAssetOcrText) {
  if (!reviewJson) return reviewJson;
  const assetText = fullAssetOcrText || (reviewJson.ocr_results || [])
    .filter(function(item) { return item.group === 'asset'; })
    .map(function(item) { return item.text || item.text_preview || ''; })
    .join('\n');
  const title = extractCertificateTitle_(assetText);
  if (!title) return reviewJson;
  (reviewJson.assets || []).forEach(function(asset) {
    const field = asset && asset.certificate_title;
    if (!field || !field.hasOwnProperty('final_value')) return;
    const current = String(field.final_value || field.ai_value || '').trim();
    const manual = String(field.manual_value || '').trim();
    if (manual && !isShortCertificateTitleForReviewRepair_(manual, title)) return;
    if (current && !isShortCertificateTitleForReviewRepair_(current, title) && !isBadCertificateTitleForMerge_(current)) return;
    field.ai_value = title;
    field.final_value = title;
    field.source = field.source || 'OCR_ASSET_TEXT_TITLE_REPAIR';
    field.confidence = Math.max(Number(field.confidence || 0), 0.86);
  });
  return reviewJson;
}

function repairAssetIssuingAuthorityInReviewJson(reviewJson, fullAssetOcrText) {
  if (!reviewJson) return reviewJson;
  const assetText = fullAssetOcrText || (reviewJson.ocr_results || [])
    .filter(function(item) { return item.group === 'asset'; })
    .map(function(item) { return item.text || item.text_preview || ''; })
    .join('\n');
  const authority = extractRealEstateIssuingAuthority_(assetText);
  if (!authority) return reviewJson;
  (reviewJson.assets || []).forEach(function(asset) {
    const field = asset && asset.real_estate && asset.real_estate.issuing_authority;
    if (!field || !field.hasOwnProperty('final_value') || field.manual_value) return;
    const current = String(field.final_value || field.ai_value || '').trim();
    if (current && !isUnsafeRealEstateIssuingAuthorityValue_(current)) return;
    field.ai_value = authority;
    field.final_value = authority;
    field.source = field.source || 'OCR_ASSET_TEXT_AUTHORITY_REPAIR';
    field.confidence = Math.max(Number(field.confidence || 0), 0.84);
  });
  return reviewJson;
}

function repairAssetIssueDateInReviewJson(reviewJson, fullAssetOcrText) {
  if (!reviewJson) return reviewJson;
  const assetText = fullAssetOcrText || (reviewJson.ocr_results || [])
    .filter(function(item) { return item.group === 'asset'; })
    .map(function(item) { return item.text || item.text_preview || ''; })
    .join('\n');
  const issueDate = extractRealEstateIssueDate_(assetText);
  if (!issueDate) return reviewJson;
  (reviewJson.assets || []).forEach(function(asset) {
    const field = asset && asset.real_estate && asset.real_estate.issue_date;
    if (!field || !field.hasOwnProperty('final_value') || field.manual_value) return;
    if (!shouldReplaceRealEstateIssueDate_(field, issueDate)) return;
    field.ai_value = issueDate;
    field.final_value = issueDate;
    field.source = field.source || 'OCR_ASSET_TEXT_ISSUE_DATE_REPAIR';
    field.confidence = Math.max(Number(field.confidence || 0), 0.86);
  });
  return reviewJson;
}

function repairAssetOwnerAddressInReviewJson(reviewJson, fullAssetOcrText) {
  if (!reviewJson) return reviewJson;
  const assetText = fullAssetOcrText || (reviewJson.ocr_results || [])
    .filter(function(item) { return item.group === 'asset'; })
    .map(function(item) { return item.text || item.text_preview || ''; })
    .join('\n');
  if (!isNewA4LandCertificateText_(assetText)) return reviewJson;
  const ownerAddress = extractOwnerAddressFromCertificateText_(assetText);
  (reviewJson.assets || []).forEach(function(asset) {
    clearOrRepairNewA4OwnerAddressField_(asset && asset.owner_address, ownerAddress);
    clearOrRepairNewA4OwnerAddressField_(asset && asset.real_estate && asset.real_estate.owner_address, ownerAddress);
  });
  return reviewJson;
}

function repairAssetCertificateNoteInReviewJson(reviewJson, fullAssetOcrText) {
  if (!reviewJson) return reviewJson;
  const assetText = fullAssetOcrText || (reviewJson.ocr_results || [])
    .filter(function(item) { return item.group === 'asset'; })
    .map(function(item) { return item.text || item.text_preview || ''; })
    .join('\n');
  const note = extractCertificateNoteFromCertificateText_(assetText);
  if (!note) return reviewJson;
  (reviewJson.assets || []).forEach(function(asset) {
    const field = asset && asset.real_estate && asset.real_estate.certificate_note;
    if (!field || !field.hasOwnProperty('final_value') || field.manual_value) return;
    if (!shouldReplaceSimpleOcrField_(field, note)) return;
    field.ai_value = note;
    field.final_value = note;
    field.source = field.source || 'OCR_CERTIFICATE_NOTE_REPAIR';
    field.confidence = Math.max(Number(field.confidence || 0), 0.86);
  });
  return reviewJson;
}

function clearOrRepairNewA4OwnerAddressField_(field, ownerAddress) {
  if (!field || !field.hasOwnProperty('final_value') || field.manual_value) return;
  if (ownerAddress) {
    field.ai_value = ownerAddress;
    field.final_value = ownerAddress;
    field.source = field.source || 'OCR_ASSET_TEXT_OWNER_ADDRESS_REPAIR';
    field.confidence = Math.max(Number(field.confidence || 0), 0.82);
    return;
  }
  const current = String(field.final_value || field.ai_value || '').trim();
  if (!current) return;
  field.ai_value = '';
  field.final_value = '';
  field.source = 'OCR_REJECTED_NEW_A4_NO_OWNER_ADDRESS';
  field.confidence = '';
}

function repairAssetCertificateCodesInReviewJson(reviewJson, fullAssetOcrText) {
  if (!reviewJson) return reviewJson;
  const assetText = fullAssetOcrText || (reviewJson.ocr_results || [])
    .filter(function(item) { return item.group === 'asset'; })
    .map(function(item) { return item.text || item.text_preview || ''; })
    .join('\n');
  const certificate = extractRealEstateCertificateNumber_(assetText);
  const registry = extractRealEstateRegistryNumber_(assetText);
  (reviewJson.assets || []).forEach(function(asset) {
    const re = asset && asset.real_estate;
    if (!re) return;
    if (certificate && shouldReplaceCertificateNumber_(re.certificate_number)) {
      re.certificate_number.ai_value = certificate;
      re.certificate_number.final_value = certificate;
      re.certificate_number.source = re.certificate_number.source || 'OCR_ASSET_TEXT_CERTIFICATE_CODE_REPAIR';
      re.certificate_number.confidence = Math.max(Number(re.certificate_number.confidence || 0), 0.86);
    }
    const currentRegistry = String(re.registry_number && (re.registry_number.final_value || re.registry_number.ai_value) || '').trim();
    if (registry && shouldReplaceRegistryNumber_(re.registry_number, registry, certificate)) {
      re.registry_number.ai_value = registry;
      re.registry_number.final_value = registry;
      re.registry_number.source = re.registry_number.source || 'OCR_ASSET_TEXT_REGISTRY_CODE_REPAIR';
      re.registry_number.confidence = Math.max(Number(re.registry_number.confidence || 0), 0.86);
    } else if (isCertificateNumberLike_(currentRegistry)) {
      re.registry_number.ai_value = '';
      re.registry_number.final_value = '';
      re.registry_number.source = re.registry_number.source || 'OCR_ASSET_TEXT_REGISTRY_REJECTED_CERTIFICATE_CODE';
      re.registry_number.confidence = '';
      addReviewWarningOnce_(reviewJson, 'assets[].real_estate.registry_number', 'Sá»‘ vÃ o sá»• Ä‘ang bá»‹ nháº­n nháº§m thÃ nh sá»‘ GCN; cáº§n kiá»ƒm tra OCR dÃ²ng "Sá»‘ vÃ o sá»• cáº¥p GCN".');
    } else if (isInvalidRegistryNumber_(currentRegistry)) {
      re.registry_number.ai_value = '';
      re.registry_number.final_value = '';
      re.registry_number.source = re.registry_number.source || 'OCR_ASSET_TEXT_REGISTRY_REJECTED_PARTIAL_CODE';
      re.registry_number.confidence = '';
      addReviewWarningOnce_(reviewJson, 'assets[].real_estate.registry_number', 'Sá»‘ vÃ o sá»• OCR chá»‰ Ä‘á»c Ä‘Æ°á»£c má»™t pháº§n; cáº§n kiá»ƒm tra dÃ²ng "Sá»‘ vÃ o sá»• cáº¥p GCN/Giáº¥y chá»©ng nháº­n" trÃªn áº£nh gá»‘c.');
    }
  });
  return reviewJson;
}

function repairAssetAreaInReviewJson(reviewJson, fullAssetOcrText) {
  if (!reviewJson) return reviewJson;
  const assetText = fullAssetOcrText || (reviewJson.ocr_results || [])
    .filter(function(item) { return item.group === 'asset'; })
    .map(function(item) { return item.text || item.text_preview || ''; })
    .join('\n');
  const area = extractRealEstateArea_(assetText);
  (reviewJson.assets || []).forEach(function(asset) {
    const field = asset && asset.real_estate && asset.real_estate.area;
    if (!field || !field.hasOwnProperty('final_value') || field.manual_value) return;
    if (area && shouldReplaceAreaValue_(field, area)) {
      field.ai_value = area;
      field.final_value = area;
      field.source = field.source || 'OCR_INDEXED_ASSET_TEXT_AREA_REPAIR';
      field.confidence = Math.max(Number(field.confidence || 0), 0.86);
    } else if (field.final_value || field.ai_value) {
      const normalized = normalizeRealEstateAreaValue_(field.final_value || field.ai_value);
      if (normalized && normalized !== (field.final_value || field.ai_value)) {
        field.ai_value = normalized;
        field.final_value = normalized;
      }
    }
  });
  return reviewJson;
}

function repairAssetPostIssueChangesInReviewJson(reviewJson, fullAssetOcrText) {
  if (!reviewJson) return reviewJson;
  const assetText = fullAssetOcrText || (reviewJson.ocr_results || [])
    .filter(function(item) { return item.group === 'asset'; })
    .map(function(item) { return item.text || item.text_preview || ''; })
    .join('\n');
  const postIssue = extractPostIssueChangesFromCertificateText_(assetText);
  (reviewJson.assets || []).forEach(function(asset) {
    const field = asset && asset.real_estate && asset.real_estate.post_issue_changes;
    if (!field || !field.hasOwnProperty('final_value') || field.manual_value) return;
    if (postIssue.value && shouldReplacePostIssueChanges_(field, postIssue.value)) {
      field.ai_value = postIssue.value;
      field.final_value = postIssue.value;
      field.source = field.source || 'OCR_POST_ISSUE_CHANGES';
      field.confidence = postIssue.status === 'partial_or_unclear' ? 0.55 : 0.82;
    }
    if (postIssue.status === 'partial_or_unclear') {
      addReviewWarningOnce_(reviewJson, 'assets[].real_estate.post_issue_changes', 'Má»¥c IV. Nhá»¯ng thay Ä‘á»•i sau khi cáº¥p Giáº¥y chá»©ng nháº­n cÃ³ chá»¯ viáº¿t tay/má»; OCR chá»‰ Ä‘á»c Ä‘Æ°á»£c má»™t pháº§n, Ä‘á» nghá»‹ kiá»ƒm tra ká»¹ trÃªn áº£nh gá»‘c.');
    }
  });
  return reviewJson;
}

function repairUnsafeLandCertificateFieldsInReviewJson(reviewJson, fullAssetOcrText) {
  if (!reviewJson) return reviewJson;
  const assetText = fullAssetOcrText || (reviewJson.ocr_results || [])
    .filter(function(item) { return item.group === 'asset'; })
    .map(function(item) { return item.text || item.text_preview || ''; })
    .join('\n');
  const indexed = extractRealEstateIndexedLandFields_(assetText);
  const hasTrustedLandBlock = indexed && indexed._quality && indexed._quality.trusted;
  (reviewJson.assets || []).forEach(function(asset) {
    const re = asset && asset.real_estate;
    if (!re) return;
    if (!hasTrustedLandBlock) {
      clearUntrustedLandIndexedField_(reviewJson, re.land_plot_number, 'assets[].real_estate.land_plot_number');
      clearUntrustedLandIndexedField_(reviewJson, re.map_sheet_number, 'assets[].real_estate.map_sheet_number');
      clearUntrustedLandIndexedField_(reviewJson, re.land_address, 'assets[].real_estate.land_address');
      clearUntrustedLandIndexedField_(reviewJson, re.area, 'assets[].real_estate.area');
      clearUntrustedLandIndexedField_(reviewJson, re.usage_form, 'assets[].real_estate.usage_form');
      clearUntrustedLandIndexedField_(reviewJson, re.usage_purpose, 'assets[].real_estate.usage_purpose');
      clearUntrustedLandIndexedField_(reviewJson, re.usage_term, 'assets[].real_estate.usage_term');
      clearUntrustedLandIndexedField_(reviewJson, re.usage_origin, 'assets[].real_estate.usage_origin');
      return;
    }
    replaceFromTrustedLandBlock_(re.land_plot_number, indexed.land_plot_number);
    replaceFromTrustedLandBlock_(re.map_sheet_number, indexed.map_sheet_number);
    replaceFromTrustedLandBlock_(re.area, indexed.area);
    clearUnsafeLandField_(reviewJson, re.land_address, 'assets[].real_estate.land_address', isUnsafeLandAddressValue_, hasTrustedLandBlock ? indexed.land_address : '');
    clearUnsafeLandField_(reviewJson, re.usage_form, 'assets[].real_estate.usage_form', isUnsafeIndexedLandFieldValue_, hasTrustedLandBlock ? indexed.usage_form : '');
    clearUnsafeLandField_(reviewJson, re.usage_purpose, 'assets[].real_estate.usage_purpose', isUnsafeIndexedLandFieldValue_, hasTrustedLandBlock ? indexed.usage_purpose : '');
    clearUnsafeLandField_(reviewJson, re.usage_term, 'assets[].real_estate.usage_term', isUnsafeIndexedLandFieldValue_, hasTrustedLandBlock ? indexed.usage_term : '');
    clearUnsafeLandField_(reviewJson, re.usage_origin, 'assets[].real_estate.usage_origin', isUnsafeIndexedLandFieldValue_, hasTrustedLandBlock ? indexed.usage_origin : '');
  });
  return reviewJson;
}

function clearUntrustedLandIndexedField_(reviewJson, field, fieldPath) {
  if (!field || !field.hasOwnProperty('final_value') || field.manual_value) return;
  const current = String(field.final_value || field.ai_value || '').trim();
  if (!current) return;
  field.ai_value = '';
  field.final_value = '';
  field.source = 'OCR_REJECTED_NO_TRUSTED_LAND_BLOCK';
  field.confidence = '';
  addReviewWarningOnce_(reviewJson, fieldPath, 'KhÃ´ng tÃ¬m Ä‘Æ°á»£c block II. Thá»­a Ä‘áº¥t Ä‘á»§ tin cáº­y; trÆ°á»ng nÃ y Ä‘Æ°á»£c Ä‘á»ƒ trá»‘ng Ä‘á»ƒ trÃ¡nh láº¥y nháº§m dá»¯ liá»‡u tá»« trang khÃ¡c.');
}

function replaceFromTrustedLandBlock_(field, replacement) {
  if (!field || !field.hasOwnProperty('final_value') || field.manual_value || !replacement) return;
  const current = String(field.final_value || field.ai_value || '').trim();
  if (current === replacement) return;
  field.ai_value = replacement;
  field.final_value = replacement;
  field.source = 'OCR_TRUSTED_LAND_BLOCK_REPAIR';
  field.confidence = Math.max(Number(field.confidence || 0), 0.86);
}

function clearUnsafeLandField_(reviewJson, field, fieldPath, predicate, replacement) {
  if (!field || !field.hasOwnProperty('final_value') || field.manual_value) return;
  const current = String(field.final_value || field.ai_value || '').trim();
  if (!current || !predicate(current)) return;
  if (replacement && !predicate(replacement)) {
    field.ai_value = replacement;
    field.final_value = replacement;
    field.source = 'OCR_TRUSTED_LAND_BLOCK_REPAIR';
    field.confidence = Math.max(Number(field.confidence || 0), 0.86);
    return;
  }
  field.ai_value = '';
  field.final_value = '';
  field.source = 'OCR_REJECTED_UNTRUSTED_LAND_CONTEXT';
  field.confidence = '';
  addReviewWarningOnce_(reviewJson, fieldPath, 'TrÆ°á»ng bÃ¬a Ä‘áº¥t cÃ³ dáº¥u hiá»‡u láº¥y nháº§m tá»« trang/chá»¯ khÃ¡c; cáº§n kiá»ƒm tra láº¡i áº£nh gá»‘c hoáº·c khoanh vÃ¹ng OCR thá»§ cÃ´ng.');
}

function isUnsafeLandAddressValue_(value) {
  const normalized = removeVietnameseAccents_(String(value || '')).toLowerCase().replace(/\s+/g, ' ').trim();
  if (!normalized) return false;
  if (normalized.indexOf('dia chi thuong tru') >= 0 || normalized.indexOf('thuong tru') >= 0) return true;
  if (normalized.indexOf('cmnd') >= 0 || normalized.indexOf('cccd') >= 0 || normalized.indexOf('nam sinh') >= 0) return true;
  if (normalized.indexOf('giay chung nhan') >= 0 || normalized.indexOf('so vao so') >= 0) return true;
  if (/\bco\s*\d{5,}\b/i.test(normalized)) return true;
  return containsLaterLandCertificateContext_(normalized);
}

function isUnsafeIndexedLandFieldValue_(value) {
  const normalized = removeVietnameseAccents_(String(value || '')).toLowerCase().replace(/\s+/g, ' ').trim();
  if (!normalized) return false;
  if (containsLaterLandCertificateContext_(normalized)) return true;
  if (normalized.indexOf('so tai nguyen') >= 0 || normalized.indexOf('giam doc') >= 0 || normalized.indexOf('van phong dang ky') >= 0) return true;
  if (normalized.indexOf('so vao so') >= 0 || normalized.indexOf('giay chung nhan') >= 0) return true;
  if (normalized.length > 120 && countLandFieldLabels_(normalized) > 0) return true;
  return false;
}

function containsLaterLandCertificateContext_(normalized) {
  const text = String(normalized || '');
  return text.indexOf('thoi han su dung') >= 0 ||
    text.indexOf('nguon goc su dung') >= 0 ||
    text.indexOf('muc dich su dung') >= 0 ||
    text.indexOf('hinh thuc su dung') >= 0 ||
    text.indexOf('nha o') >= 0 ||
    text.indexOf('cong trinh') >= 0 ||
    text.indexOf('rung san xuat') >= 0 ||
    text.indexOf('cay lau nam') >= 0 ||
    text.indexOf('ghi chu') >= 0 ||
    text.indexOf('iv nhung thay doi') >= 0;
}

function countLandFieldLabels_(normalized) {
  let count = 0;
  ['dien tich', 'hinh thuc su dung', 'muc dich su dung', 'thoi han su dung', 'nguon goc su dung', 'nha o', 'cong trinh', 'ghi chu'].forEach(function(label) {
    if (String(normalized || '').indexOf(label) >= 0) count++;
  });
  return count;
}

function isShortCertificateTitleForReviewRepair_(current, extracted) {
  const currentText = removeVietnameseAccents_(current).toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  const extractedText = removeVietnameseAccents_(extracted).toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  return currentText &&
    extractedText &&
    currentText !== extractedText &&
    extractedText.indexOf(currentText) === 0 &&
    extractedText.length > currentText.length + 8;
}

function repairAssetLandAddressInReviewJson(reviewJson, fullAssetOcrText) {
  if (!reviewJson) return reviewJson;
  const assetText = fullAssetOcrText || (reviewJson.ocr_results || [])
    .filter(function(item) { return item.group === 'asset'; })
    .map(function(item) { return item.text || item.text_preview || ''; })
    .join('\n');
  const indexed = extractRealEstateIndexedLandFields_(assetText);
  const address = indexed.land_address || '';
  if (!address) return reviewJson;
  (reviewJson.assets || []).forEach(function(asset) {
    const field = asset && asset.real_estate && asset.real_estate.land_address;
    if (!field || !field.hasOwnProperty('final_value') || field.manual_value) return;
    const current = String(field.final_value || field.ai_value || '').trim();
    if (current && !isBetterLandAddress_(current, address)) return;
    field.ai_value = address;
    field.final_value = address;
    field.source = field.source || 'OCR_INDEXED_ASSET_TEXT';
    field.confidence = Math.max(Number(field.confidence || 0), 0.86);
  });
  return reviewJson;
}

function repairAssetPlotAndMapSheetInReviewJson(reviewJson, fullAssetOcrText) {
  if (!reviewJson) return reviewJson;
  const assetText = fullAssetOcrText || (reviewJson.ocr_results || [])
    .filter(function(item) { return item.group === 'asset'; })
    .map(function(item) { return item.text || item.text_preview || ''; })
    .join('\n');
  const indexed = extractRealEstateIndexedLandFields_(assetText);
  const plotNumber = indexed.land_plot_number || '';
  const mapSheetNumber = indexed.map_sheet_number || '';
  (reviewJson.assets || []).forEach(function(asset) {
    const re = asset && asset.real_estate;
    if (!re) return;
    if (plotNumber && shouldReplaceSimpleOcrField_(re.land_plot_number, plotNumber)) {
      re.land_plot_number.ai_value = plotNumber;
      re.land_plot_number.final_value = plotNumber;
      re.land_plot_number.source = re.land_plot_number.source || 'OCR_INDEXED_ASSET_TEXT';
      re.land_plot_number.confidence = Math.max(Number(re.land_plot_number.confidence || 0), 0.86);
    }
    if (mapSheetNumber && shouldReplaceSimpleOcrField_(re.map_sheet_number, mapSheetNumber)) {
      re.map_sheet_number.ai_value = mapSheetNumber;
      re.map_sheet_number.final_value = mapSheetNumber;
      re.map_sheet_number.source = re.map_sheet_number.source || 'OCR_INDEXED_ASSET_TEXT';
      re.map_sheet_number.confidence = Math.max(Number(re.map_sheet_number.confidence || 0), 0.86);
    }
  });
  return reviewJson;
}

function repairAssetUsageTermInReviewJson(reviewJson, fullAssetOcrText) {
  if (!reviewJson) return reviewJson;
  const assetText = fullAssetOcrText || (reviewJson.ocr_results || [])
    .filter(function(item) { return item.group === 'asset'; })
    .map(function(item) { return item.text || item.text_preview || ''; })
    .join('\n');
  const indexed = extractRealEstateIndexedLandFields_(assetText);
  const usageTerm = indexed.usage_term || '';
  if (!usageTerm) return reviewJson;
  (reviewJson.assets || []).forEach(function(asset) {
    const field = asset && asset.real_estate && asset.real_estate.usage_term;
    if (!field || !field.hasOwnProperty('final_value') || field.manual_value) return;
    if (!shouldReplaceUsageTerm_(field, usageTerm)) return;
    field.ai_value = usageTerm;
    field.final_value = usageTerm;
    field.source = field.source || 'OCR_INDEXED_ASSET_TEXT';
    field.confidence = Math.max(Number(field.confidence || 0), 0.86);
  });
  return reviewJson;
}

function repairAssetUsageFormInReviewJson(reviewJson, fullAssetOcrText) {
  if (!reviewJson) return reviewJson;
  const assetText = fullAssetOcrText || (reviewJson.ocr_results || [])
    .filter(function(item) { return item.group === 'asset'; })
    .map(function(item) { return item.text || item.text_preview || ''; })
    .join('\n');
  const indexed = extractRealEstateIndexedLandFields_(assetText);
  const usageForm = indexed.usage_form || '';
  if (!usageForm) return reviewJson;
  (reviewJson.assets || []).forEach(function(asset) {
    const field = asset && asset.real_estate && asset.real_estate.usage_form;
    if (!field || !field.hasOwnProperty('final_value') || field.manual_value) return;
    if (!shouldReplaceUsageForm_(field, usageForm)) return;
    field.ai_value = usageForm;
    field.final_value = usageForm;
    field.source = field.source || 'OCR_INDEXED_ASSET_TEXT';
    field.confidence = Math.max(Number(field.confidence || 0), 0.86);
  });
  return reviewJson;
}

function isBetterLandAddress_(current, candidate) {
  const currentNorm = removeVietnameseAccents_(current).toLowerCase();
  const candidateNorm = removeVietnameseAccents_(candidate).toLowerCase();
  if (!currentNorm) return true;
  if (candidateNorm.indexOf(currentNorm) >= 0 && candidateNorm.length > currentNorm.length + 8) return true;
  const currentParts = currentNorm.split(/\s*-\s*/).filter(Boolean).length;
  const candidateParts = candidateNorm.split(/\s*-\s*/).filter(Boolean).length;
  return candidateParts > currentParts && candidateNorm.length > currentNorm.length;
}

function shouldReplaceUsageForm_(field, candidate) {
  if (!field || !candidate || field.manual_value) return false;
  const current = String(field.final_value || field.ai_value || '').trim();
  if (!current) return true;
  if (/\r?\n/.test(current) && !/\r?\n/.test(candidate)) return true;
  const currentNorm = removeVietnameseAccents_(current).toLowerCase().replace(/\s+/g, ' ').trim();
  const candidateNorm = removeVietnameseAccents_(candidate).toLowerCase().replace(/\s+/g, ' ').trim();
  if (!currentNorm || !candidateNorm || currentNorm === candidateNorm) return false;
  if (currentNorm.indexOf(candidateNorm) >= 0 && current.length > candidate.length + 8) return true;
  if (candidateNorm.indexOf(currentNorm) >= 0) return true;
  return hasOtherLandFieldLabel_(currentNorm);
}

function normalizeRealEstateUsageForm_(value) {
  let raw = String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/^\s*(?:[a-g]|\u0111|d)\s*[\).:]\s*/i, '')
    .replace(/^(?:h\u00ecnh\s*th\u1ee9c\s*s\u1eed\s*d\u1ee5ng|hinh\s*thuc\s*su\s*dung)\s*[:.-]?\s*/i, '')
    .replace(/[;,.:\-\s]+$/g, '')
    .trim();
  if (!raw) return '';
  raw = raw.replace(/(\d+(?:[,.]\d+)?)\s*m(?![A-Za-z0-9\u00b2])/gi, '$1 m\u00b2');
  raw = raw.replace(/\bKh[o\u00f4]ng\s*m(?![A-Za-z0-9\u00b2])/gi, 'Kh\u00f4ng m\u00b2');
  raw = raw.replace(/\bChung:\s*Khong\s*m\u00b2/gi, 'Chung: Kh\u00f4ng m\u00b2');
  return raw;
}

function shouldReplaceUsageTerm_(field, candidate) {
  if (!field || !candidate || field.manual_value) return false;
  const current = String(field.final_value || field.ai_value || '').trim();
  if (!current) return true;
  const currentNorm = removeVietnameseAccents_(current).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const candidateNorm = removeVietnameseAccents_(candidate).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (!currentNorm || !candidateNorm || currentNorm === candidateNorm) return current !== candidate;
  if (currentNorm.indexOf(candidateNorm) >= 0 && current.length > candidate.length + 8) return true;
  return hasOtherLandFieldLabel_(currentNorm);
}

function hasOtherLandFieldLabel_(normalizedText) {
  const text = String(normalizedText || '').toLowerCase();
  return text.indexOf('dien tich') >= 0 ||
    text.indexOf('hinh thuc su dung') >= 0 ||
    text.indexOf('muc dich su dung') >= 0 ||
    text.indexOf('thoi han su dung') >= 0 ||
    text.indexOf('nguon goc su dung') >= 0 ||
    /\b[0-9]+(?:[,.][0-9]+)?\s*m(?:2|Â²)?\b/i.test(text);
}

function normalizeRealEstateUsageTerm_(value) {
  const raw = String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/^\s*(?:[a-g]|\u0111|d)\s*[\).:]\s*/i, '')
    .replace(/^(?:th\u1eddi\s*h\u1ea1n\s*s\u1eed\s*d\u1ee5ng|thoi\s*han\s*su\s*dung)\s*[:.-]?\s*/i, '')
    .replace(/[;,.:\-\s]+$/g, '')
    .trim();
  if (!raw) return '';
  return correctUsageTermOcrTypos_(raw);
}

function correctUsageTermOcrTypos_(value) {
  return String(value || '')
    .replace(/(^|[^A-Za-z\u00c0-\u1ef9])(L\u00e2u)\s+\u0111\u00e0i(?=$|[^A-Za-z\u00c0-\u1ef9])/g, '$1L\u00e2u d\u00e0i')
    .replace(/(^|[^A-Za-z\u00c0-\u1ef9])(l\u00e2u)\s+\u0111\u00e0i(?=$|[^A-Za-z\u00c0-\u1ef9])/g, '$1l\u00e2u d\u00e0i')
    .replace(/(^|[^A-Za-z\u00c0-\u1ef9])(Lau)\s+dai(?=$|[^A-Za-z\u00c0-\u1ef9])/g, '$1L\u00e2u d\u00e0i')
    .replace(/(^|[^A-Za-z\u00c0-\u1ef9])(lau)\s+dai(?=$|[^A-Za-z\u00c0-\u1ef9])/g, '$1l\u00e2u d\u00e0i');
}

function extractAreaWordsFromCertificateText_(text) {
  text = String(text || '');
  if (!text) return '';
  const patterns = [
    /\(?\s*B[Äƒa]ng\s+ch[á»¯u]\s*:\s*([^\)\r\n]+)\)?/i,
    /\(?\s*Báº±ng\s+chá»¯\s*:\s*([^\)\r\n]+)\)?/i,
    /\(?\s*Bang\s+chu\s*:\s*([^\)\r\n]+)\)?/i
  ];
  for (let i = 0; i < patterns.length; i++) {
    const match = text.match(patterns[i]);
    if (match && match[1]) return '(Báº±ng chá»¯: ' + String(match[1]).replace(/\s+/g, ' ').trim() + ')';
  }
  const lines = text.split(/\r?\n/);
  for (let j = 0; j < lines.length; j++) {
    const current = removeVietnameseAccents_(lines[j]).toLowerCase();
    if (current.indexOf('dien tich') < 0) continue;
    const joined = [lines[j], lines[j + 1] || '', lines[j + 2] || ''].join(' ');
    const inline = joined.match(/\(?\s*(?:B[Äƒa]ng\s+ch[á»¯u]|Báº±ng\s+chá»¯|Bang\s+chu)\s*:\s*([^\)]+)\)?/i);
    if (inline && inline[1]) return '(Báº±ng chá»¯: ' + String(inline[1]).replace(/\s+/g, ' ').trim() + ')';
  }
  return '';
}

function buildFinalConfirmedData(reviewJson) {
  return {
    schema_version: reviewJson.schema_version,
    case_id: reviewJson.case_id,
    contract_info: flattenFieldObject_(reviewJson.contract_info),
    secured_parties: (reviewJson.secured_parties || []).map(flattenFieldObject_),
    obligors: (reviewJson.obligors || []).map(flattenFieldObject_),
    assets: (reviewJson.assets || []).map(flattenFieldObject_),
    validation_status: reviewJson.validation.status,
    missing_fields: reviewJson.validation.missing_fields,
    conflicts: reviewJson.validation.conflicts,
    warnings: reviewJson.validation.warnings,
    review_status: reviewJson.review.status,
    confirmed_by: reviewJson.review.confirmed_by,
    confirmed_at: reviewJson.review.confirmed_at
  };
}

function normalizeAiData_(aiData, ocrResults) {
  const idHintsByFile = buildIdHintsByFile_(ocrResults || []);
  const ocrTextByFile = buildOcrTextByFile_(ocrResults || []);
  const assetOcrText = (ocrResults || [])
    .filter(function(item) { return item.group === 'asset'; })
    .map(function(item) { return item.text || ''; })
    .join('\n\n');
  return {
    secured_parties: dedupePeople_((aiData.secured_parties || []).map(function(person) {
      return normalizePerson_(person, idHintsByFile, ocrTextByFile);
    })),
    obligors: dedupePeople_((aiData.obligors || []).map(function(person) {
      return normalizePerson_(person, idHintsByFile, ocrTextByFile);
    })),
    assets: (aiData.assets || []).map(function(asset) {
      return normalizeAsset_(asset, assetOcrText);
    }),
    conflicts: aiData.conflicts || [],
    warnings: aiData.warnings || []
  };
}

function normalizePerson_(person, idHintsByFile, ocrTextByFile) {
  person = person || {};
  const normalized = {
    roles: person.role_hints || [],
    full_name: fieldFromAi_('Há» vÃ  tÃªn', person.full_name),
    date_of_birth: fieldFromAi_('NgÃ y sinh', person.date_of_birth),
    gender: fieldFromAi_('Giá»›i tÃ­nh', person.gender),
    nationality: fieldFromAi_('Quá»‘c tá»‹ch', person.nationality),
    id_document_type: fieldFromAi_('Loáº¡i giáº¥y tá» tÃ¹y thÃ¢n', person.id_document_type),
    id_number: fieldFromAi_('Sá»‘ CCCD', person.id_number),
    id_issue_date: fieldFromAi_('NgÃ y cáº¥p CCCD', person.id_issue_date),
    id_issue_place: fieldFromAi_('NÆ¡i cáº¥p CCCD', person.id_issue_place),
    id_expiry_date: fieldFromAi_('NgÃ y háº¿t háº¡n CCCD', person.id_expiry_date),
    permanent_address: fieldFromAi_('Äá»‹a chá»‰ thÆ°á»ng trÃº', person.permanent_address),
    origin_place: fieldFromAi_('QuÃª quÃ¡n', person.origin_place),
    vneid_current_address: fieldFromAi_('Äá»‹a chá»‰ cÆ° trÃº má»›i tá»« VNeID', person.vneid_current_address),
    current_address_final: makeField('Äá»‹a chá»‰ sá»­ dá»¥ng cuá»‘i cÃ¹ng', '', '', '', '', ''),
    marital_status: fieldFromAi_('TÃ¬nh tráº¡ng hÃ´n nhÃ¢n', person.marital_status),
    spouse: {
      full_name: fieldFromAi_('Há» tÃªn vá»£/chá»“ng', person.spouse && person.spouse.full_name),
      id_number: fieldFromAi_('CCCD vá»£/chá»“ng', person.spouse && person.spouse.id_number)
    },
    marriage_registration: normalizeNestedFields_(person.marriage_registration || {}, {
      wife_name: 'Há» tÃªn vá»£',
      husband_name: 'Há» tÃªn chá»“ng',
      wife_id_number: 'CCCD vá»£',
      husband_id_number: 'CCCD chá»“ng',
      registration_date: 'NgÃ y Ä‘Äƒng kÃ½ káº¿t hÃ´n',
      registration_place: 'NÆ¡i Ä‘Äƒng kÃ½ káº¿t hÃ´n'
    }),
    marital_status_certificate: normalizeNestedFields_(person.marital_status_certificate || {}, {
      full_name: 'Há» tÃªn trÃªn GXN hÃ´n nhÃ¢n',
      id_number: 'CCCD trÃªn GXN hÃ´n nhÃ¢n',
      marital_status: 'TÃ¬nh tráº¡ng hÃ´n nhÃ¢n theo GXN',
      issuing_authority: 'CÆ¡ quan xÃ¡c nháº­n',
      confirmation_date: 'NgÃ y xÃ¡c nháº­n'
    })
  };
  normalized.relationship = makeField(
    'Má»‘i quan há»‡',
    normalized.marital_status.final_value || '',
    '',
    '',
    normalized.marital_status.source || '',
    normalized.marital_status.confidence || ''
  );
  enrichPersonIdFromOcr_(normalized, idHintsByFile || {});
  normalizePersonDocumentTypeClean_(normalized, ocrTextByFile || {});
  normalizeGenderFromIdentityNumber_(normalized);
  normalizeIdIssuePlaceCleanApply_(normalized, ocrTextByFile || {});
  inferPersonIssueDateFromOcr_(normalized, ocrTextByFile || {});
  rejectUnverifiedIdentityIssueDate_(normalized, ocrTextByFile || {}, normalized.id_document_type && normalized.id_document_type.final_value);
  enforceIssuePlaceByDocumentType_(normalized);
  normalizePersonDates_(normalized);
  return normalized;
}

function normalizeAsset_(asset, assetOcrText) {
  asset = asset || {};
  const realEstateRaw = asset.real_estate || {};
  const ownerValue = asset.owner_name || realEstateRaw.owner_or_user || realEstateRaw.owner_name;
  const ownerDocType = asset.owner_id_document_type || realEstateRaw.owner_id_document_type;
  const ownerAddress = asset.owner_address || realEstateRaw.owner_address;
  const normalized = {
    asset_type: fieldFromAi_('Loáº¡i tÃ i sáº£n', asset.asset_type),
    certificate_title: fieldFromAi_('T?n Gi?y ch?ng nh?n', asset.certificate_title || realEstateRaw.certificate_title),
    owner_name: fieldFromAi_('Ch? s? h?u/ch? s? d?ng', ownerValue),
    owner_identity_summary: makeField('Ch? s? h?u/ch? s? d?ng v? gi?y t? t?y th?n', '', '', '', '', ''),
    owner_id_document_type: fieldFromAi_('Lo?i gi?y t? t?y th?n c?a ch? s? h?u/ch? s? d?ng', ownerDocType),
    owner_id_number: fieldFromAi_('S? gi?y t? t?y th?n ch? s? h?u/ch? s? d?ng', asset.owner_id_number || realEstateRaw.owner_id_number),
    owner_address: fieldFromAi_('Dia chi chu so huu/chu su dung', ownerAddress),
    real_estate: normalizeNestedFields_(realEstateRaw, {
      certificate_number: 'S? gi?y ch?ng nh?n',
      registry_number: 'S? v?o s? c?p GCN',
      issuing_authority: 'C? quan c?p GCN',
      issue_date: 'Ng?y c?p GCN',
      land_plot_number: 'S? th?a',
      map_sheet_number: 'T? b?n ??',
      land_address: '??a ch? th?a ??t',
      area: 'Di?n t?ch',
      area_in_words: 'Dien tich bang chu',
      usage_form: 'H?nh th?c s? d?ng',
      usage_purpose: 'M?c ??ch s? d?ng',
      usage_term: 'Th?i h?n s? d?ng',
      usage_origin: 'Ngu?n g?c s? d?ng',
      attached_assets: 'T?i s?n g?n li?n v?i ??t',
      certificate_note: 'Ghi ch\u00fa tr\u00ean Gi\u1ea5y ch\u1ee9ng nh\u1eadn',
      post_issue_changes: 'N?i dung thay ??i sau c?p gi?y',
      certificate_info_raw_text: 'Nguyen van thong tin theo giay chung nhan',
      certificate_owner_raw_text: 'Nguyen van muc nguoi su dung dat chu so huu',
      certificate_land_raw_text: 'Nguyen van thong tin thua dat',
      certificate_attached_raw_text: 'Nguyen van thong tin tai san gan lien voi dat'
    }),
    movable: normalizeNestedFields_(asset.movable || {}, {
      asset_category: 'Lo?i ??ng s?n',
      brand: 'Nh?n hi?u',
      model_code: 'S? lo?i',
      license_plate: 'Bi?n s?',
      chassis_number: 'S? khung',
      engine_number: 'S? m?y',
      manufacture_year: 'N?m s?n xu?t',
      manufacture_country: 'N??c s?n xu?t',
      owner: 'Ch? s? h?u',
      registration_number: 'S? gi?y ??ng k?',
      issue_date: 'Ng?y c?p ??ng k?',
      issuing_authority: 'C? quan c?p ??ng k?',
      inspection_info: 'Th?ng tin ??ng ki?m'
    })
  };
  enrichAssetFromOcr_(normalized, assetOcrText || '');
  normalizeAssetTypeField_(normalized.asset_type);
  normalizeAssetOwnerDocumentType_(normalized, assetOcrText || '');
  normalizeAssetIssuingAuthority_(normalized);
  normalizeAssetCertificateCodes_(normalized);
  normalizeAssetDates_(normalized);
  return normalized;
}
function enrichAssetFromOcr_(asset, text) {
  text = String(text || '');
  if (!text) return;
  const title = extractCertificateTitle_(text);
  if (title && shouldReplaceCertificateTitleFromOcr_(asset.certificate_title, title)) {
    asset.certificate_title.ai_value = title;
    asset.certificate_title.final_value = title;
    asset.certificate_title.source = 'OCR_ASSET_TEXT';
    asset.certificate_title.confidence = asset.certificate_title.confidence || 0.85;
  }
  const certificate = extractRealEstateCertificateNumber_(text);
  if (certificate && shouldReplaceCertificateNumber_(asset.real_estate.certificate_number)) {
    asset.real_estate.certificate_number.ai_value = certificate;
    asset.real_estate.certificate_number.final_value = certificate;
    asset.real_estate.certificate_number.source = 'OCR_ASSET_TEXT';
    asset.real_estate.certificate_number.confidence = asset.real_estate.certificate_number.confidence || 0.78;
  } else if (isRegistryNumberLike_(asset.real_estate.certificate_number.final_value || asset.real_estate.certificate_number.ai_value)) {
    asset.real_estate.certificate_number.ai_value = '';
    asset.real_estate.certificate_number.final_value = 'KhÃ´ng rÃµ, Ä‘á» nghá»‹ sá»­a thá»§ cÃ´ng';
    asset.real_estate.certificate_number.source = asset.real_estate.certificate_number.source || 'OCR_ASSET_TEXT';
    asset.real_estate.certificate_number.confidence = '';
  }
  const registry = extractRealEstateRegistryNumber_(text);
  if (registry && shouldReplaceRegistryNumber_(asset.real_estate.registry_number, registry, certificate)) {
    asset.real_estate.registry_number.ai_value = registry;
    asset.real_estate.registry_number.final_value = registry;
    asset.real_estate.registry_number.source = 'OCR_ASSET_TEXT';
    asset.real_estate.registry_number.confidence = asset.real_estate.registry_number.confidence || 0.72;
  } else if (isCertificateNumberLike_(asset.real_estate.registry_number.final_value || asset.real_estate.registry_number.ai_value)) {
    asset.real_estate.registry_number.ai_value = '';
    asset.real_estate.registry_number.final_value = '';
    asset.real_estate.registry_number.source = asset.real_estate.registry_number.source || 'OCR_ASSET_TEXT_REJECTED_CERTIFICATE_CODE';
    asset.real_estate.registry_number.confidence = '';
  } else if (isInvalidRegistryNumber_(asset.real_estate.registry_number.final_value || asset.real_estate.registry_number.ai_value)) {
    asset.real_estate.registry_number.ai_value = '';
    asset.real_estate.registry_number.final_value = '';
    asset.real_estate.registry_number.source = asset.real_estate.registry_number.source || 'OCR_ASSET_TEXT_REJECTED_PARTIAL_CODE';
    asset.real_estate.registry_number.confidence = '';
  }
  const issueDate = extractRealEstateIssueDate_(text);
  if (issueDate && shouldReplaceRealEstateIssueDate_(asset.real_estate.issue_date, issueDate)) {
    asset.real_estate.issue_date.ai_value = issueDate;
    asset.real_estate.issue_date.final_value = issueDate;
    asset.real_estate.issue_date.source = 'OCR_ASSET_TEXT_ISSUE_DATE';
    asset.real_estate.issue_date.confidence = Math.max(Number(asset.real_estate.issue_date.confidence || 0), 0.86);
  }
  const indexedLandFields = extractRealEstateIndexedLandFields_(text);
  if (indexedLandFields.land_plot_number && shouldReplaceSimpleOcrField_(asset.real_estate.land_plot_number, indexedLandFields.land_plot_number)) {
    asset.real_estate.land_plot_number.ai_value = indexedLandFields.land_plot_number;
    asset.real_estate.land_plot_number.final_value = indexedLandFields.land_plot_number;
    asset.real_estate.land_plot_number.source = 'OCR_INDEXED_ASSET_TEXT';
    asset.real_estate.land_plot_number.confidence = Math.max(Number(asset.real_estate.land_plot_number.confidence || 0), 0.86);
  }
  if (indexedLandFields.map_sheet_number && shouldReplaceSimpleOcrField_(asset.real_estate.map_sheet_number, indexedLandFields.map_sheet_number)) {
    asset.real_estate.map_sheet_number.ai_value = indexedLandFields.map_sheet_number;
    asset.real_estate.map_sheet_number.final_value = indexedLandFields.map_sheet_number;
    asset.real_estate.map_sheet_number.source = 'OCR_INDEXED_ASSET_TEXT';
    asset.real_estate.map_sheet_number.confidence = Math.max(Number(asset.real_estate.map_sheet_number.confidence || 0), 0.86);
  }
  if (indexedLandFields.area && shouldReplaceAreaValue_(asset.real_estate.area, indexedLandFields.area)) {
    asset.real_estate.area.ai_value = indexedLandFields.area;
    asset.real_estate.area.final_value = indexedLandFields.area;
    asset.real_estate.area.source = 'OCR_INDEXED_ASSET_TEXT';
    asset.real_estate.area.confidence = Math.max(Number(asset.real_estate.area.confidence || 0), 0.86);
  }
  if (indexedLandFields.land_address && (!asset.real_estate.land_address.final_value || isBetterLandAddress_(asset.real_estate.land_address.final_value, indexedLandFields.land_address))) {
    asset.real_estate.land_address.ai_value = indexedLandFields.land_address;
    asset.real_estate.land_address.final_value = indexedLandFields.land_address;
    asset.real_estate.land_address.source = 'OCR_INDEXED_ASSET_TEXT';
    asset.real_estate.land_address.confidence = Math.max(Number(asset.real_estate.land_address.confidence || 0), 0.86);
  }
  if (indexedLandFields.usage_term && shouldReplaceUsageTerm_(asset.real_estate.usage_term, indexedLandFields.usage_term)) {
    asset.real_estate.usage_term.ai_value = indexedLandFields.usage_term;
    asset.real_estate.usage_term.final_value = indexedLandFields.usage_term;
    asset.real_estate.usage_term.source = 'OCR_INDEXED_ASSET_TEXT';
    asset.real_estate.usage_term.confidence = Math.max(Number(asset.real_estate.usage_term.confidence || 0), 0.86);
  }
  if (indexedLandFields.usage_purpose && shouldReplaceSimpleOcrField_(asset.real_estate.usage_purpose, indexedLandFields.usage_purpose)) {
    asset.real_estate.usage_purpose.ai_value = indexedLandFields.usage_purpose;
    asset.real_estate.usage_purpose.final_value = indexedLandFields.usage_purpose;
    asset.real_estate.usage_purpose.source = 'OCR_INDEXED_ASSET_TEXT';
    asset.real_estate.usage_purpose.confidence = Math.max(Number(asset.real_estate.usage_purpose.confidence || 0), 0.86);
  }
  if (indexedLandFields.usage_origin && shouldReplaceSimpleOcrField_(asset.real_estate.usage_origin, indexedLandFields.usage_origin)) {
    asset.real_estate.usage_origin.ai_value = indexedLandFields.usage_origin;
    asset.real_estate.usage_origin.final_value = indexedLandFields.usage_origin;
    asset.real_estate.usage_origin.source = 'OCR_INDEXED_ASSET_TEXT';
    asset.real_estate.usage_origin.confidence = Math.max(Number(asset.real_estate.usage_origin.confidence || 0), 0.86);
  }
  if (indexedLandFields.attached_assets && asset.real_estate.attached_assets && shouldReplaceSimpleOcrField_(asset.real_estate.attached_assets, indexedLandFields.attached_assets)) {
    asset.real_estate.attached_assets.ai_value = indexedLandFields.attached_assets;
    asset.real_estate.attached_assets.final_value = indexedLandFields.attached_assets;
    asset.real_estate.attached_assets.source = 'OCR_INDEXED_ASSET_TEXT';
    asset.real_estate.attached_assets.confidence = Math.max(Number(asset.real_estate.attached_assets.confidence || 0), 0.86);
  }
  const certificateNote = extractCertificateNoteFromCertificateText_(text);
  if (certificateNote && asset.real_estate.certificate_note && shouldReplaceSimpleOcrField_(asset.real_estate.certificate_note, certificateNote)) {
    asset.real_estate.certificate_note.ai_value = certificateNote;
    asset.real_estate.certificate_note.final_value = certificateNote;
    asset.real_estate.certificate_note.source = 'OCR_CERTIFICATE_NOTE';
    asset.real_estate.certificate_note.confidence = Math.max(Number(asset.real_estate.certificate_note.confidence || 0), 0.86);
  }
  const postIssueChanges = extractPostIssueChangesFromCertificateText_(text);
  if (postIssueChanges.value && shouldReplacePostIssueChanges_(asset.real_estate.post_issue_changes, postIssueChanges.value)) {
    asset.real_estate.post_issue_changes.ai_value = postIssueChanges.value;
    asset.real_estate.post_issue_changes.final_value = postIssueChanges.value;
    asset.real_estate.post_issue_changes.source = 'OCR_POST_ISSUE_CHANGES';
    asset.real_estate.post_issue_changes.confidence = postIssueChanges.status === 'partial_or_unclear' ? 0.55 : 0.82;
  }
  const pairs = extractOwnerIdentityPairs_(text);
  const ownerAddress = extractOwnerAddressFromCertificateText_(text);
  if (ownerAddress && shouldReplaceOwnerListField_(asset.owner_address, ownerAddress, 1)) {
    asset.owner_address.ai_value = ownerAddress;
    asset.owner_address.final_value = ownerAddress;
    asset.owner_address.source = 'OCR_ASSET_TEXT';
    asset.owner_address.confidence = asset.owner_address.confidence || 0.82;
  }
  if (pairs.length) {
    const summary = buildOwnerIdentitySummary_(pairs);
    const pairNames = pairs.map(function(pair) { return pair.name; }).join('; ');
    const pairDocTypes = pairs.map(function(pair) { return pair.document_type; }).join('; ');
    const pairIds = pairs.map(function(pair) { return pair.id_number; }).join('; ');
    asset.owner_identity_pairs = pairs;
    asset.owner_identity_summary.ai_value = summary;
    asset.owner_identity_summary.final_value = summary;
    asset.owner_identity_summary.source = 'OCR_ASSET_TEXT';
    asset.owner_identity_summary.confidence = asset.owner_identity_summary.confidence || 0.9;
    if (shouldReplaceOwnerListField_(asset.owner_name, pairNames, pairs.length)) {
      asset.owner_name.ai_value = pairNames;
      asset.owner_name.final_value = pairNames;
      asset.owner_name.source = 'OCR_ASSET_TEXT';
      asset.owner_name.confidence = asset.owner_name.confidence || 0.9;
    }
    if (shouldReplaceOwnerListField_(asset.owner_id_document_type, pairDocTypes, pairs.length)) {
      asset.owner_id_document_type.ai_value = pairDocTypes;
      asset.owner_id_document_type.final_value = pairDocTypes;
    }
    asset.owner_id_document_type.source = 'OCR_ASSET_TEXT';
    asset.owner_id_document_type.confidence = asset.owner_id_document_type.confidence || 0.9;
    if (shouldReplaceOwnerListField_(asset.owner_id_number, pairIds, pairs.length)) {
      asset.owner_id_number.ai_value = pairIds;
      asset.owner_id_number.final_value = pairIds;
    }
    asset.owner_id_number.source = 'OCR_ASSET_TEXT';
    asset.owner_id_number.confidence = asset.owner_id_number.confidence || 0.9;
    return;
  }
  const ids = extractVietnamPersonalDocumentNumbers_(text);
  if (ids.length && !asset.owner_id_number.final_value) {
    asset.owner_id_number.ai_value = ids.join('; ');
    asset.owner_id_number.final_value = ids.join('; ');
    asset.owner_id_number.source = 'OCR_ASSET_TEXT';
    asset.owner_id_number.confidence = asset.owner_id_number.confidence || 0.78;
  }
}

function shouldReplaceCertificateTitleFromOcr_(field, extractedTitle) {
  if (!field || !extractedTitle) return Boolean(extractedTitle);
  if (field.manual_value) return false;
  const current = String(field.final_value || field.ai_value || '').trim();
  if (!current) return true;
  if (isBadCertificateTitleForMerge_(current)) return true;
  return isShortCertificateTitleForReviewRepair_(current, extractedTitle);
}

function isBadCertificateTitleForMerge_(value) {
  const normalized = normalizeCertificateTitleSearchText_(value);
  if (!normalized) return false;
  if (isCertificateWarningLineForMerge_(normalized)) return true;
  if (normalized.indexOf('giay chung nhan') >= 0 && normalized.indexOf('quyen su dung dat') < 0 && normalized.indexOf('quyen so huu nha o') < 0) return true;
  return normalized.length > 180 && normalized.indexOf('giay chung nhan') >= 0;
}

function shouldReplaceOwnerListField_(field, newValue, expectedCount) {
  if (!field || !newValue) return false;
  if (field.manual_value) return false;
  const current = String(field.final_value || field.ai_value || '').trim();
  if (!current) return true;
  const currentCount = current.split(';').map(function(v) { return v.trim(); }).filter(Boolean).length;
  return expectedCount > currentCount;
}

function extractRealEstateIndexedLandFields_(text) {
  const selected = selectBestLandPlotText_(text);
  const block = selected.text;
  const items = extractIndexedCertificateItems_(block || text);
  const source = block || text;
  if (selected.layout === 'gcn_qsdd_qsh_tsglvd_page_1' && normalizeCertificateIndexLine_(source).indexOf('2 thong tin thua dat') >= 0) {
    return extractNewA4RealEstateLandFields_(source, selected);
  }
  const semantic = {
    land_plot_number: findSemanticLandFieldValue_(source, ['thua dat so']),
    map_sheet_number: findSemanticLandFieldValue_(source, ['to ban do so']),
    land_address: findSemanticLandFieldValue_(source, ['dia chi']),
    area: findSemanticLandFieldValue_(source, ['dien tich']),
    usage_form: findSemanticLandFieldValue_(source, ['hinh thuc su dung']),
    usage_purpose: findSemanticLandFieldValue_(source, ['muc dich su dung']),
    usage_term: findSemanticLandFieldValue_(source, ['thoi han su dung']),
    usage_origin: findSemanticLandFieldValue_(source, ['nguon goc su dung'])
  };
  return {
    land_plot_number: extractLandPlotNumberFromIndexedValue_(semantic.land_plot_number || items.a || ''),
    map_sheet_number: extractMapSheetNumberFromIndexedValue_(semantic.map_sheet_number || items.a || ''),
    land_address: cleanupIndexedCertificateValue_(semantic.land_address || items.b || '') || extractDislocatedLandAddressFromBlock_(source),
    area: normalizeRealEstateAreaValue_(cleanupIndexedCertificateValue_(semantic.area || items.c || '')) || extractRealEstateArea_(source),
    usage_form: normalizeRealEstateUsageForm_(cleanupIndexedCertificateValue_(semantic.usage_form || '')),
    usage_purpose: cleanupIndexedCertificateValue_(semantic.usage_purpose || ''),
    usage_term: normalizeRealEstateUsageTerm_(cleanupIndexedCertificateValue_(semantic.usage_term || '')),
    usage_origin: cleanupUsageOriginCertificateValue_(semantic.usage_origin || ''),
    _quality: selected
  };
}

function extractNewA4RealEstateLandFields_(source, selected) {
  const landSection = extractNewA4LandSection_(source) || source;
  const semantic = {
    land_plot_number: findSemanticLandFieldValue_(landSection, ['thua dat so']),
    map_sheet_number: findSemanticLandFieldValue_(landSection, ['to ban do so']),
    land_address: findSemanticLandFieldValue_(landSection, ['dia chi']),
    area: findSemanticLandFieldValue_(landSection, ['dien tich']),
    land_type: findSemanticLandFieldValue_(landSection, ['loai dat']),
    usage_form: findSemanticLandFieldValue_(landSection, ['hinh thuc su dung']),
    usage_term: findSemanticLandFieldValue_(landSection, ['thoi han su dung']),
    attached_assets: findSemanticLandFieldValue_(source, ['thong tin tai san gan lien voi dat'])
  };
  return {
    land_plot_number: extractLandPlotNumberFromIndexedValue_(semantic.land_plot_number || ''),
    map_sheet_number: extractMapSheetNumberFromIndexedValue_(semantic.map_sheet_number || semantic.land_plot_number || ''),
    land_address: cleanupIndexedCertificateValue_(semantic.land_address || ''),
    area: normalizeRealEstateAreaValue_(cleanupIndexedCertificateValue_(semantic.area || '')) || extractRealEstateArea_(source),
    usage_form: normalizeRealEstateUsageForm_(cleanupIndexedCertificateValue_(semantic.usage_form || '')),
    usage_purpose: cleanupIndexedCertificateValue_(semantic.land_type || ''),
    usage_term: normalizeRealEstateUsageTerm_(cleanupIndexedCertificateValue_(semantic.usage_term || '')),
    usage_origin: '',
    attached_assets: cleanupIndexedCertificateValue_(semantic.attached_assets || ''),
    _quality: selected
  };
}

function extractNewA4LandSection_(source) {
  const compact = String(source || '').replace(/\r?\n+/g, ' ').replace(/\s+/g, ' ').trim();
  const normalized = removeVietnameseAccents_(compact).toLowerCase();
  const startMatch = normalized.match(/(?:^|\s)2\s*[\).:]?\s*thong\s+tin\s+thua\s+dat/);
  if (!startMatch) return '';
  const start = startMatch.index;
  const tail = normalized.slice(start + startMatch[0].length);
  const endMatch = tail.match(/(?:^|\s)3\s*[\).:]?\s*thong\s+tin\s+tai\s+san\s+gan\s+lien\s+voi\s+dat/);
  const end = endMatch ? start + startMatch[0].length + endMatch.index : compact.length;
  return compact.slice(start, end > start ? end : compact.length).trim();
}

function selectBestLandPlotText_(text) {
  const candidates = buildLandPlotTextCandidates_(text);
  let best = { text: extractLandPlotIndexedBlock_(text), score: 0, trusted: false, reason: 'legacy_block', layout: 'gcn_qsdd_qsh_nha_o_va_tsk_land' };
  best.score = scoreLandPlotTextCandidate_(best.text);
  candidates.forEach(function(candidate) {
    const score = scoreLandPlotTextCandidate_(candidate.text);
    if (score > best.score) {
      best = {
        text: candidate.text,
        score: score,
        trusted: score >= 6,
        reason: candidate.reason,
        layout: candidate.layout || classifyLandCertificatePageText_(candidate.text).layout
      };
    }
  });
  best.trusted = best.score >= 6;
  if (!best.text && String(text || '').trim()) {
    return { text: '', score: 0, trusted: false, reason: 'no_land_plot_block' };
  }
  return best;
}

function buildLandPlotTextCandidates_(text) {
  const source = String(text || '');
  const markedCandidates = extractLandOcrRegionMarkedTexts_(source);
  if (markedCandidates.length) return markedCandidates;
  const normalizedLines = source.split(/\r?\n/).map(function(line) {
    return {
      raw: line,
      normalized: normalizeCertificateIndexLine_(line)
    };
  });
  const candidates = [];
  for (let i = 0; i < normalizedLines.length; i++) {
    const line = normalizedLines[i].normalized;
    const isOldAnchor = line.indexOf('ii thua dat') >= 0 || line.indexOf('1 thua dat') >= 0 || line.indexOf('thua dat so') >= 0;
    const isNewA4Anchor = line.indexOf('2 thong tin thua dat') >= 0;
    if (!isOldAnchor && !isNewA4Anchor) continue;
    const out = [];
    for (let j = i; j < normalizedLines.length; j++) {
      const current = normalizedLines[j].normalized;
      if (j > i && /^(?:iii|iv)\s+/.test(current)) break;
      if (j > i && current.indexOf('iv nhung thay doi') >= 0) break;
      if (j > i && current.indexOf('4 so do thua dat') >= 0) break;
      out.push(normalizedLines[j].raw);
      if (isOldAnchor && j > i && /^(?:6|ghi chu)\b/.test(current) && out.length > 3) break;
      if (isNewA4Anchor && j > i && current.indexOf('3 thong tin tai san') >= 0 && out.length > 3) {
        if (j + 1 >= normalizedLines.length) break;
      }
    }
    candidates.push({
      text: out.join('\n'),
      reason: 'line_anchor_' + i,
      layout: isNewA4Anchor ? 'gcn_qsdd_qsh_tsglvd_page_1' : classifyOldStyleLandLayout_(out.join('\n'))
    });
  }
  const compact = source.replace(/\r?\n+/g, ' ').replace(/\s+/g, ' ').trim();
  const normalized = removeVietnameseAccents_(compact).toLowerCase();
  ['ii thua dat', '1 thua dat', 'thua dat so', '2 thong tin thua dat'].forEach(function(anchor) {
    const index = normalized.indexOf(anchor);
    if (index < 0) return;
    candidates.push({
      text: compact,
      reason: 'compact_anchor_' + anchor,
      layout: anchor === '2 thong tin thua dat' ? 'gcn_qsdd_qsh_tsglvd_page_1' : classifyOldStyleLandLayout_(compact)
    });
  });
  return candidates;
}

function extractLandOcrRegionMarkedTexts_(text) {
  const candidates = [];
  const nonFullCandidates = [];
  const marker = /\[LAND_OCR_REGION\s+([^\]]*)\]([\s\S]*?)\[\/LAND_OCR_REGION\]/g;
  let match;
  while ((match = marker.exec(String(text || ''))) !== null) {
    const attrs = parseLandOcrMarkerAttrs_(match[1]);
    const value = String(match[2] || '').trim();
    if (!value) continue;
    const layout = attrs.layout || classifyLandCertificatePageText_(value).layout;
    if (!isLandDetailRegionLayout_(layout, value)) continue;
    candidates.push({
      text: value,
      reason: 'vision_region_' + (attrs.region || ''),
      layout: layout
    });
    if (attrs.region && attrs.region !== 'full') {
      nonFullCandidates.push(candidates[candidates.length - 1]);
    }
  }
  return nonFullCandidates.length ? nonFullCandidates : candidates;
}

function parseLandOcrMarkerAttrs_(value) {
  const out = {};
  String(value || '').replace(/([a-z_]+)=([^\s\]]+)/ig, function(match, key, val) {
    out[key] = val;
    return match;
  });
  return out;
}

function isLandDetailRegionLayout_(layout, value) {
  if (layout === 'gcn_qsdd_land' ||
      layout === 'gcn_qsdd_qsh_nha_o_va_tsk_land' ||
      layout === 'gcn_qsdd_qsh_tsglvd_page_1') return true;
  const normalized = normalizeCertificateIndexLine_(value);
  return normalized.indexOf('ii thua dat') >= 0 ||
    normalized.indexOf('1 thua dat') >= 0 ||
    normalized.indexOf('2 thong tin thua dat') >= 0 ||
    normalized.indexOf('thua dat so') >= 0;
}

function classifyLandCertificatePageText_(value) {
  const normalized = removeVietnameseAccents_(String(value || '')).toLowerCase().replace(/[.:)\-]+/g, ' ').replace(/\s+/g, ' ').trim();
  let best = { layout: 'unknown', score: 0 };
  const scores = {
    gcn_qsdd_cover: 0,
    gcn_qsdd_land: 0,
    gcn_qsdd_change: 0,
    gcn_qsdd_qsh_nha_o_va_tsk_cover: 0,
    gcn_qsdd_qsh_nha_o_va_tsk_land: 0,
    gcn_qsdd_qsh_nha_o_va_tsk_change: 0,
    gcn_qsdd_qsh_tsglvd_page_1: 0,
    gcn_qsdd_qsh_tsglvd_page_2: 0
  };
  const hasCertificateTitle = normalized.indexOf('giay chung nhan') >= 0;
  const hasHouseOtherAssetsTitle = normalized.indexOf('quyen so huu nha o') >= 0 || normalized.indexOf('tai san khac gan lien voi dat') >= 0;
  const hasAttachedAssetsTitle = normalized.indexOf('quyen so huu tai san gan lien voi dat') >= 0 && !hasHouseOtherAssetsTitle;
  if (hasCertificateTitle && !hasHouseOtherAssetsTitle && !hasAttachedAssetsTitle) scores.gcn_qsdd_cover += 4;
  if (hasCertificateTitle && hasHouseOtherAssetsTitle) scores.gcn_qsdd_qsh_nha_o_va_tsk_cover += 4;
  if (hasCertificateTitle && hasAttachedAssetsTitle) scores.gcn_qsdd_qsh_tsglvd_page_1 += 2;
  if (/\b(?:co|dh|aa)\s*\d{5,}\b/i.test(normalized)) {
    scores.gcn_qsdd_cover += 1;
    scores.gcn_qsdd_qsh_nha_o_va_tsk_cover += 1;
  }
  if (normalized.indexOf('ii thua dat') >= 0 || normalized.indexOf('1 thua dat') >= 0) scores[classifyOldStyleLandLayout_(normalized)] += 3;
  if (normalized.indexOf('nguon goc su dung') >= 0) scores[classifyOldStyleLandLayout_(normalized)] += 1;
  if (normalized.indexOf('iii so do') >= 0 || normalized.indexOf('iv nhung thay doi') >= 0 || normalized.indexOf('noi dung thay doi') >= 0) scores[classifyOldStyleChangeLayout_(normalized)] += 6;
  if (normalized.indexOf('2 thong tin thua dat') >= 0) scores.gcn_qsdd_qsh_tsglvd_page_1 += 4;
  if (normalized.indexOf('loai dat') >= 0) scores.gcn_qsdd_qsh_tsglvd_page_1 += 2;
  if (normalized.indexOf('3 thong tin tai san gan lien voi dat') >= 0) scores.gcn_qsdd_qsh_tsglvd_page_1 += 1;
  if (normalized.indexOf('4 so do thua dat') >= 0) scores.gcn_qsdd_qsh_tsglvd_page_2 += 3;
  if (normalized.indexOf('5 ghi chu') >= 0 || normalized.indexOf('6 nhung thay doi') >= 0) scores.gcn_qsdd_qsh_tsglvd_page_2 += 2;
  Object.keys(scores).forEach(function(layout) {
    if (scores[layout] > best.score) best = { layout: layout, score: scores[layout] };
  });
  return best;
}

function classifyOldStyleLandLayout_(value) {
  const normalized = removeVietnameseAccents_(String(value || '')).toLowerCase().replace(/[.:)\-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (normalized.indexOf('quyen so huu nha o') >= 0 || normalized.indexOf('tai san khac gan lien voi dat') >= 0 || normalized.indexOf('nha o va tai san khac') >= 0) {
    return 'gcn_qsdd_qsh_nha_o_va_tsk_land';
  }
  if (normalized.indexOf('giay chung nhan quyen su dung dat') >= 0 && normalized.indexOf('quyen so huu') < 0) {
    return 'gcn_qsdd_land';
  }
  return 'gcn_qsdd_qsh_nha_o_va_tsk_land';
}

function classifyOldStyleChangeLayout_(value) {
  const normalized = removeVietnameseAccents_(String(value || '')).toLowerCase().replace(/[.:)\-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (normalized.indexOf('giay chung nhan quyen su dung dat') >= 0 && normalized.indexOf('quyen so huu') < 0) return 'gcn_qsdd_change';
  return 'gcn_qsdd_qsh_nha_o_va_tsk_change';
}

function isNewA4LandCertificateText_(value) {
  const normalized = removeVietnameseAccents_(String(value || '')).toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  return normalized.indexOf('quyen so huu tai san gan lien voi dat') >= 0 ||
    normalized.indexOf('2 thong tin thua dat') >= 0 && normalized.indexOf('3 thong tin tai san gan lien voi dat') >= 0 ||
    classifyLandCertificatePageText_(value).layout === 'gcn_qsdd_qsh_tsglvd_page_1';
}

function scoreLandPlotTextCandidate_(value) {
  const normalized = removeVietnameseAccents_(String(value || '')).toLowerCase().replace(/\s+/g, ' ').trim();
  if (!normalized) return 0;
  const classified = classifyLandCertificatePageText_(value);
  let score = 0;
  if (classified.layout === 'gcn_qsdd_qsh_tsglvd_page_1') score += classified.score;
  if (normalized.indexOf('ii thua dat') >= 0) score += 2;
  if (normalized.indexOf('2 thong tin thua dat') >= 0) score += 3;
  if (normalized.indexOf('1 thua dat') >= 0) score += 2;
  if (normalized.indexOf('thua dat so') >= 0) score += 2;
  if (normalized.indexOf('to ban do') >= 0) score += 1;
  if (normalized.indexOf('dien tich') >= 0) score += 1;
  if (normalized.indexOf('loai dat') >= 0) score += 1;
  if (normalized.indexOf('hinh thuc su dung') >= 0) score += 1;
  if (normalized.indexOf('muc dich su dung') >= 0) score += 1;
  if (normalized.indexOf('thoi han su dung') >= 0) score += 1;
  if (normalized.indexOf('nguon goc su dung') >= 0) score += 1;
  if (normalized.indexOf('dia chi thuong tru') >= 0) score -= 3;
  if (normalized.indexOf('giay chung nhan') >= 0 && normalized.indexOf('ii thua dat') < 0) score -= 2;
  if (normalized.indexOf('iv nhung thay doi') >= 0) score -= 1;
  return score;
}

function findSemanticLandFieldValue_(text, normalizedAliases) {
  const source = String(text || '').replace(/\r?\n+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!source) return '';
  const normalized = removeVietnameseAccents_(source).toLowerCase();
  const labelStarts = collectSemanticLandLabelStarts_(normalized);
  let best = null;
  (normalizedAliases || []).forEach(function(alias) {
    const label = removeVietnameseAccents_(alias).toLowerCase();
    const index = normalized.indexOf(label);
    if (index < 0) return;
    if (!best || index < best.index) best = { index: index, length: label.length };
  });
  if (!best) return '';
  let start = best.index + best.length;
  while (start < source.length && /[\s:;.,)\-]/.test(source.charAt(start))) start++;
  let end = source.length;
  labelStarts.forEach(function(pos) {
    if (pos > start && pos < end) end = pos;
  });
  const tail = normalized.slice(start);
  const boundary = tail.search(/(?:^|\s)(?:2|3|4|5|6|iv)\s*[\).:]\s+/i);
  if (boundary >= 0 && start + boundary < end) end = start + boundary;
  return cleanupSemanticLandFieldValue_(source.slice(start, end));
}

function collectSemanticLandLabelStarts_(normalizedText) {
  const labels = [
    'thua dat so',
    'to ban do so',
    'dia chi',
    'dien tich',
    'loai dat',
    'hinh thuc su dung',
    'muc dich su dung',
    'thoi han su dung',
    'nguon goc su dung',
    'thong tin tai san gan lien voi dat',
    'bang chu'
  ];
  const starts = [];
  labels.forEach(function(label) {
    let from = 0;
    while (from < normalizedText.length) {
      const index = normalizedText.indexOf(label, from);
      if (index < 0) break;
      starts.push(index);
      from = index + label.length;
    }
  });
  return starts.sort(function(a, b) { return a - b; });
}

function cleanupSemanticLandFieldValue_(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s:;.,)\-]+/, '')
    .replace(/\s+(?:dia\s*chi|loai\s*dat|hinh\s*thuc\s*su\s*dung|muc\s*dich\s*su\s*dung|thoi\s*han\s*su\s*dung|nguon\s*goc\s*su\s*dung|thong\s*tin\s*tai\s*san\s*gan\s*lien\s*voi\s*dat)\s*[:.-]?.*$/i, '')
    .replace(/(?:^|\s)(?:[a-g]|\u0111)\s*[\).:]?\s*$/i, '')
    .replace(/[\s:;.,)\-]+$/, '')
    .trim();
}

function extractLandPlotIndexedBlock_(text) {
  const lines = String(text || '').split(/\r?\n/);
  const out = [];
  let inBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const normalized = normalizeCertificateIndexLine_(lines[i]);
    if (!inBlock && (
      normalized.indexOf('1 thua dat') >= 0 ||
      normalized.indexOf('thua dat') >= 0
    )) {
      inBlock = true;
      out.push(lines[i]);
      continue;
    }
    if (inBlock && i > 0 && /^(?:2|ii)\s*[\).:\-]?\s+/.test(normalized)) break;
    if (inBlock) out.push(lines[i]);
  }
  return out.join('\n');
}

function extractIndexedCertificateItems_(text) {
  const items = {};
  const order = [];
  const regex = /(^|\n|\s)([a-g]|Ä‘|d)\s*[\).:]\s*/gi;
  const matches = [];
  let match;
  while ((match = regex.exec(String(text || ''))) !== null) {
    const markerStart = match.index + match[1].length;
    matches.push({
      key: normalizeCertificateItemKey_(match[2]),
      markerStart: markerStart,
      valueStart: markerStart + match[0].slice(match[1].length).length
    });
  }
  for (let i = 0; i < matches.length; i++) {
    const end = i + 1 < matches.length ? matches[i + 1].markerStart : String(text || '').length;
    const rawValue = String(text || '').slice(matches[i].valueStart, end);
    if (!items[matches[i].key]) {
      items[matches[i].key] = rawValue;
      order.push(matches[i].key);
    }
  }
  return items;
}

function normalizeCertificateItemKey_(key) {
  const normalized = removeVietnameseAccents_(String(key || '').toLowerCase());
  const raw = String(key || '').toLowerCase();
  return normalized === 'd' && raw === 'Ä‘' ? 'dd' : normalized;
}

function normalizeCertificateIndexLine_(line) {
  return removeVietnameseAccents_(String(line || ''))
    .toLowerCase()
    .replace(/[.:)\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanupIndexedCertificateValue_(value) {
  return String(value || '')
    .replace(/\r?\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+(?:s\u1ed1|so)\s+v\u00e0o\s+s\u1ed5\s+c\u1ea5p\s+gcn\s*:?.*$/i, '')
    .replace(/\s+so\s+vao\s+so\s+cap\s+gcn\s*:?.*$/i, '')
    .replace(/^(?:\u0111\u1ecba\s*ch\u1ec9|dia\s*chi|dia chi|address|hinh\s*thuc\s*su\s*dung|muc\s*dich\s*su\s*dung|thoi\s*han\s*su\s*dung|nguon\s*goc\s*su\s*dung)\s*[:.-]?\s*/i, '')
    .replace(/[;,.:\-\s]+$/g, '')
    .trim();
}

function cleanupUsageOriginCertificateValue_(value) {
  return accentUsageOriginCertificateValue_(cleanupIndexedCertificateValue_(value)
    .replace(/\s+(?:2|3|4|5|6)\s*[\).:]\s*(?:nh[aÃ ]\s*[oá»Ÿ]|nha\s*o|c[oÃ´]ng\s*tr[Ã¬i]nh|cong\s*trinh|r[Æ°á»«]ng|rung|c[aÃ¢]y|cay|ghi\s*ch[uÃº]|ghi\s*chu)\b.*$/i, '')
    .replace(/\s+iv\s*[\).:]?\s*nh[uá»¯]ng\s+thay\s+[dÄ‘][oá»•]i.*$/i, '')
    .replace(/\s+iv\s*[\).:]?\s*nhung\s+thay\s+doi.*$/i, '')
    .replace(/[;,.:\-\s]+$/g, '')
    .trim());
}

function accentUsageOriginCertificateValue_(value) {
  var text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  text = text
    .replace(/\bnhan\s+chuyen\s+nhuong\b/ig, 'nh\u1eadn chuy\u1ec3n nh\u01b0\u1ee3ng')
    .replace(/\bduoc\b/ig, '\u0111\u01b0\u1ee3c')
    .replace(/\bnha\s+nuoc\b/ig, 'Nh\u00e0 n\u01b0\u1edbc')
    .replace(/\bco\s+thu\s+tien\s+su\s+dung\s+dat\b/ig, 'c\u00f3 thu ti\u1ec1n s\u1eed d\u1ee5ng \u0111\u1ea5t')
    .replace(/\bc\u00f3\s+thu\s+ti\u1ec1n\s+s\u1eed\s+dung\s+\u0111\u1ea5t\b/ig, 'c\u00f3 thu ti\u1ec1n s\u1eed d\u1ee5ng \u0111\u1ea5t')
    .replace(/\bsu\s+dung\s+dat\b/ig, 's\u1eed d\u1ee5ng \u0111\u1ea5t')
    .replace(/\bs\u1eed\s+dung\s+\u0111\u1ea5t\b/ig, 's\u1eed d\u1ee5ng \u0111\u1ea5t')
    .replace(/\bthu\s+tien\b/ig, 'thu ti\u1ec1n')
    .replace(/\bdat\b/ig, '\u0111\u1ea5t');
  return fixVietnameseUsageWord_(text).replace(/^nh\u1eadn\b/, 'Nh\u1eadn').trim();
}

function fixVietnameseUsageWord_(value) {
  return String(value || '').replace(/s\u1eed\s+dung/ig, 's\u1eed d\u1ee5ng');
}

function extractLandPlotNumberFromIndexedValue_(value) {
  const text = cleanupIndexedCertificateValue_(value);
  const match = text.match(/(?:thá»­a\s*Ä‘áº¥t\s*sá»‘|thua\s*dat\s*so)?\s*:?\s*([0-9A-Z.\/-]+)/i);
  return match ? match[1].trim() : '';
}

function extractMapSheetNumberFromIndexedValue_(value) {
  const text = String(value || '');
  const match = removeVietnameseAccents_(text).match(/to\s+ban\s+do\s+so\s*:?\s*([0-9A-Z.\/-]+)/i);
  if (match) return match[1].trim();
  const direct = text.trim().match(/^([0-9A-Z.\/-]{1,20})$/i);
  return direct ? direct[1].trim() : '';
}

function extractRealEstateArea_(text) {
  const source = String(text || '');
  const indexed = extractIndexedCertificateItems_(extractLandPlotIndexedBlock_(source) || source);
  const cValue = cleanupIndexedCertificateValue_(indexed.c || '');
  const fromC = normalizeRealEstateAreaValue_(cValue);
  if (fromC) return fromC;
  const direct = source.match(/(?:Diá»‡n\s*tÃ­ch|Dien\s*tich)\s*:?\s*([0-9]+(?:[,.][0-9]+)?\s*m(?:2|Â²)?)/i);
  return direct ? normalizeRealEstateAreaValue_(direct[1]) : '';
}

function normalizeRealEstateAreaValue_(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  const match = text.match(/([0-9]+(?:[,.][0-9]+)?)\s*m(?:2|Â²)?/i);
  return match ? match[1] + ' mÂ²' : '';
}

function shouldReplaceAreaValue_(field, candidate) {
  if (!field || !candidate || field.manual_value) return false;
  const current = String(field.final_value || field.ai_value || '').trim();
  if (!current) return true;
  const normalized = normalizeRealEstateAreaValue_(current);
  return Boolean(normalized && normalized !== current);
}

function shouldReplaceSimpleOcrField_(field, candidate) {
  if (!field || !candidate || field.manual_value) return false;
  const current = String(field.final_value || field.ai_value || '').trim();
  if (!current) return true;
  const currentNorm = removeVietnameseAccents_(current).toLowerCase().replace(/\s+/g, ' ').trim();
  const candidateNorm = removeVietnameseAccents_(candidate).toLowerCase().replace(/\s+/g, ' ').trim();
  if (currentNorm === candidateNorm && current !== candidate) return true;
  if (currentNorm.indexOf(candidateNorm) >= 0 && current.length > candidate.length + 12) return true;
  return false;
}

function shouldReplaceRegistryNumber_(field, candidate, certificateNumber) {
  if (!field || !candidate || field.manual_value) return false;
  const current = String(field.final_value || field.ai_value || '').trim();
  if (!current) return true;
  if (isCertificateNumberLike_(current)) return true;
  if (certificateNumber && normalizeCertificateCodeValue_(current) === normalizeCertificateCodeValue_(certificateNumber)) return true;
  const currentNorm = normalizeRegistryCodeValue_(current);
  return currentNorm !== current && currentNorm === candidate;
}

function isCertificateNumberLike_(value) {
  return /^[A-Z][A-Z0O]\d{6}$/i.test(normalizeCertificateSerialOcr_(value));
}

function shouldReplacePostIssueChanges_(field, candidate) {
  if (!field || !candidate || field.manual_value) return false;
  const current = String(field.final_value || field.ai_value || '').trim();
  if (!current) return true;
  const currentNorm = removeVietnameseAccents_(current).toLowerCase();
  if (currentNorm === 'khong' || currentNorm === 'khong co') return true;
  if (currentNorm.indexOf('khong doc ro') >= 0) return true;
  return false;
}

function extractCertificateNoteFromCertificateText_(text) {
  const marked = extractLandOcrMarkedRegionTexts_(text, 'LAND_OCR_REGION');
  const sources = marked.length ? marked.concat([text]) : [text];
  for (let s = 0; s < sources.length; s++) {
    const lines = String(sources[s] || '').split(/\r?\n/)
      .map(function(line) { return String(line || '').replace(/\s+/g, ' ').trim(); })
      .filter(Boolean);
    for (let i = 0; i < lines.length; i++) {
      const normalized = removeVietnameseAccents_(lines[i]).toLowerCase().replace(/\s+/g, ' ').trim();
      const label = normalized.match(/^(?:5|6)\s*[\).:]?\s*ghi chu\s*[:.-]?\s*/);
      if (!label) continue;
      const content = [lines[i].slice(label[0].length)];
      for (let j = i + 1; j < lines.length; j++) {
        const next = removeVietnameseAccents_(lines[j]).toLowerCase().replace(/\s+/g, ' ').trim();
        if (/^(?:6|iv)\s*[\).:]?\s*nhung thay doi/.test(next) ||
            next.indexOf('so vao so') >= 0 ||
            next.indexOf('nguoi duoc cap giay chung nhan') >= 0) break;
        content.push(lines[j]);
      }
      const value = cleanCertificateNoteValue_(content.join(' '));
      if (value) return value;
    }
  }
  return '';
}

function cleanCertificateNoteValue_(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/\s+(?:6|iv)\s*[\).:]?\s*nhung\s+thay\s+doi.*$/i, '')
    .replace(/\s+so\s+vao\s+so\s+cap\s+(?:gcn|giay\s+chung\s+nhan).*$/i, '')
    .replace(/^[\s:;,.]+|[\s:;,.]+$/g, '')
    .trim();
}

function extractPostIssueChangesFromCertificateText_(text) {
  const markedChange = extractPostIssueChangesFromMarkedRegions_(text);
  if (markedChange) return markedChange;
  const lines = String(text || '').split(/\r?\n/)
    .map(function(line) { return String(line || '').replace(/\s+/g, ' ').trim(); })
    .filter(Boolean);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const normalized = removeVietnameseAccents_(lines[i]).toLowerCase();
    if (normalized.indexOf('iv') >= 0 && normalized.indexOf('nhung thay doi') >= 0) {
      start = i;
      break;
    }
  }
  if (start < 0) return { value: 'KhÃ´ng cÃ³', status: 'absent' };
  const content = [];
  for (let j = start + 1; j < lines.length; j++) {
    const line = lines[j];
    const normalizedLine = removeVietnameseAccents_(line).toLowerCase();
    if (normalizedLine.indexOf('noi dung thay doi') >= 0 ||
        normalizedLine.indexOf('xac nhan cua co quan') >= 0 ||
        normalizedLine.indexOf('co tham quyen') >= 0 ||
        normalizedLine.indexOf('giam doc') >= 0 ||
        normalizedLine.indexOf('so tai nguyen') >= 0) {
      continue;
    }
    if (normalizedLine.indexOf('so vao so') >= 0 ||
        normalizedLine.indexOf('nguoi duoc cap giay chung nhan') >= 0) break;
    if (/^[ivx]+\s*[\).]/i.test(normalizedLine) && content.length) break;
    content.push(line);
  }
  const cleaned = cleanPostIssueChangesCandidate_(content.join('\n'));
  if (!cleaned) return { value: 'KhÃ´ng Ä‘á»c rÃµ, Ä‘á» nghá»‹ kiá»ƒm tra ká»¹', status: 'partial_or_unclear' };
  return {
    value: cleaned,
    status: isPostIssueChangesUnclear_(cleaned) ? 'partial_or_unclear' : 'readable'
  };
}

function extractPostIssueChangesFromMarkedRegions_(text) {
  const source = String(text || '');
  if (source.indexOf('[LAND_OCR_REGION') < 0) return null;
  const regions = [];
  const marker = /\[LAND_OCR_REGION\s+([^\]]*)\]([\s\S]*?)\[\/LAND_OCR_REGION\]/g;
  let match;
  while ((match = marker.exec(source)) !== null) {
    const attrs = parseLandOcrMarkerAttrs_(match[1]);
    const value = String(match[2] || '').trim();
    if (!value) continue;
    const layout = attrs.layout || classifyLandCertificatePageText_(value).layout;
    const normalized = normalizeCertificateIndexLine_(value);
    if (layout === 'gcn_qsdd_change' ||
        layout === 'gcn_qsdd_qsh_nha_o_va_tsk_change' ||
        layout === 'gcn_qsdd_qsh_tsglvd_page_2' ||
        normalized.indexOf('iv nhung thay doi') >= 0 ||
        normalized.indexOf('noi dung thay doi') >= 0) {
      regions.push(value);
    }
  }
  if (!regions.length) return { value: 'Kh\u00f4ng \u0111\u1ecdc r\u00f5, \u0111\u1ec1 ngh\u1ecb ki\u1ec3m tra k\u1ef9', status: 'partial_or_unclear' };
  const combined = regions.join('\n');
  const withoutMarkers = combined.replace(/\[LAND_OCR_REGION[^\]]*\]|\[\/LAND_OCR_REGION\]/g, '');
  return extractPostIssueChangesFromPlainText_(withoutMarkers);
}

function extractPostIssueChangesFromPlainText_(text) {
  const lines = String(text || '').split(/\r?\n/)
    .map(function(line) { return String(line || '').replace(/\s+/g, ' ').trim(); })
    .filter(Boolean);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const normalized = removeVietnameseAccents_(lines[i]).toLowerCase();
    if ((normalized.indexOf('iv') >= 0 || /^\s*6\s*[\).:]?/.test(normalized)) &&
        normalized.indexOf('nhung thay doi') >= 0) {
      start = i;
      break;
    }
  }
  if (start < 0) return { value: 'Kh\u00f4ng \u0111\u1ecdc r\u00f5, \u0111\u1ec1 ngh\u1ecb ki\u1ec3m tra k\u1ef9', status: 'partial_or_unclear' };
  const content = [];
  for (let j = start + 1; j < lines.length; j++) {
    const line = lines[j];
    const normalizedLine = removeVietnameseAccents_(line).toLowerCase();
    if (normalizedLine.indexOf('noi dung thay doi') >= 0 ||
        normalizedLine.indexOf('xac nhan cua co quan') >= 0 ||
        normalizedLine.indexOf('co tham quyen') >= 0 ||
        normalizedLine.indexOf('giam doc') >= 0 ||
        normalizedLine.indexOf('so tai nguyen') >= 0) {
      continue;
    }
    if (normalizedLine.indexOf('so vao so') >= 0 ||
        normalizedLine.indexOf('nguoi duoc cap giay chung nhan') >= 0) break;
    if (/^[ivx]+\s*[\).]/i.test(normalizedLine) && content.length) break;
    content.push(line);
  }
  const cleaned = cleanPostIssueChangesCandidate_(content.join('\n'));
  if (!cleaned) return { value: 'Kh\u00f4ng c\u00f3', status: 'absent' };
  return {
    value: cleaned,
    status: isPostIssueChangesUnclear_(cleaned) ? 'partial_or_unclear' : 'readable'
  };
}

function cleanPostIssueChangesCandidate_(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map(function(line) { return line.replace(/\s+/g, ' ').trim(); })
    .filter(function(line) {
      const normalized = removeVietnameseAccents_(line).toLowerCase();
      if (!normalized) return false;
      if (/^(ngay|thang|nam)\b/.test(normalized)) return false;
      if (normalized.indexOf('nguyen') >= 0 && normalized.indexOf('giam doc') >= 0) return false;
      if (normalized.indexOf('phone') >= 0 || normalized.indexOf('bank') >= 0 || normalized.indexOf('hamdoc') >= 0) return false;
      return true;
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function isPostIssueChangesUnclear_(value) {
  const text = removeVietnameseAccents_(String(value || '')).toLowerCase();
  if (text.indexOf('khong doc ro') >= 0) return true;
  const letters = (text.match(/[a-z]/g) || []).length;
  const digits = (text.match(/[0-9]/g) || []).length;
  if (letters < 20 && digits > 6) return true;
  return /[?]{2,}|\.{3,}/.test(value);
}

function addReviewWarningOnce_(reviewJson, fieldPath, message) {
  reviewJson.validation = reviewJson.validation || {};
  reviewJson.validation.warnings = reviewJson.validation.warnings || [];
  const exists = reviewJson.validation.warnings.some(function(item) {
    return item && item.field_path === fieldPath && item.message === message;
  });
  if (!exists) {
    reviewJson.validation.warnings.push({
      field_path: fieldPath,
      message: message,
      source_file: 'OCR_ASSET_TEXT'
    });
  }
}

function extractDislocatedLandAddressFromBlock_(text) {
  const lines = String(text || '').split(/\r?\n/)
    .map(function(line) { return String(line || '').replace(/\s+/g, ' ').trim(); })
    .filter(Boolean);
  const scored = [];
  for (let i = 0; i < lines.length; i++) {
    if (!isLikelyLandAddressLine_(lines[i])) continue;
    scored.push({ index: i, line: lines[i], score: scoreLandAddressLine_(lines[i]) });
  }
  if (!scored.length) return '';
  const selected = [];
  for (let j = 0; j < scored.length; j++) {
    const item = scored[j];
    const nearSelected = selected.length && Math.abs(item.index - selected[selected.length - 1].index) <= 6;
    if (item.score < 2 && !(nearSelected && item.score >= 1)) continue;
    if (!selected.length || nearSelected) {
      selected.push(item);
    }
  }
  const best = selected.length ? selected : [scored.sort(function(a, b) { return b.score - a.score; })[0]];
  const address = best
    .sort(function(a, b) { return a.index - b.index; })
    .map(function(item) { return item.line; })
    .join(' ');
  return cleanupLandAddressCandidate_(address);
}

function isLikelyLandAddressLine_(line) {
  const normalized = removeVietnameseAccents_(line).toLowerCase();
  if (!normalized || normalized.length < 6) return false;
  if (/^\d+(?:[,.]\d+)?\s*m/.test(normalized)) return false;
  if (/^(?:a|b|c|d|e|g)\s*[\).:]/i.test(line)) return false;
  if (normalized.indexOf('to ban do') >= 0 ||
      normalized.indexOf('so thua') >= 0 ||
      normalized.indexOf('thua dat') >= 0 ||
      normalized.indexOf('dien tich') >= 0) return false;
  return normalized.indexOf('phuong') >= 0 ||
    normalized.indexOf('xa ') >= 0 ||
    normalized.indexOf('thi tran') >= 0 ||
    normalized.indexOf('quan') >= 0 ||
    normalized.indexOf('huyen') >= 0 ||
    normalized.indexOf('thanh pho') >= 0 ||
    normalized.indexOf('tinh') >= 0 ||
    /\s[-â€“â€”]\s/.test(line);
}

function scoreLandAddressLine_(line) {
  const normalized = removeVietnameseAccents_(line).toLowerCase();
  let score = 0;
  ['phuong', 'xa ', 'thi tran', 'quan', 'huyen', 'thanh pho', 'tinh'].forEach(function(token) {
    if (normalized.indexOf(token) >= 0) score++;
  });
  if (/\s[-â€“â€”]\s/.test(line)) score++;
  return score;
}

function cleanupLandAddressCandidate_(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/\b(?:III|II)\s*[.:].*$/i, '')
    .replace(/[;,.:\-\s]+$/g, '')
    .trim();
}

function extractOwnerIdentityPairs_(text) {
  const pairs = [];
  const lines = String(text || '').split(/\n+/);
  lines.forEach(function(line) {
    const normalized = removeVietnameseAccents_(line).replace(/\s+/g, ' ').trim();
    const match = normalized.match(/(?:Ong|Ba|Vo|Chong)?\s*[:.-]?\s*([A-Z][A-Z\s]{4,80}?),\s*(?:CCCD|CMND|Can cuoc(?: cong dan)?|so)?\s*[:.-]?\s*(\d{12}|\d{9})\b/i);
    if (match) {
      const name = titleCaseVietnameseName_(match[1]);
      const id = match[2];
      const docType = id.length === 9 ? 'Chung minh nhan dan' : 'Can cuoc cong dan';
      pairs.push({ name: name, document_type: docType, id_number: id });
    }
  });
  return dedupeOwnerIdentityPairs_(pairs);
}

function extractOwnerAddressFromCertificateText_(text) {
  const block = extractOwnerCertificateBlock_(text);
  if (isNewA4LandCertificateText_(text) && !ownerCertificateBlockContainsAddress_(block)) return '';
  const lines = String(block || text || '').split(/\n+/);
  for (let i = 0; i < lines.length; i++) {
    const line = String(lines[i] || '').replace(/\s+/g, ' ').trim();
    const match = line.match(/(?:Ã„ÂÃ¡Â»â€¹a\s*chÃ¡Â»â€°|Äá»‹a\s*chá»‰|Dia\s*chi|Address)\s*[:.-]\s*(.+)$/i);
    if (match && match[1]) return cleanupOwnerAddress_(match[1]);
  }
  const compact = lines.map(function(line) {
    return String(line || '').replace(/\s+/g, ' ').trim();
  }).filter(Boolean).join(' ');
  const inline = compact.match(/(?:Ã„ÂÃ¡Â»â€¹a\s*chÃ¡Â»â€°|Äá»‹a\s*chá»‰|Dia\s*chi|Address)\s*[:.-]\s*(.+?)(?=\s+(?:II\.|2\.|ThÃ¡Â»Â­a|Thua|NhÃƒÂ |Nha)\b|$)/i);
  return inline && inline[1] ? cleanupOwnerAddress_(inline[1]) : '';
}

function extractOwnerCertificateBlock_(text) {
  const lines = String(text || '').split(/\n+/);
  const out = [];
  let inBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const normalized = removeVietnameseAccents_(lines[i]).toLowerCase();
    if (!inBlock && (
      normalized.indexOf('nguoi su dung dat') >= 0 ||
      normalized.indexOf('chu so huu nha o') >= 0 ||
      /^\s*i[\s.]/i.test(lines[i])
    )) {
      inBlock = true;
    }
    if (inBlock && i > 0 && (
      /^\s*ii[\s.]/i.test(lines[i]) ||
      normalized.indexOf('2 thong tin thua dat') >= 0 ||
      normalized.indexOf('thong tin thua dat') >= 0 ||
      normalized.indexOf('thua dat so') >= 0
    )) break;
    if (inBlock) out.push(lines[i]);
  }
  return out.join('\n');
}

function ownerCertificateBlockContainsAddress_(block) {
  const normalized = removeVietnameseAccents_(String(block || '')).toLowerCase().replace(/\s+/g, ' ');
  return normalized.indexOf('dia chi') >= 0 || normalized.indexOf('address') >= 0;
}

function cleanupOwnerAddress_(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/[;,.:\-\s]+$/g, '')
    .trim();
}

function dedupeOwnerIdentityPairs_(pairs) {
  const seen = {};
  return (pairs || []).filter(function(pair) {
    const key = pair.id_number || pair.name;
    if (!key || seen[key]) return false;
    seen[key] = true;
    return true;
  });
}

function titleCaseVietnameseName_(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\b\w/g, function(ch) { return ch.toUpperCase(); })
    .replace(/\s+/g, ' ')
    .trim();
}

function buildOwnerIdentitySummary_(pairs) {
  return (pairs || []).map(function(pair) {
    return pair.name + ' - ' + pair.document_type + ' so ' + pair.id_number;
  }).join('; ');
}

function extractCertificateTitle_(text) {
  const known = extractKnownCertificateTitleFromText_(text);
  if (known) return known;
  const extracted = extractCertificateTitleFromOcrForMerge_(text);
  if (extracted) return extracted;
  const clean = removeVietnameseAccents_(String(text || '')).toUpperCase().replace(/\s+/g, ' ');
  if (clean.indexOf('QUYEN SU DUNG DAT QUYEN SO HUU NHA O VA TAI SAN KHAC GAN LIEN VOI DAT') >= 0) {
    return 'Gi\u1ea5y ch\u1ee9ng nh\u1eadn quy\u1ec1n s\u1eed d\u1ee5ng \u0111\u1ea5t, quy\u1ec1n s\u1edf h\u1eefu nh\u00e0 \u1edf v\u00e0 t\u00e0i s\u1ea3n kh\u00e1c g\u1eafn li\u1ec1n v\u1edbi \u0111\u1ea5t';
  }
  if (clean.indexOf('QUYEN SU DUNG DAT QUYEN SO HUU TAI SAN GAN LIEN VOI DAT') >= 0) {
    return 'Gi\u1ea5y ch\u1ee9ng nh\u1eadn quy\u1ec1n s\u1eed d\u1ee5ng \u0111\u1ea5t, quy\u1ec1n s\u1edf h\u1eefu t\u00e0i s\u1ea3n g\u1eafn li\u1ec1n v\u1edbi \u0111\u1ea5t';
  }
  if (clean.indexOf('QUYEN SU DUNG DAT') >= 0) {
    return 'Gi\u1ea5y ch\u1ee9ng nh\u1eadn quy\u1ec1n s\u1eed d\u1ee5ng \u0111\u1ea5t';
  }
  if (clean.indexOf('QUYEN SO HUU NHA O') >= 0) {
    return 'Gi\u1ea5y ch\u1ee9ng nh\u1eadn quy\u1ec1n s\u1edf h\u1eefu nh\u00e0 \u1edf';
  }
  return '';
}

function extractKnownCertificateTitleFromText_(text) {
  const clean = normalizeCertificateTitleSearchText_(text);
  if (!clean) return '';
  if (clean.indexOf('giay chung nhan quyen su dung dat quyen so huu nha o va tai san khac gan lien voi dat') >= 0 ||
      clean.indexOf('giay chung nhan quyen su dung dat va quyen so huu nha o va tai san khac gan lien voi dat') >= 0 ||
      clean.indexOf('quyen su dung dat quyen so huu nha o va tai san khac gan lien voi dat') >= 0) {
    return 'Gi\u1ea5y ch\u1ee9ng nh\u1eadn quy\u1ec1n s\u1eed d\u1ee5ng \u0111\u1ea5t, quy\u1ec1n s\u1edf h\u1eefu nh\u00e0 \u1edf v\u00e0 t\u00e0i s\u1ea3n kh\u00e1c g\u1eafn li\u1ec1n v\u1edbi \u0111\u1ea5t';
  }
  if (clean.indexOf('giay chung nhan quyen su dung dat quyen so huu tai san gan lien voi dat') >= 0 ||
      clean.indexOf('giay chung nhan quyen su dung dat va quyen so huu tai san gan lien voi dat') >= 0 ||
      clean.indexOf('quyen su dung dat quyen so huu tai san gan lien voi dat') >= 0) {
    return 'Gi\u1ea5y ch\u1ee9ng nh\u1eadn quy\u1ec1n s\u1eed d\u1ee5ng \u0111\u1ea5t, quy\u1ec1n s\u1edf h\u1eefu t\u00e0i s\u1ea3n g\u1eafn li\u1ec1n v\u1edbi \u0111\u1ea5t';
  }
  if (clean.indexOf('giay chung nhan quyen su dung dat') >= 0 ||
      clean.indexOf('giay chung nhan qsd dat') >= 0) {
    return 'Gi\u1ea5y ch\u1ee9ng nh\u1eadn quy\u1ec1n s\u1eed d\u1ee5ng \u0111\u1ea5t';
  }
  return '';
}

function normalizeCertificateTitleSearchText_(text) {
  return removeVietnameseAccents_(String(text || ''))
    .toLowerCase()
    .replace(/\b(?:hwuux|hwux|huux)\b/g, 'huu')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractCertificateTitleFromOcrForMerge_(text) {
  const lines = String(text || '').split(/\r?\n/).map(function(line) {
    return line.replace(/\s+/g, ' ').trim();
  }).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    const normalized = removeVietnameseAccents_(lines[i]).toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (normalized.indexOf('giay chung nhan') < 0) continue;
    if (isCertificateWarningLineForMerge_(normalized)) continue;
    const parts = [sliceCertificateTitleStartForMerge_(lines[i])];
    for (let j = i + 1; j < lines.length && parts.length < 5; j++) {
      const next = removeVietnameseAccents_(lines[j]).toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
      if (isCertificateTitleStopLineForMerge_(next)) break;
      if (!isCertificateTitleContinuationLineForMerge_(next)) break;
      parts.push(lines[j]);
    }
    const title = cleanCertificateTitleForMerge_(parts.join(' '));
    const titleText = removeVietnameseAccents_(title).toLowerCase();
    if (title && titleText !== 'giay chung nhan') return title;
  }
  return '';
}

function sliceCertificateTitleStartForMerge_(line) {
  const match = String(line || '').match(/(gi\u1ea5y|giay)\s+(ch\u1ee9ng|chung)\s+(nh\u1eadn|nhan)/i);
  return match ? String(line || '').slice(match.index).trim() : String(line || '').trim();
}

function isCertificateTitleStopLineForMerge_(normalizedLine) {
  return isCertificateWarningLineForMerge_(normalizedLine) ||
    normalizedLine.indexOf('so phat hanh') >= 0 ||
    normalizedLine.indexOf('so vao so') >= 0 ||
    /^so\s+[a-z]{1,5}\s*\d/i.test(normalizedLine) ||
    normalizedLine.indexOf('i nguoi su dung') === 0 ||
    normalizedLine.indexOf('ii thua dat') === 0 ||
    normalizedLine.indexOf('iii so do') === 0 ||
    normalizedLine.indexOf('uy ban nhan dan') >= 0 ||
    /^(?:[ivx]+|[0-9]+)\s/.test(normalizedLine);
}

function isCertificateWarningLineForMerge_(normalizedLine) {
  normalizedLine = String(normalizedLine || '');
  return normalizedLine.indexOf('khong duoc sua chua') >= 0 ||
    normalizedLine.indexOf('tay xoa') >= 0 ||
    normalizedLine.indexOf('bo sung bat ky noi dung') >= 0 ||
    normalizedLine.indexOf('khong phai bao ngay') >= 0 ||
    normalizedLine.indexOf('phai khai bao ngay') >= 0;
}

function isCertificateTitleContinuationLineForMerge_(normalizedLine) {
  if (!normalizedLine) return false;
  if (/^(cong hoa|doc lap|uy ban|bo tai nguyen|so tai nguyen|van phong dang ky)\b/.test(normalizedLine)) return false;
  if (/^(ngay|noi cap|cap ngay|ky ngay|ma vach)\b/.test(normalizedLine)) return false;
  return normalizedLine.length <= 160;
}

function cleanCertificateTitleForMerge_(value) {
  return accentCertificateTitleWordsForMerge_(String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/\s+,/g, ',')
    .replace(/,\s*/g, ', ')
    .replace(/\s+(?:s\u1ed1|so)\s+[A-Z]{1,4}\s*\d.*$/i, '')
    .replace(/\s*\(?\s*(?:S\u1ed1|So)\s+v\u00e0o\s+s\u1ed5.*$/i, '')
    .replace(/^(giay|gi\u1ea5y)\s+chung\s+nhan/i, 'Gi\u1ea5y ch\u1ee9ng nh\u1eadn')
    .trim());
}

function accentCertificateTitleWordsForMerge_(value) {
  const map = {
    'giay': 'gi\u1ea5y', 'chung': 'ch\u1ee9ng', 'nhan': 'nh\u1eadn',
    'quyen': 'quy\u1ec1n', 'su': 's\u1eed', 'dung': 'd\u1ee5ng', 'dat': '\u0111\u1ea5t',
    'so': 's\u1edf', 'huu': 'h\u1eefu', 'nha': 'nh\u00e0', 'o': '\u1edf',
    'hwuux': 'h\u1eefu', 'hwux': 'h\u1eefu', 'huux': 'h\u1eefu',
    'va': 'v\u00e0', 'tai': 't\u00e0i', 'san': 's\u1ea3n', 'khac': 'kh\u00e1c',
    'gan': 'g\u1eafn', 'lien': 'li\u1ec1n', 'voi': 'v\u1edbi'
  };
  let previousKey = '';
  return String(value || '').split(/(\s+|,\s*)/).map(function(token) {
    const key = removeVietnameseAccents_(token).toLowerCase().replace(/[^a-z]/g, '');
    if (!key) return token;
    let replacement = map[key] || '';
    if (key === 'dung' && previousKey !== 'su') replacement = '';
    if (key === 'so' && previousKey !== 'quyen') replacement = '';
    if ((key === 'huu' || key === 'hwuux' || key === 'hwux' || key === 'huux') && previousKey !== 'so') replacement = '';
    if (key === 'o' && previousKey !== 'nha') replacement = '';
    previousKey = key;
    return replacement || token;
  }).join('').replace(/^gi\u1ea5y/, 'Gi\u1ea5y');
}

function extractRealEstateCertificateNumber_(text) {
  text = String(text || '').replace(/\s+/g, ' ');
  const candidates = text.match(/\b[A-Z?]{1,3}\s*[0-9]{6,9}\b/g) || [];
  for (let i = 0; i < candidates.length; i++) {
    const value = normalizeCertificateSerialOcr_(candidates[i].replace(/\s+/g, ' ').trim());
    if (!/^ID\s*\d+/i.test(value)) return normalizeCertificateCodeValue_(value);
  }
  return '';
}

function normalizeCertificateSerialOcr_(value) {
  value = String(value || '').replace(/\s+/g, '').trim();
  const oneLetterZero = value.match(/^([A-Z])0(\d{6})$/i);
  if (oneLetterZero) return oneLetterZero[1].toUpperCase() + 'O' + oneLetterZero[2];
  return value;
}

function shouldReplaceCertificateNumber_(field) {
  if (!field) return true;
  const current = String(field.final_value || field.ai_value || '').trim();
  if (!current) return true;
  const normalizedCurrent = removeVietnameseAccents_(current).toLowerCase().replace(/\s+/g, ' ').trim();
  if (normalizedCurrent === 'khong' || normalizedCurrent === 'khong co' || normalizedCurrent.indexOf('khong ro') >= 0 || normalizedCurrent.indexOf('chua doc') >= 0) return true;
  if (current === 'KhÃ´ng rÃµ, Ä‘á» nghá»‹ sá»­a thá»§ cÃ´ng') return true;
  return isRegistryNumberLike_(current);
}

function isRegistryNumberLike_(value) {
  return /^(?:CS|CT|CN|CH|CL|HX|VP|DC|DL)\s*[0-9][A-Z0-9.\/-]{1,20}$/i.test(String(value || '').replace(/\s+/g, ' ').trim());
}

function normalizeAssetTypeField_(field) {
  if (!field) return;
  const raw = String(field.final_value || field.ai_value || '');
  const normalized = removeVietnameseAccents_(raw).toLowerCase();
  let value = '';
  if (normalized.indexOf('real_estate') >= 0 || normalized.indexOf('bat dong san') >= 0 || normalized.indexOf('land') >= 0 || normalized.indexOf('dat') >= 0) {
    value = '\u0042\u1ea5\u0074 \u0111\u1ed9\u006e\u0067 \u0073\u1ea3\u006e';
  } else if (normalized.indexOf('movable') >= 0 || normalized.indexOf('dong san') >= 0 || normalized.indexOf('vehicle') >= 0 || normalized.indexOf('xe') >= 0) {
    value = '\u0110\u1ed9\u006e\u0067 \u0073\u1ea3\u006e';
  }
  if (value) {
    field.ai_value = value;
    field.final_value = value;
  }
}

function normalizeAssetIssuingAuthority_(asset) {
  const field = asset && asset.real_estate && asset.real_estate.issuing_authority;
  if (!field) return;
  const agency = normalizeVietnameseAgencyNameClean_(field.final_value || field.ai_value);
  if (agency) {
    field.ai_value = agency;
    field.final_value = agency;
  }
}

function normalizeAssetCertificateCodes_(asset) {
  const re = asset && asset.real_estate;
  if (!re) return;
  [re.certificate_number, re.registry_number].forEach(function(field) {
    if (!field || !field.hasOwnProperty('final_value')) return;
    ['ai_value', 'form_value', 'manual_value', 'final_value'].forEach(function(key) {
      if (field[key]) field[key] = normalizeCertificateCodeValue_(field[key]);
    });
  });
}

function normalizeCertificateCodeValue_(value) {
  return String(value || '').replace(/\s+/g, '').trim();
}

function extractRealEstateRegistryNumber_(text) {
  const lines = String(text || '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = String(lines[i] || '');
    const plainLine = removeVietnameseAccents_(line).toLowerCase().replace(/\s+/g, ' ');
    if (plainLine.indexOf('so vao so') < 0) continue;
    const fromLabel = extractRegistryCodeAfterRegistryLabel_(line);
    if (fromLabel) return fromLabel;
  }
  return '';
}

function extractRegistryCodeAfterRegistryLabel_(value) {
  const raw = String(value || '').replace(/\s+/g, ' ').trim();
  const normalized = removeVietnameseAccents_(raw).toLowerCase();
  const label = normalized.match(/so\s+vao\s+so\s+cap\s+(?:gcn|giay\s+chung\s+nhan)\s*[:;.-]?\s*/i);
  if (!label) return '';
  const candidate = raw.slice(label.index + label[0].length)
    .replace(/\s+(?:ngay|noi|cap|ky)\b.*$/i, '')
    .replace(/[;,\s]+$/g, '')
    .trim();
  return normalizeRegistryCodeValue_(candidate);
}

function isPlausibleRegistryCode_(value) {
  const normalized = String(value || '').replace(/\s+/g, '').trim();
  if (!/[A-Z]/i.test(normalized) || !/\d/.test(normalized)) return false;
  if (/^[A-Z]{1,2}\d{6}$/i.test(normalized) && !/^(?:CS|CT|CN|CH|CL|HX|VP|DC|DL)/i.test(normalized)) return false;
  return /^(?:CS|CT|CN|CH|CL|HX|VP|DC|DL)[-.]?[0-9A-Z.\/-]{2,24}$/i.test(normalized);
}

function isInvalidRegistryNumber_(value) {
  const normalized = String(value || '').replace(/\s+/g, '').trim();
  return Boolean(normalized && !isPlausibleRegistryCode_(normalized));
}

function extractRegistryCodeNearRegistryLabel_(value) {
  const normalized = removeVietnameseAccents_(String(value || '')).replace(/\s+/g, ' ');
  const match = normalized.match(/(?:so vao so|vao so cap gcn|so cap gcn|registry)[^A-Z0-9]{0,80}((?:CS|CT|CN|CH|CL|HX|VP|DC|DL)\s*[-.]?\s*[0-9][A-Z0-9.\/-]{1,20})/i);
  return match ? normalizeRegistryCodeValue_(match[1]) : '';
}

function isPlausibleRegistryCodeFallback_(value) {
  const match = String(value || '').match(/^([A-Z]{2,3})[-.]?([0-9][A-Z0-9.\/-]{1,20})$/i);
  if (!match) return false;
  const body = match[2].replace(/[^\dA-Z]/gi, '');
  if (/^(?:19|20)\d{2}$/.test(body)) return false;
  if (/^\d+$/.test(body) && body.length < 5) return false;
  return true;
}

function scoreRegistryCodeCandidate_(value) {
  const match = String(value || '').match(/^([A-Z]{2,3})[-.]?([0-9][A-Z0-9.\/-]{1,20})$/i);
  if (!match) return 0;
  const prefix = match[1].toUpperCase();
  const body = match[2].replace(/[^\dA-Z]/gi, '');
  let score = 0;
  if (/^(CS|CH|CN|CT)$/.test(prefix)) score += 6;
  if (/^\d+$/.test(body)) score += Math.min(body.length, 8);
  if (body.length >= 5) score += 4;
  return score;
}

function normalizeRegistryCodeValue_(value) {
  value = String(value || '')
    .replace(/\.{2,}/g, '')
    .replace(/[;,:]+$/g, '')
    .trim();
  const direct = value.match(/\b(?:CS|CT|CN|CH|CL|HX|VP|DC|DL)\s*[-.]?\s*[0-9][A-Z0-9.\/-]{1,20}\b/i);
  if (direct) value = direct[0];
  value = value.replace(/\s+/g, '').trim();
  const dottedDigits = value.match(/^((?:CS|CT|CN|CH|CL|HX|VP|DC|DL))\.?([0-9][0-9.\/-]*)$/i);
  if (dottedDigits && /^[0-9.]+$/.test(dottedDigits[2]) && (dottedDigits[2].match(/\./g) || []).length >= 2) {
    value = dottedDigits[1].toUpperCase() + dottedDigits[2].replace(/\./g, '');
  }
  if (!isPlausibleRegistryCode_(value)) return '';
  return value.replace(/^([a-z]{2,3})/, function(prefix) {
    return prefix.toUpperCase();
  });
}

function extractRealEstateIssueDate_(text) {
  const regions = extractLandOcrMarkedRegionTexts_(text, 'LAND_OCR_AUTHORITY_REGION')
    .concat(extractLandOcrMarkedRegionTexts_(text, 'LAND_OCR_REGION'));
  const sources = regions.length ? regions.concat([text]) : [text];
  for (let i = 0; i < sources.length; i++) {
    const found = extractRealEstateIssueDateFromPlainText_(sources[i]);
    if (found) return found;
  }
  return '';
}

function extractRealEstateIssueDateFromPlainText_(text) {
  const lines = String(text || '').split(/\r?\n/)
    .map(function(line) { return String(line || '').replace(/\s+/g, ' ').trim(); })
    .filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    const normalized = removeVietnameseAccents_(lines[i]).toLowerCase().replace(/\s+/g, ' ');
    if (normalized.indexOf('ngay') < 0 || normalized.indexOf('thang') < 0 || normalized.indexOf('nam') < 0) continue;
    if (normalized.indexOf('thoi han') >= 0 || normalized.indexOf('den thang') >= 0) continue;
    const date = normalizeDateValue_(lines[i]);
    if (date) return date;
  }
  return '';
}

function shouldReplaceRealEstateIssueDate_(field, candidate) {
  if (!field || !candidate || field.manual_value) return false;
  const current = String(field.final_value || field.ai_value || '').trim();
  if (!current) return true;
  const normalized = normalizeDateValue_(current);
  if (!normalized) return true;
  const currentSearch = removeVietnameseAccents_(current).toLowerCase();
  if (currentSearch.indexOf('khong ro') >= 0 || currentSearch.indexOf('nghi sua thu cong') >= 0) return true;
  return normalized !== candidate;
}

function extractRealEstateIssuingAuthority_(text) {
  const trusted = extractRealEstateIssuingAuthorityFromMarkedRegions_(text);
  if (trusted) return trusted;
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  const direct = raw.match(/\b(?:do|duoc|Ä‘Æ°á»£c)\s+(.{5,160}?)\s+c.{0,3}p\s+ng.{0,3}y/i);
  if (direct) {
    const directCleaned = cleanRealEstateIssuingAuthority_(direct[1]);
    if (directCleaned) return directCleaned;
  }
  const plain = removeVietnameseAccents_(raw).toLowerCase();
  const anchors = [
    { start: ' do ', end: ' cap ngay ' },
    { start: ' duoc ', end: ' cap ngay ' }
  ];
  for (let i = 0; i < anchors.length; i++) {
    const found = extractTextBetweenNormalizedAnchors_(raw, plain, anchors[i].start, anchors[i].end);
    const cleaned = cleanRealEstateIssuingAuthority_(found);
    if (cleaned) return cleaned;
  }
  const lines = String(text || '').split(/\r?\n/).map(function(line) {
    return line.replace(/\s+/g, ' ').trim();
  }).filter(Boolean);
  for (let l = 0; l < lines.length; l++) {
    const linePlain = removeVietnameseAccents_(lines[l]).toLowerCase();
    if (linePlain.indexOf('uy ban nhan dan') >= 0 || linePlain.indexOf('so tai nguyen') >= 0 || linePlain.indexOf('van phong dang ky dat dai') >= 0) {
      const cleanedLine = cleanRealEstateIssuingAuthority_(lines[l]);
      if (cleanedLine) return cleanedLine;
    }
  }
  return '';
}

function extractRealEstateIssuingAuthorityFromMarkedRegions_(text) {
  const regions = extractLandOcrMarkedRegionTexts_(text, 'LAND_OCR_AUTHORITY_REGION')
    .concat(extractLandOcrMarkedRegionTexts_(text, 'LAND_OCR_REGION'));
  for (let i = 0; i < regions.length; i++) {
    const raw = String(regions[i] || '');
    const lines = raw.split(/\r?\n/).map(function(line) {
      return String(line || '').replace(/\s+/g, ' ').trim();
    }).filter(Boolean);
    for (let j = 0; j < lines.length; j++) {
      const plain = removeVietnameseAccents_(lines[j]).toLowerCase();
      if (plain.indexOf('so tai nguyen') < 0 &&
          plain.indexOf('uy ban nhan dan') < 0 &&
          plain.indexOf('van phong dang ky dat dai') < 0) continue;
      const cleaned = cleanRealEstateIssuingAuthority_(lines[j]);
      if (cleaned) return cleaned;
    }
  }
  return '';
}

function extractLandOcrMarkedRegionTexts_(text, markerName) {
  const escaped = String(markerName || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp('\\[' + escaped + '[^\\]]*\\]([\\s\\S]*?)\\[\\/' + escaped + '\\]', 'g');
  const out = [];
  let match;
  while ((match = regex.exec(String(text || ''))) !== null) {
    const value = String(match[1] || '').trim();
    if (value) out.push(value);
  }
  return out;
}

function extractTextBetweenNormalizedAnchors_(raw, normalized, startAnchor, endAnchor) {
  const start = normalized.indexOf(startAnchor);
  if (start < 0) return '';
  const from = start + startAnchor.length;
  const end = normalized.indexOf(endAnchor, from);
  if (end < 0 || end <= from) return '';
  return raw.slice(from, end);
}

function cleanRealEstateIssuingAuthority_(value) {
  let raw = String(value || '')
    .replace(/^(?:do|duoc|Ä‘Æ°á»£c)\s+/i, '')
    .replace(/\s+/g, ' ')
    .replace(/[;,.:\-\s]+$/g, '')
    .trim();
  if (!raw) return '';
  const plain = removeVietnameseAccents_(raw).toLowerCase();
  const keepFrom = [
    plain.indexOf('uy ban nhan dan'),
    plain.indexOf('so tai nguyen'),
    plain.indexOf('van phong dang ky dat dai'),
    plain.indexOf('chi nhanh van phong dang ky dat dai')
  ].filter(function(index) { return index >= 0; }).sort(function(a, b) { return a - b; })[0];
  if (keepFrom > 0) raw = raw.slice(keepFrom).trim();
  if (isUnsafeRealEstateIssuingAuthorityValue_(raw)) return '';
  if (raw.length > 160) return '';
  return normalizeVietnameseAgencyNameClean_(raw);
}

function isUnsafeRealEstateIssuingAuthorityValue_(value) {
  const plain = removeVietnameseAccents_(String(value || '')).toLowerCase().replace(/\s+/g, ' ').trim();
  if (!plain) return false;
  if (plain.indexOf('so tai nguyen') >= 0 ||
      plain.indexOf('uy ban nhan dan') >= 0 ||
      plain.indexOf('van phong dang ky dat dai') >= 0 ||
      plain.indexOf('chi nhanh van phong dang ky dat dai') >= 0) return false;
  return plain.length > 80 ||
    plain.indexOf('noi dung thay doi') >= 0 ||
    plain.indexOf('hamdoc') >= 0 ||
    plain.indexOf('phone') >= 0 ||
    plain.indexOf('bank') >= 0 ||
    plain.indexOf('bangky') >= 0 ||
    plain.indexOf('thich phot') >= 0 ||
    /\b\d{5,}\b/.test(plain);
}
function applyFormPriorityRules_(reviewJson) {
  function applyPersonAddress(person) {
    const vneid = person.vneid_current_address.final_value;
    const permanent = person.permanent_address.final_value;
    const selected = vneid || permanent || '';
    person.current_address_final = makeField(
      'Äá»‹a chá»‰ sá»­ dá»¥ng cuá»‘i cÃ¹ng',
      vneid || permanent,
      '',
      '',
      vneid ? 'VNEID' : 'OCR',
      person.vneid_current_address.confidence || person.permanent_address.confidence
    );
    person.current_address_final.final_value = selected;
    if (vneid && permanent && vneid !== permanent) {
      reviewJson.validation.warnings.push({
        field_path: 'person.current_address_final',
        message: 'Äá»‹a chá»‰ VNeID khÃ¡c Ä‘á»‹a chá»‰ thÆ°á»ng trÃº CCCD. Há»‡ thá»‘ng Æ°u tiÃªn VNeID, cáº§n ngÆ°á»i dÃ¹ng xÃ¡c nháº­n.',
        source_file: person.vneid_current_address.source || person.permanent_address.source || ''
      });
    }
  }
  (reviewJson.secured_parties || []).forEach(applyPersonAddress);
  (reviewJson.obligors || []).forEach(applyPersonAddress);
}

function fieldFromAi_(label, obj) {
  obj = obj || {};
  const field = makeField(label, obj.value || '', '', '', obj.source_file || '', obj.confidence);
  markUnclearIfLowConfidence_(field);
  return field;
}

function normalizeNestedFields_(obj, labels) {
  const out = {};
  Object.keys(labels).forEach(function(key) {
    out[key] = fieldFromAi_(labels[key], obj[key]);
  });
  return out;
}

function dedupePeople_(people) {
  const byId = {};
  const result = [];
  people.forEach(function(person) {
    const id = normalizeId_(person.id_number && person.id_number.final_value);
    if (id && byId[id]) {
      mergePeople_(byId[id], person);
    } else {
      result.push(person);
      if (id) byId[id] = person;
    }
  });
  return result;
}

function mergePeople_(target, source) {
  target.roles = Array.from(new Set((target.roles || []).concat(source.roles || [])));
  mergeEmptyFields_(target, source);
}

function mergeEmptyFields_(target, source) {
  Object.keys(source).forEach(function(key) {
    if (key === 'roles') return;
    if (source[key] && source[key].hasOwnProperty && source[key].hasOwnProperty('final_value')) {
      if (shouldReplaceField_(target[key], source[key])) target[key] = source[key];
    } else if (typeof source[key] === 'object' && source[key] !== null) {
      target[key] = target[key] || {};
      mergeEmptyFields_(target[key], source[key]);
    }
  });
}

function shouldReplaceField_(targetField, sourceField) {
  if (!sourceField || !sourceField.final_value) return false;
  if (!targetField || !targetField.final_value) return true;
  if (targetField.final_value === 'KhÃ´ng rÃµ, Ä‘á» nghá»‹ sá»­a thá»§ cÃ´ng') return true;
  const targetConf = Number(targetField.confidence || 0);
  const sourceConf = Number(sourceField.confidence || 0);
  return sourceConf > targetConf && String(sourceField.final_value).length >= String(targetField.final_value).length;
}

function normalizePersonName_(value) {
  value = String(value || '').trim();
  if (!value || value.length < 5 || value === 'KhÃ´ng rÃµ, Ä‘á» nghá»‹ sá»­a thá»§ cÃ´ng') return '';
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .toUpperCase();
}

function normalizeId_(value) {
  return String(value || '').replace(/\D/g, '');
}

function buildIdHintsByFile_(ocrResults) {
  const map = {};
  (ocrResults || []).forEach(function(item) {
    const ids = extractVietnamIdNumbers_(item.text || '');
    if (ids.length) {
      map[item.file_name] = ids;
    }
  });
  return map;
}

function buildOcrTextByFile_(ocrResults) {
  const map = {};
  (ocrResults || []).forEach(function(item) {
    map[item.file_name] = item.text || '';
  });
  return map;
}

function extractVietnamIdNumbers_(text) {
  text = String(text || '');
  const candidates = [];
  extractCccdNumbersFromMrz_(text).forEach(function(id) {
    if (candidates.indexOf(id) === -1) candidates.push(id);
  });
  addUniqueMatches_(candidates, text, /(^|\D)(\d{12})(?=\D|$)/g, 2);
  addUniqueMatches_(candidates, text, /IDVNM\s*(\d{12})/gi, 1);
  addUniqueMatches_(candidates, removeVietnameseAccents_(text), /(?:so|no\.?|number|id(?:\s*no)?|cccd|can\s*cuoc\s*cong\s*dan|can\s*cuoc)\D{0,20}(\d[\d\s.-]{10,18}\d)/gi, 1);
  return candidates;
}

function extractCccdNumbersFromMrz_(text) {
  const out = [];
  String(text || '').split(/\r?\n/).forEach(function(line) {
    if (!/IDVNM/i.test(line)) return;
    const afterPrefix = line.replace(/^.*?IDVNM/i, '');
    const mrzDigits = afterPrefix
      .replace(/[oO]/g, '0')
      .replace(/[iIlL]/g, '1')
      .replace(/[^0-9]/g, '');
    if (mrzDigits.length >= 22) {
      const id = mrzDigits.slice(10, 22);
      if (isLikelyVietnamId_(id) && out.indexOf(id) === -1) out.push(id);
    } else if (mrzDigits.length >= 12) {
      const tailId = mrzDigits.slice(-12);
      if (isLikelyVietnamId_(tailId) && out.indexOf(tailId) === -1) out.push(tailId);
    }
  });
  return out;
}

function extractVietnamPersonalDocumentNumbers_(text) {
  const out = extractVietnamIdNumbers_(text);
  addUniqueMatches_(out, String(text || ''), /(^|\D)(\d{9})(?=\D|$)/g, 2);
  addUniqueMatches_(out, removeVietnameseAccents_(String(text || '')), /(?:cmnd|chung\s*minh\s*nhan\s*dan)\D{0,20}(\d[\d\s.-]{7,12}\d)/gi, 1);
  return out;
}

function removeVietnameseAccents_(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u0111/g, 'd')
    .replace(/\u0110/g, 'D');
}

function addUniqueMatches_(out, text, regex, groupIndex) {
  let match;
  while ((match = regex.exec(text)) !== null) {
    const value = normalizeId_(match[groupIndex || 1]);
    if ((value.length === 12 || value.length === 9) && isLikelyVietnamId_(value) && out.indexOf(value) === -1) {
      out.push(value);
    }
  }
}

function isLikelyVietnamId_(value) {
  return /^(\d{9}|\d{12})$/.test(value) && !/^0+$/.test(value) && !/^1+$/.test(value);
}

function enrichPersonIdFromOcr_(person, idHintsByFile) {
  if (normalizeId_(person.id_number && person.id_number.final_value)) return;
  const sources = collectSourceFilesFromObject_(person);
  for (let i = 0; i < sources.length; i++) {
    const ids = idHintsByFile[sources[i]] || [];
    if (ids.length === 1) {
      person.id_number.ai_value = ids[0];
      person.id_number.final_value = ids[0];
      person.id_number.source = sources[i];
      person.id_number.confidence = person.id_number.confidence || 0.75;
      return;
    }
  }
}

function normalizeIdIssuePlace_(person, ocrTextByFile) {
  const field = person && person.id_issue_place;
  if (!field) return;
  const current = normalizeIssuePlaceValueClean_(field.final_value || field.ai_value);
  if (current) {
    field.ai_value = current;
    field.final_value = current;
    return;
  }
  const sources = collectSourceFilesFromObject_(person);
  for (let i = 0; i < sources.length; i++) {
    const inferred = normalizeIssuePlaceValueClean_(ocrTextByFile[sources[i]] || '');
    if (inferred) {
      field.ai_value = inferred;
      field.final_value = inferred;
      field.source = sources[i];
      field.confidence = field.confidence || 0.75;
      return;
    }
  }
  const id = normalizeId_(person.id_number && person.id_number.final_value);
  if (id) {
    const fileNames = Object.keys(ocrTextByFile || {});
    for (let j = 0; j < fileNames.length; j++) {
      const text = ocrTextByFile[fileNames[j]] || '';
      if (normalizeId_(text).indexOf(id) < 0) continue;
      const inferred = normalizeIssuePlaceValueClean_(text);
      if (inferred) {
        field.ai_value = inferred;
        field.final_value = inferred;
        field.source = fileNames[j];
        field.confidence = field.confidence || 0.75;
        return;
      }
    }
  }
  const documentType = normalizeDocumentTypeValueClean_(person.id_document_type && person.id_document_type.final_value);
  if (documentType) {
    field.ai_value = 'Bá»™ CÃ´ng an';
    field.final_value = 'Bá»™ CÃ´ng an';
    field.source = field.source || 'ISSUER_DEFAULT_FOR_ID_CARD';
    field.confidence = field.confidence || 0.6;
  }
}

function normalizePersonDocumentType_(person, ocrTextByFile) {
  const field = person && person.id_document_type;
  if (!field) return;
  const current = normalizeDocumentTypeValue_(field.final_value || field.ai_value);
  if (current) {
    field.ai_value = current;
    field.final_value = current;
    return;
  }
  const id = normalizeId_(person.id_number && person.id_number.final_value);
  const sources = collectSourceFilesFromObject_(person);
  for (let i = 0; i < sources.length; i++) {
    const inferred = inferDocumentType_(id, ocrTextByFile[sources[i]] || '');
    if (inferred) {
      field.ai_value = inferred;
      field.final_value = inferred;
      field.source = sources[i];
      field.confidence = field.confidence || 0.75;
      return;
    }
  }
  if (id) {
    const fallback = inferDocumentType_(id, '');
    if (fallback) {
      field.ai_value = fallback;
      field.final_value = fallback;
      field.source = field.source || 'OCR';
      field.confidence = field.confidence || 0.65;
    }
  }
}

function normalizeGenderFromIdentityNumber_(person) {
  const field = person && person.gender;
  const id = normalizeId_(person && person.id_number && person.id_number.final_value);
  if (!field || id.length !== 12) return;
  const derived = deriveGenderFromVietnamIdentityNumber_(id);
  if (!derived) return;
  const current = normalizeGenderValue_(field.final_value || field.ai_value);
  const lowConfidence = Number(field.confidence || 0) < 0.8;
  if (!current || lowConfidence || current !== derived) {
    field.ai_value = derived;
    field.final_value = derived;
    field.source = field.source || 'CCCD_DIGIT_4';
    field.confidence = Math.max(Number(field.confidence || 0), 0.95);
  }
}

function deriveGenderFromVietnamIdentityNumber_(id) {
  id = normalizeId_(id);
  if (id.length !== 12) return '';
  const digit = Number(id.charAt(3));
  if (isNaN(digit)) return '';
  return digit % 2 === 0 ? 'Nam' : 'Ná»¯';
}

function normalizeGenderValue_(value) {
  const text = String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (text.indexOf('nam') >= 0 || text.indexOf('male') >= 0) return 'Nam';
  if (text.indexOf('nu') >= 0 || text.indexOf('female') >= 0) return 'Ná»¯';
  return '';
}

function normalizeAssetOwnerDocumentType_(asset, text) {
  const field = asset && asset.owner_id_document_type;
  if (!field) return;
  const current = normalizeDocumentTypeValue_(field.final_value || field.ai_value);
  if (current) {
    field.ai_value = current;
    field.final_value = current;
    return;
  }
  const id = normalizeId_(asset.owner_id_number && asset.owner_id_number.final_value);
  const inferred = inferDocumentType_(id, text || '');
  if (inferred) {
    field.ai_value = inferred;
    field.final_value = inferred;
    field.source = asset.owner_id_number && asset.owner_id_number.source ? asset.owner_id_number.source : 'OCR_ASSET_TEXT';
    field.confidence = field.confidence || 0.75;
  }
}

function inferDocumentType_(idNumber, text) {
  const fromText = normalizeDocumentTypeValue_(text);
  if (fromText) return fromText;
  const digits = normalizeId_(idNumber);
  if (digits.length === 9) return 'Chá»©ng minh nhÃ¢n dÃ¢n';
  if (digits.length === 12) return 'CÄƒn cÆ°á»›c cÃ´ng dÃ¢n';
  return '';
}

function normalizeDocumentTypeValue_(value) {
  const text = String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u0111/g, 'd');
  if (text.indexOf('chung minh nhan dan') >= 0 || /\bcmnd\b/.test(text)) return 'Chá»©ng minh nhÃ¢n dÃ¢n';
  if (text.indexOf('can cuoc cong dan') >= 0 || /\bcccd\b/.test(text)) return 'CÄƒn cÆ°á»›c cÃ´ng dÃ¢n';
  if (text.indexOf('can cuoc') >= 0) return 'CÄƒn cÆ°á»›c';
  return '';
}

function normalizeIssuePlaceValue_(value) {
  const text = String(value || '');
  const normalized = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u0111/g, 'd');
  if (normalized.indexOf('cuc canh sat quan ly hanh chinh') >= 0 ||
      normalized.indexOf('canh sat quan ly hanh chinh') >= 0) {
    return 'Cá»¥c Cáº£nh sÃ¡t quáº£n lÃ½ hÃ nh chÃ­nh vá» tráº­t tá»± xÃ£ há»™i';
  }
  if (normalized.indexOf('bo cong an') >= 0 ||
      normalized.indexOf('ministry of public security') >= 0 ||
      normalized.indexOf('public security') >= 0) {
    return 'Bá»™ CÃ´ng an';
  }
  return '';
}

function collectSourceFilesFromObject_(obj) {
  const out = [];
  function walk(value) {
    if (!value || typeof value !== 'object') return;
    if (value.hasOwnProperty('final_value')) {
      if (value.source && out.indexOf(value.source) === -1) out.push(value.source);
      return;
    }
    Object.keys(value).forEach(function(key) { walk(value[key]); });
  }
  walk(obj);
  return out;
}

function normalizePersonDates_(person) {
  [
    person.date_of_birth,
    person.id_issue_date,
    person.id_expiry_date,
    person.marriage_registration && person.marriage_registration.registration_date,
    person.marital_status_certificate && person.marital_status_certificate.confirmation_date
  ].forEach(normalizeDateField_);
}

function inferPersonIssueDateFromOcr_(person, ocrTextByFile) {
  const field = person && person.id_issue_date;
  if (!field || field.final_value) return;
  const documentType = person.id_document_type && person.id_document_type.final_value;
  const id = normalizeId_(person.id_number && person.id_number.final_value);
  if (id) {
    const inferredById = extractIssueDateByIdentityNumberFromOcr_(id, ocrTextByFile || {}, documentType);
    if (inferredById.date) {
      field.ai_value = inferredById.date;
      field.final_value = inferredById.date;
      field.source = inferredById.file_name || field.source || 'OCR_ID_MATCH';
      field.confidence = field.confidence || 0.9;
      return;
    }
  }
  const sources = collectSourceFilesFromObject_(person);
  if (sources.length !== 1) return;
  const inferred = extractIssueDateFromIdentityOcr_(ocrTextByFile[sources[0]] || '', documentType);
  if (inferred) {
    field.ai_value = inferred;
    field.final_value = inferred;
    field.source = sources[0];
    field.confidence = field.confidence || 0.72;
  }
}

function extractIssueDateByIdentityNumberFromOcr_(id, ocrTextByFile, documentType) {
  const fileNames = Object.keys(ocrTextByFile || {});
  const matchedIndexes = [];
  for (let i = 0; i < fileNames.length; i++) {
    if (identityOcrContainsId_(ocrTextByFile[fileNames[i]] || '', id)) matchedIndexes.push(i);
  }
  for (let m = 0; m < matchedIndexes.length; m++) {
    const idx = matchedIndexes[m];
    const sameFileDate = extractIssueDateFromIdentityOcr_(ocrTextByFile[fileNames[idx]] || '', documentType);
    if (sameFileDate) return { date: sameFileDate, file_name: fileNames[idx] };
  }
  for (let n = 0; n < matchedIndexes.length; n++) {
    const baseIdx = matchedIndexes[n];
    const adjacentIndexes = [baseIdx + 1, baseIdx - 1];
    for (let a = 0; a < adjacentIndexes.length; a++) {
      const adjacentIdx = adjacentIndexes[a];
      if (adjacentIdx < 0 || adjacentIdx >= fileNames.length) continue;
      if (!sameUploadGroup_(fileNames[baseIdx], fileNames[adjacentIdx])) continue;
      const adjacentText = ocrTextByFile[fileNames[adjacentIdx]] || '';
      if (!isLikelyBackSideIdentityOcr_(adjacentText)) continue;
      const adjacentDate = extractIssueDateFromIdentityOcr_(adjacentText, documentType);
      if (adjacentDate) return { date: adjacentDate, file_name: fileNames[adjacentIdx] };
    }
  }
  const groupCandidates = [];
  for (let g = 0; g < matchedIndexes.length; g++) {
    const matchedFileName = fileNames[matchedIndexes[g]];
    for (let c = 0; c < fileNames.length; c++) {
      if (!sameUploadGroup_(matchedFileName, fileNames[c])) continue;
      const candidateText = ocrTextByFile[fileNames[c]] || '';
      if (!isLikelyBackSideIdentityOcr_(candidateText)) continue;
      const candidateDate = extractIssueDateFromIdentityOcr_(candidateText, documentType);
      if (!candidateDate) continue;
      groupCandidates.push({ date: candidateDate, file_name: fileNames[c] });
    }
  }
  const uniqueCandidates = uniqueIssueDateCandidates_(groupCandidates);
  if (uniqueCandidates.length === 1) return uniqueCandidates[0];
  return { date: '', file_name: '' };
}

function rejectUnverifiedIdentityIssueDate_(person, ocrTextByFile, documentType) {
  const field = person && person.id_issue_date;
  if (!field || field.manual_value) return;
  const current = normalizeDateValue_(field.final_value || field.ai_value);
  if (!current) return;
  const id = normalizeId_(person.id_number && person.id_number.final_value);
  if (!id) return;
  const inferred = extractIssueDateByIdentityNumberFromOcr_(id, ocrTextByFile || {}, documentType);
  if (inferred.date && inferred.date === current) return;
  if (inferred.date && inferred.date !== current) {
    field.ai_value = inferred.date;
    field.final_value = inferred.date;
    field.source = inferred.file_name || field.source || 'OCR_ID_MATCH_CORRECTED';
    field.confidence = Math.max(Number(field.confidence || 0), 0.9);
    return;
  }
  if (!hasIdentityBackSideOcrForId_(id, ocrTextByFile || {})) return;
  field.ai_value = '';
  field.final_value = '\u004b\u0068\u00f4\u006e\u0067 \u0072\u00f5, \u0111\u1ec1 \u006e\u0067\u0068\u1ecb \u0073\u1eeda \u0074\u0068\u1ee7 \u0063\u00f4\u006e\u0067';
  field.source = field.source || 'OCR_DATE_UNREADABLE';
  field.confidence = '';
}

function hasIdentityBackSideOcrForId_(id, ocrTextByFile) {
  const fileNames = Object.keys(ocrTextByFile || {});
  for (let i = 0; i < fileNames.length; i++) {
    const text = ocrTextByFile[fileNames[i]] || '';
    if (identityOcrContainsId_(text, id) && isLikelyBackSideIdentityOcr_(text)) return true;
  }
  return false;
}

function uniqueIssueDateCandidates_(candidates) {
  const seen = {};
  const out = [];
  (candidates || []).forEach(function(candidate) {
    if (!candidate || !candidate.date || seen[candidate.date]) return;
    seen[candidate.date] = true;
    out.push(candidate);
  });
  return out;
}

function sameUploadGroup_(fileNameA, fileNameB) {
  const groupA = uploadGroupPrefix_(fileNameA);
  const groupB = uploadGroupPrefix_(fileNameB);
  return Boolean(groupA && groupB && groupA === groupB);
}

function uploadGroupPrefix_(fileName) {
  const name = String(fileName || '');
  const match = name.match(/^(secured_party|obligor|asset)(?:__|_)/i);
  return match ? match[1].toLowerCase() : '';
}

function identityOcrContainsId_(text, id) {
  const ids = extractVietnamIdNumbers_(text);
  if (ids.indexOf(id) >= 0) return true;
  const digits = normalizeId_(text);
  if (digits.indexOf(id) >= 0) return true;
  return new RegExp('IDVNM\\D*' + id, 'i').test(String(text || ''));
}

function extractIssueDateFromIdentityOcr_(text, documentType) {
  text = String(text || '');
  if (!text) return '';
  const normalized = removeVietnameseAccents_(text).toLowerCase();
  const flexibleLabelDate = extractFlexibleIssueDateNearLabels_(text, normalized);
  if (flexibleLabelDate) return flexibleLabelDate;
  const patterns = [
    /(?:ng\u00e0y\s*,?\s*th\u00e1ng\s*,?\s*n\u0103m\s*c\u1ea5p|date\s*of\s*issue)\D{0,40}(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})/i,
    /(?:ng\u00e0y\s*,?\s*th\u00e1ng\s*,?\s*n\u0103m|date\s*,?\s*month\s*,?\s*year)\D{0,40}(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})/i,
    /(?:age\s*\/?\s*date\s*month\s*year)\D{0,40}(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})/i,
    /(?:ng\u00e0y\s*c\u1ea5p|c\u1ea5p\s*ng\u00e0y)\D{0,30}(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})/i,
    /(?:ngÃ y\s*cáº¥p|ngay\s*cap|date\s*of\s*issue)\D{0,30}(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})/i,
    /(?:cáº¥p\s*ngÃ y|cap\s*ngay)\D{0,30}(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})/i
  ];
  for (let i = 0; i < patterns.length; i++) {
    const match = text.match(patterns[i]);
    if (match) return normalizeDateValue_(match[1]);
  }
  const issueLabels = ['date of issue', 'ngay cap', 'cap ngay', 'ngay thang nam cap', 'ngay thang nam'];
  let idx = -1;
  for (let l = 0; l < issueLabels.length; l++) {
    const found = normalized.indexOf(issueLabels[l]);
    if (found >= 0 && (idx < 0 || found < idx)) idx = found;
  }
  if (idx >= 0) {
    const tail = text.slice(idx, idx + 100);
    const date = tail.match(/(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})/);
    if (date) return normalizeDateValue_(date[1]);
  }
  const docText = removeVietnameseAccents_(String(documentType || '')).toLowerCase();
  const isOldCccd = docText.indexOf('can cuoc cong dan') >= 0 || /\bcccd\b/.test(docText);
  if (isOldCccd && isLikelyBackSideIdentityOcr_(text)) {
    const dates = extractAllDatesFromIdentityOcr_(text);
    if (dates.length === 1) return normalizeDateValue_(dates[0]);
  }
  return '';
}

function extractFlexibleIssueDateNearLabels_(text, normalizedText) {
  const normalized = normalizedText || removeVietnameseAccents_(String(text || '')).toLowerCase();
  const labels = ['date of issue', 'ngay cap', 'cap ngay', 'ngay thang nam cap', 'ngay thang nam', 'date month year'];
  const lines = String(text || '').split(/\r?\n/);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const searchableLine = removeVietnameseAccents_(lines[lineIndex]).toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
    const hasLabel = labels.some(function(label) { return searchableLine.indexOf(label) >= 0; }) ||
      isLooseIssueDateLabelLine_(searchableLine);
    if (!hasLabel) continue;
    const lineWindow = [lines[lineIndex], lines[lineIndex + 1] || '', lines[lineIndex + 2] || ''].join(' ');
    const lineDate = extractIssueDateFromLabeledWindow_(lineWindow);
    if (lineDate) return lineDate;
  }
  let idx = -1;
  for (let i = 0; i < labels.length; i++) {
    const found = normalized.indexOf(labels[i]);
    if (found >= 0 && (idx < 0 || found < idx)) idx = found;
  }
  if (idx < 0) return '';
  const windowText = String(text || '').slice(Math.max(0, idx - 10), idx + 140);
  return extractIssueDateFromLabeledWindow_(windowText);
}

function isLooseIssueDateLabelLine_(searchableLine) {
  const compact = String(searchableLine || '').replace(/\s+/g, '');
  return /ng.?y.*th.?ng.*n.?m/.test(searchableLine) ||
    /ng.?y.*th.?ng.*n.?m/.test(compact) ||
    /date.*month.*yea/.test(searchableLine) ||
    /datemonthyea/.test(compact);
}

function extractIssueDateFromLabeledWindow_(windowText) {
  const match = windowText.match(/(\d{1,2})\D{1,8}(\d{1,2})\D{1,10}(\d{4})/);
  if (match) return normalizeDateValue_(match[1] + '/' + match[2] + '/' + match[3]);
  return extractCompactIssueDateFromLabeledWindow_(windowText);
}

function extractCompactIssueDateFromLabeledWindow_(windowText) {
  const normalized = String(windowText || '')
    .replace(/[oO]/g, '0')
    .replace(/[iIlL]/g, '1');
  const candidates = [];
  let match;
  const compactRegex = /(?:^|[^0-9])(\d{8})(?=[^0-9]|$)/g;
  while ((match = compactRegex.exec(normalized)) !== null) {
    candidates.push(match[1]);
  }
  const loose = normalized.match(/[0-9\/.\-\s]{8,16}/g) || [];
  loose.forEach(function(value) {
    const digits = value.replace(/\D/g, '');
    if (digits.length === 8) candidates.push(digits);
  });
  for (let i = 0; i < candidates.length; i++) {
    const parsed = normalizeCompactIssueDateDigits_(candidates[i]);
    if (parsed) return parsed;
  }
  return '';
}

function normalizeCompactIssueDateDigits_(digits) {
  digits = String(digits || '').replace(/\D/g, '');
  if (digits.length !== 8) return '';
  const day = Number(digits.slice(0, 2));
  const month = Number(digits.slice(2, 4));
  const year = Number(digits.slice(4, 8));
  if (year < 1990 || year > 2099 || month < 1 || month > 12 || day < 1 || day > 31) return '';
  const daysInMonth = [31, isLeapYear_(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (day > daysInMonth) return '';
  return pad2_(day) + '/' + pad2_(month) + '/' + year;
}

function isLeapYear_(year) {
  return year % 400 === 0 || (year % 4 === 0 && year % 100 !== 0);
}

function isLikelyBackSideIdentityOcr_(text) {
  const normalized = removeVietnameseAccents_(String(text || '')).toLowerCase();
  return normalized.indexOf('idvnm') >= 0 ||
    normalized.indexOf('ngay cap') >= 0 ||
    normalized.indexOf('ngay thang nam') >= 0 ||
    normalized.indexOf('date of issue') >= 0 ||
    normalized.indexOf('noi cu tru') >= 0 ||
    normalized.indexOf('dac diem nhan dang') >= 0 ||
    /<{3,}/.test(normalized);
}

function extractAllDatesFromIdentityOcr_(text) {
  const out = [];
  String(text || '').replace(/(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})/g, function(match, date) {
    if (out.indexOf(date) === -1) out.push(date);
    return match;
  });
  return out;
}

function normalizeAssetDates_(asset) {
  [
    asset.real_estate && asset.real_estate.issue_date,
    asset.movable && asset.movable.issue_date
  ].forEach(normalizeDateField_);
}

function normalizeDateField_(field) {
  if (!field || !field.hasOwnProperty('final_value')) return;
  ['ai_value', 'form_value', 'manual_value', 'final_value'].forEach(function(key) {
    if (field[key]) field[key] = normalizeDateValue_(field[key]);
  });
}

function normalizeDateValue_(value) {
  value = String(value || '').trim();
  if (!value) return '';
  let match = value.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/);
  if (match) return normalizeDateParts_(match[3], match[2], match[1]);
  match = value.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})$/);
  if (match) return normalizeDateParts_(match[1], match[2], normalizeYear_(match[3]));
  match = value.match(/(?:ngÃ y|ngay|day)?\s*(\d{1,2})\D+(?:thÃ¡ng|thang|month)?\s*(\d{1,2})\D+(?:nÄƒm|nam|year)?\s*(\d{4})/i);
  if (match) return normalizeDateParts_(match[1], match[2], match[3]);
  return value;
}

function normalizeDateParts_(dayValue, monthValue, yearValue) {
  const day = Number(dayValue);
  const month = Number(monthValue);
  const year = Number(yearValue);
  if (year < 1900 || year > 2099 || month < 1 || month > 12 || day < 1 || day > 31) return '';
  const daysInMonth = [31, isLeapYear_(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (day > daysInMonth) return '';
  return pad2_(day) + '/' + pad2_(month) + '/' + year;
}

function pad2_(value) {
  value = String(value || '');
  return value.length === 1 ? '0' + value : value;
}

function normalizeYear_(value) {
  value = String(value || '');
  if (value.length === 2) return Number(value) > 40 ? '19' + value : '20' + value;
  return value;
}

function markUnclearIfLowConfidence_(field) {
  const conf = Number(field.confidence);
  if (field.ai_value && !field.form_value && !field.manual_value && conf && conf < 0.7) {
    field.final_value = 'KhÃ´ng rÃµ, Ä‘á» nghá»‹ sá»­a thá»§ cÃ´ng';
  }
}

function normalizePersonDocumentTypeClean_(person, ocrTextByFile) {
  const field = person && person.id_document_type;
  if (!field) return;
  const current = normalizeDocumentTypeValueClean_(field.final_value || field.ai_value);
  if (current) {
    field.ai_value = current;
    field.final_value = current;
    return;
  }
  const id = normalizeId_(person.id_number && person.id_number.final_value);
  const sources = collectSourceFilesFromObject_(person);
  for (let i = 0; i < sources.length; i++) {
    const inferred = inferDocumentTypeClean_(id, ocrTextByFile[sources[i]] || '');
    if (inferred) {
      field.ai_value = inferred;
      field.final_value = inferred;
      field.source = sources[i];
      field.confidence = field.confidence || 0.75;
      return;
    }
  }
  const fallback = inferDocumentTypeClean_(id, '');
  if (fallback) {
    field.ai_value = fallback;
    field.final_value = fallback;
    field.source = field.source || 'OCR';
    field.confidence = field.confidence || 0.65;
  }
}

function normalizeIdIssuePlaceCleanApply_(person, ocrTextByFile) {
  const field = person && person.id_issue_place;
  if (!field) return;
  const current = normalizeIssuePlaceValueClean_(field.final_value || field.ai_value);
  if (current) {
    field.ai_value = current;
    field.final_value = current;
    return;
  }
  const sources = collectSourceFilesFromObject_(person);
  for (let i = 0; i < sources.length; i++) {
    const inferred = normalizeIssuePlaceValueClean_(ocrTextByFile[sources[i]] || '');
    if (inferred) {
      field.ai_value = inferred;
      field.final_value = inferred;
      field.source = sources[i];
      field.confidence = field.confidence || 0.75;
      return;
    }
  }
  const id = normalizeId_(person.id_number && person.id_number.final_value);
  if (id) {
    const fileNames = Object.keys(ocrTextByFile || {});
    for (let j = 0; j < fileNames.length; j++) {
      const text = ocrTextByFile[fileNames[j]] || '';
      if (normalizeId_(text).indexOf(id) < 0) continue;
      const inferred = normalizeIssuePlaceValueClean_(text);
      if (inferred) {
        field.ai_value = inferred;
        field.final_value = inferred;
        field.source = fileNames[j];
        field.confidence = field.confidence || 0.75;
        return;
      }
    }
  }
  if (normalizeDocumentTypeValueClean_(person.id_document_type && person.id_document_type.final_value)) {
    const fallback = defaultIssuePlaceByDocumentTypeClean_(person.id_document_type && person.id_document_type.final_value);
    field.ai_value = fallback;
    field.final_value = fallback;
    field.source = field.source || 'ISSUER_DEFAULT_FOR_ID_CARD';
    field.confidence = field.confidence || 0.6;
  }
}

function enforceIssuePlaceByDocumentType_(person) {
  const field = person && person.id_issue_place;
  const docType = person && person.id_document_type && person.id_document_type.final_value;
  const normalized = defaultIssuePlaceByDocumentTypeClean_(docType);
  if (!field || !normalized) return;
  field.ai_value = normalized;
  field.final_value = normalized;
  field.source = field.source || 'ISSUER_BY_DOCUMENT_TYPE';
  field.confidence = Math.max(Number(field.confidence || 0), 0.85);
}

function defaultIssuePlaceByDocumentTypeClean_(documentType) {
  const text = removeVietnameseAccents_(String(documentType || '')).toLowerCase();
  if (text.indexOf('can cuoc cong dan') >= 0 || /\bcccd\b/.test(text)) {
    return '\u0043\u1ee5\u0063 \u0043\u1ea3\u006e\u0068 \u0073\u00e1\u0074 \u0071\u0075\u1ea3\u006e \u006c\u00fd \u0068\u00e0\u006e\u0068 \u0063\u0068\u00ed\u006e\u0068 \u0076\u1ec1 \u0074\u0072\u1ead\u0074 \u0074\u1ef1 \u0078\u00e3 \u0068\u1ed9\u0069';
  }
  if (text.indexOf('can cuoc') >= 0) return '\u0042\u1ed9 \u0043\u00f4\u006e\u0067 \u0061\u006e';
  return '';
}

function inferDocumentTypeClean_(idNumber, text) {
  const fromText = normalizeDocumentTypeValueClean_(text);
  if (fromText) return fromText;
  const digits = normalizeId_(idNumber);
  if (digits.length === 9) return '\u0043\u0068\u1ee9\u006e\u0067 \u006d\u0069\u006e\u0068 \u006e\u0068\u00e2\u006e \u0064\u00e2\u006e';
  if (digits.length === 12) return '\u0043\u0103\u006e \u0063\u01b0\u1edb\u0063 \u0063\u00f4\u006e\u0067 \u0064\u00e2\u006e';
  return '';
}

function normalizeDocumentTypeValueClean_(value) {
  const text = String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u0111/g, 'd');
  if (text.indexOf('chung minh nhan dan') >= 0 || /\bcmnd\b/.test(text)) return '\u0043\u0068\u1ee9\u006e\u0067 \u006d\u0069\u006e\u0068 \u006e\u0068\u00e2\u006e \u0064\u00e2\u006e';
  if (text.indexOf('can cuoc cong dan') >= 0 || /\bcccd\b/.test(text)) return '\u0043\u0103\u006e \u0063\u01b0\u1edb\u0063 \u0063\u00f4\u006e\u0067 \u0064\u00e2\u006e';
  if (text.indexOf('can cuoc') >= 0) return '\u0043\u0103\u006e \u0063\u01b0\u1edb\u0063';
  return '';
}

function normalizeIssuePlaceValueClean_(value) {
  const normalized = String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u0111/g, 'd');
  if (normalized.indexOf('cuc canh sat quan ly hanh chinh') >= 0 ||
      normalized.indexOf('canh sat quan ly hanh chinh') >= 0) {
    return '\u0043\u1ee5\u0063 \u0043\u1ea3\u006e\u0068 \u0073\u00e1\u0074 \u0071\u0075\u1ea3\u006e \u006c\u00fd \u0068\u00e0\u006e\u0068 \u0063\u0068\u00ed\u006e\u0068 \u0076\u1ec1 \u0074\u0072\u1ead\u0074 \u0074\u1ef1 \u0078\u00e3 \u0068\u1ed9\u0069';
  }
  if (normalized.indexOf('bo cong an') >= 0 ||
      normalized.indexOf('ministry of public security') >= 0 ||
      normalized.indexOf('public security') >= 0) {
    return '\u0042\u1ed9 \u0043\u00f4\u006e\u0067 \u0061\u006e';
  }
  return '';
}

function normalizeVietnameseAgencyName_(value) {
  value = String(value || '').replace(/\s+/g, ' ').trim();
  if (!value || value === '\u004b\u0068\u00f4\u006e\u0067 \u0072\u00f5\u002c \u0111\u1ec1 \u006e\u0067\u0068\u1ecb \u0073\u1eeda \u0074\u0068\u1ee7 \u0063\u00f4\u006e\u0067') return '';
  let text = value.toLocaleLowerCase('vi-VN');
  text = text.charAt(0).toLocaleUpperCase('vi-VN') + text.slice(1);
  ['huyá»‡n', 'quáº­n', 'thÃ nh phá»‘', 'thá»‹ xÃ£', 'tá»‰nh', 'xÃ£', 'phÆ°á»ng', 'thá»‹ tráº¥n'].forEach(function(prefix) {
    const re = new RegExp('(' + prefix + '\\s+)([a-zÃ -á»¹]+)(\\s+([a-zÃ -á»¹]+))?', 'gi');
    text = text.replace(re, function(match, p1, w1, p3, w2) {
      return p1 + capitalizeVietnameseWord_(w1) + (p3 ? ' ' + capitalizeVietnameseWord_(w2) : '');
    });
  });
  return text;
}

function capitalizeVietnameseWord_(word) {
  word = String(word || '');
  return word ? word.charAt(0).toLocaleUpperCase('vi-VN') + word.slice(1).toLocaleLowerCase('vi-VN') : '';
}

function normalizeVietnameseAgencyNameClean_(value) {
  value = String(value || '')
    .replace(/^\s*(?:TM|T\/M|THAY\s+M\u1eb6T)\.?\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!value || normalizeSearchTextForAgency_(value).indexOf('khong ro') >= 0) return '';
  let text = value.toLocaleLowerCase('vi-VN');
  text = text.charAt(0).toLocaleUpperCase('vi-VN') + text.slice(1);
  text = normalizeLandRegistrationAgencyCasing_(text);
  ['huy\u1ec7n', 'qu\u1eadn', 'th\u00e0nh ph\u1ed1', 'th\u1ecb x\u00e3', 't\u1ec9nh', 'x\u00e3', 'ph\u01b0\u1eddng', 'th\u1ecb tr\u1ea5n'].forEach(function(prefix) {
    const re = new RegExp('(' + prefix + '\\s+)([^,;]+)', 'gi');
    text = text.replace(re, function(match, p1, rest) {
      return capitalizeVietnameseWord_(p1.trim()) + ' ' +
        String(rest || '').split(/\s+/).map(capitalizeVietnameseWord_).join(' ');
    });
  });
  text = text.replace(/^u\u1ef7 ban/i, '\u1ee6y ban').replace(/^á»§y ban/i, '\u1ee6y ban');
  return text;
}

function normalizeLandRegistrationAgencyCasing_(value) {
  let text = String(value || '').replace(/\s+/g, ' ').trim();
  const normalized = normalizeSearchTextForAgency_(text);
  if (normalized.indexOf('chi nhanh van phong dang ky dat dai ') === 0) {
    return 'Chi nh\u00e1nh V\u0103n ph\u00f2ng \u0111\u0103ng k\u00fd \u0111\u1ea5t \u0111ai ' +
      titleCaseVietnameseWords_(text.split(/\s+/).slice(8).join(' '));
  }
  if (normalized.indexOf('van phong dang ky dat dai ') === 0) {
    return 'V\u0103n ph\u00f2ng \u0111\u0103ng k\u00fd \u0111\u1ea5t \u0111ai ' +
      titleCaseVietnameseWords_(text.split(/\s+/).slice(6).join(' '));
  }
  return text;
}

function titleCaseVietnameseWords_(value) {
  return String(value || '').split(/\s+/).filter(Boolean).map(capitalizeVietnameseWord_).join(' ');
}

function normalizeSearchTextForAgency_(value) {
  return String(value || '').toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u0111/g, 'd')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function flattenFieldObject_(obj) {
  if (Array.isArray(obj)) return obj.map(flattenFieldObject_);
  if (!obj || typeof obj !== 'object') return obj;
  if (obj.hasOwnProperty('final_value')) {
    return {
      final_value: obj.final_value || '',
      source: obj.manual_value ? 'MANUAL' : (obj.form_value ? 'FORM' : (obj.ai_value ? 'OCR_AI' : '')),
      confidence: obj.confidence || '',
      original_ai_value: obj.ai_value || '',
      form_value: obj.form_value || '',
      manual_value: obj.manual_value || ''
    };
  }
  const out = {};
  Object.keys(obj).forEach(function(key) { out[key] = flattenFieldObject_(obj[key]); });
  return out;
}

