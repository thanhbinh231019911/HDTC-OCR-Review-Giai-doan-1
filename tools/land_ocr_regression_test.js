const assert = require('assert');

const fs = require('fs');
const vm = require('vm');

function removeVietnameseAccents_(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u0111/g, 'd')
    .replace(/\u0110/g, 'D');
}

function shouldReclassifyOcrAsLandAsset_(text) {
  const normalized = removeVietnameseAccents_(String(text || ''))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const looksLikeIdentityCard = normalized.indexOf('can cuoc cong dan') >= 0 ||
    normalized.indexOf('chung minh nhan dan') >= 0 ||
    normalized.indexOf('noi thuong tru') >= 0 && normalized.indexOf('ngay sinh') >= 0;
  if (looksLikeIdentityCard) return false;
  let score = 0;
  if (normalized.indexOf('giay chung nhan') >= 0) score += 3;
  if (normalized.indexOf('quyen su dung dat') >= 0) score += 3;
  if (normalized.indexOf('quyen so huu nha o') >= 0) score += 2;
  if (normalized.indexOf('thua dat') >= 0) score += 2;
  if (normalized.indexOf('to ban do') >= 0) score += 2;
  if (normalized.indexOf('dien tich') >= 0 && normalized.indexOf('hinh thuc su dung') >= 0) score += 2;
  if (normalized.indexOf('so vao so cap gcn') >= 0 || normalized.indexOf('so vao so cap giay chung nhan') >= 0) score += 2;
  if (normalized.indexOf('so tai nguyen') >= 0 && normalized.indexOf('moi truong') >= 0) score += 1;
  return score >= 4;
}

function reclassifyOcrFileMetaByContent_(fileMeta, text) {
  if (!shouldReclassifyOcrAsLandAsset_(text)) return fileMeta;
  const updated = Object.assign({}, fileMeta || {});
  updated.group = 'asset';
  updated.fileName = String(updated.fileName || '').replace(/^(?:secured_party|obligor)__/, 'asset__');
  return updated;
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

function oneLineCertificateValue(value) {
  return String(value || '').replace(/\r?\n+/g, ' ').replace(/\s+/g, ' ').trim();
}

function truncateCertificateNoteValue(value) {
  return String(value || '')
    .replace(/\s+(?:sá»‘|so)\s+v(?:Ã o|ao)\s+s(?:á»•|á»‘|o)\s+c(?:áº¥p|ap)\s+(?:gcn|gi(?:áº¥y|ay)\s+ch(?:á»©ng|ung)\s+nh(?:áº­n|an))\b.*$/i, '')
    .replace(/\s+iv\s*[\).:]?\s*nh(?:á»¯ng|ung)\s+thay\s+(?:Ä‘á»•i|doi)\b.*$/i, '')
    .trim();
}

function normalizeNumberedCertificateItemValue(value, number) {
  let text = oneLineCertificateValue(value).replace(/[.ã€‚]+$/g, '').trim();
  if (number === 6) text = text.replace(/^(?:ghi\s*chÃº|ghi\s*chu)\s*[:;.-]?\s*/i, '').trim();
  if (number === 6) text = truncateCertificateNoteValue(text);
  return text.replace(/^[;:.,\-\s]+|[;:.,\-\s]+$/g, '').trim();
}

