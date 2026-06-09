function onOpen() {
  const ui = getSpreadsheetUiSafe_();
  if (!ui) return;
  ui.createMenu('HDTC OCR')
    .addItem('1. Create a management sheet', 'setupSpreadsheet')
    .addItem('2. Create Google Form template', 'createGoogleFormTemplate')
    .addItem('2b. Update Google Form to OCR only', 'updateGoogleFormToOcrOnly')
    .addItem('2c. Fix Google Form labels only', 'fixGoogleFormLabelsOnly')
    .addItem('2d. Show Google Form URLs', 'showGoogleFormUrls')
    .addItem('3. Install Form Submit trigger', 'installFormSubmitTrigger')
    .addItem('3b. Reinstall Form Submit trigger', 'reinstallFormSubmitTrigger')
    .addItem('3c. Reset Form trigger now', 'resetFormSubmitTriggerNow')
    .addItem('4. Check configuration', 'checkPhase1Configuration')
    .addItem('4b. Diagnose latest case', 'runDiagnoseLatestCase')
    .addItem('4c. Reprocess latest case', 'runReprocessLatestCase')
    .addItem('5. Show contract template config JSON', 'showContractTemplateConfigJson')
    .addItem('6. Setup Phase 2 templates from Drive folder', 'setupPhase2Templates')
    .addToUi();
}

function setupPhase1() {
  setupSpreadsheet();
  const formInfo = createGoogleFormTemplate();
  installFormSubmitTrigger();
  const message = [
    'Setup completed.',
    'Form edit URL: ' + formInfo.editUrl,
    'Form public URL: ' + formInfo.publicUrl,
    'Next: submit a test form response.'
  ].join('\n');
  const ui = getSpreadsheetUiSafe_();
  if (ui) ui.alert(message);
  console.log(message);
  return formInfo;
}

function runDiagnoseLatestCase() {
  return diagnoseLatestCase();
}

function runReprocessLatestCase() {
  return reprocessLatestCase();
}

function createGoogleFormTemplate() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const existingUrl = PropertiesService.getScriptProperties().getProperty('FORM_EDIT_URL');
  if (existingUrl) {
    return updateGoogleFormToOcrOnly();
  }

  const form = FormApp.create('\u0054\u0069\u1ebf\u0070 \u006e\u0068\u1ead\u006e \u0068\u1ed3 \u0073\u01a1 \u0074\u0068\u1ebf \u0063\u0068\u1ea5\u0070 \u002d \u004f\u0043\u0052 \u0052\u0065\u0076\u0069\u0065\u0077 \u0047\u0069\u0061\u0069 \u0111\u006f\u1ea1\u006e \u0031');
  form.setDescription('\u0042\u0069\u1ec3\u0075 \u006d\u1eabu \u0074\u0069\u1ebf\u0070 \u006e\u0068\u1ead\u006e \u0068\u1ed3 \u0073\u01a1 \u0111\u1ec3 \u004f\u0043\u0052\u002c \u0062\u00f3\u0063 \u0074\u00e1\u0063\u0068 \u0064\u1eef \u006c\u0069\u1ec7\u0075 \u0076\u00e0 \u0072\u0065\u0076\u0069\u0065\u0077 \u0074\u0072\u01b0\u1edb\u0063 \u006b\u0068\u0069 \u0073\u006f\u1ea1\u006e \u0068\u1ee3\u0070 \u0111\u1ed3\u006e\u0067\u002e');
  form.setCollectEmail(false);
  form.setAllowResponseEdits(false);
  form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());

  form.addTextItem()
    .setTitle(CONFIG.FORM_FIELDS.reviewEmail)
    .setRequired(true);
  addFileUploadItem_(form, CONFIG.FORM_FIELDS.securedPartyFiles);
  addFileUploadItem_(form, CONFIG.FORM_FIELDS.obligorFiles);
  addFileUploadItem_(form, CONFIG.FORM_FIELDS.assetFiles);

  return saveGoogleFormUrls_(form);
}

