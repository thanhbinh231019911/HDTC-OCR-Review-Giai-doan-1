function setupSpreadsheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(SHEET_HEADERS).forEach(function(sheetName) {
    const sheet = getOrCreateSheet_(ss, sheetName);
    const headers = SHEET_HEADERS[sheetName];
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(headers);
      sheet.setFrozenRows(1);
    } else {
      const current = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), headers.length)).getValues()[0];
      const missing = headers.filter(function(h) { return current.indexOf(h) === -1; });
      if (missing.length) {
        sheet.getRange(1, current.length + 1, 1, missing.length).setValues([missing]);
      }
    }
  });
}

function getSheet(sheetName) {
  setupSpreadsheet();
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
}

function appendSheetRow(sheetName, rowObject) {
  const sheet = getSheet(sheetName);
  const headers = getHeaders_(sheet);
  const row = headers.map(function(header) {
    const value = rowObject[header];
    return typeof value === 'object' && value !== null ? jsonStringify(value) : (value === undefined ? '' : value);
  });
  sheet.appendRow(row);
}

function findSheetRowByValue(sheetName, headerName, value) {
  const sheet = getSheet(sheetName);
  const headers = getHeaders_(sheet);
  const col = headers.indexOf(headerName) + 1;
  if (col <= 0 || sheet.getLastRow() < 2) return null;
  const values = sheet.getRange(2, col, sheet.getLastRow() - 1, 1).getValues();
  for (let i = 0; i < values.length; i++) {
    if (String(values[i][0]) === String(value)) {
      const rowNumber = i + 2;
      const rowValues = sheet.getRange(rowNumber, 1, 1, headers.length).getValues()[0];
      const obj = {};
      headers.forEach(function(h, idx) { obj[h] = rowValues[idx]; });
      obj._rowNumber = rowNumber;
      return obj;
    }
  }
  return null;
}

function updateSheetRow(sheetName, rowNumber, updates) {
  const sheet = getSheet(sheetName);
  const headers = getHeaders_(sheet);
  Object.keys(updates).forEach(function(header) {
    const col = headers.indexOf(header) + 1;
    if (col > 0) sheet.getRange(rowNumber, col).setValue(updates[header]);
  });
}

function getCaseRow(caseId) {
  return findSheetRowByValue(SHEETS.CASES, 'Case ID', caseId);
}

function updateCase(caseId, updates) {
  const row = getCaseRow(caseId);
  if (!row) throw new Error('Case not found: ' + caseId);
  updateSheetRow(SHEETS.CASES, row._rowNumber, updates);
}

function getLatestExtractedData(caseId) {
  const rows = getRowsByCaseId_(SHEETS.EXTRACTED_DATA, caseId);
  if (!rows.length) return null;
  return parseJsonSafe(rows[rows.length - 1]['JSON Data'], null);
}

function getLatestFinalData(caseId) {
  const rows = getRowsByCaseId_(SHEETS.FINAL_DATA, caseId);
  if (!rows.length) return null;
  return parseJsonSafe(rows[rows.length - 1]['Final JSON'], null);
}

function getOverrides(caseId) {
  return getRowsByCaseId_(SHEETS.REVIEW_OVERRIDES, caseId).map(function(row) {
    return {
      field_path: row['Field Path'],
      field_label: row['Field Label'],
      old_value: row['Old Value'],
      new_value: row['New Value'],
      edited_by: row['Edited By'],
      edited_at: row['Edited At'],
      reason: row['Reason']
    };
  });
}

function getRowsByCaseId_(sheetName, caseId) {
  const sheet = getSheet(sheetName);
  const headers = getHeaders_(sheet);
  if (sheet.getLastRow() < 2) return [];
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
  return data.filter(function(row) {
    return String(row[0]) === String(caseId);
  }).map(function(row) {
    const obj = {};
    headers.forEach(function(h, idx) { obj[h] = row[idx]; });
    return obj;
  });
}

function getHeaders_(sheet) {
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
}

function getOrCreateSheet_(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}