function findSemanticLandFieldValue_(text, normalizedAliases) {
  const source = String(text || '').replace(/\r?\n+/g, ' ').replace(/\s+/g, ' ').trim();
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

function normalizeCertificateIndexLine_(line) {
  return removeVietnameseAccents_(String(line || ''))
    .toLowerCase()
    .replace(/[.:)\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function selectBestLandPlotText_(text) {
  const source = String(text || '');
  const lines = source.split(/\r?\n/);
  let best = { text: '', score: 0, trusted: false, layout: 'unknown' };
  for (let i = 0; i < lines.length; i++) {
    const normalized = normalizeCertificateIndexLine_(lines[i]);
    const isOldAnchor = normalized.indexOf('ii thua dat') >= 0 || normalized.indexOf('1 thua dat') >= 0 || normalized.indexOf('thua dat so') >= 0;
    const isNewA4Anchor = normalized.indexOf('2 thong tin thua dat') >= 0;
    if (!isOldAnchor && !isNewA4Anchor) continue;
    const out = [];
    for (let j = i; j < lines.length; j++) {
      const current = normalizeCertificateIndexLine_(lines[j]);
      if (j > i && current.indexOf('iv nhung thay doi') >= 0) break;
      if (j > i && current.indexOf('4 so do thua dat') >= 0) break;
      out.push(lines[j]);
      if (isOldAnchor && j > i && /^(?:6|ghi chu)\b/.test(current) && out.length > 3) break;
    }
    const candidate = out.join('\n');
    const score = scoreLandPlotTextCandidate_(candidate);
    if (score > best.score) best = {
      text: candidate,
      score,
      trusted: score >= 6,
      layout: isNewA4Anchor ? 'gcn_qsdd_qsh_tsglvd_page_1' : classifyOldStyleLandLayout_(candidate),
      reason: isNewA4Anchor ? 'line_anchor_2 thong tin thua dat' : 'line_anchor_old_style'
    };
  }
  return best;
}

function classifyLandCertificatePageText_(value) {
  const normalized = removeVietnameseAccents_(String(value || '')).toLowerCase().replace(/[.:)\-]+/g, ' ').replace(/\s+/g, ' ').trim();
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
  return Object.keys(scores).reduce((best, layout) => scores[layout] > best.score ? { layout, score: scores[layout] } : best, { layout: 'unknown', score: 0 });
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

function scoreLandPlotTextCandidate_(value) {
  const normalized = removeVietnameseAccents_(String(value || '')).toLowerCase().replace(/\s+/g, ' ').trim();
  const classified = classifyLandCertificatePageText_(value);
  let score = 0;
  if (classified.layout === 'gcn_qsdd_qsh_tsglvd_page_1') score += classified.score;
  if (normalized.indexOf('ii thua dat') >= 0) score += 2;
  if (normalized.indexOf('2 thong tin thua dat') >= 0) score += 3;
  if (normalized.indexOf('1 thua dat') >= 0) score += 2;
  if (normalized.indexOf('thua dat so') >= 0) score += 2;
  ['to ban do', 'dien tich', 'loai dat', 'hinh thuc su dung', 'muc dich su dung', 'thoi han su dung', 'nguon goc su dung'].forEach(label => {
    if (normalized.indexOf(label) >= 0) score += 1;
  });
  if (normalized.indexOf('dia chi thuong tru') >= 0) score -= 3;
  if (normalized.indexOf('iv nhung thay doi') >= 0) score -= 1;
  return score;
}

function normalizeRealEstateAreaValue_(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  const match = text.match(/([0-9]+(?:[,.][0-9]+)?)\s*m(?:2|Â²)?/i);
  return match ? match[1] + ' mÂ²' : '';
}

function normalizeRealEstateUsageForm_(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeRealEstateUsageTerm_(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function cleanupUsageOriginCertificateValue_(value) {
  return accentUsageOriginCertificateValue_(String(value || '')
    .replace(/\r?\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+(?:2|3|4|5|6)\s*[\).:]\s*(?:nha\s*o|cong\s*trinh|rung|cay|ghi\s*chu)\b.*$/i, '')
    .replace(/\s+iv\s*[\).:]?\s*nhung\s+thay\s+doi.*$/i, '')
    .replace(/[;,.:\-\s]+$/g, '')
    .trim());
}

function accentUsageOriginCertificateValue_(value) {
  let text = String(value || '').replace(/\s+/g, ' ').trim();
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

function hasOtherLandFieldLabel_(normalizedText) {
  const text = String(normalizedText || '').toLowerCase();
  return text.indexOf('dien tich') >= 0 ||
    text.indexOf('hinh thuc su dung') >= 0 ||
    text.indexOf('muc dich su dung') >= 0 ||
    text.indexOf('thoi han su dung') >= 0 ||
    text.indexOf('nguon goc su dung') >= 0 ||
    /\b[0-9]+(?:[,.][0-9]+)?\s*m(?:2|Â²)?\b/i.test(text);
}

function shouldReplaceUsageForm_(field, candidate) {
  const current = String(field.final_value || field.ai_value || '').trim();
  if (!current) return true;
  const currentNorm = removeVietnameseAccents_(current).toLowerCase().replace(/\s+/g, ' ').trim();
  const candidateNorm = removeVietnameseAccents_(candidate).toLowerCase().replace(/\s+/g, ' ').trim();
  if (!currentNorm || !candidateNorm || currentNorm === candidateNorm) return false;
  if (currentNorm.indexOf(candidateNorm) >= 0 && current.length > candidate.length + 8) return true;
  if (candidateNorm.indexOf(currentNorm) >= 0) return true;
  return hasOtherLandFieldLabel_(currentNorm);
}

function shouldReplaceUsageTerm_(field, candidate) {
  const current = String(field.final_value || field.ai_value || '').trim();
  if (!current) return true;
  const currentNorm = removeVietnameseAccents_(current).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const candidateNorm = removeVietnameseAccents_(candidate).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (!currentNorm || !candidateNorm || currentNorm === candidateNorm) return current !== candidate;
  if (currentNorm.indexOf(candidateNorm) >= 0 && current.length > candidate.length + 8) return true;
  return hasOtherLandFieldLabel_(currentNorm);
}

function isUnsafeLandAddressValue_(value) {
  const normalized = removeVietnameseAccents_(String(value || '')).toLowerCase().replace(/\s+/g, ' ').trim();
  return normalized.indexOf('dia chi thuong tru') >= 0 ||
    normalized.indexOf('thuong tru') >= 0 ||
    normalized.indexOf('cmnd') >= 0 ||
    normalized.indexOf('cccd') >= 0 ||
    /\bco\s*\d{5,}\b/i.test(normalized) ||
    containsLaterLandCertificateContext_(normalized);
}

function isUnsafeIndexedLandFieldValue_(value) {
  const normalized = removeVietnameseAccents_(String(value || '')).toLowerCase().replace(/\s+/g, ' ').trim();
  return containsLaterLandCertificateContext_(normalized) ||
    normalized.indexOf('so tai nguyen') >= 0 ||
    normalized.indexOf('giam doc') >= 0 ||
    normalized.indexOf('so vao so') >= 0;
}

function containsLaterLandCertificateContext_(normalized) {
  const text = String(normalized || '');
  return text.indexOf('thoi han su dung') >= 0 ||
    text.indexOf('nguon goc su dung') >= 0 ||
    text.indexOf('muc dich su dung') >= 0 ||
    text.indexOf('hinh thuc su dung') >= 0 ||
    text.indexOf('nha o') >= 0 ||
    text.indexOf('cong trinh') >= 0 ||
    text.indexOf('ghi chu') >= 0 ||
    text.indexOf('iv nhung thay doi') >= 0;
}

function extractRealEstateIndexedLandFields_(text) {
  const selected = selectBestLandPlotText_(text);
  const source = selected.text || text;
  if (selected.layout === 'gcn_qsdd_qsh_tsglvd_page_1' && normalizeCertificateIndexLine_(source).indexOf('2 thong tin thua dat') >= 0) {
    return {
      area: normalizeRealEstateAreaValue_(findSemanticLandFieldValue_(source, ['dien tich'])),
      usage_form: normalizeRealEstateUsageForm_(findSemanticLandFieldValue_(source, ['hinh thuc su dung'])),
      usage_purpose: findSemanticLandFieldValue_(source, ['loai dat']),
      usage_term: normalizeRealEstateUsageTerm_(findSemanticLandFieldValue_(source, ['thoi han su dung'])),
      usage_origin: '',
      land_address: findSemanticLandFieldValue_(source, ['dia chi']),
      _quality: selected
    };
  }
  return {
    area: normalizeRealEstateAreaValue_(findSemanticLandFieldValue_(source, ['dien tich'])),
    usage_form: normalizeRealEstateUsageForm_(findSemanticLandFieldValue_(source, ['hinh thuc su dung'])),
    usage_purpose: findSemanticLandFieldValue_(source, ['muc dich su dung']),
    usage_term: normalizeRealEstateUsageTerm_(findSemanticLandFieldValue_(source, ['thoi han su dung'])),
    usage_origin: cleanupUsageOriginCertificateValue_(findSemanticLandFieldValue_(source, ['nguon goc su dung'])),
    _quality: selected
  };
}

const landOcrText = `
GIAY CHUNG NHAN
QUYEN SU DUNG DAT
II. Thua dat, nha o va tai san khac gan lien voi dat
1. Thua dat:
a) Thua dat so: 1622 to ban do so: 10
b) Dia chi: xa Su Ngoi, thanh pho Hoa Binh, tinh Hoa Binh
c) Dien tich: 108,0m2 (Bang chu: mot tram linh tam phay khong met vuong)
d) Hinh thuc su dung: Su dung rieng
đ) Muc dich su dung: Dat o tai nong thon
e) Thoi han su dung: Lau dai
g) Nguon goc su dung: Nhan chuyen nhuong dat duoc Nha nuoc giao dat co thu tien su dung dat
`;

const fields = extractRealEstateIndexedLandFields_(landOcrText);
assert.strictEqual(fields.usage_form, 'Su dung rieng');
assert.strictEqual(fields.usage_purpose, 'Dat o tai nong thon');
assert.strictEqual(fields.usage_term, 'Lau dai');
assert.strictEqual(
  fields.usage_origin,
  'Nh\u1eadn chuy\u1ec3n nh\u01b0\u1ee3ng \u0111\u1ea5t \u0111\u01b0\u1ee3c Nh\u00e0 n\u01b0\u1edbc giao \u0111\u1ea5t c\u00f3 thu ti\u1ec1n s\u1eed d\u1ee5ng \u0111\u1ea5t'
);
assert.strictEqual(fields.area, '108,0 mÂ²');
assert.strictEqual(shouldReplaceUsageForm_({ final_value: 'Su dung rieng ) Muc dich su dung: Dat o tai nong thon' }, fields.usage_form), true);
assert.strictEqual(shouldReplaceUsageTerm_({ final_value: 'Dien tich: 108,0m2 (Bang chu: mot tram linh tam phay khong met vuong)' }, fields.usage_term), true);
assert.strictEqual(cleanupSemanticLandFieldValue_('Su dung rieng d'), 'Su dung rieng');
assert.strictEqual(
  normalizeNumberedCertificateItemValue('Ghi chu: Khong So vao so cap GCN: 027 coquan co 15.00 m', 6),
  'Khong'
);
assert.strictEqual(
  normalizeNumberedCertificateItemValue('Ghi chu: Khong So vao so cap GCN: 027 coquan co 15.00 m', 6),
  'Khong'
);
assert.strictEqual(
  cleanupUsageOriginCertificateValue_('Nhan chuyen nhuong dat duoc Nha nuoc giao dat co thu tien su dung dat'),
  'Nh\u1eadn chuy\u1ec3n nh\u01b0\u1ee3ng \u0111\u1ea5t \u0111\u01b0\u1ee3c Nh\u00e0 n\u01b0\u1edbc giao \u0111\u1ea5t c\u00f3 thu ti\u1ec1n s\u1eed d\u1ee5ng \u0111\u1ea5t'
);
assert.strictEqual(
  cleanupUsageOriginCertificateValue_('Nh\u1eadn chuy\u1ec3n nh\u01b0\u1ee3ng \u0111\u1ea5t \u0111\u01b0\u1ee3c Nh\u00e0 n\u01b0\u1edbc giao \u0111\u1ea5t co thu tien su dung dat'),
  'Nh\u1eadn chuy\u1ec3n nh\u01b0\u1ee3ng \u0111\u1ea5t \u0111\u01b0\u1ee3c Nh\u00e0 n\u01b0\u1edbc giao \u0111\u1ea5t c\u00f3 thu ti\u1ec1n s\u1eed d\u1ee5ng \u0111\u1ea5t'
);
assert.strictEqual(
  cleanupUsageOriginCertificateValue_('Nh\u1eadn chuy\u1ec3n nh\u01b0\u1ee3ng \u0111\u1ea5t \u0111\u01b0\u1ee3c Nh\u00e0 n\u01b0\u1edbc giao \u0111\u1ea5t c\u00f3 thu ti\u1ec1n s\u1eed dung \u0111\u1ea5t'),
  'Nh\u1eadn chuy\u1ec3n nh\u01b0\u1ee3ng \u0111\u1ea5t \u0111\u01b0\u1ee3c Nh\u00e0 n\u01b0\u1edbc giao \u0111\u1ea5t c\u00f3 thu ti\u1ec1n s\u1eed d\u1ee5ng \u0111\u1ea5t'
);
assert.strictEqual(fixVietnameseUsageWord_('Ngu\u1ed3n g\u1ed1c s\u1eed dung'), 'Ngu\u1ed3n g\u1ed1c s\u1eed d\u1ee5ng');
const noisyTwoPageText = `
I. Nguoi su dung dat, chu so huu nha o va tai san khac gan lien voi dat
Ba: Dang Thi Quynh
Dia chi thuong tru: Tinh Nhue, Thanh Son, tinh Phu Tho
II. Thua dat, nha o va tai san khac gan lien voi dat
1. Thua dat:
a) Thua dat so: 1623 to ban do so: 10
b) Dia chi: xa Su Ngoi, thanh pho Hoa Binh, tinh Hoa Binh
c) Dien tich: 150,0m2
d) Hinh thuc su dung: Su dung rieng
đ) Muc dich su dung: Dat o tai nong thon
e) Thoi han su dung: Lau dai
g) Nguon goc su dung: Nhan chuyen nhuong dat duoc Nha nuoc giao dat co thu tien su dung dat
2. Nha o: -/-
IV. Nhung thay doi sau khi cap Giay chung nhan
`;
const noisyFields = extractRealEstateIndexedLandFields_(noisyTwoPageText);
assert.strictEqual(noisyFields._quality.trusted, true);
assert.strictEqual(noisyFields.usage_purpose, 'Dat o tai nong thon');
assert.strictEqual(isUnsafeLandAddressValue_('Dia chi thuong tru: Tinh Nhue, Thanh Son, tinh Phu Tho. CO 402508'), true);
assert.strictEqual(isUnsafeIndexedLandFieldValue_('Dat o tai nong thon Thoi han su dung: Lau dai Nguon goc su dung: Nhan chuyen nhuong dat'), true);
const newA4Page1Text = `
GIAY CHUNG NHAN
QUYEN SU DUNG DAT, QUYEN SO HUU TAI SAN GAN LIEN VOI DAT
1. Nguoi su dung dat, chu so huu tai san gan lien voi dat:
Ong: Nguyen Viet Trong, CCCD: 017065002419
Va vo: Le Thi Hue, CCCD: 001166034340
2. Thong tin thua dat:
a. Thua dat so: 100 ; to ban do so: 40
b. Dien tich: 1441,9 m2
c. Loai dat: Dat o tai nong thon: 400,0 m2; Dat trong cay lau nam: 1041,9 m2
d. Thoi han su dung: Dat o tai nong thon: Lau dai; Dat trong cay lau nam: Den thang 10/2045
đ. Hinh thuc su dung: Su dung chung cua vo va chong
e. Dia chi: Xom Giua, xa Lien Son, tinh Phu Tho
3. Thong tin tai san gan lien voi dat: -/-
`;
const newA4Fields = extractRealEstateIndexedLandFields_(newA4Page1Text);
assert.strictEqual(classifyLandCertificatePageText_(newA4Page1Text).layout, 'gcn_qsdd_qsh_tsglvd_page_1');
assert.strictEqual(newA4Fields._quality.layout, 'gcn_qsdd_qsh_tsglvd_page_1');
assert.strictEqual(newA4Fields._quality.trusted, true);
assert.strictEqual(newA4Fields.area, '1441,9 mÂ²');
assert.strictEqual(newA4Fields.usage_purpose, 'Dat o tai nong thon: 400,0 m2; Dat trong cay lau nam: 1041,9 m2');
assert.strictEqual(newA4Fields.usage_term, 'Dat o tai nong thon: Lau dai; Dat trong cay lau nam: Den thang 10/2045');
assert.strictEqual(newA4Fields.usage_form, 'Su dung chung cua vo va chong');
assert.strictEqual(newA4Fields.land_address, 'Xom Giua, xa Lien Son, tinh Phu Tho');
const newA4FullAndLeftRegions = `
[LAND_OCR_REGION layout=gcn_qsdd_qsh_tsglvd_page_1 score=12 region=full]
2. Thong tin thua dat:
a. Thua dat so: 100 ; to ban do so: 40
b. Dien tich: 1441,9 m2
c. Loai dat: Dat o tai nong thon: 400,0 m2; Dat trong cay lau nam: 1041,9 m2
d. Thoi han su dung: Dat o tai nong thon: Lau dai; Dat trong cay lau nam: Den thang 10/2045
d. Hinh thuc su dung: Su dung chung cua vo va chong
e. Dia chi: Xom Giua, xa Lien Son, tinh Phu Tho
3. Thong tin tai san gan lien voi dat: -/-
[/LAND_OCR_REGION]
[LAND_OCR_REGION layout=gcn_qsdd_qsh_tsglvd_page_1 score=12 region=left]
2. Thong tin thua dat:
a. Thua dat so: 100 ; to ban do so: 40
b. Dien tich: 1441,9 m2
c. Loai dat:
d. Thoi han su dung:
d. Hinh thuc su dung: Su dung chung cua vo va chong
e. Dia chi: Xom Giua, xa Lien Son, tinh Phu Tho
[/LAND_OCR_REGION]
`;
const newA4FullRegionFields = extractRealEstateIndexedLandFields_(newA4FullAndLeftRegions);
assert.strictEqual(newA4FullRegionFields.usage_purpose, 'Dat o tai nong thon: 400,0 m2; Dat trong cay lau nam: 1041,9 m2');
assert.strictEqual(newA4FullRegionFields.usage_term, 'Dat o tai nong thon: Lau dai; Dat trong cay lau nam: Den thang 10/2045');
assert.strictEqual(classifyLandCertificatePageText_('4. So do thua dat, tai san gan lien voi dat\\n5. Ghi chu: -/-\\n6. Nhung thay doi sau khi cap Giay chung nhan').layout, 'gcn_qsdd_qsh_tsglvd_page_2');
assert.strictEqual(classifyLandCertificatePageText_('IV. Nhung thay doi sau khi cap Giay chung nhan\\nNoi dung thay doi va co so phap ly').layout, 'gcn_qsdd_qsh_nha_o_va_tsk_change');
assert.strictEqual(
  classifyLandCertificatePageText_('GIAY CHUNG NHAN QUYEN SU DUNG DAT DH666866').layout,
  'gcn_qsdd_cover'
);
assert.strictEqual(
  classifyLandCertificatePageText_('GIAY CHUNG NHAN QUYEN SU DUNG DAT QUYEN SO HUU NHA O VA TAI SAN KHAC GAN LIEN VOI DAT CO402508').layout,
  'gcn_qsdd_qsh_nha_o_va_tsk_cover'
);
assert.strictEqual(
  classifyLandCertificatePageText_('GIAY CHUNG NHAN QUYEN SU DUNG DAT, QUYEN SO HUU TAI SAN GAN LIEN VOI DAT 2. THONG TIN THUA DAT c. LOAI DAT').layout,
  'gcn_qsdd_qsh_tsglvd_page_1'
);

const fileMeta = reclassifyOcrFileMetaByContent_({
  group: 'secured_party',
  fileName: 'secured_party__bia 1-1.jpg'
}, landOcrText);
assert.strictEqual(fileMeta.group, 'asset');
assert.strictEqual(fileMeta.fileName, 'asset__bia 1-1.jpg');

const dataMergeContext = { console };
vm.createContext(dataMergeContext);
vm.runInContext(fs.readFileSync('DataMergeService.gs', 'utf8'), dataMergeContext);
vm.runInContext(fs.readFileSync('ReviewService.gs', 'utf8'), dataMergeContext);
assert.strictEqual(
  dataMergeContext.normalizeRealEstateUsageForm_('Sử dụng riêng 2 Đường bê tông'),
  'Sử dụng riêng'
);
assert.strictEqual(
  dataMergeContext.normalizeRealEstateUsageForm_('Sử dụng riêng: 100 m²; Sử dụng chung: 20 m²'),
  'Sử dụng riêng: 100 m²; Sử dụng chung: 20 m²'
);
assert.strictEqual(
  dataMergeContext.isVerifiedLandLabelField_({ source: 'AUTO_OCR_LAND_LABEL_CROP_V1' }),
  true
);
assert.strictEqual(
  dataMergeContext.isVerifiedLandLabelField_({ source: 'AUTO_OCR_LAND_LABEL_CROP_V2_thua_dat_so' }),
  true
);
assert.strictEqual(
  dataMergeContext.isVerifiedLandLabelField_({ source: 'AUTO_OCR_LAND_PAGE_REGION_CROP_V2' }),
  true
);
assert.strictEqual(
  dataMergeContext.isVerifiedA4GeometryField_({ source: 'AUTO_OCR_LAND_LABEL_CROP_V1' }),
  false
);
const protectedLabelField = {
  ai_value: 'Focused crop value',
  final_value: 'Focused crop value',
  manual_value: '',
  source: 'AUTO_OCR_LAND_LABEL_CROP_V1'
};
dataMergeContext.replaceFromTrustedLandBlock_(protectedLabelField, 'Whole OCR value');
assert.strictEqual(protectedLabelField.final_value, 'Focused crop value');
const productionA4FullRegionFields = dataMergeContext.extractRealEstateIndexedLandFields_(newA4FullAndLeftRegions);
assert.strictEqual(productionA4FullRegionFields._quality.reason, 'vision_region_full');
assert.strictEqual(productionA4FullRegionFields.usage_purpose, 'Dat o tai nong thon: 400,0 m²; Dat trong cay lau nam: 1041,9 m²');
assert.strictEqual(productionA4FullRegionFields.usage_term, 'Dat o tai nong thon: Lâu dài; Dat trong cay lau nam: Den thang 10/2045');
assert.strictEqual(
  dataMergeContext.classifyLandCertificatePageText_('4. Sơ đồ thửa đất, tài sản gắn liền với đất\n5. Ghi chú: Không\n6. Những thay đổi sau khi cấp Giấy chứng nhận\nNội dung thay đổi và cơ sở pháp lý').layout,
  'gcn_qsdd_qsh_tsglvd_page_2'
);

const labeledA4AttachedAssetText = `
GIẤY CHỨNG NHẬN QUYỀN SỬ DỤNG ĐẤT, QUYỀN SỞ HỮU TÀI SẢN GẮN LIỀN VỚI ĐẤT
1. Người sử dụng đất, chủ sở hữu tài sản gắn liền với đất:
Bà: Đỗ Hồng Minh, CCCD: 017173000973
Và chồng: Đỗ Thanh Tuân, CCCD: 001070022821
2. Thông tin thửa đất:
a. Thửa đất số: 798; tờ bản đồ số: 7
3. Thông tin tài sản gắn liền với đất:
a. Tên tài sản: Nhà ở riêng lẻ
c. Hình thức sở hữu: Sở hữu chung
b. Diện tích sử dụng: 226 m2
d. Thời hạn sở hữu: -/-
Lạc Thủy, ngày 11 tháng 6 năm 2025
`;
const labeledAttached = dataMergeContext.extractNewA4AttachedAssetFields_(labeledA4AttachedAssetText);
assert.strictEqual(labeledAttached.name, 'Nhà ở riêng lẻ');
assert(/^226 m/.test(labeledAttached.area));
assert.strictEqual(labeledAttached.ownership_form, 'Sở hữu chung');
assert.strictEqual(labeledAttached.ownership_term, '-/-');
assert.strictEqual(labeledAttached.state, 'detailed');
const husbandPair = dataMergeContext.extractOwnerIdentityPairs_(labeledA4AttachedAssetText)[1];
assert.strictEqual(husbandPair.raw_text, 'Và chồng: Đỗ Thanh Tuân, CCCD: 001070022821');

const newA4PdfText = `
[LAND_OCR_REGION layout=gcn_qsdd_qsh_tsglvd_page_1 score=11 region=full]
GIAY CHUNG NHAN
QUYEN SU DUNG DAT, QUYEN SO HUU TAI SAN GAN LIEN VOI DAT
1. Nguoi su dung dat, chu so huu tai san gan lien voi dat:
Ong: Nguyen Viet Trong, CCCD: 017065002419
Va vo: Le Thi Hue, CCCD: 001166034340
2. Thong tin thua dat:
a. Thua dat so: 100 ; to ban do so: 40
b. Dien tich: 1441,9 m2
c. Loai dat: Dat o tai nong thon: 400,0 m2; Dat trong cay lau nam: 1041,9 m2
d. Thoi han su dung: Dat o tai nong thon: Lau dai; Dat trong cay lau nam: Den thang 10/2045
d. Hinh thuc su dung: Su dung chung cua vo va chong
e. Dia chi: Xom Giua, xa Lien Son, tinh Phu Tho
3. Thong tin tai san gan lien voi dat: -/-
Phu Tho, ngay 04 thang 7 nam 2025
CHI NHANH VAN PHONG DANG KY DAT DAI LUONG SON
[/LAND_OCR_REGION]
[LAND_OCR_REGION layout=gcn_qsdd_qsh_tsglvd_page_2 score=8 region=full]
4. So do thua dat, tai san gan lien voi dat:
5. Ghi chu: -/-
6. Nhung thay doi sau khi cap Giay chung nhan:
Noi dung thay doi va co so phap ly
Xac nhan cua co quan co tham quyen
So vao so cap Giay chung nhan: ............CN.5.42.9............
[/LAND_OCR_REGION]
`;
const a4PdfFields = dataMergeContext.extractRealEstateIndexedLandFields_(newA4PdfText);
assert.strictEqual(a4PdfFields.land_plot_number, '100');
assert.strictEqual(a4PdfFields.map_sheet_number, '40');
assert(/^1441,9 m/.test(a4PdfFields.area));
assert.strictEqual(a4PdfFields.usage_purpose, 'Dat o tai nong thon: 400,0 m²; Dat trong cay lau nam: 1041,9 m²');
assert.strictEqual(a4PdfFields.usage_term, 'Dat o tai nong thon: L\u00e2u d\u00e0i; Dat trong cay lau nam: Den thang 10/2045');
assert.strictEqual(a4PdfFields.usage_form, 'Su dung chung cua vo va chong');
assert.strictEqual(a4PdfFields.land_address, 'Xom Giua, xa Lien Son, tinh Phu Tho');
const newA4WithOwnerAddress = newA4PdfText.replace(
  'Ong: Nguyen Viet Trong, CCCD: 017065002419',
  'Ong: Nguyen Viet Trong, CCCD: 017065002419\nDia chi: 12 Duong Mau, phuong Mau'
);
assert.strictEqual(
  dataMergeContext.extractRealEstateIndexedLandFields_(newA4WithOwnerAddress).land_address,
  'Xom Giua, xa Lien Son, tinh Phu Tho'
);
assert.strictEqual(
  dataMergeContext.extractOwnerAddressFromCertificateText_(newA4WithOwnerAddress),
  '12 Duong Mau, phuong Mau'
);
assert.strictEqual(dataMergeContext.extractRealEstateRegistryNumber_(newA4PdfText), 'CN5429');
assert.strictEqual(
  dataMergeContext.extractRealEstateRegistryNumber_('So vao so cap Giay chung nhan: CN.5429'),
  'CN.5429'
);
assert.strictEqual(
  dataMergeContext.extractRealEstateRegistryNumber_('So vao so cap GCN: C.N.5.4.2.9'),
  'C.N.5.4.2.9'
);
assert.strictEqual(dataMergeContext.extractRealEstateIssueDate_(newA4PdfText), '04/07/2025');
assert.strictEqual(dataMergeContext.extractOwnerAddressFromCertificateText_(newA4PdfText), '');
assert.strictEqual(dataMergeContext.extractCertificateNoteFromCertificateText_(newA4PdfText), '-/-');
assert.strictEqual(dataMergeContext.extractPostIssueChangesFromCertificateText_(newA4PdfText).status, 'absent');

const actualA4HouseCertificateText = `
[LAND_OCR_REGION layout=gcn_qsdd_qsh_tsglvd_page_1 score=12 region=full]
GIẤY CHỨNG NHẬN
QUYỀN SỬ DỤNG ĐẤT, QUYỀN SỞ HỮU TÀI SẢN GẮN LIỀN VỚI ĐẤT
1. Người sử dụng đất, chủ sở hữu tài sản gắn liền với đất:
Ông: Nguyễn Viết Trọng, CCCD: 017065002419
Và vợ: Lê Thị Huế, CCCD: 001166034340
2. Thông tin thửa đất:
a. Thửa đất số: 100 ; tờ bản đồ số: 40
b. Diện tích: 1441,9 m2
c. Loại đất: Đất ở tại nông thôn: 400,0 m2; Đất trồng cây lâu năm: 1041,9 m2
d. Thời hạn sử dụng: Đất ở tại nông thôn: Lâu dài; Đất trồng cây lâu năm: Đến tháng 10/2045
đ. Hình thức sử dụng: Sử dụng chung của vợ và chồng
e. Địa chỉ: Xóm Giữa, xã Liên Sơn, tỉnh Phú Thọ
3. Thông tin tài sản gắn liền với đất: -/-
Phú Thọ, ngày ...04... tháng ...7... năm 2025
CHI NHÁNH VĂN PHÒNG ĐĂNG KÝ ĐẤT ĐAI LƯƠNG SƠN
AA 02378604
[/LAND_OCR_REGION]
[LAND_OCR_REGION layout=gcn_qsdd_qsh_tsglvd_page_2 score=8 region=full]
4. Sơ đồ thửa đất, tài sản gắn liền với đất:
5. Ghi chú: -/-
6. Những thay đổi sau khi cấp Giấy chứng nhận:
Nội dung thay đổi và cơ sở pháp lý
Xác nhận của cơ quan có thẩm quyền
Số vào sổ cấp Giấy chứng nhận:.............C.N.5.4.2.9.............
[/LAND_OCR_REGION]
`;
const actualA4Fields = dataMergeContext.extractRealEstateIndexedLandFields_(actualA4HouseCertificateText);
assert.strictEqual(dataMergeContext.extractRealEstateCertificateNumber_(actualA4HouseCertificateText), 'AA02378604');
assert.strictEqual(dataMergeContext.extractRealEstateRegistryNumber_(actualA4HouseCertificateText), 'CN5429');
assert.strictEqual(dataMergeContext.extractRealEstateIssueDate_(actualA4HouseCertificateText), '04/07/2025');
assert.strictEqual(actualA4Fields.usage_purpose, 'Đất ở tại nông thôn: 400,0 m²; Đất trồng cây lâu năm: 1041,9 m²');
assert.strictEqual(actualA4Fields.usage_term, 'Đất ở tại nông thôn: Lâu dài; Đất trồng cây lâu năm: Đến tháng 10/2045');
const actualOwnerPairs = dataMergeContext.extractOwnerIdentityPairs_(actualA4HouseCertificateText);
assert.deepStrictEqual(JSON.parse(JSON.stringify(actualOwnerPairs)), [
  {
    name: 'Nguyễn Viết Trọng',
    document_type: 'CCCD',
    id_number: '017065002419',
    raw_text: 'Ông: Nguyễn Viết Trọng, CCCD: 017065002419'
  },
  {
    name: 'Lê Thị Huế',
    document_type: 'CCCD',
    id_number: '001166034340',
    raw_text: 'Và vợ: Lê Thị Huế, CCCD: 001166034340'
  }
]);
assert.strictEqual(
  dataMergeContext.extractOwnerIdentityPairs_('1. Người sử dụng đất:\\nÔng: Nguyễn Văn A, CC: 012345678901\\n2. Thông tin thửa đất:')[0].document_type,
  'CC'
);
const noisyOldOwnerCertificateText = `
[LAND_OCR_PDF_PAGE page=1]
Người sử dụng đất thay đổi Đế từ TOPT
Lic the they find they obi CMND 082114972
theve khard Truny CCCD So 020090096688
[LAND_OCR_REGION layout=gcn_qsdd_qsh_nha_o_va_tsk_cover score=8 region=full]
I. Người sử dụng đất, chủ sở hữu nhà ở và tài sản khác gắn liền với đất
Ông: Trịnh Công Bách
Năm sinh: 1990, CMND số: 113387328
Địa chỉ thường trú: Căn hộ số 10, tầng 19, tòa E2
Bà: Trần Thùy Linh
Năm sinh: 1994, CMND số: 113565433
Địa chỉ thường trú: Căn hộ số 10, tầng 19, tòa E2
Người được cấp Giấy chứng nhận không được sửa chữa, tẩy xóa
[/LAND_OCR_REGION]
[LAND_OCR_PDF_PAGE page=2]
IV. Những thay đổi sau khi cấp Giấy chứng nhận
`;
assert.strictEqual(
  dataMergeContext.extractOwnerCertificateBlock_(noisyOldOwnerCertificateText).indexOf('Người sử dụng đất thay đổi'),
  -1
);
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(dataMergeContext.extractOwnerIdentityPairs_(noisyOldOwnerCertificateText))),
  [
    {
      name: 'Trịnh Công Bách',
      document_type: 'CMND',
      id_number: '113387328',
      raw_text: 'Ông: Trịnh Công Bách, Năm sinh: 1990, CMND số: 113387328'
    },
    {
      name: 'Trần Thùy Linh',
      document_type: 'CMND',
      id_number: '113565433',
      raw_text: 'Bà: Trần Thùy Linh, Năm sinh: 1994, CMND số: 113565433'
    }
  ]
);

const actualA4Review = {
  validation: { warnings: [] },
  assets: [{
    owner_name: { ai_value: 'Nguyen Viet Trong; Le Thi Hue', manual_value: '', final_value: 'Nguyen Viet Trong; Le Thi Hue' },
    owner_identity_summary: { ai_value: 'Nguyen Viet Trong - Can cuoc cong dan so 017065002419', manual_value: '', final_value: 'Nguyen Viet Trong - Can cuoc cong dan so 017065002419' },
    owner_id_document_type: { ai_value: 'Can cuoc cong dan', manual_value: '', final_value: 'Can cuoc cong dan' },
    owner_id_number: { ai_value: '017065002419; 001166034340', manual_value: '', final_value: '017065002419; 001166034340' },
    real_estate: {
      certificate_number: { ai_value: 'CN.542.9', manual_value: '', final_value: 'CN.542.9' },
      registry_number: { ai_value: 'CN.542.9', manual_value: '', final_value: 'CN.542.9' },
      issue_date: { ai_value: 'Phú Thọ, ngày ... tháng .... năm 2025 CHI NHÁNH VĂN PHÒNG ĐĂNG KÝ ĐẤT ĐAI LƯƠNG SƠN', manual_value: '', final_value: 'Phú Thọ, ngày ... tháng .... năm 2025 CHI NHÁNH VĂN PHÒNG ĐĂNG KÝ ĐẤT ĐAI LƯƠNG SƠN' },
      usage_purpose: { ai_value: '', manual_value: '', final_value: '' },
      usage_term: { ai_value: '', manual_value: '', final_value: '' },
      post_issue_changes: { ai_value: 'Không có', manual_value: '', final_value: 'Không có' }
    }
  }]
};
dataMergeContext.repairAssetCertificateCodesInReviewJson(actualA4Review, actualA4HouseCertificateText);
dataMergeContext.repairAssetIssueDateInReviewJson(actualA4Review, actualA4HouseCertificateText);
dataMergeContext.repairAssetOwnerIdentityInReviewJson(actualA4Review, actualA4HouseCertificateText);
dataMergeContext.repairAssetUsagePurposeInReviewJson(actualA4Review, actualA4HouseCertificateText);
dataMergeContext.repairAssetUsageTermInReviewJson(actualA4Review, actualA4HouseCertificateText);
dataMergeContext.repairAssetPostIssueChangesInReviewJson(actualA4Review, actualA4HouseCertificateText);
assert.strictEqual(actualA4Review.assets[0].real_estate.certificate_number.final_value, 'AA02378604');
assert.strictEqual(actualA4Review.assets[0].real_estate.registry_number.final_value, 'CN5429');
assert.strictEqual(actualA4Review.assets[0].real_estate.issue_date.final_value, '04/07/2025');
assert.strictEqual(actualA4Review.assets[0].owner_identity_summary.final_value, 'Ông: Nguyễn Viết Trọng, CCCD: 017065002419; Và vợ: Lê Thị Huế, CCCD: 001166034340');
assert.strictEqual(actualA4Review.assets[0].owner_id_document_type.final_value, 'CCCD; CCCD');
assert.strictEqual(actualA4Review.assets[0].real_estate.usage_purpose.final_value, 'Đất ở tại nông thôn: 400,0 m²; Đất trồng cây lâu năm: 1041,9 m²');
assert.strictEqual(actualA4Review.assets[0].real_estate.usage_term.final_value, 'Đất ở tại nông thôn: Lâu dài; Đất trồng cây lâu năm: Đến tháng 10/2045');
assert.strictEqual(actualA4Review.assets[0].real_estate.post_issue_changes.final_value, '');
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(dataMergeContext.extractA4LandFieldsFromFocusedCrop_(
    'c. Loại đất: Đất ở tại nông thôn: 400,0 m2; Đất trồng cây lâu năm: 1041,9 m2\n' +
    'd. Thời hạn sử dụng: Đất ở tại nông thôn: Lâu dài; Đất trồng cây lâu năm: Đến tháng 10/2045\n' +
    'đ. Hình thức sử dụng: Sử dụng chung của vợ và chồng'
  ))),
  {
    usage_purpose: 'Đất ở tại nông thôn: 400,0 m²; Đất trồng cây lâu năm: 1041,9 m²',
    usage_term: 'Đất ở tại nông thôn: Lâu dài; Đất trồng cây lâu năm: Đến tháng 10/2045',
    usage_form: 'Sử dụng chung của vợ và chồng'
  }
);
dataMergeContext.getCaseOcrText = function() {
  return { file_id: 'pdf1', file_name: 'So do nha.pdf', text: actualA4HouseCertificateText };
};
dataMergeContext.logAudit = function() {};
const storedA4Fields = dataMergeContext.extractA4LandCertificateFieldsFromStoredOcr('CASE', 'TOKEN', 'pdf1', 'So do nha.pdf');
assert.strictEqual(storedA4Fields.reason, 'OK');
assert.strictEqual(storedA4Fields.issue_date, '04/07/2025');
assert.strictEqual(storedA4Fields.usage_purpose, 'Đất ở tại nông thôn: 400,0 m²; Đất trồng cây lâu năm: 1041,9 m²');
assert.strictEqual(storedA4Fields.usage_term, 'Đất ở tại nông thôn: Lâu dài; Đất trồng cây lâu năm: Đến tháng 10/2045');
const dislocatedA4TermText = `
GIẤY CHỨNG NHẬN
QUYỀN SỬ DỤNG ĐẤT, QUYỀN SỞ HỮU TÀI SẢN GẮN LIỀN VỚI ĐẤT
2. Thông tin thửa đất:
a. Thửa đất số: 124 ; tờ bản đồ số: 27
b. Diện tích: 367,4m2
c. Loại đất: Đất ở tại nông thôn: 344,6m; Đất trồng cây lâu năm: 22,8m
d. Thời hạn sử dụng: Đất ở tại nông thôn: Lâu dài; Đất trồng cây lâu năm: Đến đ. Hình thức sử dụng: Sử dụng riêng
ngày 10/10/2045 e. Địa chỉ: Thôn Quyền Chương, xã Thanh Cao, huyện Lương Sơn, tỉnh Hòa Bình
3. Thông tin tài sản gắn liền với đất: --
Lương Sơn, ngày 17 tháng 6 năm 2025
`;
const dislocatedA4Fields = dataMergeContext.extractRealEstateIndexedLandFields_(dislocatedA4TermText);
assert.strictEqual(
  dislocatedA4Fields.usage_purpose,
  'Đất ở tại nông thôn: 344,6 m²; Đất trồng cây lâu năm: 22,8 m²'
);
assert.strictEqual(
  dislocatedA4Fields.usage_term,
  'Đất ở tại nông thôn: Lâu dài; Đất trồng cây lâu năm: Đến'
);
assert.strictEqual(dislocatedA4Fields.usage_form, 'Sử dụng riêng ngày 10/10/2045');
function visionAnnotationFromVisualLines(lines) {
  return {
    pages: [{
      width: 1800,
      height: 1000,
      blocks: [{
        paragraphs: lines.map(function(line, lineIndex) {
          let x = 40;
          return {
            words: line.split(/\s+/).map(function(token) {
              const width = Math.max(24, token.length * 13);
              const word = {
                symbols: token.split('').map(function(char) { return { text: char }; }),
                boundingBox: {
                  vertices: [
                    { x: x, y: 70 + lineIndex * 55 },
                    { x: x + width, y: 70 + lineIndex * 55 },
                    { x: x + width, y: 105 + lineIndex * 55 },
                    { x: x, y: 105 + lineIndex * 55 }
                  ]
                }
              };
              x += width + 16;
              return word;
            })
          };
        })
      }]
    }]
  };
}
const visualA4Annotation = visionAnnotationFromVisualLines([
  '2. Thông tin thửa đất:',
  'a. Thửa đất số: 124 ; tờ bản đồ số: 27',
  'b. Diện tích: 367,4m2',
  'c. Loại đất: Đất ở tại nông thôn: 344,6m; Đất trồng cây lâu năm: 22,8m',
  'd. Thời hạn sử dụng: Đất ở tại nông thôn: Lâu dài; Đất trồng cây lâu năm: Đến ngày 10/10/2045',
  'đ. Hình thức sử dụng: Sử dụng riêng',
  'e. Địa chỉ: Thôn Quyền Chương, xã Thanh Cao, huyện Lương Sơn, tỉnh Hòa Bình',
  '3. Thông tin tài sản gắn liền với đất: --'
]);
const visualA4Text = dataMergeContext.buildVisionGeometryText_(visualA4Annotation);
const visualA4Fields = dataMergeContext.extractA4LandFieldsFromFocusedCrop_(visualA4Text);
assert.strictEqual(
  visualA4Fields.usage_purpose,
  'Đất ở tại nông thôn: 344,6 m²; Đất trồng cây lâu năm: 22,8 m²'
);
assert.strictEqual(
  visualA4Fields.usage_term,
  'Đất ở tại nông thôn: Lâu dài; Đất trồng cây lâu năm: Đến ngày 10/10/2045'
);
assert.strictEqual(visualA4Fields.usage_form, 'Sử dụng riêng');
const staggeredVisualA4Annotation = visionAnnotationFromVisualLines([
  '2. Thông tin thửa đất:',
  'c. Loại đất: Đất ở tại nông thôn: 344,6m; Đất trồng cây lâu năm: 22,8m',
  'd. Thời hạn sử dụng: Đất ở tại nông thôn: Lâu dài; Đất trồng cây lâu năm: Đến ngày 10/10/2045',
  'đ. Hình thức sử dụng: Sử dụng riêng',
  'e. Địa chỉ: Thôn Quyền Chương, xã Thanh Cao, huyện Lương Sơn, tỉnh Hòa Bình',
  '3. Thông tin tài sản gắn liền với đất: --'
]);
staggeredVisualA4Annotation.pages[0].blocks[0].paragraphs.forEach(function(paragraph) {
  paragraph.words.forEach(function(word) {
    word.boundingBox.vertices.forEach(function(vertex) {
      vertex.y += Math.round(Number(vertex.x || 0) * 0.03);
    });
  });
});
const staggeredVisualA4Fields = dataMergeContext.extractA4LandFieldsFromFocusedCrop_(
  dataMergeContext.buildVisionGeometryText_(staggeredVisualA4Annotation)
);
assert.strictEqual(
  staggeredVisualA4Fields.usage_term,
  'Đất ở tại nông thôn: Lâu dài; Đất trồng cây lâu năm: Đến ngày 10/10/2045'
);
assert.strictEqual(staggeredVisualA4Fields.usage_form, 'Sử dụng riêng');
const verifiedGeometryTerm = {
  ai_value: 'Đất trồng cây lâu năm: Đến ngày 10/10/2045',
  final_value: 'Đất trồng cây lâu năm: Đến ngày 10/10/2045',
  manual_value: '',
  source: 'AUTO_OCR_A4_GEOMETRY_CROP_V2'
};
assert.strictEqual(
  dataMergeContext.shouldReplaceUsageTerm_(verifiedGeometryTerm, 'Đất trồng cây lâu năm: Đến'),
  false
);
const verifiedGeometryReview = { validation: { warnings: [] } };
dataMergeContext.clearUnsafeLandField_(
  verifiedGeometryReview,
  verifiedGeometryTerm,
  'assets[].real_estate.usage_term',
  function() { return true; },
  'Đất trồng cây lâu năm: Đến'
);
assert.strictEqual(verifiedGeometryTerm.final_value, 'Đất trồng cây lâu năm: Đến ngày 10/10/2045');
assert.strictEqual(
  dataMergeContext.shouldReplaceUsagePurpose_(
    { final_value: 'Đất ở tại nông thôn: 344,6m', manual_value: '' },
    'Đất ở tại nông thôn: 344,6 m²'
  ),
  true
);
assert.strictEqual(
  dataMergeContext.shouldReplaceUsageTerm_(
    { final_value: 'Đất trồng cây lâu năm: Đến', manual_value: '' },
    'Đất trồng cây lâu năm: Đến ngày 10/10/2045'
  ),
  true
);
const facingPageAnnotation = {
  pages: [{
    width: 2000,
    height: 1200,
    blocks: [{
      paragraphs: [{
        words: Array.from({ length: 12 }, function(_, index) {
          const x = 80 + index * 55;
          return {
            symbols: [{ text: 'L' + index }],
            boundingBox: { vertices: [{ x, y: 100 }, { x: x + 40, y: 100 }, { x: x + 40, y: 130 }, { x, y: 130 }] }
          };
        }).concat(Array.from({ length: 12 }, function(_, index) {
          const x = 1250 + index * 55;
          return {
            symbols: [{ text: 'R' + index }],
            boundingBox: { vertices: [{ x, y: 100 }, { x: x + 40, y: 100 }, { x: x + 40, y: 130 }, { x, y: 130 }] }
          };
        }))
      }]
    }]
  }]
};
assert.strictEqual(dataMergeContext.isLikelyFacingPageSpread_(facingPageAnnotation, 0), true);
const detectedFacingRegions = dataMergeContext.suggestLandPageRegionsFromVisionAnnotation_(facingPageAnnotation, 0);
assert.strictEqual(detectedFacingRegions.length, 2);
assert.strictEqual(detectedFacingRegions[0].region, 'left');
assert.strictEqual(detectedFacingRegions[1].region, 'right');
assert.ok(detectedFacingRegions[0].width > 800 && detectedFacingRegions[0].width < 1300);
assert.ok(detectedFacingRegions[1].x > 700 && detectedFacingRegions[1].x < 1300);
assert.strictEqual(
  dataMergeContext.suggestLandPageRegionsFromVisionAnnotation_({
    pages: [{
      width: 1200,
      height: 1800,
      blocks: facingPageAnnotation.pages[0].blocks
    }]
  }, 0).length,
  0
);
assert.strictEqual(dislocatedA4Fields.attached_assets, '-/-');
assert.strictEqual(
  dataMergeContext.extractNewA4AttachedAssetFields_(dislocatedA4TermText).state,
  'absent'
);
const absentAttachedReview = {
  assets: [{
    real_estate: {
      attached_assets: { ai_value: 'garbage signature text', manual_value: '', final_value: 'garbage signature text' },
      attached_asset_name: { ai_value: 'Nhà ở riêng lẻ', manual_value: '', final_value: 'Nhà ở riêng lẻ' },
      attached_asset_area: { ai_value: '226 m²', manual_value: '', final_value: '226 m²' },
      attached_asset_ownership_form: { ai_value: 'Sở hữu chung', manual_value: '', final_value: 'Sở hữu chung' },
      attached_asset_ownership_term: { ai_value: '-/-', manual_value: '', final_value: '-/-' }
    }
  }]
};
dataMergeContext.repairAssetAttachedAssetsInReviewJson(absentAttachedReview, dislocatedA4TermText);
assert.strictEqual(absentAttachedReview.assets[0].real_estate.attached_assets.final_value, '-/-');
assert.strictEqual(absentAttachedReview.assets[0].real_estate.attached_asset_name.final_value, '');
assert.strictEqual(absentAttachedReview.assets[0].real_estate.attached_asset_area.final_value, '');
const a4ExistingValueReview = {
  validation: { status: 'PENDING', missing_fields: [], conflicts: [], warnings: [] },
  assets: [{
    real_estate: {
      usage_purpose: {
        ai_value: 'Đất ở tại nông thôn: 344,6m; Đất trồng cây lâu năm: 22,8m',
        manual_value: '',
        final_value: 'Đất ở tại nông thôn: 344,6m; Đất trồng cây lâu năm: 22,8m'
      },
      usage_term: {
        ai_value: 'Đất ở tại nông thôn: Lâu dài; Đất trồng cây lâu năm: Đến',
        manual_value: '',
        final_value: 'Đất ở tại nông thôn: Lâu dài; Đất trồng cây lâu năm: Đến'
      }
    }
  }]
};
dataMergeContext.assertValidToken_ = function() {};
dataMergeContext.getLatestFinalData = function() { return null; };
dataMergeContext.getOverrides = function() { return []; };
dataMergeContext.getLatestExtractedData = function() { return a4ExistingValueReview; };
dataMergeContext.repairReviewDataFromFullOcr_ = function(data) { return data; };
dataMergeContext.validateReviewJson = function(data) { return data; };
dataMergeContext.getByPath = function(root, path) {
  return String(path || '').split('.').reduce(function(current, part) {
    if (!current) return null;
    const match = part.match(/^(.+)\[(\d+)\]$/);
    return match ? (current[match[1]] || [])[Number(match[2])] : current[part];
  }, root);
};
dataMergeContext.appendSheetRow = function() {};
dataMergeContext.logAudit = function() {};
dataMergeContext.nowIso = function() { return '2026-06-22T00:00:00.000Z'; };
dataMergeContext.SHEETS = { EXTRACTED_DATA: 'EXTRACTED_DATA' };
assert.strictEqual(
  dataMergeContext.saveAutoOcrA4LandFieldValue(
    'CASE',
    'TOKEN',
    'assets[0].real_estate.usage_purpose',
    visualA4Fields.usage_purpose,
    a4ExistingValueReview.assets[0].real_estate.usage_purpose.final_value,
    'AUTO_OCR_A4_GEOMETRY_CROP'
  ).ok,
  true
);
assert.strictEqual(
  a4ExistingValueReview.assets[0].real_estate.usage_purpose.final_value,
  'Đất ở tại nông thôn: 344,6 m²; Đất trồng cây lâu năm: 22,8 m²'
);
assert.strictEqual(
  dataMergeContext.saveAutoOcrA4LandFieldValue(
    'CASE',
    'TOKEN',
    'assets[0].real_estate.usage_term',
    visualA4Fields.usage_term,
    a4ExistingValueReview.assets[0].real_estate.usage_term.final_value,
    'AUTO_OCR_A4_GEOMETRY_CROP'
  ).ok,
  true
);
assert.strictEqual(a4ExistingValueReview.assets[0].real_estate.usage_term.final_value, visualA4Fields.usage_term);
const automatedOverrideReview = {
  validation: { status: 'PENDING', missing_fields: [], conflicts: [], warnings: [] },
  review: { status: 'PENDING_REVIEW', confirmed_by: '', confirmed_at: '' },
  secured_parties: [{ id_issue_date: {
    ai_value: '', form_value: '', manual_value: '', final_value: '', confirmed: false
  }}],
  assets: [{ real_estate: {
    usage_purpose: { ai_value: 'Kết quả crop mới', form_value: '', manual_value: '', final_value: 'Kết quả crop mới', confirmed: false },
    usage_term: { ai_value: 'OCR cũ', form_value: '', manual_value: '', final_value: 'OCR cũ', confirmed: false }
  }}]
};
dataMergeContext.applyOverridesToReviewJson(automatedOverrideReview, [
  {
    field_path: 'assets[0].real_estate.usage_purpose',
    new_value: 'Kết quả AUTO_OCR cũ',
    edited_by: 'AUTO_OCR',
    reason: 'AUTO_OCR_A4_GEOMETRY_CROP'
  },
  {
    field_path: 'secured_parties[0].id_issue_date',
    new_value: '01/02/2020',
    edited_by: 'AUTO_OCR',
    reason: 'AUTO_OCR_IDENTITY_CROP'
  },
  {
    field_path: 'assets[0].real_estate.usage_term',
    new_value: 'Người dùng sửa',
    edited_by: 'user@example.com',
    reason: 'Đối chiếu ảnh gốc'
  }
]);
assert.strictEqual(automatedOverrideReview.assets[0].real_estate.usage_purpose.manual_value, '');
assert.strictEqual(automatedOverrideReview.assets[0].real_estate.usage_purpose.final_value, 'Kết quả crop mới');
assert.strictEqual(automatedOverrideReview.assets[0].real_estate.usage_purpose.confirmed, false);
assert.strictEqual(automatedOverrideReview.secured_parties[0].id_issue_date.final_value, '01/02/2020');
assert.strictEqual(automatedOverrideReview.secured_parties[0].id_issue_date.manual_value, '');
assert.strictEqual(automatedOverrideReview.assets[0].real_estate.usage_term.manual_value, 'Người dùng sửa');
assert.strictEqual(automatedOverrideReview.assets[0].real_estate.usage_term.confirmed, true);
assert.strictEqual(dataMergeContext.cleanupIndexedCertificateValue_('Xóm Gừa , xã Liên Sơn , tỉnh Phú Thọ'), 'Xóm Gừa, xã Liên Sơn, tỉnh Phú Thọ');
const addressSpacingReview = {
  assets: [{
    real_estate: {
      land_address: {
        ai_value: 'Xóm Gừa , xã Liên Sơn , tỉnh Phú Thọ',
        manual_value: '',
        final_value: 'Xóm Gừa , xã Liên Sơn , tỉnh Phú Thọ'
      }
    }
  }],
  ocr_results: []
};
dataMergeContext.repairAssetLandAddressInReviewJson(addressSpacingReview, '');
assert.strictEqual(addressSpacingReview.assets[0].real_estate.land_address.final_value, 'Xóm Gừa, xã Liên Sơn, tỉnh Phú Thọ');
assert.strictEqual(
  dataMergeContext.normalizeVietnameseAgencyNameClean_('Chi nh\u00e1nh v\u0103n ph\u00f2ng \u0111\u0103ng k\u00fd \u0111\u1ea5t \u0111ai l\u01b0\u01a1ng s\u01a1n'),
  'Chi nh\u00e1nh V\u0103n ph\u00f2ng \u0111\u0103ng k\u00fd \u0111\u1ea5t \u0111ai L\u01b0\u01a1ng S\u01a1n'
);
assert.strictEqual(
  dataMergeContext.normalizeVietnameseAgencyNameClean_('V\u0103n ph\u00f2ng \u0111\u0103ng k\u00fd \u0111\u1ea5t \u0111ai l\u01b0\u01a1ng s\u01a1n'),
  'V\u0103n ph\u00f2ng \u0111\u0103ng k\u00fd \u0111\u1ea5t \u0111ai L\u01b0\u01a1ng S\u01a1n'
);
const reviewJson = {
  assets: [{
    owner_address: { final_value: 'Xom Giua, xa Lien Son, tinh Phu Tho', ai_value: 'Xom Giua, xa Lien Son, tinh Phu Tho' },
    real_estate: {
      owner_address: { final_value: 'Xom Giua, xa Lien Son, tinh Phu Tho', ai_value: 'Xom Giua, xa Lien Son, tinh Phu Tho' },
      land_address: { final_value: 'Xom Giua, xa Lien Son, tinh Phu Tho', ai_value: 'Xom Giua, xa Lien Son, tinh Phu Tho' }
    }
  }]
};
dataMergeContext.repairAssetOwnerAddressInReviewJson(reviewJson, newA4PdfText);
assert.strictEqual(reviewJson.assets[0].owner_address.final_value, '');
assert.strictEqual(reviewJson.assets[0].real_estate.owner_address.final_value, '');

