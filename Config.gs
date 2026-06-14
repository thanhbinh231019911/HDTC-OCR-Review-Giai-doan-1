const CONFIG = {
  APP_NAME: 'He thong OCR va Review hop dong the chap - Giai doan 1',
  ROOT_FOLDER_NAME: 'Hop_dong_the_chap',
  CASE_ID_PREFIX: 'HDTC',
  DEFAULT_OCR_ENGINE: 'CLOUD_VISION', // CLOUD_VISION for images; Drive OCR remains fallback for PDF/Word
  OCR_LANGUAGE: 'vi',
  OPENAI_ENDPOINT: 'https://api.openai.com/v1/responses',
  OPENAI_MODEL_DEFAULT: 'gpt-5.4-mini',
  DEFAULT_REVIEW_WEB_APP_URL: 'https://script.google.com/macros/s/AKfycbyXkDTtk4PVPzjdCwy1duKEtbqJrNUHlbsF7TO_jTaMJ1JCCz8PJUf7vzerZijF1KyD/exec',
  MAX_OCR_TEXT_CHARS_PER_REQUEST: 120000,
  MAX_API_RETRIES: 3,
  OCR_MAX_RETRIES: 5,
  OCR_RETRY_BASE_SLEEP_MS: 30000,
  OCR_SLEEP_BETWEEN_FILES_MS: 8000,
  REVIEW_TOKEN_BYTES: 32,
  REVIEW_WEB_APP_URL_PROPERTY: 'REVIEW_WEB_APP_URL',
  OPENAI_API_KEY_PROPERTY: 'OPENAI_API_KEY',
  CLOUD_VISION_API_KEY_PROPERTY: 'CLOUD_VISION_API_KEY',
  CONTRACT_TEMPLATE_CONFIG_PROPERTY: 'CONTRACT_TEMPLATE_CONFIG_JSON',
  FORM_FIELDS: {
    reviewEmail: 'Email ng\u01b0\u1eddi nh\u1eadn link Review',
    assetType: 'Lo\u1ea1i t\u00e0i s\u1ea3n',
    contractType: 'Lo\u1ea1i h\u1ee3p \u0111\u1ed3ng',
    assetCount: 'S\u1ed1 l\u01b0\u1ee3ng t\u00e0i s\u1ea3n b\u1ea3o \u0111\u1ea3m',
    bankSigner: 'Ng\u01b0\u1eddi k\u00fd h\u1ee3p \u0111\u1ed3ng t\u1ea1i ng\u00e2n h\u00e0ng',
    disputeCourt: 'T\u00f2a \u00e1n x\u1eed l\u00fd tranh ch\u1ea5p',
    valuationAmount: 'Gi\u00e1 tr\u1ecb \u0111\u1ecbnh gi\u00e1',
    securedPartyFiles: 'Upload h\u1ed3 s\u01a1 B\u00ean b\u1ea3o \u0111\u1ea3m/ch\u1ee7 t\u00e0i s\u1ea3n',
    obligorFiles: 'Upload h\u1ed3 s\u01a1 B\u00ean \u0111\u01b0\u1ee3c b\u1ea3o \u0111\u1ea3m',
    assetFiles: 'Upload h\u1ed3 s\u01a1 t\u00e0i s\u1ea3n'
  },
  SUBFOLDERS: [
    '01_Uploaded_Files',
    '02_OCR_Text',
    '03_AI_JSON',
    '04_Review_Data',
    '05_Final_Data',
    '06_Logs',
    '07_Contract_Output'
  ]
};