function updateGoogleFormToOcrOnly() {
  const formId = PropertiesService.getScriptProperties().getProperty('FORM_ID');
  if (!formId) throw new Error('Missing FORM_ID. Create or link Google Form first.');
  const form = FormApp.openById(formId);
  if (typeof form.addFileUploadItem !== 'function') {
    throw new Error('\u0041\u0070\u0070\u0073 \u0053\u0063\u0072\u0069\u0070\u0074 \u006e\u00e0\u0079 \u006b\u0068\u00f4\u006e\u0067 \u0068\u1ed7 \u0074\u0072\u1ee3 \u0074\u1ea1\u006f \u0063\u00e2\u0075 \u0068\u1ecf\u0069 \u0046\u0069\u006c\u0065 \u0075\u0070\u006c\u006f\u0061\u0064 \u0062\u1eb1\u006e\u0067 \u0063\u006f\u0064\u0065\u002e \u004b\u0068\u00f4\u006e\u0067 \u0078\u00f3\u0061\u002f\u0073\u1eeda \u0046\u006f\u0072\u006d\u002e \u0056\u0075\u0069 \u006c\u00f2\u006e\u0067 \u0111\u1ed5\u0069 \u0033 \u0063\u00e2\u0075 \u0068\u1ecf\u0069 \u0075\u0070\u006c\u006f\u0061\u0064 \u0073\u0061\u006e\u0067 \u006c\u006f\u1ea1\u0069 \u0022\u0054\u1ea3\u0069 \u0074\u1ec7\u0070 \u006c\u00ea\u006e\u0022 \u0074\u0068\u1ee7 \u0063\u00f4\u006e\u0067 \u0074\u0072\u006f\u006e\u0067 \u0047\u006f\u006f\u0067\u006c\u0065 \u0046\u006f\u0072\u006d\u002e');
  }
  const items = form.getItems();
  for (let i = items.length - 1; i >= 0; i--) {
    form.deleteItem(items[i]);
  }
  form.addTextItem()
    .setTitle(CONFIG.FORM_FIELDS.reviewEmail)
    .setRequired(true);
  addFileUploadItem_(form, CONFIG.FORM_FIELDS.securedPartyFiles);
  addFileUploadItem_(form, CONFIG.FORM_FIELDS.obligorFiles);
  addFileUploadItem_(form, CONFIG.FORM_FIELDS.assetFiles);
  console.log('Updated Google Form to OCR-only input. Public URL: ' + form.getPublishedUrl());
  return saveGoogleFormUrls_(form);
}

function fixGoogleFormLabelsOnly() {
  const formId = PropertiesService.getScriptProperties().getProperty('FORM_ID');
  if (!formId) throw new Error('Missing FORM_ID. Create or link Google Form first.');
  const form = FormApp.openById(formId);
  form.setTitle('\u0054\u0069\u1ebf\u0070 \u006e\u0068\u1ead\u006e \u0068\u1ed3 \u0073\u01a1 \u0074\u0068\u1ebf \u0063\u0068\u1ea5\u0070 \u002d \u004f\u0043\u0052 \u0052\u0065\u0076\u0069\u0065\u0077 \u0047\u0069\u0061\u0069 \u0111\u006f\u1ea1\u006e \u0031');
  form.setDescription('\u0042\u0069\u1ec3\u0075 \u006d\u1eabu \u0074\u0069\u1ebf\u0070 \u006e\u0068\u1ead\u006e \u0068\u1ed3 \u0073\u01a1 \u0111\u1ec3 \u004f\u0043\u0052\u002c \u0062\u00f3\u0063 \u0074\u00e1\u0063\u0068 \u0064\u1eef \u006c\u0069\u1ec7\u0075 \u0076\u00e0 \u0072\u0065\u0076\u0069\u0065\u0077 \u0074\u0072\u01b0\u1edb\u0063 \u006b\u0068\u0069 \u0073\u006f\u1ea1\u006e \u0068\u1ee3\u0070 \u0111\u1ed3\u006e\u0067\u002e');

  const titles = [
    CONFIG.FORM_FIELDS.reviewEmail,
    CONFIG.FORM_FIELDS.securedPartyFiles,
    CONFIG.FORM_FIELDS.obligorFiles,
    CONFIG.FORM_FIELDS.assetFiles
  ];
  const helpText = '\u0043\u00f3 \u0074\u0068\u1ec3 \u0075\u0070\u006c\u006f\u0061\u0064 \u006e\u0068\u0069\u1ec1\u0075 \u0066\u0069\u006c\u0065\u003a \u1ea3\u006e\u0068\u002c \u0050\u0044\u0046 \u0068\u006f\u1eb7\u0063 \u0057\u006f\u0072\u0064\u002e';
  const items = form.getItems();
  for (let i = 0; i < items.length && i < titles.length; i++) {
    items[i].setTitle(titles[i]);
    if (i > 0) {
      try {
        items[i].setHelpText(helpText);
      } catch (err) {
        console.warn(err);
      }
    }
  }
  const urls = saveGoogleFormUrls_(form);
  console.log('Fixed Google Form labels only.\nEdit URL: ' + urls.editUrl + '\nPublic URL: ' + urls.publicUrl);
  return urls;
}

