# 47国志 Wasm版

『47国志』に着想を得た、ブラウザで遊べる都道府県統一シミュレーションです。simulation（地図・内政・合戦・CPU・外交・知事選）は **AssemblyScript → WebAssembly** で動き、画面は TypeScript + Leaflet + Three.js（WebGL、インスタンス描画）+ anime.js で描いています。HOI4風のダークな政治地図、軍事UI、3D部隊表示を備えています。

> 非公式のファンメイド作品です。元ゲームのデータ・画像・コードは使っていません。日本の行政界・人口は実データを使用しています。

## できること

- 47都道府県から1つ選び、10年 / 20年 / 期限なしでプレイ
- 市町村単位の内政（商業・開墾・殖産・祭り・築城・徴兵・募兵・造船・集結）
- 隣接する町への出陣、港どうしの渡海、勝算の事前判定
- CPU 47勢力の内政・出陣・外交の申し出
- 同盟・停戦・交易・贈り物、関係値と気質。地域・隣接・慣習（薩摩／長州、会津、近畿など）による初期関係度を設定
- 予算で武器・戦闘機を調達し、航空技術を段階更新。装備と航空力が攻撃・防御に反映
- 季節、兵糧、士気、勢い、補給線、知事選、順位
- 県庁が陥落すると最も栄えた残存都市へ自動遷都。民心が低下した町は隣接勢力へ寝返ることがある
- ローカル自動セーブ、JSONセーブの書き出し／読み込み
- 戦果・参謀の進言・人材・名産の表示とカットイン演出
- 政治／地形／航空の地図モード、くっきりした国境と落ち着いた勢力色
- ズームに応じて高速道路・新幹線・在来線の概略線を表示。街道と鉄道はツールチップ付き
- 広域では47都道府県ポリゴン、ズームすると1741市区町村ポリゴンへ切り替え。未征服の町は県色に統一
- 「旗」タブから都道府県の表示名と旗（絵文字・短い文字列）を変更。地図ツールチップ、地図タイトル、3D旗に反映（この端末の local storage に保存）
- Three.js の WebGL インスタンス描画による3D歩兵・艦船、滑らかな補間・足並み・行軍演出（表示切替可、3Dコードは開始後に遅延読み込み）
- anime.js によるカットイン／モーダル／開始画面の演出（`prefers-reduced-motion` 対応）

## データ出典

- 行政界：国土交通省 国土数値情報 行政区域データ（N03-21 2021、CC BY 4.0）。`smartnews-smri/japan-topography` のデータを整理し、mapshaper で TopoJSON 化しています。47都道府県は `-dissolve pref` で別ファイルにしています。
- 人口・市区町村分類：総務省 令和7年国勢調査を `machi-report.com` が整理したデータ（出典表示付き）。政令市の区は親市にまとめています。
- 背景地図：国土地理院 地理院タイル（政治／地形は起伏色、航空は seamlessphoto）。ダークテーマでは CSS filter で暗化しています。
- 交通：`public/data/routes.json` は県庁所在地を結ぶ自作の概略線（高速道路・新幹線・在来線）。実線路・実経路ではありません。

再生成する場合は Python と Node が必要です。

```sh
python3 scripts/generate-data.py
```

## 開発

```sh
npm install
npm run dev       # WasmをビルドしてVite開発サーバーを起動
```

Wasmだけ再ビルドする場合：

```sh
npm run build:wasm
```

テスト・型チェック：

```sh
npm test
npm run typecheck
```

## ビルド

```sh
npm run build
```

`npm run build` は次の2段階です。

1. `asc engine/main.ts --outFile public/engine.wasm ...` で AssemblyScript を Wasm にコンパイル
2. `vite build` で `dist/` に静的サイトを生成

## Cloudflare Pages へのデプロイ

### Git 連携の場合

1. Cloudflare Pages でこのリポジトリを接続する
2. ビルド設定を以下のようにする

| 項目                   | 値                   |
| ---------------------- | -------------------- |
| Build command          | `npm run build`      |
| Build output directory | `dist`               |
| Node.js version        | `20` 以上（22 推奨） |

### Wrangler から直接デプロイする場合

```sh
npm install
npm run build
npx wrangler pages deploy dist
```

`wrangler.toml` に `pages_build_output_dir = "dist"` を指定済みです。

## 構成

```text
engine/
  data.ts     都道府県・特産などの固定定義
  realdata.ts scripts/generate-data.py が生成した1741町の実データ
  game.ts     ゲーム状態とシミュレーション本体（AssemblyScript）
  main.ts     JSから呼ぶWasmのエントリポイント
src/
  engine.ts   Wasmローダーとセーブ／リプレイ
   map.ts      Leaflet地図と実行政界（都道府県／市区町村）の描画
   units3d.ts  Three.js(WebGL)による3D部隊と行軍演出
  main.ts     UIと操作
  tokens.css  色・余白・書体・影・動きのデザイントークン
  style.css   ベーススタイル
  start.css   開始画面
  console.css HUD／情報パネル
  map-ui.css  地図UI／凡例
  cinema.css  モーダル／カットイン
scripts/
  generate-data.py  実人口・行政界・隣接データの生成
tests/
  engine.test.mjs   WasmエンジンのNodeテスト
public/engine.wasm  ビルド成果物
public/data/municipalities.json  地図用TopoJSON（1741市区町村）
public/data/prefectures.json     地図用TopoJSON（47都道府県）
public/data/routes.json          高速道路・新幹線・在来線の概略線
```

JS から Wasm へは数値しか渡さず、Wasm から返る文字列（JSON）を JS で解析します。セーブは操作履歴を保存して同じseedで再生する方式なので、状態そのものは Wasm の外にありません。

## 遊び方の概要

- 毎月、行動力を使ってコマンドを実行し、「月を進める」を押します。
- 出陣は相手の町を選び、兵の数を決めて予約します。月末に合戦が解決します。
- 4年ごとに知事選があり、地元の支持が50%を切ると終わりです。
- 全ての町を取れば天下統一。10年・20年モードは期限時の順位も評価されます。
- 県名と旗の変更は表示用のローカル設定で、セーブ／リプレイには含まれません。

## ライセンス / 注意

オリジナルの『47国志』（AMIX / トミナガハルキ）とは関係ありません。商標・著作権はそれぞれの権利者に帰属します。
