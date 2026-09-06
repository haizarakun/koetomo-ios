/* iOS 版セッション層 第3段階: S3(画像/音声アップロード・DM添付の署名URL)・友達申請・フォロー・ブックマーク・投げ銭・ブロック・検索
   ios-session.js の後に読み込まれ、window.__koeIos.extend() でハンドラを追加する。 */
(function(){
  var K = window.__koeIos && window.__koeIos._internals;
  if (!K) return;
  var state = K.state, http = K.http, request = K.request, httpApi2 = K.httpApi2, okResult = K.okResult, okList = K.okList, native = K.native, log = K.log, nowStr = K.nowStr, pref = K.pref, ensureDefines = K.ensureDefines, iconUrl = K.iconUrl, firstArray = K.firstArray, firstStr = K.firstStr, extractError = K.extractError, postsResult = K.postsResult;
  var APP_VERSION = K.APP_VERSION, BASE = K.BASE, BASE2 = K.BASE2;
  var handlers = {};

  function uuidHex(){ var h = "0123456789abcdef", o = ""; for (var i = 0; i < 32; i++) o += h[Math.floor(Math.random() * 16)]; return o; }
  function stripDataUrl(s){ s = String(s || ""); var c = s.indexOf(","); return (s.indexOf("data:") === 0 && c >= 0) ? s.slice(c + 1) : s; }
  function b64IsJpeg(b64){ try { var head = atob(b64.slice(0, 8)); return head.charCodeAt(0) === 0xFF && head.charCodeAt(1) === 0xD8 && head.charCodeAt(2) === 0xFF; } catch (e) { return false; } }
  async function imageS3Config(){
    await ensureDefines();
    var up = null; try { up = state.clientDefines.client_system_params.server_name.image_upload; } catch (e) {}
    if (!up) throw new Error("image_upload設定が見つからない(通信を確認)");
    if (!up.identity_pool_id || !up.region || !up.bucket_name) throw new Error("image_upload設定が不完全");
    return { pool_id: up.identity_pool_id, region: up.region, bucket: up.bucket_name, path: up.path || "" };
  }
  var credCache = { t: 0, c: null };
  async function cognitoCreds(cfg){
    if (credCache.c && Date.now() - credCache.t < 40 * 60 * 1000) return credCache.c;
    var r = await native("__cognito_creds", [{ region: cfg.region, pool_id: cfg.pool_id }]);
    if (!r || !r.ok) throw new Error((r && r.error) || "Cognito失敗");
    credCache = { t: Date.now(), c: r }; return r;
  }
  function s3Key(cfg, bare){ var p = String(cfg.path || "").replace(/^\/+|\/+$/g, ""); return p ? p + "/" + bare : bare; }
  async function s3Upload(b64, ext, contentType){
    var cfg = await imageS3Config(); var creds = await cognitoCreds(cfg);
    var bare = uuidHex() + "." + ext; var key = s3Key(cfg, bare);
    var r = await native("__s3_put", [{ region: cfg.region, bucket: cfg.bucket, key: key, contentType: contentType, dataBase64: b64, AccessKeyId: creds.AccessKeyId, SecretKey: creds.SecretKey, SessionToken: creds.SessionToken }]);
    if (!r || !r.ok) throw new Error((r && r.error) || "S3アップロード失敗");
    return { bare: bare, key: key, md5: r.md5 };
  }
  async function s3Presign(key, expire){
    try {
      var cfg = await imageS3Config(); var creds = await cognitoCreds(cfg); var k = key.indexOf("/") < 0 ? s3Key(cfg, key) : key;
      var r = await native("__s3_presign", [{ region: cfg.region, bucket: cfg.bucket, key: k, expire: expire || 900, AccessKeyId: creds.AccessKeyId, SecretKey: creds.SecretKey, SessionToken: creds.SessionToken }]);
      return (r && r.ok) ? r.url : "";
    } catch (e) { log(nowStr() + "  [S3] presign失敗 " + (e && e.message)); return ""; }
  }
  var lastPost = { sig: "", t: 0 };
  async function postToSeries(endpoint, description, purpose, imagePath, voicePath, md5, playTime){
    var f = { version: "android_" + APP_VERSION }; var isFeed = endpoint.indexOf("feed_posts") >= 0;
    if (!isFeed) { f.purpose = purpose || "0"; f.topic = "0"; } else { f.play_time = playTime || "0"; }
    if (description) f.description = description; if (imagePath) f.image_file_path = imagePath; if (voicePath) f.voice_file_path = voicePath;
    if (imagePath && md5) f.md5 = md5; if (state.token) f.auth_token = state.token;
    var sig = endpoint + " " + (description || "") + " " + (imagePath || "") + " " + (voicePath || "");
    if (sig === lastPost.sig && Date.now() - lastPost.t < 15000) { log(nowStr() + "  [POST] 同一内容の連続投稿を抑止 " + endpoint); return { status: 200, body: null, vsns: -999 }; }
    lastPost = { sig: sig, t: Date.now() };
    var r = await http("POST", BASE + endpoint, null, f); if (r.status === 404) r = await http("POST", BASE2 + endpoint, null, f);
    log(nowStr() + "  [POST] " + endpoint + " HTTP " + r.status); return r;
  }
  async function createPostWithImage(endpoint, text, purpose, dataUrl){
    var b64 = stripDataUrl(dataUrl); if (!b64) return { ok: false, message: "画像がありません" };
    try {
      var isJpeg = b64IsJpeg(b64); var up = await s3Upload(b64, isJpeg ? "jpg" : "png", isJpeg ? "image/jpeg" : "image/png");
      log(nowStr() + "  [IMGPOST] S3 OK key=" + up.key);
      return okResult(await postToSeries(endpoint, text, purpose, up.bare, null, up.md5, "0"));
    } catch (e) { return { ok: false, message: "画像アップロード失敗: " + (e && e.message) }; }
  }
  async function createPostWithVoice(endpoint, dataUrl, ext, mime, text, purpose, playTime){
    var b64 = stripDataUrl(dataUrl); if (!b64) return { ok: false, message: "音声がありません" };
    try { var up = await s3Upload(b64, ext || "webm", mime || "audio/webm"); return okResult(await postToSeries(endpoint, text, purpose || "0", null, up.bare, null, playTime || "0")); }
    catch (e) { return { ok: false, message: "音声アップロード失敗: " + (e && e.message) }; }
  }
  var relCache = null, relAt = 0;
  async function friendRelationDelete(path, targetId, tag){
    if (!targetId) return { ok: false, message: "target_id不明" };
    var q = { target_id: targetId, version: "android_" + APP_VERSION, auth_token: state.token };
    var r = await http("DELETE", BASE + path, q); if (r.status === 404 || r.status >= 500) r = await http("DELETE", BASE2 + path, q);
    log(nowStr() + "  [FRIEND-REQ] " + tag + " " + path + " target=" + targetId + " -> " + r.status); relCache = null; return okResult(r, true);
  }
  async function fetchRelations(){
    if (relCache && Date.now() - relAt < 15000) return relCache;
    var f = { auth_token: state.token, version: "android_" + APP_VERSION, without_chat_id: "false", include_blocked_user: "true" };
    var r = await http("POST", BASE + "/api/v2/dive/relations", null, f); if (r.status === 404 || r.status >= 500 || r.status <= 0) r = await http("POST", BASE2 + "/api/v2/dive/relations", null, f);
    var d = null; if (r.status === 200 && r.body) { d = r.body.data; if (typeof d === "string") { try { d = JSON.parse(d); } catch (e) { d = null; } } if (!d || (!d.friends && !d.followers && !d.follows)) d = r.body; }
    relCache = d || null; relAt = Date.now(); return relCache;
  }
  function normUsers(arr){ return (arr || []).map(function(it){ var u = it.user_info || it.user || it.target_info || it; var id = Number(u.user_id || u.id || it.user_id || it.target_id || 0); return { user_id: id, name: u.nickname || u.name || ("user " + id), icon_url: iconUrl(u.profile_picture_file_path || u.profilePictureFilePath || ""), is_following: !!(u.is_followee || u.is_following), is_followed: !!(u.is_follower || u.is_followed), is_friend: !!u.is_friend, is_private: !!(u.settings && (u.settings.is_follow_list_public === false)) }; }); }
  async function relationsArray(key){
    var d = await fetchRelations(); if (!d) return [];
    var alt = key === "friends" ? ["friends", "friend", "friend_users"] : key === "followers" ? ["followers", "follower", "incoming", "incoming_requests"] : ["follows", "follow", "outgoing", "outgoing_requests", "followings"];
    var raw = null; for (var i = 0; i < alt.length && !raw; i++) if (Array.isArray(d[alt[i]])) raw = d[alt[i]];
    await ensureDefines(); return normUsers(raw || []);
  }
  function usersFrom(body, keys){
    var arr = null; var d = body && body.data;
    if (Array.isArray(d)) arr = d; else if (d && typeof d === "object") { arr = firstArray(d, keys.concat(["users", "user_info"])); }
    if (!arr && body) arr = firstArray(body, keys.concat(["users"])); return normUsers(arr || []);
  }
  async function toggleBookmark(id, removing, isTalk){
    var kinds = isTalk ? [["/api/bookmark_timeline_post", "/api/delete_timeline_post_bookmark", "timeline_post_id"], ["/api/bookmark_feed_post", "/api/delete_feed_post_bookmark", "feed_post_id"]] : [["/api/bookmark_feed_post", "/api/delete_feed_post_bookmark", "feed_post_id"], ["/api/bookmark_timeline_post", "/api/delete_timeline_post_bookmark", "timeline_post_id"]];
    var hosts = [BASE2, BASE]; var last = { status: 0 };
    for (var i = 0; i < kinds.length; i++) for (var h = 0; h < hosts.length; h++) { var k = kinds[i]; var q = { version: "android_" + APP_VERSION, auth_token: state.token }; q[k[2]] = id; var r = removing ? await http("DELETE", hosts[h] + k[1], q) : await http("POST", hosts[h] + k[0], q, {}); if (r.status >= 200 && r.status < 300) return okResult(r, true); last = r; }
    return okResult(last, true);
  }

  // ---- 画像・音声つき投稿 ----
  handlers.create_timeline_post_with_image = async function(a){ return await createPostWithImage("/api/feed_posts", a[0], "0", a[2]); };
  handlers.create_feed_post_with_image = async function(a){ return await createPostWithImage("/api/timeline_posts", a[0], "0", a[2]); };
  handlers.create_timeline_post_with_voice = async function(a){ return await createPostWithVoice("/api/feed_posts", a[0], a[1], a[2], a[3], "0", a[4] || "0"); };
  handlers.create_feed_post_with_voice = async function(a){ return await createPostWithVoice("/api/timeline_posts", a[0], a[1], a[2], a[3], "0", a[4] || "0"); };
  handlers.create_feed_post = async function(a){ return okResult(await postToSeries("/api/timeline_posts", a[0], a[1] || "0", null, null, null, "0")); };
  // ---- DM 添付 ----
  handlers.send_image_message = async function(a){
    var b64 = stripDataUrl(a[2]); if (!b64) return { ok: false, message: "画像がありません" };
    try { var isJpeg = b64IsJpeg(b64); var up = await s3Upload(b64, isJpeg ? "jpg" : "png", isJpeg ? "image/jpeg" : "image/png");
      var r = await http("POST", BASE + "/api/chat/messages", null, { target_id: a[1], chat_id: a[0], uid: String(state.userId), message_type: "2", binary_file_path: up.bare, md5: up.md5, version: "android_" + APP_VERSION, auth_token: state.token }); return okResult(r, true); }
    catch (e) { return { ok: false, message: String(e && e.message) }; }
  };
  handlers.send_voice_message = async function(a){
    var b64 = stripDataUrl(a[2]); if (!b64) return { ok: false, message: "音声がありません" };
    try { var up = await s3Upload(b64, a[3] || "webm", a[4] || "audio/webm");
      var r = await http("POST", BASE + "/api/chat/messages", null, { target_id: a[1], chat_id: a[0], uid: String(state.userId), message_type: "3", binary_file_path: up.bare, play_time: a[5] || "0", version: "android_" + APP_VERSION, auth_token: state.token }); log(nowStr() + "  [CHAT] voice送信 -> " + r.status); return okResult(r, true); }
    catch (e) { return { ok: false, message: String(e && e.message) }; }
  };
  // ---- 友達申請 ----
  handlers.send_friend_request = async function(a){ if (!a[0]) return { ok: false, message: "target_id不明" }; var f = { target_id: a[0], version: "android_" + APP_VERSION, auth_token: state.token }; var r = await http("POST", BASE + "/api/relation/follow", null, f); if (r.status === 404 || r.status >= 500) r = await http("POST", BASE2 + "/api/relation/follow", null, f); relCache = null; return okResult(r, true); };
  handlers.cancel_friend_request = async function(a){ return await friendRelationDelete("/api/relation/follows", a[0], "cancel"); };
  handlers.deny_friend_request = async function(a){ return await friendRelationDelete("/api/relation/followers", a[0], "deny"); };
  handlers.remove_friend = async function(a){ return await friendRelationDelete("/api/relation/friends", a[0], "remove"); };
  handlers.get_friend_requests_in = async function(){ return { ok: true, users: await relationsArray("followers") }; };
  handlers.get_friend_requests_out = async function(){ return { ok: true, users: await relationsArray("follows") }; };
  handlers.get_friends_list = async function(){ var friends = await relationsArray("friends"); friends.forEach(function(u){ u.is_friend = true; u.mutual = true; }); return { ok: true, friends: friends, mutual: [] }; };
  // ---- フォロー ----
  handlers.follow_user = async function(a){ var f = { target_id: a[0], version: "android_" + APP_VERSION, auth_token: state.token }; var r = await http("POST", BASE + "/api/followings", null, f); if (r.status < 200 || r.status >= 300) { var rb = await http("POST", BASE + "/api/relation/new_follow/following", f, null); if (rb.status >= 200 && rb.status < 300) r = rb; } relCache = null; return okResult(r, true); };
  handlers.unfollow_user = async function(a){ var q = { target_id: a[0], version: "android_" + APP_VERSION, auth_token: state.token }; var r = await http("DELETE", BASE + "/api/followings/" + a[0], q); if (r.status < 200 || r.status >= 300) { var r2 = await http("DELETE", BASE + "/api/relation/new_follow/following", q); if (r2.status >= 200 && r2.status < 300) r = r2; } relCache = null; return okResult(r, true); };
  handlers.remove_follower = async function(a){ if (!a[0]) return { ok: false, message: "target_id不明" }; var q = { target_id: a[0], version: "android_" + APP_VERSION, auth_token: state.token }; var r = await http("DELETE", BASE + "/api/relation/new_follow/follower", q); if (r.status === 404 || r.status >= 500) r = await http("DELETE", BASE2 + "/api/relation/new_follow/follower", q); relCache = null; return okResult(r, true); };
  handlers.get_followers = async function(a){ var uid = (a[0] && a[0] !== "null") ? a[0] : state.userId; var r = await httpApi2("GET", "/api/v2/users/" + uid + "/followers", { page: a[1] || "1" }); if (r.status !== 200 || !r.body) return { ok: false, status: r.status }; await ensureDefines(); var us = usersFrom(r.body, ["followers"]); if (Number(uid) === state.userId) us.forEach(function(u){ u.is_followed = true; }); return { ok: true, users: us }; };
  handlers.get_followees = async function(a){ var uid = (a[0] && a[0] !== "null") ? a[0] : state.userId; var r = await httpApi2("GET", "/api/v2/users/" + uid + "/followees", { page: a[1] || "1" }); if (r.status !== 200 || !r.body) return { ok: false, status: r.status }; await ensureDefines(); var us = usersFrom(r.body, ["followees"]); if (Number(uid) === state.userId) us.forEach(function(u){ u.is_following = true; u.requested = false; }); return { ok: true, users: us }; };
  handlers.get_follow_list = async function(a){ var sub = a[1] === "followers" ? "followers" : "followees"; var r = await httpApi2("GET", "/api/v2/users/" + a[0] + "/" + sub, { page: a[2] || "1" }); return okList(r, "users", ["users", sub]); };
  handlers.get_follow_requests = async function(){ var r = await request("GET", "/api/users/follow_requests", {}); if (r.status !== 200 || !r.body) return { ok: true, users: [], unavailable: true }; await ensureDefines(); return { ok: true, users: usersFrom(r.body, ["follow_requests", "requests"]) }; };
  handlers.get_mutuals = async function(){
    var me = state.userId; var fr = {}, seen = {}, out = [];
    for (var p = 1; p <= 5; p++) { var r1 = await httpApi2("GET", "/api/v2/users/" + me + "/followers", { page: String(p) }); var us = (r1.status === 200 && r1.body) ? usersFrom(r1.body, ["followers"]) : []; if (!us.length) break; us.forEach(function(u){ fr[u.user_id] = 1; }); if (us.length < 20) break; }
    await ensureDefines();
    for (var p2 = 1; p2 <= 5; p2++) { var r2 = await httpApi2("GET", "/api/v2/users/" + me + "/followees", { page: String(p2) }); var us2 = (r2.status === 200 && r2.body) ? usersFrom(r2.body, ["followees"]) : []; if (!us2.length) break; us2.forEach(function(u){ if (fr[u.user_id] && !seen[u.user_id]) { seen[u.user_id] = 1; u.is_following = true; u.is_followed = true; u.requested = false; out.push(u); } }); if (us2.length < 20) break; }
    return { ok: true, users: out };
  };
  // ---- ブックマーク ----
  handlers.toggle_timeline_bookmark = async function(a){ return await toggleBookmark(a[0], !!a[1], Number(a[2] == null ? 1 : a[2]) === 1); };
  handlers.toggle_feed_post_bookmark = async function(a){ return await toggleBookmark(a[0], !!a[1], false); };
  handlers.get_bookmarks = async function(a){ var q = { count: "30", version: "android_" + APP_VERSION, auth_token: state.token }; if (a[0] && a[0] !== "null") q.max_created_at = a[0]; var r = await http("GET", BASE2 + "/api/bookmark_posts", q); if (r.status !== 200) r = await http("GET", BASE + "/api/bookmark_posts", q); return await postsResult(r, "posts", true); };
  // ---- 投げ銭 ----
  handlers.get_item_packs = async function(){ var r = await request("GET", "/api/item_packs", {}); if (r.status !== 200 || !r.body) return { ok: false, status: r.status }; var d = r.body.data; var arr = (d && firstArray(d, ["item_packs", "items", "data"])) || firstArray(r.body, ["item_packs", "items", "data"]) || []; await ensureDefines(); return { ok: true, items: arr.map(function(it){ return { id: Number(it.item_id || it.id || 0), name: it.name || it.item_name || "", coin: Number(it.coin_amount || it.coin || it.point || 0), icon_url: iconUrl(it.image_file_path || it.thumbnail_file_path || it.icon_file_path || it.file_path || "") }; }) }; };
  handlers.do_tipping = async function(a){ var inRoom = !!(a[2] && a[2] !== "0"); var f = { target_id: a[1], item_pack_id: a[0], referer_id: inRoom ? "3" : "1" }; if (inRoom) f.room_id = a[2]; var r = await httpApi2("POST", "/api/tippings", null, f); log(nowStr() + "  [TIP] pack=" + a[0] + " to=" + a[1] + " HTTP " + r.status); return (r.status >= 200 && r.status < 300) ? { ok: true } : { ok: false, status: r.status, message: extractError(r.body) || "" }; };
  handlers.get_receive_tippings = async function(a){ var q = {}; if (a[0]) q.target_id = a[0]; return okList(await httpApi2("GET", "/api/receive_tippings", q), "tippings", ["tippings", "receive_tippings"]); };
  handlers.open_tipping = async function(a){ return okResult(await httpApi2("PUT", "/api/tippings/" + a[0] + "/open", null, null)); };
  handlers.open_all_tippings = async function(){ return okResult(await httpApi2("PUT", "/api/tippings/all/open", null, null)); };
  handlers.get_account_balance = async function(){ var r = await request("GET", "/api/v3/users/" + state.userId, {}); var u = (r.body && ((r.body.data && (r.body.data.user_info || r.body.data)) || r.body.user_info || r.body)) || {}; return { ok: r.status === 200, free_coin: Number(u.total_free_coin || 0), paid_coin: Number(u.total_paid_coin || 0), point: Number(u.total_point || 0) }; };
  // ---- ブロック・通報 ----
  handlers.block_user = async function(a){ return okResult(await request("POST", "/api/relation/block/regists", null, { target_id: a[0], version: "android_" + APP_VERSION, auth_token: state.token })); };
  handlers.unblock_user = async function(a){ return okResult(await request("POST", "/api/relation/block/deletes", null, { target_id: a[0], version: "android_" + APP_VERSION, auth_token: state.token })); };
  handlers.get_block_list = async function(){ var r = await request("GET", "/api/v2/blocked_users", { page: "1" }); if (r.status !== 200 || !r.body) return { ok: false, status: r.status }; await ensureDefines(); return { ok: true, users: usersFrom(r.body, ["blocked_users", "blocked_user_info", "block_users"]) }; };
  handlers.report_timeline_post = async function(a){ if (!a[0]) return { ok: false, message: "通報対象が不明です" }; var q = { target_id: a[0], content: a[1] || "通報", diagnostics_info: "", referer_id: "7", version: "android_" + APP_VERSION, auth_token: state.token }; var r = await http("POST", BASE + "/api/relation/user_report", q, null); return { ok: r.status >= 200 && r.status < 300, status: r.status, body: r.body }; };
  handlers.feed_post_bad_vote = async function(a){ if (!a[0]) return { ok: false }; var f = { version: "android_" + APP_VERSION, auth_token: state.token }; if (a[1]) f.reason = a[1]; var r = await http("POST", BASE + "/api/feed_posts/" + a[0] + "/bad_vote", null, f); if (r.status === 404 || r.status >= 500) r = await http("POST", BASE2 + "/api/feed_posts/" + a[0] + "/bad_vote", null, f); return okResult(r); };
  handlers.delete_feed_post_comment = async function(a){ var last = { status: 0 }; var hosts = [BASE, BASE2]; for (var i = 0; i < hosts.length; i++) { var r = await http("DELETE", hosts[i] + "/api/feed_posts/" + a[0] + "/comments/" + a[1], { version: "android_" + APP_VERSION, auth_token: state.token }); if (r.status >= 200 && r.status < 300) return okResult(r, true); last = r; } return okResult(last, true); };
  handlers.delete_own_timeline_post = async function(a){ var r = await http("DELETE", BASE + "/api/feed_posts/" + a[0], { version: "android_" + APP_VERSION, auth_token: state.token }); return okResult(r, true); };
  // ---- ユーザー探し・プロフィール編集 ----
  handlers.search_users = async function(a){ var q = { page: a[1] || "1" }; if (a[0]) { q.name = a[0]; q.consistency = "true"; } var r = await request("GET", "/api/v2/users/search", q); if (r.status !== 200 || !r.body) return { ok: false, status: r.status }; await ensureDefines(); return { ok: true, users: usersFrom(r.body, ["users", "user_info", "data"]) }; };
  handlers.get_recommended_users = async function(a){ var r = await request("GET", "/api/users/recommended", { page: a[0] || "1" }); if (r.status !== 200 || !r.body) return { ok: true, users: [], unavailable: true }; await ensureDefines(); return { ok: true, users: usersFrom(r.body, ["users", "recommended_users"]) }; };
  handlers.get_hima_users = async function(a){ var r = await request("GET", "/api/users/hima", { page: a[0] || "1" }); if (r.status !== 200 || !r.body) return { ok: true, users: [], unavailable: true }; await ensureDefines(); return { ok: true, users: usersFrom(r.body, ["users", "hima_users"]) }; };
  handlers.get_birthday_users = async function(a){ var r = await request("GET", "/api/users/birthday", { page: a[0] || "1" }); if (r.status !== 200 || !r.body) return { ok: true, users: [], unavailable: true }; await ensureDefines(); return { ok: true, users: usersFrom(r.body, ["users", "birthday_users"]) }; };
  handlers.update_profile = async function(a){ var r = await request("POST", "/api/account/profile_update", null, { name: a[0] || "", email: "", birthday: a[2] || "", comment: a[1] || "", referer_name: "", birthday_input_error: "" }); if (r.status >= 200 && r.status < 300 && a[2]) pref("birthday", a[2]); return okResult(r); };
  handlers.upload_account_image = async function(a){
    var b64 = stripDataUrl(a[0]); if (!b64) return { ok: false, message: "画像がありません" };
    try { var isJpeg = b64IsJpeg(b64); var up = await s3Upload(b64, isJpeg ? "jpg" : "png", isJpeg ? "image/jpeg" : "image/png"); var r = await request("POST", "/api/account/profile_picture", null, { profile_picture_file_path: up.bare, md5: up.md5 }); return okResult(r, true); }
    catch (e) { return { ok: false, message: String(e && e.message) }; }
  };
  // ---- DM の画像/音声(非公開バケット)に署名URLを付ける: get_messages を包む ----
  var _getMessages = K.handlers.get_messages;
  handlers.get_messages = async function(a){
    var res = await _getMessages(a); if (!res || !res.ok) return res;
    var r = await request("GET", "/api/messages", { chat_id: a[0], target_id: a[1], page: "1" });
    var arr = (r.body && (r.body.messages || (r.body.data && firstArray(r.body.data, ["messages", "chat_messages", "message", "data"])) || (Array.isArray(r.body.data) ? r.body.data : null))) || [];
    var byId = {}; arr.forEach(function(m){ if (m && m.id != null) byId[m.id] = m; });
    for (var i = 0; i < res.messages.length; i++) {
      var o = res.messages[i]; var m = byId[o.id]; if (!m) continue;
      var bin = firstStr(m, ["binary_file_path", "binaryFilePath"]);
      if (bin && (o.message_type === 2 || o.message_type === 3)) {
        var url = await s3Presign(bin, 900);
        if (url) { if (o.message_type === 3) { o.voice_url = url; if (o.text === "[音声]") o.text = ""; } else { o.image_url = url; if (o.text === "[画像]") o.text = ""; } }
      }
    }
    return res;
  };

  window.__koeIos.extend(handlers);
})();
