function listContractTemplatesForReview(caseId, token) {
  assertValidToken_(caseId, token);
  let data = getLatestFinalData(caseId) || getLatestExtractedData(caseId);
  if (!data) throw new Error('No data for case ' + caseId);
  data = ensureTemplateDecisionFields_(data);
  data = applyOverridesToReviewJson(data, getOverrides(caseId));
  data = applyTemplateDecisionToReviewJson(data);
  const finalData = unwrapFinalValuesForContract_(buildFinalConfirmedData(data));
  const firstAsset = finalData.assets && finalData.assets[0] ? finalData.assets[0] : {};
  const assetType = String(finalData.contract_info && finalData.contract_info.asset_type || firstAsset.asset_type || '');
  const contractType = String(finalData.contract_info && finalData.contract_info.contract_type || '');
  return getContractTemplateConfigs_().map(function(tpl) {
    const configured = tpl.code === '17_uy_quyen_xu_ly_tai_san' || Boolean(tpl.template_doc_id);
    const mappingReady = isTemplateMappingReady_(tpl.code);
    const applicable = isTemplateApplicable_(tpl, assetType, contractType);
    return {
      code: tpl.code,
      name: tpl.name,
      asset_type: tpl.asset_type || '',
      contract_type: tpl.contract_type || '',
      configured: configured,
      mapping_ready: mappingReady,
      applicable: applicable,
      enabled: configured && mappingReady,
      output_formats: ['DOCX']
    };
  });
}

function generateContractsForCase(caseId, token, templateCodes) {
  assertValidToken_(caseId, token);
  templateCodes = templateCodes || [];
  if (!templateCodes.length) throw new Error('Please select at least one template');

  let data = getLatestFinalData(caseId);
  if (!data || !data.final_confirmed_data) {
    throw new Error('Review must be confirmed before generating contracts');
  }

  data = ensureTemplateDecisionFields_(data);
  data = applyOverridesToReviewJson(data, getOverrides(caseId));
  data = applyTemplateDecisionToReviewJson(data);
  fillMissingPersonIssueDatesFromReviewOcr_(data, caseId);
  const finalData = buildFinalConfirmedData(data);
  const templates = getContractTemplateConfigs_().filter(function(tpl) {
    return templateCodes.indexOf(tpl.code) >= 0;
  });
  if (!templates.length) throw new Error('No matching templates');

  const folders = getCaseOutputFolders_(caseId);
  const values = buildContractPlaceholderMap_(finalData);
  const generated = [];
  templates.forEach(function(tpl) {
    try {
      if (!isTemplateMappingReady_(tpl.code)) throw new Error('Template has not been linked to OCR data yet: ' + tpl.code);
      if (tpl.code !== '17_uy_quyen_xu_ly_tai_san' && !tpl.template_doc_id) throw new Error('Template is not configured: ' + tpl.code);
      const result = generateOneContract_(caseId, tpl, values, folders.outputFolderId, finalData);
      generated.push(result);
      appendGeneratedContractRow_(caseId, tpl, result, '', 'DONE', '');
      logAudit(caseId, 'CONTRACT_GENERATED', { template_code: tpl.code, docx_url: result.docx_url });
    } catch (err) {
      const error = String(err && err.message ? err.message : err);
      appendGeneratedContractRow_(caseId, tpl, {}, '', 'ERROR', error);
      logAudit(caseId, 'CONTRACT_GENERATION_ERROR', { template_code: tpl.code, error: error });
      generated.push({ template_code: tpl.code, template_name: tpl.name, status: 'ERROR', error: error });
    }
  });

  const row = getCaseRow(caseId);
  const email = extractFirstValidEmail_(row && row['Review Email'] ? row['Review Email'] : '');
  if (email) {
    sendGeneratedContractsEmail(caseId, email, generated);
    markGeneratedContractsEmailSent_(caseId, templateCodes, email);
  }
  return {
    ok: true,
    generated: generated,
    email_sent_to: email
  };
}

function extractFirstValidEmail_(value) {
  const text = String(value || '');
  const matches = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig) || [];
  return matches[0] || '';
}

function isTemplateMappingReady_(code) {
  return [
    '03b_bds_ben_thu_ba',
    '17_uy_quyen_xu_ly_tai_san'
  ].indexOf(code) >= 0;
}

