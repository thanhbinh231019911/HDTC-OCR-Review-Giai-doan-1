function ocrFilesForCase(caseId, uploadedFiles, folders) {
  updateCase(caseId, { 'Status': CASE_STATUS.OCR_RUNNING });
  logAudit(caseId, 'OCR_STARTED', { file_count: uploadedFiles.length });
  const results = uploadedFiles.map(function(fileMeta) {
    Utilities.sleep(CONFIG.OCR_SLEEP_BETWEEN_FILES_MS || 0);
    if (fileMeta.error) {
      return saveOcrResult_(caseId, fileMeta, '', 'FILE_COPY_ERROR', '', folders, fileMeta.error);
    }
    try {
      const result = ocrSingleFile_(fileMeta);
      fileMeta = reclassifyOcrFileMetaByContent_(fileMeta, result.text);
      return saveOcrResult_(caseId, fileMeta, result.text, 'DONE', result.confidence, folders, '', result.orientation_degrees);
    } catch (err) {
      logAudit(caseId, 'OCR_FILE_ERROR', { file: fileMeta, error: String(err) });
      return saveOcrResult_(caseId, fileMeta, '', 'ERROR', '', folders, String(err));
    }
  });
  updateCase(caseId, { 'Status': CASE_STATUS.OCR_DONE, 'OCR Done At': nowIso() });
  logAudit(caseId, 'OCR_DONE', { file_count: results.length });
  return results;
}

function reclassifyOcrFileMetaByContent_(fileMeta, text) {
  if (!shouldReclassifyOcrAsLandAsset_(text)) return fileMeta;
  const updated = Object.assign({}, fileMeta || {});
  updated.group = 'asset';
  updated.fileName = String(updated.fileName || '').replace(/^(?:secured_party|obligor)__/, 'asset__');
  return updated;
}

function shouldReclassifyOcrAsLandAsset_(text) {
  const normalized = removeVietnameseAccents_(String(text || ''))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return false;
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

function ocrSingleFile_(fileMeta) {
  const file = DriveApp.getFileById(fileMeta.fileId);
  const mimeType = file.getMimeType();
  if (isGoogleDocsMime_(mimeType)) {
    return { text: DocumentApp.openById(file.getId()).getBody().getText(), confidence: '' };
  }
  if (mimeType.indexOf('text/') === 0) {
    return { text: file.getBlob().getDataAsString('UTF-8'), confidence: '' };
  }
  if (isWordMime_(mimeType)) {
    return convertOfficeFileToText_(file);
  }
  if (mimeType.indexOf('image/') === 0 && CONFIG.DEFAULT_OCR_ENGINE === 'CLOUD_VISION') {
    return ocrImageWithCloudVision_(file);
  }
  if (isPdfMime_(mimeType) && CONFIG.DEFAULT_OCR_ENGINE === 'CLOUD_VISION') {
    try {
      return ocrPdfWithCloudVision_(file);
    } catch (err) {
      console.warn('Cloud Vision PDF OCR failed; falling back to Drive OCR: ' + err);
      return ocrWithDrive_(file, mimeType);
    }
  }
  return ocrWithDrive_(file, mimeType);
}

function isGoogleDocsMime_(mimeType) {
  return mimeType === 'application/vnd.google-apps.document' ||
    (typeof MimeType !== 'undefined' && mimeType === MimeType.GOOGLE_DOCS);
}

function isWordMime_(mimeType) {
  return mimeType === 'application/msword' ||
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
}

function isPdfMime_(mimeType) {
  return mimeType === 'application/pdf' ||
    (typeof MimeType !== 'undefined' && mimeType === MimeType.PDF);
}

function convertOfficeFileToText_(file) {
  return withRetry('Convert Office file ' + file.getName(), function() {
    const doc = Drive.Files.insert({
      title: 'CONVERT__' + file.getName()
    }, file.getBlob(), {
      convert: true
    });
    const text = DocumentApp.openById(doc.id).getBody().getText();
    try {
      DriveApp.getFileById(doc.id).setTrashed(true);
    } catch (err) {
      console.warn(err);
    }
    return { text: text, confidence: '' };
  }, CONFIG.MAX_API_RETRIES);
}

function ocrWithDrive_(file, mimeType) {
  const currentMimeType = mimeType || file.getMimeType();
  if (isGoogleDocsMime_(currentMimeType)) {
    return readGoogleDocText_(file);
  }
  return withOcrRetry_('Drive OCR ' + file.getName(), function() {
    const blob = file.getBlob();
    const blobMimeType = blob.getContentType();
    if (isGoogleDocsMime_(blobMimeType)) {
      return readGoogleDocText_(file);
    }
    const resource = {
      title: 'OCR__' + file.getName()
    };
    let doc;
    try {
      doc = Drive.Files.insert(resource, blob, {
        ocr: true,
        ocrLanguage: CONFIG.OCR_LANGUAGE,
        convert: true
      });
    } catch (err) {
      if (isGoogleDocsOcrUnsupportedError_(err)) {
        return readGoogleDocText_(file);
      }
      throw err;
    }
    const text = readGoogleDocTextById_(doc.id).text;
    try {
      DriveApp.getFileById(doc.id).setTrashed(true);
    } catch (err) {
      console.warn(err);
    }
    return { text: text, confidence: '' };
  });
}

function withOcrRetry_(label, fn) {
  const attempts = CONFIG.OCR_MAX_RETRIES || CONFIG.MAX_API_RETRIES || 3;
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return fn(i + 1);
    } catch (err) {
      lastErr = err;
      const rateLimited = isOcrRateLimitError_(err);
      if (!rateLimited && i >= Math.min(2, attempts - 1)) break;
      const sleepMs = rateLimited
        ? (CONFIG.OCR_RETRY_BASE_SLEEP_MS || 30000) * Math.pow(2, i)
        : 3000 * Math.pow(2, i);
      console.warn(label + ' attempt ' + (i + 1) + ' failed. Sleeping ' + sleepMs + ' ms. Error: ' + err);
      Utilities.sleep(sleepMs);
    }
  }
  throw new Error(label + ' failed after ' + attempts + ' attempts: ' + lastErr);
}

