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
    'hinh thuc su dung',
    'muc dich su dung',
    'thoi han su dung',
    'nguon goc su dung',
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

function extractRealEstateIndexedLandFields_(text) {
  return {
    area: normalizeRealEstateAreaValue_(findSemanticLandFieldValue_(text, ['dien tich'])),
    usage_form: normalizeRealEstateUsageForm_(findSemanticLandFieldValue_(text, ['hinh thuc su dung'])),
    usage_purpose: findSemanticLandFieldValue_(text, ['muc dich su dung']),
    usage_term: normalizeRealEstateUsageTerm_(findSemanticLandFieldValue_(text, ['thoi han su dung']))
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

const fileMeta = reclassifyOcrFileMetaByContent_({
  group: 'secured_party',
  fileName: 'secured_party__bia 1-1.jpg'
}, landOcrText);
assert.strictEqual(fileMeta.group, 'asset');
assert.strictEqual(fileMeta.fileName, 'asset__bia 1-1.jpg');

console.log('OK land OCR regression');
