const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.OCR_LAB_PORT || 5177);
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');

const SKILLS = {
  cccd: 'OCR CCCD/Can cuoc',
  land: 'OCR Bia dat'
};

function sendJson(res, status, body) {
  const data = Buffer.from(JSON.stringify(body, null, 2), 'utf8');
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': data.length
  });
  res.end(data);
}

function sendFile(res, filePath, contentType) {
  fs.readFile(filePath, (err, data) => {
    if (err) return sendJson(res, 404, { error: 'Not found' });
    res.writeHead(200, { 'content-type': contentType });
    res.end(data);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

function normalizeDate(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  let match = text.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/);
  if (match) return formatValidDate(match[1], match[2], match[3]);
  match = text.match(/^(\d{2})(\d{2})(\d{4})$/);
  if (match) return formatValidDate(match[1], match[2], match[3]);
  return '';
}

function formatValidDate(dayValue, monthValue, yearValue) {
  const day = Number(dayValue);
  const month = Number(monthValue);
  const year = Number(yearValue);
  if (year < 1900 || year > 2099 || month < 1 || month > 12 || day < 1 || day > 31) return '';
  const daysInMonth = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (day > daysInMonth) return '';
  return pad2(day) + '/' + pad2(month) + '/' + year;
}

function isLeapYear(year) {
  return year % 400 === 0 || (year % 4 === 0 && year % 100 !== 0);
}

function pad2(value) {
  value = String(value || '');
  return value.length === 1 ? '0' + value : value;
}

function extractVietnamIds(text) {
  const ids = new Set();
  String(text || '').replace(/\b\d{9}\b|\b\d{12}\b/g, value => {
    ids.add(value);
    return value;
  });
  String(text || '').replace(/IDVNM([0-9<]+)/gi, (_, raw) => {
    const digits = raw.replace(/\D/g, '');
    if (digits.length >= 22) ids.add(digits.slice(10, 22));
    return raw;
  });
  return Array.from(ids);
}

function extractCccdIssueDate(text, options) {
  options = options || {};
  if (options.issueDateCrop) return extractCccdIssueDateFromCrop(text);
  const lines = String(text || '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const searchable = normalizeText(lines[i]).replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
    const compact = searchable.replace(/\s+/g, '');
    const labelType = detectIssueDateLabelType(searchable, compact);
    if (!labelType) continue;
    const windowText = buildIssueDateWindow(lines, i, labelType);
    const date = extractStrictDate(windowText);
    if (date) return { value: date, evidence: windowText.trim(), label_type: labelType };
  }
  return { value: '', evidence: '', label_type: '' };
}

function detectIssueDateLabelType(searchable, compact) {
  searchable = String(searchable || '');
  compact = String(compact || '');
  if (searchable.includes('date of issue') ||
      searchable.includes('ngay thang nam cap') ||
      /ng.?y.*th.?ng.*n.?m.*c.?p/.test(searchable)) {
    return 'date_of_issue';
  }
  if (searchable.includes('date month year') ||
      searchable.includes('ngay thang nam') ||
      /ng.?y.*th.?ng.*n.?m/.test(searchable) ||
      /datemonthyea/.test(compact)) {
    return 'date_month_year';
  }
  if (searchable.includes('ngay cap')) return 'date_of_issue';
  return '';
}

function buildIssueDateWindow(lines, lineIndex, labelType) {
  const current = lines[lineIndex] || '';
  const next1 = lines[lineIndex + 1] || '';
  const next2 = lines[lineIndex + 2] || '';
  if (labelType === 'date_of_issue') {
    return [current, next1, next2].join(' ');
  }
  const yearIndex = normalizeText(current).indexOf('year');
  if (yearIndex >= 0) {
    return [current.slice(yearIndex), next1, next2].join(' ');
  }
  return [current, next1, next2].join(' ');
}

function extractCccdIssueDateFromCrop(text) {
  const candidates = extractAllStrictDates(text);
  if (candidates.length === 1) {
    return {
      value: candidates[0],
      evidence: String(text || '').replace(/\s+/g, ' ').trim(),
      label_type: 'issue_date_crop'
    };
  }
  return {
    value: '',
    evidence: String(text || '').replace(/\s+/g, ' ').trim(),
    label_type: 'issue_date_crop'
  };
}

function extractStrictDate(text) {
  const separatedMatches = String(text || '').match(/(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})/g) || [];
  for (const value of separatedMatches) {
    const date = normalizeDate(value);
    if (date) return date;
  }
  const compactMatches = String(text || '').match(/(?:^|\D)(\d{8})(?=\D|$)/g) || [];
  for (const raw of compactMatches) {
    const date = normalizeDate(raw.replace(/\D/g, ''));
    if (date) return date;
  }
  return '';
}

function extractAllStrictDates(text) {
  const out = [];
  const value = String(text || '');
  value.replace(/(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})/g, (_, day, month, year) => {
    const date = normalizeDate(day + '/' + month + '/' + year);
    if (date && !out.includes(date)) out.push(date);
    return _;
  });
  value.replace(/(?:^|\D)(\d{8})(?=\D|$)/g, (_, compact) => {
    const date = normalizeDate(compact);
    if (date && !out.includes(date)) out.push(date);
    return _;
  });
  return out;
}