function generateOneContract_(caseId, tpl, values, outputFolderId, finalData) {
  if (tpl.code === '17_uy_quyen_xu_ly_tai_san') {
    return generateAuthorizationContract17_(caseId, tpl, values, outputFolderId);
  }
  const outputFolder = DriveApp.getFolderById(outputFolderId);
  const templateFile = DriveApp.getFileById(tpl.template_doc_id);
  const safeName = sanitizeFileNamePart(caseId + '_' + tpl.code + '_' + tpl.name);
  const copy = templateFile.makeCopy(safeName, outputFolder);
  const doc = DocumentApp.openById(copy.getId());
  replaceDocumentPlaceholders_(doc, values);
  applyLinkedExcelTemplateReplacements_(doc, tpl, values, finalData);
  doc.saveAndClose();

  const generatedFile = DriveApp.getFileById(copy.getId());
  const result = {
    template_code: tpl.code,
    template_name: tpl.name,
    status: 'DONE',
    google_doc_id: copy.getId(),
    google_doc_url: generatedFile.getUrl(),
    docx_file_id: '',
    docx_url: '',
    docx_download_url: ''
  };

  const docxBlob = exportGoogleDocAs_(copy.getId(), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    .setName(safeName + '.docx');
  const docx = outputFolder.createFile(docxBlob);
  docx.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  result.docx_file_id = docx.getId();
  result.docx_url = docx.getUrl();
  result.docx_download_url = buildDriveDownloadUrl_(docx.getId());
  return result;
}

function generateAuthorizationContract17_(caseId, tpl, values, outputFolderId) {
  const outputFolder = DriveApp.getFolderById(outputFolderId);
  const safeName = sanitizeFileNamePart(caseId + '_' + tpl.code + '_' + tpl.name);
  const doc = DocumentApp.create(safeName);
  const file = DriveApp.getFileById(doc.getId());
  outputFolder.addFile(file);
  try {
    DriveApp.getRootFolder().removeFile(file);
  } catch (err) {
    // Keeping the file in root is harmless if Drive refuses removal.
  }

  buildAuthorizationContract17Body_(doc, values);
  doc.saveAndClose();

  const docxBlob = exportGoogleDocAs_(doc.getId(), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    .setName(safeName + '.docx');
  const docx = outputFolder.createFile(docxBlob);
  docx.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  return {
    template_code: tpl.code,
    template_name: tpl.name,
    status: 'DONE',
    google_doc_id: doc.getId(),
    google_doc_url: file.getUrl(),
    docx_file_id: docx.getId(),
    docx_url: docx.getUrl(),
    docx_download_url: buildDriveDownloadUrl_(docx.getId())
  };
}

function buildAuthorizationContract17Body_(doc, values) {
  const body = doc.getBody();
  body.clear();
  body.setAttributes({
    [DocumentApp.Attribute.FONT_FAMILY]: 'Times New Roman',
    [DocumentApp.Attribute.FONT_SIZE]: 12
  });

  appendCentered_(body, 'Mẫu 17/HĐBĐ - Hợp đồng ủy quyền xử lý tài sản bảo đảm', 12, false);
  appendCentered_(body, 'HỢP ĐỒNG ỦY QUYỀN XỬ LÝ TÀI SẢN BẢO ĐẢM', 14, true);
  appendCentered_(body, 'Số: ' + buildAuthorizationContractNumber_(values), 12, true);
  body.appendParagraph('');

  appendNormal_(body, 'Căn cứ các văn bản pháp luật có liên quan;');
  appendNormal_(body, 'Căn cứ Hợp đồng thế chấp/cầm cố tài sản số ' + contractValue_(values, 'so_hop_dong_the_chap', buildMortgageContractNumber_(values)) + ' giữa ' + contractValue_(values, 'ben_bao_dam_danh_sach_ten') + ' và Ngân hàng TMCP Đầu tư và Phát triển Việt Nam;');
  appendNormal_(body, 'Để đảm bảo việc thực hiện quyền của ngân hàng theo hợp đồng bảo đảm đã ký;');
  appendItalicCentered_(body, 'Hôm nay, ngày ' + contractValue_(values, 'ngay_lap_hop_dong_ngay') + ' tháng ' + contractValue_(values, 'ngay_lap_hop_dong_thang') + ' năm ' + contractValue_(values, 'ngay_lap_hop_dong_nam') + ', tại ' + contractValue_(values, 'dia_diem_lap_hop_dong', '................') + ', chúng tôi gồm có:');

  appendHeading_(body, 'I. BÊN ỦY QUYỀN (chủ tài sản cầm cố/thế chấp):');
  appendPeopleSection_(body, values);
  appendNormal_(body, '(Sau đây gọi là Bên ủy quyền)');
  appendNormal_(body, 'và');

  appendHeading_(body, 'II. BÊN ĐƯỢC ỦY QUYỀN: NGÂN HÀNG TMCP ĐẦU TƯ VÀ PHÁT TRIỂN VIỆT NAM');
  appendKeyValue_(body, 'Mã số doanh nghiệp', '0100150619');
  appendKeyValue_(body, 'Địa chỉ Trụ sở chính', 'Tháp BIDV, 194 Trần Quang Khải, Phường Hoàn Kiếm, Thành phố Hà Nội');
  appendKeyValue_(body, 'Đơn vị trực tiếp quản lý khách hàng', contractValue_(values, 'don_vi_quan_ly_khach_hang', 'Chi nhánh 01'));
  appendKeyValue_(body, 'Địa chỉ', contractValue_(values, 'dia_chi_don_vi_ngan_hang', ''));
  appendKeyValue_(body, 'Người đại diện', contractValue_(values, 'nguoi_ky_ngan_hang', ''));
  appendKeyValue_(body, 'Chức vụ', contractValue_(values, 'chuc_vu_nguoi_ky_ngan_hang', ''));
  appendNormal_(body, '(Ngân hàng TMCP Đầu tư và Phát triển Việt Nam, trong đó đơn vị đại diện quản lý tài sản khách hàng trực tiếp ký kết và thực hiện các quyền, nghĩa vụ của Ngân hàng theo Hợp đồng này được gọi tắt là “Bên được uỷ quyền” hoặc “Ngân hàng”)');

  appendNormal_(body, 'Các bên thỏa thuận thống nhất lập Hợp đồng ủy quyền này với các nội dung cụ thể như sau:');
  appendHeading_(body, 'Điều 1. Phạm vi ủy quyền');
  appendNormal_(body, '1. Bằng Hợp đồng ủy quyền này, Bên ủy quyền chỉ định, ủy quyền không hủy ngang cho Ngân hàng làm người đại diện duy nhất của Bên ủy quyền để thực hiện việc xử lý toàn bộ tài sản bảo đảm của Bên ủy quyền tại Ngân hàng trong trường hợp phải thực hiện xử lý tài sản bảo đảm theo quy định tại Hợp đồng bảo đảm.');
  appendNormal_(body, 'Cụ thể tài sản bảo đảm (TSBĐ) ủy quyền cho Ngân hàng xử lý gồm:');
  appendAssetSection_(body, values);
  appendNormal_(body, '2. Trong quá trình thực hiện ủy quyền xử lý TSBĐ nêu tại khoản 1 Điều này, Ngân hàng được thực hiện toàn bộ các quyền (không phải là nghĩa vụ) của Bên ủy quyền với tư cách là chủ tài sản, bao gồm và không giới hạn bởi các quyền sau:');
  appendNormal_(body, 'a) Chỉ định hoặc ủy quyền lại việc xử lý TSBĐ cho một người, cá nhân hoặc tổ chức khác thay thế Ngân hàng trong việc thực hiện các quyền của Bên ủy quyền trong xử lý TSBĐ;');
  appendNormal_(body, 'b) Bán hoặc định đoạt TSBĐ dưới bất kỳ hình thức hợp pháp nào theo phương thức do Ngân hàng quyết định;');
  appendNormal_(body, 'c) Xác định mức giá bán TSBĐ trên cơ sở mặt bằng giá thị trường hoặc thuê tổ chức định giá nếu Ngân hàng xét thấy cần thiết;');
  appendNormal_(body, 'd) Trừ đi các chi phí phát sinh do việc phát mại TSBĐ;');
  appendNormal_(body, 'e) Ra, vào địa điểm nơi TSBĐ tọa lạc để phục vụ việc quản lý, bảo quản, kiểm tra, xử lý TSBĐ theo quy định pháp luật;');
  appendNormal_(body, 'f) Thực hiện các quyền khác của chủ tài sản đối với TSBĐ trong phạm vi xử lý tài sản bảo đảm.');

  appendHeading_(body, 'Điều 2. Phê chuẩn các văn bản, hành động');
  appendNormal_(body, 'Trong quá trình xử lý TSBĐ theo Hợp đồng uỷ quyền này, Ngân hàng được nhân danh và đại diện Bên ủy quyền thực hiện bất kỳ hành động, thủ tục nào trước cơ quan nhà nước có thẩm quyền và ký kết các văn kiện cần thiết để đạt được mục đích xử lý TSBĐ.');
  appendNormal_(body, 'Tất cả các văn bản, thủ tục do Ngân hàng ký kết, thực hiện trong quá trình thực hiện Hợp đồng ủy quyền này là được ủy quyền hợp pháp của Bên ủy quyền và hoàn toàn có hiệu lực pháp luật, ràng buộc trách nhiệm của Bên ủy quyền.');

  appendHeading_(body, 'Điều 3. Ủy quyền không được hủy ngang; thời hạn ủy quyền');
  appendNormal_(body, '1. Hợp đồng ủy quyền được Bên ủy quyền ký kết là một hợp đồng ủy quyền không có thù lao nhằm mục đích xử lý TSBĐ để trả nợ vay của Bên ủy quyền và/hoặc Người có nghĩa vụ được bảo đảm tại Ngân hàng.');
  appendNormal_(body, '2. Bên ủy quyền đồng ý rằng các quyền hạn mà Bên ủy quyền ủy quyền cho Ngân hàng thực hiện theo Hợp đồng ủy quyền này sẽ không bị hủy ngang, có hiệu lực và giá trị đầy đủ cho đến khi bán xong toàn bộ TSBĐ và xử lý xong số tiền thu được trả nợ Ngân hàng.');
  appendNormal_(body, 'Bằng văn bản này, Bên ủy quyền từ bỏ mọi quyền đơn phương chấm dứt, hủy bỏ Hợp đồng ủy quyền này theo quy định của văn bản pháp luật.');

  appendHeading_(body, 'Điều 4. Ủy quyền lại');
  appendNormal_(body, 'Ngân hàng có thể tại bất kỳ thời điểm nào ủy quyền lại cho bất kỳ tổ chức/cá nhân nào thực hiện tất cả hoặc bất kỳ quyền hạn, thẩm quyền và quyền quyết định nào mà Ngân hàng có quyền thực hiện theo Hợp đồng ủy quyền này liên quan đến việc định đoạt TSBĐ.');

  appendHeading_(body, 'Điều 5. Điều khoản cuối cùng');
  appendNormal_(body, '1. Hai bên cam kết có đầy đủ thẩm quyền để ký Hợp đồng ủy quyền này và đã hiểu rõ quyền, nghĩa vụ và lợi ích hợp pháp của mình, ý nghĩa và trách nhiệm pháp lý của việc ký kết Hợp đồng này.');
  appendNormal_(body, '2. Hợp đồng này được lập thành 03 (ba) bản bằng tiếng Việt, có giá trị pháp lý như nhau, mỗi bên giữ 01 (một) bản để làm căn cứ thực hiện.');
  appendNormal_(body, '3. Hợp đồng này có hiệu lực kể từ ngày ký hoặc thời điểm được công chứng.');
  body.appendParagraph('');

  const table = body.appendTable([
    [contractValue_(values, 'ben_bao_dam_danh_sach_ten', 'BÊN ỦY QUYỀN') + '\nvới tư cách là Bên ủy quyền', 'NGÂN HÀNG TMCP ĐẦU TƯ VÀ PHÁT TRIỂN VIỆT NAM\nvới tư cách là Bên được ủy quyền'],
    ['Chữ ký:\n\n\n\nTên:', 'Chữ ký:\n\n\n\nTên:\nChức vụ:']
  ]);
  table.setBorderWidth(0);
}

function appendPeopleSection_(body, values) {
  for (let i = 1; i <= 6; i++) {
    const name = contractValue_(values, 'ben_bao_dam_' + i + '_ho_ten');
    if (!name) continue;
    appendNormal_(body, (i > 1 ? 'và ' : '') + contractValue_(values, 'ben_bao_dam_' + i + '_danh_xung') + ' ' + name);
    appendKeyValue_(body, 'Ngày sinh', contractValue_(values, 'ben_bao_dam_' + i + '_ngay_sinh'));
    appendKeyValue_(body, contractValue_(values, 'ben_bao_dam_' + i + '_loai_giay_to', 'CCCD số'), contractValue_(values, 'ben_bao_dam_' + i + '_so_giay_to'));
    appendKeyValue_(body, 'Nơi cấp', contractValue_(values, 'ben_bao_dam_' + i + '_noi_cap'));
    appendKeyValue_(body, 'Ngày cấp', contractValue_(values, 'ben_bao_dam_' + i + '_ngay_cap'));
    appendKeyValue_(body, 'Địa chỉ', contractValue_(values, 'ben_bao_dam_' + i + '_dia_chi'));
  }
}

function appendAssetSection_(body, values) {
  const assetText = contractValue_(values, 'tai_san_text');
  if (assetText) {
    assetText.split('\n').forEach(function(line) {
      if (line) appendNormal_(body, line);
    });
    return;
  }
  appendNormal_(body, '(i) ' + contractValue_(values, 'tai_san_1_loai', 'Tài sản bảo đảm'));
  appendNormal_(body, 'Giấy chứng nhận số: ' + contractValue_(values, 'tai_san_1_so_gcn'));
  appendNormal_(body, 'Số vào sổ cấp GCN: ' + contractValue_(values, 'tai_san_1_so_vao_so'));
  appendNormal_(body, 'Thửa đất số: ' + contractValue_(values, 'tai_san_1_so_thua') + '; Tờ bản đồ số: ' + contractValue_(values, 'tai_san_1_to_ban_do'));
  appendNormal_(body, 'Địa chỉ: ' + contractValue_(values, 'tai_san_1_dia_chi'));
}

function buildAuthorizationContractNumber_(values) {
  return formatContractSequence_(contractValue_(values, 'so_thu_tu_hop_dong', '01')) + '/' +
    contractValue_(values, 'ngay_lap_hop_dong_nam', Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy')) +
    '/' + contractValue_(values, 'cif_khach_hang', '................') + '/HĐUQ';
}

function buildMortgageContractNumber_(values) {
  return formatContractSequence_(contractValue_(values, 'so_thu_tu_hop_dong', '01')) + '/' +
    contractValue_(values, 'ngay_lap_hop_dong_nam', Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy')) +
    '/' + contractValue_(values, 'cif_khach_hang', '................') + '/HĐBĐ';
}

function appendCentered_(body, text, size, bold) {
  const p = body.appendParagraph(text || '');
  p.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
  p.setFontSize(size || 12);
  p.setBold(Boolean(bold));
  return p;
}

function appendItalicCentered_(body, text) {
  const p = appendCentered_(body, text, 12, true);
  p.setItalic(true);
  return p;
}

function appendHeading_(body, text) {
  const p = body.appendParagraph(text || '');
  p.setBold(true);
  p.setSpacingBefore(8);
  return p;
}

function appendNormal_(body, text) {
  const p = body.appendParagraph(text || '');
  p.setAlignment(DocumentApp.HorizontalAlignment.JUSTIFY);
  p.setLineSpacing(1.15);
  return p;
}

function appendKeyValue_(body, label, value) {
  const table = body.appendTable([[label || '', ':', value || '']]);
  table.setBorderWidth(0);
  table.getRow(0).getCell(0).setWidth(130);
  table.getRow(0).getCell(1).setWidth(12);
  return table;
}

function contractValue_(values, key, fallback) {
  const value = cleanContractText_(values && values[key]);
  return value || fallback || '';
}

function replaceDocumentPlaceholders_(doc, values) {
  const body = doc.getBody();
  Object.keys(values).forEach(function(key) {
    body.replaceText('\\{\\{' + escapeRegex_(key) + '\\}\\}', sanitizeReplacementText_(values[key]));
  });
}

function applyLinkedExcelTemplateReplacements_(doc, tpl, values, finalData) {
  if (!tpl || tpl.code !== '03b_bds_ben_thu_ba') return;
  applyTemplate03bReplacements_(doc, values || {}, finalData || {});
}

function applyTemplate03bReplacements_(doc, values, finalData) {
  const body = doc.getBody();
  const contractNo = buildMortgageContractNumber_(values);
  const valuationNo = contractNo.replace(/\/H\u0110B\u0110$/i, '/BB\u0110G');
  const contractDateText = 'ng\u00e0y ' + (values.ngay_lap_hop_dong_ngay || '...') +
    ' th\u00e1ng ' + (values.ngay_lap_hop_dong_thang || '...') +
    ' n\u0103m ' + (values.ngay_lap_hop_dong_nam || '....');

  const secured = (finalData.secured_parties || []).map(cleanContractPerson_);
  const obligors = (finalData.obligors || []).map(cleanContractPerson_);
  const assets = (finalData.assets || []).map(cleanContractAsset_);
  const firstAsset = assets[0] || {};
  const re = firstAsset.real_estate || {};

  const securedNames = buildPersonNamesForContract_(secured);
  const obligorNames = buildPersonNamesForContract_(obligors);
  const firstObligor = obligors[0] || secured[0] || {};

  replaceLiteral_(body, '01/2026/9905438/H\u0110B\u0110', contractNo);
  replaceLiteral_(body, '01/2026/9905438/BB\u0110G ng\u00e0y .../06/2026', valuationNo + ' ng\u00e0y ' + buildShortContractDate_(values));
  replaceLiteral_(body, 'ng\u00e0y ... th\u00e1ng 06 n\u0103m 2026', contractDateText);
  replaceLiteral_(body, 'ng\u00e0y 12 th\u00e1ng 06 n\u0103m 2026', contractDateText);
  replaceLiteral_(body, 'ng\u00e0y 12/06/2026', 'ng\u00e0y ' + buildShortContractDate_(values));

  replaceLiteral_(body,
    '\u201cB\u00ean th\u1ebf ch\u1ea5p\u201d l\u00e0 \u00d4ng Ph\u1ea1m Ki\u00ean C\u01b0\u1eddng - B\u00e0 Nguy\u1ec5n Th\u1ecb Nh\u01b0 Hoa (v\u1edbi c\u00e1c th\u00f4ng tin n\u00eau t\u1ea1i ph\u1ea7n c\u00e1c b\u00ean tham gia H\u1ee3p \u0111\u1ed3ng \u1edf tr\u00ean)',
    '\u201cB\u00ean th\u1ebf ch\u1ea5p\u201d l\u00e0 ' + securedNames + ' (v\u1edbi c\u00e1c th\u00f4ng tin n\u00eau t\u1ea1i ph\u1ea7n c\u00e1c b\u00ean tham gia H\u1ee3p \u0111\u1ed3ng \u1edf tr\u00ean)');
  replaceLiteral_(body,
    '\u201cNg\u01b0\u1eddi c\u00f3 ngh\u0129a v\u1ee5 \u0111\u01b0\u1ee3c b\u1ea3o \u0111\u1ea3m\u201d l\u00e0 \u00d4ng Ph\u1ea1m Ki\u00ean C\u01b0\u1eddng (sinh ng\u00e0y 18/01/1973, CCCD s\u1ed1 017073005698 do CCS QLHCVTTXH c\u1ea5p ng\u00e0y 18/06/2023)',
    '\u201cNg\u01b0\u1eddi c\u00f3 ngh\u0129a v\u1ee5 \u0111\u01b0\u1ee3c b\u1ea3o \u0111\u1ea3m\u201d l\u00e0 ' + buildPeopleDefinitionText03b_(obligors));
  replaceLiteral_(body,
    'ngh\u0129a v\u1ee5 c\u1ee7a \u00d4ng Ph\u1ea1m Ki\u00ean C\u01b0\u1eddng tr\u00ean c\u01a1 s\u1edf',
    'ngh\u0129a v\u1ee5 c\u1ee7a ' + (obligorNames || '................................') + ' tr\u00ean c\u01a1 s\u1edf');

  applyTemplate03bSecuredPartyBlock_(body, secured);
  applyTemplate03bAssetBlock_(body, firstAsset);
  applyTemplate03bBankBlock_(body, values);
  applyTemplate03bValuationBlock_(body, values);
  applyMoneyWordsStyle03b_(body);
  normalizeJoinedPersonNamesInBody_(body, secured);
  boldContractPersonNames_(body, secured.concat(obligors));
  unboldTemplate03bReferencePhrase_(body);

  replaceLiteral_(body, 'T\u00f2a \u00e1n nh\u00e2n d\u00e2n khu v\u1ef1c 13 \u2013 Ph\u00fa Th\u1ecd', values.toa_an_tranh_chap || '');
  replaceLiteral_(body, 'H\u1ee3p \u0111\u1ed3ng n\u00e0y \u0111\u01b0\u1ee3c l\u1eadp th\u00e0nh 05 b\u1ea3n', 'H\u1ee3p \u0111\u1ed3ng n\u00e0y \u0111\u01b0\u1ee3c l\u1eadp th\u00e0nh ' + buildContractCopyCount_(finalData) + ' b\u1ea3n');
  replaceLiteral_(body, 'B\u00ean th\u1ebf ch\u1ea5p gi\u1eef 01 b\u1ea3n', 'B\u00ean th\u1ebf ch\u1ea5p gi\u1eef ' + String((finalData.assets || []).length || 1).padStart(2, '0') + ' b\u1ea3n');
  assertTemplate03bLinked_(body);
}

function assertTemplate03bLinked_(body) {
  const text = body.getText() || '';
  const leftovers = [];
  if (text.indexOf('9905438') >= 0) leftovers.push('so hop dong/CIF mau 9905438');
  if (text.indexOf('Ph\u1ea1m Ki\u00ean C\u01b0\u1eddng') >= 0) leftovers.push('ten mau Pham Kien Cuong');
  if (text.indexOf('Nguy\u1ec5n Th\u1ecb Nh\u01b0 Hoa') >= 0) leftovers.push('ten mau Nguyen Thi Nhu Hoa');
  if (leftovers.length) {
    throw new Error('Mau 03b chua duoc thay du lieu OCR tai cac vung: ' + leftovers.join(', ') + '. Can kiem tra lai template_doc_id hoac co che convert Word sang Google Docs.');
  }
}

function applyTemplate03bSecuredPartyBlock_(body, secured) {
  const samples = [
    {
      honorific: '\u00d4ng',
      name: 'Ph\u1ea1m Ki\u00ean C\u01b0\u1eddng',
      dob: '18/01/1973',
      id: '017073005698',
      issuePlace: 'CCS QLHCVTTXH',
      issueDate: '18/06/2023',
      address: 'SN 37, ng\u00f5 149, \u0111\u01b0\u1eddng Nguy\u1ec5n V\u0103n Linh, t\u1ed5 37, ph\u01b0\u1eddng H\u00e0 Giang 1, t\u1ec9nh Tuy\u00ean Quang'
    },
    {
      honorific: 'B\u00e0',
      name: 'Nguy\u1ec5n Th\u1ecb Nh\u01b0 Hoa',
      dob: '10/10/1976',
      id: '002176005039',
      issuePlace: 'CCS QLHCVTTXH',
      issueDate: '18/12/2021',
      address: 'T\u1ed5 2, t\u1ed5 d\u00e2n ph\u1ed1 T\u00e2n Mai, x\u00e3 Xu\u00e2n Mai, th\u00e0nh ph\u1ed1 H\u00e0 N\u1ed9i'
    }
  ];
  samples.forEach(function(sample, index) {
    const person = secured[index] || {};
    replaceNextLiteral_(body, 'CCCD s\u1ed1', buildIdDocumentLabelForContract_(person));
    replaceLiteral_(body, sample.name, toVietnameseTitleCase_(person.full_name || ''));
    replaceLiteral_(body, sample.dob, person.date_of_birth || '');
    replaceLiteral_(body,
      sample.id + ' do ' + sample.issuePlace + ' c\u1ea5p ng\u00e0y ' + sample.issueDate,
      buildPersonIdIssuePhrase_(person));
    replaceLiteral_(body, sample.address, person.current_address_final || person.permanent_address || '');
  });
}

function applyTemplate03bAssetBlock_(body, asset) {
  const re = asset.real_estate || {};
  const oldIntro = 'Quy\u1ec1n s\u1eed d\u1ee5ng \u0111\u1ea5t c\u1ee7a B\u00ean th\u1ebf ch\u1ea5p \u0111\u1ed1i v\u1edbi th\u1eeda \u0111\u1ea5t theo Gi\u1ea5y ch\u1ee9ng nh\u1eadn Quy\u1ec1n s\u1eed d\u1ee5ng \u0111\u1ea5t, quy\u1ec1n s\u1edf h\u1eefu t\u00e0i s\u1ea3n g\u1eafn li\u1ec1n v\u1edbi \u0111\u1ea5t s\u1ed1 AA04998919 (S\u1ed1 v\u00e0o s\u1ed5 c\u1ea5p GCN: CN8840) do Chi nh\u00e1nh v\u0103n ph\u00f2ng \u0111\u0103ng k\u00fd \u0111\u1ea5t \u0111ai L\u01b0\u01a1ng S\u01a1n c\u1ea5p ng\u00e0y 06/11/2025 , c\u1ee5 th\u1ec3 nh\u01b0 sau:';
  const newIntro = 'Quy\u1ec1n s\u1eed d\u1ee5ng \u0111\u1ea5t c\u1ee7a B\u00ean th\u1ebf ch\u1ea5p \u0111\u1ed1i v\u1edbi th\u1eeda \u0111\u1ea5t theo ' +
    (asset.certificate_title || 'Gi\u1ea5y ch\u1ee9ng nh\u1eadn') +
    ' s\u1ed1 ' + (re.certificate_number || '') +
    (re.registry_number ? ' (S\u1ed1 v\u00e0o s\u1ed5 c\u1ea5p GCN: ' + re.registry_number + ')' : '') +
    (re.issuing_authority ? ' do ' + normalizeIssuingAuthorityForContract_(re.issuing_authority) : '') +
    (re.issue_date ? ' c\u1ea5p ng\u00e0y ' + re.issue_date : '') +
    ', c\u1ee5 th\u1ec3 nh\u01b0 sau:';
  replaceLiteral_(body, oldIntro, newIntro);
  replaceLiteral_(body, 'Th\u1eeda \u0111\u1ea5t s\u1ed1: 353', 'Th\u1eeda \u0111\u1ea5t s\u1ed1: ' + (re.land_plot_number || ''));
  replaceLiteral_(body, 'T\u1edd b\u1ea3n \u0111\u1ed3 s\u1ed1: F-48-116(146-b-IV)', 'T\u1edd b\u1ea3n \u0111\u1ed3 s\u1ed1: ' + (re.map_sheet_number || ''));
  replaceLiteral_(body, '\u0110\u1ecba ch\u1ec9 th\u1eeda \u0111\u1ea5t: x\u00e3 L\u01b0\u01a1ng S\u01a1n, t\u1ec9nh Ph\u00fa Th\u1ecd', '\u0110\u1ecba ch\u1ec9 th\u1eeda \u0111\u1ea5t: ' + (re.land_address || ''));
  replaceLiteral_(body, 'Di\u1ec7n t\u00edch:  227,2 m2 (b\u1eb1ng ch\u1eef: Hai tr\u0103m hai m\u01b0\u01a1i b\u1ea3y ph\u1ea9y hai m\u00e9t vu\u00f4ng)', 'Di\u1ec7n t\u00edch: ' + formatAreaForContract_(re.area, re.area_in_words));
  replaceLiteral_(body, 'H\u00ecnh th\u1ee9c s\u1eed d\u1ee5ng: S\u1eed d\u1ee5ng chung c\u1ee7a v\u1ee3 v\u00e0 ch\u1ed3ng', 'H\u00ecnh th\u1ee9c s\u1eed d\u1ee5ng: ' + (re.usage_form || ''));
  replaceLiteral_(body, 'M\u1ee5c \u0111\u00edch s\u1eed d\u1ee5ng: \u0110\u1ea5t \u1edf t\u1ea1i n\u00f4ng th\u00f4n (ONT)', 'M\u1ee5c \u0111\u00edch s\u1eed d\u1ee5ng: ' + (re.usage_purpose || ''));
  replaceLiteral_(body, 'Th\u1eddi h\u1ea1n s\u1eed d\u1ee5ng: L\u00e2u d\u00e0i', 'Th\u1eddi h\u1ea1n s\u1eed d\u1ee5ng: ' + (re.usage_term || ''));
  replaceTemplate03bOptionalLiteral_(body, 'Ngu\u1ed3n g\u1ed1c s\u1eed d\u1ee5ng: Nh\u00e0 n\u01b0\u1edbc giao \u0111\u1ea5t c\u00f3 thu ti\u1ec1n s\u1eed d\u1ee5ng \u0111\u1ea5t', re.usage_origin ? 'Ngu\u1ed3n g\u1ed1c s\u1eed d\u1ee5ng: ' + re.usage_origin : '');
  applyTemplate03bPostIssueChangesBlock_(body, re.post_issue_changes);
  applyTemplate03bAttachedAssetBlock_(body, re.attached_assets);
  removeTemplate03bOptionalAssetLines_(body, re);
}

function applyTemplate03bBankBlock_(body, values) {
  replaceLiteral_(body, '- Ph\u00f2ng giao d\u1ecbch L\u01b0\u01a1ng S\u01a1n', buildBankUnitSuffixForTemplate03b_(values.don_vi_quan_ly_khach_hang || ''));
  replaceLiteral_(body, '\u0110\u01b0\u1eddng Tr\u1ea7n Ph\u00fa, x\u00e3 L\u01b0\u01a1ng S\u01a1n, t\u1ec9nh Ph\u00fa Th\u1ecd', values.dia_chi_don_vi_ngan_hang || '');
  replaceLiteral_(body, 'B\u00e0 V\u0169 Th\u1ecb T\u00e2m', values.nguoi_ky_ngan_hang || '');
  replaceLiteral_(body, 'Gi\u00e1m \u0111\u1ed1c Ph\u00f2ng giao d\u1ecbch L\u01b0\u01a1ng S\u01a1n', values.chuc_vu_nguoi_ky_ngan_hang || '');
}

function buildBankUnitSuffixForTemplate03b_(unit) {
  unit = cleanContractText_(unit).trim();
  const prefix = 'Chi nh\u00e1nh H\u00f2a B\u00ecnh - ';
  if (unit.indexOf(prefix) === 0) return '- ' + unit.slice(prefix.length);
  if (unit === 'Chi nh\u00e1nh H\u00f2a B\u00ecnh') return '';
  return unit;
}

function replaceTemplate03bOptionalLiteral_(body, oldText, newText) {
  if (newText) {
    replaceLiteral_(body, oldText, newText);
    return;
  }
  const range = body.findText(escapeRegex_(oldText));
  if (!range) return;
  const element = findParentTextBlockElement_(range.getElement());
  if (element && element.getParent && element.getParent()) {
    element.getParent().removeChild(element);
  } else {
    replaceLiteral_(body, oldText, '');
  }
}

function applyTemplate03bAttachedAssetBlock_(body, attachedAssets) {
  const heading = findTemplate03bAttachedAssetHeading_(body);
  removeTemplate03bSampleAttachedAssetDetails_(body);
  if (!heading) return;
  if (isBlankContractValue_(attachedAssets)) {
    setTemplate03bAttachedHeadingText_(heading, 'T\u00e0i s\u1ea3n g\u1eafn li\u1ec1n v\u1edbi \u0111\u1ea5t.', '2. T\u00e0i s\u1ea3n g\u1eafn li\u1ec1n v\u1edbi \u0111\u1ea5t.');
    return;
  }
  setTemplate03bAttachedHeadingText_(heading, 'T\u00e0i s\u1ea3n g\u1eafn li\u1ec1n v\u1edbi \u0111\u1ea5t l\u00e0:', '2. T\u00e0i s\u1ea3n g\u1eafn li\u1ec1n v\u1edbi \u0111\u1ea5t l\u00e0:');
  const parent = heading.getParent();
  let insertAt = parent.getChildIndex(heading) + 1;
  splitCertificateLinesForContract_(attachedAssets).forEach(function(line) {
    parent.insertParagraph(insertAt, line);
    insertAt++;
  });
}

function setTemplate03bAttachedHeadingText_(heading, listItemText, paragraphText) {
  if (heading.getType && heading.getType() === DocumentApp.ElementType.LIST_ITEM) {
    heading.setText(listItemText);
  } else {
    heading.setText(paragraphText);
  }
}

function applyTemplate03bPostIssueChangesBlock_(body, postIssueChanges) {
  removeTemplate03bNoteLines_(body);
  if (isBlankContractValue_(postIssueChanges)) return;
  const anchor = findTemplate03bUsageTermLine_(body);
  if (!anchor) return;
  const parent = anchor.getParent();
  parent.insertParagraph(parent.getChildIndex(anchor) + 1, '- Ghi ch\u00fa: ' + cleanContractText_(postIssueChanges));
}

function removeTemplate03bNoteLines_(body) {
  for (let i = body.getNumChildren() - 1; i >= 0; i--) {
    const child = body.getChild(i);
    if (!isTextBlockElement_(child)) continue;
    const compact = normalizeSearchTextForContract_(child.getText());
    if (compact.indexOf('ghi chu') === 0 || compact.indexOf('ghi chu ngay') === 0) {
      body.removeChild(child);
    }
  }
}

function findTemplate03bUsageTermLine_(body) {
  for (let i = 0; i < body.getNumChildren(); i++) {
    const child = body.getChild(i);
    if (!isTextBlockElement_(child)) continue;
    if (normalizeSearchTextForContract_(child.getText()).indexOf('thoi han su dung') === 0) return child;
  }
  return null;
}

function findTemplate03bAttachedAssetHeading_(body) {
  for (let i = 0; i < body.getNumChildren(); i++) {
    const child = body.getChild(i);
    if (!isTextBlockElement_(child)) continue;
    const compact = normalizeSearchTextForContract_(child.getText());
    if (compact === '2 tai san gan lien voi dat la' ||
        compact === 'tai san gan lien voi dat la' ||
        compact === '2 tai san gan lien voi dat' ||
        compact === 'tai san gan lien voi dat') {
      return child;
    }
  }
  return null;
}

function removeTemplate03bSampleAttachedAssetDetails_(body) {
  for (let i = body.getNumChildren() - 1; i >= 0; i--) {
    const child = body.getChild(i);
    if (!isTextBlockElement_(child)) continue;
    const compact = normalizeSearchTextForContract_(child.getText());
    const isSampleDetail =
      compact.indexOf('loai nha o nha o rieng le') === 0 ||
      compact.indexOf('dien tich xay dung 80 0 m2') === 0 ||
      compact.indexOf('dien tich san 80 0 m2') === 0 ||
      compact.indexOf('hinh thuc so huu so huu rieng') === 0 ||
      compact.indexOf('so tang 01') === 0;
    if (isSampleDetail) body.removeChild(child);
  }
}

function splitCertificateLinesForContract_(value) {
  return cleanContractText_(value)
    .split(/\r?\n|;\s*(?=(?:-?\s*)?(?:Lo\u1ea1i|Di\u1ec7n|K\u1ebft|C\u1ea5p|S\u1ed1|N\u0103m|T\u1ed5ng)\b)/)
    .map(function(line) { return line.replace(/\s+/g, ' ').trim(); })
    .filter(function(line) { return !isBlankContractValue_(line); });
}

function formatAreaForContract_(value, areaWords) {
  const text = cleanContractText_(value);
  if (!text) return '';
  let out = /\bm\s*2\b|m\u00b2/i.test(text) ? text : text + ' m2';
  const words = normalizeAreaWordsForContract_(areaWords);
  if (words && normalizeSearchTextForContract_(out).indexOf(normalizeSearchTextForContract_(words)) < 0) {
    out += ' (B\u1eb1ng ch\u1eef: ' + words + ')';
  }
  return out;
}

function normalizeAreaWordsForContract_(value) {
  const raw = cleanContractText_(value)
    .replace(/^\s*\(?\s*b\u1eb1ng\s+ch\u1eef\s*:?\s*/i, '')
    .replace(/\)\s*$/g, '')
    .trim();
  return isBlankContractValue_(raw) ? '' : raw;
}

function removeTemplate03bOptionalAssetLines_(body, realEstate) {
  const shouldRemoveNote = isBlankContractValue_(realEstate && realEstate.post_issue_changes);
  for (let i = body.getNumChildren() - 1; i >= 0; i--) {
    const child = body.getChild(i);
    if (!isTextBlockElement_(child)) continue;
    const text = child.getText() || '';
    const normalized = removeVietnameseAccents_(text).toLowerCase();
    const compact = normalized.replace(/\s+/g, ' ').trim();
    const isListItem = child.getType && child.getType() === DocumentApp.ElementType.LIST_ITEM;
    const removeEmptyBullet = (isListItem && compact === '') || compact === '-' || compact === '- :' || compact === '\u2013';
    const removeSource = compact.match(/^-?\s*nguon goc su dung\s*:?/);
    const removeNote = compact.match(/^-?\s*ghi chu\s*:?/) && shouldRemoveNote;
    if (removeEmptyBullet || removeSource || removeNote) {
      body.removeChild(child);
    }
  }
}

function isTextBlockElement_(element) {
  if (!element || !element.getType) return false;
  const type = element.getType();
  return type === DocumentApp.ElementType.PARAGRAPH || type === DocumentApp.ElementType.LIST_ITEM;
}

function findParentTextBlockElement_(element) {
  while (element && element.getType && !isTextBlockElement_(element)) {
    element = element.getParent();
  }
  return isTextBlockElement_(element) ? element : null;
}

function applyTemplate03bValuationBlock_(body, values) {
  const amount = cleanContractText_(values.gia_tri_dinh_gia);
  if (!amount) return;
  const words = numberToVietnameseCurrencyText_(amount);
  replaceLiteral_(body, ' 2.272.000.000 ,\u0111\u1ed3ng (b\u1eb1ng ch\u1eef: Hai t\u1ef7 hai tr\u0103m b\u1ea3y m\u01b0\u01a1i hai tri\u1ec7u \u0111\u1ed3ng ).', ' ' + formatMoneyForContract_(amount) + ' \u0111\u1ed3ng (b\u1eb1ng ch\u1eef: ' + words + ').');
}

function applyMoneyWordsStyle03b_(body) {
  const range = body.findText('\\(bằng chữ:[^)]+\\)');
  if (!range) return;
  const text = range.getElement().asText();
  text.setBold(range.getStartOffset(), range.getEndOffsetInclusive(), false);
  text.setItalic(range.getStartOffset(), range.getEndOffsetInclusive(), true);
}

function exportGoogleDocAs_(fileId, mimeType) {
  const url = 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId) +
    '/export?mimeType=' + encodeURIComponent(mimeType) + '&alt=media';
  const res = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() >= 300) {
    throw new Error('Export failed: ' + res.getContentText());
  }
  return res.getBlob();
}

function buildDriveDownloadUrl_(fileId) {
  return 'https://drive.google.com/uc?export=download&id=' + encodeURIComponent(fileId);
}

function buildContractPlaceholderMap_(finalData) {
  finalData = unwrapFinalValuesForContract_(finalData || {});
  const contract = finalData.contract_info || {};
  const secured = (finalData.secured_parties || []).map(cleanContractPerson_);
  const obligors = (finalData.obligors || []).map(cleanContractPerson_);
  const assets = (finalData.assets || []).map(cleanContractAsset_);
  const firstSecured = secured[0] || {};
  const firstObligor = obligors[0] || {};
  const firstAsset = assets[0] || {};
  const re = firstAsset.real_estate || {};
  const mv = firstAsset.movable || {};
  const contractDateParts = parseContractDateInput_(contract.contract_date);
  const valuationTotal = calculateValuationTotalForContract_(contract);
  const bankSigner = resolveBankSignerForContract_(contract.bank_signer);
  const disputeCourt = resolveDisputeCourtForContract_(contract.dispute_court);

  const map = {
    case_id: finalData.case_id || '',
    ngay_hom_nay: formatDateVi_(new Date()),
    ngay_lap_hop_dong: contractDateParts.full || formatDateVi_(new Date()),
    ngay_lap_hop_dong_ngay: contractDateParts.day,
    ngay_lap_hop_dong_thang: contractDateParts.month,
    ngay_lap_hop_dong_nam: contractDateParts.year,
    so_thu_tu_hop_dong: formatContractSequence_(contract.contract_sequence),
    cif_khach_hang: cleanContractText_(contract.cif_customer),
    loai_hop_dong: cleanContractText_(contract.contract_type),
    loai_tai_san: normalizeAssetTypeForContract_(cleanContractText_(contract.asset_type) || cleanContractText_(firstAsset.asset_type)),
    gia_tri_dinh_gia_dat: cleanContractText_(contract.valuation_land_amount),
    gia_tri_dinh_gia_nha: cleanContractText_(contract.valuation_house_amount),
    gia_tri_dinh_gia: valuationTotal || cleanContractText_(contract.valuation_amount),
    tong_gia_tri_tai_san: valuationTotal || cleanContractText_(contract.valuation_amount),
    nguoi_ky_ngan_hang: bankSigner.name,
    chuc_vu_nguoi_ky_ngan_hang: cleanContractText_(contract.bank_signer_title) || bankSigner.title,
    don_vi_quan_ly_khach_hang: bankSigner.unit,
    dia_chi_don_vi_ngan_hang: cleanContractText_(contract.bank_unit_address) || bankSigner.address,
    van_ban_uy_quyen_ngan_hang: bankSigner.authorization,
    toa_an_tranh_chap: disputeCourt,
    tai_san_la_nha_thuc_te: cleanContractText_(contract.actual_house_asset),
    tai_san_thuc_te_khac_bia: cleanContractText_(contract.actual_asset_differs_from_certificate),
    mo_ta_tai_san_thuc_te_khac_bia: cleanContractText_(contract.actual_asset_difference_description) || cleanContractText_(contract.actual_house_asset),
    can_lap_mau_5: cleanContractText_(contract.requires_template_5),
    ly_do_can_lap_mau_5: cleanContractText_(contract.reason_requires_template_5),
    ma_mau_4_du_kien: cleanContractText_(contract.template_4_code),
    ma_mau_5_du_kien: cleanContractText_(contract.template_5_code),

    ben_bao_dam_text: buildPeopleLegalText_(secured),
    ben_duoc_bao_dam_text: buildPeopleLegalText_(obligors),
    ben_bao_dam_danh_sach_ten: buildPersonNamesForContract_(secured),
    ben_duoc_bao_dam_danh_sach_ten: buildPersonNamesForContract_(obligors),

    ben_bao_dam_1_ho_ten: firstSecured.full_name || '',
    ben_bao_dam_1_ngay_sinh: firstSecured.date_of_birth || '',
    ben_bao_dam_1_loai_giay_to: firstSecured.id_document_type || '',
    ben_bao_dam_1_so_giay_to: firstSecured.id_number || '',
    ben_bao_dam_1_ngay_cap: firstSecured.id_issue_date || '',
    ben_bao_dam_1_noi_cap: firstSecured.id_issue_place || '',
    ben_bao_dam_1_dia_chi: firstSecured.current_address_final || firstSecured.permanent_address || '',

    ben_duoc_bao_dam_1_ho_ten: firstObligor.full_name || '',
    ben_duoc_bao_dam_1_ngay_sinh: firstObligor.date_of_birth || '',
    ben_duoc_bao_dam_1_loai_giay_to: firstObligor.id_document_type || '',
    ben_duoc_bao_dam_1_so_giay_to: firstObligor.id_number || '',
    ben_duoc_bao_dam_1_ngay_cap: firstObligor.id_issue_date || '',
    ben_duoc_bao_dam_1_noi_cap: firstObligor.id_issue_place || '',
    ben_duoc_bao_dam_1_dia_chi: firstObligor.current_address_final || firstObligor.permanent_address || '',

    tai_san_text: buildAssetsLegalText_(assets),
    tai_san_1_loai: firstAsset.asset_type || '',
    tai_san_1_chu_so_huu: firstAsset.owner_identity_summary || firstAsset.owner_name || '',
    tai_san_1_ten_gcn: firstAsset.certificate_title || '',
    tai_san_1_so_gcn: re.certificate_number || '',
    tai_san_1_so_vao_so: re.registry_number || '',
    tai_san_1_co_quan_cap: re.issuing_authority || '',
    tai_san_1_ngay_cap: re.issue_date || '',
    tai_san_1_so_thua: re.land_plot_number || '',
    tai_san_1_to_ban_do: re.map_sheet_number || '',
    tai_san_1_dia_chi: re.land_address || '',
    tai_san_1_dien_tich: formatAreaForContract_(re.area, re.area_in_words),
    tai_san_1_dien_tich_bang_chu: re.area_in_words || '',
    tai_san_1_hinh_thuc_su_dung: re.usage_form || '',
    tai_san_1_muc_dich_su_dung: re.usage_purpose || '',
    tai_san_1_thoi_han_su_dung: re.usage_term || '',
    tai_san_1_nguon_goc_su_dung: re.usage_origin || '',
    tai_san_1_tai_san_gan_lien: re.attached_assets || '',
    tai_san_1_thay_doi_sau_cap: re.post_issue_changes || '',

    dong_san_1_loai: mv.asset_category || firstAsset.asset_type || '',
    dong_san_1_nhan_hieu: mv.brand || '',
    dong_san_1_so_loai: mv.model_code || '',
    dong_san_1_bien_so: mv.license_plate || '',
    dong_san_1_so_khung: mv.chassis_number || '',
    dong_san_1_so_may: mv.engine_number || '',
    dong_san_1_nam_san_xuat: mv.manufacture_year || '',
    dong_san_1_nuoc_san_xuat: mv.manufacture_country || '',
    dong_san_1_chu_so_huu: mv.owner || firstAsset.owner_name || '',
    dong_san_1_so_dang_ky: mv.registration_number || '',
    dong_san_1_ngay_cap: mv.issue_date || '',
    dong_san_1_co_quan_cap: mv.issuing_authority || ''
  };

  secured.forEach(function(p, i) {
    addPersonPlaceholders_(map, 'ben_bao_dam_' + (i + 1), p);
  });
  obligors.forEach(function(p, i) {
    addPersonPlaceholders_(map, 'ben_duoc_bao_dam_' + (i + 1), p);
  });
  assets.forEach(function(asset, i) {
    addAssetPlaceholders_(map, 'tai_san_' + (i + 1), asset);
  });
  addExcelCompatibilityPlaceholders_(map, finalData);
  normalizeContractMapValues_(map);
  return map;
}

function unwrapFinalValuesForContract_(value) {
  if (Array.isArray(value)) {
    return value.map(function(item) { return unwrapFinalValuesForContract_(item); });
  }
  if (value && typeof value === 'object') {
    if (Object.prototype.hasOwnProperty.call(value, 'final_value')) {
      return unwrapFinalValuesForContract_(value.final_value);
    }
    const out = {};
    Object.keys(value).forEach(function(key) {
      out[key] = unwrapFinalValuesForContract_(value[key]);
    });
    return out;
  }
  return value;
}

function cleanContractText_(value) {
  if (value == null) return '';
  if (Array.isArray(value)) {
    return value.map(cleanContractText_).filter(Boolean).join('; ');
  }
  if (typeof value === 'object') {
    if (Object.prototype.hasOwnProperty.call(value, 'final_value')) return cleanContractText_(value.final_value);
    if (Object.prototype.hasOwnProperty.call(value, 'value')) return cleanContractText_(value.value);
    return Object.keys(value).map(function(key) {
      const item = cleanContractText_(value[key]);
      return item ? item : '';
    }).filter(Boolean).join('; ');
  }
  return String(value);
}

function isBlankContractValue_(value) {
  const raw = cleanContractText_(value).replace(/\s+/g, ' ').trim();
  if (!raw) return true;
  const text = normalizeSearchTextForContract_(raw);
  return text === '' ||
    raw === '-' ||
    text === 'khong ro' ||
    text.indexOf('de nghi sua thu cong') >= 0 ||
    text.indexOf('khong co') >= 0 ||
    text.indexOf('khong ghi nhan') >= 0 ||
    text.indexOf('khong thay doi') >= 0;
}

function fillMissingPersonIssueDatesFromReviewOcr_(reviewJson, caseId) {
  const textByGroup = {};
  (reviewJson.ocr_results || []).forEach(function(item) {
    if (!item || !item.group) return;
    textByGroup[item.group] = textByGroup[item.group] || [];
    textByGroup[item.group].push({
      file_name: item.file_name || '',
      text: item.text_preview || ''
    });
  });
  appendFullOcrTextForIssueDateFallback_(textByGroup, caseId);
  const allPersonOcrItems = []
    .concat(textByGroup.secured_party || [])
    .concat(textByGroup.obligor || []);
  fillMissingIssueDatesForPeople_(reviewJson.secured_parties || [], textByGroup.secured_party || [], allPersonOcrItems);
  fillMissingIssueDatesForPeople_(reviewJson.obligors || [], textByGroup.obligor || [], allPersonOcrItems);
}

function appendFullOcrTextForIssueDateFallback_(textByGroup, caseId) {
  if (!caseId) return;
  try {
    const rows = getRowsByCaseId_(SHEETS.OCR_RESULTS, caseId);
    rows.forEach(function(row) {
      const group = normalizeOcrGroupForContract_(row['File Name'] || '');
      if (!group) return;
      textByGroup[group] = textByGroup[group] || [];
      textByGroup[group].push({
        file_name: row['File Name'] || '',
        text: row['OCR Text'] || ''
      });
    });
  } catch (err) {
    console.warn('Cannot read full OCR text for issue date fallback: ' + err);
  }
}

function normalizeOcrGroupForContract_(fileName) {
  const name = String(fileName || '');
  if (name.indexOf('secured_party__') === 0) return 'secured_party';
  if (name.indexOf('obligor__') === 0) return 'obligor';
  return '';
}

function fillMissingIssueDatesForPeople_(people, ocrItems, allOcrItems) {
  allOcrItems = allOcrItems || [];
  (people || []).forEach(function(person, index) {
    if (!person) return;
    if (!person.id_issue_date || typeof person.id_issue_date !== 'object' || !person.id_issue_date.hasOwnProperty('final_value')) {
      person.id_issue_date = makeField('Ng\u00e0y c\u1ea5p', '', '', '', 'OCR', '');
    }
    if (cleanContractText_(person.id_issue_date.manual_value)) return;
    const id = normalizeDigitsForContract_(getReviewFieldValueForContract_(person.id_number));
    const documentType = getReviewFieldValueForContract_(person.id_document_type);
    const currentIssueDate = getReviewFieldValueForContract_(person.id_issue_date);
    if (currentIssueDate && id) {
      const verifiedIssueDate = findIssueDateForContractPerson_(id, documentType, ocrItems, allOcrItems);
      if (verifiedIssueDate && verifiedIssueDate !== currentIssueDate) {
        person.id_issue_date.ai_value = verifiedIssueDate;
        person.id_issue_date.final_value = verifiedIssueDate;
        person.id_issue_date.source = person.id_issue_date.source || 'OCR_ID_MATCH_CORRECTED';
        person.id_issue_date.confidence = person.id_issue_date.confidence || 0.9;
      } else if (!verifiedIssueDate && hasIdentityBackSideOcrForContractId_(id, ocrItems.concat(allOcrItems))) {
        person.id_issue_date.ai_value = '';
        person.id_issue_date.final_value = '';
        person.id_issue_date.source = person.id_issue_date.source || 'OCR_DATE_UNREADABLE';
        person.id_issue_date.confidence = '';
      }
      return;
    }
    if (id) {
      for (let i = 0; i < ocrItems.length; i++) {
        const text = ocrItems[i].text || '';
        if (!contractOcrContainsIdentityId_(text, id)) continue;
        const issueDate = extractIssueDateFromContractOcrText_(text, documentType) ||
          extractIssueDateFromContractOcrText_(ocrItems[i + 1] && ocrItems[i + 1].text, documentType) ||
          extractIssueDateFromContractOcrText_(ocrItems[i - 1] && ocrItems[i - 1].text, documentType);
        if (issueDate) {
          person.id_issue_date.ai_value = issueDate;
          person.id_issue_date.final_value = issueDate;
          person.id_issue_date.source = ocrItems[i].file_name || person.id_issue_date.source || 'OCR_ADJACENT_ID_CARD_SIDE';
          person.id_issue_date.confidence = person.id_issue_date.confidence || 0.78;
          return;
        }
      }
    }
    if (id && allOcrItems.length) {
      for (let k = 0; k < allOcrItems.length; k++) {
        const allText = allOcrItems[k].text || '';
        if (!contractOcrContainsIdentityId_(allText, id)) continue;
        const issueDateFromCaseOcr = extractIssueDateFromContractOcrText_(allText, documentType) ||
          extractIssueDateFromContractOcrText_(allOcrItems[k + 1] && allOcrItems[k + 1].text, documentType) ||
          extractIssueDateFromContractOcrText_(allOcrItems[k - 1] && allOcrItems[k - 1].text, documentType);
        if (issueDateFromCaseOcr) {
          person.id_issue_date.ai_value = issueDateFromCaseOcr;
          person.id_issue_date.final_value = issueDateFromCaseOcr;
          person.id_issue_date.source = allOcrItems[k].file_name || person.id_issue_date.source || 'OCR_CASE_ID_MATCH';
          person.id_issue_date.confidence = person.id_issue_date.confidence || 0.76;
          return;
        }
      }
    }
    const positionalText = (ocrItems[index] && ocrItems[index].text) || '';
    const positionalIssueDate = extractIssueDateFromContractOcrText_(positionalText, getReviewFieldValueForContract_(person.id_document_type));
    if (positionalIssueDate) {
      person.id_issue_date.ai_value = positionalIssueDate;
      person.id_issue_date.final_value = positionalIssueDate;
      person.id_issue_date.source = ocrItems[index].file_name || person.id_issue_date.source || 'OCR_POSITIONAL';
      person.id_issue_date.confidence = person.id_issue_date.confidence || 0.72;
      return;
    }
    const allIssueDates = [];
    for (let j = 0; j < ocrItems.length; j++) {
      const fallbackIssueDate = extractIssueDateFromContractOcrText_(ocrItems[j].text || '', getReviewFieldValueForContract_(person.id_document_type));
      if (fallbackIssueDate && allIssueDates.indexOf(fallbackIssueDate) === -1) allIssueDates.push(fallbackIssueDate);
    }
    if (allIssueDates.length === 1) {
      person.id_issue_date.ai_value = allIssueDates[0];
      person.id_issue_date.final_value = allIssueDates[0];
      person.id_issue_date.source = person.id_issue_date.source || 'OCR_GROUP_SINGLE_ISSUE_DATE';
      person.id_issue_date.confidence = person.id_issue_date.confidence || 0.68;
    }
  });
}

function getReviewFieldValueForContract_(field) {
  if (!field) return '';
  if (typeof field === 'object' && Object.prototype.hasOwnProperty.call(field, 'final_value')) return field.final_value || field.ai_value || '';
  return field || '';
}

function normalizeDigitsForContract_(value) {
  return String(value || '').replace(/\D/g, '');
}

function findIssueDateForContractPerson_(id, documentType, ocrItems, allOcrItems) {
  const pools = [ocrItems || [], allOcrItems || []];
  for (let p = 0; p < pools.length; p++) {
    for (let i = 0; i < pools[p].length; i++) {
      const text = pools[p][i].text || '';
      if (!contractOcrContainsIdentityId_(text, id)) continue;
      const issueDate = extractIssueDateFromContractOcrText_(text, documentType) ||
        extractIssueDateFromContractOcrText_(pools[p][i + 1] && pools[p][i + 1].text, documentType) ||
        extractIssueDateFromContractOcrText_(pools[p][i - 1] && pools[p][i - 1].text, documentType);
      if (issueDate) return issueDate;
    }
  }
  return '';
}

function hasIdentityBackSideOcrForContractId_(id, ocrItems) {
  for (let i = 0; i < (ocrItems || []).length; i++) {
    const text = ocrItems[i].text || '';
    if (contractOcrContainsIdentityId_(text, id) && isLikelyBackSideIdentityOcrForContract_(text)) return true;
  }
  return false;
}

function contractOcrContainsIdentityId_(text, id) {
  id = normalizeDigitsForContract_(id);
  if (!id) return false;
  const ids = extractCccdNumbersFromMrzForContract_(text);
  if (ids.indexOf(id) >= 0) return true;
  return normalizeDigitsForContract_(text).indexOf(id) >= 0;
}

function extractCccdNumbersFromMrzForContract_(text) {
  const out = [];
  String(text || '').split(/\r?\n/).forEach(function(line) {
    if (!/IDVNM/i.test(line)) return;
    const afterPrefix = line.replace(/^.*?IDVNM/i, '');
    const mrzDigits = afterPrefix
      .replace(/[oO]/g, '0')
      .replace(/[iIlL]/g, '1')
      .replace(/[^0-9]/g, '');
    if (mrzDigits.length >= 22) {
      const id = mrzDigits.slice(10, 22);
      if (isLikelyContractIdentityId_(id) && out.indexOf(id) === -1) out.push(id);
    } else if (mrzDigits.length >= 12) {
      const tailId = mrzDigits.slice(-12);
      if (isLikelyContractIdentityId_(tailId) && out.indexOf(tailId) === -1) out.push(tailId);
    }
  });
  return out;
}

function isLikelyContractIdentityId_(value) {
  return /^(\d{9}|\d{12})$/.test(String(value || '')) && !/^0+$/.test(value) && !/^1+$/.test(value);
}

function extractIssueDateFromContractOcrText_(text, documentType) {
  text = String(text || '');
  const normalized = removeVietnameseAccents_(text).toLowerCase();
  const flexibleLabelDate = extractFlexibleIssueDateNearLabelsForContract_(text, normalized);
  if (flexibleLabelDate) return flexibleLabelDate;
  const patterns = [
    /(?:ng\u00e0y\s*,?\s*th\u00e1ng\s*,?\s*n\u0103m\s*c\u1ea5p|date\s*of\s*issue)\D{0,40}(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})/i,
    /(?:ng\u00e0y\s*,?\s*th\u00e1ng\s*,?\s*n\u0103m|date\s*,?\s*month\s*,?\s*year)\D{0,40}(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})/i,
    /(?:age\s*\/?\s*date\s*month\s*year)\D{0,40}(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})/i,
    /(?:ng\u00e0y\s*c\u1ea5p|c\u1ea5p\s*ng\u00e0y)\D{0,30}(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})/i,
    /(?:ngày\s*cấp|ngay\s*cap|date\s*of\s*issue)\D{0,30}(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})/i,
    /(?:cấp\s*ngày|cap\s*ngay)\D{0,30}(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})/i
  ];
  for (let i = 0; i < patterns.length; i++) {
    const match = text.match(patterns[i]);
    if (match) return normalizeContractDateValue_(match[1]);
  }
  const issueLabels = ['date of issue', 'ngay cap', 'cap ngay', 'ngay thang nam cap', 'ngay thang nam'];
  let idx = -1;
  for (let l = 0; l < issueLabels.length; l++) {
    const found = normalized.indexOf(issueLabels[l]);
    if (found >= 0 && (idx < 0 || found < idx)) idx = found;
  }
  if (idx >= 0) {
    const date = text.slice(idx, idx + 100).match(/(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})/);
    if (date) return normalizeContractDateValue_(date[1]);
  }
  const docText = removeVietnameseAccents_(String(documentType || '')).toLowerCase();
  const isOldCccd = docText.indexOf('can cuoc cong dan') >= 0 || /\bcccd\b/.test(docText);
  if (isOldCccd && isLikelyBackSideIdentityOcrForContract_(text)) {
    const dates = extractAllDatesFromContractOcr_(text);
    if (dates.length === 1) return normalizeContractDateValue_(dates[0]);
  }
  return '';
}

