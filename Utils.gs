function nowIso() {
  return new Date().toISOString();
}

function getActiveUserEmail() {
  try {
    return Session.getActiveUser().getEmail() || 'unknown';
  } catch (err) {
    return 'unknown';
  }
}

function jsonStringify(value) {
  return JSON.stringify(value, null, 2);
}

function parseJsonSafe(text, fallback) {
  if (!text) return fallback;
  try {
    return JSON.parse(text);
  } catch (err) {
    return fallback;
  }
}

function sha256Hex(value) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8);
  return digest.map(function(byte) {
    const v = (byte < 0 ? byte + 256 : byte).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('');
}

function randomToken() {
  const bytes = Utilities.getUuid() + Utilities.getUuid() + String(Date.now()) + Math.random();
  return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes)).replace(/=+$/, '');
}

function makeCaseId() {
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss');
  const suffix = Utilities.getUuid().slice(0, 8).toUpperCase();
  return CONFIG.CASE_ID_PREFIX + '-' + stamp + '-' + suffix;
}

function sanitizeFileNamePart(value) {
  return String(value || 'NO_NAME')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'NO_NAME';
}

function withRetry(label, fn, maxRetries) {
  const attempts = maxRetries || CONFIG.MAX_API_RETRIES;
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return fn(i + 1);
    } catch (err) {
      lastErr = err;
      Utilities.sleep(Math.pow(2, i) * 1000 + Math.floor(Math.random() * 500));
    }
  }
  throw new Error(label + ' failed after ' + attempts + ' attempts: ' + lastErr);
}

function getReviewBaseUrl() {
  const props = PropertiesService.getScriptProperties();
  const configured = props.getProperty(CONFIG.REVIEW_WEB_APP_URL_PROPERTY);
  if (configured) return configured;
  if (CONFIG.DEFAULT_REVIEW_WEB_APP_URL) return CONFIG.DEFAULT_REVIEW_WEB_APP_URL;
  try {
    return ScriptApp.getService().getUrl();
  } catch (err) {
    return '';
  }
}

function buildReviewUrl(caseId, token) {
  const base = getReviewBaseUrl();
  if (!base) return '';
  return base + '?authuser=0&caseId=' + encodeURIComponent(caseId) + '&token=' + encodeURIComponent(token);
}

function extractFileIds(value) {
  if (!value) return [];
  const joined = Array.isArray(value) ? value.join(',') : String(value);
  const parts = joined.split(/[\n,]+/).map(function(s) { return s.trim(); }).filter(Boolean);
  const ids = [];
  parts.forEach(function(part) {
    const patterns = [
      /[-\w]{25,}/,
      /id=([-\w]{25,})/,
      /\/d\/([-\w]{25,})/
    ];
    patterns.forEach(function(re) {
      const match = part.match(re);
      if (match) ids.push(match[1] || match[0]);
    });
  });
  return Array.from(new Set(ids));
}

function getNamedValue(namedValues, fieldName) {
  const value = namedValues && namedValues[fieldName];
  if (Array.isArray(value)) return value.join(', ').trim();
  return value ? String(value).trim() : '';
}

function truncateForAi(text) {
  if (!text) return '';
  if (text.length <= CONFIG.MAX_OCR_TEXT_CHARS_PER_REQUEST) return text;
  return text.slice(0, CONFIG.MAX_OCR_TEXT_CHARS_PER_REQUEST) + '\n...[TRUNCATED_FOR_AI]';
}

function makeField(label, aiValue, formValue, manualValue, source, confidence) {
  const finalValue = manualValue !== '' && manualValue !== null && manualValue !== undefined
    ? manualValue
    : (formValue !== '' && formValue !== null && formValue !== undefined ? formValue : (aiValue || ''));
  return {
    label: label,
    ai_value: aiValue || '',
    form_value: formValue || '',
    manual_value: manualValue || '',
    final_value: finalValue || '',
    source: source || '',
    confidence: confidence === undefined || confidence === null ? '' : confidence,
    confirmed: false
  };
}

function getByPath(root, path) {
  if (!root || !path) return undefined;
  return path.split('.').reduce(function(acc, part) {
    if (acc === undefined || acc === null) return undefined;
    const arrayMatch = part.match(/^(.+)\[(\d+)\]$/);
    if (arrayMatch) return (acc[arrayMatch[1]] || [])[Number(arrayMatch[2])];
    return acc[part];
  }, root);
}

function setByPath(root, path, value) {
  const parts = path.split('.');
  let cursor = root;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const arrayMatch = part.match(/^(.+)\[(\d+)\]$/);
    const isLast = i === parts.length - 1;
    if (arrayMatch) {
      const key = arrayMatch[1];
      const index = Number(arrayMatch[2]);
      cursor[key] = cursor[key] || [];
      cursor[key][index] = cursor[key][index] || {};
      if (isLast) cursor[key][index] = value;
      cursor = cursor[key][index];
    } else {
      if (isLast) {
        cursor[part] = value;
      } else {
        cursor[part] = cursor[part] || {};
        cursor = cursor[part];
      }
    }
  }
}
