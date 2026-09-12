# 組み込み BGM プリセット（24 曲）と制作プロンプト

演出エディタの BGM 欄に並ぶ枠は `src/core/game/bgmPresets.ts` で決めている。
ここは、その 24 曲を Suno で作るときのプロンプトと、入れるべきファイル名の控え。

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
| `bgm-tense-battle-1.mp3` | 戦闘1・激しい | 緊張 | 敵との戦い |
| `bgm-tense-battle-2.mp3` | 戦闘2・激しい | 緊張 | 敵との戦い（別の曲） |
| `bgm-tense-battle-3.mp3` | 戦闘3・信念 | 緊張 | 信念と信念のぶつかり合い。誇りと葛藤が半々 |
| `bgm-tense-battle-4.mp3` | 戦闘4・悲壮 | 緊張 | 勝ち目の薄い戦い。命を懸ける・散る覚悟 |
| `bgm-tense-mystery.mp3` | 謎・思索 | 緊張 | 推理・手がかりの整理 |
| `bgm-tense-horror.mp3` | 恐怖 | 緊張 | ホラー要素。じわじわ来る怖さ |
| `bgm-tense-dread.mp3` | 恐怖・切迫 | 緊張 | 何かがすぐそこまで迫っている。逃げ場のない怖さ |
| `bgm-tense-creep.mp3` | 恐怖・忍び寄る | 緊張 | Jホラー。暗い廊下の向こうから何かが一歩ずつ近づいてくる。切迫の前段 |
| `bgm-scene-sacred.mp3` | 荘厳・神秘 | 場面 | 儀式・超常・世界観の核心 |
| `bgm-scene-memory.mp3` | 回想・ノスタルジー | 場面 | 過去編・幼少期 |
| `bgm-scene-hush.mp3` | 静かな緊張 | 場面 | 環境音の代わり。無音に近いが空白にならない |
| `bgm-scene-noir.mp3` | ムーディ・夜の街 | 場面 | バー・探偵事務所・大人の会話 |

## プロンプト

### bgm-calm-bright（日常・明るい）
```
Bright cheerful visual novel BGM, acoustic guitar, glockenspiel, light piano, soft pizzicato strings, gentle upbeat rhythm, 110 BPM, C major, warm everyday slice-of-life mood, no build-up, no climax, about 1 minute long, starts and ends on the same C major chord, seamless loop, no intro, no outro, consistent mood throughout
```

### bgm-calm-easy（日常・のんびり）
素朴に。エレピ・ブラシドラム・クラリネット・ジャズコードは入れない（ラウンジ風になる）。
楽器はアコギとリコーダーと軽い打楽器くらいで、コードは単純な三和音だけ。

**本命**：
```
Simple rustic laid-back visual novel BGM, acoustic guitar strumming, recorder melody, light hand percussion, simple three-chord folk feel, plain and homely, lazy afternoon in the countryside, 84 BPM, F major, simple triads only, no jazz chords, no lounge, not sophisticated, cozy and unhurried, no build-up, no climax, about 1 minute long, starts and ends on the same F major chord, seamless loop, no intro, no outro, consistent mood throughout
```

**代案**（もっと素朴に。ピアノだけ）：
```
Plain gentle visual novel BGM, simple solo piano with light acoustic guitar, easy nursery-like melody, simple triads, unhurried and homely, quiet afternoon at home, 80 BPM, C major, no jazz chords, no lounge, not sophisticated, no build-up, no climax, about 1 minute long, starts and ends on the same C major chord, seamless loop, no intro, no outro, consistent mood throughout
```

寄せ方の目安：
- まだおしゃれなら Exclude styles に `jazz, lounge, bossa nova, lo-fi, electric piano, saxophone, clarinet` を入れる
- 幼稚になりすぎたら `nursery-like` を `humble` に替える

### bgm-calm-night（日常・夜）
切なくしない。短調にすると回想曲になるので**長調**で、「静かで落ち着いているが、寂しくも悲しくもない」夜にする。
用途は帰り道・部屋・静かな会話。切ない夜は「切ない」「回想」に任せる。