function extractCertificateTitle(text) {
  const normalized = normalizeText(text).replace(/\s+/g, ' ');
  if (normalized.includes('giay chung nhan quyen su dung dat quyen so huu nha o va tai san khac gan lien voi dat') ||
      normalized.includes('giay chung nhan quyen su dung dat quyen so hwuux nha o va tai san khac gan lien voi dat') ||
      normalized.includes('giay chung nhan quyen su dung dat quyen so huux nha o va tai san khac gan lien voi dat')) {
    return 'Giấy chứng nhận quyền sử dụng đất, quyền sở hữu nhà ở và tài sản khác gắn liền với đất';
  }
  if (normalized.includes('giay chung nhan quyen su dung dat quyen so huu tai san gan lien voi dat')) {
    return 'Giấy chứng nhận quyền sử dụng đất, quyền sở hữu tài sản gắn liền với đất';
  }
  if (normalized.includes('giay chung nhan quyen su dung dat')) {
    return 'Giấy chứng nhận quyền sử dụng đất';
  }
  return '';
}

function extractUsageTerm(text) {
  const lines = String(text || '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const n = normalizeText(lines[i]);
    if (!/(^|\s)e[\).\-]/.test(n) && !n.includes('thoi han su dung')) continue;
    const windowText = [lines[i], lines[i + 1] || ''].join(' ').replace(/\s+/g, ' ').trim();
    const match = windowText.match(/(?:e[\).\-]\s*)?(?:Thời hạn sử dụng|Thoi han su dung)\s*:?\s*(.+)$/i);
    const value = (match ? match[1] : windowText.replace(/^e[\).\-]\s*/i, '')).trim();
    return value.replace(/\bLâu đài\b/g, 'Lâu dài').replace(/\blâu đài\b/g, 'lâu dài');
  }
  return '';
}

function extractIndexedLandFields(text) {
  const block = extractLandPlotBlock(text);
  const items = extractIndexedItems(block || text);
  return {
    land_plot_number: cleanupIndexedValue(items.a || '').replace(/\s+to\s+ban\s+do\s+so\s*:.*$/i, ''),
    map_sheet_number: extractMapSheetNumber(items.a || ''),
    land_address: cleanupIndexedValue(items.b || ''),
    area: extractAreaValue(items.c || ''),
    area_in_words: extractAreaWords(items.c || ''),
    usage_form: cleanupIndexedValue(items.d || ''),
    usage_purpose: cleanupIndexedValue(items.dd || ''),
    usage_term: normalizeUsageTerm(cleanupIndexedValue(items.e || '')),
    usage_origin: cleanupIndexedValue(items.g || '')
  };
}

function extractLandPlotBlock(text) {
  const lines = String(text || '').split(/\r?\n/);
  const out = [];
  let inBlock = false;
  for (const line of lines) {
    const normalized = normalizeText(line).replace(/[.:)\-]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!inBlock && (normalized.includes('1 thua dat') || normalized.includes(' thua dat'))) {
      inBlock = true;
      out.push(line);
      continue;
    }
    if (inBlock && /^(?:2|ii)\s*[\).:\-]?\s+/.test(normalized)) break;
    if (inBlock) out.push(line);
  }
  return out.join('\n');
}

