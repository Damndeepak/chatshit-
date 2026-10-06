/* Supabase bridge for the shared community room, stories, profiles, Notes and media. */
(function () {
  "use strict";
  const config = window.CHATSHIT_BACKEND || {};
  const configured = Boolean(config.url && config.publishableKey);
  let client = null;
  let userId = null;
  const mediaBucket = "chatshit-media";

  async function ensureClient() {
    if (!configured) return null;
    if (client) return client;
    if (!window.supabase) {
      await new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
        script.onload = resolve;
        script.onerror = () => reject(new Error("Could not load the chat connection library."));
        document.head.appendChild(script);
      });
    }
    if (!window.supabase) throw new Error("The chat connection library did not start.");
    client = window.supabase.createClient(config.url, config.publishableKey);
    return client;
  }

  async function connect(displayName) {
    if (!configured) return { configured: false, connected: false };
    await ensureClient();
    let { data, error } = await client.auth.getSession();
    if (error) throw error;
    if (!data.session) {
      const result = await client.auth.signInAnonymously({ options: { data: { display_name: displayName || "Someone" } } });
      data = result.data;
      error = result.error;
      if (error) throw error;
    }
    userId = data.session?.user?.id || data.user?.id || null;
    if (!userId) throw new Error("Could not start an anonymous chat session.");
    return { configured: true, connected: true, userId };
  }

  async function signedMediaUrl(path) {
    if (!path) return "";
    const { data, error } = await client.storage.from(mediaBucket).createSignedUrl(path, 7 * 24 * 60 * 60);
    if (error) throw error;
    return data.signedUrl;
  }

  async function mapMessage(row) {
    const imageUrl = await signedMediaUrl(row.image_path);
    return { id: row.id, userId: row.user_id, displayName: row.display_name, text: row.body, imagePath: row.image_path || "", imageUrl, kind: row.image_path ? "image" : "text", time: new Date(row.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }), createdAt: new Date(row.created_at).getTime(), from: row.user_id === userId ? "me" : "them" };
  }

  async function mapStory(row) {
    const imageUrl = await signedMediaUrl(row.image_path);
    return { id: row.id, userId: row.user_id, displayName: row.display_name, caption: row.caption || "", imagePath: row.image_path || "", imageUrl, createdAt: row.created_at, expiresAt: row.expires_at };
  }

  async function loadMessages() {
    const { data, error } = await client.from("global_messages").select("id,user_id,display_name,body,image_path,created_at").order("created_at", { ascending: false }).limit(100);
    if (error) throw error;
    return Promise.all((data || []).reverse().map(mapMessage));
  }

  async function loadStories() {
    const { error: cleanupError } = await client.rpc("cleanup_expired_chatshit_stories");
    if (cleanupError) throw cleanupError;
    const { data, error } = await client.from("global_stories").select("id,user_id,display_name,caption,image_path,created_at,expires_at").gt("expires_at", new Date().toISOString()).order("created_at", { ascending: true }).limit(100);
    if (error) throw error;
    return Promise.all((data || []).map(mapStory));
  }

  async function uploadImage(file, folder) {
    if (!userId) throw new Error("Your community profile is still connecting.");
    if (!file || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("Choose a JPEG, PNG or WebP image.");
    if (file.size > 5 * 1024 * 1024) throw new Error("Images must be smaller than 5 MB.");
    const extension = file.type === "image/jpeg" ? "jpg" : file.type === "image/png" ? "png" : "webp";
    const nonce = window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
    const path = userId + "/" + folder + "/" + nonce + "." + extension;
    const { error } = await client.storage.from(mediaBucket).upload(path, file, { cacheControl: "3600", contentType: file.type, upsert: false });
    if (error) throw error;
    return { path };
  }

  async function removeMedia(path) {
    if (!path) return;
    const { error } = await client.storage.from(mediaBucket).remove([path]);
    if (error) throw error;
  }

  async function createStory(caption, imagePath, displayName) {
    if (!userId) throw new Error("Stories are still connecting.");
    if (!caption && !imagePath) throw new Error("Add a photo or a caption.");
    const { data, error } = await client.from("global_stories").insert({ user_id: userId, display_name: displayName || "Someone", caption: caption || null, image_path: imagePath || null }).select("id,user_id,display_name,caption,image_path,created_at,expires_at").single();
    if (error) throw error;
    return mapStory(data);
  }

  async function deleteStory(storyId, imagePath) {
    if (!userId) throw new Error("Stories are still connecting.");
    const { error } = await client.from("global_stories").delete().eq("id", storyId).eq("user_id", userId);
    if (error) throw error;
    if (imagePath) {
      try { await removeMedia(imagePath); }
      catch (error) { console.warn("The expired story image could not be removed yet.", error); }
    }
  }

  async function loadNotes() {
    const { data, error } = await client.from("global_notes").select("user_id,display_name,body,music_url,expires_at,updated_at").gt("expires_at", new Date().toISOString()).order("updated_at", { ascending: false }).limit(50);
    if (error) throw error;
    return (data || []).map(row => ({ userId: row.user_id, name: row.display_name, text: row.body, musicUrl: row.music_url, expiresAt: row.expires_at }));
  }

  async function loadProfiles() {
    let rows = [];
    let offset = 0;
    const pageSize = 500;
    while (true) {
      const { data, error } = await client.from("profiles").select("user_id,display_name,created_at").order("display_name", { ascending: true }).order("user_id", { ascending: true }).range(offset, offset + pageSize - 1);
      if (error) throw error;
      rows = rows.concat(data || []);
      if (!data || data.length < pageSize) break;
      offset += pageSize;
    }
    return rows.map(row => ({ userId: row.user_id, displayName: row.display_name, createdAt: row.created_at }));
  }

  async function saveProfile(displayName) {
    if (!userId) throw new Error("Your community profile is still connecting.");
    const cleanName = String(displayName || "Someone").trim().slice(0, 28) || "Someone";
    const { error } = await client.from("profiles").upsert({ user_id: userId, display_name: cleanName, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    if (error) throw error;
  }

  function subscribe(onMessage, onNote, onProfile, onStory) {
    if (!client) return function () {};
    const channel = client.channel("chatshit-community-room")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "global_messages" }, payload => {
        mapMessage(payload.new).then(onMessage).catch(error => console.warn("A shared image could not be loaded.", error));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "global_notes" }, onNote)
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, function () { if (onProfile) onProfile(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "global_stories" }, function () { if (onStory) onStory(); })
      .subscribe();
    return function () { client.removeChannel(channel); };
  }

  async function sendMessage(text, displayName, imagePath) {
    if (!userId) throw new Error("The shared chat is still connecting.");
    if (!text && !imagePath) throw new Error("Write a message or attach an image.");
    const { data, error } = await client.from("global_messages").insert({ user_id: userId, display_name: displayName || "Someone", body: text || "Photo", image_path: imagePath || null }).select("id,user_id,display_name,body,image_path,created_at").single();
    if (error) throw error;
    return mapMessage(data);
  }

  async function saveNote(text, musicUrl, displayName) {
    if (!userId) throw new Error("Notes are still connecting.");
    if (!text) {
      const { error } = await client.from("global_notes").delete().eq("user_id", userId);
      if (error) throw error;
      return;
    }
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const { error } = await client.from("global_notes").upsert({ user_id: userId, display_name: displayName || "Someone", body: text, music_url: musicUrl || null, expires_at: expiresAt, updated_at: new Date().toISOString() });
    if (error) throw error;
  }

  window.ChatshitCloud = { configured, connect, loadMessages, loadStories, loadNotes, loadProfiles, saveProfile, subscribe, sendMessage, uploadImage, removeMedia, createStory, deleteStory, saveNote, get userId() { return userId; } };
})();