const oldCertificateSplitPageText = `
II. Thửa đất, nhà ở và tài sản khác gắn liền với đất
1. Thửa đất:
a) Thửa đất số: 255
tờ bản đồ số: F-48-116(146-a-I)
b) Địa chỉ: Tiểu khu 9, thị trấn Lương Sơn, huyện Lương Sơn, tỉnh Hòa Bình 102,3m2, (bằng chữ: một trăm linh hai phẩy ba mét vuông)
c) Diện tích: 102,3m2
d) Hình thức sử dụng: Sử dụng riêng
đ) Mục đích sử dụng: Đất ở tại đô thị
e) Thời hạn sử dụng: Lâu dài
g) Nguồn gốc sử dụng: Nhận chuyển nhượng đất được Nhà nước giao
dụng đất
2. Nhà ở: -/-
3. Công trình xây dựng khác: -/-
4. Rừng sản xuất là rừng trồng: -/-
5. Cây lâu năm: -/-
6. Ghi chú: Không
đất có thu tiền sử
IV. Những thay đổi sau khi cấp Giấy chứng nhận
Nội dung thay đổi và cơ sở pháp lý
Chuyển nhượng cho ông thức Khánh Trung, số lư
chieri C1994238 cung ba for This Theey Lind, CMIND 082114 972
che chi tai khu SA, the tras
`;
const oldCertificateFields = dataMergeContext.extractRealEstateIndexedLandFields_(oldCertificateSplitPageText);
const oldFocusedCropFields = dataMergeContext.extractAllLandFieldsFromFocusedCrop_(oldCertificateSplitPageText);
assert.strictEqual(oldCertificateFields.land_address, 'Tiểu khu 9, thị trấn Lương Sơn, huyện Lương Sơn, tỉnh Hòa Bình');
assert.strictEqual(oldFocusedCropFields.land_plot_number, '255');
assert.ok(/^102,3 m/.test(oldFocusedCropFields.area));
assert.strictEqual(oldFocusedCropFields.usage_form, 'Sử dụng riêng');
assert.strictEqual(oldFocusedCropFields.usage_purpose, 'Đất ở tại đô thị');
assert.strictEqual(oldFocusedCropFields.usage_term, 'Lâu dài');
assert.ok(oldFocusedCropFields.usage_origin.indexOf('Nhận chuyển nhượng đất được Nhà nước giao') === 0);
const numericOldFocusedCropFields = dataMergeContext.extractAllLandFieldsFromFocusedCrop_(
  'II. Thửa đất, nhà ở và tài sản khác gắn liền với đất\n1. Thửa đất:\na) Thửa đất số: 303; tờ bản đồ số: 3\nb) Địa chỉ: Khu 1, thị trấn Chi Nê, huyện Lạc Thủy, tỉnh Hòa Bình'
);
assert.strictEqual(numericOldFocusedCropFields.land_plot_number, '303');
assert.strictEqual(numericOldFocusedCropFields.map_sheet_number, '3');
assert.strictEqual(
  dataMergeContext.extractAllLandFieldsFromFocusedCrop_('a) Thura dat so; 303 to ban do so: 3').land_plot_number,
  '303'
);
assert.strictEqual(
  oldCertificateFields.usage_origin,
  'Nhận chuyển nhượng đất được Nhà nước giao đất có thu tiền sử dụng đất'
);
const variableOldCertificateText = `
GIẤY CHỨNG NHẬN
QUYỀN SỬ DỤNG ĐẤT, QUYỀN SỞ HỮU NHÀ Ở VÀ TÀI SẢN KHÁC GẮN LIỀN VỚI ĐẤT
I. Người sử dụng đất, chủ sở hữu nhà ở và tài sản khác gắn liền với đất
II. Thửa đất, nhà ở và tài sản khác gắn liền với đất
1. Thửa đất:
a) Thửa đất số: 452; tờ bản đồ số: 10
b) Diện tích: 1429,4m2
c) Loại đất: Đất ở 884,9m2; đất trồng cây lâu năm 544,5m2
d) Thời hạn sử dụng: Đất ở: Lâu dài; Đất trồng cây lâu năm: Đến ngày 31/12/2064
đ) Hình thức sử dụng: Sử dụng riêng
e) Địa chỉ: Thôn Sấu Thượng, xã Thanh Cao, huyện Lương Sơn, tỉnh Hòa Bình
f) Nguồn gốc sử dụng: Nhận chuyển nhượng đất được Công nhận QSDĐ như giao đất có thu tiền sử dụng đất
2. Nhà ở: -/-
3. Công trình xây dựng khác: -/-
4. Ghi chú: Không
III. Sơ đồ thửa đất, nhà ở và tài sản khác gắn liền với đất
IV. Những thay đổi sau khi cấp Giấy chứng nhận
`;
assert.strictEqual(
  dataMergeContext.extractKnownCertificateTitleFromText_(variableOldCertificateText),
  'Giấy chứng nhận quyền sử dụng đất, quyền sở hữu nhà ở và tài sản khác gắn liền với đất'
);
assert.strictEqual(dataMergeContext.isNewA4LandCertificateText_(variableOldCertificateText), false);
assert.strictEqual(
  dataMergeContext.classifyLandCertificatePageText_(variableOldCertificateText).layout,
  'gcn_qsdd_qsh_nha_o_va_tsk_change'
);
const variableOldFields = dataMergeContext.extractRealEstateIndexedLandFields_(variableOldCertificateText);
assert.strictEqual(variableOldFields.usage_purpose, 'Đất ở 884,9 m²; đất trồng cây lâu năm 544,5 m²');
assert.strictEqual(variableOldFields.usage_term, 'Đất ở: Lâu dài; Đất trồng cây lâu năm: Đến ngày 31/12/2064');
assert.ok(variableOldFields.usage_origin.indexOf('Nhận chuyển nhượng đất được Công nhận QSDĐ') === 0);
assert.strictEqual(
  dataMergeContext.normalizeUsageOriginAreaUnits_(
    'Nhận chuyển nhượng đất có thu tiền sử dụng đất: 884,9m; không thu tiền sử dụng đất: 544,5m2'
  ),
  'Nhận chuyển nhượng đất có thu tiền sử dụng đất: 884,9 m²; không thu tiền sử dụng đất: 544,5 m²'
);
const usageOriginReview = {
  assets: [{
    real_estate: {
      usage_origin: {
        ai_value: 'Nhận chuyển nhượng: 884,9m; 544,5m2',
        final_value: 'Nhận chuyển nhượng: 884,9m; 544,5m2',
        manual_value: ''
      }
    }
  }],
  ocr_results: []
};
dataMergeContext.repairAssetUsageOriginInReviewJson(usageOriginReview, '', {});
assert.strictEqual(
  usageOriginReview.assets[0].real_estate.usage_origin.final_value,
  'Nhận chuyển nhượng: 884,9 m²; 544,5 m²'
);
assert.strictEqual(
  dataMergeContext.shouldReplaceCertificateTitleFromOcr_(
    { final_value: 'Giấy chứng nhận quyền sử dụng đất, quyền sở hữu tài sản gắn liền với đất', manual_value: '' },
    'Giấy chứng nhận quyền sử dụng đất, quyền sở hữu nhà ở và tài sản khác gắn liền với đất'
  ),
  true
);
const repairedVariableTitleReview = {
  assets: [{
    certificate_title: {
      ai_value: 'Giấy chứng nhận quyền sử dụng đất, quyền sở hữu tài sản gắn liền với đất',
      manual_value: '',
      final_value: 'Giấy chứng nhận quyền sử dụng đất, quyền sở hữu tài sản gắn liền với đất'
    }
  }]
};
dataMergeContext.repairAssetCertificateTitleInReviewJson(repairedVariableTitleReview, variableOldCertificateText);
assert.strictEqual(
  repairedVariableTitleReview.assets[0].certificate_title.final_value,
  'Giấy chứng nhận quyền sử dụng đất, quyền sở hữu nhà ở và tài sản khác gắn liền với đất'
);
const staleMisclassifiedGeometryReview = {
  assets: [{
    real_estate: {
      usage_purpose: { ai_value: 'Đất ở 884,9 m², đất trồng cây lâu năm 544,5 m²', manual_value: '', final_value: 'Đất ở 884,9 m², đất trồng cây lâu năm 544,5 m²', source: 'AUTO_OCR_A4_GEOMETRY_CROP_V2' },
      usage_term: { ai_value: 'Đất ở: Lâu dài; Đất trồng cây lâu năm: Đến ngày 31/12/2064 B', manual_value: '', final_value: 'Đất ở: Lâu dài; Đất trồng cây lâu năm: Đến ngày 31/12/2064 B', source: 'AUTO_OCR_A4_GEOMETRY_CROP_V2' },
      usage_form: { ai_value: 'Sử dụng riêng Đường', manual_value: '', final_value: 'Sử dụng riêng Đường', source: 'AUTO_OCR_A4_GEOMETRY_CROP_V2' }
    }
  }]
};
dataMergeContext.repairAssetUsagePurposeInReviewJson(staleMisclassifiedGeometryReview, variableOldCertificateText);
dataMergeContext.repairAssetUsageTermInReviewJson(staleMisclassifiedGeometryReview, variableOldCertificateText);
dataMergeContext.repairAssetUsageFormInReviewJson(staleMisclassifiedGeometryReview, variableOldCertificateText);
assert.strictEqual(staleMisclassifiedGeometryReview.assets[0].real_estate.usage_term.final_value, 'Đất ở: Lâu dài; Đất trồng cây lâu năm: Đến ngày 31/12/2064');
assert.strictEqual(staleMisclassifiedGeometryReview.assets[0].real_estate.usage_form.final_value, 'Sử dụng riêng');
assert.strictEqual(staleMisclassifiedGeometryReview.assets[0].real_estate.usage_form.source, 'OCR_INDEXED_ASSET_TEXT_RECOVERED_FROM_WRONG_LAYOUT');
const oldCertificateReview = {
  assets: [{
    real_estate: {
      usage_origin: {
        ai_value: 'Nhận chuyển nhượng đất được Nhà nước giao',
        manual_value: '',
        final_value: 'Nhận chuyển nhượng đất được Nhà nước giao'
      },
      post_issue_changes: {
        ai_value: 'IV. Những thay đổi sau khi cấp Giấy chứng nhận:\nChuyển nhượng cho ông thức Khánh Trung, số lư chieri C1994238 cung ba for This Theey Lind, CMIND 082114 972',
        manual_value: '',
        final_value: 'IV. Những thay đổi sau khi cấp Giấy chứng nhận:\nChuyển nhượng cho ông thức Khánh Trung, số lư chieri C1994238 cung ba for This Theey Lind, CMIND 082114 972'
      }
    }
  }]
};
dataMergeContext.repairAssetUsageOriginInReviewJson(oldCertificateReview, oldCertificateSplitPageText);
dataMergeContext.repairAssetPostIssueChangesInReviewJson(oldCertificateReview, oldCertificateSplitPageText);
assert.strictEqual(
  oldCertificateReview.assets[0].real_estate.usage_origin.final_value,
  'Nhận chuyển nhượng đất được Nhà nước giao đất có thu tiền sử dụng đất'
);
assert.strictEqual(
  oldCertificateReview.assets[0].real_estate.post_issue_changes.final_value,
  'Không rõ, đề nghị kiểm tra'
);
const oldCertificateDislocatedOriginText = `
II. Thửa đất, nhà ở và tài sản khác gắn liền với đất
1. Thửa đất:
a) Thửa đất số:
1. Thira dat:
d) Hình thức sử dụng: Sử dụng riêng
đ) Mục đích sử dụng: Đất ở tại đô thị
e) Thời hạn sử dụng: Lâu dài
10
Sở hữu riêng
89,8m2
Nhà ở riêng lẻ
g) Nguồn gốc sử dụng: Nhận chuyển nhượng đất được Công nhận QSDĐ như giao đất có
b) Địa chỉ: Tổ 15, phường Tấn Thịnh, thành phố Hòa Bình, tỉnh Hòa Bình 110,8m2, (bằng chữ: một trăm mười phẩy tám mét vuông)
tờ bản đồ số:
03
thu tiền sử dụng đất
Hòa Bình, ngày 19 tháng 7 năm 20.18
`;
const dislocatedFields = dataMergeContext.extractRealEstateIndexedLandFields_(oldCertificateDislocatedOriginText);
assert.strictEqual(dislocatedFields.land_plot_number, '10');
assert.strictEqual(
  dislocatedFields.usage_origin,
  'Nhận chuyển nhượng đất được Công nhận QSDĐ như giao đất có thu tiền sử dụng đất'
);
assert.strictEqual(
  dataMergeContext.extractRealEstateIssueDateFromPlainText_(oldCertificateDislocatedOriginText),
  '19/07/2018'
);
assert.strictEqual(
  dataMergeContext.extractRealEstateIssueDateFromPlainText_('Hòa Bình, Ngày / 4k .tháng5..năm 2011 TM. ỦY BAN NHÂN DÂN'),
  '16/05/2011'
);
assert.strictEqual(dataMergeContext.normalizeCertificateSerialValue_('BD151871'), 'BĐ151871');
assert.strictEqual(
  dataMergeContext.normalizeVietnameseAgencyNameClean_('ỦY BAN NHÂN DÂN THÀNH PHỐ HÒA BÌNH'),
  'Ủy ban nhân dân thành phố Hòa Bình'
);
assert.strictEqual(
  dataMergeContext.shouldReplaceRealEstateIssueDate_(
    {
      final_value: '19/07/2018',
      ai_value: '19/07/2018',
      manual_value: '',
      source: 'AUTO_OCR_LAND_ISSUE_DATE_CROP_CONSENSUS'
    },
    '19/01/2018'
  ),
  false
);
assert.strictEqual(
  dataMergeContext.cleanPostIssueChangesCandidate_(
    'IV. Những thay đổi sau khi cấp Giấy chứng nhận\nNội dung thay đổi và cơ sở pháp lý\nChuyển nhượng cho Nguyễn Văn A'
  ),
  'Chuyển nhượng cho Nguyễn Văn A'
);
assert.strictEqual(
  dataMergeContext.postIssueChangesValueForReview_({
    status: 'ok',
    value: 'IV. Những thay đổi sau khi cấp Giấy chứng nhận\nNội dung thay đổi và cơ sở pháp lý\nChuyển nhượng cho Nguyễn Văn A'
  }),
  'Chuyển nhượng cho Nguyễn Văn A'
);
assert.strictEqual(
  dataMergeContext.cleanPostIssueChangesCandidate_(
    'Nội dung thay đổi và cơ sở pháp lý Chuyển nhượng cho Nguyễn Văn A'
  ),
  'Chuyển nhượng cho Nguyễn Văn A'
);
assert.strictEqual(
  dataMergeContext.cleanPostIssueChangesCandidate_(
    'Nội dung thay đổi và cơ sở pháp lý: chuyển nhượng cho ông Mai Lê Thành , CCCP sa 036080024419'
  ),
  'chuyển nhượng cho ông Mai Lê Thành, CCCD số 036080024419'
);
assert.strictEqual(
  dataMergeContext.cleanPostIssueChangesCandidate_(
    [
      'Nội dung thay đổi và cơ sở pháp lý: chuyển nhượng cho ông Mai Lê Thành , CCCP sa 036080024419',
      'KT. CHỦ TỊCH PHÓ CHỦ TỊCH',
      '26/7/2022',
      'HUYỆN LẠC THỦY'
    ].join('\n')
  ),
  'chuyển nhượng cho ông Mai Lê Thành, CCCD số 036080024419'
);
assert.strictEqual(
  dataMergeContext.extractPostIssueChangesFromCertificateText_(
    'IV. Những thay đổi sau khi cấp Giấy chứng nhận Chuyển nhượng cho Nguyễn Văn A'
  ).value,
  'Chuyển nhượng cho Nguyễn Văn A'
);
assert.strictEqual(
  dataMergeContext.cleanupLandAddressCertificateValue_(
    'Tiểu khu 9, tỉnh Hòa Bình c. Diện tích: 102,3m2'
  ),
  'Tiểu khu 9, tỉnh Hòa Bình'
);
assert.strictEqual(
  dataMergeContext.completeUsageOriginFromContext_(
    'Nhận chuyển nhượng đất được Nhà nước giao',
    'GIẤY CHỨNG NHẬN QUYỀN SỬ DỤNG ĐẤT\nđất có thu tiền sử'
  ),
  'Nhận chuyển nhượng đất được Nhà nước giao'
);
const scopedSourceA = `
II. Thửa đất, nhà ở và tài sản khác gắn liền với đất
1. Thửa đất:
a) Thửa đất số: 1
b) Địa chỉ: Xã A, tỉnh A
g) Nguồn gốc sử dụng: Nhận chuyển nhượng đất được Nhà nước giao
6. Ghi chú: Không
`;
const scopedSourceB = `
II. Thửa đất, nhà ở và tài sản khác gắn liền với đất
1. Thửa đất:
a) Thửa đất số: 2
b) Địa chỉ: Xã B, tỉnh B
g) Nguồn gốc sử dụng: Nhận chuyển nhượng đất được Nhà nước giao
dụng đất
6. Ghi chú: Không
đất có thu tiền sử
`;
const scopedReview = {
  assets: [
    {
      certificate_title: { source: 'asset__A.pdf' },
      real_estate: {
        usage_origin: {
          ai_value: 'Nhận chuyển nhượng đất được Nhà nước giao',
          manual_value: '',
          final_value: 'Nhận chuyển nhượng đất được Nhà nước giao'
        }
      }
    },
    {
      certificate_title: { source: 'asset__B.pdf' },
      real_estate: {
        usage_origin: {
          ai_value: 'Nhận chuyển nhượng đất được Nhà nước giao',
          manual_value: '',
          final_value: 'Nhận chuyển nhượng đất được Nhà nước giao'
        }
      }
    }
  ]
};
dataMergeContext.repairAssetUsageOriginInReviewJson(
  scopedReview,
  scopedSourceA + '\n' + scopedSourceB,
  {
    'asset__A.pdf': scopedSourceA,
    'asset__B.pdf': scopedSourceB
  }
);
assert.strictEqual(
  scopedReview.assets[0].real_estate.usage_origin.final_value,
  'Nhận chuyển nhượng đất được Nhà nước giao'
);
assert.strictEqual(
  scopedReview.assets[1].real_estate.usage_origin.final_value,
  'Nhận chuyển nhượng đất được Nhà nước giao đất có thu tiền sử dụng đất'
);
const scopedOcrContext = dataMergeContext.buildAssetOcrContext_([
  { group: 'asset', file_name: 'asset__A.pdf', text: scopedSourceA },
  { group: 'asset', file_name: 'asset__B.pdf', text: scopedSourceB }
]);
assert.strictEqual(
  dataMergeContext.selectAssetOcrTextForAiAsset_(
    { certificate_title: { source_file: 'asset__A.pdf' } },
    scopedOcrContext,
    2
  ),
  scopedSourceA
);
dataMergeContext.makeField = function(label, aiValue, formValue, manualValue, source, confidence) {
  return {
    label,
    ai_value: aiValue || '',
    form_value: formValue || '',
    manual_value: manualValue || '',
    final_value: manualValue || formValue || aiValue || '',
    source: source || '',
    confidence: confidence || '',
    confirmed: false
  };
};
dataMergeContext.shouldReclassifyOcrAsLandAsset_ = function() { return true; };
const normalizedScopedAssets = dataMergeContext.normalizeAiData_({
  assets: [
    {
      asset_type: { value: 'Bất động sản', source_file: 'asset__A.pdf' },
      certificate_title: { value: 'Giấy chứng nhận quyền sử dụng đất', source_file: 'asset__A.pdf' },
      real_estate: {
        land_address: { value: '', source_file: 'asset__A.pdf' }
      }
    },
    {
      asset_type: { value: 'Bất động sản', source_file: 'asset__B.pdf' },
      certificate_title: { value: 'Giấy chứng nhận quyền sử dụng đất', source_file: 'asset__B.pdf' },
      real_estate: {
        land_address: { value: '', source_file: 'asset__B.pdf' }
      }
    }
  ]
}, [
  { group: 'asset', file_name: 'asset__A.pdf', text: scopedSourceA },
  { group: 'asset', file_name: 'asset__B.pdf', text: scopedSourceB }
]);
assert.strictEqual(normalizedScopedAssets.assets[0].real_estate.land_address.final_value, 'Xã A, tỉnh A');
assert.strictEqual(normalizedScopedAssets.assets[1].real_estate.land_address.final_value, 'Xã B, tỉnh B');
assert.strictEqual(
  dataMergeContext.selectAssetOcrTextForAiAsset_(
    { certificate_title: { source_file: 'cover.jpg' } },
    {
      byFileName: { 'cover.jpg': 'COVER', 'detail.jpg': 'DETAIL' },
      allText: 'COVER\n\nDETAIL'
    },
    1
  ),
  'COVER\n\nDETAIL'
);
assert.strictEqual(
  dataMergeContext.cleanPostIssueChangesCandidate_(
    'Đính chính nội dung tại mục IV. Những thay đổi sau khi cấp Giấy chứng nhận'
  ),
  'Đính chính nội dung tại mục IV. Những thay đổi sau khi cấp Giấy chứng nhận'
);
assert.strictEqual(
  dataMergeContext.isPostIssueChangesUnclear_('Chuyển nhượng cho John Williams'),
  false
);
assert.strictEqual(
  dataMergeContext.isPostIssueChangesUnclear_('Chuyển nhượng cho The Bank of New York Mellon'),
  false
);
assert.strictEqual(
  dataMergeContext.isPostIssueChangesUnclear_(
    'Chuyển nhượng cho ông thức Khánh Trung, số lư chieri C1994238 cung ba for This Theey Lind, CMIND 082114972'
  ),
  true
);
dataMergeContext.SHEETS = { OCR_RESULTS: 'OCR_RESULTS' };
dataMergeContext.getRowsByCaseId_ = function() {
  return [{
    'File Name': 'asset__preview.pdf',
    'OCR Text': 'FULL OCR CONTENT'
  }];
};
const fullOcrMap = dataMergeContext.getFullOcrTextMapsForCase_('CASE', {
  ocr_results: [{
    file_name: 'asset__preview.pdf',
    group: 'asset',
    text_preview: 'TRUNCATED PREVIEW IV. Những thay đổi sau khi cấp Giấy chứng nhận'
  }]
});
assert.strictEqual(fullOcrMap.assetTextByFileName['asset__preview.pdf'], 'FULL OCR CONTENT');
assert.strictEqual(fullOcrMap.assetText, 'FULL OCR CONTENT');
assert.strictEqual(dataMergeContext.canUseSharedAssetOcr_([
  {
    real_estate: {
      certificate_number: { final_value: 'Không rõ, đề nghị sửa thủ công' },
      registry_number: { final_value: '' }
    }
  },
  {
    real_estate: {
      certificate_number: { final_value: 'Không rõ, đề nghị sửa thủ công' },
      registry_number: { final_value: '' }
    }
  }
], {
  byFileName: { 'asset__A.pdf': scopedSourceA, 'asset__B.pdf': scopedSourceB }
}), false);
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(dataMergeContext.registryCropConsensus_([
    'CS03417',
    'CS03417',
    'CS03447'
  ]))),
  {
    value: 'CS03417',
    count: 2,
    readings: ['CS03417', 'CS03417', 'CS03447']
  }
);
assert.strictEqual(
  dataMergeContext.registryCropConsensus_(['CS03417', 'CS03447']).value,
  ''
);
assert.strictEqual(
  dataMergeContext.registryCropConsensus_(['CS03417']).value,
  ''
);
assert.strictEqual(
  dataMergeContext.hasRegistryLabelInCropText_('Số vào sô cấp GCN: CS..03417....'),
  true
);
assert.strictEqual(
  dataMergeContext.hasRegistryLabelInCropText_('Chuyển nhượng theo hồ sơ số CS03417'),
  false
);
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(dataMergeContext.collectRegistryCharacterEvidence_({
    pages: [{
      blocks: [{
        paragraphs: [{
          words: [{
            symbols: [
              { text: 'C', confidence: 0.9 },
              { text: 'S', confidence: 0.8 },
              { text: '0', confidence: 0.7 },
              { text: '3', confidence: 0.6 },
              { text: '4', confidence: 0.5 },
              { text: '1', confidence: 0.8 },
              { text: '7', confidence: 0.9 }
            ]
          }]
        }]
      }]
    }]
  }))),
  [{
    text: 'CS03417',
    symbols: [
      { text: 'C', confidence: 0.9 },
      { text: 'S', confidence: 0.8 },
      { text: '0', confidence: 0.7 },
      { text: '3', confidence: 0.6 },
      { text: '4', confidence: 0.5 },
      { text: '1', confidence: 0.8 },
      { text: '7', confidence: 0.9 }
    ]
  }]
);
const registrySuggestionAnnotation = {
  fullTextAnnotation: {
    pages: [{
      width: 1000,
      height: 2000,
      blocks: [{
        paragraphs: [{
          words: [
            ['Số', 100], ['vào', 150], ['sổ', 200], ['cấp', 250], ['GCN', 300], ['CS..03417', 380]
          ].map(function(item) {
            return {
              symbols: item[0].split('').map(function(char) { return { text: char }; }),
              boundingBox: {
                vertices: [
                  { x: item[1], y: 500 },
                  { x: item[1] + 70, y: 500 },
                  { x: item[1] + 70, y: 540 },
                  { x: item[1], y: 540 }
                ]
              }
            };
          })
        }]
      }]
    }]
  }
};
const registrySuggestion = dataMergeContext.suggestLandRegistryCodeCropFromVisionAnnotation_(registrySuggestionAnnotation);
assert.strictEqual(registrySuggestion.reason, 'vision_registry_code_focused');
assert.strictEqual(registrySuggestion.anchor_text, 'CS..03417');
assert.ok(registrySuggestion.x < 380);
assert.ok(registrySuggestion.width > 70);
const registryLabelOnlyAnnotation = {
  fullTextAnnotation: {
    pages: [{
      width: 1200,
      height: 1800,
      blocks: [{
        paragraphs: [{
          words: [
            ['Số', 80], ['vào', 145], ['sổ', 210], ['cấp', 275], ['Giấy', 340], ['chứng', 425], ['nhận', 525]
          ].map(function(item) {
            return {
              symbols: item[0].split('').map(function(char) { return { text: char }; }),
              boundingBox: {
                vertices: [
                  { x: item[1], y: 1600 },
                  { x: item[1] + 72, y: 1600 },
                  { x: item[1] + 72, y: 1640 },
                  { x: item[1], y: 1640 }
                ]
              }
            };
          })
        }]
      }]
    }]
  }
};
const registryLabelOnlySuggestion = dataMergeContext.suggestLandRegistryCropFromVisionAnnotation_(registryLabelOnlyAnnotation);
assert.strictEqual(registryLabelOnlySuggestion.reason, 'land_registry_label');
assert.ok(registryLabelOnlySuggestion.label_box.width > 200);

