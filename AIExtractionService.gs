function extractDataWithAi(caseId, formData, ocrResults, folders) {
  updateCase(caseId, { 'Status': CASE_STATUS.AI_RUNNING });
  logAudit(caseId, 'AI_EXTRACTION_STARTED', { ocr_files: ocrResults.length });
  const apiKey = PropertiesService.getScriptProperties().getProperty(CONFIG.OPENAI_API_KEY_PROPERTY);
  if (!apiKey) throw new Error('Missing script property ' + CONFIG.OPENAI_API_KEY_PROPERTY);
  const landVisionResults = extractLandCertificateSemanticsWithVision_(caseId, formData, ocrResults, apiKey);

  const input = {
    case_id: caseId,
    form_data: formData,
    ocr_results: ocrResults.map(function(item) {
      return {
        file_name: item.file_name,
        file_id: item.file_id,
        file_type: item.file_type,
        group: item.group,
        ocr_status: item.status,
        confidence: item.confidence,
        text: truncateForAi(item.text),
        land_vision_semantic: landVisionSummaryForExtraction_(landVisionResults, item.file_id)
      };
    })
  };
  const payload = {
    model: CONFIG.OPENAI_MODEL_LOCKED,
    input: [
      { role: 'system', content: getAiExtractionPrompt() },
      { role: 'user', content: 'Bóc tách dữ liệu sau thành JSON. JSON input:\n' + jsonStringify(input) }
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'mortgage_case_extraction',
        strict: false,
        schema: getExtractionJsonSchema_()
      }
    }
  };

  const response = withRetry('OpenAI extraction', function() {
    const res = UrlFetchApp.fetch(CONFIG.OPENAI_ENDPOINT, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + apiKey },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    if (res.getResponseCode() >= 300) throw new Error(res.getContentText());
    return JSON.parse(res.getContentText());
  }, CONFIG.MAX_API_RETRIES);

  const extracted = applyLandVisionSemanticsToAiData_(
    parseOpenAiJsonResponse_(response),
    landVisionResults
  );
  extracted._openai_processing = buildOpenAiProcessingMetrics_(response.usage || {}, landVisionResults);
  const aiFile = saveJsonFile(folders.subfolders['03_AI_JSON'].id, caseId + '_ai_extracted.json', extracted);
  updateCase(caseId, { 'Status': CASE_STATUS.AI_DONE });
  logAudit(caseId, 'AI_EXTRACTION_DONE', {
    ai_json_url: aiFile.url,
    model: CONFIG.OPENAI_MODEL_LOCKED,
    land_vision_files: landVisionResults.length,
    usage: response.usage || {}
  });
  return { data: extracted, fileUrl: aiFile.url };
}

function buildOpenAiProcessingMetrics_(extractionUsage, landVisionResults) {
  const vision = (landVisionResults || []).map(function(result) {
    return {
      file_name: result.file_name || '',
      file_id: result.file_id || '',
      usage: result.usage || {}
    };
  });
  const usages = [extractionUsage || {}].concat(vision.map(function(item) { return item.usage; }));
  const total = {};
  usages.forEach(function(usage) {
    Object.keys(usage || {}).forEach(function(key) {
      if (typeof usage[key] === 'number') total[key] = Number(total[key] || 0) + usage[key];
    });
  });
  return {
    model: CONFIG.OPENAI_MODEL_LOCKED,
    extraction_usage: extractionUsage || {},
    land_vision_usage: vision,
    total_usage: total
  };
}

