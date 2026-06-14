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

- `Giấy chứng nhận quyền sử dụng đất, quyền sở hữu tài sản gắn liền với đất`
- `Giấy chứng nhận quyền sử dụng đất, quyền sở hữu nhà ở và tài sản khác gắn liền với đất`
- `Giấy chứng nhận quyền sử dụng đất`

Rules:

- OCR/certificate type controls the contract wording.
- Do not hard-code only `Giấy chứng nhận quyền sử dụng đất`.
- In contract text, write the matching type at `theo ... so ...`.
- Correct clear OCR typo variants such as `hwuux`, `hwux`, `huux` in `quyen so huu` to `huu`.

## Field Extraction

- Use section/index boundaries such as `II`, `1`, `2`, `a)`, `b)`, `c)`, `d)`, `e)`, `g)`.
- A field continues until the next section/index boundary.
- Do not take only the last wrapped line.
- Do not move content between fields.

## Usage Term

- Extract from item `e)` on the certificate.
- Do not force a fixed value such as `lâu dài`.
- Keep real phrases such as `Den ngay ...`, `Su dung den ...`, or other certificate wording.
- Correct only obvious OCR typos inside this field, for example `Lâu đài` to `Lâu dài`, preserving case as much as possible.

## Contract Generation

- The Word template is only a presentation frame.
- Asset description must match the certificate data.
- If a field exists on the certificate, include it.
- If a field is absent on the certificate, do not add sample/template text.
- Usage origin, attached assets, and post-issue changes appear only when there is real content.
- Table headings, signature text, blank values, `-/-`, or `Chua chung nhan quyen so huu` are not real descriptive content.

## Output Contract

Every extracted field should carry:

- value
- source file
- source type, for example `GOOGLE_OCR`, `OPENAI_TEXT`, `MANUAL`
- confidence or status
- evidence text when available

For unclear certificate fields, leave blank or mark manual review instead of inventing content.