function extractFlexibleIssueDateNearLabelsForContract_(text, normalizedText) {
  const normalized = normalizedText || removeVietnameseAccents_(String(text || '')).toLowerCase();
  const labels = ['date of issue', 'ngay cap', 'cap ngay', 'ngay thang nam cap', 'ngay thang nam', 'date month year'];
  let idx = -1;
  for (let i = 0; i < labels.length; i++) {
    const found = normalized.indexOf(labels[i]);
    if (found >= 0 && (idx < 0 || found < idx)) idx = found;
  }
  if (idx < 0) return '';
  const windowText = String(text || '').slice(Math.max(0, idx - 10), idx + 140);
  const match = windowText.match(/(\d{1,2})\D{1,8}(\d{1,2})\D{1,10}(\d{4})/);
  if (!match) return '';
  return normalizeContractDateValue_(match[1] + '/' + match[2] + '/' + match[3]);
}

function isLikelyBackSideIdentityOcrForContract_(text) {
  const normalized = removeVietnameseAccents_(String(text || '')).toLowerCase();
  return normalized.indexOf('idvnm') >= 0 ||
    normalized.indexOf('ngay cap') >= 0 ||
    normalized.indexOf('ngay thang nam') >= 0 ||
    normalized.indexOf('date of issue') >= 0 ||
    normalized.indexOf('noi cu tru') >= 0 ||
    normalized.indexOf('dac diem nhan dang') >= 0 ||
    /<{3,}/.test(normalized);
}