function extractLandCertificateSemanticsWithVision_(caseId, formData, ocrResults, apiKey) {
  const results = [];
  (ocrResults || []).forEach(function(item) {
    if (!isLandCertificateOcrResultForVision_(item, formData)) return;
    try {
      const result = extractLandCertificateSemanticFileWithVision_(item, apiKey);
      if (!result) return;
      results.push(result);
      logAudit(caseId, 'OPENAI_LAND_VISION_DONE', {
        file_name: item.file_name,
        file_id: item.file_id,
        model: CONFIG.OPENAI_MODEL_LOCKED,
        generation: result.document && result.document.generation || 'unknown',
        semantic_items: result.document && result.document.items ? result.document.items.length : 0,
        usage: result.usage || {}
      });
    } catch (err) {
      logAudit(caseId, 'OPENAI_LAND_VISION_FAILED', {
        file_name: item.file_name,
        file_id: item.file_id,
        model: CONFIG.OPENAI_MODEL_LOCKED,
        error: String(err && err.message ? err.message : err)
      });
    }
  });
  return results;
}

function isLandCertificateOcrResultForVision_(item, formData) {
  if (!item || item.status !== 'DONE' || !item.file_id) return false;
  if (String(item.group || '').toLowerCase() !== 'asset') return false;
  const mime = String(item.file_type || '').toLowerCase();
  if (mime.indexOf('image/') !== 0 && mime !== 'application/pdf') return false;
  const labSkill = formData && formData.lab_training && formData.lab_training.skill || '';
  if (labSkill === 'ocr-bia-dat') return true;
  const assetType = removeVietnameseAccents_(String(formData && formData.assetType || ''))
    .toLowerCase();
  if (assetType.indexOf('bat dong san') >= 0 || assetType.indexOf('quyen su dung dat') >= 0) return true;
  return typeof shouldReclassifyOcrAsLandAsset_ !== 'function' ||
    shouldReclassifyOcrAsLandAsset_(item.text || '');
}

function extractLandCertificateSemanticFileWithVision_(ocrResult, apiKey) {
  const file = DriveApp.getFileById(ocrResult.file_id);
  const blob = file.getBlob();
  const bytes = blob.getBytes();
  const maxBytes = Number(CONFIG.OPENAI_LAND_VISION_MAX_FILE_BYTES || 0);
  if (maxBytes && bytes.length > maxBytes) {
    throw new Error('Land certificate file exceeds OpenAI vision limit configured by this app: ' + bytes.length + ' bytes');
  }
  const mime = String(ocrResult.file_type || blob.getContentType() || '').toLowerCase();
  const content = [{
    type: 'input_text',
    text: getLandCertificateVisionPrompt_() +
      '\n\nGOOGLE VISION OCR (supporting evidence; it may have wrong rotation/order):\n' +
      String(ocrResult.text || '').slice(0, CONFIG.MAX_OCR_TEXT_CHARS_PER_REQUEST || 120000)
  }];
  const base64 = Utilities.base64Encode(bytes);
  if (mime === 'application/pdf') {
    content.unshift({
      type: 'input_file',
      filename: file.getName(),
      file_data: 'data:application/pdf;base64,' + base64
    });
  } else {
    content.unshift({
      type: 'input_image',
      image_url: 'data:' + (mime || 'image/jpeg') + ';base64,' + base64,
      detail: 'high'
    });
  }
  const payload = {
    model: CONFIG.OPENAI_MODEL_LOCKED,
    input: [{ role: 'user', content: content }],
    text: {
      format: {
        type: 'json_schema',
        name: 'land_certificate_semantic_document',
        strict: true,
        schema: getLandCertificateVisionJsonSchema_()
      }
    }
  };
  const response = withRetry('OpenAI land certificate semantic vision ' + file.getName(), function() {
    const res = UrlFetchApp.fetch(CONFIG.OPENAI_ENDPOINT, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + apiKey },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    if (res.getResponseCode() >= 300) throw new Error(res.getContentText());
    return JSON.parse(res.getContentText());
  }, CONFIG.MAX_API_RETRIES);
  const parsed = parseOpenAiJsonResponse_(response);
  const document = normalizeLandVisionSemanticDocument_(parsed);
  return {
    file_id: ocrResult.file_id,
    file_name: ocrResult.file_name || file.getName(),
    document: document,
    warnings: parsed.warnings || [],
    usage: response.usage || {}
  };
}

