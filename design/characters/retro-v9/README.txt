This is a style-fidelity repair, following rejection of the procedural v8 art.

The original approved contact sheet is the visual authority. Its first character
must remain recognizable in proportion, expression, palette and garment detail.
canonical-master.png is an image_gen extraction/recreation used as a common pose
reference. It is not an exact bitwise crop of the approved contact sheet.

Production layers are derived with the built-in image tool, not replaced by
hand-coded polygons or reduced to a coarse 32x40 reinterpretation. The accepted
baseline sources remain unchanged. Isolated variations sometimes arrive with a
different source position or pixel pitch; registration.json records a fixed
translation and uniform display scale for each source. This registration is shared
by every look. There is no per-combination fitting, rotation or depth slicing.
The PNG bytes themselves are preserved, including the pendant's different canvas.

An assembled result must be visually compared against the approved reference at
matching display sizes. Coordinate/alpha checks support this review but do not
establish that the art looks good. Only the baseline style/assembly has the user's
explicit visual confirmation; do not mislabel all later variations as user-approved.

Production inventory: 30 designs, 5 skin tones, 40 independent PNG sources.
catalog.json identifies selected artwork; earlier rejected variants remain as
iteration history. parts/*.generation.json stores full prompts from this turn.
parts/recovered-generation.json describes three recovered prior outputs and is
explicitly not a verbatim prompt transcript. layers.json and views.json preserve
the accepted baseline comparison.

python scripts/character-v9-kit.py copies source files to
src/assets/characters/modular-v9/ without painting or resampling. It records
source hashes, display registration and color-only skin masks. The app combines
front/rear artwork at anatomical depths; upper bodies include their own hands and
neck, while the face includes both ears. Palette filters protect skin paint.

The review uses the actual production renderer, with part, skin, palette and
light/dark controls: http://127.0.0.1:50262/retro-v9.html
Captured pairwise review: release/retro-v9-review/ (all 97 displayed combinations).
Validation: 14 targeted unit tests and the viewer desktop suite passed. Actual PNG
samples check 540 hair/hat/top/glasses combinations and all 16 lower/shoe joins.
The real winner dialog capture is release/winner-tts-preview.png.

Accessory/earflap follow-up: parts/revision-2/README.txt records the simplified
artwork, fitted source references and actual old/new comparison. The first
collection's completed implementation did not imply user approval of its props.
