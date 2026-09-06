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
# 秘密値(任意): /tmp/kt_ios/secrets.env に KOETOMO_ENC_KEY=<base64> / X_CLIENT_ID=<id> があれば XOR 分割して埋め込む。無ければ空(Xログイン未設定)
python3 - <<'PY'
import os,secrets
vals={'KOETOMO_ENC_KEY':'','X_CLIENT_ID':''}
p='/tmp/kt_ios/secrets.env'
if os.path.exists(p):
    for line in open(p):
        line=line.strip()
        if '=' in line and not line.startswith('#'):
            k,v=line.split('=',1); k=k.strip(); v=v.strip().strip('"').strip("'")
            if k in vals: vals[k]=v
def arrs(name,val):
    b=val.encode(); pad=secrets.token_bytes(len(b)); a=bytes(x^y for x,y in zip(b,pad))
    fmt=lambda bs: ', '.join(str(x) for x in bs) + (', ' if bs else '') + '0'
    return 'static const unsigned char kKT%sA[] = { %s };\nstatic const unsigned char kKT%sB[] = { %s };'%(name,fmt(a),name,fmt(pad))
out=['// 自動生成(build_ios.sh)。編集しない。リポジトリに秘密値そのものは置かない。', arrs('Enc',vals['KOETOMO_ENC_KEY']), arrs('X',vals['X_CLIENT_ID'])]
open('/tmp/kt_ios/Sources/KTSecrets.h','w').write('\n'.join(out)+'\n')
print('secrets:', 'set' if vals['KOETOMO_ENC_KEY'] else 'EMPTY (X login disabled)')
PY
# 改変検知用: 同梱 web 資産の SHA-256 をヘッダに焼き込む(起動時に照合)
python3 - "$VER" <<'PY'
import hashlib,os,sys
ver=sys.argv[1]; base='/tmp/kt_ios/Resources/web'; rows=[]
for root,_,files in os.walk(base):
    for f in sorted(files):
        p=os.path.join(root,f); rel=os.path.relpath(p,base).replace(os.sep,'/')
        rows.append((rel,hashlib.sha256(open(p,'rb').read()).hexdigest()))
rows.sort()
out=['// 自動生成(build_ios.sh)。編集しない。','#define KT_EXPECTED_VERSION "%s"'%ver,'static const struct { const char *path; const char *sha256; } kKTIntegrity[] = {']
out+=['    { "%s", "%s" },'%r for r in rows]; out.append('};')
open('/tmp/kt_ios/Sources/KTIntegrity.h','w').write('\n'.join(out)+'\n')
print('integrity manifest:',len(rows),'files')
PY
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
