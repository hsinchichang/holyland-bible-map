# 聖地經文地圖

以色列朝聖用的手機網頁 App（PWA）：地圖、照片、和合本經文、故事、行程、時間軸、打卡與筆記，可離線使用。

## 結構

- `docs/` — App 本體，GitHub Pages 直接發佈這個資料夾
- `content/places.json` — 所有地點、行程、時間軸的內容（要改內容就改這裡）
- `tools/build.py` — 依 `content/places.json` 抓取和合本經文與照片，產生 `docs/data/data.js`

## 修改內容

1. 編輯 `content/places.json`
2. 執行 `python3 tools/build.py`
3. 把 `docs/sw.js` 裡的 `VERSION` 加一號（例如 `v4` → `v5`），已安裝的手機下次打開就會自動更新
4. commit 並 push

## 本機預覽

```
python3 -m http.server 8765 --directory docs
```

## 資料來源

- 經文：和合本（公有領域），取自 bolls.life
- 照片：Wikimedia Commons，作者與授權標示在 App 內每張照片上
- 地圖：Esri World Topographic Map；簡圖取自 Natural Earth