function extractAllDatesFromContractOcr_(text) {
  const out = [];
  String(text || '').replace(/(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})/g, function(match, date) {
    if (out.indexOf(date) === -1) out.push(date);
    return match;
  });
  return out;
}

function normalizeContractDateValue_(value) {
  value = String(value || '').trim();
  let match = value.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/);
  if (match) return String(match[3]).padStart(2, '0') + '/' + String(match[2]).padStart(2, '0') + '/' + match[1];
  match = value.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})$/);
  if (match) return String(match[1]).padStart(2, '0') + '/' + String(match[2]).padStart(2, '0') + '/' + (match[3].length === 2 ? '20' + match[3] : match[3]);
  return value;
}

function joinVietnameseList_(items) {
  items = (items || []).filter(Boolean);
  if (!items.length) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return items[0] + ' v\u00e0 ' + items[1];
  return items.slice(0, -1).join(', ') + ' v\u00e0 ' + items[items.length - 1];
}

function normalizeAssetTypeForContract_(value) {
  const raw = cleanContractText_(value);
  const text = normalizeSearchTextForContract_(raw);
  if (text.indexOf('real estate') >= 0 || text.indexOf('bat dong san') >= 0) return 'B\u1ea5t \u0111\u1ed9ng s\u1ea3n';
  if (text.indexOf('movable') >= 0 || text.indexOf('dong san') >= 0) return '\u0110\u1ed9ng s\u1ea3n';
  return raw;
}

