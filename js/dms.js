/* Chatshit — lightweight, local-first DM interface. */
(function(){
  "use strict";
  const STORAGE_KEY="chatshit_conversations_v1";
  const THEME_KEY="chatshit_theme_v1";
  const NOTE_KEY="chatshit_note_v1";
  const colors=["violet","peach","mint","blue","rose","gold","cyan"];
  const seed=[
    {id:"everyone",name:"Everyone",username:"PUBLIC ROOM",color:"violet",online:true,story:"",unread:0,group:true,pinned:true,messages:[
      {from:"them",displayName:"Chatshit",text:"Welcome to the big room 💌 Say hi to everyone here.",time:"Just now"}
    ]},
    {id:"maya",name:"Maya Chen",username:"@mayac",color:"violet",online:true,story:"Taking the long way home today ☁️",unread:2,group:false,messages:[
      {from:"them",text:"hey you 🌿",time:"10:18 AM"},
      {from:"me",text:"Maya! I was literally just thinking about you",time:"10:20 AM"},
      {from:"them",text:"The little bookshop on Willow is doing their Sunday poetry thing again. We should go?",time:"10:22 AM"},
      {from:"me",text:"That sounds like the exact kind of Sunday I need ✨",time:"10:23 AM"},
      {from:"them",text:"I’ll save you the window seat. Coffee’s on me ☕",time:"10:24 AM"}
    ]},
    {id:"leo",name:"Leo Martinez",username:"@leomakes",color:"peach",online:true,story:"Made something weird today",unread:1,group:false,messages:[
      {from:"them",text:"sent you the playlist!!",time:"9:42 AM"},
      {from:"me",text:"Already on track three. You know me too well.",time:"9:44 AM"}
    ]},
    {id:"sunday-club",name:"Sunday Club",username:"4 people",color:"mint",online:false,story:"Our favorite corner table",unread:0,group:true,messages:[
      {from:"them",text:"Nina: same time, same place? 🌞",time:"Yesterday"},
      {from:"me",text:"Wouldn’t miss it.",time:"Yesterday"}
    ]},
    {id:"nina",name:"Nina Park",username:"@ninapark",color:"blue",online:false,story:"New film, same obsession",unread:0,group:false,messages:[
      {from:"them",text:"I found the photo booth we were looking for!",time:"Yesterday"}
    ]},
    {id:"ari",name:"Ari Okafor",username:"@ari.ok",color:"rose",online:true,story:"Sunset walk anyone?",unread:0,group:false,messages:[
      {from:"me",text:"You were right about the little cafe.",time:"Mon"},
      {from:"them",text:"I’m always right about pastries 🥐",time:"Mon"}
    ]},
    {id:"sam",name:"Sam Rivera",username:"@samrivera",color:"gold",online:false,story:"A soft launch of my garden",unread:0,group:false,messages:[
      {from:"them",text:"Look at this tiny tomato 🌱",time:"Sun"}
    ]},
    {id:"ro",name:"Ro Kim",username:"@rokim",color:"cyan",online:true,story:"Borrowed a dog for the afternoon",unread:0,group:false,messages:[
      {from:"them",text:"You have to meet Potato",time:"Sat"}
    ]}
  ];
  const emojis=["♡","✨","😂","🥹","🌿","☕","🫶","🌸","🔥","💌","☁️","🍰"];
  const exampleNotes=[
    {name:"Maya",color:"violet",text:"slow mornings, loud playlists",musicUrl:"https://music.youtube.com/watch?v=6PfCzo9Oobg"},
    {name:"Leo",color:"peach",text:"send me your current song",musicUrl:""},
    {name:"Nina",color:"blue",text:"outside until the streetlights",musicUrl:""}
  ];
  let conversations=loadConversations();
  let activeId=conversations[0].id;
  let activeFilter="all";
  let toastTimer;
  let typingTimer;
  let currentStory=null;
  let cloudConnected=false;
  let cloudNotes=[];
  let cloudProfiles=[];
  let profileDirectoryError="";
  let spotifyNowPlaying=null;
  let spotifyConnected=false;
  let myNote=loadMyNote();
  let installPrompt=null;
  let unsubscribeCloud=null;
  const identity=window.ChatshitIdentity.get()||window.ChatshitIdentity.create();

  const $=function(selector,root){return (root||document).querySelector(selector);};
  const $$=function(selector,root){return Array.from((root||document).querySelectorAll(selector));};
  const node=function(tag,className,text){
    const element=document.createElement(tag);
    if(className)element.className=className;
    if(text!==undefined)element.textContent=text;
    return element;
  };
  function loadConversations(){
    try{
      const saved=localStorage.getItem(STORAGE_KEY);
      if(saved){
        const parsed=JSON.parse(saved);
        if(Array.isArray(parsed)&&parsed.length){
          if(!parsed.some(function(item){return item.id==="everyone";}))parsed.unshift(JSON.parse(JSON.stringify(seed[0])));
          return parsed;
        }
      }
    }catch(error){
      try{localStorage.removeItem(STORAGE_KEY);}catch(ignored){}
    }
    return seed.map(function(item){return JSON.parse(JSON.stringify(item));});
  }
  function loadMyNote(){
    try{const saved=JSON.parse(localStorage.getItem(NOTE_KEY)||"null");if(saved&&saved.expiresAt&&Date.parse(saved.expiresAt)<Date.now()){localStorage.removeItem(NOTE_KEY);return null;}return saved&&typeof saved==="object"?saved:null;}catch(error){return null;}
  }
  function saveConversations(){
    try{localStorage.setItem(STORAGE_KEY,JSON.stringify(conversations));}
    catch(error){showToast("This browser is full. Your latest message is still on screen.");}
  }
  function saveMyNote(){try{if(myNote)localStorage.setItem(NOTE_KEY,JSON.stringify(myNote));else localStorage.removeItem(NOTE_KEY);}catch(error){}}
  function initials(name){return name.trim().split(/\s+/).slice(0,2).map(function(part){return part.charAt(0);}).join("").toUpperCase()||"?"}
  function findConversation(id){return conversations.find(function(item){return item.id===id;})||conversations[0]}
  function currentConversation(){return findConversation(activeId)}
  function lastMessage(person){return person.messages[person.messages.length-1]||{text:"Say hello when you’re ready",time:""}}
  function messagePreview(person){
    const message=lastMessage(person);
    return (message.from==="me"?"You: ":"")+((message.kind==="image")?"Sent a photo":message.text||"Liked a message");
  }
  function sortConversations(){
    return conversations.slice().sort(function(a,b){
      if(a.pinned&&!b.pinned)return -1;
      if(b.pinned&&!a.pinned)return 1;
      const aTime=a.messages.length?a.messages[a.messages.length-1].createdAt||0:0;
      const bTime=b.messages.length?b.messages[b.messages.length-1].createdAt||0:0;
      if(aTime&&bTime)return bTime-aTime;
      if(aTime)return -1;
      if(bTime)return 1;
      return conversations.indexOf(a)-conversations.indexOf(b);
    });
  }
  function avatar(person,extraClass){
    const element=node("span","avatar avatar-"+(person.color||"violet")+(extraClass?" "+extraClass:""),initials(person.name));
    element.setAttribute("aria-hidden","true");
    if(person.online)element.appendChild(node("i","online-dot"));
    return element;
  }
  function formatNow(){
    return new Intl.DateTimeFormat(undefined,{hour:"numeric",minute:"2-digit"}).format(new Date());
  }
  function syncIdentity(){
    const display=identity.nickname||identity.username||"you";
    const first=initials(display).slice(0,1);
    $("#selfName").textContent=display;
    $("#selfHandle").textContent="@"+(identity.username||"here_for_a_bit").replace(/^@/,"");
    $("#selfAvatar").textContent=first;
    $("#mobileSelfAvatar").textContent=first;
    $("#profileEditAvatar").textContent=first;
    $("#profileName").value=identity.nickname||"";
  }
  function renderStories(){
    const strip=$("#storiesStrip");
    strip.replaceChildren();
    const own=node("button","story-button story-own");
    own.type="button";
    const ring=node("span","story-ring");
    ring.appendChild(avatar({name:identity.nickname||identity.username||"You",color:"me"}));
    own.appendChild(ring);
    own.appendChild(node("span","story-label","Your story"));
    own.addEventListener("click",openOwnStory);
    strip.appendChild(own);
    conversations.filter(function(person){return person.story;}).slice(0,6).forEach(function(person){
      const button=node("button","story-button");
      button.type="button";
      button.setAttribute("aria-label","View "+person.name+"'s story");
      const storyRing=node("span","story-ring");
      storyRing.appendChild(avatar(person));
      button.appendChild(storyRing);
      button.appendChild(node("span","story-label",person.name.split(" ")[0]));
      button.addEventListener("click",function(){openStory(person);});
      strip.appendChild(button);
    });
  }
  function renderNotes(){
    const strip=$("#notesStrip");
    if(!strip)return;
    strip.replaceChildren();
    const selfName=identity.nickname||identity.username||"You";
    const savedSelf=cloudConnected?cloudNotes.find(function(note){return note.userId===window.ChatshitCloud.userId;}):null;
    const own=savedSelf||myNote;
    const entries=[{self:true,name:"You",color:"me",text:own&&own.text||"Drop a little thought…",musicUrl:own&&own.musicUrl||"",nowPlaying:spotifyNowPlaying}];
    const others=cloudConnected?cloudNotes.filter(function(note){return note.userId!==window.ChatshitCloud.userId;}).map(function(note,index){return {name:note.name,color:colors[index%colors.length],text:note.text,musicUrl:note.musicUrl||""};}):exampleNotes;
    others.slice(0,5).forEach(function(note){entries.push(note);});
    entries.forEach(function(entry){
      const card=node("article","note-person"+(entry.self?" is-self":"")+(entry.self&&entry.nowPlaying?" is-listening":""));
      const bubble=node("button","note-bubble"+(entry.self&&!own?" note-empty":""));
      bubble.type="button";
      bubble.setAttribute("aria-label",entry.self?"Add or edit your note":"View "+entry.name+"'s note");
      bubble.appendChild(node("span","note-copy",entry.text));
      if(entry.self)bubble.addEventListener("click",openNoteEditor);
      else bubble.addEventListener("click",function(){showToast(entry.name+" shared a little note with everyone.");});
      card.appendChild(bubble);
      const safeMusicUrl=validMusicUrl(entry.musicUrl||"");
      if(safeMusicUrl){
        const music=node("a","note-music-link","♫ song");
        music.href=safeMusicUrl;
        music.target="_blank";
        music.rel="noopener noreferrer";
        music.setAttribute("aria-label","Open song link from "+entry.name+"'s note");
        card.appendChild(music);
      }
      if(entry.self&&entry.nowPlaying){
        const live=node("a","note-now-playing");
        live.href=entry.nowPlaying.url;
        live.target="_blank";
        live.rel="noopener noreferrer";
        live.setAttribute("aria-label","Open currently playing track on Spotify: "+entry.nowPlaying.title);
        if(entry.nowPlaying.image){
          const cover=node("img","note-now-playing-art");
          cover.src=entry.nowPlaying.image;
          cover.alt="";
          cover.loading="lazy";
          live.appendChild(cover);
        }
        const liveCopy=node("span","note-now-playing-copy");
        liveCopy.appendChild(node("strong","",entry.nowPlaying.title));
        liveCopy.appendChild(node("small","",entry.nowPlaying.artist||"Now playing"));
        liveCopy.appendChild(node("span","spotify-wordmark","LISTENING ON SPOTIFY"));
        live.appendChild(liveCopy);
        card.appendChild(live);
      }
      const person=node("div","note-person-line");
      const face=node("span","avatar avatar-"+(entry.color||"violet"),entry.self?initials(selfName).slice(0,1):initials(entry.name).slice(0,1));
      person.appendChild(face);
      person.appendChild(node("span","note-person-name",entry.self?"You":entry.name.split(" ")[0]));
      card.appendChild(person);
      strip.appendChild(card);
    });
  }

  function syncSpotifyControls(state,shouldRender){
    state=state||{};
    spotifyConnected=Boolean(state.connected);
    spotifyNowPlaying=state.track||null;
    const status=$("#spotifyConnectionState");
    const hint=$("#spotifyConnectionHint");
    const connect=$("#spotifyConnectButton");
    const disconnect=$("#spotifyDisconnectButton");
    const share=$("#spotifyUseTrackButton");
    if(!status)return;
    status.textContent=state.error?"Needs attention":(spotifyConnected?(spotifyNowPlaying?"Listening now":"Connected"):"Not connected");
    hint.textContent=state.error||((window.CHATSHIT_BACKEND&&window.CHATSHIT_BACKEND.spotifyClientId)?(spotifyConnected?"Live playback is private to this device.":"See your live track here, then choose if you want to share its link."):"Add your Spotify Client ID in js/cloud-config.js to connect.");
    connect.hidden=spotifyConnected;
    disconnect.hidden=!spotifyConnected;
    share.disabled=!spotifyNowPlaying;
    if(shouldRender!==false)renderNotes();
  }

  function openNoteEditor(){
    const note=savedOwnNote();
    $("#noteText").value=note&&note.text||"";
    $("#noteMusicUrl").value=note&&note.musicUrl||"";
    $("#noteVisibilityHint").textContent=cloudConnected?"Your note is public for everyone here for 24 hours.":"Preview mode: this note saves on this device until the shared backend is connected.";
    if(window.ChatshitSpotify)syncSpotifyControls(window.ChatshitSpotify.getState(),false);
    $("#noteDialog").showModal();
    $("#noteText").focus();
  }

  function savedOwnNote(){
    return (cloudConnected&&cloudNotes.find(function(note){return note.userId===window.ChatshitCloud.userId;}))||myNote;
  }

  function validMusicUrl(value){
    if(!value)return "";
    try{
      const url=new URL(value.trim());
      const allowed=["music.youtube.com","youtube.com","www.youtube.com","m.youtube.com","youtu.be","open.spotify.com"];
      return url.protocol==="https:"&&allowed.includes(url.hostname.toLowerCase())?url.href:null;
    }catch(error){return null;}
  }
  function renderConversations(){
    const list=$("#conversationList");
    const query=$("#searchInput").value.trim().toLowerCase();
    const people=sortConversations().filter(function(person){
      const matches=(person.name+" "+person.username+" "+messagePreview(person)).toLowerCase().includes(query);
      const correctFilter=activeFilter==="all"||(activeFilter==="unread"&&person.unread>0)||(activeFilter==="groups"&&person.group);
      return matches&&correctFilter;
    });
    list.replaceChildren();
    if(!people.length){
      list.appendChild(node("div","list-empty",query?"No chats match that search. Try another name.":"It’s quiet in here. Start a new conversation ✨"));
    }
    people.forEach(function(person){
      const button=node("button","conversation-item"+(person.id===activeId?" is-active":"")+(person.unread?" is-unread":""));
      button.type="button";
      button.setAttribute("role","listitem");
      button.setAttribute("aria-current",person.id===activeId?"true":"false");
      button.appendChild(avatar(person));
      const copy=node("span","conversation-copy");
      const topline=node("span","conversation-topline");
      topline.appendChild(node("span","conversation-name",person.name));
      topline.appendChild(node("span","conversation-time",lastMessage(person).time||"now"));
      copy.appendChild(topline);
      copy.appendChild(node("span","conversation-preview",messagePreview(person)));
      button.appendChild(copy);
      const trailing=node("span","conversation-trailing");
      if(person.unread)trailing.appendChild(node("span","unread-badge",String(person.unread)));
      else if(person.group)trailing.appendChild(node("span","conversation-group","group"));
      button.appendChild(trailing);
      button.addEventListener("click",function(){openConversation(person.id);});
      list.appendChild(button);
    });
    const unread=conversations.reduce(function(total,person){return total+person.unread;},0);
    $("#navUnread").textContent=unread?String(Math.min(unread,9)):"";
    $("#navUnread").hidden=!unread;
    $("#allCount").textContent=String(conversations.length);
  }
  function renderHeader(){
    const person=currentConversation();
    if(!person)return;
    $("#chatPersonName").textContent=person.name;
    $("#chatPersonStatus").replaceChildren();
    if(person.id==="everyone"){
      const orb=node("span","status-orb"+(cloudConnected?"":" is-offline"));
      $("#chatPersonStatus").appendChild(orb);
      $("#chatPersonStatus").appendChild(document.createTextNode(cloudConnected?"Live community room":"Preview · backend setup needed"));
      $("#chatStorageLabel").textContent=cloudConnected?"Live with everyone":"Preview only · not shared yet";
      $("#chatHandle").textContent="ONE GLOBAL ROOM";
      $("#messageInput").placeholder="Say hello to everyone…";
    }else if(person.online){
      $("#chatPersonStatus").appendChild(node("span","status-orb"));
      $("#chatPersonStatus").appendChild(document.createTextNode("Active now"));
      $("#chatStorageLabel").textContent="Your messages live in this browser";
      $("#chatHandle").textContent=person.username;
      $("#messageInput").placeholder="Write something nice…";
    }else{
      $("#chatPersonStatus").textContent="Around recently";
      $("#chatStorageLabel").textContent="Your messages live in this browser";
      $("#chatHandle").textContent=person.username;
      $("#messageInput").placeholder="Write something nice…";
    }
    const headerAvatar=$("#chatPersonAvatar");
    headerAvatar.className="avatar avatar-"+(person.color||"violet");
    headerAvatar.textContent=initials(person.name);
    if(person.online&&(person.id!=="everyone"||cloudConnected))headerAvatar.appendChild(node("i","online-dot"));
    $("#detailAvatar").className="avatar avatar-large avatar-"+(person.color||"violet");
    $("#detailAvatar").textContent=initials(person.name);
    $("#detailName").textContent=person.name;
    $("#detailHandle").textContent=person.username;
    $("#detailStatus").textContent=person.id==="everyone"?(cloudConnected?"Live shared room":"Preview only"):(person.online?"Online now":"Around recently");
    const safetyTitle=$(".safety-note strong");
    const safetyCopy=$(".safety-note p");
    if(person.id==="everyone"){
      safetyTitle.textContent=cloudConnected?"Public community chat":"Preview mode";
      safetyCopy.textContent=cloudConnected?"Messages are visible to everyone in this room. Don’t share private information.":"Messages won’t reach other people until the shared backend is connected.";
    }else{
      safetyTitle.textContent="Local preview";
      safetyCopy.textContent="Messages save in this browser only. They are not encrypted or delivered to another person.";
    }
  }
  function renderMessages(){
    const person=currentConversation();
    if(!person)return;
    renderHeader();
    const thread=$("#messageThread");
    thread.replaceChildren();
    if(!person.messages.length){
      const welcome=node("div","empty-chat");
      const content=node("div","");
      const art=node("div","empty-chat-art");
      art.innerHTML='<svg class="icon"><use href="#i-chat"/></svg>';
      content.appendChild(art);
      content.appendChild(node("h2","","A new little corner."));
      content.appendChild(node("p","","This is the start of your conversation with "+person.name+". Send the first hello whenever you’re ready."));
      welcome.appendChild(content);
      thread.appendChild(welcome);
      renderConversations();
      return;
    }
    thread.appendChild(node("div","date-divider",person.id==="everyone"?"THE WHOLE ROOM, RIGHT HERE":"TODAY"));
    person.messages.forEach(function(message,index){
      const outgoing=message.from==="me";
      const row=node("article","message-row "+(outgoing?"outgoing":"incoming"));
      const messagePerson=person.id==="everyone"?{name:message.displayName||"Someone",color:colors[(message.displayName||"S").charCodeAt(0)%colors.length]}:person;
      if(!outgoing)row.appendChild(avatar(messagePerson));
      const stack=node("div","message-stack");
      const tools=node("div","bubble-tools");
      const react=node("button","bubble-tool");
      react.type="button";
      react.setAttribute("aria-label",message.reaction?"Remove heart reaction":"React with a heart");
      react.title="React with a heart";
      react.innerHTML='<svg class="icon"><use href="#i-heart"/></svg>';
      react.addEventListener("click",function(){
        message.reaction=message.reaction?"":"❤️";
        saveConversations();
        renderMessages();
      });
      tools.appendChild(react);
      stack.appendChild(tools);
      if(person.id==="everyone"&&!outgoing)stack.appendChild(node("div","message-author",message.displayName||"Someone"));
      const bubble=node("div","message-bubble"+(message.kind==="image"?" image-bubble":""));
      if(message.kind==="image"&&message.image){
        const image=node("img");
        image.src=message.image;
        image.alt="Image shared in this conversation";
        bubble.appendChild(image);
        if(message.text&&message.text!=="Photo")bubble.appendChild(node("div","message-caption",message.text));
      }else if(message.kind==="like"){
        bubble.classList.add("like-bubble");
        bubble.textContent="❤️";
      }else{
        bubble.textContent=message.text;
      }
      if(message.reaction)bubble.appendChild(node("span","message-reaction",message.reaction));
      stack.appendChild(bubble);
      const meta=node("div","message-meta");
      meta.appendChild(node("span","message-time",message.time||"now"));
      if(outgoing&&index===person.messages.length-1&&person.id!=="everyone"){
        const read=node("span","message-status");
        read.appendChild(node("span","","Seen"));
        const check=node("svg","icon");
        check.setAttribute("viewBox","0 0 24 24");
        check.innerHTML='<use href="#i-check"/>';
        read.appendChild(check);
        meta.appendChild(read);
      }
      stack.appendChild(meta);
      row.appendChild(stack);
      thread.appendChild(row);
    });
    thread.scrollTop=thread.scrollHeight;
    renderConversations();
  }
  function openConversation(id){
    const person=findConversation(id);
    activeId=person.id;
    person.unread=0;
    $("body").classList.remove("show-people");
    $("body").classList.add("show-chat");
    $(".app-shell").classList.remove("people-mode");
    $("#peopleView").hidden=true;
    $("#inboxPanel").hidden=false;
    $("#chatPanel").hidden=false;
    $$(".nav-button").forEach(function(button){button.classList.toggle("is-active",button.dataset.view===(person.id==="everyone"?"everyone":"inbox"));});
    renderMessages();
  }
  function showInbox(){
    $("body").classList.remove("show-chat","show-people");
    $(".app-shell").classList.remove("people-mode");
    $("#peopleView").hidden=true;
    $("#inboxPanel").hidden=false;
    $("#chatPanel").hidden=false;
    $$(".nav-button").forEach(function(button){button.classList.toggle("is-active",button.dataset.view==="inbox");});
  }
  function showPeople(){
    $("body").classList.remove("show-chat");
    $("body").classList.add("show-people");
    $(".app-shell").classList.add("people-mode");
    $("#inboxPanel").hidden=false;
    $("#chatPanel").hidden=true;
    $("#peopleView").hidden=false;
    $$(".nav-button").forEach(function(button){button.classList.toggle("is-active",button.dataset.view==="people");});
    renderPeople($("#peopleSearch").value);
  }
  function addMessage(content,kind,image){
    const person=currentConversation();
    if(!content&&!image)return;
    if(person.id==="everyone"){
      if(image){showToast("The public room is text-only for now.");return;}
      sendGlobalMessage(content);
      return;
    }
    const message={from:"me",text:content||"Photo",time:formatNow(),createdAt:Date.now()};
    if(kind)message.kind=kind;
    if(image)message.image=image;
    person.messages.push(message);
    person.unread=0;
    saveConversations();
    $("#messageInput").value="";
    resizeComposer();
    $("#emojiTray").hidden=true;
    renderMessages();
    if(person.online)simulateReply(person);
  }
  async function sendGlobalMessage(content){
    if(!cloudConnected){showToast("The public room is in preview. Finish the shared-chat setup before posting.");return;}
    const button=$("#messageForm button[type=submit]");
    button.disabled=true;
    try{
      const message=await window.ChatshitCloud.sendMessage(content,identity.nickname||"Someone");
      addCloudMessage(message);
      $("#messageInput").value="";
      resizeComposer();
      renderMessages();
    }catch(error){
      showToast("That message did not send. Check your connection and try again.");
    }finally{button.disabled=false;}
  }
  function addCloudMessage(message){
    const room=findConversation("everyone");
    if(!room||room.messages.some(function(item){return item.id===message.id;}))return;
    room.messages.push(message);
    if(room.messages.length>100)room.messages.shift();
    if(activeId!=="everyone")room.unread+=1;
    if(activeId==="everyone")renderMessages();
    else renderConversations();
  }
  async function reloadCloudNotes(){
    if(!cloudConnected)return;
    try{
      cloudNotes=await window.ChatshitCloud.loadNotes();
      const mine=cloudNotes.find(function(note){return note.userId===window.ChatshitCloud.userId;});
      if(mine)myNote={text:mine.text,musicUrl:mine.musicUrl||"",expiresAt:mine.expiresAt,fromCloud:true};
      else if(myNote&&myNote.fromCloud)myNote=null;
      saveMyNote();
      renderNotes();
    }catch(error){showToast("Couldn’t refresh notes just now.");}
  }
  async function reloadCloudProfiles(){
    if(!cloudConnected)return;
    try{
      cloudProfiles=await window.ChatshitCloud.loadProfiles();
      profileDirectoryError=cloudProfiles.some(function(profile){return profile.userId===window.ChatshitCloud.userId;})?"":"Your profile is missing. Run the latest backend/supabase.sql, then refresh.";
    }catch(error){
      cloudProfiles=[];
      profileDirectoryError="The profiles table is not ready. Run the latest backend/supabase.sql, then refresh.";
    }
    renderPeople($("#peopleSearch").value);
  }
  async function connectCommunity(){
    const room=findConversation("everyone");
    if(!window.ChatshitCloud||!window.ChatshitCloud.configured){
      $("#inboxConnectionLabel").textContent="Saved on this device";
      $("#inboxModeLabel").textContent="Cloud setup needed";
      renderHeader();
      return;
    }
    $("#inboxConnectionLabel").textContent="Connecting…";
    try{
      await window.ChatshitCloud.connect(identity.nickname||"Someone");
      cloudConnected=true;
      try{await window.ChatshitCloud.saveProfile(identity.nickname||identity.username||"Someone");}
      catch(error){profileDirectoryError="The profiles table is not ready. Run the latest backend/supabase.sql, then refresh.";}
      $("#inboxConnectionLabel").textContent="Community room ready";
      $("#inboxModeLabel").textContent="Live chat";
      unsubscribeCloud=window.ChatshitCloud.subscribe(addCloudMessage,function(){reloadCloudNotes();},function(){reloadCloudProfiles();});
      const [messages,notes]=await Promise.all([window.ChatshitCloud.loadMessages(),window.ChatshitCloud.loadNotes()]);
      const arrivals=room.messages.filter(function(message){return message.id;});
      const byId=new Map();
      messages.concat(arrivals).forEach(function(message){if(message.id)byId.set(message.id,message);});
      room.messages=Array.from(byId.values()).sort(function(a,b){return (a.createdAt||0)-(b.createdAt||0);}).slice(-100);
      cloudNotes=notes;
      await reloadCloudProfiles();
      const mine=cloudNotes.find(function(note){return note.userId===window.ChatshitCloud.userId;});
      if(mine)myNote={text:mine.text,musicUrl:mine.musicUrl||"",expiresAt:mine.expiresAt,fromCloud:true};
      else if(myNote&&myNote.fromCloud)myNote=null;
      if(!mine&&myNote&&!myNote.fromCloud){await window.ChatshitCloud.saveNote(myNote.text,myNote.musicUrl,identity.nickname||"Someone");myNote.fromCloud=true;}
      saveMyNote();
      renderNotes();
      renderMessages();
    }catch(error){
      cloudConnected=false;
      $("#inboxConnectionLabel").textContent="Saved on this device";
      $("#inboxModeLabel").textContent="Cloud connection issue";
      renderHeader();
      showToast("Shared chat could not connect. Check the Supabase setup.");
    }
  }
  function simulateReply(person){
    window.clearTimeout(typingTimer);
    $("#typingLabel").textContent=person.name.split(" ")[0]+" is typing";
    $("#typingRow").hidden=false;
    typingTimer=window.setTimeout(function(){
      if(activeId!==person.id){$("#typingRow").hidden=true;return;}
      $("#typingRow").hidden=true;
      const replies=["hehe, exactly 💌","I’m so glad you told me","sending a little love your way ✨","okay, that made my day","say more 👀"];
      person.messages.push({from:"them",text:replies[Math.floor(Math.random()*replies.length)],time:formatNow(),createdAt:Date.now()});
      saveConversations();
      renderMessages();
    },1800+Math.random()*900);
  }
  function renderPeople(query){
    const grid=$("#peopleCards");
    grid.replaceChildren();
    const q=(query||"").trim().toLowerCase();
    const hint=$("#peopleDirectoryHint");
    if(cloudConnected){
      if(profileDirectoryError){
        hint.textContent="Member list unavailable · check the Supabase profiles setup.";
        grid.appendChild(node("div","empty-note",profileDirectoryError));
        return;
      }
      hint.textContent=cloudProfiles.length+" registered member"+(cloudProfiles.length===1?"":"s")+" · updates live";
      const currentUserId=window.ChatshitCloud.userId;
      const found=cloudProfiles.filter(function(profile){return profile.displayName.toLowerCase().includes(q);});
      if(!found.length){grid.appendChild(node("div","empty-note",q?"No registered users match that name.":"No one has joined this community yet."));return;}
      found.forEach(function(profile,index){
        const isSelf=profile.userId===currentUserId;
        const member={name:profile.displayName,color:colors[index%colors.length],online:false};
        const card=node("article","person-card");
        card.appendChild(avatar(member));
        const copy=node("div","person-card-copy");
        copy.appendChild(node("strong","",profile.displayName));
        const joined=profile.createdAt?"Joined "+new Intl.DateTimeFormat(undefined,{month:"short",year:"numeric"}).format(new Date(profile.createdAt)):"Chatshit member";
        copy.appendChild(node("small","",(isSelf?"You · ":"Member · ")+joined));
        copy.appendChild(node("p","","A member of your Chatshit community."));
        card.appendChild(copy);
        card.appendChild(node("span","person-member-label",isSelf?"YOU":"MEMBER"));
        grid.appendChild(card);
      });
      return;
    }
    hint.textContent="Demo profiles · connect the shared backend to list everyone who joins.";
    const found=conversations.filter(function(person){return person.id!=="everyone"&&(person.name+" "+person.username).toLowerCase().includes(q);});
    if(!found.length){grid.appendChild(node("div","empty-note","No one by that name yet. Try a different search."));return;}
    found.forEach(function(person){
      const card=node("article","person-card");
      card.appendChild(avatar(person));
      const copy=node("div","person-card-copy");
      copy.appendChild(node("strong","",person.name));
      copy.appendChild(node("small","",person.username+(person.online?" · online":"")));
      copy.appendChild(node("p","",person.story||"Good conversations start with a hello."));
      card.appendChild(copy);
      const button=node("button","person-message-button","Message");
      button.type="button";
      button.addEventListener("click",function(){showInbox();openConversation(person.id);});
      card.appendChild(button);
      grid.appendChild(card);
    });
  }
  function startConversation(){
    const name=$("#newChatName").value.trim();
    const note=$("#newChatNote").value.trim();
    if(!name){$("#newChatName").focus();showToast("Give your new conversation a name first.");return;}
    const existing=conversations.find(function(person){return person.name.toLowerCase()===name.toLowerCase();});
    if(existing){
      $("#composeDialog").close();
      $("#composeForm").reset();
      showInbox();
      openConversation(existing.id);
      return;
    }
    const id="chat-"+Date.now().toString(36);
    const person={id:id,name:name,username:"@"+name.toLowerCase().replace(/[^a-z0-9]+/g,"").slice(0,16),color:colors[conversations.length%colors.length],online:false,story:"",unread:0,group:false,messages:[]};
    if(note)person.story=note;
    conversations.unshift(person);
    saveConversations();
    $("#composeDialog").close();
    $("#composeForm").reset();
    showInbox();
    openConversation(id);
    $("#messageInput").focus();
    showToast("A new little corner, just for you two.");
  }
  function openStory(person){
    currentStory=person;
    $("#storyAvatar").textContent=initials(person.name);
    $("#storyKicker").textContent=person.name.toUpperCase()+" · A LITTLE UPDATE";
    $("#storyText").textContent=person.story||"A little hello from "+person.name.split(" ")[0];
    $("#storyDialog").showModal();
  }
  function openOwnStory(){
    currentStory=null;
    $("#storyAvatar").textContent=initials(identity.nickname||identity.username||"You");
    $("#storyKicker").textContent="YOUR STORY";
    $("#storyText").textContent="A small moment worth keeping ✨";
    $("#storyDialog").showModal();
  }
  function showToast(message){
    const toast=$("#toast");
    toast.textContent=message;
    toast.classList.add("is-visible");
    window.clearTimeout(toastTimer);
    toastTimer=window.setTimeout(function(){toast.classList.remove("is-visible");},2600);
  }
  function resizeComposer(){
    const input=$("#messageInput");
    input.style.height="auto";
    input.style.height=Math.min(input.scrollHeight,96)+"px";
  }
  function applyTheme(theme){
    document.body.classList.toggle("dark",theme==="dark");
    try{localStorage.setItem(THEME_KEY,theme);}catch(error){}
  }
  function setupInstall(){
    if((window.matchMedia&&window.matchMedia("(display-mode: standalone)").matches)||navigator.standalone)$("#installAppButton").hidden=true;
    window.addEventListener("beforeinstallprompt",function(event){event.preventDefault();installPrompt=event;$("#installAppButton").classList.add("install-ready");});
    window.addEventListener("appinstalled",function(){installPrompt=null;$("#installAppButton").hidden=true;showToast("Chatshit is on your home screen ✨");});
    $("#installAppButton").addEventListener("click",async function(){
      if(installPrompt){installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;return;}
      const ios=/iphone|ipad|ipod/i.test(navigator.userAgent);
      showToast(ios?"Tap Share in Safari, then choose Add to Home Screen.":"Open your browser menu and tap Install app or Add to Home screen.");
    });
  }
  function init(){
    syncIdentity();
    renderStories();
    renderNotes();
    renderConversations();
    renderMessages();
    try{if(localStorage.getItem(THEME_KEY)==="dark")applyTheme("dark");}catch(error){}
    $$(".nav-button").forEach(function(button){
      button.addEventListener("click",function(){if(button.dataset.view==="people")showPeople();else if(button.dataset.view==="everyone")openConversation("everyone");else showInbox();});
    });
    $("#searchInput").addEventListener("input",renderConversations);
    $("#peopleSearch").addEventListener("input",function(){renderPeople(this.value);});
    $$(".filter-chip").forEach(function(button){
      button.addEventListener("click",function(){
        activeFilter=button.dataset.filter;
        $$(".filter-chip").forEach(function(other){other.classList.toggle("is-selected",other===button);other.setAttribute("aria-pressed",String(other===button));});
        renderConversations();
      });
    });
    $("#messageForm").addEventListener("submit",function(event){event.preventDefault();addMessage($("#messageInput").value.trim());});
    $("#messageInput").addEventListener("input",resizeComposer);
    $("#messageInput").addEventListener("keydown",function(event){
      if(event.key==="Enter"&&!event.shiftKey){event.preventDefault();$("#messageForm").requestSubmit();}
    });
    $("#emojiButton").addEventListener("click",function(){const tray=$("#emojiTray");tray.hidden=!tray.hidden;});
    const tray=$("#emojiTray");
    emojis.forEach(function(emoji){
      const button=node("button","emoji-choice",emoji);
      button.type="button";
      button.addEventListener("click",function(){
        const input=$("#messageInput"),start=input.selectionStart,end=input.selectionEnd,value=input.value;
        input.value=value.slice(0,start)+emoji+value.slice(end);
        input.focus();
        input.setSelectionRange(start+emoji.length,start+emoji.length);
        resizeComposer();
        tray.hidden=true;
      });
      tray.appendChild(button);
    });
    $("#attachButton").addEventListener("click",function(){$("#imageInput").click();});
    $("#imageInput").addEventListener("change",function(){
      const file=this.files&&this.files[0];
      if(!file)return;
      if(file.size>300000){showToast("That image is a bit large — try one under 300 KB.");this.value="";return;}
      const reader=new FileReader();
      reader.onload=function(){addMessage("Photo","image",reader.result);};
      reader.readAsDataURL(file);
      this.value="";
    });
    $("#composeButton").addEventListener("click",function(){$("#composeDialog").showModal();$("#newChatName").focus();});
    $("#peopleComposeButton").addEventListener("click",function(){$("#composeDialog").showModal();$("#newChatName").focus();});
    $("#startChatButton").addEventListener("click",startConversation);
    $("#newChatName").addEventListener("keydown",function(event){if(event.key==="Enter"){event.preventDefault();startConversation();}});
    $("#editProfileButton").addEventListener("click",function(){$("#profileDialog").showModal();$("#profileName").focus();});
    $("#mobileProfileButton").addEventListener("click",function(){$("#profileDialog").showModal();$("#profileName").focus();});
    $("#saveProfileButton").addEventListener("click",async function(){
      const clean=$("#profileName").value.trim();
      if(!clean){showToast("Choose a name before saving.");return;}
      const updated=window.ChatshitIdentity.updateNickname(clean);
      if(updated){
        Object.assign(identity,updated);
        syncIdentity();
        renderStories();
        renderNotes();
        if(cloudConnected){
          try{await window.ChatshitCloud.saveProfile(identity.nickname||identity.username||"Someone");await reloadCloudProfiles();}
          catch(error){profileDirectoryError="Your profile could not be updated. Check the Supabase profiles table.";renderPeople($("#peopleSearch").value);}
        }
        $("#profileDialog").close();
        showToast(cloudConnected&&profileDirectoryError?"Name saved here, but the community profile could not update.":"Your little corner has your name on it now.");
      }
    });
    $("#yourStoryButton").addEventListener("click",openOwnStory);
    $("#editNoteButton").addEventListener("click",openNoteEditor);
    $("#spotifyConnectButton").addEventListener("click",async function(){
      try{await window.ChatshitSpotify.connect();}
      catch(error){syncSpotifyControls({connected:spotifyConnected,track:spotifyNowPlaying,error:error.message},false);showToast(error.message||"Spotify could not connect.");}
    });
    $("#spotifyDisconnectButton").addEventListener("click",function(){
      window.ChatshitSpotify.disconnect();
      showToast("Spotify disconnected on this device.");
    });
    $("#spotifyUseTrackButton").addEventListener("click",function(){
      const track=window.ChatshitSpotify.getCurrentTrack();
      if(!track)return;
      $("#noteMusicUrl").value=track.url;
      $("#noteMusicUrl").focus();
      showToast("Spotify link added. Write your note, then share it.");
    });
    window.addEventListener("chatshit:spotify",function(event){syncSpotifyControls(event.detail,true);});
    window.ChatshitSpotify.init().then(function(state){syncSpotifyControls(state,true);}).catch(function(error){syncSpotifyControls({connected:false,error:error.message},false);});
    $("#closeNoteDialog").addEventListener("click",function(){$("#noteDialog").close();});
    $("#noteForm").addEventListener("submit",async function(event){
      event.preventDefault();
      const text=$("#noteText").value.trim();
      const rawUrl=$("#noteMusicUrl").value.trim();
      const musicUrl=validMusicUrl(rawUrl);
      if(!text){showToast("Add a few words to your note first.");$("#noteText").focus();return;}
      if(rawUrl&&!musicUrl){showToast("Paste a YouTube Music, Metrolist or Spotify HTTPS link.");$("#noteMusicUrl").focus();return;}
      const note={text:text,musicUrl:musicUrl,expiresAt:new Date(Date.now()+24*60*60*1000).toISOString()};
      if(cloudConnected){
        try{await window.ChatshitCloud.saveNote(text,musicUrl,identity.nickname||"Someone");note.fromCloud=true;}
        catch(error){showToast("Your note could not be shared. Try again in a moment.");return;}
      }
      myNote=note;
      saveMyNote();
      renderNotes();
      $("#noteDialog").close();
      showToast(cloudConnected?"Your note is up for everyone for 24 hours.":"Note saved here. Set up the cloud to share it with everyone.");
    });
    $("#closeStory").addEventListener("click",function(){$("#storyDialog").close();});
    $("#storyReply").addEventListener("click",function(){
      $("#storyDialog").close();
      if(currentStory){showInbox();openConversation(currentStory.id);addMessage("Sending a little love your way ♡");}
      else showToast("Your story is ready for a little polish.");
    });
    $("#backToInbox").addEventListener("click",showInbox);
    $("#peopleBackButton").addEventListener("click",showInbox);
    $("#closeDetails").addEventListener("click",function(){$("#detailsPanel").classList.remove("detail-open");});
    $("#detailToggle").addEventListener("click",function(){$("#detailsPanel").classList.toggle("detail-open");});
    $$("[data-toast]").forEach(function(button){button.addEventListener("click",function(){showToast(button.dataset.toast);});});
    document.addEventListener("keydown",function(event){
      if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==="k"){event.preventDefault();$("#searchInput").focus();}
      if(event.key==="Escape"){$("#emojiTray").hidden=true;$("#detailsPanel").classList.remove("detail-open");}
    });
    const themeButton=node("button","theme-toggle");
    themeButton.type="button";
    themeButton.setAttribute("aria-label","Toggle dark mode");
    themeButton.title="A softer after-dark";
    themeButton.innerHTML='<svg class="icon"><use href="#i-moon"/></svg>';
    themeButton.addEventListener("click",function(){applyTheme(document.body.classList.contains("dark")?"light":"dark");});
    $(".inbox-heading").appendChild(themeButton);
    setupInstall();
    connectCommunity();
  }
  document.addEventListener("DOMContentLoaded",init);
})();