function getLandCertificateVisionPrompt_() {
  return [
    'Đọc tệp Giấy chứng nhận quyền sử dụng đất của Việt Nam và tạo semantic document đúng với nội dung in trên giấy.',
    'Trước tiên tự xác định chiều đọc đúng của từng trang. Một trang PDF vật lý có thể chứa nhiều trang hoặc nhiều vùng logic; hãy tách và phân loại từng vùng độc lập.',
    'Dùng tiêu đề đầy đủ để xác định thế hệ giấy. Không đoán thế hệ từ một nhãn rời rạc.',
    'Giữ đúng số mục, marker, nhãn, thứ tự và phạm vi trường đã in. Marker a-g chỉ là metadata, không quyết định ý nghĩa trường.',
    'Không đưa địa chỉ thường trú của chủ đất vào địa chỉ thửa đất. Chỉ lấy land_address trong phần thông tin thửa đất.',
    'Không ghép nội dung sơ đồ, chữ ký, cơ quan xác nhận hoặc tọa độ vào mục thay đổi sau cấp giấy.',
    'Chỉ sửa lỗi OCR hiển nhiên trong cùng ngữ cảnh, ví dụ mÂ²/m2 thành m² hoặc CCCP sa thành CCCD số khi nhãn và số định danh hỗ trợ rõ ràng.',
    'Nếu không đọc rõ giá trị thì để trống và thêm warning. Không suy diễn tên, mã, số hoặc địa chỉ còn thiếu.',
    'Luôn trả printed_lines cho từng vùng/trang và raw_lines cho từng section: đây là transcript hiển thị lại trên review, phải giữ nguyên dòng, nhãn, marker, thứ tự, và các mục trống như 3/4/5/6 nếu có trên giấy.',
    'Với dòng có nhiều trường in cùng dòng, ví dụ "a) Thửa đất số ...; tờ bản đồ số ...", giữ nguyên một dòng trong raw_lines/printed_lines. Không tự tách tờ bản đồ thành marker mới.',
    'Mục I phải ghi lại đầy đủ các dòng đọc được trong raw_lines, kể cả thông tin chủ, năm sinh/giấy tờ, địa chỉ thường trú hoặc dòng mô tả khác. Không rút gọn chỉ còn các nhãn chuẩn.',
    'Mục IV phải transcript lại chữ in/chữ viết tay đọc được trong raw_lines, dù OCR có thể sai; chỉ bỏ phần chữ ký/dấu xác nhận khi nó không thuộc nội dung thay đổi.',
    'Mỗi item phải thuộc đúng section_semantic. Chỉ dùng semantic_key trong danh sách schema; nội dung chưa ánh xạ dùng unknown.',
    'Với bảng thay đổi sau cấp giấy, chỉ lấy cột nội dung thay đổi và cơ sở pháp lý, bỏ tiêu đề cột, chữ ký và cơ quan xác nhận.',
    'Kết quả phải phản ánh ảnh/PDF; OCR Google chỉ là bằng chứng phụ để đối chiếu.'
  ].join('\n');
}