function normalizeIdDocumentTypeForContract_(value) {
  const raw = cleanContractText_(value);
  const text = removeVietnameseAccents_(raw).toLowerCase();
  if (text.indexOf('chung minh') >= 0 || /\bcmnd\b/.test(text)) return 'Ch\u1ee9ng minh nh\u00e2n d\u00e2n';
  if (text.indexOf('can cuoc cong dan') >= 0 || /\bcccd\b/.test(text)) return 'C\u0103n c\u01b0\u1edbc c\u00f4ng d\u00e2n';
  if (text.indexOf('can cuoc') >= 0) return 'C\u0103n c\u01b0\u1edbc';
  return raw || 'C\u0103n c\u01b0\u1edbc c\u00f4ng d\u00e2n';
}

function buildIdDocumentLabelForContract_(person) {
  return normalizeIdDocumentTypeForContract_(person && person.id_document_type) + ' s\u1ed1';
}

function normalizeIdIssuePlaceForContract_(value) {
  const raw = cleanContractText_(value);
  const text = removeVietnameseAccents_(raw).toLowerCase();
  if (text.indexOf('bo cong an') >= 0 || text.indexOf('ministry of public security') >= 0) return 'B\u1ed9 C\u00f4ng an';
  if (text.indexOf('canh sat quan ly hanh chinh') >= 0 || text.indexOf('qlhcvttxh') >= 0) {
    return 'C\u1ee5c C\u1ea3nh s\u00e1t qu\u1ea3n l\u00fd h\u00e0nh ch\u00ednh v\u1ec1 tr\u1eadt t\u1ef1 x\u00e3 h\u1ed9i';
  }
  return raw;
}

function defaultIssuePlaceForIdDocument_(documentType, idNumber) {
  if (!cleanContractText_(idNumber)) return '';
  const text = removeVietnameseAccents_(cleanContractText_(documentType)).toLowerCase();
  if (text.indexOf('can cuoc cong dan') >= 0 || /\bcccd\b/.test(text)) {
    return 'C\u1ee5c C\u1ea3nh s\u00e1t qu\u1ea3n l\u00fd h\u00e0nh ch\u00ednh v\u1ec1 tr\u1eadt t\u1ef1 x\u00e3 h\u1ed9i';
  }
  if (text.indexOf('can cuoc') >= 0) return 'B\u1ed9 C\u00f4ng an';
  return '';
}

function normalizeIssuingAuthorityForContract_(value) {
  const raw = cleanContractText_(value)
    .replace(/^\s*(?:TM|T\/M|THAY\s+M\u1eb6T)\.?\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!raw) return '';
  const lowerWords = {
    'CHI': 'Chi', 'NHANH': 'nh\u00e1nh', 'VAN': 'v\u0103n', 'PHONG': 'ph\u00f2ng',
    'DANG': '\u0111\u0103ng', 'KY': 'k\u00fd', 'DAT': '\u0111\u1ea5t', 'DAI': '\u0111ai',
    'HUYEN': 'huy\u1ec7n', 'THANH': 'th\u00e0nh', 'PHO': 'ph\u1ed1', 'TINH': 't\u1ec9nh',
    'XA': 'x\u00e3', 'PHUONG': 'ph\u01b0\u1eddng', 'QUAN': 'qu\u1eadn'
  };
  const keepTitle = {};
  raw.split(/\s+/).forEach(function(word) {
    const ascii = removeVietnameseAccents_(word).toUpperCase();
    if (!lowerWords[ascii] && word === word.toUpperCase() && word.length > 1) keepTitle[ascii] = titleCaseVietnameseWord_(word);
  });
  return raw.split(/\s+/).map(function(word, index) {
    const ascii = removeVietnameseAccents_(word).toUpperCase();
    if (index === 0) return titleCaseVietnameseWord_(word);
    if (keepTitle[ascii]) return keepTitle[ascii];
    return lowerWords[ascii] || word.toLowerCase();
  }).join(' ')
    .replace(/huy\u1ec7n l\u01b0\u01a1ng s\u01a1n/gi, 'huy\u1ec7n L\u01b0\u01a1ng S\u01a1n')
    .replace(/t\u1ec9nh ph\u00fa th\u1ecd/gi, 't\u1ec9nh Ph\u00fa Th\u1ecd')
    .replace(/x\u00e3 l\u01b0\u01a1ng s\u01a1n/gi, 'x\u00e3 L\u01b0\u01a1ng S\u01a1n');
}

function titleCaseVietnameseWord_(word) {
  word = String(word || '').toLowerCase();
  return word ? word.charAt(0).toUpperCase() + word.slice(1) : '';
}

function normalizeCertificateNumberForContract_(certificateNumber, registryNumber) {
  const cert = normalizeCertificateCodeForContract_(certificateNumber);
  const registry = normalizeCertificateCodeForContract_(registryNumber);
  if (!cert) return '';
  if (registry && removeVietnameseAccents_(cert).toUpperCase() === removeVietnameseAccents_(registry).toUpperCase()) return '';
  if (/^CN\s*\d/i.test(cert)) return '';
  return cert;
}

function normalizeCertificateCodeForContract_(value) {
  return cleanContractText_(value).replace(/\s+/g, '').trim();
}

