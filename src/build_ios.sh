#!/bin/bash
# KoeTomo+ iOS ビルド(クラウド Linux / Theos)。成果物: dist/KoeTomoPlus_vX.ipa(未署名), dist/repo(Sileo リポジトリ), dist/source.json(SideStore)
set -e
export THEOS=/tmp/theos PATH=/tmp/theos/bin:$PATH
cd /tmp/kt_ios
VER=$(python3 -c "import plistlib;print(plistlib.load(open('Resources/Info.plist','rb'))['CFBundleShortVersionString'])")
sed -i "s/^Version: .*/Version: $VER/" control
# web assets を Android 版と同期(ios/ ディレクトリは残す)
rsync -a --delete --exclude ios/ /tmp/koetomo_client/extracted/assets/web/ Resources/web/
cp /tmp/koetomo_client/extracted/assets/mascot_loading.gif Resources/
# 保守スクリプトの shebang をスキームに合わせる(rootless は /var/jb/bin/sh)
set_shebang() { sed -i "1s|^#!.*|#!$1|" layout/DEBIAN/postinst layout/DEBIAN/postrm; }
rm -rf packages
# rootless (.deb: iphoneos-arm64, /var/jb) — Dopamine / palera1n rootless 等
set_shebang /var/jb/bin/sh; sed -i "s/^Architecture: .*/Architecture: iphoneos-arm64/" control
make clean >/dev/null 2>&1 || true
THEOS_PACKAGE_SCHEME=rootless make package FINALPACKAGE=1 2>&1 | grep -iE "error|warning: " || true
# rootful (.deb: iphoneos-arm, /Applications) — checkra1n / unc0ver / palera1n rootful 等
set_shebang /bin/sh; sed -i "s/^Architecture: .*/Architecture: iphoneos-arm/" control
make clean >/dev/null 2>&1 || true
THEOS_PACKAGE_SCHEME= make package FINALPACKAGE=1 2>&1 | grep -iE "error|warning: " || true
# IPA (TrollStore / SideStore) は rootless ビルドの .app を使う
set_shebang /var/jb/bin/sh; sed -i "s/^Architecture: .*/Architecture: iphoneos-arm64/" control
make clean >/dev/null 2>&1 || true
THEOS_PACKAGE_SCHEME=rootless make ipa FINALPACKAGE=1 >/dev/null
mkdir -p dist/repo/debs && rm -f dist/repo/debs/*.deb dist/*.ipa
cp packages/com.akun.koetomo_${VER}_iphoneos-arm64.deb packages/com.akun.koetomo_${VER}_iphoneos-arm.deb dist/repo/debs/
cp .theos/obj/KoeTomoPlus.ipa dist/KoeTomoPlus_v${VER}.ipa
python3 /tmp/kt_ios/gen_dist.py "$VER"
ls -l dist/*.ipa dist/repo/debs/*.deb
