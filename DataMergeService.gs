function buildReviewJson(caseId, formData, aiData, ocrResults) {
  const normalized = normalizeAiData_(aiData || {}, ocrResults || []);
  const reviewJson = {
    schema_version: '1.0.0',
    case_id: caseId,
    contract_info: {
      review_email: makeField('Email nhận Review', '', formData.reviewEmail, '', 'FORM', ''),
      asset_type: makeField('Loại tài sản', '', formData.assetType, '', 'FORM', ''),
      contract_type: makeField('Loại hợp đồng', '', formData.contractType, '', 'FORM', ''),
      asset_count: makeField('Số lượng tài sản bảo đảm', '', formData.assetCount, '', 'FORM', ''),
      bank_signer: makeField('Người ký hợp đồng tại ngân hàng', '', formData.bankSigner, '', 'FORM', ''),
      dispute_court: makeField('Tòa án xử lý tranh chấp', '', formData.disputeCourt, '', 'FORM', ''),
      valuation_amount: makeField('Giá trị định giá', '', formData.valuationAmount, '', 'FORM', ''),
      valuation_land_amount: makeField('Giá trị đất', '', '', '', 'CONTRACT_DRAFT', ''),
      valuation_house_amount: makeField('Giá trị nhà', '', '', '', 'CONTRACT_DRAFT', ''),
      valuation_total_amount: makeField('Tổng giá trị tài sản', '', '', '', 'CONTRACT_DRAFT', ''),
      contract_draft_saved: makeField('Đã lưu thông tin soạn thảo hợp đồng', '', '', '', 'CONTRACT_DRAFT', ''),
      cif_customer: makeField('CIF khách hàng', '', '', '', 'CONTRACT_DRAFT', ''),
      contract_date: makeField('Ngày hợp đồng', '', '', '', 'CONTRACT_DRAFT', ''),
      contract_sequence: makeField('Số thứ tự hợp đồng', '', '', '', 'CONTRACT_DRAFT', ''),
      actual_asset_differs_from_certificate: makeField('Tài sản thực tế có khác thông tin trên bìa đất không', '', '', '', 'CONTRACT_DRAFT', ''),
      actual_asset_difference_description: makeField('Mô tả phần sai khác giữa tài sản thực tế và bìa đất', '', '', '', 'CONTRACT_DRAFT', ''),
      actual_house_asset: makeField('Tài sản là nhà thực tế nếu sai khác với bìa đất', '', '', '', 'CONTRACT_DRAFT', ''),
      requires_template_5: makeField('Cần lập thêm mẫu 5', '', '', '', 'TEMPLATE_DECISION', ''),
      reason_requires_template_5: makeField('Lý do cần lập thêm mẫu 5', '', '', '', 'TEMPLATE_DECISION', ''),
      template_4_code: makeField('Mã mẫu 4 dự kiến', '', '', '', 'TEMPLATE_DECISION', ''),
      template_5_code: makeField('Mã mẫu 5 dự kiến', '', '', '', 'TEMPLATE_DECISION', '')
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
    const id = normalizeId_(person.id_number && person.id_number.final_value);
    if (!id) return;
    const documentType = person.id_document_type && person.id_document_type.final_value;
    const inferred = extractIssueDateByIdentityNumberFromOcr_(id, ocrTextByFile, documentType);
    if (!inferred.date) return;
    person.id_issue_date.ai_value = inferred.date;
    person.id_issue_date.source = inferred.file_name || person.id_issue_date.source || 'OCR_ID_MATCH';
    person.id_issue_date.confidence = Math.max(Number(person.id_issue_date.confidence || 0), 0.9);
    if (!person.id_issue_date.manual_value) person.id_issue_date.final_value = inferred.date;
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

function extractAreaWordsFromCertificateText_(text) {
  text = String(text || '');
  if (!text) return '';
  const patterns = [
    /\(?\s*B[ăa]ng\s+ch[ữu]\s*:\s*([^\)\r\n]+)\)?/i,
    /\(?\s*Bằng\s+chữ\s*:\s*([^\)\r\n]+)\)?/i,
    /\(?\s*Bang\s+chu\s*:\s*([^\)\r\n]+)\)?/i
  ];
  for (let i = 0; i < patterns.length; i++) {
    const match = text.match(patterns[i]);
    if (match && match[1]) return '(Bằng chữ: ' + String(match[1]).replace(/\s+/g, ' ').trim() + ')';
  }
  const lines = text.split(/\r?\n/);
  for (let j = 0; j < lines.length; j++) {
    const current = removeVietnameseAccents_(lines[j]).toLowerCase();
    if (current.indexOf('dien tich') < 0) continue;
    const joined = [lines[j], lines[j + 1] || '', lines[j + 2] || ''].join(' ');
    const inline = joined.match(/\(?\s*(?:B[ăa]ng\s+ch[ữu]|Bằng\s+chữ|Bang\s+chu)\s*:\s*([^\)]+)\)?/i);
    if (inline && inline[1]) return '(Bằng chữ: ' + String(inline[1]).replace(/\s+/g, ' ').trim() + ')';
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
    full_name: fieldFromAi_('Họ và tên', person.full_name),
    date_of_birth: fieldFromAi_('Ngày sinh', person.date_of_birth),
    gender: fieldFromAi_('Giới tính', person.gender),
    nationality: fieldFromAi_('Quốc tịch', person.nationality),
    id_document_type: fieldFromAi_('Loại giấy tờ tùy thân', person.id_document_type),
    id_number: fieldFromAi_('Số CCCD', person.id_number),
    id_issue_date: fieldFromAi_('Ngày cấp CCCD', person.id_issue_date),
    id_issue_place: fieldFromAi_('Nơi cấp CCCD', person.id_issue_place),
    id_expiry_date: fieldFromAi_('Ngày hết hạn CCCD', person.id_expiry_date),
    permanent_address: fieldFromAi_('Địa chỉ thường trú', person.permanent_address),
    origin_place: fieldFromAi_('Quê quán', person.origin_place),
    vneid_current_address: fieldFromAi_('Địa chỉ cư trú mới từ VNeID', person.vneid_current_address),
    current_address_final: makeField('Địa chỉ sử dụng cuối cùng', '', '', '', '', ''),
    marital_status: fieldFromAi_('Tình trạng hôn nhân', person.marital_status),
    spouse: {
      full_name: fieldFromAi_('Họ tên vợ/chồng', person.spouse && person.spouse.full_name),
      id_number: fieldFromAi_('CCCD vợ/chồng', person.spouse && person.spouse.id_number)
    },
    marriage_registration: normalizeNestedFields_(person.marriage_registration || {}, {
      wife_name: 'Họ tên vợ',
      husband_name: 'Họ tên chồng',
      wife_id_number: 'CCCD vợ',
      husband_id_number: 'CCCD chồng',
      registration_date: 'Ngày đăng ký kết hôn',
      registration_place: 'Nơi đăng ký kết hôn'
    }),
    marital_status_certificate: normalizeNestedFields_(person.marital_status_certificate || {}, {
      full_name: 'Họ tên trên GXN hôn nhân',
      id_number: 'CCCD trên GXN hôn nhân',
      marital_status: 'Tình trạng hôn nhân theo GXN',
      issuing_authority: 'Cơ quan xác nhận',
      confirmation_date: 'Ngày xác nhận'
    })
  };
  normalized.relationship = makeField(
    'Mối quan hệ',
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
    asset_type: fieldFromAi_('Loại tài sản', asset.asset_type),
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
  if (title && !asset.certificate_title.final_value) {
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
    asset.real_estate.certificate_number.final_value = 'Không rõ, đề nghị sửa thủ công';
    asset.real_estate.certificate_number.source = asset.real_estate.certificate_number.source || 'OCR_ASSET_TEXT';
    asset.real_estate.certificate_number.confidence = '';
  }
  const registry = extractRealEstateRegistryNumber_(text);
  if (registry && !asset.real_estate.registry_number.final_value) {
    asset.real_estate.registry_number.ai_value = registry;
    asset.real_estate.registry_number.final_value = registry;
    asset.real_estate.registry_number.source = 'OCR_ASSET_TEXT';
    asset.real_estate.registry_number.confidence = asset.real_estate.registry_number.confidence || 0.72;
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

function shouldReplaceOwnerListField_(field, newValue, expectedCount) {
  if (!field || !newValue) return false;
  if (field.manual_value) return false;
  const current = String(field.final_value || field.ai_value || '').trim();
  if (!current) return true;
  const currentCount = current.split(';').map(function(v) { return v.trim(); }).filter(Boolean).length;
  return expectedCount > currentCount;
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
  const lines = String(block || text || '').split(/\n+/);
  for (let i = 0; i < lines.length; i++) {
    const line = String(lines[i] || '').replace(/\s+/g, ' ').trim();
    const match = line.match(/(?:Äá»‹a\s*chá»‰|Địa\s*chỉ|Dia\s*chi|Address)\s*[:.-]\s*(.+)$/i);
    if (match && match[1]) return cleanupOwnerAddress_(match[1]);
  }
  const compact = lines.map(function(line) {
    return String(line || '').replace(/\s+/g, ' ').trim();
  }).filter(Boolean).join(' ');
  const inline = compact.match(/(?:Äá»‹a\s*chá»‰|Địa\s*chỉ|Dia\s*chi|Address)\s*[:.-]\s*(.+?)(?=\s+(?:II\.|2\.|Thá»­a|Thua|NhÃ |Nha)\b|$)/i);
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
    if (inBlock && i > 0 && /^\s*ii[\s.]/i.test(lines[i])) break;
    if (inBlock) out.push(lines[i]);
  }
  return out.join('\n');
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
  const clean = removeVietnameseAccents_(String(text || '')).toUpperCase().replace(/\s+/g, ' ');
  if (clean.indexOf('QUYEN SU DUNG DAT QUYEN SO HUU NHA O VA TAI SAN KHAC GAN LIEN VOI DAT') >= 0) {
    return 'Giay chung nhan quyen su dung dat, quyen so huu nha o va tai san khac gan lien voi dat';
  }
  if (clean.indexOf('QUYEN SU DUNG DAT QUYEN SO HUU TAI SAN GAN LIEN VOI DAT') >= 0) {
    return 'Giay chung nhan quyen su dung dat, quyen so huu tai san gan lien voi dat';
  }
  if (clean.indexOf('QUYEN SU DUNG DAT') >= 0) {
    return 'Giay chung nhan quyen su dung dat';
  }
  if (clean.indexOf('QUYEN SO HUU NHA O') >= 0) {
    return 'Giay chung nhan quyen so huu nha o';
  }
  return '';
}

function extractRealEstateCertificateNumber_(text) {
  text = String(text || '').replace(/\s+/g, ' ');
  const candidates = text.match(/\b[A-Z?]{1,3}\s*[0-9]{6,9}\b/g) || [];
  for (let i = 0; i < candidates.length; i++) {
    const value = candidates[i].replace(/\s+/g, ' ').trim();
    if (!/^ID\s*\d+/i.test(value)) return normalizeCertificateCodeValue_(value);
  }
  return '';
}

function shouldReplaceCertificateNumber_(field) {
  if (!field) return true;
  const current = String(field.final_value || field.ai_value || '').trim();
  if (!current) return true;
  if (current === 'Không rõ, đề nghị sửa thủ công') return true;
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
  const normalized = removeVietnameseAccents_(String(text || '')).replace(/\s+/g, ' ');
  const direct = normalized.match(/(?:so vao so|vao so cap gcn|so cap gcn|registry)[^A-Z0-9]{0,20}([A-Z]{1,5}\s*[0-9][A-Z0-9.\/-]{1,20})/i);
  if (direct) return normalizeCertificateCodeValue_(direct[1]);
  const candidates = normalized.match(/\b(?:CS|CT|CN|CH|CL|HX|VP|DC|DL)[0-9][A-Z0-9.\/-]{1,20}\b/gi) || [];
  return candidates.length ? normalizeCertificateCodeValue_(candidates[0]) : '';
}
function applyFormPriorityRules_(reviewJson) {
  function applyPersonAddress(person) {
    const vneid = person.vneid_current_address.final_value;
    const permanent = person.permanent_address.final_value;
    const selected = vneid || permanent || '';
    person.current_address_final = makeField(
      'Địa chỉ sử dụng cuối cùng',
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
        message: 'Địa chỉ VNeID khác địa chỉ thường trú CCCD. Hệ thống ưu tiên VNeID, cần người dùng xác nhận.',
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
  if (targetField.final_value === 'Không rõ, đề nghị sửa thủ công') return true;
  const targetConf = Number(targetField.confidence || 0);
  const sourceConf = Number(sourceField.confidence || 0);
  return sourceConf > targetConf && String(sourceField.final_value).length >= String(targetField.final_value).length;
}

function normalizePersonName_(value) {
  value = String(value || '').trim();
  if (!value || value.length < 5 || value === 'Không rõ, đề nghị sửa thủ công') return '';
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
    field.ai_value = 'Bộ Công an';
    field.final_value = 'Bộ Công an';
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
  return digit % 2 === 0 ? 'Nam' : 'Nữ';
}

function normalizeGenderValue_(value) {
  const text = String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (text.indexOf('nam') >= 0 || text.indexOf('male') >= 0) return 'Nam';
  if (text.indexOf('nu') >= 0 || text.indexOf('female') >= 0) return 'Nữ';
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
  if (digits.length === 9) return 'Chứng minh nhân dân';
  if (digits.length === 12) return 'Căn cước công dân';
  return '';
}

function normalizeDocumentTypeValue_(value) {
  const text = String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u0111/g, 'd');
  if (text.indexOf('chung minh nhan dan') >= 0 || /\bcmnd\b/.test(text)) return 'Chứng minh nhân dân';
  if (text.indexOf('can cuoc cong dan') >= 0 || /\bcccd\b/.test(text)) return 'Căn cước công dân';
  if (text.indexOf('can cuoc') >= 0) return 'Căn cước';
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
    return 'Cục Cảnh sát quản lý hành chính về trật tự xã hội';
  }
  if (normalized.indexOf('bo cong an') >= 0 ||
      normalized.indexOf('ministry of public security') >= 0 ||
      normalized.indexOf('public security') >= 0) {
    return 'Bộ Công an';
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
    /(?:ngày\s*cấp|ngay\s*cap|date\s*of\s*issue)\D{0,30}(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})/i,
    /(?:cấp\s*ngày|cap\s*ngay)\D{0,30}(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})/i
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
  let idx = -1;
  for (let i = 0; i < labels.length; i++) {
    const found = normalized.indexOf(labels[i]);
    if (found >= 0 && (idx < 0 || found < idx)) idx = found;
  }
  if (idx < 0) return '';
  const windowText = String(text || '').slice(Math.max(0, idx - 10), idx + 140);
  const match = windowText.match(/(\d{1,2})\D{1,8}(\d{1,2})\D{1,10}(\d{4})/);
  if (!match) return '';
  return normalizeDateValue_(match[1] + '/' + match[2] + '/' + match[3]);
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
  if (match) return pad2_(match[3]) + '/' + pad2_(match[2]) + '/' + match[1];
  match = value.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})$/);
  if (match) return pad2_(match[1]) + '/' + pad2_(match[2]) + '/' + normalizeYear_(match[3]);
  match = value.match(/(?:ngày|ngay|day)?\s*(\d{1,2})\D+(?:tháng|thang|month)?\s*(\d{1,2})\D+(?:năm|nam|year)?\s*(\d{4})/i);
  if (match) return pad2_(match[1]) + '/' + pad2_(match[2]) + '/' + match[3];
  return value;
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
    field.final_value = 'Không rõ, đề nghị sửa thủ công';
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
  ['huyện', 'quận', 'thành phố', 'thị xã', 'tỉnh', 'xã', 'phường', 'thị trấn'].forEach(function(prefix) {
    const re = new RegExp('(' + prefix + '\\s+)([a-zà-ỹ]+)(\\s+([a-zà-ỹ]+))?', 'gi');
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
  ['huy\u1ec7n', 'qu\u1eadn', 'th\u00e0nh ph\u1ed1', 'th\u1ecb x\u00e3', 't\u1ec9nh', 'x\u00e3', 'ph\u01b0\u1eddng', 'th\u1ecb tr\u1ea5n'].forEach(function(prefix) {
    const re = new RegExp('(' + prefix + '\\s+)([^,;]+)', 'gi');
    text = text.replace(re, function(match, p1, rest) {
      return capitalizeVietnameseWord_(p1.trim()) + ' ' +
        String(rest || '').split(/\s+/).map(capitalizeVietnameseWord_).join(' ');
    });
  });
  text = text.replace(/^u\u1ef7 ban/i, '\u1ee6y ban').replace(/^ủy ban/i, '\u1ee6y ban');
  return text;
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