const splitRegistrySuggestionAnnotation = {
  fullTextAnnotation: {
    pages: [{
      width: 905,
      height: 1280,
      blocks: [{
        paragraphs: [{
          words: [
            ['Số', 70], ['vào', 115], ['sổ', 160], ['cấp', 205], ['Giấy', 250],
            ['chứng', 300], ['nhận', 355], ['CN', 410], ['Q.344', 455]
          ].map(function(item) {
            return {
              symbols: item[0].split('').map(function(char) { return { text: char }; }),
              boundingBox: {
                vertices: [
                  { x: item[1], y: 1160 },
                  { x: item[1] + 55, y: 1160 },
                  { x: item[1] + 55, y: 1195 },
                  { x: item[1], y: 1195 }
                ]
              }
            };
          })
        }]
      }]
    }]
  }
};
const splitRegistrySuggestion = dataMergeContext.suggestLandRegistryCodeCropFromVisionAnnotation_(splitRegistrySuggestionAnnotation);
assert.strictEqual(splitRegistrySuggestion.anchor_text, 'CNQ.344');
assert.ok(splitRegistrySuggestion.code_box.width > 55);
const printedRegistryFillAnnotation = {
  pages: [{
    blocks: [{
      paragraphs: [{
        words: [{
          symbols: Array.from({ length: 7 }, function(_, index) {
            const x = 100 + index * 14;
            return {
              text: '.',
              boundingBox: { vertices: [{ x, y: 80 }, { x: x + 3, y: 80 }, { x: x + 3, y: 84 }, { x, y: 84 }] }
            };
          })
        }]
      }]
    }]
  }]
};
assert.strictEqual(dataMergeContext.hasPrintedRegistryFillLineFromAnnotation_(printedRegistryFillAnnotation), true);
assert.strictEqual(dataMergeContext.normalizeRegistryCodeValue_('CN.51'), 'CN.51');
assert.strictEqual(dataMergeContext.normalizeRegistryCodeValue_('CN.51', true), 'CN51');
assert.strictEqual(dataMergeContext.normalizeRegistryCodeValue_('CN.5.1'), 'CN51');
assert.strictEqual(dataMergeContext.normalizeRegistryCodeValue_('C.N.5.4.2.9'), 'C.N.5.4.2.9');
assert.strictEqual(dataMergeContext.normalizeRegistryCodeValue_('CN.5429'), 'CN.5429');
const labeledLandFieldAnnotation = {
  pages: [{
    width: 1200,
    height: 1600,
    blocks: [{
      paragraphs: [{
        words: [
          ['c.', 80, 300], ['Loại', 120, 300], ['đất:', 200, 300], ['Đất', 300, 300], ['ở', 370, 300], ['100m2', 410, 300],
          ['d.', 80, 390], ['Thời', 120, 390], ['hạn', 205, 390], ['sử', 270, 390], ['dụng:', 320, 390], ['Lâu', 430, 390], ['dài', 500, 390]
        ].map(function(item) {
          return {
            symbols: item[0].split('').map(function(char) { return { text: char }; }),
            boundingBox: {
              vertices: [
                { x: item[1], y: item[2] },
                { x: item[1] + 60, y: item[2] },
                { x: item[1] + 60, y: item[2] + 32 },
                { x: item[1], y: item[2] + 32 }
              ]
            }
          };
        })
      }]
    }]
  }]
};
const landTypeCrop = dataMergeContext.suggestLandTextFieldCropFromVisionAnnotation_(labeledLandFieldAnnotation, 'usage_purpose');
assert.strictEqual(landTypeCrop.reason, 'vision_land_label_usage_purpose');
assert.ok(landTypeCrop.height > 30 && landTypeCrop.height < 150);
assert.strictEqual(
  dataMergeContext.extractA4LandFieldsFromFocusedCrop_('đ. Mục đích sử dụng: Đất ở tại nông thôn').usage_purpose,
  'Đất ở tại nông thôn'
);