function normalizePostIssueChangesForContract_(value) {
  const raw = cleanContractText_(value).trim();
  const text = normalizeSearchTextForContract_(raw);
  if (isBlankContractValue_(raw)) return '';
  if (text.indexOf('khong ghi nhan') >= 0 || text.indexOf('khong thay doi') >= 0 || text === '-') return '';
  const lines = raw.split(/\r?\n|;\s*/).map(function(line) {
    return cleanContractText_(line).replace(/\s+/g, ' ').trim();
  }).filter(Boolean);
  const meaningful = lines.filter(function(line) {
    const compact = normalizeSearchTextForContract_(line);
    if (!compact) return false;
    if (compact.indexOf('iv nhung thay doi sau khi cap giay chung nhan') === 0) return false;
    if (compact.indexOf('noi dung thay doi va co so phap ly') === 0) return false;
    if (compact.indexOf('xac nhan cua co quan co tham quyen') === 0) return false;
    if (compact.indexOf('so vao so cap gcn') === 0) return false;
    if (/^(ha dong|ngay|tm uy ban|kt chu tich|pho chu tich|chu tich)\b/.test(compact)) return false;
    if (/^(ty le|dan|quan|ha|ong nguyen|nguyen truong son|13 42|13 11|230|88 7)$/.test(compact)) return false;
    return true;
  });
  return meaningful.length ? meaningful.join('; ') : '';
}

function normalizeAttachedAssetsForContract_(value) {
  const raw = cleanContractText_(value).trim();
  if (isBlankContractValue_(raw)) return '';
  const normalized = normalizeSearchTextForContract_(raw);
  const withoutUncertified = normalized
    .replace(/\b\d+\s*/g, ' ')
    .replace(/\b(nha o|cong trinh xay dung khac|rung san xuat la rung trong|cay lau nam|tai san gan lien voi dat)\b/g, ' ')
    .replace(/\bchua chung nhan quyen so huu\b/g, ' ')
    .replace(/\bchua chung nhan\b/g, ' ')
    .replace(/\bkhong co\b/g, ' ')
    .replace(/\bde trong\b/g, ' ')
    .replace(/\b-\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!withoutUncertified) return '';
  return raw;
}

function resolveDisputeCourtForContract_(value) {
  const raw = cleanContractText_(value);
  const text = normalizeSearchTextForContract_(raw);
  if (text.indexOf('13') >= 0 || text.indexOf('b') >= 0) return 'T\u00f2a \u00e1n nh\u00e2n d\u00e2n khu v\u1ef1c 13 - Ph\u00fa Th\u1ecd';
  if (text.indexOf('12') >= 0 || text.indexOf('a') >= 0) return 'T\u00f2a \u00e1n nh\u00e2n d\u00e2n khu v\u1ef1c 12 - Ph\u00fa Th\u1ecd';
  return raw;
}

function resolveBankSignerForContract_(value) {
  const raw = cleanContractText_(value);
  const text = normalizeSearchTextForContract_(raw);
  const profiles = getBankSignerProfilesForContract_();
  const legacy = {
    'ong a': 'luong quang minh',
    'ong b': 'le phi long',
    'ong c': 'bui tu cuong',
    'ba d': 'vu thi tam'
  };
  const target = legacy[text] || text;
  const found = profiles.filter(function(profile) {
    return normalizeSearchTextForContract_(profile.name) === target ||
      target.indexOf(normalizeSearchTextForContract_(profile.name)) >= 0;
  })[0];
  return found || { name: raw, title: '', unit: '', address: '', authorization: '' };
}

function getBankSignerProfilesForContract_() {
  const branchAddress = '\u0110\u01b0\u1eddng L\u00ea Th\u00e1nh T\u00f4ng, ph\u01b0\u1eddng H\u00f2a B\u00ecnh, t\u1ec9nh Ph\u00fa Th\u1ecd';
  const authorization = '299/Q\u0110-BIDV.HB ng\u00e0y 01/04/2026 c\u1ee7a Gi\u00e1m \u0111\u1ed1c BIDV H\u00f2a B\u00ecnh';
  return [
    { name: 'L\u01b0\u01a1ng Quang Minh', title: 'Gi\u00e1m \u0111\u1ed1c', unit: 'Chi nh\u00e1nh H\u00f2a B\u00ecnh', address: branchAddress, authorization: authorization },
    { name: 'L\u00ea Phi Long', title: 'Ph\u00f3 Gi\u00e1m \u0111\u1ed1c', unit: 'Chi nh\u00e1nh H\u00f2a B\u00ecnh', address: branchAddress, authorization: authorization },
    { name: '\u0110inh Th\u1ecb Loan', title: 'Ph\u00f3 Gi\u00e1m \u0111\u1ed1c', unit: 'Chi nh\u00e1nh H\u00f2a B\u00ecnh', address: branchAddress, authorization: authorization },
    { name: 'B\u00f9i T\u1ef1 C\u01b0\u1eddng', title: 'Ph\u00f3 Gi\u00e1m \u0111\u1ed1c', unit: 'Chi nh\u00e1nh H\u00f2a B\u00ecnh', address: branchAddress, authorization: authorization },
    { name: 'V\u0169 Th\u1ecb T\u00e2m', title: 'Gi\u00e1m \u0111\u1ed1c Ph\u00f2ng giao d\u1ecbch L\u01b0\u01a1ng S\u01a1n', unit: 'Chi nh\u00e1nh H\u00f2a B\u00ecnh - Ph\u00f2ng giao d\u1ecbch L\u01b0\u01a1ng S\u01a1n', address: '\u0110\u01b0\u1eddng Tr\u1ea7n Ph\u00fa, x\u00e3 L\u01b0\u01a1ng S\u01a1n, t\u1ec9nh Ph\u00fa Th\u1ecd', authorization: authorization },
    { name: 'Nguy\u1ec5n Th\u1ecb Thu H\u01b0\u01a1ng', title: 'Tr\u01b0\u1edfng ph\u00f2ng Kh\u00e1ch h\u00e0ng c\u00e1 nh\u00e2n', unit: 'Chi nh\u00e1nh H\u00f2a B\u00ecnh', address: branchAddress, authorization: authorization },
    { name: 'Ho\u00e0ng Th\u1ecb Minh', title: 'Gi\u00e1m \u0111\u1ed1c Ph\u00f2ng giao d\u1ecbch S\u00f4ng \u0110\u00e0', unit: 'Chi nh\u00e1nh H\u00f2a B\u00ecnh - Ph\u00f2ng giao d\u1ecbch S\u00f4ng \u0110\u00e0', address: '', authorization: authorization },
    { name: 'Nguy\u1ec5n Thanh T\u00f9ng', title: 'Gi\u00e1m \u0111\u1ed1c Ph\u00f2ng giao d\u1ecbch Cao Phong', unit: 'Chi nh\u00e1nh H\u00f2a B\u00ecnh - Ph\u00f2ng giao d\u1ecbch Cao Phong', address: '', authorization: authorization },
    { name: 'Nguy\u1ec5n Th\u1ecb Ho\u00e0i Thanh', title: 'Gi\u00e1m \u0111\u1ed1c Ph\u00f2ng giao d\u1ecbch Tr\u1ea7n H\u01b0ng \u0110\u1ea1o', unit: 'Chi nh\u00e1nh H\u00f2a B\u00ecnh - Ph\u00f2ng giao d\u1ecbch Tr\u1ea7n H\u01b0ng \u0110\u1ea1o', address: '', authorization: authorization },
    { name: 'Qu\u00e1ch Th\u1ecb Thu H\u00e0', title: 'Gi\u00e1m \u0111\u1ed1c Ph\u00f2ng giao d\u1ecbch Ph\u01b0\u01a1ng L\u00e2m', unit: 'Chi nh\u00e1nh H\u00f2a B\u00ecnh - Ph\u00f2ng giao d\u1ecbch Ph\u01b0\u01a1ng L\u00e2m', address: '', authorization: authorization }
  ];
}

function normalizeContractMapValues_(map) {
  Object.keys(map).forEach(function(key) {
    map[key] = cleanContractText_(map[key]);
  });
}

function parseContractDateInput_(value) {
  const raw = cleanContractText_(value);
  const today = new Date();
  const currentYear = Utilities.formatDate(today, Session.getScriptTimeZone(), 'yyyy');
  const result = { raw: raw, day: '', month: '', year: currentYear, full: '' };
  if (!raw) return result;
  const parts = raw.split(/[\/\-.]/).map(function(part) { return part.trim(); });
  if (parts.length >= 3) {
    result.day = normalizeDateToken_(parts[0]);
    result.month = normalizeDateToken_(parts[1]);
    result.year = normalizeDateToken_(parts[2]) || currentYear;
    result.full = [result.day || '...', result.month || '...', result.year || '....'].join('/');
    return result;
  }
  result.full = raw;
  return result;
}

function formatContractSequence_(value) {
  const text = cleanContractText_(value).trim();
  if (!text) return '01';
  if (/^\d+$/.test(text)) return text.padStart(2, '0');
  return text;
}

function calculateValuationTotalForContract_(contract) {
  const land = parseMoneyNumber_(contract && contract.valuation_land_amount);
  const house = parseMoneyNumber_(contract && contract.valuation_house_amount);
  if (!land && !house) return '';
  return formatMoneyForContract_(String(land + house));
}

function parseMoneyNumber_(value) {
  const digits = cleanContractText_(value).replace(/[^\d]/g, '');
  return digits ? Number(digits) : 0;
}

function normalizeDateToken_(value) {
  value = cleanContractText_(value).trim();
  if (!value) return '';
  if (/^\.+$/.test(value)) return '...';
  if (/^\d$/.test(value)) return '0' + value;
  return value;
}

