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
前奏を付けない。末尾の `no intro` だけでは Suno が前奏を足すので、
**先頭に「1 拍目から主旋律と全楽器で始まる」を置き、前奏の型（ピアノだけの出だし・パッドの立ち上がり）を否定語で塞ぐ**。

```
Warm heartfelt visual novel BGM that starts immediately with the full melody and all instruments on the very first beat, no intro, no solo piano opening, no ambient pad swell at the start, no fade in, gentle piano melody, acoustic guitar arpeggios, soft strings, subtle music box, feeling of friendship and belonging, 90 BPM, D major, tender and comforting, no build-up, no climax, about 1 minute long, starts and ends on the same D major chord, seamless loop, no outro, consistent mood throughout
```

寄せ方の目安：
- それでも前奏が付くなら Exclude styles に `intro, slow opening, ambient intro, fade in, piano intro` を入れる
- 出だしが薄いテイクは、曲中の一番安定した小節の頭から 1 分を切り出せば前奏は消える（ループ用途なら曲の頭にこだわらなくてよい）

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
前奏を付けない。**ノベルゲーム寄りにする**：フルオーケストラ・合唱・金管は映画の音になるので外し、
ピアノ主役に弦とシンセパッド、軽いドラムで「泣きゲー」のエンディング前の曲にする。

**本命**（ピアノ主役。日本のノベルゲームの感動曲）：
```
Japanese visual novel emotional finale BGM that starts immediately with the main piano melody and full arrangement on the very first beat, no intro, no solo piano opening, no fade in, piano lead melody, warm string section, soft synth pad, light drums and electric bass, acoustic guitar arpeggios, tears of joy and resolution after a long journey, heartfelt and bright, 84 BPM, G major, stays at a high emotional level the whole time, no orchestra, no choir, no brass, no cinematic film score, about 1 minute long, starts and ends on the same G major chord, seamless loop, no outro, consistent mood throughout
```

**代案**（もう少し静かに。ドラム無しで、余韻のある大団円）：
```
Japanese visual novel emotional ending BGM that starts immediately with the main melody on the first beat, no intro, no fade in, piano lead melody, warm strings, soft synth pad, gentle acoustic guitar, no drums, quiet tears and gratitude, everything resolved, 76 BPM, D major, warm and full but never loud, no orchestra, no choir, no brass, no cinematic film score, about 1 minute long, starts and ends on the same D major chord, seamless loop, no outro, consistent mood throughout
```

寄せ方の目安：
- Exclude styles には最初から `orchestra, orchestral, choir, brass, cinematic, epic, trailer, intro, fade in` を入れておく
- まだ映画っぽいなら `warm string section` を `warm synth strings` にして生オケ感を落とす
- 「決意・希望」と区別がつかないなら `tears of joy and resolution after a long journey` を `tears of joy, everyone is smiling at the end` に寄せる

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
ノイズと不協和音を主役にする。じわじわ来る怖さ（テンポなし・鼓動なし）。
「忍び寄る」（足音で近づく）「切迫」（鼓動で追い詰める）とは違い、こちらは**場の空気そのものが壊れている**音。

**本命**（ノイズ＋弦のクラスター）：
```
Horror visual novel BGM built on noise and dissonance, low dark drone, harsh dissonant string cluster held with slow tremolo, microtonal detuned violins sliding against each other, bursts of radio static and white noise, tape hiss, crackling and distorted textures, reversed piano notes, tritone intervals, no rhythm, no pulse, no melody, wrong and unstable, creeping terror, atonal, unsettling and dense, no build-up, no climax, no jump scare hits, about 1 minute long, starts and ends on the same low drone and static, seamless loop, no intro, no outro, consistent mood throughout
```

**代案**（もっとノイズ寄り。楽器をほぼ無くして、電気的な壊れ方にする）：
```
Noise horror visual novel BGM, distorted low drone, granular crackling noise, radio static bursts, feedback squeals kept low in the mix, detuned dissonant synth cluster, glitchy stutters, electrical hum, cold and inhuman, no rhythm, no melody, atonal, dread and unease, no build-up, no climax, no jump scare hits, about 1 minute long, starts and ends on the same distorted drone, seamless loop, no intro, no outro, consistent mood throughout
```