function extractIndexedItems(text) {
  const source = String(text || '');
  const matches = [];
  const regex = /(^|\n)\s*([a-g]|\u0111|d)\s*[\).:]\s*/gi;
  let match;
  while ((match = regex.exec(source)) !== null) {
    matches.push({
      key: normalizeIndexedKey(match[2]),
      markerStart: match.index,
      valueStart: match.index + match[0].length
    });
  }
  const items = {};
  for (let i = 0; i < matches.length; i++) {
    const end = i + 1 < matches.length ? matches[i + 1].markerStart : source.length;
    if (!items[matches[i].key]) items[matches[i].key] = source.slice(matches[i].valueStart, end);
  }
  return items;
}

function normalizeIndexedKey(key) {
  if (String(key || '').toLowerCase() === '\u0111') return 'dd';
  return normalizeText(key).replace(/[^a-z]/g, '');
}

function cleanupIndexedValue(value) {
  return String(value || '')
    .replace(/\r?\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^(?:dia chi|address|hinh thuc su dung|muc dich su dung|thoi han su dung|nguon goc su dung)\s*[:.-]?\s*/i, '')
    .replace(/[;,.:\-\s]+$/g, '')
    .trim();
}

function extractMapSheetNumber(value) {
  const match = normalizeText(value).match(/to\s+ban\s+do\s+so\s*:?\s*([a-z0-9-]+)/i);
  return match ? match[1] : '';
}

function extractAreaValue(value) {
  const text = cleanupIndexedValue(value);
  const match = text.match(/\d+(?:[,.]\d+)?\s*m[²2]?/i);
  return match ? match[0].replace(/m2/i, 'm²') : text;
}

function extractAreaWords(value) {
  const match = String(value || '').match(/\(?\s*(?:Bằng chữ|Bang chu)\s*:\s*([^)]+)/i);
  return match ? match[1].replace(/\s+/g, ' ').trim() : '';
}

function normalizeUsageTerm(value) {
  return String(value || '')
    .replace(/\bLâu đài\b/g, 'Lâu dài')
    .replace(/\blâu đài\b/g, 'lâu dài')
    .replace(/\bLau dai\b/gi, 'Lâu dài')
    .trim();
}

function parseCccd(text, options) {
  options = options || {};
  const issueDate = extractCccdIssueDate(text, options);
  const identityFields = extractIdentityFieldsFromOcr(text);
  return {
    skill: SKILLS.cccd,
    mode: options.issueDateCrop ? 'issue_date_crop' : 'full_image',
    fields: {
      full_name: identityFields.full_name,
      date_of_birth: identityFields.date_of_birth,
      document_type: identityFields.document_type,
      id_numbers: identityFields.id_numbers,
      issue_date: issueDate.value,
      expiry_date: identityFields.expiry_date,
      issue_place: identityFields.issue_place,
      permanent_address: identityFields.permanent_address
    },
    evidence: {
      issue_date: issueDate.evidence,
      label_type: issueDate.label_type || ''
    },
    warnings: issueDate.value ? [] : [
      options.issueDateCrop
        ? 'Crop vùng ngày cấp không có đúng một ngày hợp lệ; cần crop lại hoặc sửa tay.'
        : 'Không đọc chắc ngày cấp từ OCR text; cần crop/vùng ngày cấp hoặc sửa tay.'
    ]
  };
}

function extractIdentityFieldsFromOcr(text) {
  text = String(text || '');
  const normalized = normalizeText(text);
  const idNumbers = extractVietnamIds(text);
  return {
    full_name: extractIdentityFullName(text),
    date_of_birth: extractIdentityBirthDate(text),
    document_type: inferIdentityDocumentType(text),
    id_numbers: idNumbers,
    expiry_date: extractIdentityExpiryDate(text),
    issue_place: inferIdentityIssuePlace(text),
    permanent_address: extractIdentityPermanentAddress(text)
  };
}

function inferIdentityDocumentType(text) {
  const normalized = normalizeText(text);
  if (normalized.includes('can cuoc cong dan') || normalized.includes('citizen identity card')) {
    return 'Căn cước công dân';
  }
  if (normalized.includes('can cuoc')) return 'Căn cước';
  return '';
}

function inferIdentityIssuePlace(text) {
  const normalized = normalizeText(text);
  if (normalized.includes('cuc canh sat quan ly hanh chinh') ||
      normalized.includes('canh sat quan ly hanh chinh')) {
    return 'Cục Cảnh sát quản lý hành chính về trật tự xã hội';
  }
  if (normalized.includes('bo cong an') || normalized.includes('ministry of public security')) {
    return 'Bộ Công an';
  }
  return '';
}