const certificateSuggestionAnnotation = {
  fullTextAnnotation: {
    pages: [{
      width: 1000,
      height: 1400,
      blocks: [{
        paragraphs: [{
          words: [
            ['AA', 70, 1240], ['02439787', 130, 1240]
          ].map(function(item) {
            return {
              symbols: item[0].split('').map(function(char) { return { text: char }; }),
              boundingBox: {
                vertices: [
                  { x: item[1], y: item[2] },
                  { x: item[1] + 110, y: item[2] },
                  { x: item[1] + 110, y: item[2] + 45 },
                  { x: item[1], y: item[2] + 45 }
                ]
              }
            };
          })
        }]
      }]
    }]
  }
};
const certificateSuggestion = dataMergeContext.suggestLandCertificateNumberCropFromVisionAnnotation_(certificateSuggestionAnnotation);
assert.strictEqual(certificateSuggestion.anchor_text, 'AA02439787');
assert.strictEqual(dataMergeContext.extractLandCertificateNumberFromCropText_('AA 02439787\nThong tin chi tiet'), 'AA02439787');
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(dataMergeContext.certificateNumberCropConsensus_(['AA02439787', 'AA 02439787', 'CN.0.3441']))),
  { value: 'AA02439787', count: 2, readings: ['AA02439787', 'AA02439787'] }
);

