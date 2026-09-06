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
    nativeLog: function(){ return sync("nativeLog"); },
    secureLoad: function(k){ return sync("secureLoad", [k]); },
    secureSave: function(k, v){ sync("secureSave", [k, v]); },
    log: function(s){ sync("log", [String(s)]); },
    openUrl: function(u){ sync("openUrl", [String(u)]); },
    shareText: function(t){ nativeCall("__share_text", [String(t)]); },
    vibrate: function(){ sync("vibrate"); },
    hasMicPermission: function(){ return sync("hasMicPermission") === "1"; },
    hasCameraPermission: function(){ return sync("hasCameraPermission") === "1"; },
    hasNotifPermission: function(){ return false; },
    hasOverlayPermission: function(){ return false; },
    requestNotificationPermission: function(){},
    requestOverlayPermission: function(){},
    requestPermissions: function(){ sync("requestPermissions"); },
    biometricAvailable: function(){ return false; },
    authBiometric: function(){},
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
  window.AndroidApi = api;
  window.KoeApp = { setBackgroundNotify: function(){}, showNotification: function(){}, requestNotificationPermission: function(){} };
  window.__isIOS = true;
})();
