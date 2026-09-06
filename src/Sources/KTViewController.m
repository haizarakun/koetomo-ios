#import "KTViewController.h"
#import <Security/Security.h>
#import <AVFoundation/AVFoundation.h>
#import <AudioToolbox/AudioToolbox.h>
#import <CommonCrypto/CommonCrypto.h>

// ===== Keychain (Android の SecureStore/Keystore 相当) =====
static NSString *const kKeychainService = @"com.akun.koetomo";

static NSMutableDictionary *kcQuery(NSString *key) {
    return [@{ (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
               (__bridge id)kSecAttrService: kKeychainService,
               (__bridge id)kSecAttrAccount: key ?: @"" } mutableCopy];
}
static NSString *kcGet(NSString *key) {
    NSMutableDictionary *q = kcQuery(key);
    q[(__bridge id)kSecReturnData] = @YES;
    q[(__bridge id)kSecMatchLimit] = (__bridge id)kSecMatchLimitOne;
    CFTypeRef out = NULL;
    OSStatus st = SecItemCopyMatching((__bridge CFDictionaryRef)q, &out);
    if (st != errSecSuccess || out == NULL) return nil;
    NSData *d = (__bridge_transfer NSData *)out;
    return [[NSString alloc] initWithData:d encoding:NSUTF8StringEncoding];
}
static void kcSet(NSString *key, NSString *value) {
    NSMutableDictionary *q = kcQuery(key);
    SecItemDelete((__bridge CFDictionaryRef)q);
    if (value == nil || value.length == 0) return;
    q[(__bridge id)kSecValueData] = [value dataUsingEncoding:NSUTF8StringEncoding];
    q[(__bridge id)kSecAttrAccessible] = (__bridge id)kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly;
    SecItemAdd((__bridge CFDictionaryRef)q, NULL);
}

// ===== 診断ログ(リングバッファ) =====
static NSMutableArray<NSString *> *gLog;
static void ktLog(NSString *line) {
    if (!gLog) gLog = [NSMutableArray new];
    @synchronized (gLog) {
        [gLog addObject:line ?: @""];
        while (gLog.count > 500) [gLog removeObjectAtIndex:0];
    }
    NSLog(@"[KoeTomo+] %@", line);
}
static NSString *ktNow(void) {
    static NSDateFormatter *f; if (!f) { f = [NSDateFormatter new]; f.dateFormat = @"yyyy-MM-dd HH:mm:ss"; }
    return [f stringFromDate:[NSDate date]];
}
static NSString *jsonString(id obj) {
    if (!obj) return @"null";
    NSData *d = [NSJSONSerialization dataWithJSONObject:obj options:0 error:nil];
    return d ? [[NSString alloc] initWithData:d encoding:NSUTF8StringEncoding] : @"null";
}
// 診断ログ用: URL 中の秘密(auth_token / AWS 署名・一時トークン)を伏せる
static NSString *maskQuery(NSString *u) {
    if (![u isKindOfClass:[NSString class]]) return @"";
    NSRegularExpression *re = [NSRegularExpression regularExpressionWithPattern:@"((?:auth_token|token|sessionToken|X-Amz-Security-Token|X-Amz-Signature|X-Amz-Credential)=)[^&#]*" options:NSRegularExpressionCaseInsensitive error:nil];
    return [re stringByReplacingMatchesInString:u options:0 range:NSMakeRange(0, u.length) withTemplate:@"$1***"];
}
static NSString *jsQuote(NSString *s) {
    // JS 文字列リテラルとして安全に埋め込む(JSON 文字列は JS リテラル互換。U+2028/2029 も潰す)
    NSString *j = jsonString(@[s ?: @""]);
    j = [j substringWithRange:NSMakeRange(1, j.length - 2)];
    j = [j stringByReplacingOccurrencesOfString:@"\u2028" withString:@"\\u2028"];
    j = [j stringByReplacingOccurrencesOfString:@"\u2029" withString:@"\\u2029"];
    return j;
}

// ===== AWS SigV4 (S3 PUT / presigned GET) と Cognito: Android 版 s3PutBytes / s3PresignGet / cognitoCredentials の移植 =====
static NSString *hexOf(const unsigned char *b, size_t n) { NSMutableString *s = [NSMutableString stringWithCapacity:n * 2]; for (size_t i = 0; i < n; i++) [s appendFormat:@"%02x", b[i]]; return s; }
static NSString *sha256Hex(NSData *d) { unsigned char out[CC_SHA256_DIGEST_LENGTH]; CC_SHA256(d.bytes, (CC_LONG)d.length, out); return hexOf(out, CC_SHA256_DIGEST_LENGTH); }
static NSString *md5Hex(NSData *d) { unsigned char out[CC_MD5_DIGEST_LENGTH]; CC_MD5(d.bytes, (CC_LONG)d.length, out); return hexOf(out, CC_MD5_DIGEST_LENGTH); }
static NSData *hmac256(NSData *key, NSString *msg) { unsigned char out[CC_SHA256_DIGEST_LENGTH]; NSData *m = [msg dataUsingEncoding:NSUTF8StringEncoding]; CCHmac(kCCHmacAlgSHA256, key.bytes, key.length, m.bytes, m.length, out); return [NSData dataWithBytes:out length:CC_SHA256_DIGEST_LENGTH]; }
static NSString *awsUrlEnc(NSString *s) { NSMutableCharacterSet *cs = [NSMutableCharacterSet alphanumericCharacterSet]; [cs addCharactersInString:@"-_.~"]; return [s stringByAddingPercentEncodingWithAllowedCharacters:cs]; }
static void awsDates(NSString **amzDate, NSString **day) {
    NSDateFormatter *f1 = [NSDateFormatter new]; f1.dateFormat = @"yyyyMMdd'T'HHmmss'Z'"; f1.timeZone = [NSTimeZone timeZoneWithAbbreviation:@"UTC"]; f1.locale = [NSLocale localeWithLocaleIdentifier:@"en_US_POSIX"];
    NSDateFormatter *f2 = [NSDateFormatter new]; f2.dateFormat = @"yyyyMMdd"; f2.timeZone = f1.timeZone; f2.locale = f1.locale;
    NSDate *now = [NSDate date]; *amzDate = [f1 stringFromDate:now]; *day = [f2 stringFromDate:now];
}
static NSString *sigV4(NSString *secret, NSString *day, NSString *region, NSString *service, NSString *stringToSign) {
    NSData *k = [[@"AWS4" stringByAppendingString:secret] dataUsingEncoding:NSUTF8StringEncoding];
    k = hmac256(k, day); k = hmac256(k, region); k = hmac256(k, service); k = hmac256(k, @"aws4_request");
    NSData *sig = hmac256(k, stringToSign); return hexOf(sig.bytes, sig.length);
}

// ===== 同梱 web 資産を koetomo://app/ で配信する(file:// だと getUserMedia 等の secure context 判定で弾かれるため) =====
@interface KTSchemeHandler : NSObject <WKURLSchemeHandler>
@end
@implementation KTSchemeHandler
- (void)webView:(WKWebView *)webView startURLSchemeTask:(id<WKURLSchemeTask>)task {
    NSURL *u = task.request.URL;
    NSString *rel = [u.path stringByRemovingPercentEncoding] ?: @"/";
    if ([rel isEqualToString:@"/"] || rel.length == 0) rel = @"/index.html";
    NSString *base = [[NSBundle mainBundle].resourcePath stringByAppendingPathComponent:@"web"];
    NSString *path = [[base stringByAppendingPathComponent:rel] stringByStandardizingPath];
    NSData *data = [path hasPrefix:[base stringByAppendingString:@"/"]] ? [NSData dataWithContentsOfFile:path] : nil;
    if (!data) {
        NSHTTPURLResponse *nf = [[NSHTTPURLResponse alloc] initWithURL:u statusCode:404 HTTPVersion:@"HTTP/1.1" headerFields:@{@"Content-Type": @"text/plain"}];
        [task didReceiveResponse:nf]; [task didReceiveData:[@"not found" dataUsingEncoding:NSUTF8StringEncoding]]; [task didFinish]; return;
    }
    NSString *ext = path.pathExtension.lowercaseString;
    NSDictionary *mime = @{@"html": @"text/html; charset=utf-8", @"js": @"application/javascript; charset=utf-8", @"css": @"text/css; charset=utf-8", @"json": @"application/json", @"png": @"image/png", @"jpg": @"image/jpeg", @"jpeg": @"image/jpeg", @"gif": @"image/gif", @"svg": @"image/svg+xml", @"webp": @"image/webp", @"mp3": @"audio/mpeg", @"wav": @"audio/wav", @"woff": @"font/woff", @"woff2": @"font/woff2", @"ttf": @"font/ttf"};
    NSString *ct = mime[ext] ?: @"application/octet-stream";
    NSHTTPURLResponse *resp = [[NSHTTPURLResponse alloc] initWithURL:u statusCode:200 HTTPVersion:@"HTTP/1.1" headerFields:@{@"Content-Type": ct, @"Content-Length": [NSString stringWithFormat:@"%lu", (unsigned long)data.length], @"Cache-Control": @"no-cache", @"X-Content-Type-Options": @"nosniff"}];
    [task didReceiveResponse:resp]; [task didReceiveData:data]; [task didFinish];
}
- (void)webView:(WKWebView *)webView stopURLSchemeTask:(id<WKURLSchemeTask>)task {}
@end

@interface KTViewController ()
@property (nonatomic, strong) NSURLSession *session;
@property (nonatomic, assign) BOOL inCall;
@end

@implementation KTViewController

- (void)viewDidLoad {
    [super viewDidLoad];
    self.view.backgroundColor = [UIColor colorWithRed:0.07 green:0.08 blue:0.10 alpha:1];

    NSURLSessionConfiguration *sc = [NSURLSessionConfiguration defaultSessionConfiguration];
    sc.timeoutIntervalForRequest = 35;
    sc.timeoutIntervalForResource = 120;
    sc.HTTPShouldSetCookies = NO;
    self.session = [NSURLSession sessionWithConfiguration:sc];

    WKWebViewConfiguration *cfg = [WKWebViewConfiguration new];
    cfg.allowsInlineMediaPlayback = YES;
    cfg.mediaTypesRequiringUserActionForPlayback = WKAudiovisualMediaTypeNone;
    if (@available(iOS 14.0, *)) {
        cfg.defaultWebpagePreferences.allowsContentJavaScript = YES;
    }
    WKUserContentController *ucc = [WKUserContentController new];
    [ucc addScriptMessageHandler:self name:@"koe"];
    // ブリッジ(AndroidApi 互換)と JS 版セッション(API 層)を、ページの JS より先に注入する
    for (NSString *name in @[@"ios-bridge.js", @"ios-session.js", @"ios-session-ext3.js", @"ios-session-ext4.js"]) {
        NSString *path = [[NSBundle mainBundle] pathForResource:[name stringByDeletingPathExtension] ofType:@"js" inDirectory:@"web/ios"];
        NSString *src = path ? [NSString stringWithContentsOfFile:path encoding:NSUTF8StringEncoding error:nil] : nil;
        if (src.length) {
            [ucc addUserScript:[[WKUserScript alloc] initWithSource:src injectionTime:WKUserScriptInjectionTimeAtDocumentStart forMainFrameOnly:YES]];
        } else {
            ktLog([NSString stringWithFormat:@"[BOOT] 注入スクリプトが見つからない: %@", name]);
        }
    }
    cfg.userContentController = ucc;
    [cfg setURLSchemeHandler:[KTSchemeHandler new] forURLScheme:@"koetomo"];

    self.webView = [[WKWebView alloc] initWithFrame:self.view.bounds configuration:cfg];
    self.webView.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
    self.webView.UIDelegate = self;
    self.webView.navigationDelegate = self;
    self.webView.opaque = NO;
    self.webView.backgroundColor = self.view.backgroundColor;
    self.webView.scrollView.backgroundColor = self.view.backgroundColor;
    self.webView.scrollView.bounces = NO;
    self.webView.scrollView.contentInsetAdjustmentBehavior = UIScrollViewContentInsetAdjustmentNever;
    [self.view addSubview:self.webView];

    NSURL *index = [NSURL URLWithString:@"koetomo://app/index.html"];
    ktLog([NSString stringWithFormat:@"%@  [BOOT] load %@", ktNow(), index.absoluteString]);
    [self.webView loadRequest:[NSURLRequest requestWithURL:index]];
}

- (UIStatusBarStyle)preferredStatusBarStyle { return UIStatusBarStyleLightContent; }

- (void)handleIncomingURL:(NSURL *)url {
    NSString *js = [NSString stringWithFormat:@"try{window.__koeIncomingUrl&&window.__koeIncomingUrl(\"%@\")}catch(e){}", jsQuote(url.absoluteString)];
    [self.webView evaluateJavaScript:js completionHandler:nil];
}

// ===== JS への返答 =====
- (void)resolve:(NSString *)callId result:(id)obj {
    NSString *json = [obj isKindOfClass:[NSString class]] ? obj : jsonString(obj);
    NSString *js = [NSString stringWithFormat:@"window.__koeResolve(\"%@\", \"%@\");", jsQuote(callId), jsQuote(json)];
    dispatch_async(dispatch_get_main_queue(), ^{
        [self.webView evaluateJavaScript:js completionHandler:nil];
    });
}

// 同梱ページ(koetomo://app)のメインフレームからの呼び出しだけ受け付ける(iframe 等からのブリッジ悪用防止)
static BOOL trustedFrame(WKFrameInfo *frame) {
    if (!frame || !frame.isMainFrame) return NO;
    NSString *scheme = frame.securityOrigin.protocol ?: frame.request.URL.scheme;
    return [scheme isEqualToString:@"koetomo"];
}
static NSString *strArg(NSArray *a, NSUInteger i) { return (a.count > i && [a[i] isKindOfClass:[NSString class]]) ? a[i] : nil; }
static BOOL hostMatches(NSString *host, NSString *suffix) { host = host.lowercaseString; return [host isEqualToString:suffix] || [host hasSuffix:[@"." stringByAppendingString:suffix]]; }
static BOOL isKoeHost(NSString *host) { return hostMatches(host, @"meetscom.com"); }
static BOOL safeToken(NSString *s) { if (![s isKindOfClass:[NSString class]] || s.length == 0 || s.length > 64) return NO; NSCharacterSet *ok = [NSCharacterSet characterSetWithCharactersInString:@"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_."]; return [[s stringByTrimmingCharactersInSet:ok] length] == 0; }

// ===== 非同期ブリッジ: window.webkit.messageHandlers.koe.postMessage({id, m, a}) =====
- (void)userContentController:(WKUserContentController *)ucc didReceiveScriptMessage:(WKScriptMessage *)message {
    if (![message.body isKindOfClass:[NSDictionary class]]) return;
    if (!trustedFrame(message.frameInfo)) { ktLog([NSString stringWithFormat:@"%@  [SEC] 信頼されないフレームからのブリッジ呼び出しを拒否", ktNow()]); return; }
    NSDictionary *b = message.body;
    NSString *callId = [b[@"id"] isKindOfClass:[NSString class]] ? b[@"id"] : @"";
    NSString *m = [b[@"m"] isKindOfClass:[NSString class]] ? b[@"m"] : @"";
    NSArray *a = [b[@"a"] isKindOfClass:[NSArray class]] ? b[@"a"] : @[];

    if ([m isEqualToString:@"__http"]) { [self doHttp:a.firstObject callId:callId]; return; }
    if ([m isEqualToString:@"__kv_get"]) { NSString *v = strArg(a, 0) ? kcGet(strArg(a, 0)) : nil; [self resolve:callId result:@{@"ok": @YES, @"value": v ?: @""}]; return; }
    if ([m isEqualToString:@"__kv_set"]) { if (strArg(a, 0)) kcSet(strArg(a, 0), strArg(a, 1) ?: @""); [self resolve:callId result:@{@"ok": @YES}]; return; }
    if ([m isEqualToString:@"__log"]) { ktLog([NSString stringWithFormat:@"%@  %@", ktNow(), a.firstObject ?: @""]); [self resolve:callId result:@{@"ok": @YES}]; return; }
    if ([m isEqualToString:@"__native_log"]) {
        NSArray *copy; @synchronized (gLog) { copy = [gLog copy] ?: @[]; }
        [self resolve:callId result:@{@"ok": @YES, @"count": @(copy.count), @"log": copy}]; return;
    }
    if ([m isEqualToString:@"__clear_log"]) { @synchronized (gLog) { [gLog removeAllObjects]; } [self resolve:callId result:@{@"ok": @YES}]; return; }
    if ([m isEqualToString:@"__open_url"]) { [self openExternal:a.firstObject]; [self resolve:callId result:@{@"ok": @YES}]; return; }
    if ([m isEqualToString:@"__share_text"]) {
        NSString *t = strArg(a, 0) ?: @"";
        dispatch_async(dispatch_get_main_queue(), ^{
            UIActivityViewController *av = [[UIActivityViewController alloc] initWithActivityItems:@[t] applicationActivities:nil];
            av.popoverPresentationController.sourceView = self.view;
            [self presentViewController:av animated:YES completion:nil];
        });
        [self resolve:callId result:@{@"ok": @YES}]; return;
    }
    if ([m isEqualToString:@"__save_file"]) { [self saveFile:a callId:callId]; return; }
    if ([m isEqualToString:@"__cognito_creds"]) { [self cognitoCreds:a.firstObject callId:callId]; return; }
    if ([m isEqualToString:@"__s3_put"]) { [self s3Put:a.firstObject callId:callId]; return; }
    if ([m isEqualToString:@"__s3_presign"]) { [self resolve:callId result:[self s3Presign:a.firstObject]]; return; }
    if ([m isEqualToString:@"__md5"]) { NSData *d = [[NSData alloc] initWithBase64EncodedString:strArg(a, 0) ?: @"" options:NSDataBase64DecodingIgnoreUnknownCharacters]; [self resolve:callId result:@{@"ok": @(d != nil), @"md5": d ? md5Hex(d) : @"", @"size": @(d.length)}]; return; }
    [self resolve:callId result:@{@"ok": @NO, @"error": @"not_ported", @"message": [NSString stringWithFormat:@"「%@」は iOS 版ではまだ未対応です。", m]}];
}

- (void)openExternal:(NSString *)url {
    if (![url isKindOfClass:[NSString class]]) return;
    NSString *lower = [url.lowercaseString stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceCharacterSet]];
    // http(s) 以外(itms:/file:/javascript: 等)は開かない: 任意スキーム起動を防ぐ(Android 版と同じ方針)
    if (![lower hasPrefix:@"https://"] && ![lower hasPrefix:@"http://"]) return;
    NSURL *u = [NSURL URLWithString:url];
    if (!u) return;
    dispatch_async(dispatch_get_main_queue(), ^{ [[UIApplication sharedApplication] openURL:u options:@{} completionHandler:nil]; });
}

