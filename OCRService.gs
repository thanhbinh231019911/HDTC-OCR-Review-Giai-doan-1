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
  return {
    text: annotation ? annotation.text : '',
    confidence: estimateVisionConfidence_(annotation),
    orientation_degrees: estimateVisionDisplayRotation_(annotation)
  };
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
