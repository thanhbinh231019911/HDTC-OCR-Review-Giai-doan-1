# Core Rules: OCR Bia Dat

## Scope

This skill owns only land-certificate/property-certificate extraction:

- certificate title
- certificate number
- registry number
- issuing authority
- issue date
- land plot number
- map sheet number
- land address
- area and area in words
- usage form
- usage purpose
- usage term
- usage origin
- attached assets
- post-issue changes
- contract asset-description text

It must not contain CCCD/Can cuoc identity-card rules.

## Certificate Title

Recognize at least these standard title types:

- Giấy chứng nhận quyền sử dụng đất, quyền sở hữu tài sản gắn liền với đất
- Giấy chứng nhận quyền sử dụng đất, quyền sở hữu nhà ở và tài sản khác gắn liền với đất
- Giấy chứng nhận quyền sử dụng đất

Rules:

- OCR/certificate type controls the contract wording.
- Do not hard-code only `Giấy chứng nhận quyền sử dụng đất`.
- In contract text, write the matching type at `theo ... số ...`.
- Correct clear OCR typo variants such as `hwuux`, `hwux`, `huux` in `quyền sở hữu` to `hữu`.

## Field Extraction

- Use section/index boundaries such as `II`, `1`, `2`, `a)`, `b)`, `c)`, `d)`, `đ)`, `e)`, `g)`.
- A field continues until the next section/index boundary.
- Section/index markers such as `a)`, `b)`, `c)`, `d)`, `đ)`, `e)`, and `g)` are boundaries only. They do not define field meaning by themselves.
- If OCR attaches the next section/index marker to the end of the previous value, for example `Sử dụng riêng đ`, remove that trailing marker from the previous field value.
- Field meaning must come from the actual label printed/read on the certificate, for example `Hình thức sử dụng`, `Mục đích sử dụng`, `Thời hạn sử dụng`, `Diện tích`, or `Nguồn gốc sử dụng`.
- If another certificate uses a different printed label such as `Loại đất`, preserve that label in the certificate text/review and do not force it into `Mục đích sử dụng` unless a mapping rule has been explicitly agreed.
- Do not take only the last wrapped line.
- Do not move content between fields.
- Apply a broad rule only when it is genuinely layout-wide, such as section boundary handling or wrapped-line handling.
- Keep field-specific repairs scoped to that field. Do not put a fix for one field in a shared cleanup helper if it can change other certificate fields.
- When repairing review data from stored OCR, include a text block as land-certificate asset OCR if its content contains certificate/land markers. Do not rely only on file group, filename prefix, or even filename presence, because lab/prod uploads may lose metadata.
- In the OCR Bia dat lab form, uploaded certificate files must be routed as asset files. If an installed trigger calls the wrong lab handler, resolve the lab type again from the actual Google Form ID, form title, or submitted upload-question title before creating the case.
- After OCR, if the OCR text itself clearly matches a land/property certificate, classify that OCR result as asset even if the original upload group was wrong. Do not apply the reverse rule to identity-card OCR.
- Optional item `Ghi chú` must stop at later certificate boundaries such as `Số vào sổ cấp GCN/Giấy chứng nhận`, section `IV`, or the next numbered section. Do not let registry/date/map text become note content.

## Registry Number

Scope: `So vao so cap GCN` / `So vao so cap Giay chung nhan`.

Rules:

- Extract by the registry-label context, not by scanning the whole certificate for code-like text.
- Accept labels with or without `:` because OCR may drop punctuation.
- Treat `So vao so cap GCN` as including OCR variants of Vietnamese diacritics, including cases where `so` is read for `so/so`.
- Take the short text region on the same line or immediately after the registry label.
- Remove the printed dotted fill line only when OCR reads it as a run of dots, for example `........`.
- Preserve a single punctuation mark such as `.`, `/`, or `-` when OCR reads it inside the candidate value; it may be handwritten.
- Remove internal spaces only. Do not invent punctuation. Examples: `CS 03027` -> `CS03027`; `CL 2017` -> `CL2017`; `CL.2017` -> `CL.2017`.
- Reject partial numeric-only values such as `027`; leave blank or warn for manual review.
- Do not use certificate serial numbers such as `CO402507` as registry numbers.
- If the full value is handwritten over a dotted line and OCR reads only the tail, add a warning or use a dedicated crop/OCR pass for this registry region; do not infer the missing prefix.
- The crop/OCR pass for registry number must remain field-specific: find the registry label region, crop around that line, OCR only that crop, and write only `assets[].real_estate.registry_number`.

## Usage Form

- Extract from item `d)` on the certificate.
- Do not hard-code `Riêng` or `Chung`; take the real text after `d)` until the next indexed item.
- If OCR/indexed extraction reads the `d)` value as one field, display it as one review line.
- If the certificate/OCR truly has multiple lines inside the same `d)` value, preserve the field content, but do not split because of parser artifacts.

## Usage Term

- Extract from item `e)` on the certificate.
- Do not force a fixed value such as `lâu dài`.
- Keep real phrases such as `Đến ngày ...`, `Sử dụng đến ...`, or other certificate wording.
- Correct only obvious OCR typos inside this field, for example `Lâu đài` to `Lâu dài`, preserving case as much as possible.

## Contract Generation

- The Word template is only a presentation frame.
- Asset description must match the certificate data.
- If a field exists on the certificate, include it.
- If a field is absent on the certificate, do not add sample/template text.
- Usage origin, attached assets, and post-issue changes appear only when there is real content.
- Table headings, signature text, blank values, `-/-`, or `Chưa chứng nhận quyền sở hữu` are not real descriptive content.

## Output Contract

Every extracted field should carry:

- value
- source file
- source type, for example `GOOGLE_OCR`, `OPENAI_TEXT`, `MANUAL`
- confidence or status
- evidence text when available

For unclear certificate fields, leave blank or mark manual review instead of inventing content.
