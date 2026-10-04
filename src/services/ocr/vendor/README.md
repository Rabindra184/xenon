# Vendored OCR language data

`eng.traineddata.gz` is the English model every OCR worker reads
(`ocrData.ts`): Omni-Vision's text search and the OCR healing tier.

## Why vendor it

Left to its defaults, tesseract.js downloads `eng.traineddata` from
cdn.jsdelivr.net when a worker starts, and caches it in the process's working
directory. A server with no internet could not run OCR at all: the first OCR
call never finished, and every later one waited for it. A server with internet
left a 5 MB `eng.traineddata` in whatever directory it was started from.
Workers now read this file (`langPath`) and cache nothing (`cacheMethod: 'none'`).

## Provenance

- **Data**: Tesseract's English LSTM model, the integer "best" variant, the
  one tesseract.js 7 downloads by default (its default engine is LSTM only)
- **Source**: `@tesseract.js-data/eng@1.0.0`, file
  `4.0.0_best_int/eng.traineddata.gz`, copied byte for byte
- **Upstream**: tesseract-ocr/tessdata_best (Apache License 2.0), in
  `LICENSE-tessdata.txt`. The npm package that repackages it declares MIT.
- **File**: `eng.traineddata.gz`, 2,952,873 bytes
  - SHA256: `45b4cb346724ac1774f1c36f42f182b887bcdb28ebe63e6fff90ac41f3fcff91`
  - Unzipped: 5,199,098 bytes, SHA256
    `5dc5d8d640a212c9d6184921ba103b186f50e0fed9ee716c53e6b312b400d747`
    (the `eng.traineddata` tesseract.js used to cache)

`ocrData.ts` checks the SHA256 before a worker starts. Given data it can't
load, tesseract.js 7 throws from its own message handler, which would end the
server; a damaged file is refused instead.

## Bump procedure

1. `npm pack @tesseract.js-data/eng@<version>` and take the file tesseract.js's
   default `langPath` names (`4.0.0_best_int/eng.traineddata.gz` for 7.x).
2. Replace `eng.traineddata.gz` with it.
3. Update the SHA256 here and `OCR_DATA_SHA256` in `../ocrData.ts`
   (`ocr-offline.spec.ts` checks the three agree).

`build:copy` copies the `.gz` and `.txt` files of this directory into `lib/`,
and `lib/` is what the npm package ships.