function getLandCertificateVisionJsonSchema_() {
  const section = {
    type: 'object',
    additionalProperties: false,
    properties: {
      semantic: { type: 'string', enum: ['owners', 'land_details', 'attached_assets', 'other_assets', 'land_diagram', 'certificate_note', 'post_issue_changes', 'unknown'] },
      marker_raw: { type: 'string' },
      label_raw: { type: 'string' },
      label_canonical: { type: 'string' },
      raw_lines: { type: 'array', items: { type: 'string' } },
      visual_order: { type: 'number' }
    },
    required: ['semantic', 'marker_raw', 'label_raw', 'label_canonical', 'raw_lines', 'visual_order']
  };
  const item = {
    type: 'object',
    additionalProperties: false,
    properties: {
      semantic_key: {
        type: 'string',
        enum: [
          'certificate_number', 'registry_number', 'issue_date', 'issuing_authority',
          'owner_line', 'owner_raw_text',
          'land_plot_number', 'map_sheet_number', 'land_address', 'area', 'area_in_words',
          'usage_purpose', 'usage_term', 'usage_form', 'usage_origin',
          'attached_asset_name', 'attached_asset_area', 'attached_asset_ownership_form',
          'attached_asset_ownership_term', 'house', 'other_construction', 'production_forest',
          'perennial_crops', 'certificate_note', 'post_issue_change_content', 'unknown'
        ]
      },
      section_semantic: { type: 'string', enum: ['owners', 'land_details', 'attached_assets', 'other_assets', 'land_diagram', 'certificate_note', 'post_issue_changes', 'unknown'] },
      marker_raw: { type: 'string' },
      label_raw: { type: 'string' },
      label_canonical: { type: 'string' },
      value: { type: 'string' },
      value_raw: { type: 'string' },
      visual_order: { type: 'number' },
      confidence: { type: 'number' }
    },
    required: [
      'semantic_key', 'section_semantic', 'marker_raw', 'label_raw', 'label_canonical',
      'value', 'value_raw', 'visual_order', 'confidence'
    ]
  };
  const page = {
    type: 'object',
    additionalProperties: false,
    properties: {
      page_index: { type: 'number' },
      layout: {
        type: 'string',
        enum: [
          'gcn_qsdd_cover', 'gcn_qsdd_land', 'gcn_qsdd_change',
          'gcn_qsdd_qsh_nha_o_va_tsk_cover', 'gcn_qsdd_qsh_nha_o_va_tsk_land',
          'gcn_qsdd_qsh_nha_o_va_tsk_change', 'gcn_qsdd_qsh_tsglvd_page_1',
          'gcn_qsdd_qsh_tsglvd_page_2', 'unknown'
        ]
      },
      source_region: { type: 'string' },
      printed_lines: { type: 'array', items: { type: 'string' } },
      sections: { type: 'array', items: section },
      items: { type: 'array', items: item }
    },
    required: ['page_index', 'layout', 'source_region', 'printed_lines', 'sections', 'items']
  };
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      generation: {
        type: 'string',
        enum: ['gcn_qsdd', 'gcn_qsdd_qsh_nha_o_va_tsk', 'gcn_qsdd_qsh_tsglvd', 'unknown']
      },
      certificate_title: { type: 'string' },
      pages: { type: 'array', items: page },
      warnings: { type: 'array', items: { type: 'string' } }
    },
    required: ['generation', 'certificate_title', 'pages', 'warnings']
  };
}

