#!/bin/bash
# 第一次上線：建立公開的 GitHub repo，上傳，並開啟 GitHub Pages（從 main 分支的 docs/ 資料夾）
set -e
cd "$(dirname "$0")"

gh auth setup-git
git config user.name "hsinchichang"
git config user.email "182478012+hsinchichang@users.noreply.github.com"

git add -A
git commit -m "聖地經文地圖：以色列朝聖 PWA 第一版

22 個聖經地點（和合本經文、故事、照片）、行程、時間軸、打卡筆記、離線使用。

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"

gh repo create holyland-bible-map --public \
  --description "以色列朝聖用的聖經地點地圖：經文、故事、照片、行程，可離線使用" \
  --source . --remote origin --push

gh api -X POST repos/hsinchichang/holyland-bible-map/pages \
  -f "source[branch]=main" -f "source[path]=/docs" > /dev/null

echo ""
echo "完成！大約 1–2 分鐘後可以打開：https://hsinchichang.github.io/holyland-bible-map/"
