/* iOS 版セッション層 第5段階: 共有BANリスト連携(閲覧・通報・業者自動判定・異議申立)、規制語ログ、
   コミュニティの残り(作成・コメント・ルール・参加申請・招待・通話枠の権限)、アンケート・キャンペーン・録音、
   アカウント設定(バッジ・ログアウト・退会)、LINE / Facebook / X ログイン。Android 版 KoeSession の残り全コマンド。 */
(function(){
  var K = window.__koeIos && window.__koeIos._internals;
  if (!K) return;
  var state = K.state, http = K.http, request = K.request, httpApi2 = K.httpApi2, okResult = K.okResult, okList = K.okList, jsonStatus = K.jsonStatus, native = K.native, log = K.log, nowStr = K.nowStr, pref = K.pref, ensureDefines = K.ensureDefines, iconUrl = K.iconUrl, firstArray = K.firstArray, firstStr = K.firstStr, extractError = K.extractError, resolveNames = K.resolveNames, nameOf = K.nameOf, iconOf = K.iconOf, handlers = K.handlers;
  var APP_VERSION = K.APP_VERSION, BASE = K.BASE, BASE2 = K.BASE2;
  var UA = "okhttp/4.12.0";
  var FEATURE = "skwmeshroom,firebase,mail_auth,reset_status,chat_pagination,speaker_applicant,p2p_room,skyway,talk_recording";
  var h = {};

  function trunc(s, n){ s = String(s == null ? "" : s); return s.length > n ? s.slice(0, n) + "…" : s; }
  function num(v, d){ var n = parseInt(v, 10); return isNaN(n) ? d : n; }
  function jarr(k){ try { var a = JSON.parse(pref(k) || "[]"); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  function jput(k, a, cap){ try { while (a.length > cap) a.shift(); pref(k, JSON.stringify(a)); } catch (e) {} }
  function commentUid(c){ var u = c && c.user; var id = Number(c.user_id || c.userId || 0); return id || (u ? Number(u.id || u.user_id || 0) : 0); }
  function firstNonEmpty(){ for (var i = 0; i < arguments.length; i++) if (arguments[i]) return arguments[i]; return ""; }
  function truthy(v){ if (v == null) return false; if (typeof v === "boolean") return v; if (typeof v === "number") return v !== 0; var t = String(v).trim().toLowerCase(); return t === "1" || t === "true" || t === "yes"; }
  function errOf(r){ var m = extractError(r.body); return { ok: false, status: r.status, error: m || ("HTTP " + r.status) }; }
  /* Java httpJson: api → api2、JSON ボディ、ヘッダ認証 */
  async function httpJson(method, path, obj){
    var r = await http(method, BASE + path, null, null, { json: obj });
    if (r.status === 404 || r.status >= 500 || !r.status) r = await http(method, BASE2 + path, null, null, { json: obj });
    return r;
  }
  async function httpJsonApi2(method, path, obj){
    var r = await http(method, BASE2 + path, null, null, { json: obj });
    if (!r.status || r.status === 404 || r.status >= 500) { var r2 = await http(method, BASE + path, null, null, { json: obj }); if (r2.status && r2.status < 400) return r2; }
    return r;
  }
  function legacyFields(extra){ var f = Object.assign({}, extra || {}, { version: "android_" + APP_VERSION }); if (state.token) f.auth_token = state.token; return f; }
  /* 名前つきコメント配列 */
  async function namedComments(arr, textKeys){
    var ids = arr.map(function(c){ return commentUid(c); }).filter(Boolean);
    try { await resolveNames(ids); } catch (e) {}
    return arr.filter(function(c){ return c && typeof c === "object"; }).map(function(c){
      var uid = commentUid(c), u = c.user && typeof c.user === "object" ? c.user : null;
      var name = (u && u.name) || nameOf(uid);
      var icon = (u && u.profile_picture_file_path) ? iconUrl(u.profile_picture_file_path) : iconOf(uid);
      return { user_id: uid, name: name, icon_url: icon, text: firstStr(c, textKeys), created_at: firstStr(c, ["created_at", "createdAt"]) };
    });
  }
  function dataArray(body, keys){ if (!body) return []; if (Array.isArray(body.data)) return body.data; var d = body.data && typeof body.data === "object" ? body.data : null; return (d && firstArray(d, keys)) || firstArray(body, keys) || []; }
  function userListOf(body){
    var KEYS = ["liked_users", "liked_users_info", "users", "user_info", "followers", "followees", "friends", "members", "requests", "join_requests", "blocked_users", "block_list", "data"];
    var arr = firstArray(body, KEYS);
    if (!arr) { var d = body.data; if (Array.isArray(d)) arr = d; else if (d && typeof d === "object") arr = firstArray(d, KEYS); else if (typeof d === "string") { try { var p = JSON.parse(d); arr = Array.isArray(p) ? p : firstArray(p, KEYS); } catch (e) {} } }
    return (arr || []).filter(function(x){ return x && typeof x === "object"; }).map(function(item){
      var u = item; ["target_info", "user_info", "user", "target_user", "followee", "follower", "userInfo"].some(function(k){ var n = item[k]; if (n && typeof n === "object" && (n.user_id != null || n.id != null || n.name)) { u = n; return true; } return false; });
      var uid = Number(u.user_id || u.id || item.user_id || item.id || item.target_id || 0);
      var o = { user_id: uid, name: u.nickname || u.name || ("user " + uid), icon_url: iconUrl(u.profile_picture_file_path || u.profilePictureFilePath || "") };
      var ls = u.login_status_with_unit || u.loginStatusWithUnit || u.login_status; if (ls) o.login_status = ls;
      if (u.age != null) o.age = u.age; if (u.area_name || u.areaName) o.area_name = u.area_name || u.areaName;
      if (u.comment) o.comment = String(u.comment).slice(0, 80);
      o.is_followee = !!(u.is_followee || u.isFollowee || item.is_followee); o.is_friend_requestee = !!(u.is_friend_requestee || u.isFriendRequestee || item.is_friend_requestee);
      return o;
    });
  }

  /* ===================== 共有BANリスト ===================== */
  var banned = {}; try { jarr("banned_uids").forEach(function(u){ banned[u] = 1; }); } catch (e) {}
  function isBanned(uid){ return !!(uid && banned[Number(uid)]); }
  function modBase(url){ var u = String(url || "").trim(); if (!u) return ""; if (u.indexOf("http") !== 0) u = "https://" + u; return u.replace(/\/+$/, ""); }
  async function modPostJson(url, body){
    var r = await http("POST", url, null, null, { json: body, sendAuth: false });
    if (r.body && typeof r.body === "object") { var o = Object.assign({}, r.body); if (o.ok === undefined) o.ok = r.status >= 200 && r.status < 300; o.status = r.status; return o; }
    return { ok: r.status >= 200 && r.status < 300, status: r.status, raw: trunc(r.text, 300) };
  }
  h.moderation_banlist = async function(a){
    var base = modBase(a[0]); if (!base) return { ok: false, error: "BANリストURL未設定" };
    var hd = { "Accept": "application/json" }; if (a[1]) hd["If-None-Match"] = a[1];
    var r = await native("__http", [{ method: "GET", url: base + "/api/bl/list", headers: hd, timeout: 15000 }]);
    var st = (r && r.status) || 0, etag = (r && r.headers && r.headers.etag) || "";
    if (st === 304) return { ok: true, not_modified: true, etag: a[1] || "", count: Object.keys(banned).length };
    if (st !== 200 || !r.body) return { ok: false, status: st };
    var bj; try { bj = JSON.parse(r.body); } catch (e) { return { ok: false, status: st, error: "parse" }; }
    var arr = Array.isArray(bj.banned) ? bj.banned : [], fresh = {}, out = [];
    arr.forEach(function(o){ if (!o || typeof o !== "object") return; var uid = num(o.uid, 0); if (uid) fresh[uid] = 1; out.push(o); });
    banned = fresh; jput("banned_uids", Object.keys(fresh).map(Number), 100000);
    log(nowStr() + "  [BANLIST] synced count=" + out.length + " version=" + bj.version);
    return { ok: true, not_modified: false, etag: etag, version: bj.version, count: out.length, banned: out };
  };
  h.moderation_my_uid = async function(){ return { ok: true, uid: state.userId }; };
  h.get_moderation_settings = async function(){ return { ok: true, settings: { auto_approve: pref("mod_auto_approve") === "1", auto_reject: pref("mod_auto_reject") === "1", auto_raise_hand: pref("mod_auto_raise_hand") === "1" } }; };
  h.set_moderation_settings = async function(a){ pref("mod_auto_approve", a[0] ? "1" : "0"); pref("mod_auto_reject", a[1] ? "1" : "0"); pref("mod_auto_raise_hand", a[2] ? "1" : "0"); return { ok: true, settings: { auto_approve: !!a[0], auto_reject: !!a[1], auto_raise_hand: !!a[2] } }; };
  h.moderation_report = async function(a){
    var base = modBase(a[0]); if (!base) return { ok: false, error: "BANリストURL未設定" };
    if (!state.userId) return { ok: false, error: "ログインが必要です" };
    var target = String(a[1] || "").trim(); if (!target) return { ok: false, error: "対象不明" };
    var body = { target_uid: target, reason_code: a[2] || "other", reporter_uid: String(state.userId) };
    if (a[3]) body.detail = a[3]; if (a[4]) body.evidence = a[4]; if (a[5]) body.evidence_image = a[5]; if (a[6]) body.evidence_url = a[6]; if (a[7] && String(a[7]).trim()) body.reporter_contact = String(a[7]).trim();
    log(nowStr() + "  [MODREPORT] target=" + target + " code=" + body.reason_code);
    return await modPostJson(base + "/api/bl/report", body);
  };
  h.moderation_appeal = async function(a){
    var base = modBase(a[0]); if (!base) return { ok: false, error: "BANリストURL未設定" };
    var body = { target_uid: String(a[1] || "").trim(), message: a[2] || "" }; if (a[3]) body.evidence_image = a[3]; if (a[4]) body.evidence_url = a[4];
    return await modPostJson(base + "/api/bl/appeal", body);
  };
  /* ---- 業者(bot)判定: Android 版 botEval と同じ規則 ---- */
  var BOT_START = Date.now(), BOT_AUTO_SCORE = 6.0, BOT_MARK_SCORE = 3.0;
  function strHash(s){ var hsh = 0; for (var i = 0; i < s.length; i++) { hsh = (hsh * 31 + s.charCodeAt(i)) | 0; } return String(hsh); }
  function botUserOf(body){ var d = body && body.data && typeof body.data === "object" ? body.data : null; return (d && (d.user_info || d.userInfo)) || body.user_info || d || body || {}; }
  function botKnownNear(uid){ return jarr("bot_cands").some(function(o){ var v = o && Number(o.u); return v && v !== uid && Math.abs(v - uid) <= 20; }); }
  function botKnownFeature(uid, feat){ if (!feat) return false; var fh = strHash(feat); return jarr("bot_cands").some(function(o){ return o && Number(o.u) !== uid && String(o.f || "") === fh; }); }
  function botRemember(uid, feat){ var a = jarr("bot_cands"), fh = feat ? strHash(feat) : "", found = false; a.forEach(function(o){ if (o && Number(o.u) === uid) { o.f = fh; o.t = Date.now(); found = true; } }); if (!found) a.push({ u: uid, f: fh, t: Date.now() }); jput("bot_cands", a, 400); }
  async function botRecentPosts(uid, windowMs){
    try { var r = await K.handlers.get_user_posts([String(uid), ""]); var ps = (r && r.posts) || []; var now = Date.now(); return ps.filter(function(p){ var t = Date.parse(p.created_at || ""); return t && now - t <= windowMs; }).length; } catch (e) { return -1; }
  }
  async function botEval(u, uid, allowPostFetch){
    var rs = [], ev = {};
    var icon = u.profile_picture_file_path || u.icon_url || ""; var fn = icon.slice(icon.lastIndexOf("/") + 1).split("?")[0];
    var a1 = /^[A-Za-z0-9]{16}\.(png|jpe?g|webp)$/.test(fn);
    var fol = u.follower_count != null ? Number(u.follower_count) : -1, fee = u.followee_count != null ? Number(u.followee_count) : -1, fr = u.friend_count != null ? Number(u.friend_count) : -1, liked = u.liked_count != null ? Number(u.liked_count) : -1;
    var a2 = fol === 0 && fee === 0 && fr === 0 && liked === 0;
    var cm = u.comment == null ? "" : String(u.comment); var a3 = cm.trim().length === 0;
    var av = u.age_verification_status != null ? Number(u.age_verification_status) : -1; var a4 = av === 0;
    var hard = a1 && a2 && a3 && a4;
    Object.assign(ev, { icon_file: fn, follower_count: fol, followee_count: fee, friend_count: fr, liked_count: liked, comment_empty: a3, age_verification_status: av, A1_icon16: a1, A2_all_zero: a2, A3_no_bio: a3, A4_no_age_verify: a4 });
    var sc = 0, nm = String(u.name || ""); ev.name = nm;
    if (/^[^\s]{1,20}[0-9]{3}$/.test(nm) && !/^[0-9]+$/.test(nm)) { sc += 3; rs.push("名前が単語+3桁数字"); }
    if (hard && botKnownNear(uid)) { sc += 3; rs.push("既知botとID連番"); }
    var feat = u.feature == null ? "" : String(u.feature); ev.feature = feat.slice(0, 120);
    if (hard && botKnownFeature(uid, feat)) { sc += 2; rs.push("既知botと同一feature"); }
    var rm = truthy(u.random_match_enabled) || (u.settings && truthy(u.settings.random_match_enabled)); ev.random_match_enabled = !!rm;
    if (rm && a2) { sc += 1.5; rs.push("ランダムマッチON+交流0"); }
    var ls = String(u.login_status_with_unit || ""); ev.login_status = ls;
    if (/1時間以内|分以内|オンライン/.test(ls)) { sc += 0.5; rs.push("直近ログイン"); }
    if (hard && allowPostFetch && sc >= BOT_MARK_SCORE && sc < BOT_AUTO_SCORE) { var recent = await botRecentPosts(uid, 3600000); ev.posts_last_hour = recent; if (recent >= 5) { sc += 2; rs.push("直近1時間に" + recent + "件投稿"); } }
    var level = hard ? (sc >= BOT_AUTO_SCORE ? "high" : (sc >= BOT_MARK_SCORE ? "mid" : "")) : "";
    Object.assign(ev, { score: sc, level: level, checked_at: nowStr(), checked_by: "KoeTomo+ auto" });
    if (hard) botRemember(uid, feat);
    return { hard: hard, score: sc, level: level, reasons: rs, ev: ev };
  }
  function botAutoGate(uid){
    if (Date.now() - BOT_START < 10000) return "起動直後は判定しません";
    if (jarr("bot_auto_done").some(function(v){ return Number(v) === uid; })) return "この相手は申請済みです";
    var now = Date.now(), last = 0, inHour = 0, inDay = 0;
    jarr("bot_auto_log").forEach(function(t){ t = Number(t); if (now - t < 86400000) { inDay++; if (now - t < 3600000) inHour++; if (t > last) last = t; } });
    if (last && now - last < 30000) return "自動申請の間隔制限中";
    if (inHour >= 3) return "自動申請は1時間3件までです";
    if (inDay >= 10) return "自動申請は1日10件までです";
    return "";
  }
  function botAutoMark(uid){ var now = Date.now(); var keep = jarr("bot_auto_log").filter(function(t){ return now - Number(t) < 86400000; }); keep.push(now); jput("bot_auto_log", keep, 60); var done = jarr("bot_auto_done"); done.push(uid); jput("bot_auto_done", done, 3000); }
  async function fetchUserRaw(uid){ var r = await request("GET", "/api/v3/users/" + uid, { fields: "core,chat,friend,follow,block" }, null); return r; }
  h.moderation_auto_spam = async function(a){
    var uid = num(a[1], 0); if (!uid) return { ok: false, error: "対象不明" };
    if (uid === state.userId) return { ok: true, applied: false, skip: "self" };
    var gate = botAutoGate(uid); if (gate) return { ok: true, applied: false, skip: gate };
    var now = Date.now(), keep = [], seenAlready = false;
    jarr("bot_auto_seen").forEach(function(o){ if (!o || now - Number(o.t) > 604800000) return; if (Number(o.u) === uid) seenAlready = true; keep.push(o); });
    if (seenAlready) return { ok: true, applied: false, skip: "確認済み" };
    keep.push({ u: uid, t: now }); jput("bot_auto_seen", keep, 500);
    var r = await fetchUserRaw(uid); if (r.status !== 200 || !r.body) return { ok: false, applied: false, error: "user_fetch_failed" };
    var u = botUserOf(r.body), ev = await botEval(u, uid, true);
    if (ev.level !== "high") return { ok: true, applied: false, score: ev.score, level: ev.level, skip: "条件未達" };
    var base = modBase(a[0]); if (!base) return { ok: false, error: "BANリストURL未設定" };
    var body = { target_uid: String(uid), reason_code: "bot", detail: "[KoeTomo+ 業者自動判定(自動申請) score=" + ev.score + "] " + ev.reasons.join("・"), evidence: JSON.stringify(ev.ev), reporter_uid: String(state.userId), auto: true };
    log(nowStr() + "  [BOTAUTO] apply uid=" + uid + " score=" + ev.score);
    var res = await modPostJson(base + "/api/bl/report", body); botAutoMark(uid);
    res.applied = !!res.ok; res.score = ev.score; res.reasons = ev.reasons; res.name = u.name || ""; return res;
  };
  h.moderation_report_spam = async function(a){
    var base = modBase(a[0]); if (!base) return { ok: false, error: "BANリストURL未設定" };
    if (!state.userId) return { ok: false, error: "ログインが必要です" };
    var t = num(a[1], 0); if (!t) return { ok: false, error: "対象不明" }; if (t === state.userId) return { ok: false, error: "cannot_report_self" };
    var r = await fetchUserRaw(t); if (r.status !== 200 || !r.body) return { ok: false, error: "user_fetch_failed", status: r.status, message: "相手の情報を取得できませんでした" };
    var u = botUserOf(r.body), ev = await botEval(u, t, true);
    if (!ev.level) return { ok: false, error: "not_spam_like", message: ev.hard ? ("業者判定の条件を満たしていません(スコア " + ev.score + ")。通常の通報をご利用ください") : "業者判定の必須条件(量産型アイコン名・フォロー等すべて0・自己紹介なし・年齢確認なし)を満たしていません。通常の通報をご利用ください" };
    var body = { target_uid: String(t), reason_code: "bot", detail: "[KoeTomo+ 業者自動判定 score=" + ev.score + "] " + ev.reasons.join("・"), evidence: JSON.stringify(ev.ev), reporter_uid: String(state.userId) };
    log(nowStr() + "  [MODREPORT] spam target=" + t + " score=" + ev.score);
    var res = await modPostJson(base + "/api/bl/report", body); res.reasons = ev.reasons; res.score = ev.score; return res;
  };

  /* ===================== 規制語ログ(自分の投稿が規制対象になった記録) ===================== */
  var EXPLICIT_KEYS = ["is_explicit", "explicit", "is_regulated", "regulated", "is_nsfw", "nsfw", "is_sensitive", "sensitive", "is_caution", "is_r18", "r18"];
  function recordRegulated(p){
    try {
      var ex = EXPLICIT_KEYS.some(function(k){ return truthy(p[k]); }); if (!ex || p.id == null) return;
      var logArr = jarr("regulated_words_log"); if (logArr.some(function(e){ return e && String(e.post_id) === String(p.id); })) return;
      logArr.push({ post_id: p.id, user_id: p.user_id, text: p.text || "", is_explicit_value: true, detected_at: nowStr() }); jput("regulated_words_log", logArr, 200);
    } catch (e) {}
  }
  h.get_regulated_words = async function(){ return { ok: true, words: jarr("regulated_words_log") }; };

  /* ===================== 結果の後処理: BAN相手の非表示 + 規制語の記録 ===================== */
  var POST_KEYS = ["posts"], USER_KEYS = ["users", "followers", "followees", "mutuals", "friends", "requests", "members", "likers", "receivers", "results", "recommended", "hima", "birthday"];
  var NO_FILTER = { get_block_list: 1, moderation_banlist: 1, view_user_profile: 1, get_my_profile: 1 };
  var origDispatch = window.__koeIos.dispatch;
  window.__koeIos.dispatch = async function(m, args){
    var r = await origDispatch(m, args);
    try {
      if (r && r.ok && !NO_FILTER[m] && Object.keys(banned).length) {
        POST_KEYS.concat(USER_KEYS).forEach(function(k){ if (Array.isArray(r[k])) r[k] = r[k].filter(function(x){ return !(x && isBanned(x.user_id)); }); });
      }
      if (r && r.ok && Array.isArray(r.posts)) r.posts.forEach(recordRegulated);
    } catch (e) {}
    return r;
  };

  /* ===================== コミュニティ(残り) ===================== */
  h.create_community = async function(a){ if (!a[0]) return { ok: false, error: "コミュニティ名を入力してください" }; return okResult(await httpJson("POST", "/api/communities", { name: a[0], description: a[1] || "", category_id: 0, is_open: a[2] == null ? true : !!a[2], image_file_path: "", voice_file_path: "", md5: "" })); };
  h.create_community_comment = async function(a){ return okResult(await request("POST", "/api/communities/" + a[0] + "/posts/" + a[1] + "/comments", { parent_id: "" }, { description: a[2] || "", image_file_path: "", voice_file_path: "", md5: "" })); };
  h.delete_community_comment = async function(a){ if (!a[0] || !a[1] || !a[2]) return { ok: false, error: "パラメータ不明" }; return okResult(await request("DELETE", "/api/communities/" + a[0] + "/posts/" + a[1] + "/comments/" + a[2], null, null)); };
  h.toggle_community_comment_like = async function(a){ if (!a[0] || !a[1] || !a[2]) return { ok: false, error: "パラメータ不明" }; return okResult(await request(a[3] ? "DELETE" : "POST", "/api/communities/" + a[0] + "/posts/" + a[1] + "/comments/" + a[2] + "/liked", null, a[3] ? null : {})); };
  h.get_community_comments = async function(a){
    var r = await request("GET", "/api/communities/" + a[0] + "/posts/" + a[1] + "/comments", { page: "1" }, null);
    if (r.status !== 200 || !r.body) return jsonStatus(r);
    return { ok: true, comments: await namedComments(dataArray(r.body, ["comments", "post_comments"]), ["description", "comment", "text"]) };
  };
  h.get_community_rules = async function(a){
    var r = await request("GET", "/api/communities/" + a[0] + "/rules", null, null);
    if (r.status !== 200 || !r.body) return { ok: false, status: r.status, raw: trunc(r.text, 300) };
    var rules = Array.isArray(r.body.rules) ? r.body.rules : dataArray(r.body, ["rules"]);
    return { ok: true, rules: rules.filter(Boolean).map(function(x){ return { title: firstStr(x, ["title", "name", "heading"]), text: firstStr(x, ["text", "description", "body", "content"]) }; }) };
  };
  h.delete_community_rule = async function(a){ if (!a[0] || !a[1]) return { ok: false, error: "パラメータ不明" }; return okResult(await request("DELETE", "/api/communities/" + a[0] + "/rules/" + a[1], null, null)); };
  h.get_community_join_requests = async function(a){ if (!a[0]) return { ok: false, error: "community_id不明" }; var r = await request("GET", "/api/communities/" + a[0] + "/join-requests", { page: "1" }, null); if (r.status !== 200 || !r.body) return jsonStatus(r); return { ok: true, requests: userListOf(r.body) }; };
  h.cancel_community_join_request = async function(a){ if (!a[0]) return { ok: false, error: "community_id不明" }; return okResult(await request("POST", "/api/communities/" + a[0] + "/join-requests/cancel", null, {})); };
  h.invite_community_member = async function(a){ var r = await request("POST", "/api/communities/" + a[0] + "/invite", { "target_ids[]": a[1] }, {}); return (r.status === 200 || r.status === 201) ? { ok: true } : { ok: false, status: r.status, raw: trunc(r.text, 200) }; };
  h.report_community = async function(a){ if (!a[0]) return { ok: false, error: "community_id不明" }; return okResult(await httpJson("POST", "/api/communities/" + a[0] + "/report", { description: a[1] || "", referer_id: 0 })); };
  h.get_community_bookmarks = async function(a){
    var q = { count: "20" }; if (a[1]) q.max_bookmarked_at = a[1];
    var r = await request("GET", "/api/communities/bookmarks", q, null);
    if (r.status !== 200 || !r.body) return { ok: true, communities: [], unavailable: true, status: r.status };
    var src = dataArray(r.body, ["bookmarks"]);
    return { ok: true, communities: src.filter(Boolean).map(function(c){ var comm = c.community && typeof c.community === "object" ? c.community : c; return { id: comm.id, name: comm.name || "", description: comm.description || "", icon_url: iconUrl(comm.image_file_path || ""), participant_count: num(comm.participant_count, 0) }; }) };
  };
  h.get_community_talk_room_comments = async function(a){
    if (!a[0] || !a[1]) return { ok: false, error: "community_id / room_id 不明" };
    var r = await request("GET", "/api/communities/" + a[0] + "/talk_rooms/" + a[1] + "/comments", { page: "1" }, null);
    if (r.status !== 200 || !r.body) return jsonStatus(r);
    var arr = Array.isArray(r.body.comments) ? r.body.comments : dataArray(r.body, ["comments"]);
    return { ok: true, comments: await namedComments(arr, ["comment", "text", "description", "body"]) };
  };
  h.change_community_talk_room_role = async function(a){ if (!a[0] || !a[1]) return { ok: false, error: "community_id / room_id 不明" }; return okResult(await request("PUT", "/api/communities/" + a[0] + "/talk_rooms/" + a[1] + "/change_role", { role: a[3], target_id: a[2] }, null)); };
  h.kick_community_talk_room_user = async function(a){ if (!a[0] || !a[1] || !a[2]) return { ok: false, error: "パラメータ不明" }; return okResult(await request("POST", "/api/communities/" + a[0] + "/talk_rooms/" + a[1] + "/kick", { target_id: a[2] }, null)); };
  h.switch_community_talk_room_comment_enabled = async function(a){ if (!a[0] || !a[1]) return { ok: false, error: "community_id / room_id 不明" }; return okResult(await httpJson("PUT", "/api/communities/" + a[0] + "/talk_rooms/" + a[1] + "/switch_comment_enabled", { comment_enabled: a[2] == null ? true : !!a[2] })); };
  h.get_participating_community_talk_rooms = async function(){
    var r = await request("GET", "/api/communities/participating_talk_rooms", { page: "1", order: "1" }, null);
    if (r.status !== 200 || !r.body) return { ok: true, talk_rooms: [], unavailable: true, status: r.status };
    var rooms = dataArray(r.body, ["talk_rooms", "rooms"]);
    try { await resolveNames(rooms.map(function(x){ return Number(x.owner || x.owner_user_id || 0); })); } catch (e) {}
    return { ok: true, talk_rooms: rooms.filter(Boolean).map(function(x){ var owner = Number(x.owner || x.owner_user_id || 0); var sp = Array.isArray(x.speakers) ? x.speakers.length : 0, li = Array.isArray(x.listeners) ? x.listeners.length : 0; var c = x.community && typeof x.community === "object" ? x.community : null; return { id: x.id, community_id: c ? c.id : x.community_id, community_name: c ? (c.name || "") : (x.community_name || ""), owner_user_id: owner, owner_name: nameOf(owner), owner_icon: iconOf(owner), title: x.description || x.title || "", speaker_count: sp, listener_count: li, member_count: sp + li }; }) };
  };

  /* ===================== 投稿・ユーザー(残り) ===================== */
  h.get_feed_post_liked_users = async function(a){ if (!a[0]) return { ok: false, error: "feed_post_id不明" }; var r = await httpApi2("GET", "/api/feed_posts/" + a[0] + "/liked_users", { page: "1" }); log(nowStr() + "  [LIKERS] feed_post " + a[0] + " HTTP " + r.status); if (r.status !== 200 || !r.body) return jsonStatus(r); return { ok: true, users: userListOf(r.body) }; };
  h.inspect_feed_post = async function(a){ if (!a[0]) return { ok: false, error: "feed_post_id不明" }; var r = await http("GET", BASE2 + "/api/feed_posts/" + a[0], legacyFields(), null); return { ok: r.status === 200, status: r.status, body: r.body || null }; };
  h.resolve_users = async function(a){ if (!a[0]) return { ok: true, users: [] }; var r = await request("GET", "/api/v2/users", { ids: a[0] }, null); var arr = (r.body && (r.body.user_info || (r.body.data && r.body.data.user_info))) || []; return { ok: true, users: arr.filter(Boolean).map(function(u){ return { user_id: Number(u.user_id || u.id || 0), name: u.name || "", icon_url: iconUrl(u.profile_picture_file_path || "") }; }) }; };
  h.get_icon_base = async function(){ await ensureDefines(); return { ok: true, base: iconUrl("x").slice(0, -1) }; };
  h.get_announcements = async function(){
    var r = await request("GET", "/api/room_announcements", null, null); if (r.status !== 200 || !r.body) return jsonStatus(r);
    var arr = dataArray(r.body, ["room_announcements", "announcements"]);
    var rows = await namedComments(arr, ["description"]);
    rows.forEach(function(o, i){ var src = arr[i] || {}; o.description = o.text; delete o.text; o.open_at = firstStr(src, ["open_at", "openAt"]); });
    return { ok: true, announcements: rows };
  };
  h.get_system_info = async function(a){ var r = await request("POST", "/api/system/info", null, { par: a[0] || "0", page: a[1] || "1" }); log(nowStr() + "  [SYSINFO] -> " + r.status); return okList(r, "info", ["info", "infos", "system_info", "notices", "data"]); };
  h.get_subscription_introduction_schedules = async function(){ var r = await request("GET", "/api/subscription_introduction_schedules", null, null); if (r.status !== 200 || !r.body) return jsonStatus(r); return { ok: true, schedules: dataArray(r.body, ["subscription_introduction_schedules"]) }; };
  h.get_trial_listenings = async function(){ var r = await request("GET", "/api/trial_listenings/", null, null); if (r.status !== 200 || !r.body) return { ok: true, trial_listenings: [], unavailable: true, status: r.status }; return { ok: true, trial_listenings: dataArray(r.body, ["trial_listenings"]) }; };
  h.get_voice_profiles = async function(){ var r = await request("GET", "/api/v2/voice_profiles", null, null); if (r.status !== 200 || !r.body) r = await request("GET", "/api/voice_profiles", null, null); if (r.status !== 200 || !r.body) return { ok: true, voice_profiles: [], unavailable: true, status: r.status }; return { ok: true, voice_profiles: dataArray(r.body, ["voice_profiles"]) }; };
  /* 公式オファーウォール(Skyflag)の入口 URL。Android 版 getSkyflagOfferWallUrl と同じ */
  h.get_skyflag_offer_wall_url = async function(){
    var r = await request("GET", "/api/skyflag/ow_url", null, null);
    if (r.status !== 200 || !r.body) return { ok: false, status: r.status };
    var url = r.body.url || r.body.ow_url || r.body.offer_wall_url || "";
    return { ok: !!url, url: url };
  };
  h.room_join_trial = async function(a){ var q = {}; if (a[0]) q.room_id = a[0]; return okResult(await request("POST", "/api/rooms/join_trial", q, {})); };
  h.set_display_badge = async function(a){ var path = "/api/users/" + state.userId + "/display-badge"; if (!a[0]) return okResult(await request("DELETE", path, null, null)); var id = num(a[0], NaN); return okResult(await httpJson("PUT", path, { badge_id: isNaN(id) ? a[0] : id })); };
  h.bulk_delete_chats = async function(a){
    var ids = String(a[0] || "").split(",").map(function(s){ return s.trim(); }).filter(Boolean).map(function(s){ var n = Number(s); return isNaN(n) ? s : n; });
    if (!ids.length) return { ok: false, error: "有効なchat_idがありません" };
    async function chatIds(){ try { var r = await K.handlers.get_chats([]); return ((r && r.chats) || []).map(function(c){ return String(c.chatId || c.chat_id || c.id); }); } catch (e) { return []; } }
    var before = await chatIds();
    var body = { chat_ids: ids, uid: state.userId, auth_token: state.token || "", version: "android_" + APP_VERSION };
    var r = await http("POST", BASE + "/api/chat/chats_bulk_delete", null, null, { json: body });
    if (r.status < 200 || r.status >= 300) r = await http("POST", BASE2 + "/api/chat/chats_bulk_delete", null, null, { json: body });
    var after = await chatIds(); var gone = ids.filter(function(id){ return before.indexOf(String(id)) >= 0 && after.indexOf(String(id)) < 0; }).length;
    log(nowStr() + "  [CHAT-DEL] gone=" + gone + "/" + ids.length + " HTTP " + r.status);
    return gone > 0 ? { ok: true, deleted: gone } : { ok: false, status: r.status, message: "サーバーが会話の削除を受け付けませんでした" + (r.status > 0 ? " (HTTP " + r.status + ")" : "") };
  };
  h.server_logout = async function(){ var r = await request("POST", "/api/account/logout", null, {}); log(nowStr() + "  [LOGOUT] -> " + r.status); return okResult(r, true); };
  h.withdraw_account = async function(a){
    var f = legacyFields({ reason: a[0] || "", uid: String(state.userId) });
    var r = await http("POST", BASE + "/api/account/withdrawal", null, f); if (r.status === 404 || r.status >= 500) r = await http("POST", BASE2 + "/api/account/withdrawal", null, f);
    if (r.status < 200 || r.status >= 300) return { ok: false, status: r.status, raw: trunc(r.text, 300) };
    try { await K.handlers.logout([]); } catch (e) {} return { ok: true };
  };

  /* ===================== アンケート・キャンペーン・録音 ===================== */
  h.get_enquetes = async function(){ var r = await request("GET", "/api/enquetes", null, null); if (r.status !== 200 || !r.body) return jsonStatus(r); return { ok: true, enquetes: dataArray(r.body, ["enquetes"]) }; };
  h.get_enquete_questions = async function(a){ if (!a[0]) return { ok: false, error: "enquete_id不明" }; var r = await request("GET", "/api/enquete_questions", { enquete_id: a[0] }, null); if (r.status !== 200 || !r.body) return jsonStatus(r); return { ok: true, questions: dataArray(r.body, ["enquete_questions"]) }; };
  h.answer_enquete = async function(a){ if (!a[0]) return { ok: false, error: "enquete_id不明" }; var f = { enquete_id: a[0] }; if (a[1]) f.question_id = a[1]; if (a[2] != null) f.answer = a[2]; return okResult(await request("POST", "/api/enquete_answer", null, f)); };
  h.send_enquete_answer_v2 = async function(a){ var body = {}; try { body = a[0] ? JSON.parse(a[0]) : {}; } catch (e) { return { ok: false, error: "JSON不正" }; } var r = await httpJsonApi2("POST", "/api/enquete_answer", body); log(nowStr() + "  [ENQUETE] answer -> " + r.status); return okResult(r); };
  h.track_enquete = async function(a){ var q = {}; if (a[0]) q.enquete_id = a[0]; if (a[1]) q.is_complete = a[1]; var r = await request("POST", "/api/enquete_tracking", q, {}); return okResult(r); };
  h.get_user_campaigns = async function(){ var r = await request("GET", "/api/user_campaigns/", null, null); if (r.status !== 200 || !r.body) return jsonStatus(r); return { ok: true, user_campaigns: dataArray(r.body, ["user_campaigns"]) }; };
  h.join_campaign = async function(a){ if (!a[0]) return { ok: false, error: "campaign_id不明" }; return okResult(await request("GET", "/api/campaigns/" + a[0] + "/user_campaign", null, null)); };
  h.recover_user_campaign = async function(a){ if (!a[0]) return { ok: false, error: "campaign_id不明" }; return okResult(await request("POST", "/api/campaigns/" + a[0] + "/user_campaign/recovery", null, {})); };
  h.mark_user_campaign_as_read = async function(a){ if (!a[0]) return { ok: false, error: "campaign_id不明" }; return okResult(await request("PUT", "/api/user_campaigns/" + a[0] + "/mark_as_read", null, {})); };
  h.get_campaign_challenge_progress = async function(a){ if (!a[0] || !a[1]) return { ok: false, error: "パラメータ不明" }; var r = await request("GET", "/api/user_campaigns/" + a[0] + "/challenges/" + a[1] + "/progress", null, null); if (r.status !== 200 || !r.body) return jsonStatus(r); return { ok: true, progress: r.body }; };
  h.get_talk_recording_agreements = async function(){ var r = await request("GET", "/api/talk_recording_agreements", null, null); if (r.status !== 200 || !r.body) return jsonStatus(r); return { ok: true, data: r.body }; };
  h.agree_talk_recording = async function(){ return okResult(await httpJson("POST", "/api/talk_recording_agreements", { terms_agreed: true, agreement_text: "", promotional_banner_image: null })); };
  h.check_recording_disabled_users = async function(a){ var ids = String(a[0] || "").split(",").map(function(s){ return s.trim(); }).filter(Boolean).map(function(s){ var n = Number(s); return isNaN(n) ? s : n; }); if (!ids.length) return { ok: false, error: "user_ids不明" }; return okResult(await httpJson("POST", "/api/recording_disabled_users/check", { user_ids: ids })); };
  h.recording_channel = async function(a){
    var ch = a[1]; if (!ch) return { ok: false, error: "channel不明" };
    await ensureDefines(); var host = ""; try { host = state.clientDefines.client_system_params.skyway.auth_token_endpoint_server || ""; } catch (e) {} if (host && host.indexOf("http") !== 0) host = "https://" + host; host = host || "https://skyway-auth.meetscom.com";
    var act = a[0], method = "POST", url = host + "/channels/" + ch + "/join";
    if (act === "start") url = host + "/channels/" + ch + "/start"; else if (act === "stop") { url = host + "/channels/" + ch + "/stop"; method = "DELETE"; } else if (act === "token") { url = host + "/channels/" + ch + "/token"; method = "GET"; }
    var r = await http(method, url, null, method === "GET" ? null : {}); log(nowStr() + "  [REC] " + act + " -> " + r.status);
    var o = { ok: r.status >= 200 && r.status < 300, status: r.status }; if (r.body) o.body = r.body; return o;
  };
  h.get_record_comments = async function(a){
    var q = legacyFields({ page: "1" }); var r = await http("GET", BASE2 + "/api/call_records/" + a[0] + "/comments", q, null); if (r.status === 404 || r.status >= 500) r = await http("GET", BASE + "/api/call_records/" + a[0] + "/comments", q, null);
    if (r.status !== 200 || !r.body) return { ok: false, status: r.status, raw: trunc(r.text, 300) };
    var arr = dataArray(r.body, ["comments", "call_record_comments", "data"]);
    var rows = arr.filter(Boolean).map(function(c){ var uid = Number(c.user_id || (c.user && c.user.id) || 0); return { user_id: uid, text: firstNonEmpty(c.text, c.comment), created_at: c.created_at || "" }; });
    try { await resolveNames(rows.map(function(x){ return x.user_id; })); } catch (e) {} rows.forEach(function(x){ x.name = nameOf(x.user_id); x.icon_url = iconOf(x.user_id); });
    return { ok: true, comments: rows };
  };
  h.post_record_comment = async function(a){ var f = legacyFields({ text: a[1] || "" }); var p = "/api/call_records/" + a[0] + "/comments"; var r = await http("POST", BASE2 + p, null, f); if (r.status === 404 || r.status >= 500) r = await http("POST", BASE + p, null, f); return okResult(r); };
  h.toggle_record_like = async function(a){ var f = legacyFields(); var p = "/api/call_records/" + a[0] + "/like"; var m = a[1] ? "DELETE" : "POST"; var r = await http(m, BASE2 + p, null, f); if (r.status === 404 || r.status >= 500) r = await http(m, BASE + p, null, f); return okResult(r); };

  /* ===================== ソーシャルログイン ===================== */
  async function loginBase(){ var saved = pref("login_base"); if (saved) return saved; var base = BASE; try { var r = await http("GET", BASE + "/config/release/" + APP_VERSION + ".json", null, null, { sendAuth: false }); var m = /"(?:api_domain|domain|api_server|server)"\s*:\s*"([^"]+)"/.exec(r.text || ""); if (m) { base = m[1].indexOf("http") === 0 ? m[1] : "https://" + m[1]; base = base.replace(/\/$/, ""); } } catch (e) {} pref("login_base", base); return base; }
  async function applyLogin(r, notFoundMsg){
    var raw = r.text ? trunc(r.text, 500) : "(応答ボディなし HTTP " + r.status + ")";
    if (r.status !== 200 || !r.body) return { ok: false, status: r.status, message: extractError(r.body) || ("ログインに失敗しました(HTTP " + r.status + ")"), raw: raw };
    var d = r.body.data && typeof r.body.data === "object" ? r.body.data : {};
    if (!d.auth_token) return { ok: false, status: r.status, message: extractError(r.body) || notFoundMsg, raw: raw };
    await K._setToken(d.auth_token); K._setUser(d.user_id, d.name);
    try { var bd = d.birthday || (d.user && d.user.birthday) || ""; if (bd) pref("birthday", bd); } catch (e) {}
    return { ok: true, user_name: state.userName, user_id: state.userId, raw: raw };
  }
  async function socialIdLogin(field, id){
    id = String(id || "").trim(); if (!id) return { ok: false, error: (field === "line_id" ? "LINE ID" : "Facebook ID") + "を入力してください" };
    var f = {}; f[field] = id; f.device_uid = K.deviceUid ? K.deviceUid() : (pref("device_uid") || ""); f.feature = FEATURE; f.version = "android_" + APP_VERSION;
    var r = await http("POST", (await loginBase()) + "/api/account/login", null, f, { sendAuth: false });
    return await applyLogin(r, "この" + (field === "line_id" ? "LINE" : "Facebook") + "アカウントに紐づく声ともアカウントが見つかりませんでした");
  }
  h.line_login = async function(a){ return await socialIdLogin("line_id", a[0]); };
  h.facebook_login = async function(a){ return await socialIdLogin("facebook_id", a[0]); };
  h.check_twitter_exist = async function(a){ if (!a[0]) return { ok: false, error: "twitter_id不明" }; return okResult(await request("POST", "/api/account/twitter_exist", null, { twitter_id: a[0] })); };
  h.check_line_exist = async function(a){ if (!a[0]) return { ok: false, error: "line_id不明" }; return okResult(await request("POST", "/api/account/line_exist", null, { line_id: a[0] })); };
  h.check_facebook_exist = async function(a){ if (!a[0]) return { ok: false, error: "facebook_id不明" }; return okResult(await request("POST", "/api/account/facebook_exist", null, { facebook_id: a[0] })); };
  h.twitter_login = async function(a){
    var twitterId = a[0], accessToken = a[1]; if (!twitterId) return { ok: false, error: "twitter_id不明" }; if (!accessToken) return { ok: false, error: "Xのアクセストークンが取得できませんでした" };
    try {
      var er = await http("POST", BASE + "/api/account/twitter_exist", null, { twitter_id: twitterId, version: "android_" + APP_VERSION }, { sendAuth: false });
      if (er.status >= 200 && er.status < 300 && er.body) { var st = er.body.twitter_exist || (er.body.data && er.body.data.twitter_exist) || ""; if (st && st !== "exist") return { ok: false, message: "このXアカウントは声ともに登録されていません。公式アプリでXアカウントを使って登録してからお試しください", raw: trunc(er.text, 300) }; }
    } catch (e) {}
    var enc = await native("__koe_encrypt", [accessToken]);
    if (!enc || !enc.ok) return { ok: false, error: (enc && enc.error) || "トークンの暗号化に失敗しました" };
    var f = { twitter_id: twitterId, etat: enc.etat, vt: enc.vt, gt: enc.gt, device_uid: K.deviceUid ? K.deviceUid() : (pref("device_uid") || ""), feature: FEATURE, version: "android_" + APP_VERSION };
    var r = await http("POST", (await loginBase()) + "/api/v2/account/login", null, f, { sendAuth: false });
    return await applyLogin(r, "このXアカウントに紐づく声ともアカウントが見つかりませんでした");
  };

  /* ===================== 通話録音(トークレコード) ===================== */
  async function parseRecords(r){
    if (r.status !== 200 || !r.body) return { ok: false, status: r.status, raw: trunc(r.text, 1200) };
    var arr = dataArray(r.body, ["call_records", "records", "data"]);
    var rows = arr.filter(function(x){ return x && typeof x === "object"; }).map(function(x){
      var caller = Number(x.caller_id || 0), callee = Number(x.callee_id || 0); var uid = callee || caller; var other = (uid === callee) ? caller : callee;
      if (!uid) uid = Number(x.user_id || (x.user && x.user.id) || 0);
      return { id: x.id, user_id: uid, other_id: other, voice_url: K.voiceUrl(firstNonEmpty(x.file_path, x.voice_file_path, x.sound_file_url, x.record_url, x.audio_url, x.url)), text: firstNonEmpty(x.callee_description, x.caller_description, x.description, x.comment), likes: num(x.liked_count != null ? x.liked_count : (x.good_count != null ? x.good_count : x.liked_user_count), 0), comments: num(x.comment_count, 0), liked: !!(x.liked || x.is_liked), created_at: firstNonEmpty(x.talked_at, x.created_at), play_time: num(x.call_duration != null ? x.call_duration : x.play_time, 0), play_count: num(x.play_count, 0) };
    });
    try { await resolveNames(rows.map(function(x){ return x.user_id; }).concat(rows.map(function(x){ return x.other_id; })).filter(Boolean)); } catch (e) {}
    rows.forEach(function(x){ x.name = nameOf(x.user_id); x.icon_url = iconOf(x.user_id); if (x.other_id) x.other_name = nameOf(x.other_id); });
    return { ok: true, records: rows };
  }
  h.get_call_records = async function(){ var q = legacyFields(); var r = await http("GET", BASE2 + "/api/call_records/others", q, null); if (r.status === 404 || r.status >= 500) r = await http("GET", BASE + "/api/call_records/others", q, null); return await parseRecords(r); };
  h.get_my_call_records = async function(){ var q = legacyFields(); var r = await http("GET", BASE + "/api/call_records", q, null); if (r.status === 404 || r.status >= 500) r = await http("GET", BASE2 + "/api/call_records", q, null); return await parseRecords(r); };

  window.__koeIos.extend(h);
})();