function normalizeLandVisionSemanticDocument_(parsed) {
  parsed = parsed || {};
  const document = {
    generation: parsed.generation || 'unknown',
    certificate_title: String(parsed.certificate_title || '').trim(),
    source: 'OPENAI_VISION_SEMANTIC',
    model: CONFIG.OPENAI_MODEL_LOCKED,
    pages: [],
    items: [],
    unparsed_fragments: []
  };
  let documentOrder = 0;
  (parsed.pages || []).forEach(function(rawPage, pageIndex) {
    const page = {
      page_index: Number(rawPage.page_index == null ? pageIndex : rawPage.page_index),
      layout: rawPage.layout || 'unknown',
      source_region: rawPage.source_region || '',
      quality: { semantic_item_count: 0, land_candidate_score: 0 },
      sections: (rawPage.sections || []).map(function(rawSection) {
        return {
          semantic: rawSection.semantic || 'unknown',
          marker_raw: String(rawSection.marker_raw || ''),
          label_raw: String(rawSection.label_raw || ''),
          label_canonical: String(rawSection.label_canonical || ''),
          raw_lines: normalizeLandVisionLines_(rawSection.raw_lines || []),
          visual_order: Number(rawSection.visual_order || 0),
          items: []
        };
      }),
      printed_lines: normalizeLandVisionLines_(rawPage.printed_lines || []),
      items: [],
      unparsed_fragments: []
    };
    (rawPage.items || []).forEach(function(rawItem) {
      const item = {
        semantic_key: rawItem.semantic_key || 'unknown',
        section_semantic: rawItem.section_semantic || 'unknown',
        marker_raw: String(rawItem.marker_raw || ''),
        label_raw: String(rawItem.label_raw || ''),
        label_canonical: String(rawItem.label_canonical || ''),
        value: normalizeSemanticCertificateValue_(
          String(rawItem.value || ''),
          rawItem.semantic_key || 'unknown'
        ),
        value_raw: String(rawItem.value_raw || rawItem.value || ''),
        visual_order: Number(rawItem.visual_order == null ? documentOrder : rawItem.visual_order),
        confidence: Math.max(0, Math.min(1, Number(rawItem.confidence || 0))),
        evidence: {
          source: 'OPENAI_VISION_SEMANTIC',
          model: CONFIG.OPENAI_MODEL_LOCKED,
          page_index: page.page_index
        }
      };
      documentOrder++;
      page.items.push(item);
      document.items.push(item);
      const section = page.sections.filter(function(candidate) {
        return candidate.semantic === item.section_semantic;
      })[0];
      if (section) section.items.push(item);
      if (item.semantic_key === 'unknown') {
        page.unparsed_fragments.push(item);
        document.unparsed_fragments.push(item);
      }
    });
    page.quality.semantic_item_count = page.items.filter(function(item) {
      return item.semantic_key !== 'unknown';
    }).length;
    document.pages.push(page);
  });
  return document;
}

function normalizeLandVisionLines_(lines) {
  return (lines || []).map(function(line) {
    return String(line || '').replace(/\r/g, '\n').replace(/\s+/g, ' ').trim();
  }).filter(function(line) {
    return Boolean(line);
  });
}

function landVisionSummaryForExtraction_(results, fileId) {
  const match = (results || []).filter(function(result) {
    return result.file_id === fileId;
  })[0];
  if (!match) return null;
  return {
    model: CONFIG.OPENAI_MODEL_LOCKED,
    generation: match.document.generation,
    certificate_title: match.document.certificate_title,
    sections: match.document.pages.reduce(function(out, page) {
      return out.concat((page.sections || []).map(function(section) {
        const heading = [section.marker_raw, section.label_raw || section.label_canonical]
          .filter(Boolean)
          .join(' ')
          .trim();
        return {
          semantic: section.semantic,
          heading: heading,
          raw_lines: section.raw_lines || []
        };
      }));
    }, []),
    items: match.document.items.map(function(item) {
      return {
        semantic_key: item.semantic_key,
        section_semantic: item.section_semantic,
        label: item.label_raw || item.label_canonical,
        value: item.value,
        confidence: item.confidence
      };
    }),
    warnings: match.warnings || []
  };
}

