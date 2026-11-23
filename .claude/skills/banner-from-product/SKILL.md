---
name: banner-from-product
description: 記事のバナー（1200×630）やロゴ画像を、プロダクト本物のロゴ・スプライト・CSS から作る。「バナーを作って」「ロゴを入れて」と言われたら使う。別途作られたロゴ案ではなく、アプリの画面と同じものを使う。
---

# プロダクト本物から、バナーを作る

## 教訓
- 「ロゴ」と言われたら、**アプリの画面に出ているロゴ**を指す。別に作られたロゴ案・イラストの画像を、勝手に使わない。迷ったら、まず、画面（`museum.html` など）のヘッダーを見る。
- このリポジトリのロゴは、画像でなく、`ui.css` の `.logo`（文字のロゴ。わざと言い間違えた表記）。

## 手順
1. ロゴのマークアップと、使っている CSS・フォントを、実装から読む（`ui.css` の `.logo`、Google Fonts）。
2. 作業用 HTML（スクラッチパッド）で、`ui.css` を `file:///` で読み込み、**同じマークアップ**を、大きく置く。スプライトは `assets/ui/` の実物を使う。
3. 他の装飾（アプリにない物差し・影など）は、足さない。
4. Edge のヘッドレスで、画像にする。
   ```
   msedge --headless --disable-gpu --hide-scrollbars --allow-file-access-from-files \
     --force-device-scale-factor=1 --window-size=1200,630 --virtual-time-budget=10000 \
     --screenshot=out.png file:///.../banner.html
   ```
   - `--virtual-time-budget` で、Web フォントの読み込みを待つ。
   - ロゴ単体は、`--force-device-scale-factor=2` で。背景は、**紙の色**にする（透明だと、ダークモードで文字が見えない）。
5. 画像を読んで、**サイズ（1200×630）・文字の欠け・余白**を確認する。クラス名の衝突（`.tag` など、`ui.css` と重なる名前）に注意。
6. `docs/article/assets/` に置いて、記事から参照する。生成画像（AI）を使う場合は、記事にその旨を書く。