function extractIdentityBirthDate(text) {
  const lines = String(text || '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const searchable = normalizeText(lines[i]);
    if (!searchable.includes('date of birth') && !searchable.includes('ngay sinh')) continue;
    const sameLine = extractStrictDate(lines[i]);
    if (sameLine) return sameLine;
    const compactLine = lines[i].replace(/\s+/g, '');
    const compactDate = extractStrictDate(compactLine);
    if (compactDate) return compactDate;
    const nextLine = extractStrictDate(lines[i + 1] || '');
    if (nextLine) return nextLine;
  }
  return '';
}

function extractIdentityExpiryDate(text) {
  const lines = String(text || '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const searchable = normalizeText(lines[i]);
    if (!searchable.includes('date of expiry') &&
        !searchable.includes('expiry') &&
        !searchable.includes('co gia tri den') &&
        !searchable.includes('gia tri den')) continue;
    const sameLine = extractStrictDate(lines[i]);
    if (sameLine) return sameLine;
    const compactDate = extractStrictDate(lines[i].replace(/\s+/g, ''));
    if (compactDate) return compactDate;
    const nextLine = extractStrictDate(lines[i + 1] || '');
    if (nextLine) return nextLine;
  }
  return '';
}

function extractIdentityFullName(text) {
  const lines = String(text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    const searchable = normalizeText(lines[i]);
    if (!searchable.includes('ho va ten') && !searchable.includes('full name')) continue;
    const sameLine = lines[i].split(/full name\s*:?/i).pop().trim();
    if (isLikelyPersonName(sameLine)) return cleanupPersonName(sameLine);
    for (let j = i + 1; j < Math.min(lines.length, i + 4); j++) {
      if (isLikelyPersonName(lines[j])) return cleanupPersonName(lines[j]);
    }
  }
  const mrzName = extractMrzName(text);
  return mrzName;
}

function isLikelyPersonName(value) {
  const text = String(value || '').trim();
  if (!text || /\d/.test(text)) return false;
  const normalized = normalizeText(text);
  if (normalized.includes('ngay sinh') || normalized.includes('date of birth')) return false;
  if (normalized.includes('nationality') || normalized.includes('sex')) return false;
  return /^[A-ZÀ-Ỹ\s]{5,}$/i.test(text);
}

