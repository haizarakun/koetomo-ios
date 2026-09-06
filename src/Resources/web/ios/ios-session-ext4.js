/* iOS 版セッション層 第4段階: 応援トーク・マッチング・DIVE(ランダム通話)・コイン/ポイント・装飾・SMS/メール認証・アカウント設定
   ios-session-ext3.js の後に読み込まれ、window.__koeIos.extend() でハンドラを追加する。 */
(function(){
  var K = window.__koeIos && window.__koeIos._internals;
  if (!K) return;
  var state = K.state, http = K.http, request = K.request, httpApi2 = K.httpApi2, okResult = K.okResult, okList = K.okList, jsonStatus = K.jsonStatus, native = K.native, log = K.log, nowStr = K.nowStr, pref = K.pref, ensureDefines = K.ensureDefines, iconUrl = K.iconUrl, firstArray = K.firstArray, firstStr = K.firstStr, extractError = K.extractError, resolveNames = K.resolveNames, nameOf = K.nameOf, iconOf = K.iconOf;
  var APP_VERSION = K.APP_VERSION, BASE = K.BASE, BASE2 = K.BASE2;
  var RTDB = "https://koetomo-bb8bb.firebaseio.com/";
  var handlers = {};

  function trunc(s, n){ s = String(s == null ? "" : s); return s.length > n ? s.slice(0, n) + "…" : s; }
  function redact(s){ return String(s || "").replace(/("?(?:auth_)?token"?\s*[:=]\s*"?)[A-Za-z0-9._-]{8,}/gi, "$1***"); }
  function bodyStr(r){ return r && r.text ? trunc(redact(r.text), 300) : "(null)"; }
  function num(v, d){ var n = parseInt(v, 10); return isNaN(n) ? d : n; }
  function okStatus(r){ var o = okResult(r, true); return o; }
  function errOf(r){ var m = extractError(r.body); return { ok: false, status: r.status, error: m || ("HTTP " + r.status) }; }
  function isOk(r){ return r.status === 200 || r.status === 201; }
  /* Java httpJsonApi2: api2 に JSON ボディ(ヘッダ認証) */
  async function httpJsonApi2(method, path, obj){
    var r = await http(method, BASE2 + path, null, null, { json: obj });
    if (!r.status || r.status === 404 || r.status >= 500) { var r2 = await http(method, BASE + path, null, null, { json: obj }); if (r2.status && r2.status < 400) return r2; }
    return r;
  }
  /* Java gracefulUnavailable: 空リスト + unavailable で劣化表示 */
  function unavailable(r, key, label){
    var code = -1, msg = "";
    try { if (r && r.body) { code = num(r.body.error_code != null ? r.body.error_code : r.body.code, -1); msg = firstStr(r.body, ["message", "error_message", "error", "detail"]); } } catch (e) {}
    log(nowStr() + "  [UNAVAIL] " + label + "  status=" + (r ? r.status : -1) + (code >= 0 ? " code=" + code : "") + (msg ? "  " + msg : ""));
    var o = { ok: true, unavailable: true, status: r ? r.status : -1, note: "この機能は現在ご利用いただけません（公式アプリ限定の新機能のため未対応）" };
    o[key] = []; if (code >= 0) o.code = code; return o;
  }
  function cheeringData(r, key){
    if (r.status !== 200 || !r.body) return jsonStatus(r);
    var o = { ok: true }; var d = r.body.data;
    if (Array.isArray(d) || (d && typeof d === "object")) o[key] = d;
    else if (Array.isArray(r.body[key])) o[key] = r.body[key];
    else o[key] = r.body;
    return o;
  }
  function parseReceiversInto(body, out, seen){
    if (!body) return 0;
    var raw = null, d = body.data;
    if (Array.isArray(d)) raw = d; else if (d && typeof d === "object") raw = firstArray(d, ["recommended_users", "receiver_users", "ranked_users", "users"]);
    if (!raw) raw = firstArray(body, ["recommended_users", "receiver_users", "ranked_users", "users"]);
    if (!raw) return 0;
    var added = 0;
    raw.forEach(function(r){
      if (!r || typeof r !== "object") return;
      var u = r.user && typeof r.user === "object" ? r.user : null;
      var uid = Number(u ? (u.id || u.user_id || 0) : (r.user_id || r.id || 0)) || 0;
      if (uid && seen) { if (seen[uid]) return; seen[uid] = true; }
      var name = (u ? u.name : r.name) || "";
      var icon = (u ? u.profile_picture_file_path : r.profile_picture_file_path) || "";
      var o = { receiver_id: r.receiver_id != null ? r.receiver_id : (r.id != null ? r.id : uid), user_id: uid, name: name || ("user " + uid), icon_url: iconUrl(icon) };
      var st = firstStr(r, ["status_text", "message", "introduction", "comment"]);
      if (r.rating_count != null) o.rating_count = r.rating_count;
      if (r.total_rating_point != null) o.total_rating_point = r.total_rating_point;
      if (r.total_coin != null) o.total_coin = r.total_coin;
      var rank = num(r.rank, 0);
      if (rank > 0) { o.rank = rank; var pts = r.total_rating_point != null ? " ・ " + num(r.total_rating_point, 0) + "pt" : ""; st = "第" + rank + "位" + pts + (st ? " ・ " + st : ""); }
      o.status_text = st; out.push(o); added++;
    });
    return added;
  }
  async function cheeringReceivers(kind){
    kind = kind == null ? "" : String(kind);
    if (kind.indexOf("rankings") === 0) {
      var rt = "1", ft = "2";
      if (kind.indexOf(":") >= 0) { var p = kind.split(":"); if (p[1] && p[1].trim()) rt = p[1].trim(); if (p[2] && p[2].trim()) ft = p[2].trim(); }
      var r = await httpApi2("GET", "/api/cheering_talk/receiver_users/rankings", { rating_type: rt, page: "1", filter_type: ft });
      log(nowStr() + "  [CHEER] receivers/rankings HTTP " + r.status + " " + bodyStr(r));
      if (r.status !== 200 || !r.body) return unavailable(r, "receivers", "cheering receivers/rankings");
      var out = []; parseReceiversInto(r.body, out, {}); return { ok: true, receivers: out };
    }
    if (kind === "recommended") {
      var r2 = await httpApi2("GET", "/api/cheering_talk/receiver_users/recommended_users", null, null);
      log(nowStr() + "  [CHEER] receivers/recommended HTTP " + r2.status + " " + bodyStr(r2));
      if (r2.status !== 200 || !r2.body) return unavailable(r2, "receivers", "cheering receivers/recommended");
      var out2 = []; parseReceiversInto(r2.body, out2, {}); return { ok: true, receivers: out2 };
    }
    var all = [], seen = {}, last = 0, lastR = null;
    var statuses = ["active", "online", "offline"];
    for (var i = 0; i < statuses.length; i++) {
      var rr = await httpApi2("GET", "/api/cheering_talk/receiver_users", { status: statuses[i], order: "created_at", direction: "desc", page: "1" });
      last = rr.status; lastR = rr;
      log(nowStr() + "  [CHEER] receivers/list(" + statuses[i] + ") HTTP " + rr.status + " " + bodyStr(rr));
      if (rr.status === 200 && rr.body) parseReceiversInto(rr.body, all, seen);
    }
    if (!all.length && last !== 200) return unavailable(lastR, "receivers", "cheering receivers/list");
    return { ok: true, receivers: all };
  }
  async function rtdbGet(path){
    var r = await native("__http", [{ method: "GET", url: RTDB + path, headers: { "Accept": "application/json" }, timeout: 12000 }]);
    return { status: (r && r.status) || 0, text: (r && r.status === 200 && typeof r.body === "string") ? r.body : "" };
  }
  function isNullish(t){ t = String(t || "").trim(); return !t || t === "null"; }
  function naiveLocalMillis(s){ var m = /(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(String(s || "")); if (!m) return 0; return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], m[6] ? +m[6] : 0).getTime(); }
  function instantMillis(s){ if (!s || String(s).length < 10) return 0; var t = Date.parse(String(s).trim()); return isNaN(t) ? 0 : t; }
  function ageSec(s){ var t = instantMillis(s) || naiveLocalMillis(s); return t > 0 ? Math.floor((Date.now() - t) / 1000) : -1; }
  function ymNow(){ var d = new Date(); return d.getFullYear() + String(d.getMonth() + 101).slice(1); }
  function historyResult(r, keys){
    if (r.status !== 200 || !r.body) return { ok: false, status: r.status };
    var d = r.body.data && typeof r.body.data === "object" ? r.body.data : null;
    var arr = (d && firstArray(d, keys)) || firstArray(r.body, keys) || (Array.isArray(r.body.data) ? r.body.data : []);
    return { ok: true, histories: arr.filter(function(x){ return x && typeof x === "object"; }).map(function(x){
      return { amount: num(x.amount != null ? x.amount : (x.coin_amount != null ? x.coin_amount : x.point_amount), 0), title: x.title || x.description || x.reason || "", created_at: x.created_at || "", expired_at: x.expired_at || "" };
    }) };
  }
  async function userHistoryResult(r, keys){
    if (r.status !== 200 || !r.body) return { ok: false, status: r.status };
    var d = r.body.data && typeof r.body.data === "object" ? r.body.data : null;
    var arr = (d && firstArray(d, keys)) || firstArray(r.body, keys) || (Array.isArray(r.body.data) ? r.body.data : []);
    var rows = [];
    arr.forEach(function(x){
      if (!x || typeof x !== "object") return;
      var u = x.opponent || x.caller || x.from_user || x.sender || x.requester || x.user || null;
      var uid = u ? Number(u.id || u.user_id || 0) : 0;
      if (!uid) uid = Number(x.opponent_id || x.caller_id || x.target_id || x.user_id || 0);
      rows.push({ user_id: uid, name: u ? (u.nickname || u.name || "") : "", icon_url: u ? iconUrl(u.profile_picture_file_path || u.profilePictureFilePath || "") : "", created_at: x.created_at || x.talked_at || x.requested_at || "" });
    });
    var missing = rows.filter(function(x){ return !x.name && x.user_id > 0; }).map(function(x){ return { user_id: x.user_id }; });
    if (missing.length) { try { await resolveNames(missing); } catch (e) {} }
    rows.forEach(function(x){ if (!x.name && x.user_id) { x.name = nameOf(x.user_id); if (!x.icon_url) x.icon_url = iconOf(x.user_id); } });
    return { ok: true, histories: rows };
  }
  function diveTokenOf(b){ if (!b) return ""; var t = b.token || ""; if (!t && b.data && typeof b.data === "object") t = b.data.token || b.data.connection_id || ""; if (!t) t = b.connection_id || ""; return String(t || ""); }
  function diveOut(r){ if (!isOk(r)) return errOf(r); return { ok: true, token: diveTokenOf(r.body) }; }
  var SETTING_KEYS = ["random_match_enabled", "is_online_status_public", "is_read_receipt_public", "is_my_age_public", "is_follow_list_public", "is_follower_list_public", "is_friend_list_public", "timeline_image_enabled"];
  function truthy(v){ if (v == null) return false; if (typeof v === "boolean") return v; if (typeof v === "number") return v !== 0; var t = String(v).trim().toLowerCase(); return t === "1" || t === "true" || t === "yes"; }
  function localSettings(){ try { return JSON.parse(pref("usersettings") || "{}"); } catch (e) { return {}; } }
  /* api → api2 の順で PUT(旧 API 群: version/auth_token をフォームに載せる) */
  async function legacyPut(path, fields){
    fields = Object.assign({}, fields, { version: "android_" + APP_VERSION }); if (state.token) fields.auth_token = state.token;
    var r = await http("PUT", BASE + path, null, fields);
    if (r.status === 404 || r.status >= 500) r = await http("PUT", BASE2 + path, null, fields);
    return r;
  }

  Object.assign(handlers, {
    // ---- 応援トーク ----
    get_receivers: async function(a){ return await cheeringReceivers(a[0] || ""); },
    get_cheering_receivers: async function(a){ return await cheeringReceivers(a[0] == null ? "1" : a[0]); },
    get_cheering_receiver_detail: async function(a){ if (!a[0]) return { ok: false, error: "receiver_id不明" }; return cheeringData(await httpApi2("GET", "/api/cheering_talk/receiver_users/" + a[0] + "/user_detail", null, null), "detail"); },
    update_cheering_receiver_status: async function(a){ if (!a[0]) return { ok: false, error: "receiver_id不明" }; return okResult(await httpJsonApi2("PUT", "/api/cheering_talk/receiver_users/" + a[0] + "/update_status", { status: a[1] || "" })); },
    start_cheering_call: async function(a){
      if (!a[0]) return { ok: false, error: "receiver_id不明" };
      var r = await httpJsonApi2("POST", "/api/cheering_talk/requests", { origin: 0, target_receiver_id: num(a[0], 0) });
      log(nowStr() + "  [CHEER] requests HTTP " + r.status + " " + bodyStr(r));
      if (!isOk(r)) return errOf(r);
      var d = (r.body && r.body.data && typeof r.body.data === "object") ? r.body.data : r.body;
      var out = { ok: true };
      if (d) { out.channel = firstStr(d, ["channel", "skyway_channel", "channel_name"]); out.token = firstStr(d, ["token", "skyway_token", "call_token"]); out.target_id = d.id != null ? d.id : a[0]; out.raw = d; }
      return out;
    },
    answer_cheering_call: async function(a){
      if (!a[0]) return { ok: false, error: "token不明" };
      var ans = num(a[1], a[1] === "0" ? 0 : 1);
      var r = await httpJsonApi2("POST", "/api/cheering_talk/request_receives", { token: a[0], answer: ans });
      log(nowStr() + "  [CHEER] answer(" + ans + ") HTTP " + r.status + " " + bodyStr(r));
      return okResult(r);
    },
    cancel_cheering_call: async function(a){ if (!a[0]) return { ok: false, error: "target_id不明" }; return okResult(await httpApi2("POST", "/api/cheering_talk/request_cancels", null, { target_id: a[0] })); },
    check_cheering_call: async function(){
      var r = await httpApi2("GET", "/api/cheering_talk/request_checks", null, null);
      if (r.status !== 200 || !r.body) return { ok: false, status: r.status };
      var d = (r.body.data && typeof r.body.data === "object") ? r.body.data : r.body;
      var req = d.requester_info || d.requesterInfo || null;
      var token = firstStr(d, ["token", "channel", "skyway_channel", "channel_name"]);
      var tid = req ? firstStr(req, ["id", "user_id"]) : "";
      if (!tid) tid = firstStr(d, ["target_id", "receiver_id", "id"]);
      var out = { ok: true, token: token, channel: token, target_id: tid, call_method: firstStr(d, ["call_method", "callMethod"]), is_blocking: !!(d.is_blocking || d.isBlocking), status: d.status || "" };
      if (req) { out.requester_name = firstStr(req, ["name"]); out.requester_icon = firstStr(req, ["profile_picture_file_path", "profilePictureFilePath"]); }
      return out;
    },
    confirm_and_open_cheering_call: async function(a){
      if (!a[0]) return { ok: false, error: "target_id不明" };
      var r = await httpApi2("POST", "/api/cheering_talk/request_confirms", null, { target_id: a[0] });
      log(nowStr() + "  [CHEER] request_confirms HTTP " + r.status + " " + bodyStr(r));
      return isOk(r) ? { ok: true } : errOf(r);
    },
    disconnect_cheering_call: async function(a){ if (!a[0]) return { ok: false, error: "target_id不明" }; return okResult(await httpApi2("POST", "/api/cheering_talk/request_disconnects", null, { target_id: a[0] })); },
    rate_cheering_call: async function(a){
      if (!a[0]) return { ok: false, error: "target_id不明" };
      var body = { rating_type: num(a[1], 0), target_receiver_id: num(a[0], 0) }; if (a[2]) body.token = a[2];
      return okResult(await httpJsonApi2("POST", "/api/cheering_talk/ratings", body));
    },
    get_cheering_voice_call: async function(a){
      var channel = a[0]; if (!channel) return { ok: false, error: "channel不明" };
      var sk = await getSkywayTokenLocal(channel);
      if (sk.status !== 200) return { ok: false, status: sk.status, message: "通話サーバーへの認証に失敗しました" };
      var tok = skywayTokenOf(sk);
      if (!tok) return { ok: false, error: "AuthTokenが取得できませんでした(応答キーを診断ログに記録)" };
      var target = Number(a[1] || 0) || 0;
      var participants = [];
      if (target) participants.push({ user_id: target, name: nameOf(target), icon_url: iconOf(target) });
      return { ok: true, call: { auth_token: tok, channel: channel, member: state.userId + "_" + channel, room_id: null, is_owner: false, owner_user_id: target, participants: participants } };
    },
    cheering_send_coins: async function(a){ if (!a[0]) return { ok: false, error: "target_id不明" }; if (!a[1]) return { ok: false, error: "coin_amount不明" }; return okResult(await httpApi2("POST", "/api/cheering_talk/send_coins", null, { target_receiver_id: a[0], token: a[1] })); },
    cheering_skyway_connect: async function(a){ if (!a[0]) return { ok: false, error: "target_id不明" }; return okResult(await httpApi2("POST", "/api/cheering_talk/skyway_connections", null, { token: a[1] || "" })); },
    cheering_skyway_disconnect: async function(a){ if (!a[0]) return { ok: false, error: "target_id不明" }; return okResult(await httpApi2("POST", "/api/cheering_talk/skyway_disconnections", null, { token: a[1] || "", call_duration: "0" })); },
    get_cheering_request_receives: async function(){ var r = await httpApi2("GET", "/api/cheering_talk/request_checks", null, null); log(nowStr() + "  [CHEER] request_checks HTTP " + r.status); return cheeringData(r, "requests"); },
    get_cheering_standby_requests: async function(a){ if (!a[0]) return { ok: false, error: "receiver_id不明" }; return cheeringData(await httpApi2("GET", "/api/cheering_talk/receiver_users/" + a[0] + "/standby_requests", null, null), "requests"); },
    get_cheering_talk_histories: async function(a){
      var r = await httpApi2("GET", "/api/cheering_talk/talk_histories", { page: a[0] || "1", filter_type: "0" });
      log(nowStr() + "  [CHEER] talk_histories HTTP " + r.status);
      if (r.status !== 200 || !r.body) return unavailable(r, "histories", "cheering talk_histories");
      return { ok: true, histories: Array.isArray(r.body.data) ? r.body.data : (r.body.talk_histories || []) };
    },
    get_cheering_sent_coins: async function(){
      var r = await httpApi2("GET", "/api/cheering_talk/sent_coins", { receiver_id: "0" });
      log(nowStr() + "  [CHEER] sent_coins HTTP " + r.status);
      if (r.status !== 200 || !r.body) return unavailable(r, "sent_coins", "cheering sent_coins");
      return cheeringData(r, "sent_coins");
    },
    get_cheering_receiver_coin_list: async function(a){ if (!a[0]) return { ok: false, error: "receiver_id不明" }; return cheeringData(await httpApi2("GET", "/api/cheering_talk/receiver_users/" + a[0] + "/coin_list", null, null), "coins"); },
    get_cheering_ranking_url: async function(){
      var url = "";
      try {
        var r = await http("GET", BASE + "/config/client_defines.json", null, null, { sendAuth: false });
        var body = r.text || ""; var p = body.indexOf("r.koetomo.fun/ranking/cheering_talk");
        if (p >= 0) { var s = body.lastIndexOf('"', p), e = body.indexOf('"', p); if (s >= 0 && e > p) url = body.slice(s + 1, e).trim(); }
      } catch (e) {}
      if (!url) url = "https://r.koetomo.fun/ranking/cheering_talk_" + ymNow();
      if (url.indexOf("//") === 0) url = "https:" + url; else if (url.indexOf("http") !== 0) url = "https://" + url;
      return { ok: true, url: url };
    },

    // ---- マッチング ----
    matching_start: async function(a){ var r = await request("POST", "/api/matching", null, { group_id: a[0] || "1" }); log(nowStr() + "  [MATCH] start HTTP " + r.status + " " + bodyStr(r)); return okResult(r); },
    matching_state: async function(){
      var me = state.userId; if (!me) return { ok: false, error: "ログインが必要です" };
      var out = { ok: true, my_user_id: me };
      var g = await rtdbGet("users/" + me + "/matching_info.json");
      out.rtdb = g.status === 200 ? "ok" : ((g.status === 401 || g.status === 403) ? "denied" : "error");
      if (isNullish(g.text)) { out.state = "waiting"; return out; }
      var o; try { o = JSON.parse(g.text); } catch (e) { out.state = "waiting"; return out; }
      if (!o || typeof o !== "object") { out.state = "waiting"; return out; }
      var cur = num(o.current_id, 0); out.matching_id = cur;
      var e = cur ? o[String(cur)] : null;
      if (!e || typeof e !== "object") { out.state = "waiting"; return out; }
      out.entry_id = num(e.entry_id, 0); out.target_id = num(e.target_id, 0);
      var matchedAt = e.matched_at == null ? "" : String(e.matched_at), mutualAt = e.mutual_accepted_at == null ? "" : String(e.mutual_accepted_at);
      out.matched_at = matchedAt; out.mutual_accepted_at = mutualAt; out.matched_age = ageSec(matchedAt); out.mutual_age = ageSec(mutualAt);
      var now = Date.now(), mAt = naiveLocalMillis(matchedAt), uAt = instantMillis(mutualAt);
      out.matched_fresh = !!(mAt && now < mAt + 15000); out.mutual_fresh = !!(uAt && Math.abs(now - uAt) <= 15000);
      out.state = mutualAt ? "mutual" : (matchedAt ? "matched" : "waiting");
      return out;
    },
    matching_accept: async function(a){ var r = await request("PUT", "/api/matchings/" + a[0] + "/entries/" + a[1] + "/accept", null, {}); log(nowStr() + "  [MATCH] accept " + a[0] + "/" + a[1] + " HTTP " + r.status); return okResult(r); },
    matching_cancel: async function(){ return okResult(await request("DELETE", "/api/matching", null, null)); },
    matching_refuse: async function(a){ var r = await request("PUT", "/api/matchings/" + a[0] + "/entries/" + a[1] + "/refuse", null, {}); log(nowStr() + "  [MATCH] refuse " + a[0] + "/" + a[1] + " HTTP " + r.status); return okResult(r); },
    matching_refused: async function(a){ var g = await rtdbGet("users/" + a[0] + "/matching_info/" + a[1] + "/refused_at.json"); return { ok: true, refused: !isNullish(g.text) }; },
    get_matching: async function(){ var r = await request("GET", "/api/matchings", null, null); if (r.status !== 200) r = await request("GET", "/api/matching", null, null); return okList(r, "matchings", ["matchings", "matches", "users"]); },

    // ---- DIVE(ランダム通話) ----
    get_dive_talk_histories: async function(a){ var r = await httpApi2("GET", "/api/v2/talk_histories", { page: a[0] || "1" }); log(nowStr() + "  [TALKHIST] v2/talk_histories -> " + r.status); return okList(r, "histories", ["talk_histories", "histories", "data"]); },
    dive_check: async function(){
      var r = await request("POST", "/api/v2/dive/request_checks", null, {});
      if (r.status !== 200 || !r.body) return { ok: false, status: r.status };
      var req = r.body.request || (r.body.data && r.body.data.request) || null;
      if (!req || typeof req !== "object") return { ok: true, has_request: false };
      var ti = req.target_info && typeof req.target_info === "object" ? req.target_info : null;
      var out = { ok: true, has_request: true, call_method: req.call_method || "skyway" };
      if (ti) { out.target_id = ti.user_id; out.name = ti.name || ""; out.age = ti.age; out.sex = ti.sex; out.comment = ti.comment == null ? "" : ti.comment; out.liked_count = ti.liked_count; out.icon_url = iconUrl(ti.profile_picture_file_path || ""); }
      return out;
    },
    dive_request: async function(a){ if (!a[0]) return { ok: false, error: "target_id不明" }; var r = await request("POST", "/api/dive/requests", null, { target_id: a[0], call_method: "skyway", origin: "10" }); log(nowStr() + "  [DIVE] request target=" + a[0] + " HTTP " + r.status + " " + bodyStr(r)); return diveOut(r); },
    dive_request_cancel: async function(){ return okResult(await request("POST", "/api/dive/request_cancels", null, {})); },
    dive_incoming: async function(){ var me = state.userId; if (!me) return { ok: false, error: "ログインが必要です" }; var g = await rtdbGet("users/" + me + "/is_incoming.json"); return { ok: true, incoming: String(g.text || "").trim() === "true" }; },
    dive_receive: async function(a){ if (!a[0]) return { ok: false, error: "target_id不明" }; var r = await request("POST", "/api/dive/request_receives", null, { target_id: a[0], answer: a[1] || "1" }); log(nowStr() + "  [DIVE] receive target=" + a[0] + " answer=" + (a[1] || "1") + " HTTP " + r.status); return diveOut(r); },
    dive_confirm: async function(a){ if (!a[0]) return { ok: false, error: "target_id不明" }; var r = await request("POST", "/api/dive/request_confirms", null, { target_id: a[0] }); log(nowStr() + "  [DIVE] confirm target=" + a[0] + " HTTP " + r.status + " " + bodyStr(r)); return diveOut(r); },
    dive_confirm_status: async function(a){ if (!a[0]) return { ok: false, error: "token不明" }; var g = await rtdbGet("request_connections/" + a[0] + "/confirm_status.json"); return { ok: true, ready: !isNullish(g.text), value: g.text }; },
    dive_like: async function(a){ if (!a[0]) return { ok: false, error: "通話が特定できません" }; var r = await request("PUT", "/api/dive/like", null, { connection_id: a[0] }); log(nowStr() + "  [DIVE] good_talk HTTP " + r.status); return (r.status === 200 || r.status === 201 || r.status === 204) ? { ok: true } : errOf(r); },
    dive_request_disconnect: async function(a){ return okResult(await request("POST", "/api/dive/request_disconnects", null, { target_id: a[0] || "", error_description: a[1] || "" })); },
    get_dive_target_friends: async function(){ return okList(await request("POST", "/api/v2/dive/target_friends", null, { include_blocked_user: "false" }), "friends", ["target_friends", "friends", "users"]); },
    get_talk_requests: async function(){ return await userHistoryResult(await request("POST", "/api/dive/talking_requests", null, {}), ["talking_requests", "data"]); },
    get_missed_calls: async function(){ return await userHistoryResult(await request("GET", "/api/v2/missed_calls", { page: "1" }), ["missed_calls", "data"]); },
    get_good_talk_min: async function(){ var sec = 60; try { await ensureDefines(); sec = num(state.clientDefines.client_system_params.dive.min_good_talk_second, 60); } catch (e) {} if (sec <= 0) sec = 60; return { ok: true, min_second: sec }; },

    // ---- コイン / ポイント ----
    get_coin_packs: async function(){ var r = await request("GET", "/api/v2/coin_packs", null, null); if (r.status !== 200) r = await request("GET", "/api/coin_packs", null, null); return okList(r, "coin_packs", ["coin_packs", "coinPacks"]); },
    get_coin_history: async function(){ return historyResult(await request("GET", "/api/v2/coin_histories", { page: "1", order: "desc" }), ["coin_histories", "histories", "data"]); },
    /* iOS では Google Play 課金が使えないため、購入トークン登録は端末側の決済がない旨を返す */
    purchase_token: async function(){ return { ok: false, error: "not_supported", message: "iOS 版ではコインの購入(アプリ内課金)に対応していません。公式アプリまたは Android 版でご購入ください。" }; },
    add_purchase_token: async function(a){ if (!a[0] || !a[1]) return { ok: false, error: "item_id / purchase_token 不明" }; var r = await httpApi2("POST", "/api/purchase_token", null, { item_id: a[0], purchase_token: a[1] }); log(nowStr() + "  [PURCHASE] add token -> " + r.status); return okStatus(r); },
    get_aborted_purchase_token: async function(){ var r = await httpApi2("GET", "/api/purchase_token", null, null); if (r.status !== 200 || !r.body) return jsonStatus(r); return { ok: true, data: r.body }; },
    get_point_history: async function(){ return historyResult(await request("GET", "/api/point_histories", { page: "1" }), ["point_histories", "histories", "data"]); },
    get_daily_point_histories: async function(a){ return okList(await request("GET", "/api/v2/daily_point_histories", { page: a[0] || "1", user_id: String(state.userId), order: "desc" }), "histories", ["daily_point_histories", "histories", "point_histories"]); },
    estimate_point_exchange: async function(a){ if (!a[0]) return { ok: false, error: "points不明" }; return okResult(await request("GET", "/api/estimate_point_exchange", { amount: a[0] }, null)); },
    execute_point_exchange: async function(a){ if (!a[0]) return { ok: false, error: "points不明" }; return okResult(await request("POST", "/api/point_exchange", { amount: a[0] }, null)); },
    point_exchange_url: async function(){ return { ok: true, url: BASE2 + "/api/dmoney/product_list?auth_token=" + encodeURIComponent(state.token || "") + "&version=android_" + APP_VERSION }; },
    give_coin: async function(a){ return okResult(await request("POST", "/api/give_coin", null, { target_id: a[0] || "", amount: a[1] || "", coin: a[1] || "" })); },
    get_gift_history: async function(){
      var q = { version: "android_" + APP_VERSION }; if (state.token) q.auth_token = state.token;
      var r = await http("GET", BASE2 + "/api/receive_tippings", q, null);
      if (r.status !== 200 || !r.body) return { ok: false, status: r.status, raw: trunc(r.text, 400) };
      var d = r.body.data && typeof r.body.data === "object" && !Array.isArray(r.body.data) ? r.body.data : null;
      var arr = (d && firstArray(d, ["receive_tippings", "tippings", "data"])) || firstArray(r.body, ["receive_tippings", "data"]) || [];
      return { ok: true, gifts: arr };
    },

    // ---- 装飾 ----
    get_decoration_items: async function(){ var r = await request("GET", "/api/decoration_items", { on_sale: "true" }, null); if (r.status !== 200 || !r.body) return jsonStatus(r); return { ok: true, items: Array.isArray(r.body.data) ? r.body.data : (r.body.decoration_items || []) }; },
    purchase_decoration_item: async function(a){ if (!a[0]) return { ok: false, error: "item_id不明" }; return okResult(await request("POST", "/api/decoration_items/purchase", { item_pack_id: a[0] }, null)); },
    get_mypage_decoration: async function(){ var r = await request("GET", "/api/mypage_decoration", null, null); if (r.status !== 200 || !r.body) return jsonStatus(r); return { ok: true, data: r.body }; },
    get_owned_items: async function(){ var r = await request("GET", "/api/owned_items", null, null); if (r.status !== 200 || !r.body) return jsonStatus(r); return { ok: true, items: Array.isArray(r.body.data) ? r.body.data : (r.body.owned_items || []) }; },
    get_item_histories: async function(a){ return okList(await request("GET", "/api/item_histories", { page: a[0] || "1", type_ids: "1,2" }, null), "items", ["item_histories", "items"]); },

    // ---- SMS / メール認証・アカウント ----
    send_sms_auth_code: async function(a){ if (!a[0]) return { ok: false, error: "電話番号不明" }; return okResult(await request("POST", "/api/account/send_sms_auth_code", null, { phone_number: a[0] })); },
    authenticate_sms_auth_code: async function(a){ if (!a[0]) return { ok: false, error: "電話番号不明" }; if (!a[1]) return { ok: false, error: "認証コード不明" }; return okResult(await request("POST", "/api/account/authenticate_sms_auth_code", null, { sms_auth_code: a[1], phone_number: a[0] })); },
    send_email_token: async function(a){ if (!a[0]) return { ok: false, error: "メールアドレス不明" }; return okResult(await request("POST", "/api/send_email_token", null, { email: a[0] })); },
    check_email_token: async function(a){ if (!a[0]) return { ok: false, error: "メールアドレス不明" }; if (!a[1]) return { ok: false, error: "トークン不明" }; return okResult(await request("POST", "/api/check_email_token", null, { email_token: a[1], email: a[0] })); },
    check_entered_email: async function(a){ if (!a[0]) return { ok: false, error: "メールアドレス不明" }; return okResult(await request("POST", "/api/account/entered_email", null, { email: a[0] })); },
    check_name_availability: async function(a){
      var r = await request("GET", "/api/account/name_availability", { name: a[0] || "" }, null);
      var avail = r.status === 200;
      if (r.body) { var src = (r.body.data && typeof r.body.data === "object") ? r.body.data : r.body; if (src.available != null) avail = truthy(src.available); else if (src.is_available != null) avail = truthy(src.is_available); }
      return { ok: r.status === 200, available: avail };
    },
    change_password: async function(a){
      var r = await legacyPut("/api/account/passwords", { current_password: a[0] || "", new_password: a[1] || "", new_password_confirmation: a[2] || "" });
      if (r.status >= 200 && r.status < 300) return { ok: true };
      return { ok: false, status: r.status, raw: trunc(redact(r.text), 300) };
    },
    passclear_request: async function(a){ return okResult(await request("POST", "/api/account/passclear_request", null, { email: a[0] || "" })); },
    signup: async function(a){
      if (!a[0] || !a[1]) return { ok: false, error: "メールアドレスとパスワードを入力してください" };
      var r = await request("POST", "/api/account/signup", null, { email: a[0], password: a[1], name: a[2] || "", sex: a[3] || "0", birthday: a[4] || "", device_uid: a[5] || (K.deviceUid ? K.deviceUid() : ""), birthday_input_error: "" });
      log(nowStr() + "  [SIGNUP] -> " + r.status); return okStatus(r);
    },
    signup_auth: async function(a){ if (!a[0]) return { ok: false, error: "token不明" }; var r = await request("POST", "/api/account/signup_auth", null, { token: a[0] }); log(nowStr() + "  [SIGNUP-AUTH] -> " + r.status); return okStatus(r); },
    reset_user_status: async function(){ return okResult(await request("PUT", "/api/users/reset_status", null, {})); },
    get_expiration_date: async function(){ var r = await request("GET", "/api/expiration_date", null, null); var d = r.body && r.body.data && typeof r.body.data === "object" ? r.body.data : (r.body || {}); return { ok: r.status === 200, data: d }; },
    get_user_settings: async function(){
      var r = await request("GET", "/api/v3/users/" + state.userId, null, null);
      if (r.status !== 200 || !r.body) return { ok: false, status: r.status, raw: trunc(r.text, 400) };
      var o = (r.body.data && typeof r.body.data === "object") ? r.body.data : r.body;
      var u = (o.user && typeof o.user === "object") ? o.user : o;
      var s = u.user_setting || u.settings || u;
      var out = {}; SETTING_KEYS.forEach(function(k){ if (s[k] !== undefined) out[k] = truthy(s[k]); });
      log(nowStr() + "  [SETTINGS] v3 found=" + Object.keys(out).length);
      if (!Object.keys(out).length) { var loc = localSettings(); SETTING_KEYS.forEach(function(k){ if (loc[k] !== undefined) out[k] = !!loc[k]; }); out._local = true; }
      return { ok: true, settings: out };
    },
    set_user_settings: async function(a){
      var obj; try { obj = JSON.parse(a[0] || "{}"); } catch (e) { return { ok: false, error: "設定の形式が不正です" }; }
      var f = {}; Object.keys(obj).forEach(function(k){ var v = obj[k]; f[k] = typeof v === "boolean" ? (v ? "1" : "0") : String(v); });
      var r = await legacyPut("/api/account/user_settings", f);
      log(nowStr() + "  [SETTINGS] update -> " + r.status + " vsns=" + r.vsns);
      if (r.status >= 200 && r.status < 300) { var loc = localSettings(); Object.keys(obj).forEach(function(k){ loc[k] = truthy(obj[k]); }); pref("usersettings", JSON.stringify(loc)); }
      return okStatus(r);
    }
  });

  /* skyway 認証(ios-session.js 内部が公開されていない場合のフォールバック) */
  function skywayHostLocal(){ var h = ""; try { h = state.clientDefines.client_system_params.skyway.auth_token_endpoint_server || ""; } catch (e) {} if (h && h.indexOf("http") !== 0) h = "https://" + h; return h || "https://skyway-auth.meetscom.com"; }
  async function getSkywayTokenLocal(channel){ await ensureDefines(); var r = await http("POST", skywayHostLocal() + "/authenticate", null, { channelName: channel, memberName: state.userId + "_" + channel, sessionToken: state.token || "" }); if (r.status !== 200) log(nowStr() + "  [SKYWAY] authenticate ch=" + channel + " -> " + r.status); return r; }
  function skywayTokenOf(r){ var b = r.body || {}; var d = b.data || {}; var keys = ["authToken", "token", "auth_token", "skyway_token", "skywayToken", "jwt", "credential"]; for (var i = 0; i < keys.length; i++) { if (typeof d[keys[i]] === "string" && d[keys[i]]) return d[keys[i]]; if (typeof b[keys[i]] === "string" && b[keys[i]]) return b[keys[i]]; } return ""; }

  window.__koeIos.extend(handlers);
})();
