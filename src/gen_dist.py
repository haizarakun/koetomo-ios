import hashlib,os,subprocess,gzip,bz2,json,datetime,sys
ver=sys.argv[1]; base='/tmp/kt_ios/dist/repo'; RAW='https://raw.githubusercontent.com/haizarakun/koetomo-ios/main/repo/'
entries=[]
for f in sorted(os.listdir(base+'/debs')):
    if not f.endswith('.deb'): continue
    path=base+'/debs/'+f; data=open(path,'rb').read()
    ctl=subprocess.check_output(['dpkg-deb','-f',path]).decode().strip()
    ctl+='\nFilename: debs/'+f+'\nSize: '+str(len(data))+'\nMD5sum: '+hashlib.md5(data).hexdigest()+'\nSHA1: '+hashlib.sha1(data).hexdigest()+'\nSHA256: '+hashlib.sha256(data).hexdigest()
    ctl+='\nDepiction: https://github.com/haizarakun/koetomo-ios\nIcon: '+RAW+'icon.png\n'
    entries.append(ctl)
pk='\n'.join(entries)+'\n'
open(base+'/Packages','w').write(pk); open(base+'/Packages.gz','wb').write(gzip.compress(pk.encode())); open(base+'/Packages.bz2','wb').write(bz2.compress(pk.encode()))
open(base+'/Release','w').write('Origin: KoeTomo+ Repo\nLabel: KoeTomo+ Repo\nSuite: stable\nVersion: 1.0\nCodename: ios\nArchitectures: iphoneos-arm iphoneos-arm64\nComponents: main\nDescription: KoeTomo+ iOS (rootless / rootful jailbreak) repository\n')
sp='/tmp/kt_ios/dist/source.json'
src=json.load(open(sp)) if os.path.exists(sp) else {"name":"KoeTomo+ Source","identifier":"com.akun.koetomo.source","apps":[{"bundleIdentifier":"com.akun.koetomo","versions":[]}],"news":[]}
app=src['apps'][0]; ipa='/tmp/kt_ios/dist/KoeTomoPlus_v%s.ipa'%ver
v={"version":ver,"date":datetime.date.today().isoformat(),"localizedDescription":open('/tmp/kt_ios/dist/notes_%s.txt'%ver).read().strip() if os.path.exists('/tmp/kt_ios/dist/notes_%s.txt'%ver) else "更新","downloadURL":"https://raw.githubusercontent.com/haizarakun/koetomo-ios/main/ipa/KoeTomoPlus_v%s.ipa"%ver,"size":os.path.getsize(ipa),"minOSVersion":"14.0"}
app['versions']=[v]+[x for x in app.get('versions',[]) if x.get('version')!=ver]
json.dump(src,open(sp,'w'),ensure_ascii=False,indent=1)
print('dist ok', ver)
