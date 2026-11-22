# Round 3: real recorded audio acquisition

## Delivered scope

21 short local mono MP3 files: 2 nonlexical hummed response excerpts, 3 natural chuckle/laugh excerpts, and 2 each of hen, rooster crowing, night pond frog, forest sika deer whistle, dog, small-bird chirping, cattle lowing and duck calls. Runtime bytes: **372555** (0.355 MiB), well below 12 MiB. No optional river/leaves recording added: required coverage was prioritized.

Manifest: [audio-samples.json](../src/data/audio-samples.json), shape exactly {version:1,clips:[...]}. Local paths are /audio/round3/<id>.mp3. No runtime external URL, paid API, account or key is needed. Audio files are already physically trimmed; do not apply sourceTrimStart/sourceTrimEnd at playback. These fields are provenance offsets into downloaded originals only. duration is the final playable duration. No trimStart/trimEnd runtime fields are supplied.

## Verification and limits

- PROJECT_BRIEF read before acquisition; only the owned audio directory, this document and the new manifest changed. No sound-system implementation, source/config changes, build, server or browser work performed.
- Source pages and legalcode fetched on 2026-11-12, each HTTP 200. Extracted source-page snapshots are under [licenses](../public/audio/round3/licenses/). CC0 and CC BY 4.0 legalcode text is preserved there. Source license declarations explicitly permit copying, adaptation, redistribution and commercial use; no NC/ND/reupload-restricted source was used.
- Freesound originals require login, but their public **HQ MP3 preview encodings** are directly downloadable without an account. These are renditions of the same identified licensed sound, not an unrelated reupload. downloadUrl records the exact rendition.
- Local curl binary downloads succeeded. Every original was ffprobe-readable and decoded with FFmpeg. Every final clip was probed and fully decoded with FFmpeg, all 15 exits 0. Each is MP3, mono, 44,100 Hz, 0.70–2.62 s. SHA-256 and exact bytes are in the manifest.
- **No listening tool was used; no claim of listening or semantic audition is made.** Identity/real-recording classification comes from the recordists' descriptions. Boundaries were chosen using 100 ms decoded RMS measurements and existing quiet gaps, not speech synthesis or arbitrary electronic substitutes. Human naturalness/emotional fit still requires human auditory QA before sign-off. No age/gender/fictional-character identity is assigned to the clips.
- All processing: single contiguous excerpt, mono downmix, resample to 44.1 kHz, libmp3lame quality 4, 8 ms fade-in / 35 ms fade-out. Two quiet response excerpts receive fixed +12 dB gain. No pitch/time manipulation, no synthesized variant, no splicing of syllables.

## Recording identity and provenance

### Hmm? Mhmm.WAV — LasciviousGork

