function applyTemplateDecisionToReviewJson(reviewJson) {
  if (!reviewJson) return reviewJson;
  ensureTemplateDecisionFields_(reviewJson);
  const contract = reviewJson.contract_info;
  const differs = normalizeYesNo_(getFieldFinalValue_(contract.actual_asset_differs_from_certificate));
  const hasObligorUpload = hasOcrGroupForTemplateDecision_(reviewJson, 'obligor');
  const sameParty = hasObligorUpload ? false : true;
  setFieldValues_(
    contract.contract_type,
    hasObligorUpload
      ? 'B\u00ean b\u1ea3o \u0111\u1ea3m th\u1ebf ch\u1ea5p cho ngh\u0129a v\u1ee5 c\u1ee7a b\u00ean th\u1ee9 ba'
      : 'B\u00ean b\u1ea3o \u0111\u1ea3m th\u1ebf ch\u1ea5p cho ch\u00ednh ngh\u0129a v\u1ee5 c\u1ee7a m\u00ecnh',
    'TEMPLATE_DECISION',
    0.95
  );
  if (contract.asset_type) {
    setFieldValues_(contract.asset_type, inferAssetTypeForTemplateDecision_(reviewJson), 'TEMPLATE_DECISION', 0.95);
  }

  const template4 = sameParty
    ? '03a_bds_chinh_chu'
    : '03b_bds_ben_thu_ba';
  const template5 = sameParty
    ? '03c_bds_ts_chua_chung_nhan_chinh_chu'
    : '03d_bds_ts_chua_chung_nhan_ben_thu_ba';

  setFieldValues_(contract.template_4_code, template4, 'TEMPLATE_DECISION', 0.9);
  if (differs === '\u0043\u00f3') {
    setFieldValues_(contract.requires_template_5, '\u0043\u00f3', 'TEMPLATE_DECISION', 0.95);
    setFieldValues_(contract.reason_requires_template_5, 'T\u00e0i s\u1ea3n th\u1ef1c t\u1ebf kh\u00e1c th\u00f4ng tin tr\u00ean b\u00eca \u0111\u1ea5t theo x\u00e1c nh\u1eadn c\u1ee7a ng\u01b0\u1eddi d\u00f9ng.', 'TEMPLATE_DECISION', 0.95);
    setFieldValues_(contract.template_5_code, template5, 'TEMPLATE_DECISION', 0.9);
  } else if (differs === 'Kh\u00f4ng') {
    setFieldValues_(contract.requires_template_5, 'Kh\u00f4ng', 'TEMPLATE_DECISION', 0.95);
    setFieldValues_(contract.reason_requires_template_5, 'T\u00e0i s\u1ea3n th\u1ef1c t\u1ebf kh\u00f4ng kh\u00e1c th\u00f4ng tin tr\u00ean b\u00eca \u0111\u1ea5t theo x\u00e1c nh\u1eadn c\u1ee7a ng\u01b0\u1eddi d\u00f9ng.', 'TEMPLATE_DECISION', 0.95);
    setFieldValues_(contract.template_5_code, '', 'TEMPLATE_DECISION', '');
  } else {
    setFieldValues_(contract.requires_template_5, '', 'TEMPLATE_DECISION', '');
    setFieldValues_(contract.reason_requires_template_5, 'C\u1ea7n x\u00e1c nh\u1eadn t\u00e0i s\u1ea3n th\u1ef1c t\u1ebf c\u00f3 kh\u00e1c th\u00f4ng tin tr\u00ean b\u00eca \u0111\u1ea5t hay kh\u00f4ng.', 'TEMPLATE_DECISION', 0.5);
    setFieldValues_(contract.template_5_code, '', 'TEMPLATE_DECISION', '');
    addTemplateDecisionWarning_(reviewJson);
  }

  reviewJson.template_selection_preview = {
    stage_2_ready: differs === '\u0043\u00f3' || differs === 'Kh\u00f4ng',
    template_4_required: true,
    template_4_code: template4,
    template_5_required: differs === '\u0043\u00f3',
    template_5_code: differs === '\u0043\u00f3' ? template5 : '',
    obligor_same_as_secured_party: sameParty,
    general_templates_impact: {
      bm_05a_keep_hop_dong_tai_san_row: differs === '\u0043\u00f3',
      authorization_contract_must_mention_template_5: differs === '\u0043\u00f3'
    }
  };
  reviewJson.final_confirmed_data = buildFinalConfirmedData(reviewJson);
  return reviewJson;
}