**本命**：
```
Calm cozy nighttime visual novel BGM, soft piano, muted acoustic guitar, warm pad, light rimshot percussion, quiet evening at home after a good day, relaxed and content, 74 BPM, D major, warm and settled, not sad, not nostalgic, not melancholic, no build-up, no climax, about 1 minute long, starts and ends on the same D major chord, seamless loop, no intro, no outro, consistent mood throughout
```

**代案**（もう少し静かに。街灯の下の帰り道。歩く速さに合わせて少しだけ速め）：
```
Quiet peaceful night walk visual novel BGM, soft electric piano, gentle acoustic guitar, subtle upright bass, light steady walking pulse, walking home under streetlights feeling fine, 80 BPM, G major, calm and comfortable, not sad, not lonely, no build-up, no climax, about 1 minute long, starts and ends on the same G major chord, seamless loop, no intro, no outro, consistent mood throughout
```

寄せ方の目安：
- まだ切ないなら Exclude styles に `melancholic, sad, nostalgic, bittersweet, minor key` を入れる
- 明るすぎて「昼」になったら `warm pad` を `warm low pad` にし、テンポを 68 に落とす

### bgm-calm-comedy（コメディ）
狙いは**日本のアニメの日常ギャグコメディ**（学園もの・ゆるい掛け合い）。
決め手は鍵盤ハーモニカ（ピアニカ）とスタッカートのシンセ、ピチカートの「ちゃらーん」。
サーカス（金管・アコーディオン）・幼児アニメ（木琴・チューバ）・口笛は入れない。

**本命**（ピアニカ主役。ゆるい掛け合い・ボケ向き）：
```
Japanese anime slice-of-life gag comedy BGM, melodica (pianica) lead melody, bouncy staccato synth chords, pizzicato strings doing cheeky "cha-rahn" stings, upbeat electric bass, snappy drum kit with rimshots, silly playful mood, quick comedic timing with short pauses, school days banter, 132 BPM, C major, cute but not childish, no whistling, no brass, no clarinet, no accordion, no xylophone, no circus, no build-up, no climax, about 1 minute long, starts and ends on the same C major chord, seamless loop, no intro, no outro, consistent mood throughout
```

**代案**（もう少し勢い。ズッコケ・ドタバタ向き。8bit 寄りのシンセで）：
```
Japanese anime gag comedy BGM, bouncy chiptune-style square synth lead, staccato pizzicato strings, melodica counter-melody, slap electric bass, fast tight drum kit with hand claps, goofy slapstick chase, mischievous and quick, sudden comedic stops, 144 BPM, F major, silly but not childish, no whistling, no brass, no accordion, no xylophone, no circus, no build-up, no climax, about 1 minute long, starts and ends on the same F major chord, seamless loop, no intro, no outro, consistent mood throughout
```

寄せ方の目安：
- Exclude styles には最初から `circus, carnival, polka, brass, trumpet, tuba, clarinet, accordion, xylophone, kazoo, whistling, jazz, lounge` を入れておく
- コメディ感が足りないなら、先頭を `Japanese anime gag comedy BGM like a school comedy anime,` に替え、`pizzicato strings doing cheeky "cha-rahn" stings` を `frequent pizzicato "cha-rahn" stings and a comedic tuba-free bass slide` にする
- 「日常・明るい」と区別がつかないなら、`quick comedic timing with short pauses` を `deliberately goofy timing with short pauses and off-beat hits` に強める

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

### bgm-tense-battle-1 / bgm-tense-battle-2（戦闘1・2・激しい）
同じプロンプトから 2 テイク（または 1 と 2 で楽器を少し変える）。
```
Intense battle visual novel BGM, orchestral hybrid, aggressive strings, taiko and heavy drums, brass stabs, electric guitar accents, epic fight, 150 BPM, D minor, powerful and driving, steady intensity from the first bar, no build-up, no climax, about 1 minute long, starts and ends on the same D minor chord, seamless loop, no intro, no outro, consistent mood throughout
```

### bgm-tense-battle-3（戦闘3・信念）
敵ではなく、信念や正義を持つ者同士がぶつかる曲。誇りと葛藤を半々に。
出だしの 1 小節目から打ち合っている音にする（前奏で溜めない）。
ファンファーレと行進は入れない（タイトル曲になる）が、金管の持続音で気高さは残す。

