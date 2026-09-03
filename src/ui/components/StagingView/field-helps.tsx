import type { ReactNode } from 'react'
import { GAME_FEATURES } from '@/core/game/features'
import { FieldHelp } from '@/ui/components/FieldHelp/field-help'

/**
 * 演出エディタの欄ごとの説明（ラベル横のⓘ）。
 *
 * 欄の下に説明を並べると、右側のパネルが文字で埋まって**触るものが見えなくなる**。
 * 説明はここへ畳み、代わりに「何が起きるか」「どこまで効くか」「どう使うか」まで書く。
 * とくに「場面が変わる」と「立ち絵を出さない」は、効く範囲を知らないと混乱する。
 */

/** 説明 1 項目（見出し＋本文）。 */
function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="font-medium text-[12px] text-on-surface">{label}</h3>
      <p className="mt-0.5">{children}</p>
    </div>
  )
}

export function SpeakerHelp() {
  return (
    <FieldHelp title="話者" description="このセリフを誰が言ったか。画面下の名前枠に出ます。">
      <Item label="選び方は3通り">
        用語集に登録した人物から選ぶ、？？？（名前を伏せる）、自由に入力する。自由に入力した名前は、
        同じ作品のほかの行でも候補に並びます。
      </Item>
      <Item label="立ち絵とつながっています">
        その人の立ち絵を登録してあると、この行で自動的に立ちます。話している人だけが明るくなります。
      </Item>
      <Item label="名前を出したくないとき">
        ？？？を選ぶと名前枠が ？？？
        になり、立ち絵も出ません。「（なし：名前を出さない）」にすると、
        名前枠そのものが消えます。付けた話者を外すときもこれを選びます。
      </Item>
    </FieldHelp>
  )
}

export function SpriteHelp() {
  return (
    <FieldHelp title="立ち絵" description="その人に登録した絵から、この行で使う表情を選びます。">
      <Item label="（指定なし：通常）とは">
        その人に最初に登録した1枚です。表情を足すと、ここで選べるようになります。選んだ表情を
        やめるときもこれに戻します。
      </Item>
      <Item label="登場の行でも選べます">
        地の文の「立ち絵の登場」で選んだ人にも、ここで表情を付けられます。すでに立っている人でも、
        表情を選べばその絵に差し替わります。
      </Item>
      <Item label="立てるのは2人まで">
        1人なら中央、2人なら左右に立ちます。3人目が来ると、いちばん長く話していない人と入れ替わります。
      </Item>
      <Item label="下がるとき">
        場面が変わると全員下がります。「ここから立ち絵を出さない」を入れた行でも下がります。
      </Item>
    </FieldHelp>
  )
}

export function AppearHelp() {
  return (
    <FieldHelp
      title="立ち絵の登場"
      description="地の文の行から立ち絵を出します。セリフより前に姿を見せたいときに。"
    >
      <Item label="名前枠は出ません">
        誰が喋ったかの話ではないので、画面下の名前は変わりません。
      </Item>
      <Item label="セリフの無い人物にも使えます">
        一言も喋らない人物でも、ここで選んでその場で立ち絵を登録できます。
      </Item>
      <Item label="すでに立っている人には、表情を選んだときだけ効きます">
        下の「立ち絵」で表情を選ぶと、その人の絵が差し替わります。選ばなければ、そのままです。
      </Item>
      <Item label="外すとき">「（なし）」を選びます。付けていた表情も一緒に外れます。</Item>
    </FieldHelp>
  )
}

export function SceneBreakHelp() {
  return (
    <FieldHelp
      title="ここから場面が変わる"
      description="時間や場所が飛ぶところに入れる区切りです。"
    >
      <Item label="何が起きるか">
        この行で立ち絵が全員下がります。背景を変える起点にもなります。
      </Item>
      <Item label="どこまで効くか">
        次の「場面が変わる」までが1つの場面です。背景も立ち絵も、その間は続きます。
      </Item>
      <Item label="提案について">
        本文で空行が2つ以上続いた次の行には「場面の切れ目？」と出ます。提案のままでは何も起きません。
        ここを入れて決めるのは作者です。
      </Item>
      <Item label="本文は変わりません">
        原稿に区切り線や記号が入ることはありません。演出だけに残ります。
      </Item>
    </FieldHelp>
  )
}