- (void)saveFile:(NSArray *)a callId:(NSString *)callId {
    NSString *name = a.count > 0 && [a[0] isKindOfClass:[NSString class]] ? a[0] : @"file.bin";
    NSString *b64 = a.count > 1 && [a[1] isKindOfClass:[NSString class]] ? a[1] : @"";
    name = [[name componentsSeparatedByCharactersInSet:[NSCharacterSet characterSetWithCharactersInString:@"/\\:"]] componentsJoinedByString:@"_"];
    NSData *d = [[NSData alloc] initWithBase64EncodedString:b64 options:NSDataBase64DecodingIgnoreUnknownCharacters];
    if (!d) { [self resolve:callId result:@{@"ok": @NO, @"error": @"bad_data"}]; return; }
    NSString *docs = [NSSearchPathForDirectoriesInDomains(NSDocumentDirectory, NSUserDomainMask, YES) firstObject];
    NSString *path = [docs stringByAppendingPathComponent:name];
    BOOL ok = [d writeToFile:path atomically:YES];
    [self resolve:callId result:@{@"ok": @(ok), @"path": path}];
}

// ===== HTTP 中継: a[0] = {method,url,headers:{},body:string,bodyBase64:bool} =====
- (void)doHttp:(NSDictionary *)p callId:(NSString *)callId {
    if (![p isKindOfClass:[NSDictionary class]]) { [self resolve:callId result:@{@"status": @0, @"error": @"bad_request"}]; return; }
    NSString *urlStr = p[@"url"];
    NSURL *url = [urlStr isKindOfClass:[NSString class]] ? [NSURL URLWithString:urlStr] : nil;
    // 平文 http は拒否(全 API が https)。ユーザー名やパスワードを URL に埋め込んだ形も拒否
    if (!url || ![url.scheme isEqualToString:@"https"] || url.host.length == 0 || url.user || url.password) {
        [self resolve:callId result:@{@"status": @0, @"error": @"bad_url"}]; return;
    }
    BOOL koe = isKoeHost(url.host);
    // 認証トークンは meetscom のホスト以外へは絶対に送らない(URL クエリ・ヘッダ双方)
    if (!koe && [urlStr rangeOfString:@"auth_token=" options:NSCaseInsensitiveSearch].location != NSNotFound) {
        ktLog([NSString stringWithFormat:@"%@  [SEC] 外部ホストへの auth_token 送信を拒否: %@", ktNow(), url.host]);
        [self resolve:callId result:@{@"status": @0, @"error": @"token_leak_blocked"}]; return;
    }
    NSMutableURLRequest *req = [NSMutableURLRequest requestWithURL:url];
    NSString *method = [p[@"method"] isKindOfClass:[NSString class]] ? [p[@"method"] uppercaseString] : @"GET";
    if (![@[@"GET", @"POST", @"PUT", @"DELETE", @"PATCH", @"HEAD"] containsObject:method]) method = @"GET";
    req.HTTPMethod = method;
    NSDictionary *headers = [p[@"headers"] isKindOfClass:[NSDictionary class]] ? p[@"headers"] : @{};
    for (id k0 in headers) {
        if (![k0 isKindOfClass:[NSString class]]) continue;
        NSString *k = k0; id v = headers[k];
        if (![v isKindOfClass:[NSString class]]) continue;
        NSString *lk = k.lowercaseString;
        if ([lk isEqualToString:@"cookie"] || [lk isEqualToString:@"host"] || ([lk isEqualToString:@"authorization"] && !hostMatches(url.host, @"amazonaws.com"))) continue;
        if ([lk isEqualToString:@"x-auth-token"] && !koe) continue;
        [req setValue:v forHTTPHeaderField:k];
    }
    id body = p[@"body"];
    if ([body isKindOfClass:[NSString class]] && [(NSString *)body length] > 0) {
        if ([p[@"bodyBase64"] boolValue]) req.HTTPBody = [[NSData alloc] initWithBase64EncodedString:body options:NSDataBase64DecodingIgnoreUnknownCharacters];
        else req.HTTPBody = [body dataUsingEncoding:NSUTF8StringEncoding];
    }
    NSNumber *timeout = p[@"timeout"];
    if ([timeout isKindOfClass:[NSNumber class]] && timeout.doubleValue > 0) req.timeoutInterval = timeout.doubleValue / 1000.0;

    NSString *safeUrl = maskQuery(urlStr);
    NSURLSessionDataTask *task = [self.session dataTaskWithRequest:req completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
        NSHTTPURLResponse *h = [response isKindOfClass:[NSHTTPURLResponse class]] ? (NSHTTPURLResponse *)response : nil;
        NSMutableDictionary *out = [NSMutableDictionary new];
        out[@"status"] = @(h ? h.statusCode : 0);
        NSMutableDictionary *hd = [NSMutableDictionary new];
        for (id k in h.allHeaderFields) { hd[[[k description] lowercaseString]] = [h.allHeaderFields[k] description]; }
        out[@"headers"] = hd;
        if (error) out[@"error"] = error.localizedDescription ?: @"error";
        if (data) {
            NSString *text = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
            if (text) { out[@"body"] = text; }
            else { out[@"bodyBase64"] = [data base64EncodedStringWithOptions:0]; }
        }
        ktLog([NSString stringWithFormat:@"%@  %@ %@  → %ld%@", ktNow(), req.HTTPMethod, safeUrl, (long)(h ? h.statusCode : 0), error ? [NSString stringWithFormat:@"  ✗ %@", error.localizedDescription] : @""]);
        [self resolve:callId result:out];
    }];
    [task resume];
}

