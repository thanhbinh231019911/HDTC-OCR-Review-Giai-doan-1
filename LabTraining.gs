const OCR_LAB_TRAINING = {
  CCCD: {
    skill: 'ocr-cccd-can-cuoc',
    title: 'LAB OCR CCCD Can cuoc',
    description: 'Form rut gon de train OCR CCCD/Can cuoc. Khong tao hop dong, khong gui email.',
    propertyPrefix: 'LAB_CCCD',
    uploadField: 'Upload anh CCCD/Can cuoc',
    handler: 'onLabCccdSubmit',
    group: 'secured_party'
  },
  LAND: {
    skill: 'ocr-bia-dat',
    title: 'LAB OCR Bia dat',
    description: 'Form rut gon de train OCR bia dat/giay chung nhan. Khong tao hop dong, khong gui email.',
    propertyPrefix: 'LAB_LAND',
    uploadField: 'Upload anh bia dat/giay chung nhan',
    handler: 'onLabLandSubmit',
    group: 'asset'
  },
  REVIEW_EMAIL_FIELD: 'Email nhan ket qua lab'
};

function setupOcrLabTrainingForms() {
  setupSpreadsheet();
  const cccd = createOrUpdateOcrLabForm_(OCR_LAB_TRAINING.CCCD);
  const land = createOrUpdateOcrLabForm_(OCR_LAB_TRAINING.LAND);
  reinstallOcrLabTrainingTriggers_();
  const message = [
    'OCR lab training forms are ready.',
    'CCCD edit URL: ' + cccd.editUrl,
    'CCCD public URL: ' + cccd.publicUrl,
    'Bia dat edit URL: ' + land.editUrl,
    'Bia dat public URL: ' + land.publicUrl
  ].join('\n');
  const ui = getSpreadsheetUiSafe_();
  if (ui) ui.alert(message);
  console.log(message);
  return { cccd: cccd, land: land };
}

function showOcrLabTrainingFormUrls() {
  const props = PropertiesService.getScriptProperties();
  const urls = {
    cccd: readOcrLabFormUrls_(OCR_LAB_TRAINING.CCCD, props),
    land: readOcrLabFormUrls_(OCR_LAB_TRAINING.LAND, props)
  };
  const message = [
    'CCCD edit URL: ' + (urls.cccd.editUrl || ''),
    'CCCD public URL: ' + (urls.cccd.publicUrl || ''),
    'Bia dat edit URL: ' + (urls.land.editUrl || ''),
    'Bia dat public URL: ' + (urls.land.publicUrl || '')
  ].join('\n');
  const ui = getSpreadsheetUiSafe_();
  if (ui) ui.alert(message);
  console.log(message);
  return urls;
}

function checkOcrLabTrainingConfiguration() {
  const props = PropertiesService.getScriptProperties();
  const checks = [
    ['OPENAI_API_KEY', Boolean(props.getProperty(CONFIG.OPENAI_API_KEY_PROPERTY))],
    ['CLOUD_VISION_API_KEY', Boolean(props.getProperty(CONFIG.CLOUD_VISION_API_KEY_PROPERTY))],
    ['REVIEW_WEB_APP_URL/default', Boolean(getReviewBaseUrl())],
    ['LAB_CCCD_FORM_ID', Boolean(props.getProperty(OCR_LAB_TRAINING.CCCD.propertyPrefix + '_FORM_ID'))],
    ['LAB_LAND_FORM_ID', Boolean(props.getProperty(OCR_LAB_TRAINING.LAND.propertyPrefix + '_FORM_ID'))],
    ['FORM_ID production', Boolean(props.getProperty('FORM_ID'))]
  ];
  const message = checks.map(function(item) {
    return (item[1] ? 'OK ' : 'MISSING ') + item[0];
  }).join('\n');
  const ui = getSpreadsheetUiSafe_();
  if (ui) ui.alert(message);
  console.log(message);
  return message;
}

function onLabCccdSubmit(e) {
  return processOcrLabTrainingSubmit_(resolveOcrLabConfigForEvent_(OCR_LAB_TRAINING.CCCD, e), e);
}

function onLabLandSubmit(e) {
  return processOcrLabTrainingSubmit_(resolveOcrLabConfigForEvent_(OCR_LAB_TRAINING.LAND, e), e);
}