export function HideSpriteHelp() {
  return (
    <FieldHelp
      title="ここから立ち絵を出さない"
      description="人物ごと描いた一枚絵を背景にする場面のための欄です。"
    >
      <Item label="何が起きるか">
        この行で立ち絵が全員下がり、そのあとは話者を選んでも立ち絵が出ません。背景の中の人物と
        立ち絵が二重になるのを防げます。
      </Item>
      <Item label="どこまで効くか">
        次の「場面が変わる」までです。場面が変われば、また立ち絵が出るようになります。
      </Item>
      <Item label="名前枠は出ます">消えるのは絵だけです。誰のセリフかは今までどおり出ます。</Item>
      <Item label="同じ場面でまた出したいとき">
        地の文の行の「立ち絵の登場」で人物を選ぶと、そこから出ます。
      </Item>
    </FieldHelp>
  )
}

export function BgHelp() {
  return (
    <FieldHelp title="背景" description="この行から背景が変わります。">
      <Item label="（なし：変えない）のとき">
        前の背景のまま進みます。背景は一度変えると、次に変えるまで続きます。この行に付けた背景を
        外すときもこれを選びます。
      </Item>
      <Item label="テンプレと持ち込み">
        テンプレは場所と時間帯の組み合わせで用意してあります。手元の画像も持ち込めます
        （枚数と保管は「素材の管理」から）。
      </Item>
      <Item label="場面の切れ目と一緒に">
        場所が変わるところでは「ここから場面が変わる」も入れておくと、立ち絵が持ち越されません。
      </Item>
    </FieldHelp>
  )
}

export function TransitionHelp() {
  return (
    <FieldHelp title="切り替え方" description="背景が変わるときの見え方です。">
      <Item label="3通り">
        ゆっくり切り替え（既定）、ぱっと切り替え、白いフラッシュ。時間が飛ぶところはゆっくり、
        驚きや衝撃はフラッシュ、と使い分けられます。
      </Item>
    </FieldHelp>
  )
}

export function SeHelp() {
  return (
    <FieldHelp title="効果音" description="この行が表示された瞬間に鳴ります。">
      <Item label="鳴らし方は3通り">
        1回、2回（続けて2度）、ずっと（雨や風のような環境音）。音を選ぶと下に出ます。
      </Item>
      <Item label="「ずっと」が終わるとき">
        次の「場面が変わる」までです。場面の途中で止めるときは、止めたい行で効果音に
        「ここで止める」を選びます。1回・2回の音は、鳴っている環境音に重ねて鳴らせます。
      </Item>
      <Item label="合成の音と素材の音">
        「合成」の音は端末でその場で作るので、書き出しても重くなりません。素材の音（mp3）は、
        使った分だけ同梱されます。
      </Item>
      <Item label="読者は切れます">
        ゲーム側のメニューで「効果音：なし」にできます。音が出せない場所でも読めるようにするためです。
      </Item>
      <Item label="試聴">
        横の「試聴」で、ここで鳴る音をそのまま確かめられます。「ずっと」を選んだときは、
        繰り返しが分かるように3回ぶんだけ鳴らします。
      </Item>
    </FieldHelp>
  )
}

export function ContinuityHelp() {
  return (
    <FieldHelp
      title="行の左の線"
      description={`背景・立ち絵${GAME_FEATURES.se ? '・環境音' : ''}が、どこから どこまで効いているかを示します。`}
    >
      <Item label="線が伸びている間は続いています">
        演出は設定した行から先へ続きます。線の頭の丸が「ここで変わった」印で、線が切れるところが
        終わりです。線にカーソルを合わせると、いま何が効いているか出ます。
      </Item>
      {GAME_FEATURES.se ? (
        <Item label="3本の意味">
          左から、背景（次に変えるまで）、立ち絵（場面が変わるまで）、環境音（場面が変わるか
          「止める」まで）。背景は場面が変わっても続きます——切れ目で下りるのは立ち絵と環境音です。
        </Item>
      ) : (
        <Item label="2本の意味">
          左が背景（次に変えるまで）、右が立ち絵（場面が変わるまで）。背景は場面が変わっても
          続きます——切れ目で下りるのは立ち絵です。
        </Item>
      )}
      <Item label="薄い線">
        「ここから立ち絵を出さない」が効いている区間です。人物は決まっているのに、絵は出ません。
      </Item>
      <Item label="行を選ぶと言葉でも出ます">
        右側の上に「この行に効いているもの」が出ます。選んだ行から実際に再生して確かめることも
        できます（「この行から見る」）。
      </Item>
    </FieldHelp>
  )
}
