# yt-frames-web

Web app (Node.js + HTML + CSS + JS): lien YouTube → sary isaky ny 5 min + transcript (mg/fr/en) isaky sary + zip.

## Fomba fiasa (vaovao)
1. **Alaivo daholo aloha** ny text transcription feno ny video (subtitle / auto-caption).
2. Raha ilaina dia **nadika** ny segment tsirairay aloha (Google Translate).
3. **Soraty** `transcript_full.txt` miaraka amin'ny timestamp (`[00:01:23] text...`).
4. **Zaraina** ny text amin'ny isany sary (time window isaky ny interval).
5. Maka sary + manoratra `transcripts/frame_XXX.txt` + `transcript_by_scene.txt`.

## Fepetra
- Node.js 18+
- yt-dlp_x86 (na yt-dlp) ao amin'ny PATH  (`pip install -U yt-dlp`)  na `YTDLP_PATH=/lalana/yt-dlp_x86`
- ffmpeg: avy amin'ny `npm install` (ffmpeg-static) na `FFMPEG_PATH`

## Fandefasana
    npm install
    npm start
Sokafy http://localhost:3000

Env (tsy voatery): `PORT`, `OUTPUT_DIR`, `YT_COOKIES` (cookies.txt raha voasakana ny YouTube), `YTDLP_PATH`, `FFMPEG_PATH`.

## Raha 429 Too Many Requests (subtitle)
YouTube manakana ny download subtitle raha be loatra ny request.
- Miandry 1–2 minitra dia andramo indray.
- Na: manao cookies.txt (extension "Get cookies.txt" ao amin'ny browser) ary:
  `YT_COOKIES=/lalana/cookies.txt npm start`
- Ny code manandrana lang maromaro + sleep + backoff mandeha ho azy.

## Output
`output/<jobId>/`
- `images/*.jpg`
- `transcripts/frame_XXX.txt`
- `transcript_full.txt`          ← transcript feno miaraka timestamp
- `transcript_by_scene.txt`      ← text zaraina isaky ny sary
- `meta.json`
- Zip feno via bokotra "Zip feno" (misy `report.html` koa)
"# yt-frames-transcript" 
