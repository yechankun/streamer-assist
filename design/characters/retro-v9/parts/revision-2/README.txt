Accessory and earflap correction after user feedback, 2026-10-25.

Tool: built-in image_gen, transparent raster editing/generation.
Every *.generation.json records the exact prompt, reference images and returned
source path. Standalone drafts and fitted whole-character references remain here
as iteration history; catalog.json alone determines which ten PNG layers ship.

The selected revision simplifies both glasses to a single rim, removes fine scarf
tassels and headphone rings, uses broad bow/pendant blocks, and replaces the
pointed trapper hat with a compact rounded crown and short coherent earflaps.
Front crown/near flap and complete far flap are independent anatomical sources.
The rear headphone band arches above its endpoints behind the nape rather than
forming a hanging U-shaped strap across the chest.

The approved head, hair, body and garments are unchanged. Registration aligns
transparent lens openings to both existing pupils and earcup pairs to the neck.
scripts/character-prop-registration.py analyzes alpha geometry only; it never edits PNG pixels.
The production packaging script copies selected source bytes unchanged.

before/ preserves the ten original PNGs plus the previous source/placement
metadata. The review compares these actual old sources with the revised sources
through the same production renderer at identical display sizes and colors:
http://127.0.0.1:50262/retro-v9.html?sheet=6

Validation includes source hashes, full-pupil lens transparency, front/far earflap
separation, rear-band orientation and actual winner/chat/TTS desktop behavior.
Captures: release/retro-v9-review/sheet-6*.png and earflap-planes-light.png.
