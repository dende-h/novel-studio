# 組み込み BGM プリセット（18 曲）と制作プロンプト

演出エディタの BGM 欄に並ぶ枠は `src/core/game/bgmPresets.ts` で決めている。
ここは、その 18 曲を Suno で作るときのプロンプトと、入れるべきファイル名の控え。

## 入れ方

1. 下のプロンプトで曲を作る（Instrumental をオン・歌詞欄は空）
2. 書き出した mp3 を **表のファイル名にそのまま改名**する
3. 管理ページ（`#/admin/templates` の BGM タブ）にドロップする。枠の「曲なし」が消えて鳴るようになる
4. 一覧のループ区間（秒）を打ち、▶ で継ぎ目を確かめる

## 共通設定

- Exclude styles：`vocals, lyrics, singing, rap, fade out, big intro, drum fill ending`
- 尺は 1 分前後。Suno が長く出したら、主和音に戻る小節の頭で 1 分に切る
- 「starts and ends on the same chord」が効かないテイクが続いたら、先頭に `Loopable,` を足す
- 盛り上がりすぎるときは `no build-up, no climax` の後ろに `stays flat` を足す

## 曲一覧

| ファイル名 | 曲名 | 分類 | 用途 |
|---|---|---|---|
| `bgm-calm-bright.mp3` | 日常・明るい | 日常 | 主人公の平常時。いちばん長く流れる |
| `bgm-calm-easy.mp3` | 日常・のんびり | 日常 | 休日・雑談・食事 |
| `bgm-calm-night.mp3` | 日常・夜 | 日常 | 帰り道・部屋・静かな会話 |
| `bgm-calm-comedy.mp3` | コメディ | 日常 | ボケ・ドタバタ |
| `bgm-emotion-warm.mp3` | 温かい・ほのぼの | 感情 | 交流・絆が深まる場面 |
| `bgm-emotion-love.mp3` | 恋愛・甘い | 感情 | 二人きり・告白の前後 |
| `bgm-emotion-bittersweet.mp3` | 切ない | 感情 | 別れ・すれ違い・回想 |
| `bgm-emotion-sorrow.mp3` | 悲しい | 感情 | 死・喪失 |
| `bgm-emotion-resolve.mp3` | 決意・希望 | 感情 | 立ち直り・出発 |
| `bgm-emotion-finale.mp3` | 感動・大団円 | 感情 | クライマックス後の解決 |
| `bgm-tense-uneasy.mp3` | 不穏 | 緊張 | 「何かおかしい」の前触れ |
| `bgm-tense-suspense.mp3` | 緊迫・サスペンス | 緊張 | 追跡・時間制限・対峙 |
| `bgm-tense-battle.mp3` | 戦闘・激しい | 緊張 | バトル場面 |
| `bgm-tense-mystery.mp3` | 謎・思索 | 緊張 | 推理・情報整理 |
| `bgm-tense-horror.mp3` | 恐怖 | 緊張 | ホラー要素 |
| `bgm-scene-sacred.mp3` | 荘厳・神秘 | 場面 | 儀式・超常・世界観の核心 |
| `bgm-scene-memory.mp3` | 回想・ノスタルジー | 場面 | 過去編・幼少期 |
| `bgm-scene-hush.mp3` | 静かな緊張 | 場面 | 環境音の代わり。無音に近いが空白にならない |

## プロンプト

### bgm-calm-bright（日常・明るい）
```
Bright cheerful visual novel BGM, acoustic guitar, glockenspiel, light piano, soft pizzicato strings, gentle upbeat rhythm, 110 BPM, C major, warm everyday slice-of-life mood, no build-up, no climax, about 1 minute long, starts and ends on the same C major chord, seamless loop, no intro, no outro, consistent mood throughout
```

### bgm-calm-easy（日常・のんびり）
```
Relaxed laid-back visual novel BGM, ukulele, soft electric piano, brushed drums, clarinet melody, lazy Sunday afternoon feel, 85 BPM, F major, cozy and unhurried, no build-up, no climax, about 1 minute long, starts and ends on the same F major chord, seamless loop, no intro, no outro, consistent mood throughout
```

### bgm-calm-night（日常・夜）
```
Calm nighttime visual novel BGM, soft piano, muted electric guitar, warm pad, light rimshot percussion, quiet evening in a small room, 72 BPM, A minor, intimate and still, no build-up, no climax, about 1 minute long, starts and ends on the same A minor chord, seamless loop, no intro, no outro, consistent mood throughout
```

### bgm-calm-comedy（コメディ）
```
Playful comedic visual novel BGM, bouncy pizzicato strings, tuba bassline, xylophone, muted trumpet, cartoonish cheerful mischief, 130 BPM, G major, light and silly, no build-up, no climax, about 1 minute long, starts and ends on the same G major chord, seamless loop, no intro, no outro, consistent mood throughout
```

### bgm-emotion-warm（温かい・ほのぼの）
```
Warm heartfelt visual novel BGM, gentle piano melody, acoustic guitar arpeggios, soft strings, subtle music box, feeling of friendship and belonging, 90 BPM, D major, tender and comforting, no build-up, no climax, about 1 minute long, starts and ends on the same D major chord, seamless loop, no intro, no outro, consistent mood throughout
```

