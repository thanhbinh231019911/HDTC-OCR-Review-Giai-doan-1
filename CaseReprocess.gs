function diagnoseLatestCase() {
  const caseId = getLatestCaseId_();
  return diagnoseCaseById(caseId);
}

function reprocessLatestCase() {
  const caseId = getLatestCaseId_();
  return reprocessCaseById(caseId);
}

function diagnoseCaseById(caseId) {
  setupSpreadsheet();
  const caseRow = getCaseRow(caseId);
  if (!caseRow) throw new Error('Case not found: ' + caseId);

  const ocrRows = getRowsByCaseId_(SHEETS.OCR_RESULTS, caseId);
  const extractedRows = getRowsByCaseId_(SHEETS.EXTRACTED_DATA, caseId);
  const latestJson = extractedRows.length ? parseJsonSafe(extractedRows[extractedRows.length - 1]['JSON Data'], null) : null;
  const uploadedFiles = listUploadedFilesForReprocess_(caseRow);

  const ocrSummary = ocrRows.map(function(row) {
    return {
      file: row['File Name'],
      status: row['OCR Status'],
      text_length: String(row['OCR Text'] || '').length,
      text_preview: String(row['OCR Text'] || '').slice(0, 300),
      confidence: row['Confidence']
    };
  });

  const summary = {
    case_id: caseId,
    status: caseRow['Status'],
    review_email: caseRow['Review Email'],
    review_url_present: Boolean(caseRow['Review URL']),
    uploaded_files_from_folder: uploadedFiles.map(function(file) {
      return {
        group: file.group,
        file_name: file.fileName,
        mime_type: file.mimeType
      };
    }),
    ocr_rows: ocrRows.length,
    ocr_done_with_text: ocrRows.filter(function(row) {
      return row['OCR Status'] === 'DONE' && String(row['OCR Text'] || '').trim();
    }).length,
    ocr_summary: ocrSummary,
    extracted_rows: extractedRows.length,
    latest_extracted_counts: latestJson ? {
      secured_parties: (latestJson.secured_parties || []).length,
      obligors: (latestJson.obligors || []).length,
      assets: (latestJson.assets || []).length,
      warnings: latestJson.validation && latestJson.validation.warnings ? latestJson.validation.warnings.length : 0,
      missing_fields: latestJson.validation && latestJson.validation.missing_fields ? latestJson.validation.missing_fields.length : 0
    } : null
  };

  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

function reprocessCaseById(caseId) {
  setupSpreadsheet();
  const caseRow = getCaseRow(caseId);
  if (!caseRow) throw new Error('Case not found: ' + caseId);

  const folders = getCaseFoldersForReprocess_(caseRow);
  const uploadedFiles = listUploadedFilesForReprocess_(caseRow);
  if (!uploadedFiles.length) throw new Error('No uploaded files found in case folder for ' + caseId);

  const formData = getFormDataForReprocess_(caseId, caseRow);
  const reviewUrl = caseRow['Review URL'] || buildReviewUrl(caseId, randomToken());
  const tokenHash = caseRow['Review Token Hash'] || '';

  logAudit(caseId, 'CASE_REPROCESS_STARTED', {
    uploaded_files: uploadedFiles.map(function(file) {
      return { group: file.group, file_name: file.fileName, file_id: file.fileId };
    })
  }, getActiveUserEmail());

  const ocrResults = ocrFilesForCase(caseId, uploadedFiles, folders);
  const ai = extractDataWithAi(caseId, formData, ocrResults, folders);
  let reviewJson = buildReviewJson(caseId, formData, ai.data, ocrResults);
  reviewJson.review.review_url = reviewUrl;
  reviewJson.review.token_hash = tokenHash;
  reviewJson = validateReviewJson(reviewJson);

  const reviewFile = saveJsonFile(folders.subfolders['04_Review_Data'].id, caseId + '_review_data_REPROCESSED_' + makeTimestampForFile_() + '.json', reviewJson);
  appendSheetRow(SHEETS.EXTRACTED_DATA, {
    'Case ID': caseId,
    'JSON Data': reviewJson,
    'Validation Status': reviewJson.validation.status,
    'Missing Fields': reviewJson.validation.missing_fields,
    'Conflicts': reviewJson.validation.conflicts,
    'Warnings': reviewJson.validation.warnings,
    'AI JSON File URL': ai.fileUrl,
    'Created At': nowIso()
  });
  updateCase(caseId, {
    'Status': CASE_STATUS.REVIEW_SENT,
    'OCR Done At': nowIso()
  });
  logAudit(caseId, 'CASE_REPROCESS_DONE', {
    review_file_url: reviewFile.url,
    secured_parties: (reviewJson.secured_parties || []).length,
    obligors: (reviewJson.obligors || []).length,
    assets: (reviewJson.assets || []).length
  }, getActiveUserEmail());

  const summary = diagnoseCaseById(caseId);
  console.log('Reprocess completed for ' + caseId + '. Open existing Review URL: ' + reviewUrl);
  return summary;
}

function getLatestCaseId_() {
  const sheet = getSheet(SHEETS.CASES);
  const headers = getHeaders_(sheet);
  if (sheet.getLastRow() < 2) throw new Error('No case found');
  const row = sheet.getRange(sheet.getLastRow(), 1, 1, headers.length).getValues()[0];
  const caseId = row[headers.indexOf('Case ID')];
  if (!caseId) throw new Error('Latest case row has no Case ID');
  return caseId;
}

function getCaseFoldersForReprocess_(caseRow) {
  const caseFolderId = extractDriveFolderId_(caseRow['Drive Folder URL']);
  if (!caseFolderId) throw new Error('Cannot parse case folder ID from Drive Folder URL');
  const caseFolder = DriveApp.getFolderById(caseFolderId);
  const subfolders = {};
  CONFIG.SUBFOLDERS.forEach(function(name) {
    subfolders[name] = getOrCreateChildFolder_(caseFolder, name);
  });
  return {
    caseFolderId: caseFolderId,
    caseFolderUrl: caseFolder.getUrl(),
    subfolders: Object.keys(subfolders).reduce(function(acc, name) {
      acc[name] = { id: subfolders[name].getId(), url: subfolders[name].getUrl() };
      return acc;
    }, {})
  };
}

function listUploadedFilesForReprocess_(caseRow) {
  const folders = getCaseFoldersForReprocess_(caseRow);
  const folder = DriveApp.getFolderById(folders.subfolders['01_Uploaded_Files'].id);
  const files = folder.getFiles();
  const result = [];
  while (files.hasNext()) {
    const file = files.next();
    const name = file.getName();
    result.push({
      group: inferUploadGroupFromFileName_(name),
      originalFileId: '',
      fileId: file.getId(),
      fileName: name,
      mimeType: file.getMimeType(),
      url: file.getUrl()
    });
  }
  result.sort(function(a, b) {
    return groupOrder_(a.group) - groupOrder_(b.group) || a.fileName.localeCompare(b.fileName);
  });
  return result;
}

function inferUploadGroupFromFileName_(fileName) {
  const lower = String(fileName || '').toLowerCase();
  if (lower.indexOf('secured_party__') === 0) return 'secured_party';
  if (lower.indexOf('obligor__') === 0) return 'obligor';
  if (lower.indexOf('asset__') === 0) return 'asset';
  if (lower.indexOf('secured') >= 0 || lower.indexOf('bao_dam') >= 0 || lower.indexOf('bảo_đảm') >= 0) return 'secured_party';
  if (lower.indexOf('obligor') >= 0 || lower.indexOf('duoc_bao_dam') >= 0 || lower.indexOf('được_bảo_đảm') >= 0) return 'obligor';
  if (lower.indexOf('asset') >= 0 || lower.indexOf('tai_san') >= 0 || lower.indexOf('tài_sản') >= 0) return 'asset';
  return 'asset';
}

function groupOrder_(group) {
  if (group === 'secured_party') return 1;
  if (group === 'obligor') return 2;
  if (group === 'asset') return 3;
  return 9;
}

function getFormDataForReprocess_(caseId, caseRow) {
  const responseRows = getRowsByCaseId_(SHEETS.RESPONSES, caseId);
  const row = responseRows.length ? responseRows[responseRows.length - 1] : {};
  return {
    reviewEmail: row['Review Email'] || caseRow['Review Email'] || '',
    assetType: row['Asset Type'] || '',
    contractType: row['Contract Type'] || '',
    assetCount: row['Asset Count'] || '',
    bankSigner: row['Bank Signer'] || '',
    disputeCourt: row['Dispute Court'] || '',
    valuationAmount: row['Valuation Amount'] || '',
    fileIdsByGroup: { secured_party: [], obligor: [], asset: [] }
  };
}

function extractDriveFolderId_(url) {
  const text = String(url || '');
  const match = text.match(/folders\/([-\w]{20,})/) || text.match(/id=([-\w]{20,})/);
  return match ? match[1] : '';
}

function makeTimestampForFile_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss');
}
