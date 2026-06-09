function sendReviewEmail(caseId, email, reviewUrl) {
  const recipient = normalizeRecipientEmail_(email);
  if (!recipient) {
    throw new Error('Invalid review email for case ' + caseId + '. Raw value: ' + JSON.stringify(email));
  }
  if (!reviewUrl) throw new Error('Missing review URL. Deploy Web App and set REVIEW_WEB_APP_URL first.');
  const subject = '[REVIEW HỒ SƠ] Hồ sơ ' + caseId + ' đã xử lý OCR xong';
  const body = [
    'Kính gửi Anh/Chị,',
    '',
    'Hồ sơ ' + caseId + ' đã được hệ thống xử lý OCR và trích xuất dữ liệu.',
    '',
    'Vui lòng bấm vào đường link dưới đây để kiểm tra, sửa đổi nếu cần và xác nhận dữ liệu trước khi sử dụng dữ liệu để soạn hợp đồng:',
    '',
    reviewUrl,
    '',
    'Nếu trình duyệt báo không có quyền hoặc tự đổi URL sang dạng /macros/u/.../s/..., vui lòng copy toàn bộ link trên và mở trong cửa sổ ẩn danh/incognito. Link Review được bảo vệ bằng token riêng của hồ sơ, không cần quyền Google Drive.',
    '',
    'Lưu ý:',
    '',
    '* Dữ liệu OCR có thể có sai sót.',
    '* Vui lòng kiểm tra kỹ các thông tin pháp lý quan trọng như họ tên, số CCCD, ngày cấp, nơi cấp, địa chỉ, thông tin tài sản.',
    '* Dữ liệu Anh/Chị sửa thủ công trên màn hình Review sẽ được ưu tiên sử dụng.',
    '',
    'Trân trọng.'
  ].join('\n');
  MailApp.sendEmail({
    to: recipient,
    subject: subject,
    body: body
  });
}

function normalizeRecipientEmail_(email) {
  const text = Array.isArray(email) ? email.join(' ') : String(email || '');
  const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0].trim() : '';
}

function sendGeneratedContractsEmail(caseId, email, generated) {
  if (!email) throw new Error('Missing email for generated contracts');
  generated = generated || [];
  const done = generated.filter(function(item) { return item.status === 'DONE'; });
  const errors = generated.filter(function(item) { return item.status === 'ERROR'; });
  const lines = [
    'Kinh gui Anh/Chi,',
    '',
    'Ho so ' + caseId + ' da duoc he thong soan thao hop dong Word theo cac mau da chon.',
    '',
    'Danh sach file da tao:'
  ];
  done.forEach(function(item, i) {
    lines.push('');
    lines.push((i + 1) + '. ' + item.template_name);
    if (item.docx_download_url) lines.push('Tai Word DOCX: ' + item.docx_download_url);
    else if (item.docx_url) lines.push('Word DOCX: ' + item.docx_url);
  });
  if (errors.length) {
    lines.push('');
    lines.push('Cac mau bi loi:');
    errors.forEach(function(item) {
      lines.push('- ' + item.template_name + ': ' + item.error);
    });
  }
  lines.push('');
  lines.push('Vui long kiem tra lai noi dung hop dong truoc khi ky/phat hanh.');
  lines.push('');
  lines.push('Tran trong.');
  MailApp.sendEmail({
    to: email,
    subject: '[HOP DONG DA SOAN] Ho so ' + caseId,
    body: lines.join('\n')
  });
}
