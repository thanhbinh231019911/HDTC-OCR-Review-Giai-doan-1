const assert = require('assert');

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
    .replace(/\s+(?:số|so)\s+v(?:ào|ao)\s+s(?:ổ|ố|o)\s+c(?:ấp|ap)\s+(?:gcn|gi(?:ấy|ay)\s+ch(?:ứng|ung)\s+nh(?:ận|an))\b.*$/i, '')
    .replace(/\s+iv\s*[\).:]?\s*nh(?:ững|ung)\s+thay\s+(?:đổi|doi)\b.*$/i, '')
    .trim();
}

function normalizeNumberedCertificateItemValue(value, number) {
  let text = oneLineCertificateValue(value).replace(/[.。]+$/g, '').trim();
  if (number === 6) text = text.replace(/^(?:ghi\s*chú|ghi\s*chu)\s*[:;.-]?\s*/i, '').trim();
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
      layout: isNewA4Anchor ? 'new_a4_page_1' : 'old_4_page_land'
    };
  }
  return best;
}

function classifyLandCertificatePageText_(value) {
  const normalized = removeVietnameseAccents_(String(value || '')).toLowerCase().replace(/[.:)\-]+/g, ' ').replace(/\s+/g, ' ').trim();
  const scores = {
    old_4_page_cover: 0,
    old_4_page_land: 0,
    old_4_page_change: 0,
    new_a4_page_1: 0,
    new_a4_page_2: 0
  };
  if (normalized.indexOf('giay chung nhan') >= 0) scores.old_4_page_cover += 2;
  if (/\b(?:co|dh|aa)\s*\d{5,}\b/i.test(normalized)) scores.old_4_page_cover += 1;
  if (normalized.indexOf('ii thua dat') >= 0 || normalized.indexOf('1 thua dat') >= 0) scores.old_4_page_land += 3;
  if (normalized.indexOf('nguon goc su dung') >= 0) scores.old_4_page_land += 1;
  if (normalized.indexOf('iii so do') >= 0 || normalized.indexOf('iv nhung thay doi') >= 0) scores.old_4_page_change += 3;
  if (normalized.indexOf('2 thong tin thua dat') >= 0) scores.new_a4_page_1 += 4;
  if (normalized.indexOf('loai dat') >= 0) scores.new_a4_page_1 += 2;
  if (normalized.indexOf('3 thong tin tai san gan lien voi dat') >= 0) scores.new_a4_page_1 += 1;
  if (normalized.indexOf('4 so do thua dat') >= 0) scores.new_a4_page_2 += 3;
  if (normalized.indexOf('5 ghi chu') >= 0 || normalized.indexOf('6 nhung thay doi') >= 0) scores.new_a4_page_2 += 2;
  return Object.keys(scores).reduce((best, layout) => scores[layout] > best.score ? { layout, score: scores[layout] } : best, { layout: 'unknown', score: 0 });
}

