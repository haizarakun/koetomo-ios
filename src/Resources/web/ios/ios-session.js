/* iOS 版セッション層 (Android の KoeSession.java の JS 移植・第1段階)
   HTTP はネイティブ(__http)に中継させ、API の組み立て・応答の正規化はここで行う。
   未移植のコマンドは {ok:false, error:"not_ported"} を返す(画面側が「未対応」と表示する)。 */
(function(){
  var APP_VERSION = "3.9.101";
  var UA = "okhttp/4.12.0";
  var BASE = "https://api.meetscom.com";
  var BASE2 = "https://api2.meetscom.com";
  var PNG_FALLBACK = "https://d34we8vh702akg.cloudfront.net/";
  var FEATURE = "skwmeshroom,firebase,mail_auth,reset_status,chat_pagination,speaker_applicant,p2p_room,skyway,talk_recording";

  var state = { token: null, userId: 0, userName: "", loaded: false, pngServer: null, clientDefines: null, hostCache: {}, nameCache: {} };
  var native = function(m, a){ return window.__koeNative(m, a); };
  function log(s){ try { native("__log", [s]); } catch (e) {} }
  function nowStr(){ var d = new Date(); return d.toTimeString().slice(0, 8); }
  function pref(k, v){ try { if (v === undefined) return localStorage.getItem("koe_ios_" + k); if (v === null) localStorage.removeItem("koe_ios_" + k); else localStorage.setItem("koe_ios_" + k, String(v)); } catch (e) { return null; } }

  async function ensureLoaded(){
    if (state.loaded) return;
    try { var r = await native("__kv_get", ["auth_token"]); state.token = (r && r.value) ? r.value : null; } catch (e) { state.token = null; }
    state.userId = Number(pref("user_id") || 0);
    state.userName = pref("user_name") || "";
    try { var nc = JSON.parse(pref("name_cache") || "{}"); if (nc && typeof nc === "object") state.nameCache = nc; } catch (e) {}
    state.loaded = true;
  }
  async function setToken(t){ state.token = t || null; await native("__kv_set", ["auth_token", t || ""]); }
  function setUser(id, name){ if (id) { state.userId = Number(id); pref("user_id", state.userId); } if (name) { state.userName = name; pref("user_name", name); } }
  var nameSaveTimer = null;
  function saveNameCache(){ clearTimeout(nameSaveTimer); nameSaveTimer = setTimeout(function(){ try { var keys = Object.keys(state.nameCache); if (keys.length > 800) keys.slice(0, keys.length - 800).forEach(function(k){ delete state.nameCache[k]; }); pref("name_cache", JSON.stringify(state.nameCache)); } catch (e) {} }, 3000); }

  function enc(s){ return encodeURIComponent(String(s == null ? "" : s)); }
  function qs(obj){ var out = []; Object.keys(obj || {}).forEach(function(k){ var v = obj[k]; if (v === undefined || v === null) return; out.push(enc(k) + "=" + enc(v)); }); return out.join("&"); }
  function deviceUid(){ var d = pref("device_uid"); if (!d) { d = ""; var h = "0123456789abcdef"; for (var i = 0; i < 16; i++) d += h[Math.floor(Math.random() * 16)]; pref("device_uid", d); } return d; }

  /* Java の http(): クエリ・フォーム・ヘッダ(UA / X-App-Version / X-Auth-Token / Accept) */
  async function http(method, url, query, fields, opts){
    opts = opts || {};
    var u = url;
    var q = qs(query);
    if (q) u += (u.indexOf("?") >= 0 ? "&" : "?") + q;
    var headers = { "User-Agent": UA, "Accept": "application/json" };
    var sendAuth = opts.sendAuth !== false;
    if (sendAuth) { headers["X-App-Version"] = "android_" + APP_VERSION; if (state.token) headers["X-Auth-Token"] = state.token; }
    var body = null;
    if (opts.json) { headers["Content-Type"] = "application/json; charset=utf-8"; body = JSON.stringify(opts.json); }
    else if (fields && Object.keys(fields).length) { headers["Content-Type"] = "application/x-www-form-urlencoded; charset=utf-8"; body = qs(fields); }
    else if (method === "POST" || method === "PUT") { headers["Content-Type"] = "application/x-www-form-urlencoded; charset=utf-8"; body = ""; }
    var r = await native("__http", [{ method: method, url: u, headers: headers, body: body, timeout: opts.timeout || 35000 }]);
    var parsed = null;
    if (r && typeof r.body === "string" && r.body.length) { try { parsed = JSON.parse(r.body); } catch (e) { parsed = null; } }
    var vsns = -999;
    try { var vh = r.headers && (r.headers["x-vsns-status"]); if (vh != null && vh !== "") vsns = parseInt(vh, 10); } catch (e) {}
    return { status: (r && r.status) || 0, body: parsed, text: r && r.body, vsns: vsns, error: r && r.error, sessionExpired: (r && r.status === 401) };
  }
  /* Java の request(): version/auth_token をクエリに足し、api → api2 の順に試す(200 したホストを覚える) */
  async function request(method, path, query, fields){
    var q = {}; Object.keys(query || {}).forEach(function(k){ var v = query[k]; if (v !== undefined && v !== null && String(v).length) q[k] = v; });
    if (!("version" in q)) q.version = (path.indexOf("/api/cheering_talk/") === 0) ? ("android_" + APP_VERSION) : APP_VERSION;
    if (state.token && !("auth_token" in q)) q.auth_token = state.token;
    var ck = method + " " + path.replace(/\/\d+/g, "/{n}");
    var hosts = []; [state.hostCache[ck] || BASE, BASE2, BASE].forEach(function(h){ if (hosts.indexOf(h) < 0) hosts.push(h); });
    var last = { status: 0, body: null };
    for (var i = 0; i < hosts.length; i++) {
      var r = await http(method, hosts[i] + path, q, fields);
      if (r.status === 200) { state.hostCache[ck] = hosts[i]; return r; }
      last = r;
      if (r.status >= 400 && r.status < 500 && r.status !== 404) return r;
    }
    return last;
  }
  /* Java の request2(): api2 固定・version=android_ */
  async function request2(method, path, query, fields){
    var q = {}; Object.keys(query || {}).forEach(function(k){ var v = query[k]; if (v !== undefined && v !== null && String(v).length) q[k] = v; });
    if (!("version" in q)) q.version = "android_" + APP_VERSION;
    if (state.token && !("auth_token" in q)) q.auth_token = state.token;
    var r = await http(method, BASE2 + path, q, fields);
    if (r.status >= 200 && r.status < 300) return r;
    if (r.status >= 400 && r.status < 500) return r;
    return await http(method, BASE + path, q, fields);
  }
  function okResult(r, statusOnly){ var ok = r.status >= 200 && r.status < 300 && (statusOnly || r.vsns === -999 || r.vsns === 0); var o = { ok: ok, status: r.status, vsns: r.vsns }; if (r.sessionExpired) o.session_expired = true; if (r.body) o.body = r.body; return o; }
  function jsonStatus(r){ return { ok: false, status: r.status, raw: r.text ? String(r.text).slice(0, 300) : "" }; }
  function extractError(b){ if (!b || typeof b !== "object") return null; var c = [b.displayable_detail, b.message, b.error, b.detail, b.data && b.data.message, b.errors && b.errors[0] && (b.errors[0].message || b.errors[0])]; for (var i = 0; i < c.length; i++) if (typeof c[i] === "string" && c[i]) return c[i]; return null; }

  /* 公開設定(画像/音声サーバー名) */
  async function ensureDefines(){
    if (state.clientDefines) return;
    try { var cached = JSON.parse(pref("client_defines") || "null"); var ts = Number(pref("client_defines_ts") || 0); if (cached && Date.now() - ts < 6 * 3600 * 1000) { state.clientDefines = cached; } } catch (e) {}
    if (state.clientDefines) return;
    try {
      var r = await http("GET", BASE + "/config/release/" + APP_VERSION + ".json", null, null, { sendAuth: false });
      var url = r.body && r.body.data && r.body.data.client_defines && r.body.data.client_defines.url;
      if (url) { var r2 = await http("GET", url, null, null, { sendAuth: false }); var d = (r2.body && r2.body.data) || r2.body; if (d) { state.clientDefines = d; pref("client_defines", JSON.stringify(d)); pref("client_defines_ts", Date.now()); } }
    } catch (e) {}
  }
  function pngServer(){
    if (state.pngServer) return state.pngServer;
    var s = ""; try { s = state.clientDefines.client_system_params.server_name.png || ""; } catch (e) {}
    if (s) { if (s.indexOf("http") !== 0) s = "https://" + s; if (s.slice(-1) !== "/") s += "/"; state.pngServer = s; }
    return state.pngServer || PNG_FALLBACK;
  }
  function iconUrl(p){ return p ? pngServer() + p : ""; }
  function voiceUrl(p){
    if (!p) return ""; if (p.indexOf("http") === 0) return p;
    var path = "audio"; try { var sn = state.clientDefines.client_system_params.server_name; var a = sn.audio_download || sn.audio_upload; if (a && a.path) path = a.path; } catch (e) {}
    var base = pngServer(); try { var m = base.match(/^(https?:\/\/[^\/]+\/)/); if (m) base = m[1]; } catch (e) {}
    return base + path.replace(/^\/+|\/+$/g, "") + "/" + p.replace(/^\/+/, "");
  }

  /* ユーザー名解決(v2/users?ids=) */
  async function resolveNames(ids){
    var need = []; ids.forEach(function(id){ id = Number(id); if (id && !(state.nameCache[id] && state.nameCache[id][0]) && need.indexOf(id) < 0) need.push(id); });
    if (!need.length) return;
    var r = await request("GET", "/api/v2/users", { ids: need.join(",") });
    var arr = (r.body && (r.body.user_info || (r.body.data && r.body.data.user_info))) || [];
    var changed = false;
    arr.forEach(function(u){ var id = Number(u.user_id || u.id); var nm = u.name || u.nickname || ""; if (id && nm) { state.nameCache[id] = [nm, u.profile_picture_file_path || ""]; changed = true; } });
    if (changed) saveNameCache();
  }
  function nameOf(id){ var e = state.nameCache[Number(id)]; return e && e[0] ? e[0] : ("user " + id); }
  function iconOf(id){ var e = state.nameCache[Number(id)]; return e ? iconUrl(e[1]) : ""; }

  function firstArray(o, keys){ if (!o) return null; for (var i = 0; i < keys.length; i++) if (Array.isArray(o[keys[i]])) return o[keys[i]]; return null; }
  function firstNonEmpty(){ for (var i = 0; i < arguments.length; i++) if (arguments[i]) return arguments[i]; return ""; }

  /* 投稿の正規化(Java normalizePosts と同じ出力形) */
  async function normalizePosts(arr, isTalk){
    await ensureDefines();
    await resolveNames(arr.map(function(p){ return p.user_id; }));
    var out = [];
    arr.forEach(function(p){
      var text = firstNonEmpty(p.description, p.comment, p.text, p.body, p.message, p.content);
      var img = p.image_file_path || "", voi = p.voice_file_path || "";
      var hasPurpose = p.purpose !== undefined && p.purpose !== null;
      var voicey = (p.play_time != null) || (p.play_count != null);
      if (!text && !img && !voi && !hasPurpose) return; // 中身の無い投稿は表示しない(Android 版と同じ)
      var o = {
        id: p.id, user_id: p.user_id, name: nameOf(p.user_id), icon_url: iconOf(p.user_id),
        text: text, image_url: iconUrl(img), voice_url: voiceUrl(voi), created_at: p.created_at || "",
        likes: p.good_count != null ? p.good_count : (p.liked_user_count != null ? p.liked_user_count : (p.likes_count || 0)),
        comments: p.comment_count || 0,
        liked: !!(p.liked || p.is_liked || p.is_good), bookmarked: !!p.bookmarked,
        is_explicit: !!(p.is_explicit || p.explicit), is_talk: !!(isTalk || hasPurpose)
      };
      if (hasPurpose) o.purpose = p.purpose;
      if (p.topic != null) o.topic = p.topic;
      if (p.play_time != null) o.play_time = p.play_time;
      if (voicey) o.has_voice = true;
      out.push(o);
    });
    return out;
  }
  async function postsResult(r, key, isTalk){
    if (r.status !== 200 || !r.body) return { ok: false, status: r.status };
    var keys = [key, "timeline_posts", "following_posts", "friend_posts", "feed_posts", "posts", "bookmark_posts"];
    var arr = firstArray(r.body, keys) || (r.body.data && (firstArray(r.body.data, keys) || (Array.isArray(r.body.data.data) ? r.body.data.data : null))) || [];
    var posts = await normalizePosts(arr, isTalk);
    var bm = {}; ["bookmark_ids", "feed_bookmark_ids", "timeline_bookmark_ids"].forEach(function(k){ var a = (r.body[k]) || (r.body.data && r.body.data[k]); if (Array.isArray(a)) a.forEach(function(id){ bm[id] = 1; }); });
    var liked = {}; var la = r.body.liked_ids || (r.body.data && r.body.data.liked_ids); if (Array.isArray(la)) la.forEach(function(id){ liked[id] = 1; });
    posts.forEach(function(p){ if (bm[p.id]) p.bookmarked = true; if (liked[p.id]) p.liked = true; });
    var next = r.body.next_max_id || (r.body.data && r.body.data.next_max_id) || "";
    if (!next && posts.length) { var lastP = arr[arr.length - 1]; next = lastP && lastP.id ? String(lastP.id) : ""; }
    return { ok: true, posts: posts, next_max_id: next ? String(next) : "" };
  }

  /* プロフィール(v2/users + v3/users) */
  async function buildProfile(uid){
    await ensureDefines();
    var r1 = await request("GET", "/api/v2/users", { ids: String(uid) });
    var u1 = (r1.body && r1.body.user_info && r1.body.user_info[0]) || {};
    var r2 = await request("GET", "/api/v3/users/" + uid, { fields: "core,chat,friend,follow,block" });
    var d = (r2.body && r2.body.data) || r2.body || {};
    var u = d.user_info || d.userInfo || d;
    var name = u.name || u1.name || "";
    if (name && uid) { state.nameCache[uid] = [name, u.profile_picture_file_path || u1.profile_picture_file_path || ""]; saveNameCache(); }
    var p = {
      user_id: Number(uid), name: name, comment: u.comment || "", icon_url: iconUrl(u.profile_picture_file_path || u1.profile_picture_file_path || ""),
      header_url: "", follower_count: u.follower_count || 0, followee_count: u.followee_count || 0, friend_count: u.friend_count || 0,
      liked_count: u.liked_count || 0, sex: u.sex, age: u.age, birthday: u.birthday || "", login_status: u.login_status_with_unit || "",
      is_follower: !!u.is_follower, is_followee: !!u.is_followee, is_friend_requester: !!u.is_friend_requester, is_friend_requestee: !!u.is_friend_requestee,
      is_blocked: !!u.is_blocked, is_friend: !!u.is_friend, settings: u.settings || {}, profile_voice_url: voiceUrl(u.profile_voice_file_path || "")
    };
    return { ok: r2.status === 200 || r1.status === 200, profile: p, raw: "v3 HTTP " + r2.status };
  }

  /* 通知 */
  var notifCache = { t: 0, res: null };
  async function getNotifications(kind, page){
    var important = kind === "important";
    var path = important ? "/api/user_notifications" : "/api/regular_notifications";
    var r = await http("GET", BASE2 + path, { no_user_info: "true", page: page || "1", auth_token: state.token, version: "android_" + APP_VERSION });
    if (r.status !== 200 || !r.body) return jsonStatus(r);
    var arr = firstArray(r.body, ["notifications", "user_notifications", "regular_notifications"]) || (r.body.data && firstArray(r.body.data, ["notifications", "user_notifications", "regular_notifications"])) || [];
    var ids = []; arr.forEach(function(n){ var id = n.user_id || n.liked_user_id || (n.user && (n.user.user_id || n.user.id)); if (id) ids.push(id); });
    await resolveNames(ids);
    await ensureDefines();
    var out = arr.map(function(n){
      var uid = n.user_id || n.liked_user_id || (n.user && (n.user.user_id || n.user.id)) || 0;
      var t = Number(n.message_type != null ? n.message_type : n.type);
      var msg = n.message || (t === 1 ? "さんがあなたの投稿にいいねしました" : t === 0 ? "さんがあなたの投稿に返信しました" : "");
      return { id: n.id, type: t, user_id: uid, name: nameOf(uid), icon_url: iconOf(uid), message: msg, created_at: n.created_at || "", feed_post_id: n.feed_post_id || n.post_id || 0, comment_id: n.feed_post_comment_id || 0, room_id: n.room_id || 0, community_id: n.community_id || 0 };
    });
    return { ok: true, notifications: out, has_more: out.length >= 20 };
  }

  var handlers = {
    is_logged_in: async function(){ return { ok: true, logged_in: !!state.token, user_id: state.userId, user_name: state.userName }; },
    export_token: async function(){ return { ok: !!state.token, token: state.token || "", user_id: state.userId }; },
    login: async function(a){
      var f = { email: a[0], password: a[1], device_uid: deviceUid(), feature: FEATURE, version: "android_" + APP_VERSION };
      var r = await http("POST", BASE + "/api/account/login", null, f, { sendAuth: false });
      var raw = r.text ? String(r.text).slice(0, 500) : "(応答なし HTTP " + r.status + ")";
      if (r.status !== 200 || !r.body) { var m = extractError(r.body); if (r.status === 503) m = "ログイン試行が多すぎるため一時的に制限されています。10〜30分ほど待ってから、もう一度だけお試しください"; return { ok: false, status: r.status, message: m || ("ログインに失敗しました(HTTP " + r.status + ")"), raw: raw }; }
      var d = r.body.data || {}; var tok = d.auth_token || "";
      if (!tok) return { ok: false, status: r.status, vsns: r.vsns, message: extractError(r.body) || "メールアドレスまたはパスワードが違います", raw: raw };
      await setToken(tok); setUser(d.user_id, d.name);
      return { ok: true, user_name: state.userName, user_id: state.userId, raw: raw };
    },
    login_with_token: async function(a){
      var prev = state.token; await setToken(String(a[0] || "").trim());
      var r = await request("GET", "/api/account/session", {});
      var d = (r.body && (r.body.data || r.body)) || {}; var u = d.user_info || d.user || d;
      var uid = Number(u.user_id || u.id || 0);
      if (r.status !== 200 || !uid) { await setToken(prev); return { ok: false, status: r.status, message: "トークンが無効です" }; }
      setUser(uid, u.name || ""); return { ok: true, user_id: uid, user_name: state.userName };
    },
    logout: async function(){ await setToken(""); setUser(0, ""); pref("user_id", null); pref("user_name", null); state.userId = 0; state.userName = ""; return { ok: true }; },
    get_my_profile: async function(){ if (!state.userId) return { ok: false, message: "user_idが取得できていません。ログアウトして再ログインしてください。" }; return await buildProfile(state.userId); },
    view_user_profile: async function(a){ return await buildProfile(Number(a[0])); },
    get_timeline: async function(a){ return await postsResult(await request2("GET", "/api/feed_posts", { max_id: a[0] }), "feed_posts", false); },
    get_feed_timeline: async function(a){ return await postsResult(await request2("GET", "/api/timeline_posts", { max_id: a[0] }), "timeline_posts", true); },
    get_following_timeline: async function(a){ return await postsResult(await request2("GET", "/api/following_posts", { max_created_at: a[0] }), "following_posts", false); },
    get_user_posts: async function(a){
      var uid = a[0]; var r = await request2("GET", "/api/feed_posts", { count: "30", target_id: uid, max_id: a[1] });
      var res = await postsResult(r, "feed_posts", false); if (res.ok) res.posts = res.posts.filter(function(p){ return Number(p.user_id) === Number(uid); }); return res;
    },
    get_timeline_comments: async function(a){
      var r = await http("GET", BASE2 + "/api/feed_posts/" + a[0] + "/comments", { page: a[1] || "1", version: "android_" + APP_VERSION, auth_token: state.token });
      if (r.status !== 200 || !r.body) return jsonStatus(r);
      var arr = r.body.comments || (Array.isArray(r.body.data) ? r.body.data : (r.body.data && r.body.data.comments)) || [];
      await resolveNames(arr.map(function(c){ return c.user_id || (c.user && c.user.id); }));
      return { ok: true, comments: arr.map(function(c){ var uid = c.user_id || (c.user && c.user.id) || 0; return { id: c.id, user_id: uid, name: (c.user && c.user.name) || nameOf(uid), icon_url: (c.user && c.user.profile_picture_file_path) ? iconUrl(c.user.profile_picture_file_path) : iconOf(uid), text: c.comment || c.text || c.description || "", created_at: c.created_at || "" }; }) };
    },
    get_timeline_likers: async function(a){
      var r = await http("GET", BASE2 + "/api/feed_posts/" + a[0] + "/liked_users", { page: "1", version: "android_" + APP_VERSION, auth_token: state.token });
      if (r.status !== 200 || !r.body) return jsonStatus(r);
      var arr = firstArray(r.body, ["liked_users_info", "users", "user_info", "liked_users"]) || [];
      await ensureDefines();
      return { ok: true, users: arr.map(function(u){ return { user_id: u.user_id || u.id, name: u.name || "", icon_url: iconUrl(u.profile_picture_file_path || "") }; }) };
    },
    toggle_timeline_like: async function(a){
      var id = a[0], liked = !!a[1]; var q = { version: "android_" + APP_VERSION, auth_token: state.token };
      var r = liked ? await http("DELETE", BASE + "/api/feed_posts/" + id + "/like", q) : await http("POST", BASE + "/api/feed_posts/" + id + "/like", null, q);
      if (!(r.status >= 200 && r.status < 300)) r = liked ? await http("DELETE", BASE2 + "/api/feed_posts/" + id + "/like", q) : await http("POST", BASE2 + "/api/feed_posts/" + id + "/like", null, q);
      return { ok: r.status >= 200 && r.status < 300, status: r.status };
    },
    reply_timeline_post: async function(a){
      var f = { text: a[1], version: "android_" + APP_VERSION, auth_token: state.token };
      var r = await http("POST", BASE + "/api/feed_posts/" + a[0] + "/comments", null, f);
      if (r.status === 404 || r.status >= 500) r = await http("POST", BASE2 + "/api/feed_posts/" + a[0] + "/comments", null, f);
      log(nowStr() + "  [REPLY] post=" + a[0] + " HTTP " + r.status + " vsns=" + r.vsns);
      return okResult(r);
    },
    create_timeline_post: async function(a){
      var f = { version: "android_" + APP_VERSION, play_time: "0", auth_token: state.token }; if (a[0]) f.description = a[0];
      var r = await http("POST", BASE + "/api/feed_posts", null, f); if (r.status === 404 || r.status >= 500) r = await http("POST", BASE2 + "/api/feed_posts", null, f);
      return okResult(r);
    },
    delete_timeline_post: async function(a){ var r = await http("DELETE", BASE + "/api/feed_posts/" + a[0], { version: "android_" + APP_VERSION, auth_token: state.token }); return okResult(r, true); },
    get_feed_post: async function(a){
      var r = await http("GET", BASE2 + "/api/feed_posts/" + a[0], { version: "android_" + APP_VERSION, auth_token: state.token });
      if (r.status !== 200 || !r.body) return { ok: false, status: r.status, raw: "[/api/feed_posts/" + a[0] + "@api2 HTTP " + r.status + "]" };
      var pd = r.body.post_info || r.body.feed_post || r.body.data || r.body; var posts = await normalizePosts([pd], false);
      return { ok: true, post: posts[0] || null, raw: "" };
    },
    get_unread_notif_count: async function(){
      var r = await request("GET", "/api/user_notifications/unread_count", {});
      var src = (r.body && r.body.data) || r.body || {}; var c = src.unread_count != null ? src.unread_count : (src.count != null ? src.count : (src.unread || 0));
      return { ok: r.status === 200, count: Number(c) || 0 };
    },
    get_notifications: async function(a){ return await getNotifications(a[0] || "normal", a[1] || "1"); },
    system_arrival: async function(){ var r = await http("POST", BASE + "/api/system/arrival", { auth_token: state.token, version: APP_VERSION }, {}); return { ok: r.status === 200, status: r.status }; },
    get_friends_list: async function(){
      var r = await http("POST", BASE + "/api/v2/dive/relations", null, { auth_token: state.token, version: APP_VERSION, without_chat_id: "true", include_blocked_user: "false" });
      var d = (r.body && (r.body.data || r.body)) || {}; var friends = d.friends || []; await ensureDefines();
      return { ok: r.status === 200, friends: friends.map(function(u){ var x = u.user_info || u.user || u; return { user_id: x.user_id || x.id, name: x.name || "", icon_url: iconUrl(x.profile_picture_file_path || ""), is_friend: true, mutual: true }; }), mutual: [] };
    },
    list_group_rooms: async function(a){
      var r = await request("GET", "/api/rooms", { page: a[0] || "1", order: "1" });
      var arr = (r.body && (r.body.rooms || (r.body.data && r.body.data.rooms))) || [];
      return { ok: r.status === 200, rooms: arr, has_more: arr.length >= 20 };
    },
    get_room_settings: async function(){ var r = await request("GET", "/api/room_settings", {}); return { ok: r.status === 200, settings: (r.body && (r.body.data || r.body)) || {} }; },
    // 未移植・iOS では無い機能のスタブ(画面が壊れないように「空」を返す)
    moderation_banlist: async function(){ return { ok: true, list: [], version: 0, unchanged: true }; },
    get_moderation_settings: async function(){ return { ok: true, settings: {} }; },
    get_live_pulse: async function(){ return { ok: true, online: 0, rooms: 0 }; },
    get_pusher_config: async function(){ return { ok: false, error: "not_ported" }; },
    get_official_links: async function(){ return { ok: true, links: [] }; },
    get_badges: async function(){ return { ok: true, badges: [] }; },
    get_account_balance: async function(){ return { ok: true, free_coin: 0, paid_coin: 0, point: 0 }; },
    get_room_history: async function(){ return { ok: true, history: [] }; },
    get_activity_heatmap: async function(){ return { ok: true, counts: {}, total: 0 }; },
    get_user_settings: async function(){ var r = await request("GET", "/api/user_settings", {}); return { ok: r.status === 200, settings: (r.body && (r.body.data || r.body)) || {} }; },
    js_diag_log: async function(){ return { ok: true }; },
    set_debug_log_enabled: async function(){ return { ok: true }; }
  };


  /* ===== 第2段階: 通話・DM・コミュニティ ===== */
  function truthy(v){ if (v == null) return false; if (typeof v === "boolean") return v; if (typeof v === "number") return v !== 0; var t = String(v).trim().toLowerCase(); return t === "1" || t === "true" || t === "yes"; }
  function firstStr(o, keys){ for (var i = 0; i < keys.length; i++) { var v = o && o[keys[i]]; if (typeof v === "string" && v.length) return v; if (typeof v === "number") return String(v); } return ""; }
  function arrUid(o){ if (o == null) return 0; if (typeof o === "number") return o; if (typeof o === "string") return Number(o) || 0; return Number(o.user_id || o.userId || o.id || 0); }
  async function httpApi2(method, path, query, fields){
    var r = await http(method, BASE2 + path, query, fields);
    if (!r.status || r.status === 404 || r.status >= 500) { var r2 = await http(method, BASE + path, query, fields); if (r2.status && r2.status < 400) return r2; }
    return r;
  }
  function roomsFromBody(b){
    if (!b) return null; var d = b.data;
    if (Array.isArray(d)) return d;
    if (d && typeof d === "object") { var a = d.talk_rooms || d.rooms; if (Array.isArray(a)) return a; if (Number(d.room_id || d.id) > 0 || (d.token && d.token.length)) return [d]; }
    var a2 = b.talk_rooms || b.rooms; if (Array.isArray(a2)) return a2;
    if (Number(b.room_id || b.id) > 0 || (b.token && b.token.length)) return [b];
    return null;
  }
  async function roomsByOwner(ownerId){
    var r = await httpApi2("GET", "/api/rooms", { owner_user_id: ownerId });
    var rooms = r.status === 200 ? roomsFromBody(r.body) : null;
    log(nowStr() + "  [ROOM] owner=" + ownerId + " HTTP " + r.status + " rooms=" + (rooms ? rooms.length : "null"));
    return rooms;
  }
  async function namedList(arr){ var out = []; if (!Array.isArray(arr)) return out; for (var i = 0; i < arr.length; i++) { var uid = arrUid(arr[i]); if (uid) out.push({ user_id: uid, name: nameOf(uid), icon_url: iconOf(uid) }); } return out; }
  function skywayHost(){ var h = ""; try { h = state.clientDefines.client_system_params.skyway.auth_token_endpoint_server || ""; } catch (e) {} if (h && h.indexOf("http") !== 0) h = "https://" + h; return h || "https://skyway-auth.meetscom.com"; }
  async function getSkywayToken(channel){
    await ensureDefines();
    var r = await http("POST", skywayHost() + "/authenticate", null, { channelName: channel, memberName: state.userId + "_" + channel, sessionToken: state.token || "" });
    if (r.status !== 200) log(nowStr() + "  [SKYWAY] authenticate ch=" + channel + " -> " + r.status);
    return r;
  }
  function skywayTokenOf(r){ var b = r.body || {}; var d = b.data || {}; var keys = ["authToken", "token", "auth_token", "skyway_token", "skywayToken", "jwt", "credential"]; for (var i = 0; i < keys.length; i++) { if (typeof d[keys[i]] === "string" && d[keys[i]]) return d[keys[i]]; if (typeof b[keys[i]] === "string" && b[keys[i]]) return b[keys[i]]; } return ""; }
  async function changeRole(roomId, targetId, role){ return okResult(await request("PUT", "/api/rooms/" + roomId + "/change_role", { role: role, target_id: targetId })); }
  async function joinRoomObj(room, useOwnRoom, ownerIdStr){
    room = room || {};
    var roomToken = room.token || "";
    if (!roomToken) return useOwnRoom ? { ok: false, error: "no_own_room", message: "自分の通話ルームがまだありません。「枠を作る」から作成してください。" } : { ok: false, error: "no_target_room", message: "このユーザーは現在トークルームを開いていません。" };
    var member = state.userId + "_" + roomToken;
    var roomId = Number(room.id || room.room_id || 0);
    var ownerOf = Number(room.owner_user_id || room.owner || 0);
    if (roomId && (useOwnRoom || ownerOf === state.userId)) pref("my_open_room", roomId); else if (roomId) pref("my_open_room", null);
    if (roomId) {
      var jr = await httpApi2("POST", "/api/rooms/" + roomId + "/join", null, {});
      log(nowStr() + "  [JOIN] POST rooms/" + roomId + "/join -> " + jr.status);
      if ((jr.status === 403 || jr.status === 400) && jr.body) { var jm = extractError(jr.body); if (jm) return { ok: false, status: jr.status, message: jm }; }
    }
    var sk = await getSkywayToken(roomToken);
    if (sk.status !== 200) return { ok: false, status: sk.status, message: sk.status === 401 ? "通話サーバーへの認証に失敗しました。ログインし直してください。" : (sk.status <= 0 ? "通話サーバーに接続できませんでした。電波の良い場所でもう一度お試しください。" : (sk.status >= 500 ? "通話サーバーが混み合っています。時間を置いてからお試しください。" : "通話サーバーへの接続に失敗しました（status " + sk.status + "）。")) };
    var skToken = skywayTokenOf(sk);
    if (!skToken) return { ok: false, error: "AuthTokenが取得できませんでした" };
    var speakers = room.speakers || [], listeners = room.listeners || [];
    await resolveNames(speakers.concat(listeners).map(arrUid).concat([Number(ownerIdStr) || 0]));
    var participants = [];
    [[speakers, true], [listeners, false]].forEach(function(pair){ pair[0].forEach(function(o){ if (!o || typeof o !== "object") return; var uid = arrUid(o); participants.push({ user_id: uid, name: o.name || nameOf(uid), icon_url: iconOf(uid), is_owner: !!(o.isOwner || o.is_owner), is_mute: !!(o.isMute || o.is_mute), role: o.role || (pair[1] ? "speaker" : "listener") }); }); });
    var isOwner = useOwnRoom; participants.forEach(function(p){ if (p.is_owner && p.user_id === state.userId) isOwner = true; });
    var applicants = (room.speakerApplicants || room.speaker_applicants || []).filter(function(o){ return o && typeof o === "object"; });
    if (roomId) {
      if (pref("mod_auto_raise_hand") === "1") await changeRole(String(roomId), String(state.userId), "speaker_applicant");
      var autoApprove = pref("mod_auto_approve") === "1", autoReject = pref("mod_auto_reject") === "1";
      if (isOwner && (autoApprove || autoReject)) for (var i = 0; i < applicants.length; i++) { var uid = arrUid(applicants[i]); if (uid) await changeRole(String(roomId), String(uid), autoApprove ? "speaker" : "listener"); }
    }
    var title = room.description || room.title || "";
    var call = { auth_token: skToken, channel: roomToken, member: member, participants: participants, room_id: roomId || null, is_owner: isOwner, owner_user_id: Number(ownerIdStr) || 0, title: title };
    return { ok: true, participants: participants, room_id: roomId || null, speaker_applicants: applicants, call: call };
  }
  async function joinCall(ownerParam){
    var useOwn = !ownerParam || ownerParam === "null"; var ownerId = useOwn ? String(state.userId) : String(ownerParam); if (ownerId === String(state.userId)) useOwn = true;
    var rooms = await roomsByOwner(ownerId) || []; var room = null;
    for (var i = 0; i < rooms.length; i++) { var o = rooms[i]; if (!o) continue; var ca = o.closed_at; if (ca && ca !== "null") continue; room = o; break; }
    return await joinRoomObj(room, useOwn, ownerId);
  }
  async function closeRoomById(id){ var r = await httpApi2("DELETE", "/api/rooms/" + id, null, null); log(nowStr() + "  [ROOM] close " + id + " -> " + r.status); return r.status; }
  function isRoomExistsError(t){ t = String(t || ""); return /作成超過|already|exists|上限|exceed/i.test(t); }
  async function myOwnedRooms(){ return await roomsByOwner(String(state.userId)) || []; }
  async function chatPreviewOf(chatId, targetId){
    var r = await request("GET", "/api/messages", { chat_id: chatId, target_id: targetId, page: "1" });
    if (r.status !== 200 || !r.body) return "";
    var arr = r.body.messages || (r.body.data && (firstArray(r.body.data, ["messages", "chat_messages", "message", "data"]))) || (Array.isArray(r.body.data) ? r.body.data : []) || [];
    for (var i = 0; i < Math.min(arr.length, 4); i++) { var m = arr[i]; if (!m) continue; var t = firstStr(m, ["text_message", "text", "message", "content", "body"]); if (t.trim()) return t; var mt = Number(m.message_type || 0); if (mt === 2) return "[画像]"; if (mt === 3) return "[音声]"; }
    return "";
  }
  function chatLastMessage(c){
    if (!c) return "";
    if (c.last_message_image_url || c.last_image_url) return "[画像]"; if (c.last_message_voice_url || c.last_voice_url) return "[音声]";
    var d = firstStr(c, ["last_message_text", "last_message_preview", "latest_message_text", "last_message_body", "message_preview", "preview", "snippet"]); if (d.trim()) return d;
    var objs = ["last_message", "latest_message", "message", "recent_message", "last_chat_message", "last_chat"];
    for (var i = 0; i < objs.length; i++) { var o = c[objs[i]]; if (typeof o === "string" && o.trim()) return o; if (o && typeof o === "object") { var v = firstStr(o, ["text", "message", "body", "content", "description", "comment"]); if (v) return v; if (o.image_url) return "[画像]"; if (o.voice_url) return "[音声]"; } }
    return "";
  }
  function communitiesResult(r){
    if (r.status !== 200 || !r.body) return jsonStatus(r);
    var d = r.body.data; var arr = Array.isArray(d) ? d : (d && d.communities) || [];
    return { ok: true, communities: arr.map(function(c){ return { id: c.id, name: c.name || "", description: c.description || "", icon_url: iconUrl(c.image_file_path || ""), participant_count: c.participant_count || 0 }; }) };
  }
  function okList(r, outKey, keys){
    if (!r || r.status < 200 || r.status >= 300 || !r.body) return { ok: false, status: r ? r.status : 0, raw: r && r.text ? String(r.text).slice(0, 300) : "" };
    var arr = Array.isArray(r.body.data) ? r.body.data : (firstArray(r.body, keys) || (r.body.data && firstArray(r.body.data, keys)) || []);
    var o = { ok: true }; o[outKey] = arr; return o;
  }

  Object.assign(handlers, {
    // ---- 通話 ----
    list_group_rooms: async function(a){
      var r = await request("GET", "/api/rooms", { page: a[0] || "1", order: "1" });
      if (r.status !== 200 || !r.body) return { ok: false, status: r.status };
      var d = r.body.data; var arr = Array.isArray(d) ? d : (d && (d.rooms || d.talk_rooms)) || [];
      await ensureDefines(); await resolveNames(arr.map(function(o){ return Number(o.owner || o.owner_user_id || 0); }));
      return { ok: true, rooms: arr.map(function(o){ var oid = Number(o.owner || o.owner_user_id || 0); var sc = (o.speakers || []).length, lc = (o.listeners || []).length; return { id: o.id || o.room_id, owner_user_id: oid, owner_name: nameOf(oid), owner_icon: iconOf(oid), title: o.description || ("user " + oid + " のルーム"), speaker_count: sc, listener_count: lc, member_count: sc + lc, created_at: o.created_at || o.started_at || o.created_time || "", is_public: o.is_public }; }) };
    },
    create_room: async function(a){
      var form = { description: a[0] || "", is_public: (a[1] === false) ? "0" : "1", connection_type: (Number(a[3]) === 2) ? "2" : "1" };
      var r = await httpApi2("POST", "/api/rooms", null, form);
      log(nowStr() + "  [ROOM] create HTTP " + r.status);
      if (r.status === 400 && isRoomExistsError(r.text)) {
        var closed = 0; var owned = await myOwnedRooms();
        for (var i = 0; i < owned.length; i++) { var ro = owned[i]; var rid = Number(ro.room_id || ro.id || 0); var n = (ro.speakers || []).length + (ro.listeners || []).length; if (rid && n <= 1) { var st = await closeRoomById(rid); if (st >= 200 && st < 300) closed++; } }
        var mine = pref("my_open_room"); if (!closed && mine) { var st2 = await closeRoomById(mine); if (st2 >= 200 && st2 < 300) { closed++; pref("my_open_room", null); } }
        if (closed) r = await httpApi2("POST", "/api/rooms", null, form);
      }
      if (r.status >= 200 && r.status < 300) return await joinCall("null");
      var sm = extractError(r.body); var msg;
      if (r.status === 400 && isRoomExistsError(r.text)) msg = "すでに開いている自分の枠があります。そちらに戻るか、枠を閉じてから作成してください。";
      else if (r.status === 401) msg = "ログインの有効期限が切れています。ログインし直してください。";
      else if (r.status === 400 || r.status === 403) msg = sm ? ("枠を作成できませんでした：" + sm) : ("枠の作成がサーバーに拒否されました(status " + r.status + ")。");
      else if (r.status >= 500) msg = "サーバーエラーで枠を作成できませんでした(status " + r.status + ")。";
      else if (r.status <= 0) msg = "通信できませんでした。電波状況を確認してもう一度お試しください。";
      else msg = "枠を作成できませんでした(status " + r.status + ")。";
      return { ok: false, status: r.status, message: msg };
    },
    join_call: async function(a){ return await joinCall(a[0] == null ? "null" : String(a[0])); },
    join_room_by_id: async function(a){
      var q = { version: APP_VERSION, auth_token: state.token };
      var r = await http("GET", BASE2 + "/api/rooms/" + a[0], q); if (r.status !== 200) r = await http("GET", BASE + "/api/rooms/" + a[0], q);
      if (r.status !== 200 || !r.body) return { ok: false, error: "room_not_found", status: r.status, message: "この枠は見つかりませんでした(終了した可能性があります)。" };
      var d = r.body.data; var room = null;
      if (d && typeof d === "object" && !Array.isArray(d)) room = d.room || d; else if (Array.isArray(d) && d.length) room = d[0]; else if (r.body.room) room = r.body.room; else if (r.body.room_id || r.body.token || r.body.owner_user_id) room = r.body;
      if (room && room.closed_at && room.closed_at !== "null") return { ok: false, error: "room_closed", closed_at: room.closed_at, message: "この枠は終了しています。" };
      var owner = room ? Number(room.owner || room.owner_user_id || 0) : 0;
      return await joinRoomObj(room, owner === state.userId, String(owner || state.userId));
    },
    room_leave: async function(a){
      var id = a[0]; if (!id) return { ok: false, message: "room_id不明" };
      var r = await request2("DELETE", "/api/rooms/" + id + "/leave", null, null);
      if (r.status === 404 || r.status === 405) r = await request2("POST", "/api/rooms/" + id + "/leave", null, {});
      log(nowStr() + "  [ROOM] leave " + id + " -> " + r.status);
      try { var st = await httpApi2("GET", "/api/rooms/" + id, null, null); if (st.status === 200 && st.body) { var ro = st.body.data || st.body; var owner = Number(ro.owner_user_id || ro.owner || 0); if (owner && owner === state.userId) { await closeRoomById(id); pref("my_open_room", null); } } } catch (e) {}
      return okResult(r);
    },
    refresh_room_state: async function(a){
      var ownerStr = (!a[0] || a[0] === "null") ? String(state.userId) : String(a[0]); var roomId = a[1]; var room = null;
      if (roomId && roomId !== "null" && roomId !== "0") {
        var r1 = await http("GET", BASE2 + "/api/rooms/" + roomId, { version: APP_VERSION, auth_token: state.token });
        if (r1.status === 200 && r1.body) { var d = r1.body.data; if (d && typeof d === "object" && !Array.isArray(d)) room = d.room || d; else if (Array.isArray(d) && d.length) room = d[0]; else if (r1.body.room_id || r1.body.owner_user_id || r1.body.speakers) room = r1.body; else if (r1.body.room) room = r1.body.room; if (!room) { var rr = roomsFromBody(r1.body); if (rr && rr.length) room = rr[0]; } }
        else if (r1.status === 404) return { ok: true, room_id: null, owner_user_id: 0, speaker_applicants: [], speakers: [], listeners: [], speaker_count: 0, listener_count: 0 };
      }
      if (!room) { var rooms = await roomsByOwner(ownerStr); if (rooms && rooms.length) room = rooms[0]; }
      room = room || {};
      var apps = room.speakerApplicants || room.speaker_applicants || [], sp = room.speakers || [], li = room.listeners || [];
      var owner = Number(room.owner || room.owner_user_id || 0);
      await ensureDefines(); await resolveNames(apps.concat(sp, li).map(arrUid).concat([owner]));
      var rid = Number(room.id || room.room_id || 0);
      return { ok: true, room_id: rid || null, owner_user_id: owner, title: room.description || room.title || "", comment_enabled: ("comment_enabled" in room) ? truthy(room.comment_enabled) : null, close_at: room.close_at || "", opened_at: room.opened_at || "", is_public: ("is_public" in room) ? truthy(room.is_public) : null, speaker_applicants: await namedList(apps), speakers: await namedList(sp), listeners: await namedList(li), speaker_count: sp.length, listener_count: li.length };
    },
    get_room_comments: async function(a){
      var r = await request2("GET", "/api/room_comments", { room_id: a[0] });
      if (r.status === 404) return { ok: true, comments: [] };
      if (r.status !== 200 || !r.body) return { ok: false, status: r.status };
      var d = r.body.data; var arr = (d && (d.room_comments || d.comments || d.data)) || r.body.room_comments || r.body.comments || [];
      var out = arr.map(function(c){ var u = c.user; var uid = Number(c.user_id || (u && u.id) || 0); return { id: c.id, user_id: uid, name: u ? (u.nickname || u.name || "") : "", text: firstStr(c, ["comment", "text", "message"]), created_at: c.created_at || "", is_explicit: truthy(c.is_explicit) ? 1 : 0, is_in_penalty_period: truthy(c.is_in_penalty_period != null ? c.is_in_penalty_period : (u && u.is_in_penalty_period)) }; });
      var need = out.filter(function(c){ return !c.name && c.user_id > 0; }).map(function(c){ return c.user_id; });
      if (need.length) { await resolveNames(need); out.forEach(function(c){ if (!c.name && c.user_id) c.name = nameOf(c.user_id); }); }
      return { ok: true, comments: out };
    },
    send_room_comment: async function(a){ if (!a[0]) return { ok: false, message: "room_id不明" }; var r = await request2("POST", "/api/room_comments", null, { room_id: a[0], comment: a[1] }); log(nowStr() + "  [CHAT] send room=" + a[0] + " -> " + r.status); return okResult(r); },
    raise_hand: async function(a){ return await changeRole(a[0], String(state.userId), "speaker_applicant"); },
    lower_hand: async function(a){ return await changeRole(a[0], String(state.userId), "listener"); },
    approve_speaker: async function(a){ return await changeRole(a[0], a[1], "speaker"); },
    reject_speaker: async function(a){ return await changeRole(a[0], a[1], "listener"); },
    room_kick_user: async function(a){ if (!a[0] || !a[1]) return { ok: false, message: "room_id/target_id不明" }; return okResult(await request("POST", "/api/rooms/" + a[0] + "/kick", null, { target_id: a[1] })); },
    room_close: async function(a){ if (!a[0]) return { ok: false, message: "room_id不明" }; var r = await request("DELETE", "/api/rooms/" + a[0], null, null); pref("my_open_room", null); return okResult(r); },
    room_update_title: async function(a){ if (!a[0]) return { ok: false, message: "room_id不明" }; return okResult(await request("PUT", "/api/rooms/" + a[0], { description: a[1] })); },
    room_switch_comment_enabled: async function(a){ if (!a[0]) return { ok: false, message: "room_id不明" }; return okResult(await request("PUT", "/api/rooms/" + a[0] + "/switch_comment_enabled", { comment_enabled: (a[1] === false) ? "false" : "true" })); },
    room_invite: async function(a){ if (!a[0] || !a[1]) return { ok: false, message: "room_id/target_id不明" }; return okResult(await request("POST", "/api/rooms/" + a[0] + "/invite", { target_ids: a[1] }, {})); },
    room_data_send: async function(a){
      if (!a[0]) return { ok: false, message: "room_id不明" };
      var body = JSON.stringify({ command: Number(a[1]), args: { requestee_id: Number(a[2]) } });
      var r = await native("__http", [{ method: "PUT", url: "https://koetomo-bb8bb.firebaseio.com/api/rooms/" + a[0] + "/room_data.json", headers: { "Content-Type": "application/json" }, body: body, timeout: 12000 }]);
      return { ok: r.status >= 200 && r.status < 300, status: r.status };
    },
    skyway_connect_log: async function(a){ if (!a[0]) return { ok: false, message: "connection_id不明" }; var r = await request("POST", "/api/skyway/connections", null, { ConnectionId: a[0], CallerId: a[1] || "0", CalleeId: a[2] || "0", TargetId: a[3] || "0", token: a[4] || "" }); return okResult(r, true); },
    skyway_disconnect_log: async function(a){ if (!a[0]) return { ok: false }; var r = await request("DELETE", "/api/skyway/connections/" + a[0], null, null); return okResult(r, true); },
    // ---- DM ----
    get_chats: async function(){
      if (!state.userId) return { ok: false, error: "user_id未取得。再ログインしてください。" };
      var r = await request("GET", "/api/chats", { uid: String(state.userId), offset: "0", count: "20" });
      if (r.status !== 200 || !r.body) return { ok: false, status: r.status };
      var d = r.body.data || {}; var chats = d.chats || []; var ui = {}; (d.user_info || []).forEach(function(u){ ui[Number(u.user_id)] = u; });
      await ensureDefines();
      var rows = chats.map(function(c){ var uid = Number(c.user_id); var u = ui[uid]; return { chat_id: c.id, target_id: uid, name: u ? (u.name || "user " + uid) : "user " + uid, icon_url: u ? iconUrl(u.profile_picture_file_path || "") : "", last_sent_at: c.last_sent_at || "", last_message: chatLastMessage(c) }; });
      var cache = {}; try { cache = JSON.parse(pref("chat_preview_cache") || "{}"); } catch (e) {}
      var toFetch = rows.filter(function(x){ if (x.last_message) return false; var hit = cache[x.chat_id + "@" + x.last_sent_at]; if (hit) { x.last_message = hit; return false; } return !!x.chat_id; }).slice(0, 8);
      await Promise.all(toFetch.map(async function(x){ try { var t = await chatPreviewOf(String(x.chat_id), String(x.target_id)); if (t) { x.last_message = t; cache[x.chat_id + "@" + x.last_sent_at] = t; } } catch (e) {} }));
      try { if (Object.keys(cache).length > 120) cache = {}; pref("chat_preview_cache", JSON.stringify(cache)); } catch (e) {}
      return { ok: true, chats: rows, my_user_id: state.userId };
    },
    get_messages: async function(a){
      var r = await request("GET", "/api/messages", { chat_id: a[0], target_id: a[1], page: "1" });
      if (r.status !== 200 || !r.body) return { ok: false, status: r.status };
      var arr = r.body.messages || (r.body.data && firstArray(r.body.data, ["messages", "chat_messages", "message", "data"])) || (Array.isArray(r.body.data) ? r.body.data : []) || [];
      await ensureDefines();
      var out = [];
      for (var i = arr.length - 1; i >= 0; i--) { var m = arr[i]; if (!m) continue; var mt = Number(m.message_type || 1); var img = firstStr(m, ["image_file_path", "imageFilePath", "image_url", "imageUrl", "image"]);
        // 画像/音声(binary_file_path=非公開バケット)は署名URLが必要で iOS 版は未対応 → 種別だけ伝える
        out.push({ id: m.id, user_id: Number(m.user_id || m.userId || 0), text: firstStr(m, ["text_message", "text", "message", "content", "body"]) || (mt === 2 ? "[画像]" : (mt === 3 ? "[音声]" : "")), image_url: img ? iconUrl(img) : "", voice_url: "", message_type: mt, play_time: Number(m.play_time || 0), is_read: m.is_read === 1 || m.is_read === true, sent_at: firstStr(m, ["sent_at", "sentAt", "created_at", "createdAt"]) }); }
      return { ok: true, messages: out, my_user_id: state.userId };
    },
    send_message: async function(a){ var r = await http("POST", BASE + "/api/chat/messages", null, { target_id: a[1], chat_id: a[0], uid: String(state.userId), text_message: a[2], message_type: "1", version: "android_" + APP_VERSION, auth_token: state.token }); return okResult(r, true); },
    mark_message_read: async function(a){ if (!a[0]) return { ok: false }; var r = await request("PUT", "/api/chat/message", null, { message_id: a[0] }); return { ok: r.status === 200 || r.status === 201, status: r.status }; },
    delete_chat_message: async function(a){
      if (!a[0]) return { ok: false, message: "メッセージが不明です" };
      var q = { message_id: a[0], version: "android_" + APP_VERSION, auth_token: state.token }; if (a[1]) q.chat_id = a[1]; if (a[2]) q.target_id = a[2];
      var tries = [[BASE, "/api/chat/message"], [BASE2, "/api/chat/message"], [BASE, "/api/chat/messages/" + a[0]], [BASE2, "/api/chat/messages/" + a[0]]]; var last = { status: 0 };
      for (var i = 0; i < tries.length; i++) { var r = await http("DELETE", tries[i][0] + tries[i][1], q); last = r; if (r.status >= 200 && r.status < 300) return { ok: true, status: r.status }; }
      return { ok: false, status: last.status };
    },
    can_send_chat: async function(a){ var r = await httpApi2("GET", "/api/chats/can_send_2", { target_id: a[0] || "" }); var src = (r.body && (r.body.data || r.body)) || {}; var can = r.status === 200; if (typeof src.can_send === "boolean") can = src.can_send; else if (typeof src.sendable === "boolean") can = src.sendable; return { ok: r.status === 200, can_send: can }; },
    // ---- コミュニティ ----
    get_my_communities: async function(){ var r = await request("GET", "/api/communities/participating", { count: "20", order_condition: "1" }); await ensureDefines(); return communitiesResult(r); },
    search_communities: async function(a){ var q = { page: "1", count: "20" }; if (a[0]) q.keyword = a[0]; if (a[1] && a[1] !== "0" && a[1] !== "all") q.category_id = a[1]; var r = await request("GET", "/api/communities/search", q); await ensureDefines(); return communitiesResult(r); },
    get_community_categories: async function(){ var r = await request("GET", "/api/communities/categories", {}); if (r.status !== 200 || !r.body) return { ok: false, status: r.status }; var d = r.body.data; var arr = r.body.categories || (Array.isArray(d) ? d : (d && (d.categories || d.community_categories))) || []; return { ok: true, categories: arr.map(function(c){ return { id: Number(c.id || 0), name: firstStr(c, ["name", "title", "label"]) }; }) }; },
    get_communities_feed: async function(a){
      var r = await request("GET", "/api/communities/participating_posts", { page: a[0] || "1" });
      if (r.status !== 200 || !r.body) return { ok: false, status: r.status };
      var d = r.body.data; var posts = r.body.posts || (Array.isArray(d) ? d : (d && firstArray(d, ["posts", "community_posts", "feed"]))) || []; await ensureDefines();
      return { ok: true, posts: posts.map(function(p){ var u = p.user; return { community_name: firstStr(p, ["community_name", "group_name"]), name: u ? (u.name || "") : firstStr(p, ["user_name", "name"]), icon_url: iconUrl(u ? (u.profile_picture_file_path || "") : ""), text: firstStr(p, ["text", "message", "body", "content"]), created_at: firstStr(p, ["created_at", "createdAt"]) }; }) };
    },
    get_community_info: async function(a){
      var r = await request("GET", "/api/communities/" + a[0], {});
      if (r.status !== 200 || !r.body) return { ok: false, status: r.status };
      var c = r.body.community || r.body.data || r.body; await ensureDefines();
      return { ok: true, name: firstStr(c, ["name", "title"]), description: firstStr(c, ["description", "detail", "bio", "text"]), member_count: Number(c.member_count || c.members_count || c.user_count || c.participant_count || 0), icon_url: iconUrl(firstStr(c, ["cover_image", "image_file_path", "image", "icon", "thumbnail"])), is_member: !!(c.is_member || c.is_participating || c.joined) };
    },
    join_community: async function(a){ return okResult(await request("POST", "/api/communities/" + a[0] + "/join", null, {}), true); },
    leave_community: async function(a){ var r = await request("DELETE", "/api/communities/" + a[0] + "/leave", null, null); if (!(r.status >= 200 && r.status < 300)) { var r2 = await request("POST", "/api/communities/" + a[0] + "/leave", null, {}); if ((r2.status >= 200 && r2.status < 300) || r.status <= 0) r = r2; } return okResult(r, true); },
    get_community_posts: async function(a){
      var r = await request("GET", "/api/communities/" + a[0] + "/posts", { page: "1" });
      if (r.status !== 200 || !r.body) return jsonStatus(r);
      var d = r.body.data || {}; var posts = d.posts || []; var liked = {}; (d.liked_ids || d.likedIds || []).forEach(function(id){ liked[id] = 1; });
      await ensureDefines(); await resolveNames(posts.map(function(p){ return p.user_id; }));
      return { ok: true, posts: posts.map(function(p){ var uid = Number(p.user_id); return { id: p.id, user_id: uid, name: nameOf(uid), icon_url: iconOf(uid), text: p.description || "", liked: !!liked[p.id], like_count: Number(p.liked_count || p.likedCount || 0), image_url: iconUrl(p.image_file_path || ""), created_at: p.created_at || "" }; }) };
    },
    get_community_post_comments: async function(a){ var r = await http("GET", BASE + "/api/communities/" + a[0] + "/posts/" + a[1] + "/comments", { page: a[2] || "1", version: APP_VERSION, auth_token: state.token }); return okList(r, "comments", ["comments", "post_comments"]); },
    create_community_post: async function(a){ return okResult(await request("POST", "/api/communities/" + a[0] + "/posts", null, { description: a[1], image_file_path: "", voice_file_path: "", md5: "" })); },
    comment_community_post: async function(a){ var r = await http("POST", BASE + "/api/communities/" + a[0] + "/posts/" + a[1] + "/comments", { version: APP_VERSION, auth_token: state.token }, { description: a[2] || "", image_file_path: "", voice_file_path: "", md5: "" }); return okResult(r); },
    toggle_community_like: async function(a){ var liked = !!a[2]; return okResult(await request(liked ? "DELETE" : "POST", "/api/communities/" + a[0] + "/posts/" + a[1] + "/liked", null, liked ? null : {})); },
    get_community_members: async function(a){
      var q = { count: "20" }; if (a[1] && a[1] !== "null") q.max_joined_at = a[1];
      var r = await request("GET", "/api/communities/" + a[0] + "/members", q);
      if (r.status !== 200 || !r.body) return jsonStatus(r);
      var d = r.body.data; var arr = Array.isArray(d) ? d : (d && firstArray(d, ["users", "members", "user_info"])) || []; await ensureDefines();
      return { ok: true, users: arr.map(function(m){ var u = m.user || m; var uid = Number(u.user_id || u.userId || m.user_id || 0); return { user_id: uid, name: u.name || (uid ? "user " + uid : ""), icon_url: iconUrl(u.profile_picture_file_path || u.profilePictureFilePath || "") }; }) };
    },
    get_community_talk_rooms: async function(a){
      if (!a[0]) return { ok: false, message: "community_id不明" };
      var r = await request("GET", "/api/communities/" + a[0] + "/talk_rooms", {});
      if (r.status !== 200 || !r.body) return jsonStatus(r);
      var d = r.body.data; var rooms = Array.isArray(d) ? d : (d && (d.talk_rooms || d.rooms)) || r.body.talk_rooms || r.body.rooms || [];
      await ensureDefines(); await resolveNames(rooms.map(function(x){ return Number(x.owner || x.owner_user_id || 0); }));
      return { ok: true, talk_rooms: rooms.map(function(x){ var oid = Number(x.owner || x.owner_user_id || 0); var sc = (x.speakers || []).length, lc = (x.listeners || []).length; return { id: x.id, owner_user_id: oid, owner_name: nameOf(oid), owner_icon: iconOf(oid), title: x.description || x.title || "", speaker_count: sc, listener_count: lc, member_count: sc + lc, comment_enabled: x.comment_enabled !== false, created_at: x.created_at || x.started_at || "" }; }) };
    },
    join_community_talk_room: async function(a){ if (!a[0] || !a[1]) return { ok: false, message: "community_id/room_id不明" }; return okResult(await request("POST", "/api/communities/" + a[0] + "/talk_rooms/" + a[1] + "/join", null, {}), true); },
    leave_community_talk_room: async function(a){ if (!a[0] || !a[1]) return { ok: false, message: "community_id/room_id不明" }; var r = await request2("DELETE", "/api/communities/" + a[0] + "/talk_rooms/" + a[1] + "/leave", null, null); if (r.status === 404 || r.status === 405) r = await request2("POST", "/api/communities/" + a[0] + "/talk_rooms/" + a[1] + "/leave", null, {}); return okResult(r, true); }
  });

  window.__koeIos = {
    dispatch: async function(m, args){
      await ensureLoaded();
      var h = handlers[m];
      if (!h) return { ok: false, error: "not_ported", message: "「" + m + "」は iOS 版ではまだ未対応です。" };
      try { var r = await h(args || []); if (r && r.session_expired) { /* 401: 画面側が再ログインを促す */ } return r; }
      catch (e) { log(nowStr() + "  [JSERR] " + m + " " + (e && e.message)); return { ok: false, error: String(e && e.message || e) }; }
    },
    _state: state,
    extend: function(h){ Object.keys(h || {}).forEach(function(k){ handlers[k] = h[k]; }); },
    _internals: { state: state, handlers: handlers, http: http, request: request, request2: request2, httpApi2: httpApi2, okResult: okResult, okList: okList, jsonStatus: jsonStatus, native: native, log: log, nowStr: nowStr, pref: pref, ensureDefines: ensureDefines, iconUrl: iconUrl, voiceUrl: voiceUrl, firstArray: firstArray, firstStr: firstStr, extractError: extractError, postsResult: postsResult, normalizePosts: normalizePosts, resolveNames: resolveNames, nameOf: nameOf, iconOf: iconOf, APP_VERSION: APP_VERSION, BASE: BASE, BASE2: BASE2 }
  };
})();
