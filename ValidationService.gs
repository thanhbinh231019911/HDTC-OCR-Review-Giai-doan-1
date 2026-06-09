function validateReviewJson(reviewJson) {
  const missing = [];
  const conflicts = (reviewJson.validation && reviewJson.validation.conflicts) || [];
  const warnings = (reviewJson.validation && reviewJson.validation.warnings) || [];

  if (!(reviewJson.secured_parties || []).length) {
    missing.push({ field_path: 'secured_parties', label: 'Bên bảo đảm', severity: 'CRITICAL' });
  }
  (reviewJson.secured_parties || []).forEach(function(person, i) {
    requireField_(person.full_name, 'secured_parties[' + i + '].full_name', missing);
    requireField_(person.id_number, 'secured_parties[' + i + '].id_number', missing);
  });

  (reviewJson.obligors || []).forEach(function(person, i) {
    requireField_(person.full_name, 'obligors[' + i + '].full_name', missing);
    requireField_(person.id_number, 'obligors[' + i + '].id_number', missing);
  });

  if (!(reviewJson.assets || []).length) {
    missing.push({ field_path: 'assets', label: 'Tài sản bảo đảm', severity: 'CRITICAL' });
  }
  (reviewJson.assets || []).forEach(function(asset, i) {
    requireField_(asset.asset_type, 'assets[' + i + '].asset_type', missing);
    requireField_(asset.owner_name, 'assets[' + i + '].owner_name', missing);
    const type = asset.asset_type.final_value || reviewJson.contract_info.asset_type.final_value || '';
    if (isRealEstateAssetType_(type)) {
      requireField_(asset.real_estate.certificate_number, 'assets[' + i + '].real_estate.certificate_number', missing);
      requireField_(asset.real_estate.land_plot_number, 'assets[' + i + '].real_estate.land_plot_number', missing);
    }
    if (isMovableAssetType_(type)) {
      requireField_(asset.movable.chassis_number, 'assets[' + i + '].movable.chassis_number', missing);
      requireField_(asset.movable.engine_number, 'assets[' + i + '].movable.engine_number', missing);
    }
  });
  suppressOldOwnerDocumentConflicts_(reviewJson, conflicts);
  suppressNoisyIssues_(reviewJson, conflicts, warnings);

  collectLowConfidenceWarnings_(reviewJson, warnings, '');
  suppressNoisyIssues_(reviewJson, conflicts, warnings);

  reviewJson.validation.missing_fields = missing;
  reviewJson.validation.conflicts = conflicts;
  reviewJson.validation.warnings = dedupeWarnings_(warnings);
  reviewJson.validation.status = missing.length || conflicts.length || warnings.length ? 'HAS_ISSUES' : 'OK';
  reviewJson.final_confirmed_data = buildFinalConfirmedData(reviewJson);
  return reviewJson;
}

function requireField_(field, path, missing) {
  if (!field || !String(field.final_value || '').trim()) {
    missing.push({
      field_path: path,
      label: field && field.label ? field.label : path,
      severity: 'CRITICAL'
    });
  }
}