const reviewHtml = fs.readFileSync('Review.html', 'utf8');
function extractClientFunction(name) {
  const start = reviewHtml.indexOf('function ' + name + '(');
  assert.ok(start >= 0, 'Missing client function ' + name);
  const bodyStart = reviewHtml.indexOf('{', start);
  let depth = 0;
  for (let i = bodyStart; i < reviewHtml.length; i++) {
    if (reviewHtml[i] === '{') depth++;
    if (reviewHtml[i] === '}') depth--;
    if (depth === 0) return reviewHtml.slice(start, i + 1);
  }
  throw new Error('Unclosed client function ' + name);
}
const reviewClientContext = {
  assert,
  cleanValue: value => String(value || '').trim()
};
vm.createContext(reviewClientContext);
vm.runInContext([
  extractClientFunction('fixCommonMojibake'),
  extractClientFunction('cleanValue'),
  extractClientFunction('valueOf'),
  extractClientFunction('normalizeUsageOriginAreaUnitsForReview_'),
  extractClientFunction('removeVietnameseMarks'),
  extractClientFunction('certificateGenerationFromCompleteTitleForReview_'),
  extractClientFunction('canonicalOldCertificateHeadingForReview_'),
  extractClientFunction('inferPrintedCertificateFieldMarker_'),
  extractClientFunction('normalizeCertificatePunctuationForReview_'),
  extractClientFunction('semanticCertificateDocumentToPrintedLayout_'),
  extractClientFunction('semanticCertificateDocumentToTranscriptLines_'),
  extractClientFunction('appendSemanticTranscriptSection_'),
  extractClientFunction('appendSemanticTranscriptLine_'),
  extractClientFunction('semanticSectionHeadingForReview_'),
  extractClientFunction('cleanSemanticTranscriptLine_'),
  extractClientFunction('semanticLinesEquivalent_'),
  extractClientFunction('semanticLineLooksLikeHeading_'),
  extractClientFunction('semanticDocumentItemValue_'),
  extractClientFunction('combineStandaloneMapSheetTranscriptLines_'),
  extractClientFunction('repairCertificateReferenceTranscriptLines_'),
  extractClientFunction('registryNumberFromSemanticDocument_'),
  extractClientFunction('certificateSerialForReview_'),
  extractClientFunction('certificateSerialFromSemanticPrintedLines_'),
  extractClientFunction('normalizeCertificateSerialForReview_'),
  extractClientFunction('bestSemanticCertificatePage_'),
  extractClientFunction('dedupeSemanticCertificateItems_'),
  extractClientFunction('semanticCertificateItemLabel_'),
  extractClientFunction('normalizeSemanticDisplayLabel_'),
  extractClientFunction('normalizePrintedMarkerForReview_'),
  extractClientFunction('inferredOldCertificateMarker_'),
  extractClientFunction('combineInlineSemanticCertificateFields_'),
  extractClientFunction('semanticCertificateItemForDisplay_'),
  extractClientFunction('a4AttachedAssetSectionState'),
  extractClientFunction('getLandCertificateFilesFromOcr_'),
  extractClientFunction('clampCropBox_'),
  extractClientFunction('buildFocusedRegistryCodeBoxes_'),
  extractClientFunction('buildFocusedRegistryLabelBoxes_'),
  extractClientFunction('stripInterleavedRegistryFillDotsForReview_'),
  extractClientFunction('normalizeRegistryCropReading_'),
  extractClientFunction('registrySameCropConsensus_'),
  extractClientFunction('sameCropValueConsensus_'),
  extractClientFunction('sameCropTextConsensus_'),
  extractClientFunction('chooseFocusedRegistryCandidate_')
].join('\n'), reviewClientContext);
assert.strictEqual(
  reviewClientContext.certificateGenerationFromCompleteTitleForReview_(
    'Giấy chứng nhận quyền sử dụng đất, quyền sở hữu nhà ở và tài sản khác gắn liền với đất'
  ),
  'gcn_qsdd_qsh_nha_o_va_tsk'
);
const variablePrintedLayout = reviewClientContext.semanticCertificateDocumentToPrintedLayout_(
  JSON.parse(JSON.stringify(dataMergeContext.parseLandCertificateSemanticDocument_(
    variableOldCertificateText,
    { certificate_title: 'Giấy chứng nhận quyền sử dụng đất, quyền sở hữu nhà ở và tài sản khác gắn liền với đất' }
  )))
);
assert.strictEqual(variablePrintedLayout.land_fields.map(item => item.label).join('|'), [
  'Thửa đất số',
  'Diện tích',
  'Loại đất',
  'Thời hạn sử dụng',
  'Hình thức sử dụng',
  'Địa chỉ',
  'Nguồn gốc sử dụng'
].join('|'));
assert.strictEqual(variablePrintedLayout.optional_sections.map(item => item.label).join('|'), 'Nhà ở|Công trình xây dựng khác|Ghi chú');
assert.strictEqual(variablePrintedLayout.map_heading.indexOf('III.'), 0);
assert.strictEqual(variablePrintedLayout.change_heading.indexOf('IV.'), 0);
assert.strictEqual(reviewClientContext.normalizeRegistryCropReading_('CN.5.1', true), 'CN51');
assert.strictEqual(reviewClientContext.normalizeRegistryCropReading_('CN.5.1', false), 'CN51');
assert.strictEqual(reviewClientContext.normalizeRegistryCropReading_('CN.5429', false), 'CN.5429');
assert.strictEqual(
  reviewClientContext.canonicalOldCertificateHeadingForReview_(
    'II . Thửa đất , nhà ở và tài san khác gắn liền với đất',
    'land',
    'gcn_qsdd_qsh_nha_o_va_tsk'
  ),
  'II. Thửa đất, nhà ở và tài sản khác gắn liền với đất'
);
assert.strictEqual(
  reviewClientContext.inferPrintedCertificateFieldMarker_(
    'e. Địa chỉ: Xã A\ng) Nguồn gốc sử dụng: Nhận chuyển nhượng',
    'usage_origin'
  ),
  'g'
);
assert.strictEqual(
  reviewClientContext.normalizeUsageOriginAreaUnitsForReview_('884,9m; 544,5m2'),
  '884,9 m²; 544,5 m²'
);
assert.strictEqual(
  reviewClientContext.normalizeUsageOriginAreaUnitsForReview_('884,9 m²; 544,5 m²'),
  '884,9 m²; 544,5 m²'
);
const printedA4Layout = reviewClientContext.semanticCertificateDocumentToPrintedLayout_(
  JSON.parse(JSON.stringify(dataMergeContext.parseLandCertificateSemanticDocument_(
    labeledA4AttachedAssetText,
    { certificate_title: 'Giấy chứng nhận quyền sử dụng đất, quyền sở hữu tài sản gắn liền với đất' }
  )))
);
assert.ok(printedA4Layout.owner_heading.indexOf('1.') === 0);
assert.ok(printedA4Layout.land_section_heading.indexOf('2.') === 0);
assert.ok(printedA4Layout.attached_heading.indexOf('3.') === 0);
assert.strictEqual(printedA4Layout.attached_fields.map(item => item.label).join('|'), 'Tên tài sản|Diện tích sử dụng|Hình thức sở hữu|Thời hạn sở hữu');
assert.strictEqual(
  reviewClientContext.a4AttachedAssetSectionState(
    {
      attached_assets: { final_value: '-/-' },
      attached_asset_name: { final_value: '' },
      attached_asset_area: { final_value: '' },
      attached_asset_ownership_form: { final_value: '' },
      attached_asset_ownership_term: { final_value: '' }
    },
    dislocatedA4TermText
  ),
  'absent'
);
assert.strictEqual(
  reviewClientContext.a4AttachedAssetSectionState(
    {
      attached_assets: { final_value: 'Tên tài sản: Nhà ở riêng lẻ' },
      attached_asset_name: { final_value: 'Nhà ở riêng lẻ' }
    },
    labeledA4AttachedAssetText
  ),
  'detailed'
);
reviewClientContext.reviewData = {
  ocr_results: [
    {
      file_name: 'asset__GCN QSDĐ - Bình Nguyễn Thanh.pdf',
      file_id: 'pdf-file-1',
      file_type: 'application/pdf',
      text_preview: ''
    },
    {
      file_name: 'secured_party__GCN QSDĐ - Bình Nguyễn Thanh.pdf',
      file_id: 'pdf-file-2',
      file_type: 'application/pdf',
      text_preview: ''
    },
    {
      file_name: 'obligor__CCCD.pdf',
      file_id: 'id-file-1',
      file_type: 'application/pdf',
      text_preview: ''
    }
  ]
};
assert.deepStrictEqual(
  reviewClientContext.getLandCertificateFilesFromOcr_().map(item => item.file_id),
  ['pdf-file-1', 'pdf-file-2']
);
const focusedBoxes = reviewClientContext.buildFocusedRegistryCodeBoxes_(
  { x: 116, y: 965, width: 104, height: 346 },
  4500,
  6600
);
const forwardMinus90 = focusedBoxes.find(item => item.reason === 'vision_registry_vertical_forward_-90_focused');
assert.ok(forwardMinus90, 'Expected vertical forward -90 focused crop');
assert.strictEqual(forwardMinus90.rotation, -90);
assert.ok(forwardMinus90.x >= 25 && forwardMinus90.x <= 35);
assert.ok(forwardMinus90.y >= 845 && forwardMinus90.y <= 855);
assert.ok(forwardMinus90.width >= 610 && forwardMinus90.width <= 625);
assert.ok(forwardMinus90.height >= 790 && forwardMinus90.height <= 810);
const horizontalFocusedBoxes = reviewClientContext.buildFocusedRegistryCodeBoxes_(
  { x: 700, y: 6100, width: 520, height: 90 },
  4500,
  6600
);
assert.ok(
  horizontalFocusedBoxes.some(item => item.reason === 'vision_registry_horizontal_forward_tight_focused'),
  'Expected horizontal tight registry crop'
);
const labelFocusedBoxes = reviewClientContext.buildFocusedRegistryLabelBoxes_(
  { x: 80, y: 1600, width: 520, height: 40 },
  1200,
  1800
);
assert.ok(
  labelFocusedBoxes.some(item => item.reason === 'vision_registry_label_forward_tight_focused'),
  'Expected a focused registry crop from the printed label even without a code token'
);
assert.strictEqual(
  reviewClientContext.sameCropTextConsensus_([
    'Đất ở tại nông thôn: 344,6 m²',
    'Dat o tai nong thon: 344,6 m²'
  ]),
  'Đất ở tại nông thôn: 344,6 m²'
);
assert.strictEqual(
  reviewClientContext.registrySameCropConsensus_(['CN5024', 'CN5024', 'CN5O24']),
  'CN5024'
);
assert.strictEqual(
  reviewClientContext.registrySameCropConsensus_(['CN5024', 'CN5029']),
  ''
);
assert.strictEqual(
  reviewClientContext.chooseFocusedRegistryCandidate_([
    { value: 'CS03417' },
    { value: 'CS03447' }
  ], 'CS03447'),
  null
);
assert.strictEqual(
  reviewClientContext.chooseFocusedRegistryCandidate_([
    { value: 'CN.0.3441', crop_reason: 'vision_registry_horizontal_forward_focused' }
  ], 'CNQ344').value,
  'CN.0.3441'
);
assert.strictEqual(
  reviewClientContext.chooseFocusedRegistryCandidate_([
    { value: 'CS0147' },
    { value: 'CS03417' },
    { value: 'CS03417' }
  ], 'CS03447').value,
  'CS03417'
);
assert.strictEqual(
  reviewClientContext.chooseFocusedRegistryCandidate_([
    { value: 'CS0282D', crop_reason: 'vision_registry_vertical_forward_-90_focused' },
    { value: 'CS0282D', crop_reason: 'vision_registry_vertical_forward_90_focused' },
    { value: 'CS02820', crop_reason: 'vision_registry_vertical_forward_tight_-90_focused' }
  ], 'CS0282D').value,
  'CS02820'
);
assert.strictEqual(
  reviewClientContext.chooseFocusedRegistryCandidate_([
    { value: 'CS02820', crop_reason: 'vision_registry_vertical_forward_tight_-90_focused' },
    { value: 'CS0282D', crop_reason: 'vision_registry_vertical_forward_tight_90_focused' }
  ], 'CS0282D'),
  null
);