function isOcrRateLimitError_(err) {
  const message = String(err && err.message ? err.message : err).toLowerCase();
  return message.indexOf('rate limit') >= 0 ||
    message.indexOf('user rate limit exceeded') >= 0 ||
    message.indexOf('quota') >= 0;
}

function readGoogleDocText_(file) {
  return readGoogleDocTextById_(file.getId());
}

function readGoogleDocTextById_(fileId) {
  try {
    return { text: DocumentApp.openById(fileId).getBody().getText(), confidence: '' };
  } catch (err) {
    try {
      const exported = Drive.Files.export(fileId, 'text/plain');
      return { text: exported.getDataAsString('UTF-8'), confidence: '' };
    } catch (exportErr) {
      throw new Error('Cannot read Google Docs text: ' + err + ' / export failed: ' + exportErr);
    }
  }
}

function isGoogleDocsOcrUnsupportedError_(err) {
  const message = String(err && err.message ? err.message : err);
  return message.indexOf('OCR is not supported') >= 0 &&
    message.indexOf('application/vnd.google-apps.document') >= 0;
}

function ocrImageWithCloudVision_(file) {
  const apiKey = PropertiesService.getScriptProperties().getProperty(CONFIG.CLOUD_VISION_API_KEY_PROPERTY);
  if (!apiKey) {
    throw new Error(
      'Missing script property ' + CONFIG.CLOUD_VISION_API_KEY_PROPERTY +
      '. Add a Google Cloud Vision API key to Script Properties, or set CONFIG.DEFAULT_OCR_ENGINE to DRIVE_OCR.'
    );
  }
  const payload = {
    requests: [{
      image: { content: Utilities.base64Encode(file.getBlob().getBytes()) },
      features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
      imageContext: { languageHints: ['vi', 'en'] }
    }]
  };
  const response = withRetry('Cloud Vision OCR ' + file.getName(), function() {
    const res = UrlFetchApp.fetch('https://vision.googleapis.com/v1/images:annotate?key=' + encodeURIComponent(apiKey), {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    if (res.getResponseCode() >= 300) throw new Error(res.getContentText());
    const parsed = JSON.parse(res.getContentText());
    const first = parsed.responses && parsed.responses[0];
    if (first && first.error) {
      throw new Error(JSON.stringify(first.error));
    }
    return parsed;
  }, CONFIG.MAX_API_RETRIES);
  const annotation = response.responses && response.responses[0] && response.responses[0].fullTextAnnotation;
  const regionText = buildLandCertificateRegionTextFromVisionAnnotation_(annotation);
  return {
    text: [regionText, annotation ? annotation.text : ''].filter(Boolean).join('\n\n'),
    confidence: estimateVisionConfidence_(annotation),
    orientation_degrees: estimateVisionDisplayRotation_(annotation)
  };
}

function ocrPdfWithCloudVision_(file) {
  const apiKey = PropertiesService.getScriptProperties().getProperty(CONFIG.CLOUD_VISION_API_KEY_PROPERTY);
  if (!apiKey) {
    throw new Error(
      'Missing script property ' + CONFIG.CLOUD_VISION_API_KEY_PROPERTY +
      '. Add a Google Cloud Vision API key to Script Properties, or set CONFIG.DEFAULT_OCR_ENGINE to DRIVE_OCR.'
    );
  }
  const blob = file.getBlob();
  const payload = {
    requests: [{
      inputConfig: {
        content: Utilities.base64Encode(blob.getBytes()),
        mimeType: blob.getContentType() || 'application/pdf'
      },
      features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
      imageContext: { languageHints: ['vi', 'en'] }
    }]
  };
  const response = withRetry('Cloud Vision PDF OCR ' + file.getName(), function() {
    const res = UrlFetchApp.fetch('https://vision.googleapis.com/v1/files:annotate?key=' + encodeURIComponent(apiKey), {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    if (res.getResponseCode() >= 300) throw new Error(res.getContentText());
    const parsed = JSON.parse(res.getContentText());
    const first = parsed.responses && parsed.responses[0];
    if (first && first.error) throw new Error(JSON.stringify(first.error));
    return parsed;
  }, CONFIG.MAX_API_RETRIES);
  const annotations = extractCloudVisionPdfAnnotations_(response);
  if (!annotations.length) throw new Error('Cloud Vision PDF OCR returned no page annotations.');
  const parts = [];
  annotations.forEach(function(annotation, index) {
    const regionText = buildLandCertificateRegionTextFromVisionAnnotation_(annotation);
    if (regionText) parts.push('[LAND_OCR_PDF_PAGE page=' + (index + 1) + ']\n' + regionText + '\n[/LAND_OCR_PDF_PAGE]');
    if (annotation.text) parts.push(annotation.text);
  });
  return {
    text: parts.join('\n\n'),
    confidence: estimateVisionConfidenceFromAnnotations_(annotations),
    orientation_degrees: 0
  };
}

function extractCloudVisionPdfAnnotations_(response) {
  const fileResponse = response && response.responses && response.responses[0];
  if (fileResponse && fileResponse.error) throw new Error(JSON.stringify(fileResponse.error));
  return (fileResponse && fileResponse.responses || []).map(function(pageResponse) {
    if (pageResponse && pageResponse.error) throw new Error(JSON.stringify(pageResponse.error));
    return pageResponse && pageResponse.fullTextAnnotation;
  }).filter(Boolean);
}

function estimateVisionConfidenceFromAnnotations_(annotations) {
  let sum = 0;
  let count = 0;
  (annotations || []).forEach(function(annotation) {
    const value = estimateVisionConfidence_(annotation);
    if (value !== '') {
      sum += Number(value);
      count++;
    }
  });
  return count ? Math.round((sum / count) * 1000) / 1000 : '';
}

function buildLandCertificateRegionTextFromVisionAnnotation_(annotation) {
  const blocks = collectVisionTextBlocksForRegions_(annotation);
  if (!blocks.length) return '';
  const pageGroups = {};
  blocks.forEach(function(block) {
    const key = block.pageIndex + ':' + block.pageWidth + 'x' + block.pageHeight;
    pageGroups[key] = pageGroups[key] || [];
    pageGroups[key].push(block);
  });
  const out = [];
  Object.keys(pageGroups).forEach(function(key) {
    const pageBlocks = pageGroups[key];
    const pageWidth = pageBlocks[0].pageWidth;
    const pageHeight = pageBlocks[0].pageHeight;
    const regions = buildLandCertificateRegionRects_(pageWidth, pageHeight);
    regions.forEach(function(region) {
      const text = textFromVisionBlocksInRect_(pageBlocks, region.rect);
      if (!text) return;
      const classified = typeof classifyLandCertificatePageText_ === 'function'
        ? classifyLandCertificatePageText_(text)
        : { layout: 'unknown', score: 0 };
      const normalized = removeVietnameseAccents_(text).toLowerCase().replace(/\s+/g, ' ');
      const isLandLike = classified.score >= 3 ||
        normalized.indexOf('thua dat') >= 0 ||
        normalized.indexOf('nguon goc su dung') >= 0 ||
        normalized.indexOf('so vao so') >= 0 ||
        normalized.indexOf('iv nhung thay doi') >= 0 ||
        normalized.indexOf('noi dung thay doi') >= 0;
      const isAuthorityLike = normalized.indexOf('so tai nguyen') >= 0 ||
        normalized.indexOf('uy ban nhan dan') >= 0 ||
        normalized.indexOf('van phong dang ky dat dai') >= 0;
      if (isLandLike) {
        out.push('[LAND_OCR_REGION layout=' + classified.layout + ' score=' + classified.score + ' region=' + region.name + ']');
        out.push(text);
        out.push('[/LAND_OCR_REGION]');
      }
      if (isAuthorityLike) {
        out.push('[LAND_OCR_AUTHORITY_REGION region=' + region.name + ']');
        out.push(text);
        out.push('[/LAND_OCR_AUTHORITY_REGION]');
      }
    });
  });
  return out.join('\n');
}

function collectVisionTextBlocksForRegions_(annotation) {
  const out = [];
  const displayRotation = estimateVisionDisplayRotation_(annotation);
  const pages = annotation && annotation.pages || [];
  pages.forEach(function(page, pageIndex) {
    const rawPageWidth = Number(page.width || 0);
    const rawPageHeight = Number(page.height || 0);
    const pageWidth = displayRotation === 90 || displayRotation === 270 ? rawPageHeight : rawPageWidth;
    const pageHeight = displayRotation === 90 || displayRotation === 270 ? rawPageWidth : rawPageHeight;
    (page.blocks || []).forEach(function(block) {
      const text = collectVisionBlockText_(block);
      const rawBox = visionBoundingRectForRegions_(block.boundingBox, rawPageWidth, rawPageHeight);
      const box = normalizeVisionRectForRotation_(rawBox, rawPageWidth, rawPageHeight, displayRotation);
      if (!text || !box) return;
      out.push({
        text: text,
        box: box,
        pageIndex: pageIndex,
        pageWidth: pageWidth,
        pageHeight: pageHeight,
        centerX: box.x + box.width / 2,
        centerY: box.y + box.height / 2
      });
    });
  });
  return out;
}

function normalizeVisionRectForRotation_(box, pageWidth, pageHeight, rotation) {
  if (!box) return null;
  const normalized = normalizeQuarterTurn_(rotation || 0);
  if (normalized === 90) {
    return {
      x: pageHeight - (box.y + box.height),
      y: box.x,
      width: box.height,
      height: box.width
    };
  }
  if (normalized === 180) {
    return {
      x: pageWidth - (box.x + box.width),
      y: pageHeight - (box.y + box.height),
      width: box.width,
      height: box.height
    };
  }
  if (normalized === 270) {
    return {
      x: box.y,
      y: pageWidth - (box.x + box.width),
      width: box.height,
      height: box.width
    };
  }
  return box;
}

function collectVisionBlockText_(block) {
  const paragraphs = [];
  (block.paragraphs || []).forEach(function(paragraph) {
    const words = [];
    (paragraph.words || []).forEach(function(word) {
      const text = (word.symbols || []).map(function(symbol) { return symbol.text || ''; }).join('');
      if (text) words.push(text);
    });
    if (words.length) paragraphs.push(words.join(' '));
  });
  return paragraphs.join('\n').replace(/\s+\n/g, '\n').replace(/\n\s+/g, '\n').trim();
}

function buildLandCertificateRegionRects_(pageWidth, pageHeight) {
  const w = Math.max(Number(pageWidth || 0), 1);
  const h = Math.max(Number(pageHeight || 0), 1);
  const regions = [
    { name: 'full', rect: { x: 0, y: 0, width: w, height: h } },
    { name: 'left', rect: { x: 0, y: 0, width: w * 0.54, height: h } },
    { name: 'right', rect: { x: w * 0.46, y: 0, width: w * 0.54, height: h } },
    { name: 'top', rect: { x: 0, y: 0, width: w, height: h * 0.54 } },
    { name: 'bottom', rect: { x: 0, y: h * 0.46, width: w, height: h * 0.54 } }
  ];
  return regions;
}

function textFromVisionBlocksInRect_(blocks, rect) {
  return (blocks || [])
    .filter(function(block) { return rectContainsBlockCenter_(rect, block); })
    .sort(function(a, b) {
      const rowDelta = a.centerY - b.centerY;
      if (Math.abs(rowDelta) > Math.max(8, Math.min(a.box.height, b.box.height) * 0.8)) return rowDelta;
      return a.centerX - b.centerX;
    })
    .map(function(block) { return block.text; })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function rectContainsBlockCenter_(rect, block) {
  return block.centerX >= rect.x &&
    block.centerX <= rect.x + rect.width &&
    block.centerY >= rect.y &&
    block.centerY <= rect.y + rect.height;
}

function visionBoundingRectForRegions_(box, pageWidth, pageHeight) {
  let vertices = box && box.vertices || [];
  if (!vertices.length && box && box.normalizedVertices) {
    vertices = box.normalizedVertices.map(function(vertex) {
      return {
        x: Number(vertex.x || 0) * Number(pageWidth || 0),
        y: Number(vertex.y || 0) * Number(pageHeight || 0)
      };
    });
  }
  if (!vertices.length) return null;
  const xs = vertices.map(function(v) { return Number(v.x || 0); });
  const ys = vertices.map(function(v) { return Number(v.y || 0); });
  const minX = Math.min.apply(null, xs);
  const maxX = Math.max.apply(null, xs);
  const minY = Math.min.apply(null, ys);
  const maxY = Math.max.apply(null, ys);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function estimateVisionConfidence_(annotation) {
  if (!annotation || !annotation.pages) return '';
  let sum = 0;
  let count = 0;
  annotation.pages.forEach(function(page) {
    (page.blocks || []).forEach(function(block) {
      if (block.confidence !== undefined) {
        sum += block.confidence;
        count++;
      }
    });
  });
  return count ? Math.round((sum / count) * 1000) / 1000 : '';
}

function estimateVisionDisplayRotation_(annotation) {
  if (!annotation || !annotation.pages) return 0;
  const buckets = { 0: 0, 90: 0, 180: 0, 270: 0 };
  annotation.pages.forEach(function(page) {
    (page.blocks || []).forEach(function(block) {
      const vertices = block.boundingBox && block.boundingBox.vertices;
      if (!vertices || vertices.length < 2) return;
      const angle = Math.atan2((vertices[1].y || 0) - (vertices[0].y || 0), (vertices[1].x || 0) - (vertices[0].x || 0)) * 180 / Math.PI;
      const nearest = normalizeQuarterTurn_(Math.round(angle / 90) * 90);
      const confidence = Number(block.confidence || 0.5);
      const weight = Math.max(1, String(block.text || '').length) * confidence;
      buckets[nearest] = (buckets[nearest] || 0) + weight;
    });
  });
  let dominant = 0;
  Object.keys(buckets).forEach(function(key) {
    if (buckets[key] > buckets[dominant]) dominant = Number(key);
  });
  return normalizeQuarterTurn_(-dominant);
}

function normalizeQuarterTurn_(degrees) {
  const normalized = ((degrees % 360) + 360) % 360;
  if (normalized < 45 || normalized >= 315) return 0;
  if (normalized < 135) return 90;
  if (normalized < 225) return 180;
  return 270;
}

function saveOcrResult_(caseId, fileMeta, text, status, confidence, folders, errorDetail, orientationDegrees) {
  const storedText = text || errorDetail || '';
  const textFile = saveTextFile(
    folders.subfolders['02_OCR_Text'].id,
    sanitizeFileNamePart(fileMeta.fileName || fileMeta.fileId) + '.txt',
    storedText
  );
  const row = {
    'Case ID': caseId,
    'File Name': fileMeta.fileName,
    'File ID': fileMeta.fileId,
    'File Type': fileMeta.mimeType,
    'OCR Text': storedText,
    'OCR Status': status,
    'Confidence': confidence,
    'OCR Text File URL': textFile.url,
    'Created At': nowIso()
  };
  appendSheetRow(SHEETS.OCR_RESULTS, row);
  return {
    file_name: fileMeta.fileName,
    file_id: fileMeta.fileId,
    file_type: fileMeta.mimeType,
    group: fileMeta.group,
    text: storedText,
    status: status,
    confidence: confidence || '',
    orientation_degrees: orientationDegrees || '',
    text_file_url: textFile.url
  };
}
