/* iOS 版ブリッジ: Android の window.AndroidApi と同じ顔をして、
   - 非同期 call(method, argsJson, id) は JS 版セッション(ios-session.js)か、"__" 付きならネイティブへ
   - 同期メソッド(appVersion / nativeLog / secureLoad ...)は prompt() をネイティブが横取りして即答
   ページ本体(android-bridge.js / app.js)は無改造で動く。 */
(function(){
  if (window.AndroidApi) return;
  var pending = {};
  var seq = 0;
  function sync(m, args){
    try {
      var r = window.prompt("__koesync__" + JSON.stringify({ m: m, a: args || [] }));
      return r == null ? "" : r;
    } catch (e) { return ""; }
  }
  function nativeCall(m, args){
    return new Promise(function(resolve){
      var id = "n" + (++seq);
      pending[id] = resolve;
      try { window.webkit.messageHandlers.koe.postMessage({ id: id, m: m, a: args || [] }); }
      catch (e) { delete pending[id]; resolve({ ok: false, error: "bridge_error: " + (e && e.message) }); }
    });
  }
  // ネイティブからの返答。ページ側(android-bridge.js)が同名関数を後で定義するので、こちらの分は別名で受けてチェーンする
  var pageResolve = null;
  Object.defineProperty(window, "__koeResolve", {
    configurable: true,
    get: function(){ return function(id, json){
      if (pending[id]) { var f = pending[id]; delete pending[id]; try { f(JSON.parse(json)); } catch (e) { f({ ok: false, error: "parse_error", raw: json }); } return; }
      if (pageResolve) pageResolve(id, json);
    }; },
    set: function(fn){ pageResolve = fn; }
  });
  window.__koeNative = nativeCall;

  var api = {
    call: function(method, argsJson, id){
      var args = [];
      try { args = argsJson ? JSON.parse(argsJson) : []; } catch (e) { args = []; }
      var p;
      if (method && method.indexOf("__") === 0) p = nativeCall(method, args);
      else if (method === "get_native_log") p = nativeCall("__native_log", []);
      else if (method === "clear_native_log") p = nativeCall("__clear_log", []);
      else if (window.__koeIos && window.__koeIos.dispatch) p = window.__koeIos.dispatch(method, args);
      else p = Promise.resolve({ ok: false, error: "session_not_ready" });
      Promise.resolve(p).then(function(r){
        if (r === undefined || r === null) r = { ok: false, error: "empty" };
        try { window.__koeResolve(id, typeof r === "string" ? r : JSON.stringify(r)); } catch (e) {}
      }, function(e){
        try { window.__koeResolve(id, JSON.stringify({ ok: false, error: String(e && e.message || e) })); } catch (_) {}
      });
    },
    appVersion: function(){ return sync("appVersion"); },
    checkUpdate: function(){ iosUpdater.check(); },
    isXLoginConfigured: function(){ return sync("xConfigured") === "1"; },
    startXLogin: function(){ xLogin.start(); },
    downloadUpdate: function(){ iosUpdater.install(); },
    nativeLog: function(){ return sync("nativeLog"); },
    secureLoad: function(k){ return sync("secureLoad", [k]); },
    secureSave: function(k, v){ sync("secureSave", [k, v]); },
    log: function(s){ sync("log", [String(s)]); },
    openUrl: function(u){ sync("openUrl", [String(u)]); },
    shareText: function(t){ nativeCall("__share_text", [String(t)]); },
    vibrate: function(){ sync("vibrate"); },
    hasMicPermission: function(){ return sync("hasMicPermission") === "1"; },
    hasCameraPermission: function(){ return sync("hasCameraPermission") === "1"; },
    hasNotifPermission: function(){ return sync("hasNotifPermission") === "1"; },
    hasOverlayPermission: function(){ return false; },
    requestNotificationPermission: function(){ sync("requestNotifPermission"); },
    requestOverlayPermission: function(){},
    requestPermissions: function(){ sync("requestPermissions"); },
    biometricAvailable: function(){ return sync("biometricAvailable") === "1"; },
    authBiometric: function(){ nativeCall("__auth_biometric", []).then(function(r){ try { if (typeof window.__onBiometricResult === "function") window.__onBiometricResult(!!(r && r.ok), (r && r.reason) || ""); } catch (e) {} }); },
    uiReady: function(){},
    setInCall: function(b){ sync("setInCall", [!!b]); },
    setPipEnabled: function(){}, enterPip: function(){},
    showOverlay: function(){}, hideOverlay: function(){}, updateOverlay: function(){},
    startCallAudio: function(){}, stopCallAudio: function(){},
    setSaveFolder: function(){}, openAppSettings: function(){},
    trimAppCache: function(){}, clearAppCache: function(){},
    appStorageInfo: function(){ return sync("appStorageInfo"); },
    saveImage: function(name, b64){ nativeCall("__save_file", [String(name), String(b64)]); },
    saveAudio: function(name, b64){ nativeCall("__save_file", [String(name), String(b64)]); },
    saveAudioData: function(name, b64){ nativeCall("__save_file", [String(name), String(b64)]); }
  };
  /* ---- X(Twitter) OAuth2 + PKCE ログイン(Android 版 KoeApiBridge と同じ手順) ----
     1) code_verifier を作り認可 URL を Safari で開く → 2) koetomoplus://xauth?code=… が戻る(AppDelegate → window.__koeIncomingUrl)
     3) トークン交換(公開クライアント・PKCE) → /2/users/me → twitter_login(声とも側は AES-GCM 暗号化トークン) → window.__koeOnXLogin(json) */
  var xLogin = (function(){
    var REDIRECT = "koetomoplus://xauth", SCOPE = "users.read tweet.read", verifier = null, xstate = null;
    function post(o){ try { if (typeof window.__koeOnXLogin === "function") window.__koeOnXLogin(JSON.stringify(o)); } catch (e) {} }
    function rand(n){ var a = new Uint8Array(n); (window.crypto || window.msCrypto).getRandomValues(a); var s = ""; for (var i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
    function enc(s){ return encodeURIComponent(s); }
    async function start(){
      var cid = sync("xClientId"); if (!cid) { post({ ok: false, message: "このビルドではXログインが未設定です" }); return; }
      verifier = rand(64).slice(0, 128); xstate = rand(16);
      var ch = await nativeCall("__sha256_b64url", [verifier]); if (!ch || !ch.ok) { post({ ok: false, message: "PKCE の生成に失敗しました" }); return; }
      var url = "https://x.com/i/oauth2/authorize?response_type=code&client_id=" + enc(cid) + "&redirect_uri=" + enc(REDIRECT) + "&scope=" + enc(SCOPE) + "&state=" + enc(xstate) + "&code_challenge=" + enc(ch.value) + "&code_challenge_method=S256";
      sync("openUrl", [url]);
    }
    async function finish(code, st){
      try {
        if (!code) { post({ ok: false, message: "Xの認証がキャンセルされました" }); return; }
        if (!verifier) { post({ ok: false, message: "認証の途中状態が失われました。もう一度お試しください" }); return; }
        if (xstate && st !== xstate) { post({ ok: false, message: "認証の検証に失敗しました(state不一致)" }); return; }
        var cid = sync("xClientId");
        var form = "code=" + enc(code) + "&grant_type=authorization_code&client_id=" + enc(cid) + "&redirect_uri=" + enc(REDIRECT) + "&code_verifier=" + enc(verifier);
        var r = await nativeCall("__http", [{ method: "POST", url: "https://api.x.com/2/oauth2/token", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form, timeout: 20000 }]);
        if (!r || r.status < 200 || r.status >= 300) { post({ ok: false, message: "Xのトークン取得に失敗しました(HTTP " + ((r && r.status) || 0) + ")" }); return; }
        var tok = ""; try { tok = JSON.parse(r.body).access_token || ""; } catch (e) {}
        if (!tok) { post({ ok: false, message: "Xのアクセストークンが取得できませんでした" }); return; }
        var r2 = await nativeCall("__http", [{ method: "GET", url: "https://api.x.com/2/users/me", headers: { "Authorization": "Bearer " + tok }, timeout: 20000 }]);
        if (!r2 || r2.status < 200 || r2.status >= 300) { post({ ok: false, message: "Xのユーザー情報を取得できませんでした(HTTP " + ((r2 && r2.status) || 0) + ")" }); return; }
        var xid = ""; try { xid = (JSON.parse(r2.body).data || {}).id || ""; } catch (e) {}
        if (!xid) { post({ ok: false, message: "XのユーザーIDが取得できませんでした" }); return; }
        var res = await window.__koeIos.dispatch("twitter_login", [xid, tok]); post(res || { ok: false, message: "ログイン処理に失敗しました" });
      } catch (e) { post({ ok: false, message: "Xログイン処理でエラー: " + (e && e.message) }); }
      finally { verifier = null; xstate = null; }
    }
    function incoming(u){
      try { var m = /^koetomoplus:\/\/xauth\??(.*)$/i.exec(String(u || "")); if (!m) return false; var q = {}; m[1].split("&").forEach(function(kv){ var i = kv.indexOf("="); if (i > 0) q[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1).replace(/\+/g, " ")); }); finish(q.code || "", q.state || ""); return true; } catch (e) { return false; }
    }
    return { start: start, incoming: incoming };
  })();
  window.__koeIncomingUrl = function(u){ if (xLogin.incoming(u)) return; try { if (typeof window.__koeHandleDeepLink === "function") window.__koeHandleDeepLink(u); } catch (e) {} };

  /* ---- iOS 版アップデーター ----
     Android 版(app.js)は GitHub Releases(APK)を見て強制更新するが、iOS は配布経路が3つ(Sileo / TrollStore / SideStore)
     あるので、リポジトリの source.json を更新情報として使い、経路ごとに適切な更新先を開く。
     方針は Android と同じ: 新しい版があれば閉じられない画面で更新を求める(説明文に OPTIONAL_UPDATE があれば任意)。
     72時間以上確認できない状態が続いた場合も使用を止める(fail-closed)。 */
  var iosUpdater = (function(){
    var FEED = "https://raw.githubusercontent.com/haizarakun/koetomo-ios/main/source.json";
    var README = "https://github.com/haizarakun/koetomo-ios#入れ方";
    var GRACE_MS = 72 * 3600 * 1000;
    var latest = null, manual = false;
    function nums(v){ return String(v || "").replace(/^[vV]/, "").replace(/[-+].*$/, "").split(/[^0-9]+/).filter(function(x){ return x !== ""; }).map(Number); }
    function isNewer(a, b){ var x = nums(a), y = nums(b), n = Math.max(x.length, y.length); for (var i = 0; i < n; i++) { var p = x[i] || 0, q = y[i] || 0; if (p > q) return true; if (p < q) return false; } return false; }
    function cur(){ try { var r = JSON.parse(sync("appVersion")); return (r && r.ok && r.name) || ""; } catch (e) { return ""; } }
    function esc(x){ return String(x == null ? "" : x).replace(/[&<>"']/g, function(c){ return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]; }); }
    function toast(m, t){ try { if (typeof window.toast === "function") window.toast(m, t); } catch (e) {} }
    function line(txt){ try { var el = document.getElementById("koeVersionLine"); if (el) el.textContent = "現在のバージョン: " + (cur() || "不明") + (txt ? " ・ " + txt : ""); } catch (e) {} }
    function markVerified(){ try { localStorage.setItem("koe_upd_lastok", String(Date.now())); } catch (e) {} }
    function checkGrace(){
      try {
        var now = Date.now(), last = parseInt(localStorage.getItem("koe_upd_lastok") || "0", 10) || 0, first = parseInt(localStorage.getItem("koe_upd_first") || "0", 10) || 0;
        if (!first) { first = now; localStorage.setItem("koe_upd_first", String(now)); }
        if (now - (last || first) > GRACE_MS) overlay("📡", "更新の確認が必要です", "しばらく最新版かどうかを確認できていません。<br>インターネットに接続してから「再確認」を押してください。", "再確認", function(){ removeOverlay(); check(true); });
      } catch (e) {}
    }
    function removeOverlay(){ try { var o = document.getElementById("koeForceUpdate"); if (o) o.remove(); } catch (e) {} }
    function overlay(icon, title, html, btn, onBtn, laterBtn){
      if (document.getElementById("koeForceUpdate")) return;
      var m = document.createElement("div"); m.id = "koeForceUpdate";
      m.style.cssText = "position:fixed;inset:0;z-index:99998;background:var(--bg-content,#14161c);display:flex;align-items:center;justify-content:center;padding:24px;";
      m.innerHTML = '<div style="max-width:420px;width:100%;text-align:center;"><div style="font-size:44px;margin-bottom:10px;">' + icon + '</div>'
        + '<div style="font-size:20px;font-weight:800;color:var(--text-header,#fff);margin-bottom:8px;">' + title + '</div>'
        + '<p class="page-desc" style="white-space:normal;">' + html + '</p>'
        + '<button type="button" class="btn-primary koe-force-go" style="margin-top:16px;">' + btn + '</button>'
        + '<button type="button" class="btn-secondary koe-force-web" style="margin-top:8px;">入れ方を見る（GitHub）</button>'
        + (laterBtn ? '<button type="button" class="btn-secondary koe-force-later" style="margin-top:8px;">あとで</button>' : '') + '</div>';
      document.body.appendChild(m);
      m.querySelector(".koe-force-go").addEventListener("click", onBtn);
      m.querySelector(".koe-force-web").addEventListener("click", function(){ sync("openUrl", [README]); });
      if (laterBtn) m.querySelector(".koe-force-later").addEventListener("click", removeOverlay);
    }
    function install(){
      if (!latest) { sync("openUrl", [README]); return; }
      nativeCall("__open_update", [latest.ipa || "", README]).then(function(r){ if (!r || !r.ok) sync("openUrl", [README]); });
    }
    function onInfo(r){
      var wasManual = manual; manual = false;
      var me = cur();
      if (!r || !r.ok) { if (wasManual) toast("更新の確認に失敗しました", "error"); line(); if (r && r.status >= 400 && r.status < 500) markVerified(); else checkGrace(); return; }
      if (!me) { markVerified(); line(); return; }
      if (!isNewer(r.tag, me)) { markVerified(); line("最新です"); if (wasManual) toast("最新版を使っています (" + me + ")"); return; }
      latest = r; line("新しい " + r.tag + " があります");
      var optional = /OPTIONAL_UPDATE/i.test(String(r.notes || ""));
      if (optional) markVerified();
      try { if (!optional && typeof window.leaveInWindowCall === "function") window.leaveInWindowCall(); } catch (e) {}
      try { if (!optional && typeof window.stopApplicantPolling === "function") window.stopApplicantPolling(); } catch (e) {}
      removeOverlay();
      overlay(optional ? "⬆️" : "🔒", optional ? "新しいバージョンがあります" : "更新が必要です",
        (optional ? "" : "このバージョン（<b>" + esc(me) + "</b>）は使用できなくなりました。<br>") + "続けるには <b>" + esc(r.tag) + "</b> に更新してください。" + (r.notes ? '<div class="card-sub" style="white-space:pre-wrap;text-align:left;max-height:150px;overflow-y:auto;margin-top:8px;">' + esc(String(r.notes).slice(0, 500)) + "</div>" : ""),
        "今すぐ更新", install, optional);
    }
    function check(isManual){
      manual = !!isManual; line(isManual ? "確認中…" : "");
      nativeCall("__http", [{ method: "GET", url: FEED + "?t=" + Date.now(), headers: { "Accept": "application/json", "Cache-Control": "no-cache" }, timeout: 15000 }]).then(function(r){
        try {
          if (!r || r.status !== 200 || !r.body) { onInfo({ ok: false, status: (r && r.status) || 0 }); return; }
          var j = JSON.parse(r.body); var app = (j.apps || [])[0] || {}; var best = null;
          (app.versions || []).forEach(function(v){ if (!best || isNewer(v.version, best.version)) best = v; });
          if (!best) { onInfo({ ok: false, status: 404 }); return; }
          onInfo({ ok: true, tag: "v" + best.version, ipa: best.downloadURL || "", notes: best.localizedDescription || "" });
        } catch (e) { onInfo({ ok: false, status: 0 }); }
      });
    }
    return { check: check, install: install };
  })();
  window.AndroidApi = api;
  window.KoeApp = {
    setBackgroundNotify: function(on){ sync("setBackgroundNotify", [!!on]); },
    showNotification: function(title, body){ nativeCall("__notify", [String(title == null ? "KoeTomo+" : title), String(body == null ? "" : body)]); },
    requestNotificationPermission: function(){ sync("requestNotifPermission"); }
  };
  window.__isIOS = true;
})();
