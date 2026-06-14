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
  if (year < 1990 || year > 2099 || month < 1 || month > 12 || day < 1 || day > 31) return '';
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
  const separated = String(text || '').match(/(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})/);
  if (separated) return normalizeDate(separated[1] + '/' + separated[2] + '/' + separated[3]);
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

function parseCccd(text, options) {
  options = options || {};
  const issueDate = extractCccdIssueDate(text, options);
  return {
    skill: SKILLS.cccd,
    mode: options.issueDateCrop ? 'issue_date_crop' : 'full_image',
    fields: {
      id_numbers: extractVietnamIds(text),
      issue_date: issueDate.value
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

function parseLand(text) {
  const title = extractCertificateTitle(text);
  const certificateNumber = (String(text || '').match(/\b[A-Z]{1,4}\s*\d{5,}\b/) || [''])[0].replace(/\s+/g, '');
  const registry = (String(text || '').match(/(?:CH|CS|CT)[-\s]?\d{3,}/i) || [''])[0].replace(/\s+/g, '');
  const usageTerm = extractUsageTerm(text);
  return {
    skill: SKILLS.land,
    fields: {
      certificate_title: title,
      certificate_number: certificateNumber,
      registry_number: registry,
      usage_term: usageTerm
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
