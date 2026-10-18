(()=>{'use strict';
const ENDPOINT='https://mobility-reader-note-sync.dociledeer2.chatgpt.site',STORE='reader-sync-v1';let state={key:'',versions:{},snapshots:{}},busy=false,queued=false;
try{state={...state,...JSON.parse(localStorage.getItem(STORE)||'{}')}}catch{}
state.versions=state.versions||{};state.snapshots=state.snapshots||{};
// Server tombstones deliberately omit prose. All deleted representations are
// equivalent even when this device retains the text in its local recycle bin.
const hashNote=n=>n.deleted?'[deleted]':JSON.stringify([n.paper,n.project,n.section,n.quote,n.text,false]);
function persist(){localStorage.setItem(STORE,JSON.stringify(state))}
function message(t){const el=document.querySelector('#syncMessage');if(el)el.textContent=t}
async function request(path,options={}){const r=await fetch(ENDPOINT+path,{...options,headers:{Authorization:'Bearer '+state.key,...options.headers}});if(!r.ok){let e=new Error('同步请求失败 '+r.status);e.status=r.status;throw e}return r.json()}
function mergeStamp(old){return new Date(Math.max(Date.now(),Date.parse(old?.updatedAt)||0)+1).toISOString()}
async function sync(){
 if(!state.key)return;if(busy){queued=true;return}busy=true;message('同步中…');
 try{
  let remote=[],cursor='';const seen=new Set();
  do{
   const page=await request('/v1/notes?limit=50'+(cursor?'&cursor='+encodeURIComponent(cursor):''));
   if(!Array.isArray(page.notes))throw Error('服务器返回格式错误');
   remote.push(...page.notes);cursor=page.cursor||'';
   if(cursor&&seen.has(cursor))throw Error('同步分页异常');if(cursor)seen.add(cursor);
  }while(cursor);
  const lm=new Map(window.readerNotes.get().map(n=>[n.id,n])),incoming=[],conflicts=[];
  for(const r of remote){
   const l=lm.get(r.id),same=l&&hashNote(l)===hashNote(r);
   const hasBase=Object.hasOwn(state.versions,r.id)&&Object.hasOwn(state.snapshots,r.id);
   const localChanged=l&&hashNote(l)!==state.snapshots[r.id];
   const remoteChanged=!hasBase||r.etag!==state.versions[r.id];
   if(l&&!same&&localChanged&&remoteChanged){
    // Includes first pairing/import with a matching UUID but no common base.
    // Preserve local prose under a NEW UUID, and keep remote canonical UUID.
    conflicts.push({...l,id:crypto.randomUUID(),deleted:false,
     text:(l.deleted?'【冲突副本：本机曾删除此批注，远端另有修改；待人工确认】\n':'【离线冲突副本，待人工合并】\n')+(l.text||''),
     updatedAt:new Date().toISOString()});
   }else if(l&&!same&&localChanged&&!remoteChanged){continue}
   if(l||!r.deleted){
    // Keep local tombstone prose for undo, while accepting the remote deletion.
    incoming.push({...r,paper:r.paper??l?.paper??'',project:r.project??l?.project,
     section:r.section??l?.section,quote:r.quote??l?.quote,text:r.text??l?.text??'',
     updatedAt:mergeStamp(l)});
   }
   state.versions[r.id]=r.etag;state.snapshots[r.id]=hashNote(r);
  }
  window.readerNotes.merge([...incoming,...conflicts]);persist();
  for(const current of [...window.readerNotes.get()]){
   // Snapshot before awaiting fetch: the UI may edit this same object in flight.
   const n=JSON.parse(JSON.stringify(current)),sentHash=hashNote(n);
   if(sentHash===state.snapshots[n.id])continue;
   if(n.deleted&&!state.versions[n.id])continue;
   const headers={'Content-Type':'application/json'},method=n.deleted?'DELETE':'PUT';
   if(state.versions[n.id])headers['If-Match']=state.versions[n.id];else headers['If-None-Match']='*';
   try{
    const saved=await request('/v1/notes/'+n.id,{method,headers,...(method==='PUT'?{body:JSON.stringify(n)}:{})});
    state.versions[n.id]=saved.etag;state.snapshots[n.id]=sentHash;persist();
   }catch(e){
    if(e.status===412){message('检测到版本冲突，本地内容已保留。请再次同步，系统会另存冲突副本供人工合并。');persist();window.readerNotes.refresh();return}
    throw e;
   }
  }
  persist();window.readerNotes.refresh();message(conflicts.length?'已同步，存在冲突副本请人工合并。':'已同步 · '+new Date().toLocaleTimeString());
  window.readerNotes.toast('批注同步完成'+(conflicts.length?'（有冲突副本）':''));
 }catch(e){message('同步未完成，内容仍保存在本机。'+e.message);window.readerNotes.toast('同步未完成，已保留本机批注')}
 finally{busy=false;if(queued){queued=false;setTimeout(sync,250)}}
}
function open(){const p=document.querySelector('#syncPanel');p.innerHTML='<section class="note"><h2>免账号跨设备同步</h2><p>首次在此设备启用；在另一台设备粘贴同一配对密钥。以后自动同步，不用账号密码。</p><p class="muted">密钥持有者可以读写你的批注。不要公开分享。此服务采用私密访问控制，并非端到端加密；请勿写入敏感个人信息。丢失密钥无法找回，建议另存批注备份。</p><button id="enableSync">'+(state.key?'立即同步':'启用私人同步空间')+'</button> <button id="showPair">显示本机配对密钥</button><div id="pairDisplay"></div><label>加入已有空间<input id="pairInput" type="password" autocomplete="off" placeholder="粘贴另一设备的64位配对密钥"></label><button id="pairJoin">连接此空间</button><p id="syncMessage" role="status"></p></section>';document.querySelector('#enableSync').onclick=()=>{if(!state.key){state.key=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');persist()}sync()};document.querySelector('#showPair').onclick=()=>{const d=document.querySelector('#pairDisplay');if(!state.key){d.textContent='请先启用同步空间。';return}d.innerHTML='<textarea readonly aria-label="私人配对密钥"></textarea><p class="muted">复制到自己的另一设备；请勿截图或转发给他人。</p>';d.querySelector('textarea').value=state.key};document.querySelector('#pairJoin').onclick=()=>{let key=document.querySelector('#pairInput').value.trim();if(!/^[0-9a-f]{64}$/.test(key)){message('密钥应为64位小写十六进制字符。');return}if(!confirm('连接后会把此设备批注合并到该空间。确认这是你自己的配对密钥？'))return;state={key,versions:{},snapshots:{}};persist();sync()}}
// Never change credentials midway through a batch belonging to another space.
document.addEventListener('click',e=>{if(busy&&e.target?.id==='pairJoin'){e.preventDefault();e.stopImmediatePropagation();message('正在同步，请完成后再切换私人空间。')}},true);
window.readerSync={open,sync};let timer;window.addEventListener('notes-changed',()=>{clearTimeout(timer);timer=setTimeout(sync,900)});window.addEventListener('online',sync);document.addEventListener('visibilitychange',()=>{if(!document.hidden)sync()});setTimeout(sync,2000);
})();