function showGoogleFormUrls() {
  const formId = PropertiesService.getScriptProperties().getProperty('FORM_ID');
  if (!formId) throw new Error('Missing FORM_ID. Create or link Google Form first.');
  const form = FormApp.openById(formId);
  const urls = saveGoogleFormUrls_(form);
  const message = 'Form edit URL: ' + urls.editUrl + '\nForm public URL: ' + urls.publicUrl;
  const ui = getSpreadsheetUiSafe_();
  if (ui) ui.alert(message);
  console.log(message);
  return urls;
}

function resetFormSubmitTriggerNow() {
  const triggers = ScriptApp.getProjectTriggers();
  let deleted = 0;
  triggers.forEach(function(trigger) {
    if (trigger.getHandlerFunction && trigger.getHandlerFunction() === 'onFormSubmit') {
      ScriptApp.deleteTrigger(trigger);
      deleted++;
    }
  });
  installFormSubmitTrigger();
  const message = 'Reset Form submit trigger completed. Deleted old onFormSubmit triggers: ' + deleted;
  const ui = getSpreadsheetUiSafe_();
  if (ui) ui.alert(message);
  console.log(message);
  return message;
}

function saveGoogleFormUrls_(form) {
  const urls = {
    id: form.getId(),
    editUrl: form.getEditUrl(),
    publicUrl: form.getPublishedUrl()
  };
  PropertiesService.getScriptProperties().setProperties({
    FORM_ID: urls.id,
    FORM_EDIT_URL: urls.editUrl,
    FORM_PUBLIC_URL: urls.publicUrl
  }, true);
  return urls;
}

function checkPhase1Configuration() {
  const props = PropertiesService.getScriptProperties();
  const checks = [
    ['OPENAI_API_KEY', Boolean(props.getProperty(CONFIG.OPENAI_API_KEY_PROPERTY))],
    ['CLOUD_VISION_API_KEY', CONFIG.DEFAULT_OCR_ENGINE !== 'CLOUD_VISION' || Boolean(props.getProperty(CONFIG.CLOUD_VISION_API_KEY_PROPERTY))],
    ['REVIEW_WEB_APP_URL', Boolean(props.getProperty(CONFIG.REVIEW_WEB_APP_URL_PROPERTY))],
    ['DEFAULT_REVIEW_WEB_APP_URL', Boolean(CONFIG.DEFAULT_REVIEW_WEB_APP_URL)],
    ['FORM_EDIT_URL', Boolean(props.getProperty('FORM_EDIT_URL'))],
    ['Drive advanced service', typeof Drive !== 'undefined']
  ];
  const message = checks.map(function(item) {
    return (item[1] ? 'OK ' : 'MISSING ') + item[0];
  }).join('\n');
  const ui = getSpreadsheetUiSafe_();
  if (ui) ui.alert(message);
  console.log(message);
  return message;
}

function syncReviewWebAppUrlToDefault() {
  PropertiesService.getScriptProperties().setProperty(
    CONFIG.REVIEW_WEB_APP_URL_PROPERTY,
    CONFIG.DEFAULT_REVIEW_WEB_APP_URL
  );
  const message = 'REVIEW_WEB_APP_URL synced: ' + CONFIG.DEFAULT_REVIEW_WEB_APP_URL;
  console.log(message);
  return message;
}