function applyLandVisionSemanticsToAiData_(aiData, results) {
  aiData = aiData || {};
  const assets = aiData.assets || [];
  (results || []).forEach(function(result, resultIndex) {
    let asset = findAiAssetForLandVisionResult_(assets, result);
    if (!asset && assets.length === 1) asset = assets[0];
    if (!asset && resultIndex < assets.length) asset = assets[resultIndex];
    if (!asset) return;
    asset.certificate_semantic_document = result.document;
    asset.real_estate = asset.real_estate || {};
    if (result.document.certificate_title) {
      applyLandVisionAiField_(asset, 'certificate_title', result.document.certificate_title, 0.95, result.file_name);
      applyLandVisionAiField_(asset.real_estate, 'certificate_title', result.document.certificate_title, 0.95, result.file_name);
    }
    const fieldMap = {
      certificate_number: 'certificate_number',
      registry_number: 'registry_number',
      issue_date: 'issue_date',
      issuing_authority: 'issuing_authority',
      owner_line: 'certificate_owner_raw_text',
      owner_raw_text: 'certificate_owner_raw_text',
      land_plot_number: 'land_plot_number',
      map_sheet_number: 'map_sheet_number',
      land_address: 'land_address',
      area: 'area',
      area_in_words: 'area_in_words',
      usage_purpose: 'usage_purpose',
      usage_term: 'usage_term',
      usage_form: 'usage_form',
      usage_origin: 'usage_origin',
      attached_asset_name: 'attached_asset_name',
      attached_asset_area: 'attached_asset_area',
      attached_asset_ownership_form: 'attached_asset_ownership_form',
      attached_asset_ownership_term: 'attached_asset_ownership_term',
      certificate_note: 'certificate_note',
      post_issue_change_content: 'post_issue_changes'
    };
    Object.keys(fieldMap).forEach(function(semanticKey) {
      const candidates = result.document.items.filter(function(item) {
        return item.semantic_key === semanticKey && item.value && item.confidence >= 0.75;
      }).sort(function(a, b) {
        const aScoped = isExpectedLandVisionSection_(a) ? 1 : 0;
        const bScoped = isExpectedLandVisionSection_(b) ? 1 : 0;
        if (aScoped !== bScoped) return bScoped - aScoped;
        return b.confidence - a.confidence;
      });
      if (!candidates.length || !isExpectedLandVisionSection_(candidates[0])) return;
      applyLandVisionAiField_(
        asset.real_estate,
        fieldMap[semanticKey],
        candidates[0].value,
        candidates[0].confidence,
        result.file_name
      );
    });
    (result.warnings || []).forEach(function(message) {
      aiData.warnings = aiData.warnings || [];
      aiData.warnings.push({
        field_path: 'assets[].certificate_semantic_document',
        message: message,
        source_file: result.file_name
      });
    });
  });
  return aiData;
}

function findAiAssetForLandVisionResult_(assets, result) {
  return (assets || []).filter(function(asset) {
    const sourceFiles = [];
    if (typeof collectAiSourceFiles_ === 'function') collectAiSourceFiles_(asset, sourceFiles);
    return sourceFiles.indexOf(result.file_name) >= 0;
  })[0] || null;
}

function isExpectedLandVisionSection_(item) {
  const expected = {
    certificate_number: 'any',
    registry_number: 'any',
    issue_date: 'any',
    issuing_authority: 'any',
    owner_line: 'owners',
    owner_raw_text: 'owners',
    land_plot_number: 'land_details',
    map_sheet_number: 'land_details',
    land_address: 'land_details',
    area: 'land_details',
    area_in_words: 'land_details',
    usage_purpose: 'land_details',
    usage_term: 'land_details',
    usage_form: 'land_details',
    usage_origin: 'land_details',
    attached_asset_name: 'attached_assets',
    attached_asset_area: 'attached_assets',
    attached_asset_ownership_form: 'attached_assets',
    attached_asset_ownership_term: 'attached_assets',
    certificate_note: 'certificate_note',
    post_issue_change_content: 'post_issue_changes'
  };
  if (expected[item.semantic_key] === 'any') return true;
  return expected[item.semantic_key] === item.section_semantic;
}

function applyLandVisionAiField_(target, key, value, confidence, sourceFile) {
  if (!target || !key || !value) return;
  const current = target[key];
  const currentValue = current && typeof current === 'object' ? String(current.value || '') : String(current || '');
  const currentConfidence = current && typeof current === 'object' ? Number(current.confidence || 0) : 0;
  if (currentValue && currentConfidence > Number(confidence || 0)) return;
  target[key] = {
    value: value,
    confidence: Number(confidence || 0),
    source_file: sourceFile || '',
    evidence: 'Đọc trực tiếp ảnh/PDF và đối chiếu Google Vision OCR bằng ' + CONFIG.OPENAI_MODEL_LOCKED
  };
}