function cleanupPersonName(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function extractMrzName(text) {
  const match = String(text || '').match(/\n([A-Z<]{5,})<<([A-Z<]{2,})/);
  if (!match) return '';
  return cleanupPersonName((match[1] + '<' + match[2]).replace(/</g, ' '));
}

function extractIdentityPermanentAddress(text) {
  const lines = String(text || '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const searchable = normalizeText(lines[i]);
    if (!searchable.includes('noi thuong tru') && !searchable.includes('place of residence')) continue;
    const addressLines = [];
    for (let j = i; j < Math.min(lines.length, i + 4); j++) {
      const normalizedLine = normalizeText(lines[j]);
      if (j > i && (
        normalizedLine.includes('cuc canh sat') ||
        normalizedLine.includes('bo cong an') ||
        normalizedLine.includes('director general') ||
        normalizedLine.includes('police department') ||
        normalizedLine.includes('ngon tro')
      )) break;
      addressLines.push(lines[j]);
    }
    const value = addressLines.join(' ')
      .replace(/.*?(Nơi thường trú|Noi thuong tru|Place of residence)\s*:?\s*/i, '')
      .replace(/^\/\s*Place of residence\s*:?\s*/i, '')
      .replace(/\s+/g, ' ')
      .trim();
    return cleanupIdentityAddress_(value);
  }
  return '';
}

function cleanupIdentityAddress_(value) {
  value = String(value || '').replace(/\s+/g, ' ').trim();
  value = value.replace(/^I\s+Place of residence\s*/i, '');
  value = value.replace(/^\/\s*Place of residence\s*:?\s*/i, '');
  value = value.replace(/\bOÀN\b.*$/i, '').trim();
  value = value.replace(/\bOAN\b.*$/i, '').trim();
  value = value.replace(/\bHOÀNG\b.*$/i, '').trim();
  value = value.replace(/\bHOANG\b.*$/i, '').trim();
  value = value.replace(/\bri,\s*phi\b.*$/i, '').trim();
  return value;
}

function suggestCccdIssueDateCropFromGoogleVision(raw) {
  const newIdCrop = suggestNewIdentityIssueDateCropFromGoogleVision(raw);
  if (newIdCrop) return newIdCrop;
  const pages = raw && raw.fullTextAnnotation && raw.fullTextAnnotation.pages || [];
  for (const page of pages) {
    const pageWidth = Number(page.width || 0);
    const pageHeight = Number(page.height || 0);
    for (const block of page.blocks || []) {
      for (const paragraph of block.paragraphs || []) {
        for (const word of paragraph.words || []) {
          const text = (word.symbols || []).map(symbol => symbol.text || '').join('');
          const normalized = normalizeText(text);
          const yearIndex = findIssueDateYearIndex(normalized);
          if (yearIndex < 0) continue;
          const box = boundingRect(word.boundingBox);
          if (!box || box.width < 4 || box.height < 4) continue;
          const charCount = Math.max(text.length, 1);
          const dateStartRatio = Math.min(0.9, Math.max(0, (yearIndex + 3) / charCount));
          const startX = Math.max(0, Math.round(box.x + box.width * dateStartRatio - box.height * 0.15));
          const y = Math.max(0, Math.round(box.y - box.height * 0.75));
          const rightFromWord = Math.round(box.x + box.width + box.height * 1.8);
          const rightFallback = Math.round(startX + Math.max(pageWidth * 0.18, box.height * 8));
          const right = Math.min(pageWidth || rightFromWord, Math.max(rightFromWord, rightFallback));
          const height = Math.min(pageHeight - y, Math.round(box.height * 2.6));
          const width = Math.max(8, right - startX);
          if (width < 8 || height < 8) continue;
          return {
            x: startX,
            y,
            width,
            height,
            reason: 'old_cccd_year_label',
            anchor_text: text
          };
        }
      }
    }
  }
  const mrzLayoutCrop = suggestOldCccdIssueDateCropFromMrzLayout_(raw);
  if (mrzLayoutCrop) return mrzLayoutCrop;
  return null;
}

function suggestOldCccdIssueDateCropFromMrzLayout_(raw) {
  const words = collectGoogleVisionWords(raw);
  for (const word of words) {
    const normalized = normalizeText(word.text).replace(/\s+/g, '');
    if (normalized.indexOf('idvnm') < 0) continue;
    const box = word.box;
    if (!box || box.width < 40 || box.height < 5) continue;
    const pageWidth = word.pageWidth || 0;
    const pageHeight = word.pageHeight || 0;
    const x = Math.max(0, Math.round(box.x + box.width * 0.52));
    const y = Math.max(0, Math.round(box.y - box.width * 0.62));
    const width = Math.max(8, Math.round(box.width * 0.36));
    const height = Math.max(8, Math.round(box.width * 0.09));
    return {
      x,
      y,
      width: Math.min(width, Math.max(8, pageWidth - x)),
      height: Math.min(height, Math.max(8, pageHeight - y)),
      reason: 'old_cccd_mrz_layout_year_region',
      anchor_text: word.text
    };
  }
  return null;
}

function suggestNewIdentityIssueDateCropFromGoogleVision(raw) {
  const words = collectGoogleVisionWords(raw);
  for (let i = 0; i < words.length; i++) {
    const current = normalizeText(words[i].text);
    const next1 = normalizeText(words[i + 1] && words[i + 1].text);
    const next2 = normalizeText(words[i + 2] && words[i + 2].text);
    const isDateOfIssue = current === 'date' && next1 === 'of' && next2.indexOf('issue') === 0;
    if (!isDateOfIssue) continue;
    const labelBox = mergeRects([words[i].box, words[i + 1].box, words[i + 2].box]);
    if (!labelBox) continue;
    const pageWidth = words[i].pageWidth || 0;
    const pageHeight = words[i].pageHeight || 0;
    const height = Math.round(labelBox.height * 2.4);
    const width = Math.round(Math.max(labelBox.width * 1.5, labelBox.height * 9));
    const x = Math.max(0, Math.round(labelBox.x + labelBox.width / 2 - width / 2));
    const y = Math.max(0, Math.round(labelBox.y + labelBox.height * 0.85));
    return {
      x,
      y,
      width: Math.min(width, Math.max(8, pageWidth - x)),
      height: Math.min(height, Math.max(8, pageHeight - y)),
      reason: 'new_can_cuoc_date_of_issue_label',
      anchor_text: [words[i].text, words[i + 1].text, words[i + 2].text].join(' ')
    };
  }
  return null;
}

function collectGoogleVisionWords(raw) {
  const out = [];
  const pages = raw && raw.fullTextAnnotation && raw.fullTextAnnotation.pages || [];
  for (const page of pages) {
    const pageWidth = Number(page.width || 0);
    const pageHeight = Number(page.height || 0);
    for (const block of page.blocks || []) {
      for (const paragraph of block.paragraphs || []) {
        for (const word of paragraph.words || []) {
          const text = (word.symbols || []).map(symbol => symbol.text || '').join('');
          const box = boundingRect(word.boundingBox);
          if (!text || !box) continue;
          out.push({ text, box, pageWidth, pageHeight });
        }
      }
    }
  }
  return out;
}

function mergeRects(rects) {
  rects = (rects || []).filter(Boolean);
  if (!rects.length) return null;
  const minX = Math.min.apply(null, rects.map(rect => rect.x));
  const minY = Math.min.apply(null, rects.map(rect => rect.y));
  const maxX = Math.max.apply(null, rects.map(rect => rect.x + rect.width));
  const maxY = Math.max.apply(null, rects.map(rect => rect.y + rect.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function findIssueDateYearIndex(normalizedWord) {
  const text = String(normalizedWord || '');
  let idx = text.indexOf('year');
  if (idx >= 0) return idx;
  idx = text.indexOf('yea');
  if (idx >= 0) return idx;
  return -1;
}

function boundingRect(box) {
  const vertices = box && box.vertices || [];
  if (!vertices.length) return null;
  const xs = vertices.map(v => Number(v.x || 0));
  const ys = vertices.map(v => Number(v.y || 0));
  const minX = Math.min.apply(null, xs);
  const maxX = Math.max.apply(null, xs);
  const minY = Math.min.apply(null, ys);
  const maxY = Math.max.apply(null, ys);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function parseLand(text) {
  const title = extractCertificateTitle(text);
  const certificateNumber = (String(text || '').match(/\b[A-Z]{1,4}\s*\d{5,}\b/) || [''])[0].replace(/\s+/g, '');
  const registry = (String(text || '').match(/(?:CH|CS|CT)[-\s]?\d{3,}/i) || [''])[0].replace(/\s+/g, '');
  const indexed = extractIndexedLandFields(text);
  return {
    skill: SKILLS.land,
    fields: {
      certificate_title: title,
      certificate_number: certificateNumber,
      registry_number: registry,
      land_plot_number: indexed.land_plot_number,
      map_sheet_number: indexed.map_sheet_number,
      land_address: indexed.land_address,
      area: indexed.area,
      area_in_words: indexed.area_in_words,
      usage_form: indexed.usage_form,
      usage_purpose: indexed.usage_purpose,
      usage_term: indexed.usage_term || extractUsageTerm(text),
      usage_origin: indexed.usage_origin
    },
    warnings: title ? [] : ['Chưa nhận diện chắc tên loại GCN từ OCR text.']
  };
}

async function googleVisionOcr(imageBase64, apiKeyOverride) {
  const apiKey = apiKeyOverride || process.env.GOOGLE_CLOUD_VISION_API_KEY || process.env.GOOGLE_VISION_API_KEY;
  if (!apiKey) return { text: '', provider: '', error: 'Missing GOOGLE_CLOUD_VISION_API_KEY' };
  const response = await fetch('https://vision.googleapis.com/v1/images:annotate?key=' + encodeURIComponent(apiKey), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      requests: [{
        image: { content: imageBase64 },
        features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
        imageContext: { languageHints: ['vi', 'en'] }
      }]
    })
  });
  const body = await response.json();
  if (!response.ok) return { text: '', provider: 'GOOGLE_VISION', error: JSON.stringify(body) };
  const annotation = body.responses && body.responses[0] && body.responses[0].fullTextAnnotation;
  return { text: annotation && annotation.text || '', provider: 'GOOGLE_VISION', raw: body.responses && body.responses[0] };
}

async function openAiVision(skill, dataUrl, apiKeyOverride) {
  const apiKey = apiKeyOverride || process.env.OPENAI_API_KEY;
  if (!apiKey) return { text: '', provider: '', error: 'Missing OPENAI_API_KEY' };
  const prompt = skill === 'land'
    ? 'Read this Vietnamese land certificate image. Return concise OCR text only. Preserve certificate title and field labels.'
    : 'Read this Vietnamese CCCD/Can cuoc image. Return concise OCR text only. Preserve issue-date label and the date exactly if visible.';
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + apiKey },
    body: JSON.stringify({
      model: process.env.OPENAI_VISION_MODEL || process.env.OPENAI_MODEL || 'gpt-5.4-mini',
      input: [{
        role: 'user',
        content: [
          { type: 'input_text', text: prompt },
          { type: 'input_image', image_url: dataUrl }
        ]
      }]
    })
  });
  const body = await response.json();
  if (!response.ok) return { text: '', provider: 'OPENAI_VISION', error: JSON.stringify(body) };
  return { text: extractOpenAiText(body), provider: 'OPENAI_VISION', raw: body };
}