function addExcelCompatibilityPlaceholders_(map, finalData) {
  const contract = finalData.contract_info || {};
  const secured = (finalData.secured_parties || []).map(cleanContractPerson_);
  const obligors = (finalData.obligors || []).map(cleanContractPerson_);
  const assets = (finalData.assets || []).map(cleanContractAsset_);
  const firstAsset = assets[0] || {};
  const re = firstAsset.real_estate || {};
  const mv = firstAsset.movable || {};
  const today = new Date();
  const day = Utilities.formatDate(today, Session.getScriptTimeZone(), 'dd');
  const month = Utilities.formatDate(today, Session.getScriptTimeZone(), 'MM');
  const year = Utilities.formatDate(today, Session.getScriptTimeZone(), 'yyyy');

  map.so_thu_tu_hop_dong = map.so_thu_tu_hop_dong || '01';
  map.cif_khach_hang = map.cif_khach_hang || '';
  map.ngay_lap_hop_dong_ngay = map.ngay_lap_hop_dong_ngay || day;
  map.ngay_lap_hop_dong_thang = map.ngay_lap_hop_dong_thang || month;
  map.ngay_lap_hop_dong_nam = map.ngay_lap_hop_dong_nam || year;
  map.nhan_so_vao_so = 'S\u1ed1 v\u00e0o s\u1ed5 c\u1ea5p GCN';
  map.ghi_chu_label = '';
  map.chuc_vu_nguoi_ky_ngan_hang = map.chuc_vu_nguoi_ky_ngan_hang || '';
  map.don_vi_quan_ly_khach_hang = map.don_vi_quan_ly_khach_hang || '';
  map.dia_chi_don_vi_ngan_hang = map.dia_chi_don_vi_ngan_hang || '';

  setAliases_(map, {
    excel_th_ch_p_r8c2: map.so_thu_tu_hop_dong,
    excel_th_ch_p_r15c9: map.ngay_lap_hop_dong_thang || month,
    excel_th_ch_p_r15c10: map.ngay_lap_hop_dong_nam || year,
    excel_th_ch_p_r2c2: map.cif_khach_hang,
    excel_th_ch_p_r3c2: map.ben_duoc_bao_dam_1_ho_ten,
    excel_th_ch_p_r3c4: map.ben_duoc_bao_dam_1_ngay_sinh,
    excel_th_ch_p_r4c1: buildIdDocumentLabelForContract_(obligors[0] || {}),
    excel_th_ch_p_r4c2: map.ben_duoc_bao_dam_1_so_giay_to,
    excel_th_ch_p_r5c1: 'do',
    excel_th_ch_p_r5c2: map.ben_duoc_bao_dam_1_noi_cap,
    excel_th_ch_p_r5c4: secured[0] && secured[0].gender === 'Nu' ? 'Ba' : 'Ong',
    excel_th_ch_p_r6c1: 'cap ngay',
    excel_th_ch_p_r6c2: map.ben_duoc_bao_dam_1_ngay_cap,
    excel_th_ch_p_r13c8: map.nguoi_ky_ngan_hang,
    excel_th_ch_p_r13c9: map.chuc_vu_nguoi_ky_ngan_hang,
    excel_th_ch_p_r21c2: map.tai_san_1_loai,
    excel_th_ch_p_r22c2: map.tai_san_1_dia_chi,
    excel_th_ch_p_r23c2: map.tai_san_1_so_gcn,
    excel_th_ch_p_r23c3: map.nhan_so_vao_so,
    excel_th_ch_p_r23c4: map.tai_san_1_so_vao_so,
    excel_th_ch_p_r24c2: map.tai_san_1_co_quan_cap,
    excel_th_ch_p_r24c4: map.tai_san_1_ngay_cap,
    excel_th_ch_p_r25c2: map.tai_san_1_so_thua,
    excel_th_ch_p_r25c4: map.tai_san_1_to_ban_do,
    excel_th_ch_p_r26c2: map.tai_san_1_dien_tich,
    excel_th_ch_p_r26c4: '',
    excel_th_ch_p_r27c2: map.tai_san_1_muc_dich_su_dung,
    excel_th_ch_p_r27c4: map.tai_san_1_thoi_han_su_dung,
    excel_th_ch_p_r27c6: map.tai_san_1_hinh_thuc_su_dung,
    excel_th_ch_p_r28c2: '',
    excel_th_ch_p_r28c3: map.ghi_chu_label,
    excel_th_ch_p_r28c4: '',
    excel_th_ch_p_r29c4: map.tai_san_1_thay_doi_sau_cap,
    excel_th_ch_p_r30c3: '',
    excel_th_ch_p_r32c2: map.gia_tri_dinh_gia,
    excel_th_ch_p_r32c3: '',
    excel_th_ch_p_r35c1: '',
    excel_th_ch_p_r35c2: map.tai_san_1_tai_san_gan_lien,
    excel_th_ch_p_r35c3: '',
    excel_th_ch_p_r35c4: '',
    excel_th_ch_p_r36c1: '',
    excel_th_ch_p_r36c2: '',
    excel_th_ch_p_r37c1: '',
    excel_th_ch_p_r37c2: '',

    excel_so_tu_nhay_r47c7: '',
    excel_so_tu_nhay_r47c8: '',
    excel_so_tu_nhay_r47c9: '',
    excel_so_tu_nhay_r47c10: '',
    excel_so_tu_nhay_r47c11: '',
    excel_so_tu_nhay_r47c12: '',
    excel_so_tu_nhay_r48c4: secured.length > 1 ? ':' : '',
    excel_so_tu_nhay_r48c5: map.gia_tri_dinh_gia,
    excel_so_tu_nhay_r48c6: '',
    excel_so_tu_nhay_r51c1: 'Ngay sinh',
    excel_so_tu_nhay_r51c3: secured.length > 1 ? 'Ngay sinh' : '',
    excel_so_tu_nhay_r52c1: buildIdDocumentLabelForContract_(secured[0] || {}),
    excel_so_tu_nhay_r52c3: secured.length > 1 ? buildIdDocumentLabelForContract_(secured[1] || {}) : '',
    excel_so_tu_nhay_r53c1: 'do',
    excel_so_tu_nhay_r53c3: secured.length > 1 ? 'do' : '',
    excel_so_tu_nhay_r54c1: 'cap ngay',
    excel_so_tu_nhay_r54c3: secured.length > 1 ? 'cap ngay' : '',
    excel_so_tu_nhay_r54c7: '',
    excel_so_tu_nhay_r55c1: 'Địa chỉ',
    excel_so_tu_nhay_r55c3: secured.length > 1 ? 'Địa chỉ' : '',
    excel_so_tu_nhay_r55c7: '',
    excel_so_tu_nhay_r103c1: '',

    excel_tc_t__r11c2: map.so_thu_tu_hop_dong,
    excel_tc_t__r15c9: map.ngay_lap_hop_dong_thang || month,
    excel_tc_t__r15c10: map.ngay_lap_hop_dong_nam || year,
    excel_tc_t__r2c2: map.cif_khach_hang,
    excel_tc_t__r3c2: map.ben_duoc_bao_dam_1_ho_ten,
    excel_tc_t__r4c2: secured[0] && secured[0].gender === 'Nu' ? 'Ba' : 'Ong',
    excel_tc_t__r6c1: buildIdDocumentLabelForContract_(obligors[0] || {}),
    excel_tc_t__r6c2: map.ben_duoc_bao_dam_1_so_giay_to,
    excel_tc_t__r7c1: 'do',
    excel_tc_t__r7c2: map.ben_duoc_bao_dam_1_noi_cap,
    excel_tc_t__r8c1: 'cap ngay',
    excel_tc_t__r8c2: map.ben_duoc_bao_dam_1_ngay_cap,
    excel_tc_t__r16c2: map.ben_bao_dam_1_ho_ten,
    excel_tc_t__r16c4: map.ben_bao_dam_2_ho_ten || '',
    excel_tc_t__r17c2: map.ben_bao_dam_1_danh_xung || '',
    excel_tc_t__r17c4: map.ben_bao_dam_2_danh_xung || '',
    excel_tc_t__r18c1: 'Ngay sinh',
    excel_tc_t__r18c2: map.ben_bao_dam_1_ngay_sinh,
    excel_tc_t__r18c3: secured.length > 1 ? 'Ngay sinh' : '',
    excel_tc_t__r18c4: map.ben_bao_dam_2_ngay_sinh || '',
    excel_tc_t__r19c1: buildIdDocumentLabelForContract_(secured[0] || {}),
    excel_tc_t__r19c2: map.ben_bao_dam_1_so_giay_to,
    excel_tc_t__r19c3: secured.length > 1 ? buildIdDocumentLabelForContract_(secured[1] || {}) : '',
    excel_tc_t__r19c4: map.ben_bao_dam_2_so_giay_to || '',
    excel_tc_t__r20c1: 'do',
    excel_tc_t__r20c2: map.ben_bao_dam_1_noi_cap,
    excel_tc_t__r20c3: secured.length > 1 ? 'do' : '',
    excel_tc_t__r20c4: map.ben_bao_dam_2_noi_cap || '',
    excel_tc_t__r21c1: 'Dia chi',
    excel_tc_t__r21c2: map.ben_bao_dam_1_dia_chi,
    excel_tc_t__r21c3: secured.length > 1 ? 'Dia chi' : '',
    excel_tc_t__r21c4: map.ben_bao_dam_2_dia_chi || '',
    excel_tc_t__r22c1: 'cap ngay',
    excel_tc_t__r22c2: map.ben_bao_dam_1_ngay_cap,
    excel_tc_t__r22c3: secured.length > 1 ? 'cap ngay' : '',
    excel_tc_t__r22c4: map.ben_bao_dam_2_ngay_cap || '',
    excel_tc_t__r27c2: map.dong_san_1_loai,
    excel_tc_t__r27c4: map.dong_san_1_nhan_hieu,
    excel_tc_t__r29c1: '',
    excel_tc_t__r29c2: map.dong_san_1_so_loai,
    excel_tc_t__r29c4: map.dong_san_1_bien_so,
    excel_tc_t__r30c2: map.dong_san_1_so_khung,
    excel_tc_t__r30c4: map.dong_san_1_so_may,
    excel_tc_t__r32c2: map.dong_san_1_nam_san_xuat,
    excel_tc_t__r34c2: map.dong_san_1_nuoc_san_xuat,
    excel_tc_t__r35c2: map.dong_san_1_chu_so_huu,
    excel_tc_t__r40c2: map.dong_san_1_so_dang_ky,
    excel_tc_t__r40c3: map.dong_san_1_ngay_cap
  });
}

function setAliases_(map, aliases) {
  Object.keys(aliases).forEach(function(key) {
    if (map[key] === undefined || map[key] === '') map[key] = aliases[key] || '';
  });
}

function addPersonPlaceholders_(map, prefix, p) {
  map[prefix + '_ho_ten'] = p.full_name || '';
  map[prefix + '_danh_xung'] = getPersonHonorific_(p);
  map[prefix + '_ngay_sinh'] = p.date_of_birth || '';
  map[prefix + '_gioi_tinh'] = p.gender || '';
  map[prefix + '_loai_giay_to'] = p.id_document_type || '';
  map[prefix + '_so_giay_to'] = p.id_number || '';
  map[prefix + '_ngay_cap'] = p.id_issue_date || '';
  map[prefix + '_noi_cap'] = p.id_issue_place || '';
  map[prefix + '_dia_chi'] = p.current_address_final || p.permanent_address || '';
}

function addAssetPlaceholders_(map, prefix, asset) {
  const re = asset.real_estate || {};
  map[prefix + '_loai'] = asset.asset_type || '';
  map[prefix + '_chu_so_huu'] = asset.owner_identity_summary || asset.owner_name || '';
  map[prefix + '_ten_gcn'] = asset.certificate_title || '';
  map[prefix + '_so_gcn'] = re.certificate_number || '';
  map[prefix + '_so_vao_so'] = re.registry_number || '';
  map[prefix + '_co_quan_cap'] = re.issuing_authority || '';
  map[prefix + '_ngay_cap'] = re.issue_date || '';
  map[prefix + '_so_thua'] = re.land_plot_number || '';
  map[prefix + '_to_ban_do'] = re.map_sheet_number || '';
  map[prefix + '_dia_chi'] = re.land_address || '';
  map[prefix + '_dien_tich'] = formatAreaForContract_(re.area, re.area_in_words);
  map[prefix + '_dien_tich_bang_chu'] = re.area_in_words || '';
  map[prefix + '_muc_dich_su_dung'] = re.usage_purpose || '';
  map[prefix + '_thoi_han_su_dung'] = re.usage_term || '';
  map[prefix + '_hinh_thuc_su_dung'] = re.usage_form || '';
  map[prefix + '_nguon_goc_su_dung'] = re.usage_origin || '';
  map[prefix + '_thay_doi_sau_cap'] = re.post_issue_changes || '';
  map[prefix + '_tai_san_gan_lien'] = re.attached_assets || '';
}

function buildPeopleLegalText_(people) {
  return (people || []).map(function(p, i) {
    const parts = [
      (i + 1) + '. ' + (p.full_name || ''),
      p.date_of_birth ? 'sinh ng\u00e0y ' + p.date_of_birth : '',
      p.id_number ? buildIdDocumentLabelForContract_(p) + ' ' + buildPersonIdIssuePhrase_(p) : '',
      (p.current_address_final || p.permanent_address) ? '\u0110\u1ecba ch\u1ec9: ' + (p.current_address_final || p.permanent_address) : ''
    ].filter(Boolean);
    return parts.join(', ');
  }).join('\n');
}

function buildAssetsLegalText_(assets) {
  return (assets || []).map(function(asset, i) {
    const re = asset.real_estate || {};
    const mv = asset.movable || {};
    if (re.certificate_number || re.land_plot_number) {
      return [
        (i + 1) + '. ' + (asset.certificate_title || 'Giay chung nhan'),
        re.certificate_number ? 'so ' + re.certificate_number : '',
        re.registry_number ? 'so vao so ' + re.registry_number : '',
        re.issue_date ? 'cap ngay ' + re.issue_date : '',
        re.issuing_authority ? 'boi ' + re.issuing_authority : '',
        re.land_plot_number ? 'thua dat so ' + re.land_plot_number : '',
        re.map_sheet_number ? 'to ban do so ' + re.map_sheet_number : '',
        re.area ? 'dien tich ' + formatAreaForContract_(re.area, re.area_in_words) : '',
        re.land_address ? 'Dia chi' + re.land_address : '',
        re.usage_purpose ? 'muc dich su dung ' + re.usage_purpose : '',
        re.usage_term ? 'thoi han su dung ' + re.usage_term : '',
        re.usage_origin ? 'nguon goc su dung ' + re.usage_origin : ''
      ].filter(Boolean).join(', ');
    }
    return [
      (i + 1) + '. ' + (mv.asset_category || asset.asset_type || 'Tai san'),
      mv.brand ? 'nhan hieu ' + mv.brand : '',
      mv.license_plate ? 'bien so ' + mv.license_plate : '',
      mv.chassis_number ? 'so khung ' + mv.chassis_number : '',
      mv.engine_number ? 'so may ' + mv.engine_number : '',
      mv.registration_number ? 'giay dang ky so ' + mv.registration_number : ''
    ].filter(Boolean).join(', ');
  }).join('\n');
}

function getContractTemplateConfigs_() {
  const prop = PropertiesService.getScriptProperties().getProperty(CONFIG.CONTRACT_TEMPLATE_CONFIG_PROPERTY);
  const parsed = parseJsonSafe(prop, null);
  if (!Array.isArray(parsed)) return DEFAULT_CONTRACT_TEMPLATES;
  const byCode = {};
  parsed.forEach(function(tpl) {
    if (tpl && tpl.code) byCode[tpl.code] = tpl;
  });
  return DEFAULT_CONTRACT_TEMPLATES.map(function(defaultTpl) {
    return Object.assign({}, defaultTpl, byCode[defaultTpl.code] || {});
  });
}

function setupPhase2TemplatesFromDriveFolder(folderName) {
  folderName = folderName || 'HDTC_Phase2_Templates';
  const folders = DriveApp.getFoldersByName(folderName);
  if (!folders.hasNext()) {
    throw new Error('Drive folder not found: ' + folderName + '. Wait for Drive sync, then run again.');
  }
  const folder = folders.next();
  const files = [];
  const iterator = folder.getFiles();
  while (iterator.hasNext()) {
    const file = iterator.next();
    files.push({
      id: file.getId(),
      name: file.getName(),
      mimeType: file.getMimeType()
    });
  }

  const configs = DEFAULT_CONTRACT_TEMPLATES.map(function(tpl) {
    const matched = findTemplateFileForCode_(files, tpl.code);
    const copy = Object.assign({}, tpl);
    if (matched) {
      Utilities.sleep(3000);
      copy.template_doc_id = ensureGoogleDocTemplate_(matched, folder.getId());
    }
    return copy;
  });
  PropertiesService.getScriptProperties().setProperty(
    CONFIG.CONTRACT_TEMPLATE_CONFIG_PROPERTY,
    JSON.stringify(configs)
  );
  console.log(JSON.stringify(configs, null, 2));
  return configs;
}

function setupOnePhase2TemplateFromDriveFolder(templateCode, folderName) {
  folderName = folderName || 'HDTC_Phase2_Templates';
  const folders = DriveApp.getFoldersByName(folderName);
  if (!folders.hasNext()) {
    throw new Error('Drive folder not found: ' + folderName + '. Wait for Drive sync, then run again.');
  }
  const folder = folders.next();
  const files = [];
  const iterator = folder.getFiles();
  while (iterator.hasNext()) {
    const file = iterator.next();
    files.push({ id: file.getId(), name: file.getName(), mimeType: file.getMimeType() });
  }

  const configs = getContractTemplateConfigs_();
  const index = configs.findIndex(function(tpl) { return tpl.code === templateCode; });
  if (index < 0) throw new Error('Unknown template code: ' + templateCode);
  const matched = findTemplateFileForCode_(files, templateCode);
  if (!matched) throw new Error('Template file not found for code: ' + templateCode);
  configs[index].template_doc_id = ensureGoogleDocTemplate_(matched, folder.getId());
  PropertiesService.getScriptProperties().setProperty(
    CONFIG.CONTRACT_TEMPLATE_CONFIG_PROPERTY,
    JSON.stringify(configs)
  );
  console.log(JSON.stringify(configs[index], null, 2));
  return configs[index];
}


function findTemplateFileForCode_(files, code) {
  const patterns = {
    '03a_bds_chinh_chu': /03a.*(PLACEHOLDER|HDTC|bat dong san|b\u1ea5t \u0111\u1ed9ng s\u1ea3n)/i,
    '03b_bds_ben_thu_ba': /03b.*(PLACEHOLDER|HDTC|bat dong san|b\u1ea5t \u0111\u1ed9ng s\u1ea3n)/i,
    '03c_bds_ts_chua_chung_nhan_chinh_chu': /03c.*(PLACEHOLDER|HDTC|tai san chua|t\u00e0i s\u1ea3n ch\u01b0a)/i,
    '03d_bds_ts_chua_chung_nhan_ben_thu_ba': /03d.*(PLACEHOLDER|HDTC|tai san chua|t\u00e0i s\u1ea3n ch\u01b0a)/i,
    '02a_dong_san_chinh_chu': /02a.*(PLACEHOLDER|HDTC|dong san|\u0111\u1ed9ng s\u1ea3n)/i,
    '02b_dong_san_ben_thu_ba': /02b.*(PLACEHOLDER|HDTC|dong san|\u0111\u1ed9ng s\u1ea3n)/i,
    '17_uy_quyen_xu_ly_tai_san': /(^|[^0-9])17.*(PLACEHOLDER|uy quyen|\u1ee7y quy\u1ec1n)/i,
    'bm05a_phieu_ban_giao_ho_so': /(BM\s*05a|Phieu ban giao ho so|Phi\u1ebfu b\u00e0n giao h\u1ed3 s\u01a1)/i,
    'bctd_mau_moi': /BCTD/i,
    'bbdg_bds_mau_moi': /BBDG.*BDS|BBDG.*bat dong san|BBDG.*b\u1ea5t \u0111\u1ed9ng s\u1ea3n/i,
    'mau01a_dktc': /(Mau01a|Mau\s*01a|DKTC|\u0110KTC)/i,
    'bbgn_tc': /BBGN.*TC/i
  };
  const re = patterns[code];
  if (!re) return null;
  return (files || []).filter(function(file) {
    return re.test(file.name) && !/_placeholders\.csv$/i.test(file.name);
  })[0] || null;
}

