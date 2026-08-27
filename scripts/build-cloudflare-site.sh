#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
site_dir="${repo_root}/_cf_site"

rm -rf -- "${site_dir}"
mkdir -p "${site_dir}/project-page"

cp \
  "${repo_root}/index.html" \
  "${repo_root}/logo.png" \
  "${repo_root}/method.png" \
  "${repo_root}/rpg-bench-overview.png" \
  "${repo_root}/teaser.png" \
  "${repo_root}/rpg-dreamer-top-hero-poster.webp" \
  "${repo_root}/top-video-intro-poster.webp" \
  "${repo_root}/top_video_1.mp4" \
  "${repo_root}/top_video_2.mp4" \
  "${site_dir}/"

cp -a "${repo_root}/fonts" "${repo_root}/Author_logo" "${site_dir}/"
cp "${repo_root}/project-page/rpg-demo.css" "${repo_root}/project-page/rpg-demo.js" "${site_dir}/project-page/"
cp -a "${repo_root}/project-page/cartridge-covers" "${site_dir}/project-page/"
touch "${site_dir}/.nojekyll"

find "${site_dir}" -type f -size +25M -print -quit | grep -q . && {
  echo "Cloudflare Pages bundle contains a file larger than 25 MiB." >&2
  exit 1
}

echo "Cloudflare Pages bundle ready: $(find "${site_dir}" -type f | wc -l) files, $(du -sb "${site_dir}" | cut -f1) bytes"