function resolveOcrLabConfigForEvent_(preferredConfig, e) {
  const sourceInfo = getOcrLabEventSourceInfo_(e);
  const configs = [OCR_LAB_TRAINING.CCCD, OCR_LAB_TRAINING.LAND];
  const props = PropertiesService.getScriptProperties();
  for (let i = 0; i < configs.length; i++) {
    const config = configs[i];
    const formId = props.getProperty(config.propertyPrefix + '_FORM_ID') || '';
    if (sourceInfo.id && formId && sourceInfo.id === formId) {
      return config;
    }
  }

  const title = removeVietnameseAccents_(sourceInfo.title).toLowerCase();
  if (title.indexOf('bia dat') >= 0 || title.indexOf('giay chung nhan') >= 0 || title.indexOf('land') >= 0) {
    return OCR_LAB_TRAINING.LAND;
  }
  if (title.indexOf('cccd') >= 0 || title.indexOf('can cuoc') >= 0) {
    return OCR_LAB_TRAINING.CCCD;
  }

  return preferredConfig;
}

function getOcrLabEventSourceInfo_(e) {
  const source = e && e.source;
  let id = '';
  let title = '';
  try {
    id = source && typeof source.getId === 'function' ? source.getId() : '';
  } catch (err) {
    id = '';
  }
  try {
    title = source && typeof source.getTitle === 'function' ? source.getTitle() : '';
  } catch (err) {
    title = '';
  }
  return { id: id, title: title };
}

function createOrUpdateOcrLabForm_(labConfig) {
  const props = PropertiesService.getScriptProperties();
  const existingId = props.getProperty(labConfig.propertyPrefix + '_FORM_ID');
  let form = null;
  if (existingId) {
    try {
      form = FormApp.openById(existingId);
    } catch (err) {
      console.warn('Cannot open existing lab form ' + existingId + ': ' + err);
    }
  }
  if (!form) {
    form = FormApp.create(labConfig.title);
  }
  form.setTitle(labConfig.title);
  form.setDescription(labConfig.description);
  form.setCollectEmail(false);
  form.setAllowResponseEdits(false);
  form.setDestination(FormApp.DestinationType.SPREADSHEET, SpreadsheetApp.getActiveSpreadsheet().getId());
  replaceOcrLabFormItems_(form, labConfig);
  const urls = saveOcrLabFormUrls_(labConfig, form);
  return urls;
}

function replaceOcrLabFormItems_(form, labConfig) {
  const items = form.getItems();
  for (let i = items.length - 1; i >= 0; i--) {
    form.deleteItem(items[i]);
  }
  form.addTextItem()
    .setTitle(OCR_LAB_TRAINING.REVIEW_EMAIL_FIELD)
    .setRequired(false);
  addOcrLabUploadOrLinkItem_(form, labConfig);
}

function addOcrLabUploadOrLinkItem_(form, labConfig) {
  if (typeof form.addFileUploadItem === 'function') {
    addFileUploadItem_(form, labConfig.uploadField);
    return 'FILE_UPLOAD';
  }
  form.addParagraphTextItem()
    .setTitle(labConfig.uploadField)
    .setHelpText('Dan link Google Drive hoac file ID, moi dong mot file. Neu muon nut tai tep len, co the doi cau hoi nay thanh File upload thu cong trong Google Form.')
    .setRequired(true);
  return 'DRIVE_LINK_TEXT';
}

function reinstallOcrLabTrainingTriggers_() {
  const triggers = ScriptApp.getProjectTriggers();
  let deleted = 0;
  triggers.forEach(function(trigger) {
    const handler = trigger.getHandlerFunction && trigger.getHandlerFunction();
    if (handler === OCR_LAB_TRAINING.CCCD.handler || handler === OCR_LAB_TRAINING.LAND.handler) {
      ScriptApp.deleteTrigger(trigger);
      deleted++;
    }
  });
  installOcrLabTrainingTrigger_(OCR_LAB_TRAINING.CCCD);
  installOcrLabTrainingTrigger_(OCR_LAB_TRAINING.LAND);
  console.log('Reinstalled OCR lab training triggers. Deleted old triggers: ' + deleted);
}