function ensureGoogleDocTemplate_(file, folderId) {
  if (file.mimeType === MimeType.GOOGLE_DOCS || file.mimeType === 'application/vnd.google-apps.document') {
    return file.id;
  }
  const title = file.name.replace(/\.(docx|doc)$/i, '') + '_GOOGLE_DOC_TEMPLATE';
  const existing = findFileInFolderByName_(folderId, title, 'application/vnd.google-apps.document');
  if (existing) return existing.getId();
  const resource = {
    title: title,
    mimeType: 'application/vnd.google-apps.document',
    parents: [{ id: folderId }]
  };
  const created = withTemplateRetry_('Convert template ' + file.name, function() {
    return Drive.Files.copy(resource, file.id, { convert: true });
  });
  return created.id;
}

function withTemplateRetry_(label, fn) {
  let lastErr = null;
  for (let i = 0; i < 6; i++) {
    try {
      return fn();
    } catch (err) {
      lastErr = err;
      const text = String(err && err.message ? err.message : err);
      const isRateLimit = text.indexOf('rate limit') >= 0 || text.indexOf('Rate Limit') >= 0 || text.indexOf('User rate limit exceeded') >= 0;
      const sleepMs = isRateLimit ? Math.min(15000 * Math.pow(2, i), 120000) : (2000 * Math.pow(2, i));
      console.warn('Template copy failed for ' + label + ' attempt ' + (i + 1) + '. Sleeping ' + sleepMs + ' ms. Error: ' + text);
      Utilities.sleep(sleepMs);
    }
  }
  throw new Error(label + ' failed after retries: ' + lastErr);
}

function findFileInFolderByName_(folderId, name, mimeType) {
  const folder = DriveApp.getFolderById(folderId);
  const files = folder.getFilesByName(name);
  while (files.hasNext()) {
    const file = files.next();
    if (!mimeType || file.getMimeType() === mimeType) return file;
  }
  return null;
}

function isTemplateApplicable_(tpl, assetType, contractType) {
  const tplAsset = normalizeSearchTextForContract_(tpl.asset_type || '');
  const tplContract = normalizeSearchTextForContract_(tpl.contract_type || '');
  const asset = normalizeSearchTextForContract_(assetType || '');
  const contract = normalizeSearchTextForContract_(contractType || '');
  return (!tplAsset || asset.indexOf(tplAsset) >= 0 || tplAsset.indexOf(asset) >= 0) &&
    (!tplContract || contract.indexOf(tplContract) >= 0 || tplContract.indexOf(contract) >= 0);
}

function normalizeSearchTextForContract_(value) {
  return String(value || '').toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u0111/g, 'd')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getCaseOutputFolders_(caseId) {
  const row = getCaseRow(caseId);
  if (!row) throw new Error('Case not found: ' + caseId);
  const match = String(row['Drive Folder URL'] || '').match(/[-\w]{25,}/);
  if (!match) throw new Error('Cannot detect case folder ID');
  const caseFolder = DriveApp.getFolderById(match[0]);
  const outputFolder = getOrCreateChildFolder_(caseFolder, '07_Contract_Output');
  return { caseFolderId: caseFolder.getId(), outputFolderId: outputFolder.getId(), outputFolderUrl: outputFolder.getUrl() };
}

function appendGeneratedContractRow_(caseId, tpl, result, email, status, error) {
  appendSheetRow(SHEETS.GENERATED_CONTRACTS, {
    'Case ID': caseId,
    'Template Code': tpl.code,
    'Template Name': tpl.name,
    'Google Doc URL': result.google_doc_url || '',
    'DOCX URL': result.docx_url || '',
    'PDF URL': result.pdf_url || '',
    'Generated By': getActiveUserEmail(),
    'Generated At': nowIso(),
    'Email Sent To': email || '',
    'Status': status || '',
    'Error': error || ''
  });
}

function markGeneratedContractsEmailSent_(caseId, templateCodes, email) {
  const sheet = getSheet(SHEETS.GENERATED_CONTRACTS);
  const headers = getHeaders_(sheet);
  if (sheet.getLastRow() < 2) return;
  const codeCol = headers.indexOf('Template Code') + 1;
  const caseCol = headers.indexOf('Case ID') + 1;
  const emailCol = headers.indexOf('Email Sent To') + 1;
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
  data.forEach(function(row, idx) {
    if (String(row[caseCol - 1]) === String(caseId) && templateCodes.indexOf(String(row[codeCol - 1])) >= 0) {
      sheet.getRange(idx + 2, emailCol).setValue(email);
    }
  });
}

function escapeRegex_(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sanitizeReplacementText_(value) {
  return String(value == null ? '' : value).replace(/\$/g, '$$$$');
}

function formatDateVi_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'dd/MM/yyyy');
}

function replaceLiteral_(body, oldText, newText) {
  if (!oldText) return;
  body.replaceText(escapeRegex_(oldText), sanitizeReplacementText_(newText || ''));
}

function replaceNextLiteral_(body, oldText, newText) {
  if (!oldText) return false;
  const range = body.findText(escapeRegex_(oldText));
  if (!range) return false;
  range.getElement().asText().deleteText(range.getStartOffset(), range.getEndOffsetInclusive());
  range.getElement().asText().insertText(range.getStartOffset(), newText || '');
  return true;
}

function cleanContractPerson_(person) {
  person = person || {};
  const idDocumentType = normalizeIdDocumentTypeForContract_(person.id_document_type);
  const defaultIssuePlace = defaultIssuePlaceForIdDocument_(idDocumentType, person.id_number);
  const idIssuePlace = defaultIssuePlace || normalizeIdIssuePlaceForContract_(person.id_issue_place);
  return {
    full_name: cleanContractText_(person.full_name),
    date_of_birth: cleanContractText_(person.date_of_birth),
    gender: cleanContractText_(person.gender),
    id_document_type: idDocumentType,
    id_number: cleanContractText_(person.id_number),
    id_issue_date: cleanContractText_(person.id_issue_date),
    id_issue_place: idIssuePlace,
    permanent_address: cleanContractText_(person.permanent_address),
    current_address_final: cleanContractText_(person.current_address_final)
  };
}

function cleanContractAsset_(asset) {
  asset = asset || {};
  asset.real_estate = asset.real_estate || {};
  return {
    asset_type: normalizeAssetTypeForContract_(asset.asset_type),
    owner_name: cleanContractText_(asset.owner_name),
    owner_identity_summary: cleanContractText_(asset.owner_identity_summary),
    certificate_title: cleanContractText_(asset.certificate_title),
    real_estate: {
      certificate_number: normalizeCertificateNumberForContract_(asset.real_estate.certificate_number, asset.real_estate.registry_number),
      registry_number: normalizeCertificateCodeForContract_(asset.real_estate.registry_number),
      issuing_authority: normalizeIssuingAuthorityForContract_(asset.real_estate.issuing_authority),
      issue_date: cleanContractText_(asset.real_estate.issue_date),
      land_plot_number: cleanContractText_(asset.real_estate.land_plot_number),
      map_sheet_number: cleanContractText_(asset.real_estate.map_sheet_number),
      land_address: cleanContractText_(asset.real_estate.land_address),
      area: cleanContractText_(asset.real_estate.area),
      area_in_words: normalizeAreaWordsForContract_(asset.real_estate.area_in_words),
      usage_form: cleanContractText_(asset.real_estate.usage_form),
      usage_purpose: cleanContractText_(asset.real_estate.usage_purpose),
      usage_term: cleanContractText_(asset.real_estate.usage_term),
      usage_origin: cleanContractText_(asset.real_estate.usage_origin),
      attached_assets: normalizeAttachedAssetsForContract_(asset.real_estate.attached_assets),
      post_issue_changes: normalizePostIssueChangesForContract_(asset.real_estate.post_issue_changes),
      certificate_info_raw_text: cleanContractText_(asset.real_estate.certificate_info_raw_text),
      certificate_owner_raw_text: cleanContractText_(asset.real_estate.certificate_owner_raw_text),
      certificate_land_raw_text: cleanContractText_(asset.real_estate.certificate_land_raw_text),
      certificate_attached_raw_text: cleanContractText_(asset.real_estate.certificate_attached_raw_text)
    }
  };
}

function getPersonHonorific_(person) {
  const gender = removeVietnameseAccents_(String(person && person.gender || '').toLowerCase());
  if (gender.indexOf('nu') >= 0) return 'B\u00e0';
  return '\u00d4ng';
}

function buildPersonNameForContract_(person) {
  if (!person || !person.full_name) return '';
  return getPersonHonorific_(person) + ' ' + toVietnameseTitleCase_(person.full_name);
}

function buildPersonNamesForContract_(people) {
  return joinVietnameseList_((people || []).map(buildPersonNameForContract_).filter(Boolean));
}

function buildPeopleDefinitionText03b_(people) {
  const text = (people || []).map(function(person) {
    const parts = [];
    if (person.date_of_birth) parts.push('sinh ng\u00e0y ' + person.date_of_birth);
    if (person.id_number) {
      let idText = buildIdDocumentLabelForContract_(person) + ' ' + buildPersonIdIssuePhrase_(person);
      parts.push(idText);
    }
    return buildPersonNameForContract_(person) + (parts.length ? ' (' + parts.join(', ') + ')' : '');
  }).filter(Boolean).join(' v\u00e0 ');
  return text || '................................';
}

function buildPersonIdIssuePhrase_(person) {
  if (!person || !person.id_number) return '';
  let text = person.id_number;
  const issuePlace = person.id_issue_place || defaultIssuePlaceForIdDocument_(person.id_document_type, person.id_number);
  const issueDate = person.id_issue_date || '..........';
  if (issuePlace) text += ' do ' + issuePlace;
  text += ' c\u1ea5p ng\u00e0y ' + issueDate;
  return text;
}

function normalizeJoinedPersonNamesInBody_(body, people) {
  if (!people || people.length < 2) return;
  const first = buildPersonNameForContract_(people[0]);
  const second = buildPersonNameForContract_(people[1]);
  const joined = buildPersonNamesForContract_(people);
  if (first && second) replaceLiteral_(body, first + ' - ' + second, joined);
}

function boldContractPersonNames_(body, people) {
  (people || []).forEach(function(person) {
    const name = toVietnameseTitleCase_(person && person.full_name || '');
    if (!name) return;
    let range = body.findText(escapeRegex_(name));
    while (range) {
      range.getElement().asText().setBold(range.getStartOffset(), range.getEndOffsetInclusive(), true);
      range = body.findText(escapeRegex_(name), range);
    }
  });
}

function unboldTemplate03bReferencePhrase_(body) {
  const phrase = '(v\u1edbi c\u00e1c th\u00f4ng tin n\u00eau t\u1ea1i ph\u1ea7n c\u00e1c b\u00ean tham gia H\u1ee3p \u0111\u1ed3ng \u1edf tr\u00ean)';
  let range = body.findText(escapeRegex_(phrase));
  while (range) {
    range.getElement().asText().setBold(range.getStartOffset(), range.getEndOffsetInclusive(), false);
    range = body.findText(escapeRegex_(phrase), range);
  }
}

function toVietnameseTitleCase_(value) {
  return cleanContractText_(value).toLowerCase().replace(/(^|[\s\-])([^\s\-])/g, function(match, prefix, char) {
    return prefix + char.toUpperCase();
  });
}

function buildShortContractDate_(values) {
  return [values.ngay_lap_hop_dong_ngay || '...', values.ngay_lap_hop_dong_thang || '...', values.ngay_lap_hop_dong_nam || '....'].join('/');
}

function buildContractCopyCount_(finalData) {
  const assetCount = Math.max((finalData.assets || []).length || 1, 1);
  return String(assetCount + 4).padStart(2, '0');
}

function formatMoneyForContract_(value) {
  const digits = String(value || '').replace(/[^\d]/g, '');
  if (!digits) return '';
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function numberToVietnameseCurrencyText_(value) {
  const digits = String(value || '').replace(/[^\d]/g, '');
  if (!digits) return '';
  const number = Number(digits);
  if (!isFinite(number)) return '';
  return numberToVietnameseWords_(number) + ' \u0111\u1ed3ng';
}

function numberToVietnameseWords_(number) {
  if (number === 0) return 'Kh\u00f4ng';
  const units = ['', 'ngh\u00ecn', 'tri\u1ec7u', 't\u1ef7', 'ngh\u00ecn t\u1ef7', 'tri\u1ec7u t\u1ef7'];
  const parts = [];
  let n = Math.floor(number);
  let unitIndex = 0;
  while (n > 0) {
    const chunk = n % 1000;
    if (chunk) parts.unshift(readThreeDigits_(chunk, n >= 1000) + (units[unitIndex] ? ' ' + units[unitIndex] : ''));
    n = Math.floor(n / 1000);
    unitIndex++;
  }
  const text = parts.join(' ').replace(/\s+/g, ' ').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function readThreeDigits_(num, full) {
  const names = ['kh\u00f4ng', 'm\u1ed9t', 'hai', 'ba', 'b\u1ed1n', 'n\u0103m', 's\u00e1u', 'b\u1ea3y', 't\u00e1m', 'ch\u00edn'];
  const hundred = Math.floor(num / 100);
  const ten = Math.floor((num % 100) / 10);
  const one = num % 10;
  const parts = [];
  if (hundred || full) parts.push(names[hundred] + ' tr\u0103m');
  if (ten > 1) {
    parts.push(names[ten] + ' m\u01b0\u01a1i');
    if (one === 1) parts.push('m\u1ed1t');
    else if (one === 5) parts.push('l\u0103m');
    else if (one) parts.push(names[one]);
  } else if (ten === 1) {
    parts.push('m\u01b0\u1eddi');
    if (one === 5) parts.push('l\u0103m');
    else if (one) parts.push(names[one]);
  } else if (one) {
    if (hundred || full) parts.push('l\u1ebb');
    parts.push(names[one]);
  }
  return parts.join(' ');
}