// ---- Cognito: GetId → GetCredentialsForIdentity (a[0] = {region, pool_id}) ----
- (void)awsJson:(NSString *)url target:(NSString *)target body:(NSDictionary *)body done:(void (^)(NSDictionary *json, NSInteger status, NSString *err))done {
    NSMutableURLRequest *req = [NSMutableURLRequest requestWithURL:[NSURL URLWithString:url]];
    req.HTTPMethod = @"POST"; req.timeoutInterval = 30;
    [req setValue:@"application/x-amz-json-1.1" forHTTPHeaderField:@"Content-Type"];
    [req setValue:target forHTTPHeaderField:@"X-Amz-Target"];
    req.HTTPBody = [NSJSONSerialization dataWithJSONObject:body options:0 error:nil];
    [[self.session dataTaskWithRequest:req completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
        NSInteger st = [response isKindOfClass:[NSHTTPURLResponse class]] ? ((NSHTTPURLResponse *)response).statusCode : 0;
        NSDictionary *j = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
        done([j isKindOfClass:[NSDictionary class]] ? j : nil, st, error.localizedDescription);
    }] resume];
}
- (void)cognitoCreds:(NSDictionary *)cfg callId:(NSString *)callId {
    if (![cfg isKindOfClass:[NSDictionary class]]) { [self resolve:callId result:@{@"ok": @NO, @"error": @"bad_cfg"}]; return; }
    NSString *region = cfg[@"region"], *pool = cfg[@"pool_id"];
    if (!safeToken(region) || ![pool isKindOfClass:[NSString class]] || pool.length > 128) { [self resolve:callId result:@{@"ok": @NO, @"error": @"bad_cfg"}]; return; }
    NSString *url = [NSString stringWithFormat:@"https://cognito-identity.%@.amazonaws.com/", region];
    [self awsJson:url target:@"AWSCognitoIdentityService.GetId" body:@{@"IdentityPoolId": pool} done:^(NSDictionary *j1, NSInteger st1, NSString *e1) {
        NSString *idn = j1[@"IdentityId"];
        if (![idn isKindOfClass:[NSString class]]) { [self resolve:callId result:@{@"ok": @NO, @"error": [NSString stringWithFormat:@"Cognito GetId HTTP %ld %@", (long)st1, e1 ?: @""]}]; return; }
        [self awsJson:url target:@"AWSCognitoIdentityService.GetCredentialsForIdentity" body:@{@"IdentityId": idn} done:^(NSDictionary *j2, NSInteger st2, NSString *e2) {
            NSDictionary *c = j2[@"Credentials"];
            if (![c isKindOfClass:[NSDictionary class]]) { [self resolve:callId result:@{@"ok": @NO, @"error": [NSString stringWithFormat:@"Cognito creds HTTP %ld %@", (long)st2, e2 ?: @""]}]; return; }
            [self resolve:callId result:@{@"ok": @YES, @"AccessKeyId": c[@"AccessKeyId"] ?: @"", @"SecretKey": c[@"SecretKey"] ?: @"", @"SessionToken": c[@"SessionToken"] ?: @""}];
        }];
    }];
}
// ---- S3 PUT (a[0] = {region,bucket,key,contentType,dataBase64,AccessKeyId,SecretKey,SessionToken}) ----
- (void)s3Put:(NSDictionary *)p callId:(NSString *)callId {
    if (![p isKindOfClass:[NSDictionary class]] || ![p[@"dataBase64"] isKindOfClass:[NSString class]]) { [self resolve:callId result:@{@"ok": @NO, @"error": @"bad_params"}]; return; }
    NSData *data = [[NSData alloc] initWithBase64EncodedString:p[@"dataBase64"] options:NSDataBase64DecodingIgnoreUnknownCharacters];
    NSString *region = p[@"region"], *bucket = p[@"bucket"], *key = p[@"key"], *ct = [p[@"contentType"] isKindOfClass:[NSString class]] ? p[@"contentType"] : @"application/octet-stream";
    NSString *ak = p[@"AccessKeyId"], *sk = p[@"SecretKey"], *st = p[@"SessionToken"];
    if (!data || data.length > 30 * 1024 * 1024 || !safeToken(region) || !safeToken(bucket) || ![key isKindOfClass:[NSString class]] || [key containsString:@".."] || ![ak isKindOfClass:[NSString class]] || ![sk isKindOfClass:[NSString class]] || ![st isKindOfClass:[NSString class]]) { [self resolve:callId result:@{@"ok": @NO, @"error": @"bad_params"}]; return; }
    NSString *host = [NSString stringWithFormat:@"s3.%@.amazonaws.com", region];
    NSString *amzDate, *day; awsDates(&amzDate, &day);
    NSString *payloadHash = sha256Hex(data);
    NSString *canonUri = [NSString stringWithFormat:@"/%@/%@", bucket, key];
    NSString *signedHeaders = @"content-type;host;x-amz-content-sha256;x-amz-date;x-amz-security-token";
    NSString *canonHeaders = [NSString stringWithFormat:@"content-type:%@\nhost:%@\nx-amz-content-sha256:%@\nx-amz-date:%@\nx-amz-security-token:%@\n", ct, host, payloadHash, amzDate, st];
    NSString *canonical = [NSString stringWithFormat:@"PUT\n%@\n\n%@\n%@\n%@", canonUri, canonHeaders, signedHeaders, payloadHash];
    NSString *scope = [NSString stringWithFormat:@"%@/%@/s3/aws4_request", day, region];
    NSString *sts = [NSString stringWithFormat:@"AWS4-HMAC-SHA256\n%@\n%@\n%@", amzDate, scope, sha256Hex([canonical dataUsingEncoding:NSUTF8StringEncoding])];
    NSString *auth = [NSString stringWithFormat:@"AWS4-HMAC-SHA256 Credential=%@/%@, SignedHeaders=%@, Signature=%@", ak, scope, signedHeaders, sigV4(sk, day, region, @"s3", sts)];
    NSMutableURLRequest *req = [NSMutableURLRequest requestWithURL:[NSURL URLWithString:[NSString stringWithFormat:@"https://%@%@", host, canonUri]]];
    req.HTTPMethod = @"PUT"; req.timeoutInterval = 60; req.HTTPBody = data;
    [req setValue:ct forHTTPHeaderField:@"Content-Type"]; [req setValue:payloadHash forHTTPHeaderField:@"x-amz-content-sha256"];
    [req setValue:amzDate forHTTPHeaderField:@"x-amz-date"]; [req setValue:st forHTTPHeaderField:@"x-amz-security-token"]; [req setValue:auth forHTTPHeaderField:@"Authorization"];
    [[self.session dataTaskWithRequest:req completionHandler:^(NSData *rd, NSURLResponse *response, NSError *error) {
        NSInteger code = [response isKindOfClass:[NSHTTPURLResponse class]] ? ((NSHTTPURLResponse *)response).statusCode : 0;
        BOOL ok = code >= 200 && code < 300;
        NSString *bodyTxt = rd ? ([[NSString alloc] initWithData:rd encoding:NSUTF8StringEncoding] ?: @"") : @"";
        ktLog([NSString stringWithFormat:@"%@  [S3] PUT %@ (%lu B) → %ld", ktNow(), key, (unsigned long)data.length, (long)code]);
        [self resolve:callId result:@{@"ok": @(ok), @"status": @(code), @"md5": md5Hex(data), @"error": ok ? @"" : [NSString stringWithFormat:@"S3 PUT失敗 HTTP %ld: %@", (long)code, [bodyTxt substringToIndex:MIN(200, bodyTxt.length)]]}];
    }] resume];
}
// ---- S3 presigned GET URL (a[0] = {region,bucket,key,expire,AccessKeyId,SecretKey,SessionToken}) ----
- (NSDictionary *)s3Presign:(NSDictionary *)p {
    if (![p isKindOfClass:[NSDictionary class]]) return @{@"ok": @NO, @"error": @"bad_params"};
    NSString *region = p[@"region"], *bucket = p[@"bucket"], *key = p[@"key"], *ak = p[@"AccessKeyId"], *sk = p[@"SecretKey"], *st = p[@"SessionToken"];
    if (!safeToken(region) || !safeToken(bucket) || ![key isKindOfClass:[NSString class]] || ![ak isKindOfClass:[NSString class]] || ![sk isKindOfClass:[NSString class]] || ![st isKindOfClass:[NSString class]]) return @{@"ok": @NO, @"error": @"bad_params"};
    NSInteger expire = [p[@"expire"] integerValue]; if (expire <= 0) expire = 300;
    NSString *host = [NSString stringWithFormat:@"s3.%@.amazonaws.com", region];
    NSString *amzDate, *day; awsDates(&amzDate, &day);
    NSString *scope = [NSString stringWithFormat:@"%@/%@/s3/aws4_request", day, region];
    NSString *canonKey = [NSString stringWithFormat:@"/%@/%@", bucket, key];
    NSString *q = [NSString stringWithFormat:@"X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=%@&X-Amz-Date=%@&X-Amz-Expires=%ld&X-Amz-Security-Token=%@&X-Amz-SignedHeaders=host", awsUrlEnc([NSString stringWithFormat:@"%@/%@", ak, scope]), amzDate, (long)expire, awsUrlEnc(st)];
    NSString *canonical = [NSString stringWithFormat:@"GET\n%@\n%@\nhost:%@\n\nhost\nUNSIGNED-PAYLOAD", canonKey, q, host];
    NSString *sts = [NSString stringWithFormat:@"AWS4-HMAC-SHA256\n%@\n%@\n%@", amzDate, scope, sha256Hex([canonical dataUsingEncoding:NSUTF8StringEncoding])];
    NSString *url = [NSString stringWithFormat:@"https://%@%@?%@&X-Amz-Signature=%@", host, canonKey, q, sigV4(sk, day, region, @"s3", sts)];
    return @{@"ok": @YES, @"url": url};
}

