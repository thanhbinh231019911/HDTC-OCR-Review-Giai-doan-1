---
name: ocr-bia-dat
description: OCR and review workflow for Vietnamese land certificates and property certificate covers in the mortgage contract project. Use when fixing or analyzing certificate title, GCN number, registry number, issuing authority, issue date, land address, area, usage term, usage origin, attached assets, post-issue changes, or contract asset-description generation.
---

# OCR Bia Dat

Use this skill before editing any code that reads land-certificate or property-certificate data.

## Required Workflow

1. Reproduce from actual OCR text and certificate image evidence first.
2. Keep land-certificate OCR logic separate from CCCD/Can cuoc logic.
3. Treat the Word template as presentation only; contract data must follow the certificate.
4. Extract by certificate section/index when layout shifts across lines.
5. Preserve wording, punctuation, and field scope when OCR is clear.
6. Correct only obvious OCR typos inside the same field.
7. Add tests for the exact certificate layout or OCR typo before changing rules.

## Contract Rule

For template 03b and later templates, the sentence:

`theo [ten loai GCN] so [so GCN]`

must use the certificate title read from OCR/certificate cover. Do not hard-code one certificate title.

## References

Read `references/core-rules.md` before implementing or reviewing land-certificate OCR changes.