const DEFAULT_CONTRACT_TEMPLATES = [
  {
    code: '03a_bds_chinh_chu',
    name: '03a - HDTC bat dong san cua ben duoc cap tin dung',
    asset_type: 'Báº¥t Ä‘á»™ng sáº£n',
    contract_type: 'BÃªn báº£o Ä‘áº£m tháº¿ cháº¥p cho chÃ­nh nghÄ©a vá»¥ cá»§a mÃ¬nh',
    template_doc_id: '',
    output_formats: ['DOCX']
  },
  {
    code: '03b_bds_ben_thu_ba',
    name: '03b - HDTC bat dong san bao dam nghia vu nguoi khac',
    asset_type: 'Báº¥t Ä‘á»™ng sáº£n',
    contract_type: 'BÃªn báº£o Ä‘áº£m tháº¿ cháº¥p cho nghÄ©a vá»¥ cá»§a bÃªn thá»© ba',
    template_doc_id: '',
    output_formats: ['DOCX']
  },
  {
    code: '03c_bds_ts_chua_chung_nhan_chinh_chu',
    name: '03c - HDTC bat dong san/tai san chua duoc chung nhan cua ben duoc cap tin dung',
    asset_type: 'Báº¥t Ä‘á»™ng sáº£n',
    contract_type: 'BÃªn báº£o Ä‘áº£m tháº¿ cháº¥p cho chÃ­nh nghÄ©a vá»¥ cá»§a mÃ¬nh',
    template_doc_id: '',
    output_formats: ['DOCX']
  },
  {
    code: '03d_bds_ts_chua_chung_nhan_ben_thu_ba',
    name: '03d - HDTC bat dong san/tai san chua duoc chung nhan bao dam nghia vu nguoi khac',
    asset_type: 'Báº¥t Ä‘á»™ng sáº£n',
    contract_type: 'BÃªn báº£o Ä‘áº£m tháº¿ cháº¥p cho nghÄ©a vá»¥ cá»§a bÃªn thá»© ba',
    template_doc_id: '',
    output_formats: ['DOCX']
  },
  {
    code: '02a_dong_san_chinh_chu',
    name: '02a - HDTC dong san cua ben duoc cap tin dung',
    asset_type: 'Äá»™ng sáº£n',
    contract_type: 'BÃªn báº£o Ä‘áº£m tháº¿ cháº¥p cho chÃ­nh nghÄ©a vá»¥ cá»§a mÃ¬nh',
    template_doc_id: '',
    output_formats: ['DOCX']
  },
  {
    code: '02b_dong_san_ben_thu_ba',
    name: '02b - HDTC dong san bao dam nghia vu nguoi khac',
    asset_type: 'Äá»™ng sáº£n',
    contract_type: 'BÃªn báº£o Ä‘áº£m tháº¿ cháº¥p cho nghÄ©a vá»¥ cá»§a bÃªn thá»© ba',
    template_doc_id: '',
    output_formats: ['DOCX']
  },
  {
    code: '17_uy_quyen_xu_ly_tai_san',
    name: '17 - Hop dong uy quyen xu ly tai san',
    asset_type: '',
    contract_type: '',
    template_doc_id: '',
    output_formats: ['DOCX']
  },
  {
    code: 'bm05a_phieu_ban_giao_ho_so',
    name: 'BM 05a TSBD - Phieu ban giao ho so',
    asset_type: '',
    contract_type: '',
    template_doc_id: '',
    output_formats: ['DOCX']
  },
  {
    code: 'bctd_mau_moi',
    name: 'BCTD mau moi',
    asset_type: '',
    contract_type: '',
    template_doc_id: '',
    output_formats: ['DOCX']
  },
  {
    code: 'bbdg_bds_mau_moi',
    name: 'BBDG bat dong san mau moi',
    asset_type: 'Bất động sản',
    contract_type: '',
    template_doc_id: '',
    output_formats: ['DOCX']
  },
  {
    code: 'mau01a_dktc',
    name: 'Mau 01a - Dang ky the chap',
    asset_type: '',
    contract_type: '',
    template_doc_id: '',
    output_formats: ['DOCX']
  },
  {
    code: 'bbgn_tc',
    name: 'BBGN_TC',
    asset_type: '',
    contract_type: '',
    template_doc_id: '',
    output_formats: ['DOCX']
  }
];

const SHEETS = {
  RESPONSES: 'RESPONSES',
  CASES: 'CASES',
  OCR_RESULTS: 'OCR_RESULTS',
  EXTRACTED_DATA: 'EXTRACTED_DATA',
  REVIEW_OVERRIDES: 'REVIEW_OVERRIDES',
  FINAL_DATA: 'FINAL_DATA',
  GENERATED_CONTRACTS: 'GENERATED_CONTRACTS',
  AUDIT_LOGS: 'AUDIT_LOGS'
};

const CASE_STATUS = {
  CREATED: 'CREATED',
  OCR_RUNNING: 'OCR_RUNNING',
  OCR_DONE: 'OCR_DONE',
  AI_RUNNING: 'AI_RUNNING',
  AI_DONE: 'AI_DONE',
  REVIEW_SENT: 'REVIEW_SENT',
  REVIEW_CONFIRMED: 'REVIEW_CONFIRMED',
  REVIEW_CONFIRMED_WITH_WARNINGS: 'REVIEW_CONFIRMED_WITH_WARNINGS',
  ERROR: 'ERROR'
};