function installOcrLabTrainingTrigger_(labConfig) {
  const formId = PropertiesService.getScriptProperties().getProperty(labConfig.propertyPrefix + '_FORM_ID');
  if (!formId) throw new Error('Missing ' + labConfig.propertyPrefix + '_FORM_ID. Run setupOcrLabTrainingForms first.');
  ScriptApp.newTrigger(labConfig.handler)
    .forForm(FormApp.openById(formId))
    .onFormSubmit()
    .create();
}

function processOcrLabTrainingSubmit_(labConfig, e) {
  setupSpreadsheet();
  let caseId = '';
  let folders = null;
  try {
    const namedValues = labEventToNamedValues_(e);
    labConfig = resolveOcrLabConfigFromNamedValues_(labConfig, namedValues);
    caseId = makeOcrLabCaseId_(labConfig);
    const reviewEmail = getNamedValue(namedValues, OCR_LAB_TRAINING.REVIEW_EMAIL_FIELD) || getActiveUserEmail();
    const uploadValue = getNamedValue(namedValues, labConfig.uploadField);
    const fileIds = extractFileIds(uploadValue);
    const formData = makeOcrLabFormData_(labConfig, reviewEmail, fileIds);
    const token = randomToken();
    const reviewUrl = buildReviewUrl(caseId, token);
    folders = createCaseFolders(caseId, labConfig.skill);

    appendOcrLabResponseRow_(caseId, formData, namedValues);
    appendOcrLabCaseRow_(caseId, reviewEmail, folders, reviewUrl, token);
    logAudit(caseId, 'LAB_TRAINING_STARTED', {
      skill: labConfig.skill,
      uploaded_file_count: fileIds.length
    }, reviewEmail);

    const uploadedFiles = copyUploadedFilesToCase(formData.fileIdsByGroup, folders);
    const ocrResults = ocrFilesForCase(caseId, uploadedFiles, folders);
    const ai = extractDataWithAi(caseId, formData, ocrResults, folders);
    let reviewJson = buildReviewJson(caseId, formData, ai.data, ocrResults);
    reviewJson.review.review_url = reviewUrl;
    reviewJson.review.token_hash = sha256Hex(token);
    reviewJson.review.lab_training = {
      enabled: true,
      skill: labConfig.skill,
      mode: 'same_backend_reduced_form_with_review'
    };
    reviewJson = validateReviewJson(reviewJson);

    const reviewFile = saveJsonFile(folders.subfolders['04_Review_Data'].id, caseId + '_lab_review_data.json', reviewJson);
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
    appendOcrLabResultRow_(labConfig, {
      caseId: caseId,
      mode: 'same_backend_reduced_form_with_review',
      sourceFormId: getOcrLabSourceFormId_(labConfig),
      uploadedFileCount: fileIds.length,
      folders: folders,
      reviewUrl: reviewUrl,
      ocrResults: ocrResults,
      ai: ai,
      reviewJson: reviewJson,
      reviewFile: reviewFile,
      error: ''
    });
    updateCase(caseId, { 'Status': CASE_STATUS.REVIEW_SENT, 'Email Sent At': '' });
    logAudit(caseId, 'LAB_TRAINING_DONE', { review_file_url: reviewFile.url, review_url: reviewUrl }, reviewEmail);
    return reviewJson;
  } catch (err) {
    if (folders) {
      appendOcrLabResultRow_(labConfig, {
        caseId: caseId,
        mode: 'same_backend_reduced_form_with_review',
        sourceFormId: getOcrLabSourceFormId_(labConfig),
        uploadedFileCount: '',
        folders: folders,
        reviewUrl: '',
        ocrResults: [],
        ai: null,
        reviewJson: null,
        reviewFile: null,
        error: String(err && err.stack ? err.stack : err)
      });
    }
    logCaseError(caseId, err, 'processOcrLabTrainingSubmit_' + labConfig.skill);
    throw err;
  }
}

