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
So vao so cap Giay chung nhan: CN.5.42.9
[/LAND_OCR_REGION]
`;
const a4PdfFields = dataMergeContext.extractRealEstateIndexedLandFields_(newA4PdfText);
assert.strictEqual(a4PdfFields.land_plot_number, '100');
assert.strictEqual(a4PdfFields.map_sheet_number, '40');
assert(/^1441,9 m/.test(a4PdfFields.area));
assert.strictEqual(a4PdfFields.usage_purpose, 'Dat o tai nong thon: 400,0 m2; Dat trong cay lau nam: 1041,9 m2');
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
assert.strictEqual(dataMergeContext.extractRealEstateIssueDate_(newA4PdfText), '04/07/2025');
assert.strictEqual(dataMergeContext.extractOwnerAddressFromCertificateText_(newA4PdfText), '');
assert.strictEqual(dataMergeContext.extractCertificateNoteFromCertificateText_(newA4PdfText), '-/-');
assert.strictEqual(dataMergeContext.extractPostIssueChangesFromCertificateText_(newA4PdfText).status, 'absent');
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

const ocrServiceContext = {};
vm.createContext(ocrServiceContext);
vm.runInContext(fs.readFileSync('OCRService.gs', 'utf8'), ocrServiceContext);
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
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(ocrServiceContext.visionBoundingRectForRegions_({
    normalizedVertices: [{ x: 0.1, y: 0.2 }, { x: 0.3, y: 0.2 }, { x: 0.3, y: 0.4 }, { x: 0.1, y: 0.4 }]
  }, 1000, 2000))),
  { x: 100, y: 400, width: 200, height: 400 }
);

console.log('OK land OCR regression');

