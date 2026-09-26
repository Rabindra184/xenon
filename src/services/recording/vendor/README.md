# Vendored font for annotation burn-in

`Inter-Regular.ttf` is the font `AnnotationRenderService` passes to ffmpeg's
`drawtext` as `fontfile=`, so `TEXT` annotations render into recordings.

## Why vendor a font

The bundled ffmpeg (`@ffmpeg-installer/ffmpeg`, 4.4) has libfreetype but no
fontconfig. `drawtext` without a `fontfile=` therefore fails with "No font
filename provided", and the whole annotated render failed with it. A system
font path cannot be relied on across macOS, Linux and Windows.

## Provenance

- **Font**: Inter, Regular (400), Latin subset (ASCII plus Latin-1, including
  accented letters such as é, ñ and ü)
- **License**: SIL Open Font License 1.1, in `Inter-OFL.txt`. No Reserved Font
  Name is declared, so format conversion and redistribution are permitted.
- **Source**: `@fontsource/inter@5.3.0`, file `files/inter-latin-400-normal.woff`
  (already a dashboard dependency)
  - Source SHA256: `e20fa0b4fd2dd26e4d14b3ac3cc922509c3a63fa5e910e90c614544aa042dd45`
- **File**: `Inter-Regular.ttf`, 67,952 bytes
  - SHA256: `d3641a4ba1f6c109b1ef87b3cd32262b4a10dec9e61274dd749bdd3f75437d91`

## How it was produced

The source is WOFF 1.0, which is TrueType tables that are each
zlib-compressed. FreeType reads WOFF only when it was built with zlib, and
that cannot be assumed for every platform's ffmpeg, so the file was converted
losslessly back to TTF:

1. Inflate each table.
2. Rebuild the sfnt header and table directory, with the original table
   checksums.
3. Align each table to 4 bytes.

All 15 table checksums verify after conversion. Any WOFF-to-TTF tool that
does not re-encode glyphs gives the same result.

## Bump procedure

1. Take `inter-latin-400-normal.woff` from the new `@fontsource/inter`.
2. Convert it to TTF as described above.
3. Update the version and both SHA256 values here.
4. Copy the package's `LICENSE` to `Inter-OFL.txt`.

`build:copy` copies this directory into `lib/`, and `lib/` is what the npm
package ships.
