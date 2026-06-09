function extractDataWithAi(caseId, formData, ocrResults, folders) {
  updateCase(caseId, { 'Status': CASE_STATUS.AI_RUNNING });
  logAudit(caseId, 'AI_EXTRACTION_STARTED', { ocr_files: ocrResults.length });
  const apiKey = PropertiesService.getScriptProperties().getProperty(CONFIG.OPENAI_API_KEY_PROPERTY);
  if (!apiKey) throw new Error('Missing script property ' + CONFIG.OPENAI_API_KEY_PROPERTY);

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
        text: truncateForAi(item.text)
      };
    })
  };
  const payload = {
    model: PropertiesService.getScriptProperties().getProperty('OPENAI_MODEL') || CONFIG.OPENAI_MODEL_DEFAULT,
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

  const extracted = parseOpenAiJsonResponse_(response);
  const aiFile = saveJsonFile(folders.subfolders['03_AI_JSON'].id, caseId + '_ai_extracted.json', extracted);
  updateCase(caseId, { 'Status': CASE_STATUS.AI_DONE });
  logAudit(caseId, 'AI_EXTRACTION_DONE', { ai_json_url: aiFile.url });
  return { data: extracted, fileUrl: aiFile.url };
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
          land_plot_number: field,
          map_sheet_number: field,
          land_address: field,
          area: field,
          usage_form: field,
          usage_purpose: field,
          usage_term: field,
          usage_origin: field,
          attached_assets: field,
          post_issue_changes: field
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