const ocrServiceContext = {};
vm.createContext(ocrServiceContext);
vm.runInContext(fs.readFileSync('OCRService.gs', 'utf8'), ocrServiceContext);
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(ocrServiceContext.normalizeVisionRectForRotation_(
    { x: 100, y: 200, width: 300, height: 50 },
    1000,
    2000,
    90
  ))),
  { x: 1750, y: 100, width: 50, height: 300 }
);
assert.strictEqual(
  ocrServiceContext.extractCloudVisionPdfAnnotations_({
    responses: [{
      responses: [
        { fullTextAnnotation: { text: 'page 1' } },
        { fullTextAnnotation: { text: 'page 2' } }
      ]
    }]
  }).map(item => item.text).join('|'),
  'page 1|page 2'
);

const labRoutingContext = {
  removeVietnameseAccents_: value => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
};
vm.createContext(labRoutingContext);
vm.runInContext(fs.readFileSync('LabTraining.gs', 'utf8'), labRoutingContext);
assert.strictEqual(
  labRoutingContext.detectOcrLabConfigFromNamedValues_({
    'Email nhan ket qua lab': [''],
    'Upload anh bia dat/giay chung nhan': ['drive-file-id']
  }).skill,
  'ocr-bia-dat'
);
assert.strictEqual(
  labRoutingContext.detectOcrLabConfigFromNamedValues_({
    'Upload anh CCCD/Can cuoc': ['drive-file-id']
  }).skill,
  'ocr-cccd-can-cuoc'
);
assert.strictEqual(
  labRoutingContext.detectOcrLabConfigFromNamedValues_({
    'Email nguoi nhan link Review': ['review@example.com'],
    'Upload ho so tai san': ['drive-file-id']
  }),
  null
);
assert.ok(
  fs.readFileSync('FormHandler.gs', 'utf8').includes('detectOcrLabConfigFromNamedValues_(e && e.namedValues)'),
  'Production form handler must skip spreadsheet-mirrored OCR lab submissions'
);
assert.ok(
  fs.readFileSync('LabTraining.gs', 'utf8').includes('sendReviewEmail(caseId, recipient, reviewUrl)'),
  'OCR lab handler must send the generated review URL to the submitted email'
);
assert.ok(
  fs.readFileSync('ReviewWebApp.gs', 'utf8').includes("action === 'suggestLandTextFieldCropFromImage'"),
  'Review API must route focused land-label crop suggestions'
);
assert.ok(
  fs.readFileSync('ReviewWebApp.gs', 'utf8').includes("action === 'saveAutoOcrA4LandFieldValues'"),
  'Review API must route atomic focused land-label persistence'
);
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(ocrServiceContext.visionBoundingRectForRegions_({
    normalizedVertices: [{ x: 0.1, y: 0.2 }, { x: 0.3, y: 0.2 }, { x: 0.3, y: 0.4 }, { x: 0.1, y: 0.4 }]
  }, 1000, 2000))),
  { x: 100, y: 400, width: 200, height: 400 }
);

const reorderedNoisyOldCertificateText = `
GIẤY CHỨNG NHẬN
QUYỀN SỬ DỤNG ĐẤT, QUYỀN SỞ HỮU NHÀ Ở VÀ TÀI SẢN KHÁC GẮN LIỀN VỚI ĐẤT
II. Thửa đất, nhà ở và tài sản khác gắn liền với đất
1. Thửa đất:
g) Nguồn gốc sử dụng: Nhà nước giao đất có thu tiền sử dụng đất
+ Diện tích: 116,0mÂ²
e) Địa chỉ: Khu 1, thị trấn Chi Nê, huyện Lạc Thủy, tỉnh Hòa Bình
a) Thira dat so: 303; tờ bản đồ số: 3
d) Hình thirc sử dụng: Sử dụng riêng
c) Mục đích sử dụng: Đất ở tại đô thị
h) Quy hoạch: Theo quyết định số 12
2. Nhà ở: -/-
`;
const reorderedSemanticDocument = dataMergeContext.parseLandCertificateSemanticDocument_(
  reorderedNoisyOldCertificateText,
  { certificate_title: 'Giấy chứng nhận quyền sử dụng đất, quyền sở hữu nhà ở và tài sản khác gắn liền với đất' }
);
assert.strictEqual(reorderedSemanticDocument.generation, 'gcn_qsdd_qsh_nha_o_va_tsk');
assert.strictEqual(reorderedSemanticDocument.items.filter(item => item.semantic_key === 'land_plot_number')[0].value, '303');
assert.strictEqual(reorderedSemanticDocument.items.filter(item => item.semantic_key === 'area')[0].value, '116,0 m²');
assert.strictEqual(reorderedSemanticDocument.items.filter(item => item.semantic_key === 'area')[0].marker_raw, '');
assert.strictEqual(reorderedSemanticDocument.items.filter(item => item.semantic_key === 'unknown')[0].label_raw, 'Quy hoạch');
assert.strictEqual(reorderedSemanticDocument.unparsed_fragments[0].value, 'Theo quyết định số 12');
assert.strictEqual(
  reorderedSemanticDocument.items
    .filter(item => ['usage_origin', 'area', 'land_address', 'land_plot_number', 'usage_form', 'usage_purpose'].includes(item.semantic_key))
    .map(item => item.semantic_key)
    .join('|'),
  'usage_origin|area|land_address|land_plot_number|usage_form|usage_purpose'
);
const configSource = fs.readFileSync('Config.gs', 'utf8');
const aiExtractionSource = fs.readFileSync('AIExtractionService.gs', 'utf8');
const reviewServiceSource = fs.readFileSync('ReviewService.gs', 'utf8');
const reviewWebAppSource = fs.readFileSync('ReviewWebApp.gs', 'utf8');
assert.ok(configSource.includes("OPENAI_MODEL_LOCKED: 'gpt-5.4-mini'"));
assert.ok(!aiExtractionSource.includes("getProperty('OPENAI_MODEL')"));
assert.ok(!reviewServiceSource.includes("getProperty('OPENAI_MODEL')"));
assert.ok(aiExtractionSource.includes('model: CONFIG.OPENAI_MODEL_LOCKED'));
assert.ok(reviewServiceSource.includes('model: CONFIG.OPENAI_MODEL_LOCKED'));
assert.ok(aiExtractionSource.includes("labSkill === 'ocr-bia-dat'"));
assert.ok(aiExtractionSource.includes("assetType.indexOf('bat dong san')"));
assert.ok(aiExtractionSource.includes('buildOpenAiProcessingMetrics_'));
assert.ok(aiExtractionSource.includes('printed_lines'));
assert.ok(aiExtractionSource.includes('raw_lines'));
assert.ok(aiExtractionSource.includes("certificate_number', 'registry_number', 'issue_date', 'issuing_authority"));
assert.ok(aiExtractionSource.includes('signature_seal'));
assert.ok(fs.readFileSync('Review.html', 'utf8').includes('semanticCertificateDocumentToTranscriptLines_'));
assert.ok(reviewWebAppSource.includes("action === 'reprocessLabCaseForSelfCheck'"));
assert.ok(reviewWebAppSource.includes("indexOf('LAB-') !== 0"));
assert.ok(fs.readFileSync('DataMergeService.gs', 'utf8').includes("if (key === 'certificate_semantic_document') return"));

const aiExtractionContext = {
  CONFIG: { OPENAI_MODEL_LOCKED: 'gpt-5.4-mini' },
  removeVietnameseAccents_: removeVietnameseAccents_
};
vm.createContext(aiExtractionContext);
vm.runInContext(aiExtractionSource, aiExtractionContext);
const signatureFields = aiExtractionContext.extractLandVisionSignatureFields_({
  pages: [
    {
      page_index: 0,
      layout: 'gcn_qsdd_qsh_nha_o_va_tsk_cover',
      printed_lines: [
        'I. Người sử dụng đất',
        'Xác nhận của cơ quan có thẩm quyền ngày 16/6/2021'
      ],
      sections: [{ semantic: 'owners', raw_lines: [] }]
    },
    {
      page_index: 1,
      layout: 'gcn_qsdd_qsh_nha_o_va_tsk_land',
      printed_lines: [],
      sections: [
        { semantic: 'land_details', raw_lines: ['1. Thửa đất:', 'a) Thửa đất số: 69'] },
        { semantic: 'attached_assets', raw_lines: ['2. Nhà ở'] },
        {
          semantic: 'signature_seal',
          raw_lines: [
            'Hòa Bình, Ngày 16 tháng 5 năm 2011',
            'TM. ỦY BAN NHÂN DÂN',
            'CHỦ TỊCH',
            'ỦY BAN NHÂN DÂN TP HÒA BÌNH',
            'Quách Tùng Dương'
          ]
        }
      ]
    },
    {
      page_index: 2,
      layout: 'gcn_qsdd_qsh_nha_o_va_tsk_change',
      printed_lines: [
        'IV. Những thay đổi sau khi cấp Giấy chứng nhận',
        'Hòa Bình, ngày 26 tháng 9 năm 2012',
        'Xác nhận của cơ quan có thẩm quyền'
      ],
      sections: [
        { semantic: 'post_issue_changes', raw_lines: ['Xóa nội dung đăng ký thế chấp ngày 26/9/2012'] }
      ]
    }
  ]
});
assert.strictEqual(signatureFields.issue_date, '16/05/2011');
assert.strictEqual(signatureFields.issuing_authority, 'Ủy ban nhân dân thành phố Hòa Bình');

