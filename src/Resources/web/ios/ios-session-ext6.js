/* iOS 版セッション層 第6段階(Android v1.08 相当):
   ・枠一覧に room_id / speaker_ids / listener_ids / opened_at を添える(入る前の参加者表示・知り合い絞り込み・時間順)
   ・get_followee_ids にフォロワー・友達(相互)の ID も添える
   ・公式の装飾(decoration_item_id → /api/decoration_items の画像、badge_image_file_path)を
     resolve_users / プロフィール / 枠の名簿 / 投稿に添える(deco_item / badge_url)
   Android 版 KoeSession の rememberAdornments / putAdornments / getDecorationItems と同じ規則。 */
(function(){
  var K = window.__koeIos && window.__koeIos._internals;
  if (!K) return;
  var state = K.state, request = K.request, httpApi2 = K.httpApi2, log = K.log, nowStr = K.nowStr, pref = K.pref, ensureDefines = K.ensureDefines, iconUrl = K.iconUrl, firstArray = K.firstArray, nameOf = K.nameOf, iconOf = K.iconOf, handlers = K.handlers;
  var h = {};

  /* ---- 装飾の記憶: user_id → [decoration_item_id, badge_image_file_path] ---- */
  var adorn = {};
  function rememberAdornments(uid, u){
    uid = Number(uid); if (!uid || !u) return;
    var item = (u.decoration_item_id != null && Number(u.decoration_item_id) > 0) ? String(Number(u.decoration_item_id)) : "";
    var badge = (u.badge_image_file_path && u.badge_image_file_path !== "null") ? String(u.badge_image_file_path) : "";
    /* 公式「タイムライン背景画像」: timeline_image_enabled のときだけ(投稿カードの背景 deco_url) */
    var tl = (u.timeline_image_enabled === true || u.timeline_image_enabled === 1 || u.timeline_image_enabled === "1" || u.timeline_image_enabled === "true") ? String(u.timeline_image_file_path || "") : "";
    if (tl === "null") tl = "";
    adorn[uid] = (!item && !badge && !tl) ? null : [item, badge, tl]; /* null = 確認済みで装飾なし(取り直さない) */
    /* 投稿するとき「いま着けている枠の番号」も一緒に送る(公式と同じ)。ext3 から読めるように外へ。 */
    if (uid === Number(state.userId)) window.__koeMyDeco = item;
  }
  /* 公式 ProfileAssetPaths.badgePath: バッジ画像は png サーバーの badge/ 配下 */
  function badgeUrl(raw){ if (!raw) return ""; if (/^https?:/.test(raw)) return raw; return iconUrl(raw.indexOf("badge/") === 0 ? raw : "badge/" + raw); }
  function putAdornments(out, uid){ var a = adorn[Number(uid)]; if (!a || !out) return out; if (a[0]) out.deco_item = Number(a[0]); if (a[1]) out.badge_url = badgeUrl(a[1]); if (a[2] && !out.deco_url) out.deco_url = iconUrl(a[2]); return out; }
  function usersOf(body){ return (body && (body.user_info || (body.data && body.data.user_info))) || []; }
  /* 名前解決のたびに装飾も覚える(元の resolveNames は名前だけなので、同じ応答をもう一度見る) */
  async function fetchUsers(ids){
    var need = []; (ids || []).forEach(function(id){ id = Number(id); if (id && need.indexOf(id) < 0) need.push(id); });
    var out = [];
    for (var i = 0; i < need.length; i += 20) {
      var r = await request("GET", "/api/v2/users", { ids: need.slice(i, i + 20).join(",") });
      var arr = usersOf(r.body);
      arr.forEach(function(u){ var id = Number(u.user_id || u.id || 0); if (!id) return; rememberAdornments(id, u); var nm = u.name || u.nickname || ""; if (nm) { state.nameCache[id] = [nm, u.profile_picture_file_path || ""]; } out.push(u); });
    }
    return out;
  }
  function idArray(src){ var out = []; (Array.isArray(src) ? src : []).forEach(function(o){ var v = (o && typeof o === "object") ? Number(o.user_id || o.userId || 0) : Number(o); if (v) out.push(v); }); return out; }

  /* ---- 公式 DecorationMaster 相当 ---- */
  h.get_decoration_items = async function(a){
    var force = !!a[0];
    try {
      var at = Number(pref("deco_items4_at") || 0), cached = pref("deco_items4") || "";
      if (!force && cached && Date.now() - at < 6 * 3600 * 1000) return { ok: true, items: JSON.parse(cached), cached: true };
    } catch (e) {}
    await ensureDefines();
    var r = await request("GET", "/api/decoration_items", { on_sale: "false" });
    if (r.status !== 200 || !r.body) { try { var c2 = pref("deco_items4"); if (c2) return { ok: true, items: JSON.parse(c2), cached: true }; } catch (e) {} return { ok: false, status: r.status }; }
    var d = r.body.data || r.body;
    var packs = (d && (d.item_packs || d.decoration_items)) || r.body.item_packs || [];
    var items = [];
    /* 装飾画像は png サーバーではなく公式アセット S3(assets.meetscom.com)直下の decoration/ にある(Android 版で実測) */
    var S3 = "https://s3-ap-northeast-1.amazonaws.com/assets.meetscom.com/";
    try { var csp = state.clientDefines && state.clientDefines.client_system_params; ["iap", "tipping"].forEach(function(k){ var b = csp && csp[k] && csp[k].item_thumbnail_server_name; if (b && b.indexOf("assets.meetscom.com") >= 0 && S3 === "https://s3-ap-northeast-1.amazonaws.com/assets.meetscom.com/") S3 = b; }); } catch (e) {}
    function decoAssetUrl(pth){ if (!pth) return ""; if (/^https?:/.test(pth)) return pth; return S3 + ((/\/$/.test(S3) || pth.charAt(0) === "/") ? "" : "/") + pth; }
    packs.forEach(function(p){ if (!p) return; var id = Number(p.id || 0), img = p.image_file_path || ""; if (id > 0 && img) items.push({ id: id, image_url: decoAssetUrl(img), icon_url: decoAssetUrl(img), name: p.name || "", price: p.price, is_new: !!p.is_new }); });
    if (items.length) { pref("deco_items4", JSON.stringify(items)); pref("deco_items4_at", String(Date.now())); }
    return { ok: true, items: items };
  };

  /* ---- resolve_users: 装飾つき ---- */
  h.resolve_users = async function(a){
    if (!a[0]) return { ok: true, users: [] };
    await ensureDefines();
    var arr = await fetchUsers(String(a[0]).split(","));
    return { ok: true, users: arr.map(function(u){ var id = Number(u.user_id || u.id || 0); return putAdornments({ user_id: id, name: u.name || "", icon_url: iconUrl(u.profile_picture_file_path || "") }, id); }) };
  };

  /* ---- フォロー中 + フォロワー + 友達(相互) の ID ---- */
  async function pageIds(kind){
    var me = state.userId, out = [];
    for (var p = 1; p <= 5; p++) {
      var r = await httpApi2("GET", "/api/v2/users/" + me + "/" + kind, { page: String(p) });
      if (r.status !== 200 || !r.body) break;
      var d = r.body.data, arr = Array.isArray(d) ? d : (d && firstArray(d, [kind, "users", "user_info"])) || firstArray(r.body, [kind, "users"]) || [];
      if (!arr.length) break;
      arr.forEach(function(u){ var x = (u && (u.user_info || u.user)) || u; var id = Number(x && (x.user_id || x.id) || 0); if (id && out.indexOf(id) < 0) out.push(id); });
      if (arr.length < 20) break;
    }
    return out;
  }
  var relAt = 0, relCache = null;
  h.get_followee_ids = async function(){
    if (relCache && Date.now() - relAt < 5 * 60 * 1000) return relCache;
    if (!state.userId) return { ok: false, error: "user_id未取得" };
    var fe = await pageIds("followees"), fr = await pageIds("followers");
    var friends = fe.filter(function(id){ return fr.indexOf(id) >= 0; });
    relCache = { ok: true, ids: fe, count: fe.length, followers: fr, friends: friends }; relAt = Date.now();
    return relCache;
  };

  /* ---- 枠一覧: room_id / 参加者ID / 開始時刻 / 主催者の装飾 ---- */
  var baseList = handlers.list_group_rooms;
  h.list_group_rooms = async function(a){
    var r = await request("GET", "/api/rooms", { page: a[0] || "1", order: "1" });
    if (r.status !== 200 || !r.body) return { ok: false, status: r.status };
    var d = r.body.data; var arr = Array.isArray(d) ? d : (d && (d.rooms || d.talk_rooms)) || [];
    await ensureDefines();
    var owners = arr.map(function(o){ return Number(o.owner || o.owner_user_id || 0); });
    await fetchUsers(owners.filter(function(id){ return id && !(state.nameCache[id] && state.nameCache[id][0] && adorn[id] !== undefined); }));
    return { ok: true, rooms: arr.map(function(o){
      var oid = Number(o.owner || o.owner_user_id || 0); var sp = idArray(o.speakers), li = idArray(o.listeners);
      /* 公式 TalkRoom: id / owner / speakers[int] / listeners[int] / opened_at / close_at / comment_enabled */
      return putAdornments({ id: o.id || o.room_id, room_id: Number(o.id || o.room_id || 0), owner_user_id: oid, owner_name: nameOf(oid), owner_icon: iconOf(oid), title: o.description || ("user " + oid + " のルーム"), speaker_count: sp.length, listener_count: li.length, member_count: sp.length + li.length, speaker_ids: sp, listener_ids: li, created_at: o.opened_at || o.created_at || o.started_at || o.created_time || "", comment_enabled: o.comment_enabled !== false, is_public: o.is_public }, oid);
    }) };
  };

  /* ---- 既存ハンドラの結果に装飾を添える(名簿・プロフィール・投稿) ---- */
  function wrapWithAdorn(name, fn){
    var base = handlers[name]; if (!base) return;
    h[name] = async function(a){ var res = await base(a); try { await fn(res); } catch (e) {} return res; };
  }
  async function adornList(list){ if (!Array.isArray(list) || !list.length) return; var ids = list.map(function(u){ return Number(u.user_id || 0); }).filter(function(id){ return id && adorn[id] === undefined; }); if (ids.length) await fetchUsers(ids); list.forEach(function(u){ putAdornments(u, u.user_id); }); }
  wrapWithAdorn("refresh_room_state", async function(res){ if (!res || !res.ok) return; await adornList(res.speakers); await adornList(res.listeners); await adornList(res.speaker_applicants); });
  ["join_call", "join_room_by_id"].forEach(function(n){
    wrapWithAdorn(n, async function(res){ if (!res || !res.ok) return; if (res.call) await adornList(res.call.participants); await adornList(res.speakers); await adornList(res.listeners); });
  });
  wrapWithAdorn("view_user_profile", async function(res){ if (!res || !res.ok || !res.profile) return; var uid = Number(res.profile.user_id); if (adorn[uid] === undefined) await fetchUsers([uid]); putAdornments(res.profile, uid); });
  wrapWithAdorn("get_my_profile", async function(res){ if (!res || !res.ok || !res.profile) return; var uid = Number(res.profile.user_id || state.userId); if (adorn[uid] === undefined) await fetchUsers([uid]); putAdornments(res.profile, uid); });
  ["get_timeline", "get_following_timeline", "get_user_posts", "get_feed_posts", "get_bookmarks"].forEach(function(n){
    wrapWithAdorn(n, async function(res){ if (!res || !res.ok || !Array.isArray(res.posts)) return; var ids = res.posts.map(function(p){ return Number(p.user_id || 0); }).filter(function(id){ return id && adorn[id] === undefined; }); if (ids.length) await fetchUsers(ids); res.posts.forEach(function(p){ putAdornments(p, p.user_id); }); });
  });

  /* ---- 相手のプロフィールの「もらったギフト」(公式 TargetPage.getRecentGift: GET api/receive_tippings?target_id=) ---- */
  function tippingAssetUrl(path){
    if (!path || path === "null") return ""; if (/^https?:/.test(path)) return path;
    try { var csp = state.clientDefines && state.clientDefines.client_system_params; var base = csp && csp.tipping && csp.tipping.item_thumbnail_server_name; if (base) return base + ((/\/$/.test(base) || path.charAt(0) === "/") ? "" : "/") + path; } catch (e) {}
    return iconUrl(path);
  }
  h.get_recent_gifts = async function(a){
    if (!a[0]) return { ok: false, message: "target_id不明" };
    await ensureDefines();
    var r = await httpApi2("GET", "/api/receive_tippings", { target_id: String(a[0]) });
    if (r.status !== 200 || !r.body) return { ok: false, status: r.status };
    var d = r.body.data || r.body; var arr = firstArray(d, ["tippings", "receive_tippings"]) || firstArray(r.body, ["tippings", "receive_tippings"]) || [];
    return { ok: true, gifts: arr.slice(0, 50).map(function(t){ var sd = t.sender_info || {}; return { id: t.id, item_id: Number(t.item_id || 0), name: t.item_name || "", image_url: tippingAssetUrl(t.item_image_file_path || ""), is_open: t.is_open !== false, sender_id: Number(sd.id || sd.user_id || 0), sender_name: sd.name || "", created_at: t.created_at || "" }; }) };
  };

  window.__koeIos.extend(h);
  log(nowStr() + "  [EXT6] loaded (adornments / room ids / relation ids)" + (baseList ? "" : " (list_group_rooms base missing)"));
})();