const SHEET_HEADERS = {
  RESPONSES: [
    'Timestamp', 'Case ID', 'Review Email',
    'Asset Type', 'Contract Type', 'Asset Count', 'Bank Signer', 'Dispute Court',
    'Valuation Amount', 'Raw Form JSON'
  ],
  CASES: [
    'Case ID', 'Review Email', 'Status', 'Drive Folder URL', 'Review URL',
    'Review Token Hash', 'Created At', 'OCR Done At', 'Email Sent At',
    'Review Confirmed At', 'Last Error'
  ],
  OCR_RESULTS: [
    'Case ID', 'File Name', 'File ID', 'File Type', 'OCR Text',
    'OCR Status', 'Confidence', 'OCR Text File URL', 'Created At'
  ],
  EXTRACTED_DATA: [
    'Case ID', 'JSON Data', 'Validation Status', 'Missing Fields',
    'Conflicts', 'Warnings', 'AI JSON File URL', 'Created At'
  ],
  REVIEW_OVERRIDES: [
    'Case ID', 'Field Path', 'Field Label', 'Old Value', 'New Value',
    'Edited By', 'Edited At', 'Reason'
  ],
  FINAL_DATA: [
    'Case ID', 'Final JSON', 'Review Status', 'Confirmed By', 'Confirmed At',
    'Final JSON File URL'
  ],
  GENERATED_CONTRACTS: [
    'Case ID', 'Template Code', 'Template Name', 'Google Doc URL', 'DOCX URL',
    'PDF URL', 'Generated By', 'Generated At', 'Email Sent To', 'Status',
    'Error'
  ],
  AUDIT_LOGS: [
    'Case ID', 'Action', 'Detail', 'User', 'Timestamp'
  ]
};

const CRITICAL_FIELD_PATHS = [
  'secured_parties[].full_name',
  'secured_parties[].id_number',
  'assets[].asset_type',
  'assets[].owner_name'
];