### bgm-emotion-love（恋愛・甘い）
```
Sweet romantic visual novel BGM, delicate piano, warm string section, soft harp, light celesta, shy first-love atmosphere, 76 BPM, E flat major, dreamy and affectionate, no build-up, no climax, about 1 minute long, starts and ends on the same E flat major chord, seamless loop, no intro, no outro, consistent mood throughout
```

### bgm-emotion-bittersweet（切ない）
```
Bittersweet melancholic visual novel BGM, solo piano with sparse string accompaniment, slow arpeggios, longing and quiet regret, 64 BPM, D minor, wistful, restrained emotion, no build-up, no climax, about 1 minute long, starts and ends on the same D minor chord, seamless loop, no intro, no outro, consistent mood throughout
```

### bgm-emotion-sorrow（悲しい）
```
Sorrowful visual novel BGM, slow solo piano, cello and violin, deep grief and loss, very sparse, long sustained notes, 56 BPM, C minor, mournful and heavy, no build-up, no climax, about 1 minute long, starts and ends on the same C minor chord, seamless loop, no intro, no outro, consistent mood throughout
```

### bgm-emotion-resolve（決意・希望）
```
Hopeful determined visual novel BGM, piano and strings, soft snare march, rising melody, resolve after hardship, dawn breaking, 96 BPM, B flat major, uplifting but grounded, moderate steady energy, about 1 minute long, starts and ends on the same B flat major chord, seamless loop, no intro, no outro, consistent mood throughout
```

### bgm-emotion-finale（感動・大団円）
```
Emotional climactic visual novel BGM, full orchestral strings, piano, gentle brass swell, soft choir pad, tears of joy and resolution, 80 BPM, G major, cinematic and warm, stays at a high emotional level from the start, never harsh, about 1 minute long, starts and ends on the same G major chord, seamless loop, no intro, no outro, consistent mood throughout
```

### bgm-tense-uneasy（不穏）
```
Uneasy ominous visual novel BGM, low drone, sparse dissonant piano notes, subtle string tremolo, something is wrong feeling, slow pulse, 60 BPM, E minor, creeping dread, minimal, no build-up, no climax, about 1 minute long, starts and ends on the same low E drone, seamless loop, no intro, no outro, consistent mood throughout
```

### bgm-tense-suspense（緊迫・サスペンス）
```
Tense suspense visual novel BGM, driving staccato strings, ticking percussion, low synth bass pulse, urgent chase and confrontation, 128 BPM, F sharp minor, relentless forward motion, steady intensity, no build-up, no climax, about 1 minute long, starts and ends on the same F sharp minor chord, seamless loop, no intro, no outro, consistent mood throughout
```

### bgm-tense-battle（戦闘・激しい）
```
Intense battle visual novel BGM, orchestral hybrid, aggressive strings, taiko and heavy drums, brass stabs, electric guitar accents, epic fight, 150 BPM, D minor, powerful and driving, steady intensity from the first bar, no build-up, no climax, about 1 minute long, starts and ends on the same D minor chord, seamless loop, no intro, no outro, consistent mood throughout
```

### bgm-tense-mystery（謎・思索）
```
Mysterious contemplative visual novel BGM, jazzy piano chords, upright bass, vibraphone, soft brushed snare, detective deduction and puzzle solving, 100 BPM, B minor, curious and cool, no build-up, no climax, about 1 minute long, starts and ends on the same B minor chord, seamless loop, no intro, no outro, consistent mood throughout
```

### bgm-tense-horror（恐怖）
```
Horror visual novel BGM, dark ambient drone, detuned piano, reversed string swells, distant metallic scrapes, breathing sub bass, creeping terror, 50 BPM, unsettling and sparse, no build-up, no climax, no jump scare hits, about 1 minute long, starts and ends on the same low C drone, seamless loop, no intro, no outro, consistent mood throughout
```

### bgm-scene-sacred（荘厳・神秘）
```
Solemn mystical visual novel BGM, ethereal choir pad, harp, slow orchestral strings, chimes, sacred ritual and ancient secrets, 66 BPM, E minor Dorian, majestic and otherworldly, no build-up, no climax, about 1 minute long, starts and ends on the same E minor chord, seamless loop, no intro, no outro, consistent mood throughout
```

### bgm-scene-memory（回想・ノスタルジー）
```
Nostalgic memory visual novel BGM, music box melody, soft piano, warm vinyl texture, gentle strings, faded childhood summer, 70 BPM, A major, tender and distant, slightly blurred, no build-up, no climax, about 1 minute long, starts and ends on the same A major chord, seamless loop, no intro, no outro, consistent mood throughout
```

### bgm-scene-hush（静かな緊張）
```
Quiet minimal visual novel BGM, single sustained synth pad, occasional soft piano note, very sparse, almost silent, held breath before something happens, 48 BPM, C minor, near-ambient, no melody, no build-up, no climax, about 1 minute long, starts and ends on the same C minor pad chord, seamless loop, no intro, no outro, consistent mood throughout
```