function collectOwnerIdConflict_(reviewJson, asset, index, conflicts) {
  const ownerIds = extractDocumentNumbersForValidation_(asset.owner_id_number && asset.owner_id_number.final_value);
  if (!ownerIds.length) return;
  const securedIds = (reviewJson.secured_parties || [])
    .map(function(person) { return normalizeDigits_(person.id_number && person.id_number.final_value); })
    .filter(Boolean);
  if (!securedIds.length) return;
  const unmatched = ownerIds.filter(function(id) { return securedIds.indexOf(id) < 0; });
  if (!unmatched.length) return;
  const path = 'assets[' + index + '].owner_id_number';
  if (ownerIds.length > 1) {
    conflicts.push({
      field_path: path,
      label: 'So giay to tuy than chu so huu/chu su dung',
      message: 'Giay chung nhan the hien nhieu chu so huu/chu su dung: ' + buildOwnerDisplayForValidation_(asset, ownerIds) + '. Cac so chua khop voi ben bao dam: ' + unmatched.join(', ') + '. Vui long kiem tra dung thu tu ten nguoi - so giay to tren bia dat.',
      severity: 'CRITICAL'
    });
    return;
  }
  const ownerId = unmatched[0];
  if (ownerId.length === 9) {
    const suggested = findSuggestedNewIdForAssetOwner_(reviewJson, asset);
    const warningMessage = suggested
      ? 'Giay chung nhan dang ghi so CMND cu ' + ownerId + '. CMND la giay to tuy than cu; nen doi chieu va thay bang so CCCD/Can cuoc moi da upload: ' + suggested + '.'
      : 'Giay chung nhan dang ghi so CMND cu ' + ownerId + '. CMND la giay to tuy than cu; can doi chieu ho so CCCD/Can cuoc moi va sua thu cong neu can.';
    reviewJson.validation.warnings.push({
      field_path: path,
      label: 'So giay to tuy than chu so huu/chu su dung',
      message: warningMessage,
      source_file: asset.owner_id_number && asset.owner_id_number.source ? asset.owner_id_number.source : ''
    });
    return;
  }
  const exists = (conflicts || []).some(function(item) {
    return item.field_path === path && String(item.message || '').indexOf(ownerId) >= 0;
  });
  if (exists) return;
  conflicts.push({
    field_path: path,
    label: 'So giay to tuy than chu so huu/chu su dung',
    message: 'So giay to tuy than chu so huu/chu su dung tren giay chung nhan la ' + ownerId + ', khong khop voi giay to tuy than cua ben bao dam. Vui long kiem tra lai bia dat va ho so CCCD/Can cuoc.',
    severity: 'CRITICAL'
  });
}

function buildOwnerDisplayForValidation_(asset, ids) {
  if (asset.owner_identity_summary && asset.owner_identity_summary.final_value) return asset.owner_identity_summary.final_value;
  const names = String(asset.owner_name && asset.owner_name.final_value || '').split(';').map(function(v) { return v.trim(); }).filter(Boolean);
  return (ids || []).map(function(id, i) {
    return (names[i] ? names[i] + ' - ' : '') + 'so ' + id;
  }).join('; ');
}
function findSuggestedNewIdForAssetOwner_(reviewJson, asset) {
  const ownerName = normalizeNameForMatch_(asset.owner_name && asset.owner_name.final_value);
  const secured = reviewJson.secured_parties || [];
  if (ownerName) {
    for (let i = 0; i < secured.length; i++) {
      const personName = normalizeNameForMatch_(secured[i].full_name && secured[i].full_name.final_value);
      const id = normalizeDigits_(secured[i].id_number && secured[i].id_number.final_value);
      if (id.length === 12 && personName && (personName === ownerName || personName.indexOf(ownerName) >= 0 || ownerName.indexOf(personName) >= 0)) {
        return id;
      }
    }
  }
  const ids = secured
    .map(function(person) { return normalizeDigits_(person.id_number && person.id_number.final_value); })
    .filter(function(id) { return id.length === 12; });
  return ids.length === 1 ? ids[0] : '';
}

function suppressOldOwnerDocumentConflicts_(reviewJson, conflicts) {
  const oldIds = (reviewJson.assets || [])
    .map(function(asset) { return normalizeDigits_(asset.owner_id_number && asset.owner_id_number.final_value); })
    .filter(function(id) { return id.length === 9; });
  if (!oldIds.length) return;
  for (let i = conflicts.length - 1; i >= 0; i--) {
    const text = [
      conflicts[i].field_path || '',
      conflicts[i].label || '',
      conflicts[i].message || '',
      (conflicts[i].values || []).join(' ')
    ].join(' ');
    const isOldOwnerConflict = oldIds.some(function(id) { return text.indexOf(id) >= 0; }) &&
      /owner|chu|cmnd|cccd|id_number|owner_or_user/i.test(normalizeSearchText_(text));
    if (isOldOwnerConflict) conflicts.splice(i, 1);
  }
}