function extractOpenAiText(body) {
  if (body.output_text) return body.output_text;
  const parts = [];
  (body.output || []).forEach(item => {
    (item.content || []).forEach(content => {
      if (content.text) parts.push(content.text);
    });
  });
  return parts.join('\n');
}

async function handleOcr(req, res) {
  try {
    const payload = JSON.parse(await readBody(req));
    const skill = payload.skill === 'land' ? 'land' : 'cccd';
    const engine = payload.engine || 'google';
    const dataUrl = String(payload.dataUrl || '');
    const imageBase64 = dataUrl.replace(/^data:[^;]+;base64,/, '');
    if (!imageBase64) return sendJson(res, 400, { error: 'Missing image data' });

    const runs = engine === 'both'
      ? [
          await googleVisionOcr(imageBase64, payload.googleApiKey),
          await openAiVision(skill, dataUrl, payload.openAiApiKey)
        ]
      : [
          engine === 'openai'
            ? await openAiVision(skill, dataUrl, payload.openAiApiKey)
            : await googleVisionOcr(imageBase64, payload.googleApiKey)
        ];
    const results = runs.map(ocr => {
      const text = ocr.text || '';
      return {
        engine: ocr.provider || engine,
        ocr_error: ocr.error || '',
        raw_text: text,
        crop_suggestion: skill === 'cccd' && ocr.provider === 'GOOGLE_VISION' && !payload.issueDateCrop
          ? suggestCccdIssueDateCropFromGoogleVision(ocr.raw)
          : null,
        parsed: skill === 'land' ? parseLand(text) : parseCccd(text, {
          issueDateCrop: Boolean(payload.issueDateCrop)
        })
      };
    });
    sendJson(res, 200, {
      file_name: payload.fileName || '',
      results,
      engine: results[0] && results[0].engine || engine,
      ocr_error: results[0] && results[0].ocr_error || '',
      raw_text: results[0] && results[0].raw_text || '',
      parsed: results[0] && results[0].parsed || {}
    });
  } catch (err) {
    sendJson(res, 500, { error: String(err && err.stack || err) });
  }
}

async function handleParseText(req, res) {
  try {
    const payload = JSON.parse(await readBody(req));
    const skill = payload.skill === 'land' ? 'land' : 'cccd';
    const text = String(payload.text || '');
    const parsed = skill === 'land' ? parseLand(text) : parseCccd(text, {
      issueDateCrop: Boolean(payload.issueDateCrop)
    });
    sendJson(res, 200, { raw_text: text, parsed });
  } catch (err) {
    sendJson(res, 500, { error: String(err && err.stack || err) });
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'GET' && url.pathname === '/') {
    return sendFile(res, path.join(PUBLIC, 'index.html'), 'text/html; charset=utf-8');
  }
  if (req.method === 'POST' && url.pathname === '/api/ocr') return handleOcr(req, res);
  if (req.method === 'POST' && url.pathname === '/api/parse-text') return handleParseText(req, res);
  sendJson(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => {
  console.log('OCR skill lab: http://localhost:' + PORT);
  console.log('Set GOOGLE_CLOUD_VISION_API_KEY and/or OPENAI_API_KEY before testing OCR.');
});