function scoreLandPlotTextCandidate_(value) {
  const normalized = removeVietnameseAccents_(String(value || '')).toLowerCase().replace(/\s+/g, ' ').trim();
  const classified = classifyLandCertificatePageText_(value);
  let score = 0;
  if (classified.layout === 'new_a4_page_1') score += classified.score;
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
  const match = text.match(/([0-9]+(?:[,.][0-9]+)?)\s*m(?:2|²)?/i);
  return match ? match[1] + ' m²' : '';
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
    /\b[0-9]+(?:[,.][0-9]+)?\s*m(?:2|²)?\b/i.test(text);
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
  if (selected.layout === 'new_a4_page_1') {
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
GIẤY CHỨNG NHẬN
QUYỀN SỬ DỤNG ĐẤT
II. Thửa đất, nhà ở và tài sản khác gắn liền với đất
1. Thửa đất:
a) Thửa đất số: 1622 tờ bản đồ số: 10
b) Địa chỉ: xã Sủ Ngòi, thành phố Hòa Bình, tỉnh Hòa Bình
c) Diện tích: 108,0m² (Bằng chữ: một trăm linh tám phẩy không mét vuông)
d) Hình thức sử dụng: Sử dụng riêng ) Mục đích sử dụng: Đất ở tại nông thôn
e) Thời hạn sử dụng: Lâu dài
g) Nguồn gốc sử dụng: Nhận chuyển nhượng đất được Nhà nước giao đất có thu tiền sử dụng đất
`;

const fields = extractRealEstateIndexedLandFields_(landOcrText);
assert.strictEqual(fields.usage_form, 'Sử dụng riêng');
assert.strictEqual(fields.usage_purpose, 'Đất ở tại nông thôn');
assert.strictEqual(fields.usage_term, 'Lâu dài');
assert.strictEqual(
  fields.usage_origin,
  'Nh\u1eadn chuy\u1ec3n nh\u01b0\u1ee3ng \u0111\u1ea5t \u0111\u01b0\u1ee3c Nh\u00e0 n\u01b0\u1edbc giao \u0111\u1ea5t c\u00f3 thu ti\u1ec1n s\u1eed d\u1ee5ng \u0111\u1ea5t'
);
assert.strictEqual(fields.area, '108,0 m²');
assert.strictEqual(shouldReplaceUsageForm_({ final_value: 'Sử dụng riêng ) Mục đích sử dụng: Đất ở tại nông thôn' }, fields.usage_form), true);
assert.strictEqual(shouldReplaceUsageTerm_({ final_value: 'Diện tích: 108,0m² (Bằng chữ: một trăm linh tám phẩy không mét vuông)' }, fields.usage_term), true);
assert.strictEqual(cleanupSemanticLandFieldValue_('Sử dụng riêng đ'), 'Sử dụng riêng');
assert.strictEqual(
  normalizeNumberedCertificateItemValue('Ghi chú: Không Số vào sổ cấp GCN: 027 coquan có 15.00 m', 6),
  'Không'
);
assert.strictEqual(
  normalizeNumberedCertificateItemValue('Ghi chú: Không Số vào số cấp GCN: 027 coquan có 15.00 m', 6),
  'Không'
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
I. Người sử dụng đất, chủ sở hữu nhà ở và tài sản khác gắn liền với đất
Bà: Đặng Thị Quỳnh
Địa chỉ thường trú: Tỉnh Nhuệ, Thanh Sơn, tỉnh Phú Thọ
II. Thửa đất, nhà ở và tài sản khác gắn liền với đất
1. Thửa đất:
a) Thửa đất số: 1623 tờ bản đồ số: 10
b) Địa chỉ: xã Sủ Ngòi, thành phố Hòa Bình, tỉnh Hòa Bình
c) Diện tích: 150,0m²
d) Hình thức sử dụng: Sử dụng riêng
đ) Mục đích sử dụng: Đất ở tại nông thôn
e) Thời hạn sử dụng: Lâu dài
g) Nguồn gốc sử dụng: Nhận chuyển nhượng đất được Nhà nước giao đất có thu tiền sử dụng đất
2. Nhà ở: -/-
IV. Những thay đổi sau khi cấp Giấy chứng nhận
`;
const noisyFields = extractRealEstateIndexedLandFields_(noisyTwoPageText);
assert.strictEqual(noisyFields._quality.trusted, true);
assert.strictEqual(noisyFields.usage_purpose, 'Đất ở tại nông thôn');
assert.strictEqual(isUnsafeLandAddressValue_('Địa chỉ thường trú: Tỉnh Nhuệ, Thanh Sơn, tỉnh Phú Thọ. CO 402508'), true);
assert.strictEqual(isUnsafeIndexedLandFieldValue_('Đất ở tại nông thôn Thời hạn sử dụng: Lâu dài Nguồn gốc sử dụng: Nhận chuyển nhượng đất'), true);
const newA4Page1Text = `
GIẤY CHỨNG NHẬN
QUYỀN SỬ DỤNG ĐẤT, QUYỀN SỞ HỮU TÀI SẢN GẮN LIỀN VỚI ĐẤT
1. Người sử dụng đất, chủ sở hữu tài sản gắn liền với đất:
Ông: Nguyễn Viết Trọng, CCCD: 017065002419
Và vợ: Lê Thị Huế, CCCD: 001166034340
2. Thông tin thửa đất:
a. Thửa đất số: 100 ; tờ bản đồ số: 40
b. Diện tích: 1441,9 m²
c. Loại đất: Đất ở tại nông thôn: 400,0 m²; Đất trồng cây lâu năm: 1041,9 m²
d. Thời hạn sử dụng: Đất ở tại nông thôn: Lâu dài; Đất trồng cây lâu năm: Đến tháng 10/2045
đ. Hình thức sử dụng: Sử dụng chung của vợ và chồng
e. Địa chỉ: Xóm Giữa, xã Liên Sơn, tỉnh Phú Thọ
3. Thông tin tài sản gắn liền với đất: -/-
`;
const newA4Fields = extractRealEstateIndexedLandFields_(newA4Page1Text);
assert.strictEqual(classifyLandCertificatePageText_(newA4Page1Text).layout, 'new_a4_page_1');
assert.strictEqual(newA4Fields._quality.layout, 'new_a4_page_1');
assert.strictEqual(newA4Fields._quality.trusted, true);
assert.strictEqual(newA4Fields.area, '1441,9 m²');
assert.strictEqual(newA4Fields.usage_purpose, 'Đất ở tại nông thôn: 400,0 m²; Đất trồng cây lâu năm: 1041,9 m²');
assert.strictEqual(newA4Fields.usage_term, 'Đất ở tại nông thôn: Lâu dài; Đất trồng cây lâu năm: Đến tháng 10/2045');
assert.strictEqual(newA4Fields.usage_form, 'Sử dụng chung của vợ và chồng');
assert.strictEqual(newA4Fields.land_address, 'Xóm Giữa, xã Liên Sơn, tỉnh Phú Thọ');
assert.strictEqual(classifyLandCertificatePageText_('4. Sơ đồ thửa đất, tài sản gắn liền với đất\\n5. Ghi chú: -/-\\n6. Những thay đổi sau khi cấp Giấy chứng nhận').layout, 'new_a4_page_2');
assert.strictEqual(classifyLandCertificatePageText_('IV. Những thay đổi sau khi cấp Giấy chứng nhận\\nNội dung thay đổi và cơ sở pháp lý').layout, 'old_4_page_change');

const fileMeta = reclassifyOcrFileMetaByContent_({
  group: 'secured_party',
  fileName: 'secured_party__bia 1-1.jpg'
}, landOcrText);
assert.strictEqual(fileMeta.group, 'asset');
assert.strictEqual(fileMeta.fileName, 'asset__bia 1-1.jpg');

console.log('OK land OCR regression');