function getAiExtractionPrompt() {
  return [
    'Báº¡n lÃ  há»‡ thá»‘ng bÃ³c tÃ¡ch dá»¯ liá»‡u há»“ sÆ¡ phÃ¡p lÃ½ Viá»‡t Nam cho há»£p Ä‘á»“ng tháº¿ cháº¥p ngÃ¢n hÃ ng.',
    'Chá»‰ tráº£ vá» JSON há»£p lá»‡ theo schema. KhÃ´ng tá»± bá»‹a dá»¯ liá»‡u.',
    'Náº¿u OCR khÃ´ng cÃ³ cÄƒn cá»© rÃµ rÃ ng, Ä‘á»ƒ value rá»—ng, confidence tháº¥p, vÃ  Ä‘Æ°a vÃ o warnings.',
    'KhÃ´ng tá»± sá»­a há» tÃªn, sá»‘ CCCD, sá»‘ giáº¥y chá»©ng nháº­n, sá»‘ thá»­a, sá»‘ khung, sá»‘ mÃ¡y.',
    'Náº¿u cÃ³ nhiá»u cÃ¡ nhÃ¢n, táº¡o nhiá»u object person. Náº¿u cÃ¹ng sá»‘ CCCD thÃ¬ coi lÃ  cÃ¹ng ngÆ°á»i.',
    'BÃ³c tÃ¡ch loáº¡i giáº¥y tá» tÃ¹y thÃ¢n vÃ o id_document_type/owner_id_document_type náº¿u OCR cÃ³ cÄƒn cá»©: "Chá»©ng minh nhÃ¢n dÃ¢n", "CÄƒn cÆ°á»›c cÃ´ng dÃ¢n", hoáº·c "CÄƒn cÆ°á»›c".',
    'Khong tao warning khi OCR doc duoc "Can cuoc" nhung bo cuc giong CCCD, hoac nguoc lai. "Can cuoc" va "Can cuoc cong dan" deu la loai giay to hop le trong giai doan review.',
    'Vá»›i sá»‘ CCCD/CÄƒn cÆ°á»›c 12 sá»‘ cá»§a Viá»‡t Nam, giá»›i tÃ­nh cÃ³ thá»ƒ suy luáº­n tá»« chá»¯ sá»‘ thá»© 4: sá»‘ cháºµn lÃ  Nam, sá»‘ láº» lÃ  Ná»¯.',
    'Vá»›i CCCD, id_issue_place chá»‰ dÃ¹ng má»™t trong hai giÃ¡ trá»‹ náº¿u cÃ³ cÄƒn cá»© OCR: "Bá»™ CÃ´ng an" hoáº·c "Cá»¥c Cáº£nh sÃ¡t quáº£n lÃ½ hÃ nh chÃ­nh vá» tráº­t tá»± xÃ£ há»™i"; bá» cÃ¡c tiá»n tá»‘ chá»©c danh nhÆ° "Cá»¥c trÆ°á»Ÿng".',
    'Voi ngay cap CCCD/Can cuoc, chi trich id_issue_date khi OCR doc ro ngay gan nhan "Ngay, thang, nam / Date, month, year" hoac "Ngay, thang, nam cap / Date of issue" theo dinh dang dd/MM/yyyy, dd-MM-yyyy, dd.MM.yyyy hoac ddMMyyyy toan so. Khong duoc tu suy luan tu OCR hong nhu "Oro712021"; neu khong ro thi de trong va warning de he thong Vision/nguoi dung kiem tra.',
    'Vá»›i giáº¥y chá»©ng nháº­n quyá»n sá»­ dá»¥ng Ä‘áº¥t, bÃ³c tÃ¡ch cáº£ sá»‘ giáº¥y tá» tÃ¹y thÃ¢n cá»§a chá»§ sá»Ÿ há»¯u/chá»§ sá»­ dá»¥ng trÃªn bÃ¬a Ä‘áº¥t vÃ o assets[].owner_id_number hoáº·c assets[].real_estate.owner_id_number; sá»‘ nÃ y cÃ³ thá»ƒ lÃ  CMND 9 sá»‘ hoáº·c CCCD 12 sá»‘.',
    'Voi giay chung nhan quyen su dung dat, boc tach dung ten giay chung nhan theo OCR/bia dat vao assets[].certificate_title. Co 03 loai ten bia dat can chuan hoa dung: "Giấy chứng nhận quyền sử dụng đất, quyền sở hữu tài sản gắn liền với đất"; "Giấy chứng nhận quyền sử dụng đất, quyền sở hữu nhà ở và tài sản khác gắn liền với đất"; "Giấy chứng nhận quyền sử dụng đất". OCR/bia dat thuoc loai nao thi ghi dung loai do trong review va hop dong, khong hard-code mot loai duy nhat. Chi sua loi OCR chinh ta ro rang nhu "hwuux"/"hwux"/"huux" thanh "hữu".',
    'Voi trang thong tin cua Giay chung nhan, bat buoc ghi nguyen van cac block OCR vao assets[].real_estate.certificate_info_raw_text, certificate_owner_raw_text, certificate_land_raw_text, certificate_attached_raw_text. Giu dung so muc I, 1, 2, a), b), c), dau cham, dau phay, thu tu dong theo OCR; khong tu doi "Muc dich su dung" thanh "Loai dat"; khong dao thu tu dia chi/dien tich/hinh thuc su dung.',
    'Voi muc I. Nguoi su dung dat, chu so huu nha o va tai san khac gan lien voi dat tren Giay chung nhan, neu co dia chi thi bat buoc trich vao assets[].owner_address hoac assets[].real_estate.owner_address, giu dung noi dung dia chi theo OCR.',
    'Neu dien tich tren Giay chung nhan co dong bang chu, trich rieng vao assets[].real_estate.area_in_words. Neu OCR khong co dong bang chu thi de trong, khong tu suy dien.',
    'Voi So GCN va So vao so cap GCN, boc tach dung chu va so, neu OCR co dau cach trong ma thi van tra ve gia tri khong co dau cach noi bo.',
    'Náº¿u giáº¥y chá»©ng nháº­n cÃ³ nhiá»u Ä‘á»“ng chá»§ sá»Ÿ há»¯u/chá»§ sá»­ dá»¥ng, giá»¯ Ä‘Ãºng thá»© tá»± trÃªn bÃ¬a Ä‘áº¥t vÃ  táº¡o owner_identity_summary dáº¡ng: "TÃªn ngÆ°á»i - loáº¡i giáº¥y tá» sá»‘ sá»‘_giáº¥y_tá»; TÃªn ngÆ°á»i - loáº¡i giáº¥y tá» sá»‘ sá»‘_giáº¥y_tá»".',
    'KhÃ´ng cáº£nh bÃ¡o thiáº¿u nguá»“n gá»‘c sá»­ dá»¥ng Ä‘áº¥t náº¿u phÃ´i giáº¥y chá»©ng nháº­n má»›i khÃ´ng cÃ³ má»¥c nÃ y.',
    'Náº¿u cÃ³ mÃ¢u thuáº«n giá»¯a file, giá»¯ tá»«ng giÃ¡ trá»‹ nguá»“n vÃ  Ä‘Æ°a vÃ o conflicts.',
    'Náº¿u cÃ³ VNeID vÃ  CCCD khÃ¡c Ä‘á»‹a chá»‰, ghi cáº£ hai nguá»“n, Ä‘á» xuáº¥t Æ°u tiÃªn VNeID, vÃ  thÃªm conflict/warning Ä‘á»ƒ ngÆ°á»i dÃ¹ng xÃ¡c nháº­n.',
    'Táº¥t cáº£ field quan trá»ng pháº£i cÃ³ evidence gá»“m file_name vÃ  snippet OCR ngáº¯n náº¿u tÃ¬m tháº¥y.'
  ].join('\n');
}