// ===== 同期ブリッジ: prompt("__koesync__{...}") を横取りして即答する =====
- (void)webView:(WKWebView *)webView runJavaScriptTextInputPanelWithPrompt:(NSString *)prompt defaultText:(NSString *)defaultText initiatedByFrame:(WKFrameInfo *)frame completionHandler:(void (^)(NSString *))completionHandler {
    if (![prompt hasPrefix:@"__koesync__"] || !trustedFrame(frame)) { completionHandler(nil); return; }
    NSData *d = [[prompt substringFromIndex:11] dataUsingEncoding:NSUTF8StringEncoding];
    id parsed = d ? [NSJSONSerialization JSONObjectWithData:d options:0 error:nil] : nil;
    NSDictionary *req = [parsed isKindOfClass:[NSDictionary class]] ? parsed : @{};
    NSString *m = [req[@"m"] isKindOfClass:[NSString class]] ? req[@"m"] : @"";
    NSArray *a = [req[@"a"] isKindOfClass:[NSArray class]] ? req[@"a"] : @[];
    id result = @"";
    if ([m isEqualToString:@"appVersion"]) {
        NSDictionary *info = [NSBundle mainBundle].infoDictionary;
        result = jsonString(@{@"ok": @YES, @"name": info[@"CFBundleShortVersionString"] ?: @"", @"code": @([info[@"CFBundleVersion"] intValue]), @"platform": @"ios"});
    } else if ([m isEqualToString:@"nativeLog"]) {
        NSArray *copy; @synchronized (gLog) { copy = [gLog copy] ?: @[]; }
        result = jsonString(@{@"ok": @YES, @"count": @(copy.count), @"log": copy});
    } else if ([m isEqualToString:@"secureLoad"]) {
        result = strArg(a, 0) ? (kcGet(strArg(a, 0)) ?: @"") : @"";
    } else if ([m isEqualToString:@"secureSave"]) {
        if (strArg(a, 0)) kcSet(strArg(a, 0), strArg(a, 1) ?: @""); result = @"1";
    } else if ([m isEqualToString:@"hasMicPermission"]) {
        result = [AVAudioSession sharedInstance].recordPermission == AVAudioSessionRecordPermissionGranted ? @"1" : @"0";
    } else if ([m isEqualToString:@"hasCameraPermission"]) {
        result = [AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeVideo] == AVAuthorizationStatusAuthorized ? @"1" : @"0";
    } else if ([m isEqualToString:@"requestPermissions"]) {
        [[AVAudioSession sharedInstance] requestRecordPermission:^(BOOL granted) {}];
        result = @"1";
    } else if ([m isEqualToString:@"hasNotifPermission"] || [m isEqualToString:@"hasOverlayPermission"] || [m isEqualToString:@"biometricAvailable"]) {
        result = @"0";
    } else if ([m isEqualToString:@"setInCall"]) {
        self.inCall = [a.firstObject respondsToSelector:@selector(boolValue)] && [a.firstObject boolValue];
        [[AVAudioSession sharedInstance] setActive:self.inCall error:nil];
        [UIApplication sharedApplication].idleTimerDisabled = self.inCall;
        result = @"1";
    } else if ([m isEqualToString:@"vibrate"]) {
        AudioServicesPlaySystemSound(kSystemSoundID_Vibrate); result = @"1";
    } else if ([m isEqualToString:@"log"]) {
        ktLog([NSString stringWithFormat:@"%@  [JS] %@", ktNow(), a.firstObject ?: @""]); result = @"1";
    } else if ([m isEqualToString:@"openUrl"]) {
        [self openExternal:strArg(a, 0)]; result = @"1";
    } else if ([m isEqualToString:@"appStorageInfo"]) {
        result = jsonString(@{@"ok": @YES, @"cache_bytes": @0, @"data_bytes": @0});
    } else {
        // uiReady / setPipEnabled / enterPip / overlay 系 / trimAppCache 等: iOS では相当機能が無いので何もしない
        result = @"";
    }
    completionHandler([result isKindOfClass:[NSString class]] ? result : jsonString(result));
}