function suppressNoisyIssues_(reviewJson, conflicts, warnings) {
  const noisy = function(issue) {
    const text = normalizeSearchText_([issue.field_path, issue.label, issue.message].join(' '));
    return text.indexOf('id issue place') >= 0 ||
      text.indexOf('id_issue_place') >= 0 ||
      text.indexOf('issue place') >= 0 ||
      text.indexOf('usage origin') >= 0 ||
      text.indexOf('usage_origin') >= 0 ||
      text.indexOf('nguon goc su dung') >= 0 ||
      text.indexOf('gender') >= 0 ||
      text.indexOf('gioi tinh') >= 0 ||
      text.indexOf('id document type') >= 0 ||
      text.indexOf('id_document_type') >= 0 ||
      text.indexOf('owner id document type') >= 0 ||
      text.indexOf('owner_id_document_type') >= 0 ||
      text.indexOf('giay to nhan dang') >= 0 ||
      text.indexOf('loai giay to tuy than') >= 0 ||
      (text.indexOf('can cuoc') >= 0 && text.indexOf('can cuoc cong dan') >= 0) ||
      text.indexOf('permanent address') >= 0 ||
      text.indexOf('permanent_address') >= 0 ||
      text.indexOf('dia chi thuong tru') >= 0 ||
      text.indexOf('owner identity') >= 0 ||
      text.indexOf('owner_identity') >= 0 ||
      text.indexOf('owner id') >= 0 ||
      text.indexOf('owner_id') >= 0 ||
      text.indexOf('chu so huu') >= 0 ||
      text.indexOf('chu su dung') >= 0 ||
      text.indexOf('dong chu') >= 0;
  };
  removeMatchingIssues_(conflicts, noisy);
  removeMatchingIssues_(warnings, noisy);
}

function removeMatchingIssues_(items, predicate) {
  for (let i = items.length - 1; i >= 0; i--) {
    if (predicate(items[i] || {})) items.splice(i, 1);
  }
}

function normalizeNameForMatch_(value) {
  return String(value || '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u0110/g, 'D')
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeDigits_(value) {
  return String(value || '').replace(/\D/g, '');
}

function extractDocumentNumbersForValidation_(value) {
  const text = String(value || '');
  const out = [];
  text.replace(/(^|\D)(\d{12})(?=\D|$)/g, function(_, prefix, id) {
    if (out.indexOf(id) === -1) out.push(id);
    return _;
  });
  text.replace(/(^|\D)(\d{9})(?=\D|$)/g, function(_, prefix, id) {
    if (out.indexOf(id) === -1) out.push(id);
    return _;
  });
  const dense = normalizeDigits_(text);
  if (!out.length && (dense.length === 9 || dense.length === 12)) out.push(dense);
  if (!out.length && dense.length % 12 === 0 && dense.length <= 36) {
    for (let i = 0; i < dense.length; i += 12) {
      const id = dense.slice(i, i + 12);
      if (id && out.indexOf(id) === -1) out.push(id);
    }
  }
  return out;
}

function collectLowConfidenceWarnings_(obj, warnings, path) {
  if (!obj || typeof obj !== 'object') return;
  if (obj.hasOwnProperty('final_value')) {
    const conf = Number(obj.confidence);
    if (obj.ai_value && !obj.form_value && !obj.manual_value && conf && conf < 0.7) {
      warnings.push({
        field_path: path,
        message: 'OCR/AI có độ tin cậy thấp, cần kiểm tra thủ công.',
        source_file: obj.source || ''
      });
    }
    return;
  }
  Object.keys(obj).forEach(function(key) {
    collectLowConfidenceWarnings_(obj[key], warnings, path ? path + '.' + key : key);
  });
}

function dedupeWarnings_(warnings) {
  const seen = {};
  return (warnings || []).filter(function(w) {
    const key = [w.field_path, w.message, w.source_file].join('|');
    if (seen[key]) return false;
    seen[key] = true;
    return true;
  });
}


function isRealEstateAssetType_(value) {
  const text = normalizeSearchText_(value);
  return text.indexOf('bat dong san') >= 0 || text.indexOf('nha dat') >= 0 || text.indexOf('quyen su dung dat') >= 0;
}

function isMovableAssetType_(value) {
  const text = normalizeSearchText_(value);
  if (isRealEstateAssetType_(value)) return false;
  return text.indexOf('dong san') >= 0 ||
    text.indexOf('xe') >= 0 ||
    text.indexOf('may moc') >= 0 ||
    text.indexOf('phuong tien') >= 0;
}

function normalizeSearchText_(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u0111/g, 'd')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