**本命**（1 小節目から刃が当たる。弦の刻みで戦闘、ホルンで誇り、ソロヴァイオリンで葛藤）：
```
Fierce determined duel visual novel BGM, hits hard from the very first beat, aggressive fast string ostinato, sharp staccato brass stabs, sustained noble French horn line above, solo violin counter-melody with a bittersweet edge, pounding timpani and taiko, metallic percussion accents like clashing blades, no fanfare, no march, no choir, no slow opening, two beliefs clashing with respect, resolve mixed with pain, dignified but conflicted, 138 BPM, D minor with brief major lifts that fall back to minor, full intensity throughout, no build-up, no climax, about 1 minute long, starts and ends on the same D minor chord, seamless loop, no intro, no outro, consistent mood throughout
```

**代案**（もう少し前へ倒したいとき。ホルンの主題を前に出し、葛藤はコードの陰りだけで出す）：
```
Proud conflicted battle visual novel BGM, explosive from the first bar, urgent driving string ostinato, strong French horn theme, cello drive, timpani and snare rolls, metallic clash accents, occasional dissonant string clash under the theme, no fanfare, no march, no choir, no slow opening, honor and doubt in the same fight, resolute but heavy-hearted, 140 BPM, E minor, majestic yet unresolved, full intensity throughout, no build-up, no climax, about 1 minute long, starts and ends on the same E minor chord, seamless loop, no intro, no outro, consistent mood throughout
```

寄せ方の目安：
- 出だしが静かなテイクが出たら、Exclude styles に `intro, slow opening, ambient intro` を足す
- 葛藤に寄りすぎたら `solo violin counter-melody with a bittersweet edge` を `solo violin counter-melody` にし、`brief major lifts` を `frequent major lifts` にする
- 前向きに寄りすぎたら Exclude styles に `fanfare, march, anthem, triumphant` を入れ、`resolve mixed with pain` を `pain under the resolve` にする

### bgm-tense-battle-4（戦闘4・悲壮）
戦闘3 の悲壮版。出だしから打ち合うのは同じ。ホルンの誇りを、低い男声合唱と嘆きの弦に置き換える。
「勝てないと分かっていて剣を抜く」。

**本命**：
```
Tragic heroic last stand battle visual novel BGM, hits hard from the very first beat, aggressive fast string ostinato, low male choir chanting solemnly, mournful soaring violin melody above the drive, pounding timpani and taiko, sharp brass stabs in minor, metallic percussion accents like clashing blades, no fanfare, no march, no slow opening, fighting a battle you cannot win, sacrifice and grief and defiance, sorrow without giving up, 136 BPM, C minor, dark and majestic, full intensity throughout, no build-up, no climax, about 1 minute long, starts and ends on the same C minor chord, seamless loop, no intro, no outro, consistent mood throughout
```

**代案**（合唱が大げさになるとき。合唱を外して、悲壮はチェロの旋律に持たせる）：
```
Tragic desperate battle visual novel BGM, explosive from the first bar, driving low string ostinato, weeping cello melody, high string tremolo, pounding timpani and taiko, minor brass stabs, metallic clash accents, no choir, no fanfare, no march, no slow opening, doomed but unbroken, grief in every strike, 134 BPM, G minor, dark and relentless, full intensity throughout, no build-up, no climax, about 1 minute long, starts and ends on the same G minor chord, seamless loop, no intro, no outro, consistent mood throughout
```

寄せ方の目安：
- 「悲しい」に寄って戦闘感が落ちたら `aggressive fast string ostinato` を `aggressive fast string ostinato in the front` にし、テンポを 140 に上げる
- 戦闘3 と区別がつかないなら Exclude styles に `heroic, triumphant, hopeful` を入れる

### bgm-tense-mystery（謎・思索）
```
Puzzle-solving detective visual novel BGM, pizzicato strings, marimba, harpsichord, ticking clock percussion, light woodblock, playful curious deduction, clues falling into place, inquisitive and clever, clockwork feel, 112 BPM, E minor, thinking hard but not dark, no build-up, no climax, about 1 minute long, starts and ends on the same E minor chord, seamless loop, no intro, no outro, consistent mood throughout
```