function showContractTemplateConfigJson() {
  const json = JSON.stringify(getContractTemplateConfigs_(), null, 2);
  console.log(json);
  const ui = getSpreadsheetUiSafe_();
  if (ui) ui.alert('Contract template config JSON has been printed to execution log.');
  return json;
}

function setupPhase2Templates() {
  return setupPhase2TemplatesFromDriveFolder('HDTC_Phase2_Templates');
}

function setupPhase2Template03a() { return setupOnePhase2TemplateFromDriveFolder('03a_bds_chinh_chu'); }
function setupPhase2Template03b() { return setupOnePhase2TemplateFromDriveFolder('03b_bds_ben_thu_ba'); }
function setupPhase2Template03c() { return setupOnePhase2TemplateFromDriveFolder('03c_bds_ts_chua_chung_nhan_chinh_chu'); }
function setupPhase2Template03d() { return setupOnePhase2TemplateFromDriveFolder('03d_bds_ts_chua_chung_nhan_ben_thu_ba'); }
function setupPhase2Template02a() { return setupOnePhase2TemplateFromDriveFolder('02a_dong_san_chinh_chu'); }
function setupPhase2Template02b() { return setupOnePhase2TemplateFromDriveFolder('02b_dong_san_ben_thu_ba'); }
function setupPhase2Template17() { return setupOnePhase2TemplateFromDriveFolder('17_uy_quyen_xu_ly_tai_san'); }

function saveContractTemplateConfigJson(jsonText) {
  const parsed = JSON.parse(jsonText);
  if (!Array.isArray(parsed)) throw new Error('Template config must be an array');
  parsed.forEach(function(item) {
    if (!item.code || !item.name) throw new Error('Each template needs code and name');
  });
  PropertiesService.getScriptProperties().setProperty(
    CONFIG.CONTRACT_TEMPLATE_CONFIG_PROPERTY,
    JSON.stringify(parsed)
  );
  return 'Saved ' + parsed.length + ' contract templates';
}

function addFileUploadItem_(form, title) {
  if (typeof form.addFileUploadItem === 'function') {
    const item = form.addFileUploadItem()
      .setTitle(title)
      .setRequired(false)
      .setMaxFiles(10);
    try {
      item.setHelpText('\u0043\u00f3 \u0074\u0068\u1ec3 \u0075\u0070\u006c\u006f\u0061\u0064 \u006e\u0068\u0069\u1ec1\u0075 \u0066\u0069\u006c\u0065\u003a \u1ea3\u006e\u0068\u002c \u0050\u0044\u0046 \u0068\u006f\u1eb7\u0063 \u0057\u006f\u0072\u0064\u002e');
    } catch (err) {
      console.warn(err);
    }
    return item;
  }
  throw new Error('\u0041\u0070\u0070\u0073 \u0053\u0063\u0072\u0069\u0070\u0074 \u006e\u00e0\u0079 \u006b\u0068\u00f4\u006e\u0067 \u0068\u1ed7 \u0074\u0072\u1ee3 \u0074\u1ea1\u006f \u0063\u00e2\u0075 \u0068\u1ecf\u0069 \u0046\u0069\u006c\u0065 \u0075\u0070\u006c\u006f\u0061\u0064 \u0062\u1eb1\u006e\u0067 \u0063\u006f\u0064\u0065\u002e \u0056\u0075\u0069 \u006c\u00f2\u006e\u0067 \u006d\u1edf \u0047\u006f\u006f\u0067\u006c\u0065 \u0046\u006f\u0072\u006d \u0076\u00e0 \u0111\u1ed5\u0069 \u0033 \u0063\u00e2\u0075 \u0068\u1ecf\u0069 \u0075\u0070\u006c\u006f\u0061\u0064 \u0073\u0061\u006e\u0067 \u006c\u006f\u1ea1\u0069 \u0022\u0054\u1ea3\u0069 \u0074\u1ec7\u0070 \u006c\u00ea\u006e\u0022 \u0074\u0068\u1ee7 \u0063\u00f4\u006e\u0067\u002e');
}

function getSpreadsheetUiSafe_() {
  try {
    return SpreadsheetApp.getUi();
  } catch (err) {
    return null;
  }
}