function ensureTemplateDecisionFields_(reviewJson) {
  if (!reviewJson.contract_info) reviewJson.contract_info = {};
  const contract = reviewJson.contract_info;
  const defaults = {
    actual_asset_differs_from_certificate: 'T\u00e0i s\u1ea3n th\u1ef1c t\u1ebf c\u00f3 kh\u00e1c th\u00f4ng tin tr\u00ean b\u00eca \u0111\u1ea5t kh\u00f4ng',
    actual_asset_difference_description: 'M\u00f4 t\u1ea3 ph\u1ea7n sai kh\u00e1c gi\u1eefa t\u00e0i s\u1ea3n th\u1ef1c t\u1ebf v\u00e0 b\u00eca \u0111\u1ea5t',
    actual_house_asset: 'T\u00e0i s\u1ea3n l\u00e0 nh\u00e0 th\u1ef1c t\u1ebf n\u1ebfu sai kh\u00e1c v\u1edbi b\u00eca \u0111\u1ea5t',
    valuation_land_amount: 'Gi\u00e1 tr\u1ecb \u0111\u1ea5t',
    valuation_house_amount: 'Gi\u00e1 tr\u1ecb nh\u00e0',
    valuation_total_amount: 'T\u1ed5ng gi\u00e1 tr\u1ecb t\u00e0i s\u1ea3n',
    bank_signer_title: 'Ch\u1ee9c v\u1ee5 ng\u01b0\u1eddi k\u00fd',
    bank_unit_address: '\u0110\u1ecba ch\u1ec9 \u0111\u01a1n v\u1ecb ng\u00e2n h\u00e0ng',
    contract_draft_saved: '\u0110\u00e3 l\u01b0u th\u00f4ng tin so\u1ea1n th\u1ea3o h\u1ee3p \u0111\u1ed3ng',
    requires_template_5: 'C\u1ea7n l\u1eadp th\u00eam m\u1eabu 5',
    reason_requires_template_5: 'L\u00fd do c\u1ea7n l\u1eadp th\u00eam m\u1eabu 5',
    template_4_code: 'M\u00e3 m\u1eabu 4 d\u1ef1 ki\u1ebfn',
    template_5_code: 'M\u00e3 m\u1eabu 5 d\u1ef1 ki\u1ebfn'
  };
  Object.keys(defaults).forEach(function(key) {
    if (!contract[key] || typeof contract[key] !== 'object' || !contract[key].hasOwnProperty('final_value')) {
      contract[key] = makeField(defaults[key], '', '', '', 'CONTRACT_DRAFT', '');
    } else {
      contract[key].label = defaults[key];
    }
  });
  return reviewJson;
}

function addTemplateDecisionWarning_(reviewJson) {
  reviewJson.validation = reviewJson.validation || {};
  reviewJson.validation.warnings = reviewJson.validation.warnings || [];
  const exists = reviewJson.validation.warnings.some(function(warning) {
    return warning && warning.field_path === 'contract_info.actual_asset_differs_from_certificate';
  });
  if (exists) return;
  reviewJson.validation.warnings.push({
    field_path: 'contract_info.actual_asset_differs_from_certificate',
    message: 'C\u1ea7n x\u00e1c nh\u1eadn t\u00e0i s\u1ea3n th\u1ef1c t\u1ebf c\u00f3 kh\u00e1c th\u00f4ng tin tr\u00ean b\u00eca \u0111\u1ea5t hay kh\u00f4ng tr\u01b0\u1edbc khi ch\u1ecdn m\u1eabu h\u1ee3p \u0111\u1ed3ng.',
    source_file: 'CONTRACT_DRAFT'
  });
}

function isObligorSameAsSecuredParty_(securedParties, obligors) {
  const securedIds = collectPersonIds_(securedParties);
  const obligorIds = collectPersonIds_(obligors);
  if (!securedIds.length || !obligorIds.length) return false;
  if (securedIds.length !== obligorIds.length) return false;
  return obligorIds.every(function(id) { return securedIds.indexOf(id) >= 0; });
}

function collectPersonIds_(people) {
  return (people || []).map(function(person) {
    return normalizeId_(getFieldFinalValue_(person.id_number));
  }).filter(Boolean).sort();
}

function hasOcrGroupForTemplateDecision_(reviewJson, group) {
  return (reviewJson.ocr_results || []).some(function(item) {
    return item && item.group === group;
  });
}

function inferAssetTypeForTemplateDecision_(reviewJson) {
  const assets = reviewJson.assets || [];
  const first = assets[0] || {};
  const raw = getFieldFinalValue_(first.asset_type) || getFieldFinalValue_(first.real_estate && first.real_estate.certificate_number);
  const text = removeVietnameseAccents_(String(raw || '').toLowerCase());
  if (text.indexOf('movable') >= 0 || text.indexOf('dong san') >= 0) return '\u0110\u1ed9ng s\u1ea3n';
  return 'B\u1ea5t \u0111\u1ed9ng s\u1ea3n';
}

function getFieldFinalValue_(field) {
  if (!field) return '';
  if (typeof field === 'object' && field.hasOwnProperty('final_value')) return field.final_value || '';
  return field || '';
}

function setFieldValues_(field, value, source, confidence) {
  if (!field) return;
  field.ai_value = value || '';
  field.final_value = value || '';
  field.source = source || field.source || '';
  field.confidence = confidence === undefined ? field.confidence : confidence;
}

function normalizeYesNo_(value) {
  const text = removeVietnameseAccents_(String(value || '').toLowerCase()).trim();
  if (text === 'co' || text === 'yes' || text === 'true') return '\u0043\u00f3';
  if (text === 'khong' || text === 'no' || text === 'false') return 'Kh\u00f4ng';
  return '';
}
