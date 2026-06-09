function testOcrOneFile() {
  const fileId = PropertiesService.getScriptProperties().getProperty('TEST_OCR_FILE_ID');
  if (!fileId) {
    throw new Error('Missing script property TEST_OCR_FILE_ID');
  }
  return testOcrOneFileById(fileId);
}

function testOcrOneFileById(fileId) {
  const file = DriveApp.getFileById(fileId);
  const fileMeta = {
    fileId: fileId,
    fileName: file.getName(),
    mimeType: file.getMimeType(),
    group: 'manual_test'
  };
  console.log('Testing OCR file: ' + JSON.stringify(fileMeta));
  const result = ocrSingleFile_(fileMeta);
  const text = result.text || '';
  console.log('OCR status: DONE');
  console.log('OCR text length: ' + text.length);
  console.log('OCR preview: ' + text.slice(0, 3000));
  return {
    file_id: fileId,
    file_name: fileMeta.fileName,
    mime_type: fileMeta.mimeType,
    text_length: text.length,
    text_preview: text.slice(0, 3000)
  };
}