- Source: https://freesound.org/people/LasciviousGork/sounds/168132/
- License: CC0-1.0 (https://creativecommons.org/publicdomain/zero/1.0/)
- Download: https://cdn.freesound.org/previews/168/168132_2478427-hq.mp3
- Used for: voice-ack-01 [3.85, 4.55) s; voice-ack-02 [9.9, 10.6) s

### Short Chuckle or Laugh — Tiger_v15

- Source: https://freesound.org/people/Tiger_v15/sounds/231495/
- License: CC-BY-4.0 (https://creativecommons.org/licenses/by/4.0/)
- Download: https://cdn.freesound.org/previews/231/231495_2476414-hq.mp3
- Used for: voice-laugh-01 [0.12, 1.23) s

### Chuckles.mp3 — se2001

- Source: https://freesound.org/people/se2001/sounds/463814/
- License: CC0-1.0 (https://creativecommons.org/publicdomain/zero/1.0/)
- Download: https://cdn.freesound.org/previews/463/463814_8472935-hq.mp3
- Used for: voice-laugh-02 [0.14, 1.02) s; voice-laugh-03 [2.3, 3.18) s

### Hen lays #2 — Joseph SARDIN

- Source: https://bigsoundbank.com/hen-lays-2-s0976.html
- License: CC0-1.0 (https://creativecommons.org/publicdomain/zero/1.0/)
- Download: https://bigsoundbank.com/UPLOAD/mp3/0976.mp3
- Used for: cluck-01 [0.05, 2.4) s

### Hens Lays — Joseph SARDIN

- Source: https://bigsoundbank.com/hens-lays-s0978.html
- License: CC0-1.0 (https://creativecommons.org/publicdomain/zero/1.0/)
- Download: https://bigsoundbank.com/UPLOAD/mp3/0978.mp3
- Used for: cluck-02 [0.05, 2.2) s

### Rooster Song — DenisChardonnet

- Source: https://bigsoundbank.com/song-of-rooster-s0283.html
- License: CC0-1.0 (https://creativecommons.org/publicdomain/zero/1.0/)
- Download: https://bigsoundbank.com/UPLOAD/mp3/0283.mp3
- Used for: crow-01 [0.04, 2.28) s (-3.5 dB gain)

### Crowing #4 — Joseph SARDIN

- Source: https://bigsoundbank.com/crowing-4-s0704.html
- License: CC0-1.0 (https://creativecommons.org/publicdomain/zero/1.0/)
- Download: https://bigsoundbank.com/UPLOAD/mp3/0704.mp3
- Used for: crow-02 [4.18, 6.36) s

### One frog — Joseph SARDIN

- Source: https://bigsoundbank.com/one-frog-s0819.html
- License: CC0-1.0 (https://creativecommons.org/publicdomain/zero/1.0/)
- Download: https://bigsoundbank.com/UPLOAD/mp3/0819.mp3
- Used for: frog-01 [2.2, 3.6) s (+2.5 dB gain); frog-02 [12.8, 14.56) s (+2 dB gain)

### Forest ambience, sika deer rut calls — Joseph SARDIN & Axeline T.

- Source: https://bigsoundbank.com/forest-ambience-sika-deer-rut-calls-s3616.html
- License: CC0-1.0 (https://creativecommons.org/publicdomain/zero/1.0/)
- Download: https://bigsoundbank.com/UPLOAD/mp3/3616.mp3
- Used for: stag-01 [39.38, 41.62) s (+6.5 dB gain); stag-02 [42.24, 44.68) s (+6.5 dB gain)

### Barking Dogs — DenisChardonnet

- Source: https://bigsoundbank.com/barking-dogs-s0288.html
- License: CC0-1.0 (https://creativecommons.org/publicdomain/zero/1.0/)
- Download: https://bigsoundbank.com/UPLOAD/mp3/0288.mp3
- Used for: bark-01 [0.2, 2.2) s

### Small dog barking — Joseph SARDIN

- Source: https://bigsoundbank.com/small-dog-barking-s0612.html
- License: CC0-1.0 (https://creativecommons.org/publicdomain/zero/1.0/)
- Download: https://bigsoundbank.com/UPLOAD/mp3/0612.mp3
- Used for: bark-02 [0.1, 0.9) s

### 50 birds are sleeping — Joseph SARDIN

- Source: https://bigsoundbank.com/50-birds-are-sleeping-s1068.html
- License: CC0-1.0 (https://creativecommons.org/publicdomain/zero/1.0/)
- Download: https://bigsoundbank.com/UPLOAD/mp3/1068.mp3
- Used for: chirp-01 [0.15, 2.6) s; chirp-02 [4, 6.5) s

### Cow moos #2 — Joseph SARDIN

- Source: https://bigsoundbank.com/cow-moos-2-s2382.html
- License: CC0-1.0 (https://creativecommons.org/publicdomain/zero/1.0/)
- Download: https://bigsoundbank.com/UPLOAD/mp3/2382.mp3
- Used for: low-01 [0.2, 2.55) s

### Cow moos #3 — Joseph SARDIN

- Source: https://bigsoundbank.com/cow-moos-3-s2383.html
- License: CC0-1.0 (https://creativecommons.org/publicdomain/zero/1.0/)
- Download: https://bigsoundbank.com/UPLOAD/mp3/2383.mp3
- Used for: low-02 [0.2, 2.82) s

### Ducks — DenisChardonnet

- Source: https://bigsoundbank.com/ducks-s0276.html
- License: CC0-1.0 (https://creativecommons.org/publicdomain/zero/1.0/)
- Download: https://bigsoundbank.com/UPLOAD/mp3/0276.mp3
- Used for: quack-01 [0.3, 1.8) s; quack-02 [2.3, 3.25) s

### Source descriptions / suitability boundaries

- LasciviousGork: “Me going 'hmm?' in a questioning tone and responding with a 'mhmm'”; Zoom H1 Handy Recorder. Two separate naturally recorded events, not repitched copies. The response classification is based on source description/event ordering, not a claim of hearing exact syllables.
- Tiger_v15: “A Short Laugh taken from a clip of me and a few friends.” Author's request to post projects is not stated as a licensing restriction; CC BY 4.0 attribution is retained in the public NOTICE.
- se2001: source describes a series of chuckles and CC0; two separate events retained.
- Hens: source explicitly describes hen laying calls, not rooster crowing, distressed capture, mouth imitation or synthesized chicken sounds.
- Dogs: one outdoor dog recording by DenisChardonnet; one real dog recording by Joseph SARDIN. Runtime labels do not claim a breed.
- Birds: source describes about fifty sparrows chirping in a hazel before sleep; two short flock excerpts. **Not an isolated single-bird call** and no more-specific species is asserted.
- Cattle: source describes a cow mooing outdoors; not a mouth imitation.
- Ducks: source describes several duck cries outdoors; no unsupported breed/species label.
- Rejected: SFXMint (AI-prompt-generated source found); DAN2008 hmmmm (licensed real recording but relatively weak signal/noisy floor and thinking rather than clear response; not shipped). Its source snapshot may remain for audit, but no runtime manifest entry.

## Offline distribution notice

Keep [NOTICE.md](../public/audio/round3/NOTICE.md) with redistributed audio. It provides required Tiger_v15 credit, source URL, CC BY 4.0 URL and modification statement, plus voluntary CC0 credits. Do not replace that required attribution with only this developer document.

## Reproducible commands

`python public/audio/round3/licenses/acquire-recordings.py` downloads verified source renditions to a bounded staging directory and prints original hashes/bytes and decoded RMS.
`python public/audio/round3/licenses/prepare-clips.py` creates the exact contiguous excerpts and prints final hashes/bytes/source offsets while fully decoding them.
The scripts use locally installed FFmpeg/ffprobe at D:/Tools/ffmpeg/bin. They are provenance utilities, not new project dependencies or runtime code. Staging originals are removed after final verification to avoid shipping large unused files.