function parseOpenAiJsonResponse_(response) {
  if (response.output_text) return JSON.parse(response.output_text);
  const output = response.output || [];
  for (let i = 0; i < output.length; i++) {
    const content = output[i].content || [];
    for (let j = 0; j < content.length; j++) {
      if (content[j].type === 'output_text' && content[j].text) return JSON.parse(content[j].text);
      if (content[j].text) return JSON.parse(content[j].text);
    }
  }
  throw new Error('OpenAI response does not contain JSON output');
}

function getExtractionJsonSchema_() {
  const field = {
    type: 'object',
    additionalProperties: false,
    properties: {
      value: { type: 'string' },
      confidence: { type: 'number' },
      source_file: { type: 'string' },
      evidence: { type: 'string' }
    },
    required: ['value']
  };
  const person = {
    type: 'object',
    additionalProperties: false,
    properties: {
      role_hints: { type: 'array', items: { type: 'string' } },
      full_name: field,
      date_of_birth: field,
      gender: field,
      nationality: field,
      id_document_type: field,
      id_number: field,
      id_issue_date: field,
      id_issue_place: field,
      id_expiry_date: field,
      permanent_address: field,
      origin_place: field,
      vneid_current_address: field,
      marital_status: field,
      spouse: {
        type: 'object',
        additionalProperties: false,
        properties: {
          full_name: field,
          id_number: field
        }
      },
      marriage_registration: {
        type: 'object',
        additionalProperties: false,
        properties: {
          wife_name: field,
          husband_name: field,
          wife_id_number: field,
          husband_id_number: field,
          registration_date: field,
          registration_place: field
        }
      },
      marital_status_certificate: {
        type: 'object',
        additionalProperties: false,
        properties: {
          full_name: field,
          id_number: field,
          marital_status: field,
          issuing_authority: field,
          confirmation_date: field
        }
      }
    }
  };
  const asset = {
    type: 'object',
    additionalProperties: false,
    properties: {
      asset_type: field,
      certificate_title: field,
      owner_name: field,
      owner_identity_summary: field,
      owner_id_document_type: field,
      owner_id_number: field,
      owner_address: field,
      real_estate: {
        type: 'object',
        additionalProperties: false,
        properties: {
          certificate_number: field,
          certificate_title: field,
          registry_number: field,
          issuing_authority: field,
          issue_date: field,
          owner_or_user: field,
          owner_id_document_type: field,
          owner_id_number: field,
          owner_address: field,
          land_plot_number: field,
          map_sheet_number: field,
          land_address: field,
          area: field,
          area_in_words: field,
          usage_form: field,
          usage_purpose: field,
          usage_term: field,
          usage_origin: field,
          attached_assets: field,
          attached_asset_name: field,
          attached_asset_area: field,
          attached_asset_ownership_form: field,
          attached_asset_ownership_term: field,
          certificate_note: field,
          post_issue_changes: field,
          certificate_info_raw_text: field,
          certificate_owner_raw_text: field,
          certificate_land_raw_text: field,
          certificate_attached_raw_text: field
        }
      },
      movable: {
        type: 'object',
        additionalProperties: false,
        properties: {
          asset_category: field,
          brand: field,
          model_code: field,
          license_plate: field,
          chassis_number: field,
          engine_number: field,
          manufacture_year: field,
          manufacture_country: field,
          owner: field,
          registration_number: field,
          issue_date: field,
          issuing_authority: field,
          inspection_info: field
        }
      }
    }
  };
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      secured_parties: { type: 'array', items: person },
      obligors: { type: 'array', items: person },
      assets: { type: 'array', items: asset },
      conflicts: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            field_path: { type: 'string' },
            message: { type: 'string' },
            values: { type: 'array', items: { type: 'string' } },
            source_files: { type: 'array', items: { type: 'string' } }
          }
        }
      },
      warnings: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            field_path: { type: 'string' },
            message: { type: 'string' },
            source_file: { type: 'string' }
          }
        }
      }
    },
    required: ['secured_parties', 'obligors', 'assets', 'conflicts', 'warnings']
  };
}
