# ことば鳥のスプライトシート・中間版

個別PNGの元になった中間版を作るときに使ったプロンプトの原文です。どちらの生成でも透明背景を指定しました。

## 1. 水彩版と手描き版の中間に調整

参照画像は、1枚目が [水彩版](../kotobadori-sprites-watercolor.png)、2枚目が [手描き版](../kotobadori-sprites-handdrawn.png) です。

```text
Edit first image toward a gentle visual middle between these two versions of the same original bird sprite sheet, weighted 70% first image and 30% second. Start from first: keep original blue bird, all 9 groups, precise 3x3 positions and four icons in group 8. Give the outlines just a little more visible freehand wobble and pressure variation: thin to medium warm brown pencil, airy at turns, no black chunky contours. Moderately clear sky blue between powder blue and cobalt, mellow golden yellow, leafy soft green, warm dusty pink. Let a few visible brush strokes and small gentle pigment pools show within matte watercolor areas, no dramatic pooling or bright white flecks. Classic warm hand-illustrated picture book. Same leaf display frame and icon frame, both with truly transparent inner openings. Entire canvas behind sprites true transparent alpha, wide clear gutters, no text. 2048x2048 square PNG.
```

## 2. 背景と枠の内側を透過

手順1の出力を参照画像として使いました。

```text
Background removal only. Preserve exact existing 9 watercolor sprite groups, color, style, geometry, layout. Cut sharply around outer ink contours and around frame holes. All space outside the ink contours must become completely invisible with alpha zero. Remove all translucent halos, shadows, white and off-white backing. No added strokes or objects. Opaque pigment within contours, isolated sprites on clear empty transparency. Square PNG.
```

手順2の出力を透明度を保ったまま2048×2048 pxに拡大し、[完成版シート](../kotobadori-sprites-soft-handdrawn.png) から12枚の個別PNGを切り出しました。