function resolveOcrLabConfigFromNamedValues_(preferredConfig, namedValues) {
  const keys = Object.keys(namedValues || {});
  const normalizedKeys = keys.map(function(key) {
    return removeVietnameseAccents_(key).toLowerCase();
  });
  const hasLandUpload = normalizedKeys.some(function(key) {
    return key.indexOf('upload anh bia dat') >= 0 || key.indexOf('giay chung nhan') >= 0 || key.indexOf('bia dat') >= 0;
  });
  if (hasLandUpload) return OCR_LAB_TRAINING.LAND;

  const hasCccdUpload = normalizedKeys.some(function(key) {
    return key.indexOf('upload anh cccd') >= 0 || key.indexOf('can cuoc') >= 0 || key.indexOf('cccd') >= 0;
  });
  if (hasCccdUpload) return OCR_LAB_TRAINING.CCCD;

  return preferredConfig;
}

function makeOcrLabFormData_(labConfig, reviewEmail, fileIds) {
  const groups = {
    secured_party: [],
    obligor: [],
    asset: []
  };
  groups[labConfig.group] = fileIds || [];
  return {
    reviewEmail: reviewEmail || '',
    assetType: labConfig.skill === OCR_LAB_TRAINING.LAND.skill ? 'Bất động sản' : '',
    contractType: '',
    assetCount: labConfig.skill === OCR_LAB_TRAINING.LAND.skill ? '1' : '',
    bankSigner: '',
    disputeCourt: '',
    valuationAmount: '',
    fileIdsByGroup: groups,
    lab_training: {
      enabled: true,
      skill: labConfig.skill
    }
  };
}

function appendOcrLabResponseRow_(caseId, formData, namedValues) {
  appendSheetRow(SHEETS.RESPONSES, {
    'Timestamp': nowIso(),
    'Case ID': caseId,
    'Review Email': formData.reviewEmail,
    'Asset Type': formData.assetType,
    'Contract Type': formData.contractType,
    'Asset Count': formData.assetCount,
    'Bank Signer': formData.bankSigner,
    'Dispute Court': formData.disputeCourt,
    'Valuation Amount': formData.valuationAmount,
    'Raw Form JSON': namedValues || {}
  });
}

function appendOcrLabCaseRow_(caseId, reviewEmail, folders, reviewUrl, token) {
  appendSheetRow(SHEETS.CASES, {
    'Case ID': caseId,
    'Review Email': reviewEmail,
    'Status': CASE_STATUS.CREATED,
    'Drive Folder URL': folders.caseFolderUrl,
    'Review URL': reviewUrl,
    'Review Token Hash': sha256Hex(token),
    'Created At': nowIso()
  });
}

function appendOcrLabResultRow_(labConfig, result) {
  appendSheetRow(SHEETS.LAB_TRAINING_RESULTS, {
    'Timestamp': nowIso(),
    'Case ID': result.caseId,
    'Lab Skill': labConfig.skill,
    'Mode': result.mode,
    'Source Form ID': result.sourceFormId,
    'Uploaded File Count': result.uploadedFileCount,
    'Drive Folder URL': result.folders && result.folders.caseFolderUrl,
    'Review URL': result.reviewUrl || '',
    'OCR Text JSON': result.ocrResults || [],
    'AI JSON File URL': result.ai && result.ai.fileUrl,
    'AI JSON': result.ai && result.ai.data,
    'Review JSON File URL': result.reviewFile && result.reviewFile.url,
    'Final Fields JSON': extractOcrLabFinalFields_(labConfig, result.reviewJson),
    'Validation Status': result.reviewJson && result.reviewJson.validation && result.reviewJson.validation.status,
    'Warnings': result.reviewJson && result.reviewJson.validation && result.reviewJson.validation.warnings,
    'Error': result.error || ''
  });
}