寄せ方の目安：
- ノイズが足りないなら `bursts of radio static and white noise` を `constant bed of radio static and white noise with louder bursts` にする
- 不協和音が足りないなら `tritone intervals` を `tritone and minor second intervals, clashing semitones` にする
- うるさすぎて読めないなら `dense` を `sparse` にし、`kept low in the mix` を各ノイズに付ける
- Suno が旋律を付けてくるなら Exclude styles に `melody, piano melody, strings melody, beat, drums` を入れる

### bgm-tense-dread（恐怖・切迫）
```
Imminent danger horror visual novel BGM, pounding heartbeat drum, relentless low ostinato strings, shrieking high string stabs, rising dissonant brass cluster, something is right behind you, panic and no escape, 140 BPM, B flat minor, already at peak intensity from the first bar, stays at peak, no build-up, no release, about 1 minute long, starts and ends on the same low B flat pulse, seamless loop, no intro, no outro, consistent mood throughout
```

### bgm-tense-creep（恐怖・忍び寄る）
**曲として成立させつつ、悲壮ではなく恐怖、しかも差し迫った緊張感を持たせる**。
残すもの：調律の狂ったオルゴール（良い味）。
足すもの：心臓寄りの速い低音の脈（切迫感）、波のように膨らんで引くノイズ（圧）、
張り詰めていく弦のトレモロ（緊張）。悲壮に寄る旋律・協和した和音は入れない。効果音（足音等）も入れない。

**本命**（オルゴール＋脈＋ノイズ）：
```
Japanese visual novel horror BGM, urgent and dissonant, not sad, no lyrical melody, a badly out-of-tune music box repeating a tritone two-note pattern mechanically and creeping upward half step by half step then restarting like something drawing nearer, a fast anxious sub-bass pulse like a racing heartbeat underneath, a bed of low static and white noise that swells and recedes in waves getting denser each time, high dissonant string tremolo tightening and shaking, dark cluster synth pad, sudden short low piano hits at irregular places, one bar of near silence now and then before the pattern returns closer and louder, pressure and panic building but never releasing, 88 BPM, B flat minor with tritone and minor second clashes, tension stays high, no build-up, no climax, no jump scare hits, no footsteps, instrumental, about 1 minute long, starts and ends on the same heartbeat pulse and music box pattern, seamless loop, no intro, no outro, consistent mood throughout
```

**代案**（ノイズをもっと前に。オルゴールがノイズの中から聞こえる）：
```
Japanese visual novel horror BGM, urgent and dissonant, not sad, no lyrical melody, a constant bed of crackling static and white noise with louder bursts, a badly out-of-tune music box tritone pattern heard through the noise and creeping upward half step by half step then restarting, fast anxious sub-bass heartbeat pulse, high dissonant string tremolo, distorted low drone, irregular short silences then everything returns closer and louder, suffocating and panicked, 90 BPM, B flat minor with tritone and minor second clashes, tension stays high, no build-up, no climax, no jump scare hits, no footsteps, instrumental, about 1 minute long, starts and ends on the same heartbeat pulse and music box pattern, seamless loop, no intro, no outro, consistent mood throughout
```

寄せ方の目安：
- Exclude styles には `sad, melancholic, emotional, lyrical, melody, calm, ambient, slow, foley, footsteps, orchestra, cinematic, koto, shamisen, taiko, ethnic` を入れる
- 差し迫る感が足りないなら、テンポを 96 に上げて `fast anxious sub-bass pulse` を `fast anxious sub-bass pulse in eighth notes` にする（100 を超えると切迫と被る）
- ノイズが足りないなら `a bed of low static and white noise` を `a loud bed of static and white noise` にする
- オルゴールが埋もれるなら `music box` に `clearly audible on top` を添える

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