### bgm-tense-horror（恐怖）
```
Horror visual novel BGM, dark ambient drone, detuned piano, reversed string swells, distant metallic scrapes, breathing sub bass, creeping terror, 50 BPM, unsettling and sparse, no build-up, no climax, no jump scare hits, about 1 minute long, starts and ends on the same low C drone, seamless loop, no intro, no outro, consistent mood throughout
```

### bgm-tense-dread（恐怖・切迫）
```
Imminent danger horror visual novel BGM, pounding heartbeat drum, relentless low ostinato strings, shrieking high string stabs, rising dissonant brass cluster, something is right behind you, panic and no escape, 140 BPM, B flat minor, already at peak intensity from the first bar, stays at peak, no build-up, no release, about 1 minute long, starts and ends on the same low B flat pulse, seamless loop, no intro, no outro, consistent mood throughout
```

### bgm-tense-creep（恐怖・忍び寄る）
J ホラー（呪怨・リング系）。和楽器は使わない。静けさ・低い唸り・喉の音・蛍光灯のノイズで作る。
「迫ってくる」を主役にし、鳴っているものは全部「近づく」に使う。

迫る感じの出し方（3 つ全部入れる）：
1. **足音そのもの**：暗い廊下を裸足で引きずる音を打楽器にし、一歩ごとに重くする
2. **距離**：足音を「遠くで反響 → 近くで乾いた音」へ動かす（残響を減らしていく）
3. **音程**：低い弦のうなりを半音ずつ上げる

ループの制約（「盛り上げない」）と「迫ってくる」は本来ぶつかるので 2 本用意する。

**A：ループ優先**（8 小節かけて近づき、頭に戻る。ずっと近づき続けて聞こえる）：
```
Japanese horror film score visual novel BGM, minimal and quiet, dragging bare footsteps down a dark hallway as the only rhythm, each step heavier and closer, over eight bars the footsteps move from far and reverberant to close and dry then reset, a low sub bass drone slowly rising half step by half step, one high thin dissonant string note held with tremolo, a dry death-rattle throat clicking sound every few bars, faint fluorescent light buzz, long silences between sounds, something is coming down the corridor toward you, 76 BPM, B flat minor, no melody, no build-up, no climax, no jump scare hits, no other instruments, about 1 minute long, starts and ends on the same far footsteps and low drone, seamless loop, no intro, no outro
```

**B：迫り優先**（1 分かけて遠くから目の前まで来る。ループの継ぎ目で「遠く」に戻るので、
短い場面か、次の行で切迫へ繋ぐ前提で使う）：
```
Japanese horror film score visual novel BGM, minimal and quiet, starts far away and ends right behind you, dragging bare footsteps down a dark hallway getting steadily closer and heavier for the whole minute, reverb slowly drying out as it approaches, a low sub bass drone rising half step by half step, one high thin dissonant string note held with tremolo, a dry death-rattle throat clicking sound getting closer, faint fluorescent light buzz, creaking floor, long silences between sounds, by the end the footsteps are loud and dry and right in front of you, 76 BPM, B flat minor, no melody, no jump scare hits, no other instruments, about 1 minute long, no intro, ends abruptly on the last close footstep
```

寄せ方の目安：
- Suno が勝手に楽器を足してくるなら、Exclude styles に `orchestra, pads, synth melody, drum kit, melody, koto, shamisen, taiko, ethnic` を入れる
- 「迫る」が足りないなら A の `over eight bars` を `over sixteen bars` にして、動きの幅を広げる
- 静かすぎて怖くないなら `faint fluorescent light buzz` を `harsh fluorescent light buzz that cuts out and back` にする
- 狂気を戻したいなら `death-rattle throat clicking sound` を `a low humming of a nursery song under the breath` にする
- 切迫と繋げるなら B♭ マイナーを共通にしてあるので、忍び寄る → 切迫の順に置く

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

### bgm-scene-noir（ムーディ・夜の街）
```
Moody noir visual novel BGM, jazzy piano chords, upright bass, vibraphone, soft brushed snare, smoky bar at midnight, private detective office, cool and unhurried, 96 BPM, B minor, sophisticated and low-key, no build-up, no climax, about 1 minute long, starts and ends on the same B minor chord, seamless loop, no intro, no outro, consistent mood throughout
```