function extractOcrLabFinalFields_(labConfig, reviewJson) {
  if (!reviewJson) return {};
  if (labConfig.skill === OCR_LAB_TRAINING.LAND.skill) {
    const asset = (reviewJson.assets || [])[0] || {};
    return {
      certificate_title: flattenFieldForOcrLab_(asset.certificate_title),
      certificate_number: flattenFieldForOcrLab_(asset.real_estate && asset.real_estate.certificate_number),
      registry_number: flattenFieldForOcrLab_(asset.real_estate && asset.real_estate.registry_number),
      issuing_authority: flattenFieldForOcrLab_(asset.real_estate && asset.real_estate.issuing_authority),
      issue_date: flattenFieldForOcrLab_(asset.real_estate && asset.real_estate.issue_date),
      owner_name: flattenFieldForOcrLab_(asset.owner_name),
      land_plot_number: flattenFieldForOcrLab_(asset.real_estate && asset.real_estate.land_plot_number),
      map_sheet_number: flattenFieldForOcrLab_(asset.real_estate && asset.real_estate.map_sheet_number),
      land_address: flattenFieldForOcrLab_(asset.real_estate && asset.real_estate.land_address),
      area: flattenFieldForOcrLab_(asset.real_estate && asset.real_estate.area),
      area_in_words: flattenFieldForOcrLab_(asset.real_estate && asset.real_estate.area_in_words),
      usage_form: flattenFieldForOcrLab_(asset.real_estate && asset.real_estate.usage_form),
      usage_purpose: flattenFieldForOcrLab_(asset.real_estate && asset.real_estate.usage_purpose),
      usage_term: flattenFieldForOcrLab_(asset.real_estate && asset.real_estate.usage_term),
      usage_origin: flattenFieldForOcrLab_(asset.real_estate && asset.real_estate.usage_origin)
    };
  }
  return {
    secured_parties: (reviewJson.secured_parties || []).map(extractOcrLabPersonFields_),
    obligors: (reviewJson.obligors || []).map(extractOcrLabPersonFields_)
  };
}

function extractOcrLabPersonFields_(person) {
  return {
    full_name: flattenFieldForOcrLab_(person.full_name),
    date_of_birth: flattenFieldForOcrLab_(person.date_of_birth),
    gender: flattenFieldForOcrLab_(person.gender),
    id_document_type: flattenFieldForOcrLab_(person.id_document_type),
    id_number: flattenFieldForOcrLab_(person.id_number),
    id_issue_date: flattenFieldForOcrLab_(person.id_issue_date),
    id_issue_place: flattenFieldForOcrLab_(person.id_issue_place),
    id_expiry_date: flattenFieldForOcrLab_(person.id_expiry_date),
    permanent_address: flattenFieldForOcrLab_(person.permanent_address),
    current_address_final: flattenFieldForOcrLab_(person.current_address_final)
  };
}

function flattenFieldForOcrLab_(field) {
  if (!field) return '';
  if (field.hasOwnProperty && field.hasOwnProperty('final_value')) return field.final_value || '';
  return field;
}

function labEventToNamedValues_(e) {
  if (e && e.namedValues) return e.namedValues;
  const out = {};
  const responses = e && e.response && e.response.getItemResponses ? e.response.getItemResponses() : [];
  responses.forEach(function(itemResponse) {
    const title = itemResponse.getItem().getTitle();
    const response = itemResponse.getResponse();
    out[title] = Array.isArray(response) ? response : [response];
  });
  return out;
}

function saveOcrLabFormUrls_(labConfig, form) {
  const urls = {
    id: form.getId(),
    editUrl: form.getEditUrl(),
    publicUrl: form.getPublishedUrl()
  };
  const props = {};
  props[labConfig.propertyPrefix + '_FORM_ID'] = urls.id;
  props[labConfig.propertyPrefix + '_FORM_EDIT_URL'] = urls.editUrl;
  props[labConfig.propertyPrefix + '_FORM_PUBLIC_URL'] = urls.publicUrl;
  PropertiesService.getScriptProperties().setProperties(props, false);
  return urls;
}

function readOcrLabFormUrls_(labConfig, props) {
  return {
    id: props.getProperty(labConfig.propertyPrefix + '_FORM_ID') || '',
    editUrl: props.getProperty(labConfig.propertyPrefix + '_FORM_EDIT_URL') || '',
    publicUrl: props.getProperty(labConfig.propertyPrefix + '_FORM_PUBLIC_URL') || ''
  };
}

function getOcrLabSourceFormId_(labConfig) {
  return PropertiesService.getScriptProperties().getProperty(labConfig.propertyPrefix + '_FORM_ID') || '';
}

function makeOcrLabCaseId_(labConfig) {
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss');
  const suffix = Utilities.getUuid().slice(0, 8).toUpperCase();
  return 'LAB-' + labConfig.skill + '-' + stamp + '-' + suffix;
}