const printedSignatureFields = aiExtractionContext.extractLandVisionSignatureFields_({
  pages: [{
    page_index: 0,
    layout: 'gcn_qsdd_qsh_nha_o_va_tsk_land',
    sections: [{ semantic: 'land_details', raw_lines: ['1. Thửa đất:'] }],
    printed_lines: [
      'II. Thửa đất, nhà ở và tài sản khác gắn liền với đất',
      '1. Thửa đất:',
      'Hòa Bình, Ngày 16 tháng 5 năm 2011',
      'TM. ỦY BAN NHÂN DÂN',
      'CHỦ TỊCH',
      'ỦY BAN NHÂN DÂN TP HÒA BÌNH'
    ]
  }]
});
assert.strictEqual(printedSignatureFields.issue_date, '16/05/2011');
assert.strictEqual(printedSignatureFields.issuing_authority, 'Ủy ban nhân dân thành phố Hòa Bình');

const transcriptFirstDocument = {
  source: 'OPENAI_VISION_SEMANTIC',
  model: 'gpt-5.4-mini',
  generation: 'gcn_qsdd_qsh_nha_o_va_tsk',
  certificate_title: 'Giấy chứng nhận quyền sử dụng đất, quyền sở hữu nhà ở và tài sản khác gắn liền với đất',
  pages: [{
    page_index: 0,
    layout: 'gcn_qsdd_qsh_nha_o_va_tsk_land',
    source_region: 'bottom',
    printed_lines: [],
    sections: [
      {
        semantic: 'owners',
        marker_raw: 'I.',
        label_raw: 'Người sử dụng đất, chủ sở hữu nhà ở và tài sản khác gắn liền với đất',
        label_canonical: '',
        visual_order: 1,
        raw_lines: [
          'Ông: Vũ Văn Đức, Số CMND 172128567, Địa chỉ: Khu 5 TT Mường Khến Huyện Tân Lạc, Tỉnh Hòa Bình',
          'Thông tin khác trên bìa vẫn phải giữ'
        ]
      },
      {
        semantic: 'land_details',
        marker_raw: 'II.',
        label_raw: 'Thửa đất, nhà ở và tài sản khác gắn liền với đất',
        label_canonical: '',
        visual_order: 2,
        raw_lines: [
          '1. Thửa đất:',
          'a. Thửa đất số: 69; tờ bản đồ số: 16',
          'b. Địa chỉ: Tổ 10 Phường Tân Hòa, Thành phố Hòa Bình, Tỉnh Hòa Bình',
          'c. Diện tích: 45,10 m² (Bằng chữ: Bốn lăm phẩy một mét vuông)',
          'd. Hình thức sử dụng: riêng; Mục đích sử dụng: Đất ở',
          'e. Thời hạn sử dụng: Lâu dài',
          'g. Nguồn gốc sử dụng: "Công nhận QSDĐ như giao đất không thu tiền sử dụng đất"',
          '2. Nhà ở: Nhà cấp 4',
          '3. Công trình xây dựng khác: -/-',
          '4. Rừng sản xuất là rừng trồng: -/-',
          '5. Cây lâu năm: -/-',
          '6. Ghi chú:'
        ]
      },
      {
        semantic: 'post_issue_changes',
        marker_raw: 'IV.',
        label_raw: 'Những thay đổi sau khi cấp Giấy chứng nhận',
        label_canonical: '',
        visual_order: 3,
        raw_lines: [
          'Xóa nội dung đăng ký thế chấp ngày 26/9/2012 theo hồ sơ số 002526. XT.002.'
        ]
      }
    ],
    items: [
      { semantic_key: 'certificate_number', value: 'BĐ151871', confidence: 0.96 },
      { semantic_key: 'registry_number', value: 'CH00344', confidence: 0.96 }
    ]
  }],
  items: [
    { semantic_key: 'certificate_number', value: 'BĐ151871', confidence: 0.96 },
    { semantic_key: 'registry_number', value: 'CH00344', confidence: 0.96 }
  ]
};
const transcriptLines = reviewClientContext.semanticCertificateDocumentToTranscriptLines_(transcriptFirstDocument).map(line => line.text);
assert(transcriptLines.includes('I. Người sử dụng đất, chủ sở hữu nhà ở và tài sản khác gắn liền với đất'));
assert(transcriptLines.includes('Thông tin khác trên bìa vẫn phải giữ'));
assert(transcriptLines.includes('a. Thửa đất số: 69; tờ bản đồ số: 16'));
assert(!transcriptLines.includes('b. Tờ bản đồ số: 16'));
assert(transcriptLines.includes('3. Công trình xây dựng khác: -/-'));
assert(transcriptLines.includes('4. Rừng sản xuất là rừng trồng: -/-'));
assert(transcriptLines.includes('6. Ghi chú:'));
assert(transcriptLines.some(line => line.indexOf('Xóa nội dung đăng ký thế chấp') >= 0));
assert.strictEqual(reviewClientContext.semanticDocumentItemValue_(transcriptFirstDocument, ['certificate_number']), 'BĐ151871');
const printedLineTranscript = reviewClientContext.semanticCertificateDocumentToTranscriptLines_({
  items: [
    { semantic_key: 'registry_number', label_raw: 'Số vào sổ cấp GCN', value: 'C# 00144', confidence: 0.94 },
    { semantic_key: 'certificate_number', label_raw: 'Số vào sổ cấp GCN', value: 'CH00344', confidence: 0.98 }
  ],
  pages: [{
    page_index: 0,
    printed_lines: [
      'BD 151871',
      'II. Thửa đất, nhà ở và tài sản khác gắn liền với đất',
      '1. Thửa đất:',
      'a) Thửa đất số: 69',
      'b) Địa chỉ: Tổ 10 Phường Tân Hòa, Thành phố Hòa Bình, Tỉnh Hòa Bình',
      'c) Diện tích: 45,10 mÂ²',
      'Tờ bản đồ số: 16',
      '3. Công trình xây dựng khác:',
      '4. Rừng sản xuất là rừng trồng:',
      'IV. Những thay đổi sau khi cấp giấy chứng nhận quyền sử dụng đất',
      'Số phát hành GCN: BĐ 51871',
      'Số vào sổ cấp GCN: C# 00144',
      'Xóa nội dung đăng ký thế chấp ngày 26/9/2012 theo hồ sơ số 002526.XT.002'
    ],
    sections: []
  }]
}).map(line => line.text);
assert(printedLineTranscript.includes('BĐ 151871'));
assert(printedLineTranscript.includes('a) Thửa đất số: 69; tờ bản đồ số: 16'));
assert(!printedLineTranscript.includes('Tờ bản đồ số: 16'));
assert(printedLineTranscript.includes('II. Thửa đất, nhà ở và tài sản khác gắn liền với đất'));
assert(printedLineTranscript.includes('3. Công trình xây dựng khác:'));
assert(printedLineTranscript.some(line => line.indexOf('Xóa nội dung đăng ký thế chấp') >= 0));
assert(printedLineTranscript.includes('Số phát hành GCN: BĐ151871'));
assert(printedLineTranscript.includes('Số vào sổ cấp GCN: CH00344'));
assert(!printedLineTranscript.includes('Số phát hành GCN: BĐ 51871'));
assert(!printedLineTranscript.includes('Số vào sổ cấp GCN: C# 00144'));
assert.strictEqual(
  reviewClientContext.certificateSerialForReview_(
    { real_estate: { certificate_number: { final_value: 'BD151871' } } },
    ''
  ),
  'BĐ151871'
);
assert.strictEqual(reviewClientContext.normalizeCertificateSerialForReview_('BD 151871'), 'BĐ151871');
const reorderedNoisyFields = dataMergeContext.extractRealEstateIndexedLandFields_(reorderedNoisyOldCertificateText);
assert.strictEqual(reorderedNoisyFields.land_plot_number, '303');
assert.strictEqual(reorderedNoisyFields.map_sheet_number, '3');
assert(/^116,0 m/.test(reorderedNoisyFields.area));
assert.strictEqual(reorderedNoisyFields.usage_form, 'Sử dụng riêng');
assert.strictEqual(reorderedNoisyFields.usage_purpose, 'Đất ở tại đô thị');
assert.strictEqual(reorderedNoisyFields.usage_origin, 'Nhà nước giao đất có thu tiền sử dụng đất');

const liveLikeOldCertificateText = `
GIẤY CHỨNG NHẬN
QUYỀN SỬ DỤNG ĐẤT, QUYỀN SỞ HỮU NHÀ Ở VÀ TÀI SẢN KHÁC GẮN LIỀN VỚI ĐẤT
I. Người sử dụng đất, chủ sở hữu nhà ở và tài sản khác gắn liền với đất
Ông: Vương Đặng Hưng
Năm sinh: 1990, CCCD số: 001090013443
Địa chỉ thường trú: Lê Lợi, Vân Đình, Ứng Hòa, Hà Nội.
II. Thửa đất, nhà ở và tài sản khác gắn liền với đất
1. Thửa đất:
a) Thửa đất số: 303, tờ bản đồ số: 3
b) Địa chỉ: Khu 1, thị trấn Chi Nê, huyện Lạc Thủy, tỉnh Hòa Bình
+ Diện tích: 116,0mÂ² ", (bằng chữ: một trăm mười sáu phẩy không mét vuông)
d) Hình thức sử dụng: Sử dụng riêng
d) Mục đích sử dụng: Đất ở tại đô thị
e) Thời hạn sử dụng: Lâu dài
g) Nguồn gốc sử dụng: Nhà nước giao đất có thu tiền sử dụng đất
2. Nhà ở: -/-
* Công trình xây dựng khác: -/-
Rừng sản xuất là rừng trồng: -/-
5. Cây lâu năm: -/-
6. Ghi chú: Không
III. Sơ đồ thửa đất, nhà ở và tài sản khác gắn liền với đất
IV. Những thay đổi sau khi cấp Giấy chứng nhận
Nội dung thay đổi và cơ sở pháp lý: chuyển nhượng cho ông Mai Lê Thành, CCCP sa 036080024419
`;
const liveLikeDocument = dataMergeContext.parseLandCertificateSemanticDocument_(
  liveLikeOldCertificateText,
  { certificate_title: 'Giấy chứng nhận quyền sử dụng đất, quyền sở hữu nhà ở và tài sản khác gắn liền với đất' }
);
const liveLikeLayout = reviewClientContext.semanticCertificateDocumentToPrintedLayout_(
  JSON.parse(JSON.stringify(liveLikeDocument))
);
assert.strictEqual(
  liveLikeLayout.land_fields.map(item => item.label).join('|'),
  'Thửa đất số|Địa chỉ|Diện tích|Hình thức sử dụng|Mục đích sử dụng|Thời hạn sử dụng|Nguồn gốc sử dụng'
);
assert.strictEqual(liveLikeLayout.land_fields[0].marker, 'a');
assert.strictEqual(liveLikeLayout.land_fields[0].value, '303');
assert.strictEqual(liveLikeLayout.land_fields[0].inline_fields[0].label, 'Tờ bản đồ số');
assert.strictEqual(liveLikeLayout.land_fields[0].inline_fields[0].value, '3');
assert.strictEqual(liveLikeLayout.land_fields[1].value, 'Khu 1, thị trấn Chi Nê, huyện Lạc Thủy, tỉnh Hòa Bình');
assert(!/thuong tru/i.test(dataMergeContext.removeVietnameseAccents_(liveLikeLayout.land_fields[1].value)));
assert.strictEqual(liveLikeLayout.land_fields[2].marker, 'c');
assert.strictEqual(liveLikeLayout.land_fields[2].area_words, 'một trăm mười sáu phẩy không mét vuông');
assert.strictEqual(
  liveLikeLayout.optional_sections.map(item => item.marker + ':' + item.label).join('|'),
  '2:Nhà ở|3:Công trình xây dựng khác|4:Rừng sản xuất là rừng trồng|5:Cây lâu năm|6:Ghi chú'
);
assert.strictEqual(
  liveLikeDocument.items.filter(item => item.semantic_key === 'post_issue_change_content')[0].value,
  'chuyển nhượng cho ông Mai Lê Thành, CCCD số 036080024419'
);

const splitSemanticDocument = dataMergeContext.parseLandCertificateSemanticDocument_(`
[LAND_OCR_REGION layout=gcn_qsdd_qsh_nha_o_va_tsk_land region=full]
II. Thửa đất, nhà ở và tài sản khác gắn liền với đất
a) Thửa đất số: 303
III. Sơ đồ thửa đất
[/LAND_OCR_REGION]
[LAND_OCR_REGION layout=gcn_qsdd_qsh_nha_o_va_tsk_land region=left]
II. Thửa đất, nhà ở và tài sản khác gắn liền với đất
a) Thửa đất số: 303
[/LAND_OCR_REGION]
[LAND_OCR_REGION layout=gcn_qsdd_qsh_nha_o_va_tsk_change region=right]
III. Sơ đồ thửa đất
IV. Những thay đổi sau khi cấp Giấy chứng nhận
[/LAND_OCR_REGION]
`);
assert.strictEqual(splitSemanticDocument.pages.length, 2);
assert.strictEqual(splitSemanticDocument.pages.map(page => page.source_region).join('|'), 'left|right');
assert.strictEqual(splitSemanticDocument.items.filter(item => item.semantic_key === 'land_plot_number').length, 1);

const topBottomSemanticDocument = dataMergeContext.parseLandCertificateSemanticDocument_(`
[LAND_OCR_REGION layout=gcn_qsdd_cover region=full]
I. Người sử dụng đất
Ông: Nguyễn Văn A
IV. Những thay đổi sau khi cấp Giấy chứng nhận
[/LAND_OCR_REGION]
[LAND_OCR_REGION layout=gcn_qsdd_cover region=top]
I. Người sử dụng đất
Ông: Nguyễn Văn A
[/LAND_OCR_REGION]
[LAND_OCR_REGION layout=gcn_qsdd_land region=bottom]
II. Thửa đất
a) Thửa đất số: 69
b) Tờ bản đồ số: 16
[/LAND_OCR_REGION]
`);
assert.strictEqual(topBottomSemanticDocument.pages.length, 2);
assert.strictEqual(topBottomSemanticDocument.pages.map(page => page.source_region).join('|'), 'top|bottom');
assert.strictEqual(
  topBottomSemanticDocument.items.filter(item => item.semantic_key === 'land_plot_number')[0].value,
  '69'
);

const normalizedChangeDocument = dataMergeContext.parseLandCertificateSemanticDocument_(`
IV. Những thay đổi sau khi cấp Giấy chứng nhận
Nội dung thay đổi và cơ sở pháp lý: Chuyển nhượng cho ông A, CCCP sa 036080024419
`);
assert.strictEqual(
  normalizedChangeDocument.items.filter(item => item.semantic_key === 'post_issue_change_content')[0].value,
  'Chuyển nhượng cho ông A, CCCD số 036080024419'
);

const noisyAbsentOptionalDocument = dataMergeContext.parseLandCertificateSemanticDocument_(`
II. Thửa đất, nhà ở và tài sản khác gắn liền với đất
g ) Nguồn gốc sử dụng : Nhà nước giao đất có thu tiền sử dụng đất
2 Nhà ở nghĩa
dung be song
* Công trình xây dựng khác .
chi Rừng sản xuất là rừng trồng
5. Cây lâu năm
6. Ghi chú : Không
III. Sơ đồ thửa đất
`);
const noisyAbsentOptionalValues = {};
noisyAbsentOptionalDocument.items.forEach(item => {
  if (['house', 'other_construction', 'production_forest', 'perennial_crops'].includes(item.semantic_key)) {
    noisyAbsentOptionalValues[item.semantic_key] = item.value;
  }
});
assert.strictEqual(noisyAbsentOptionalValues.house, '-/-');
assert.strictEqual(noisyAbsentOptionalValues.other_construction, '-/-');
assert.strictEqual(noisyAbsentOptionalValues.production_forest, '-/-');
assert.strictEqual(noisyAbsentOptionalValues.perennial_crops, '-/-');
assert.strictEqual(
  noisyAbsentOptionalDocument.items.filter(item => item.semantic_key === 'certificate_note')[0].value,
  'Không'
);

console.log('OK land OCR regression');