// マイク/カメラ許可(iOS 15+): 同梱ページからの要求だけ許可する
- (void)webView:(WKWebView *)webView requestMediaCapturePermissionForOrigin:(WKSecurityOrigin *)origin initiatedByFrame:(WKFrameInfo *)frame type:(WKMediaCaptureType)type decisionHandler:(void (^)(WKPermissionDecision))decisionHandler API_AVAILABLE(ios(15.0)) {
    BOOL local = [origin.protocol isEqualToString:@"koetomo"] && frame.isMainFrame;
    decisionHandler(local ? WKPermissionDecisionGrant : WKPermissionDecisionDeny);
}

// target=_blank / window.open は外部ブラウザへ(WebView 内で外部サイトを開かない)
- (WKWebView *)webView:(WKWebView *)webView createWebViewWithConfiguration:(WKWebViewConfiguration *)configuration forNavigationAction:(WKNavigationAction *)navigationAction windowFeatures:(WKWindowFeatures *)windowFeatures {
    [self openExternal:navigationAction.request.URL.absoluteString];
    return nil;
}

// http(s) への画面遷移は外部ブラウザへ。同梱ファイル以外は読み込まない(Android 版 handleNav と同じ)
- (void)webView:(WKWebView *)webView decidePolicyForNavigationAction:(WKNavigationAction *)navigationAction decisionHandler:(void (^)(WKNavigationActionPolicy))decisionHandler {
    NSURL *u = navigationAction.request.URL;
    if ([u.scheme isEqualToString:@"koetomo"] || [u.scheme isEqualToString:@"file"] || [u.scheme isEqualToString:@"about"] || [u.scheme isEqualToString:@"blob"] || [u.scheme isEqualToString:@"data"]) { decisionHandler(WKNavigationActionPolicyAllow); return; }
    if ([u.scheme isEqualToString:@"http"] || [u.scheme isEqualToString:@"https"]) { [self openExternal:u.absoluteString]; }
    decisionHandler(WKNavigationActionPolicyCancel);
}

- (void)webView:(WKWebView *)webView didFinishNavigation:(WKNavigation *)navigation {
    ktLog([NSString stringWithFormat:@"%@  [BOOT] ページ読み込み完了", ktNow()]);
}

- (void)webViewWebContentProcessDidTerminate:(WKWebView *)webView {
    ktLog([NSString stringWithFormat:@"%@  [BOOT] WebView プロセス終了 → 再読み込み", ktNow()]);
    [webView reload];
}

@end
