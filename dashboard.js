'use strict';
const M = QareebMetrics;
const PROJECT = 'radar-3d3bb';
// Firebase web configuration identifies the project; it is not an admin credential.
const API_KEY = 'AIzaSyAoLg94P0jkFiTBEqAVWAl6qCiZIyNenLU';
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/analytics`;
const $ = id => document.getElementById(id);
const esc = text => String(text ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = value => value === null ? '—' : Number(value).toLocaleString('fr-FR',{maximumFractionDigits:0});
const money = value => value === null ? '—' : new Intl.NumberFormat('fr-MA',{style:'currency',currency:'MAD',maximumFractionDigits:2}).format(value);
const pct = value => value === null ? '—' : (value*100).toFixed(1)+' %';
const pages = {
 overview:['Vue d’ensemble','L’essentiel de votre activité, au même endroit.'],
 ads:['Publicité','Comprendre la diffusion et les revenus de chaque format.'],
 audience:['Audience','D’où viennent vos sessions et quels appareils les génèrent.'],
 engagement:['Engagement','Messages, crédits et interactions dans l’application.'],
 forecast:['Simulateur','Explorez vos hypothèses de croissance et de monétisation.']
};
const formats = [['rewarded','Rewarded'],['interstitial','Interstitial'],['app_open','App Open'],['banner','Banner'],['native','Native'],['meta_banner','Meta · Banner'],['meta_native','Meta · Native'],['meta_interstitial','Meta · Interstitial']];
let state={fields:{},users:[],period:'all',format:'ALL',country:'ALL',page:1,screen:'overview',loaded:false};
let demo=false, auth=null, refreshing=null, timer=null, fetching=false, generation=0, usersFetchedAt=0;
function kpi(label,value,note){return `<article class="kpi"><span class="kpi-label">${esc(label)}</span><div class="kpi-value">${esc(value)}</div><div class="kpi-note">${esc(note)}</div></article>`;}
function emptyRow(cols,text='Aucune donnée pour cette période.'){return `<tr><td colspan="${cols}" class="empty">${esc(text)}</td></tr>`;}
function showPage(){
 const key=location.hash.slice(1);state.screen=pages[key]?key:'overview';
 for(const panel of document.querySelectorAll('[data-panel]'))panel.hidden=panel.id!==state.screen;
 for(const link of document.querySelectorAll('[data-page]')){const active=link.dataset.page===state.screen;link.classList.toggle('active',active);if(active)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');}
 $('pageTitle').textContent=pages[state.screen][0];$('breadcrumb').textContent=pages[state.screen][0];$('pageDescription').textContent=pages[state.screen][1];
 closeMenu();
}
const mobileMenu = matchMedia('(max-width:760px)');
function closeMenu(){document.body.classList.remove('menu-open');$('scrim').hidden=true;$('menuButton').setAttribute('aria-expanded','false');$('sidebar').inert=mobileMenu.matches;}
mobileMenu.addEventListener('change',closeMenu);
$('menuButton').onclick=()=>{const open=!document.body.classList.contains('menu-open');document.body.classList.toggle('menu-open',open);$('sidebar').inert=!open;$('scrim').hidden=!open;$('menuButton').setAttribute('aria-expanded',String(open));if(open)document.querySelector('nav a.active').focus();};
$('scrim').onclick=closeMenu;
document.addEventListener('keydown',e=>{
 if(e.key==='Tab'&&document.body.classList.contains('menu-open')){const items=[...$('sidebar').querySelectorAll('a,button')];const first=items[0],last=items.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}
 if(e.key==='Escape'&&document.body.classList.contains('menu-open')){closeMenu();$('menuButton').focus();}});
window.addEventListener('hashchange',showPage);
function openApp(){ $('login').hidden=true;$('app').hidden=false;$('demoBanner').hidden=!demo;$('modeBadge').textContent=demo?'DÉMO':'LIVE';$('sourceLabel').textContent=demo?'Données fictives':'Firestore · Lecture seule';showPage();sync();timer=setInterval(()=>{if(!document.hidden)sync();},15000);}
function logout(){if(firebaseSdkSession)firebaseSdkSession.sdk.signOut(firebaseSdkSession.instance).catch(()=>{});generation++;clearInterval(timer);timer=null;auth=null;demo=false;state.fields={};state.users=[];state.loaded=false;usersFetchedAt=0;$('app').hidden=true;$('login').hidden=false;document.body.classList.remove('menu-open');$('googleLogin').focus();}
$('logout').onclick=logout;
let firebaseSdkSession=null;
$('googleLogin').onclick=async()=>{
 $('googleLogin').disabled=true;$('googleError').textContent='';
 try{
  const [appSdk,authSdk]=await Promise.all([
   import('https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js'),
   import('https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js')
  ]);
  if(!firebaseSdkSession){
   const app=appSdk.initializeApp({apiKey:API_KEY,projectId:PROJECT,authDomain:PROJECT+'.firebaseapp.com'});
   const instance=authSdk.getAuth(app);await authSdk.setPersistence(instance,authSdk.inMemoryPersistence);
   firebaseSdkSession={instance,sdk:authSdk};
  }
  const provider=new authSdk.GoogleAuthProvider();provider.setCustomParameters({prompt:'select_account'});
  const result=await authSdk.signInWithPopup(firebaseSdkSession.instance,provider);
  const idToken=await result.user.getIdToken();
  auth={idToken,refreshToken:result.user.refreshToken,expiresAt:Date.now()+3500000};demo=false;openApp();
 }catch(error){
  const messages={'auth/operation-not-allowed':'Le fournisseur Google doit être activé dans Firebase Authentication.','auth/unauthorized-domain':'Ce domaine doit être autorisé dans Firebase Authentication.','auth/popup-blocked':'Autorisez la fenêtre de connexion Google puis réessayez.','auth/popup-closed-by-user':'Connexion annulée.'};
  $('googleError').textContent=messages[error.code]||'Connexion Google indisponible. Réessayez.';
 }finally{$('googleLogin').disabled=false;}
};
$('demoButton').onclick=()=>{demo=true;openApp();};
async function token(){
 if(!auth)throw new Error('Session expirée. Reconnectez-vous.');
 if(Date.now()<auth.expiresAt-60000)return auth.idToken;
 if(!refreshing)refreshing=(async()=>{
  const session=auth;
  const res=await fetch(`https://securetoken.googleapis.com/v1/token?key=${API_KEY}`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:auth.refreshToken})});
  const data=await res.json();if(!res.ok)throw new Error('Session expirée. Reconnectez-vous.');
  if(auth!==session)throw new Error('Session fermée.');
  auth={idToken:data.id_token,refreshToken:data.refresh_token,expiresAt:Date.now()+Number(data.expires_in)*1000};return auth.idToken;
 })().finally(()=>refreshing=null);
 return refreshing;
}
async function read(path,allowMissing=false){
 const res=await fetch(`${BASE}/${path}`,{headers:{Authorization:`Bearer ${await token()}`},cache:'no-store'});
 if(res.status===404&&allowMissing)return {fields:{}};
 if(!res.ok)throw new Error(res.status===403?'Accès refusé par Firestore. Un administrateur doit autoriser votre UID dans les règles.':`Lecture impossible (${res.status}). Réessayez.`);
 return res.json();
}
async function allUsers(){
 let users=[],next='',seen=new Set();
 do{
  const query=new URLSearchParams({pageSize:'100'});if(next)query.set('pageToken',next);
  const data=await read('live_stats/users?'+query,true);
  for(const doc of data.documents||[]){const f=doc.fields||{};users.push({id:f.user_id?.stringValue||doc.name.split('/').pop(),country:f.country?.stringValue||'GLOBAL',city:f.city?.stringValue||'Unknown',device:f.device_model?.stringValue||'Android',os:f.os_version?.stringValue||'',launches:M.number(f.launch_count),last:f.last_active_date?.stringValue||doc.updateTime||''});}
  next=data.nextPageToken||'';if(next&&seen.has(next))throw new Error('Pagination Firestore interrompue. Réessayez.');seen.add(next);
 }while(next);
 return users.sort((a,b)=>b.last.localeCompare(a.last));
}
async function sync(){
 if(fetching)return;fetching=true;const version=++generation;const period=state.period;
 $('refresh').disabled=true;$('syncStatus').textContent='Actualisation en cours…';$('errorBanner').hidden=true;
 try{
  const doc=period==='today'?'daily_'+new Date().toISOString().slice(0,10):'live_stats';
  const updateUsers=Date.now()-usersFetchedAt>60000;
  const [statsResult,usersResult]=await Promise.allSettled([demo?Promise.resolve({fields:demoFields(period)}):read(doc,true),updateUsers?(demo?Promise.resolve(demoUsers()):allUsers()):Promise.resolve(state.users)]);
  if(version!==generation||period!==state.period)return;
  if(statsResult.status==='rejected')throw statsResult.reason;
  state.fields=statsResult.value.fields||{};state.loaded=true;
  if(usersResult.status==='fulfilled'){state.users=usersResult.value;if(updateUsers)usersFetchedAt=Date.now();}
  else{$('errorBanner').hidden=false;$('errorBanner').textContent='Les compteurs sont à jour, mais la liste des appareils n’a pas pu être actualisée. '+usersResult.reason.message;}
  render();$('syncStatus').textContent=`${demo?'Démo · ':''}Compteurs actualisés à ${new Date().toLocaleTimeString('fr-FR')} · Journées UTC`;
 }catch(error){if(version===generation){$('errorBanner').textContent=error.message+' Les dernières données restent affichées.';$('errorBanner').hidden=false;$('syncStatus').textContent=state.loaded?'Données conservées · Actualisation en échec':'Données indisponibles';}}
 finally{fetching=false;$('refresh').disabled=false;if(period!==state.period&&!$('app').hidden)sync();}
}
$('refresh').onclick=()=>{usersFetchedAt=0;sync();};
for(const button of document.querySelectorAll('[data-period]'))button.onclick=()=>{state.period=button.dataset.period;for(const b of document.querySelectorAll('[data-period]'))b.setAttribute('aria-pressed',String(b===button));sync();};
$('format').onchange=()=>{state.format=$('format').value;renderAds();};
$('country').onchange=()=>{state.country=$('country').value;state.page=1;renderAudience();};
$('search').oninput=()=>{state.page=1;renderUsers();};
$('previous').onclick=()=>{state.page--;renderUsers();};$('next').onclick=()=>{state.page++;renderUsers();};
 function render(){
  const f=state.fields,a=M.ads(f),sessions=M.number(f.total_sessions),first=M.number(f.total_installs),returning=M.number(f.total_returning);
  $('overviewKpis').innerHTML=kpi('Revenu estimé · MAD',money(a.revenue),'Tous les formats · Événements collectés')+kpi('Sessions',fmt(sessions),'Ouvertures cumulées de l’application')+kpi('Premières ouvertures',fmt(first),'Première ouverture suivie par appareil')+kpi('Messages envoyés',fmt(M.number(f.total_messages_sent)),'Activité pendant la période');
  const max=Math.max(a.requests,a.matched,a.impressions,1);
  $('adFunnel').innerHTML=[['Demandes',a.requests],['Chargés',a.matched],['Impressions',a.impressions]].map(([name,n])=>`<div class="funnel-row"><span>${name}</span><div class="track"><span style="width:${n/max*100}%"></span></div><b>${fmt(n)}</b></div>`).join('')+`<p class="footnote">Match ${pct(a.match)} · Show ${pct(a.show)}${a.impressions>a.matched?' · Historique incohérent : plus d’impressions que de chargements.':''}</p>`;
  const total=first+returning;
  $('sessionSplit').innerHTML=`<div class="split-total">${fmt(total)} <small>ouvertures classées</small></div><div class="stacked"><span style="width:${total?first/total*100:0}%"></span><span style="width:${total?returning/total*100:0}%"></span></div><div class="legend-row"><span>Premières ouvertures</span><b>${fmt(first)}</b></div><div class="legend-row"><span>Ouvertures suivantes</span><b>${fmt(returning)}</b></div>`;
  renderAds();renderAudience();renderEngagement();forecast();
 }
 function renderAds(){
  const f=state.fields,a=M.ads(f,state.format);
  $('adKpis').innerHTML=kpi('Revenu estimé · MAD',money(a.revenue),'Revenu du format sélectionné')+kpi('Impressions',fmt(a.impressions),'Affichages enregistrés')+kpi('eCPM · MAD',money(a.ecpm),'Revenu / impressions × 1 000')+kpi('Taux de clic',pct(a.ctr),`${fmt(a.clicks)} clics · Même périmètre`);
  $('formatsBody').innerHTML=formats.filter(([id])=>state.format==='ALL'||id===state.format).map(([id,label])=>{const r=M.ads(f,id);return `<tr><td>${label}</td>${[fmt(r.requests),fmt(r.matched),fmt(r.impressions),fmt(r.clicks),pct(r.match),pct(r.show),pct(r.ctr),money(r.revenue),money(r.ecpm)].map(v=>`<td>${v}</td>`).join('')}</tr>`;}).join('');
 }
function renderAudience(){
 const rows=M.countries(state.fields),old=state.country;
 const codes=[...new Set([...rows.map(r=>r.code),...state.users.map(u=>u.country),...(old==='ALL'?[]:[old])])].sort();
 $('country').innerHTML='<option value="ALL">Tous les pays</option>'+codes.map(code=>`<option value="${esc(code)}">${esc(countryName(code))}</option>`).join('');$('country').value=old;
 const selected=rows.filter(r=>old==='ALL'||r.code===old),sum=key=>selected.reduce((n,r)=>n+r[key],0);
 const total=M.number(state.fields.total_sessions);
 $('audienceKpis').innerHTML=kpi('Sessions',fmt(old==='ALL'?total:sum('sessions')),'Période et pays sélectionnés')+kpi('Premières ouvertures',fmt(old==='ALL'?M.number(state.fields.total_installs):sum('installs')),'Appareils nouvellement suivis')+kpi('Ouvertures suivantes',fmt(old==='ALL'?M.number(state.fields.total_returning):sum('returning')),'Événements · Pas utilisateurs uniques')+kpi('Pays représentés',fmt(selected.length),'Pays ayant des compteurs');
 $('countriesBody').innerHTML=selected.map(r=>`<tr><td>${esc(countryName(r.code))}</td><td>${fmt(r.installs)}</td><td>${fmt(r.returning)}</td><td>${fmt(r.sessions)}</td><td>${pct(M.ratio(r.sessions,total))}</td></tr>`).join('')||emptyRow(5);
 renderUsers();
}
function countryName(code){try{return code==='GLOBAL'?'International':new Intl.DisplayNames(['fr'],{type:'region'}).of(code);}catch{return code;}}
function filteredUsers(){const q=$('search').value.toLowerCase().trim();return state.users.filter(u=>(state.country==='ALL'||u.country===state.country)&&(!q||[u.id,u.country,countryName(u.country),u.city,u.device].some(v=>v.toLowerCase().includes(q))));}
function renderUsers(){
 const users=filteredUsers(),pages=Math.max(1,Math.ceil(users.length/25));state.page=Math.min(Math.max(1,state.page),pages);
 $('usersBody').innerHTML=users.slice((state.page-1)*25,state.page*25).map(u=>`<tr><td>${esc(u.id)}</td><td>${esc(countryName(u.country))}<small>${esc(u.city)}</small></td><td>${esc(u.device)}<small>${esc(u.os)}</small></td><td>${fmt(u.launches)}</td><td>${esc(u.last||'—')}</td></tr>`).join('')||emptyRow(5,'Aucun appareil ne correspond aux filtres.');
 $('usersCount').textContent=`${fmt(users.length)} appareils · 25 par page`;$('pageCount').textContent=`${state.page} / ${pages}`;$('previous').disabled=state.page===1;$('next').disabled=state.page===pages;$('export').disabled=users.length===0;
}
$('export').onclick=()=>{const rows=[['User ID','Country','City','Device','OS','Launches','Last active'],...filteredUsers().map(u=>[u.id,u.country,u.city,u.device,u.os,u.launches,u.last])];const blob=new Blob(['\uFEFF'+rows.map(row=>row.map(M.csvCell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='qareeb-devices-'+new Date().toISOString().slice(0,10)+'.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
function renderEngagement(){
 const f=state.fields,earned=M.number(f.credits_earned_total),spent=M.number(f.credits_spent_total);
 $('engagementKpis').innerHTML=kpi('Crédits gagnés',fmt(earned),`${fmt(M.number(f.credits_refill_count))} recharges enregistrées`)+kpi('Crédits consommés',fmt(spent),'Consommation pendant la période')+kpi('Consommés / gagnés',pct(M.ratio(spent,earned)),'Peut dépasser 100 % avec un solde antérieur')+kpi('Messages',fmt(M.number(f.total_messages_sent)),'Messages effectivement suivis');
 const hours=Array.from({length:24},(_,i)=>M.number(f['traffic_hour_'+String(i).padStart(2,'0')])),max=Math.max(...hours,0);
 $('hourly').innerHTML=hours.map((v,i)=>`<div class="hour-col" title="${i}h UTC : ${v} messages"><div class="hour-bar" style="height:${max?v/max*115:0}px"></div><small>${i%3===0?String(i).padStart(2,'0'):''}</small></div>`).join('');
 $('hourly').setAttribute('aria-label',hours.map((v,i)=>`${i}h UTC : ${v} messages`).join('; '));
 $('peak').textContent=max?'Pic observé : '+hours.map((v,i)=>v===max?String(i).padStart(2,'0')+'h':null).filter(Boolean).join(', ')+` UTC · ${fmt(max)} messages.`:'Pas encore de messages enregistrés.';
 const count=M.number(f.ratings_count),stars=M.number(f.ratings_stars_total);
 $('rating').innerHTML=`<div class="rating-number">${count?(stars/count).toFixed(1):'—'} <small>/ 5</small></div><p>${fmt(count)} avis enregistrés</p>`+[5,4,3,2,1].map(n=>`<div class="legend-row"><span>${n} étoiles</span><b>${fmt(M.number(f['ratings_'+n+'_stars']))}</b></div>`).join('');
 const ids=[...new Set(Object.keys(f).map(k=>/^char_(.+)_(messages|photos)$/.exec(k)?.[1]).filter(Boolean))];
 $('charactersBody').innerHTML=ids.map(id=>({id,msg:M.number(f['char_'+id+'_messages']),photos:M.number(f['char_'+id+'_photos'])})).sort((a,b)=>b.msg-a.msg).map(r=>`<tr><td>${esc(r.id)}</td><td>${fmt(r.msg)}</td><td>${fmt(r.photos)}</td></tr>`).join('')||emptyRow(3);
}
function forecast(){
 const form=$('forecastForm');if(!form.checkValidity()){ $('forecastDaily').textContent='—';$('forecastMad').textContent='Saisissez des valeurs valides et positives ou nulles.';$('forecastDetails').textContent='';return;}
 const impressions=Number($('dau').value)*Number($('sessions').value)*Number($('adsPerSession').value),daily=impressions*Number($('ecpm').value)/1000;
 $('forecastDaily').textContent=money(daily);$('forecastMad').textContent='≈ '+(daily*Number($('exchange').value)).toLocaleString('fr-FR',{maximumFractionDigits:2})+' MAD / jour';
 $('forecastDetails').innerHTML=[['Impressions / jour',fmt(impressions)],['Mois de 30 jours',money(daily*30)],['Année de 365 jours',money(daily*365)]].map(([name,v])=>`<div class="legend-row"><span>${name}</span><b>${v}</b></div>`).join('');
}
$('forecastForm').oninput=forecast;$('forecastForm').onsubmit=e=>e.preventDefault();
function demoFields(period){const mult=period==='today'?.12:1;const f={};const put=(k,n)=>f[k]={integerValue:String(Math.round(n*mult))};
 for(const [k,n] of Object.entries({total_sessions:3842,total_installs:1264,total_returning:2578,total_messages_sent:18690,credits_earned_total:92700,credits_spent_total:93450,credits_refill_count:6180,ratings_count:84,ratings_stars_total:362,ratings_5_stars:46,ratings_4_stars:27,ratings_3_stars:5,ratings_2_stars:3,ratings_1_stars:3,country_SA_sessions:2250,country_SA_installs:740,country_SA_returning:1510,country_MA_sessions:940,country_MA_installs:340,country_MA_returning:600,country_AE_sessions:652,country_AE_installs:184,country_AE_returning:468}))put(k,n);
 const totals={requests:0,matched:0,impressions:0,clicks:0,revenue_micros:0};formats.slice(0,5).forEach(([id],i)=>{const values={requests:3600-i*500,matched:3000-i*450,impressions:2600-i*420,clicks:53-i*9,revenue_micros:12800000-i*2300000};Object.entries(values).forEach(([key,v])=>{put(`ad_${id}_${key}`,v);totals[key]+=Math.round(v*mult);});});
 for(const [key,target] of Object.entries({requests:'ad_requests_total',matched:'ad_matched_total',impressions:'total_ad_impressions',clicks:'total_ad_clicks',revenue_micros:'estimated_revenue_micros'}))f[target]={integerValue:String(totals[key])};
 for(let i=0;i<24;i++)put('traffic_hour_'+String(i).padStart(2,'0'),Math.round(150+600*Math.abs(Math.sin(i*.2))));['sarah','dalal','shahad','lama','reem'].forEach((id,i)=>{put(`char_${id}_messages`,5300-i*900);put(`char_${id}_photos`,780-i*120);});return f;}
function demoUsers(){return Array.from({length:132},(_,i)=>({id:'DEMO-'+String(i+1).padStart(4,'0'),country:['SA','MA','AE'][i%3],city:['Riyad','Marrakech','Dubai'][i%3],device:['Samsung Galaxy S24','Google Pixel 8','Xiaomi 14'][i%3],os:'Android 15',launches:1+i%19,last:'2026-10-22T09:'+String(i%60).padStart(2,'0')+':00Z'}));}
showPage();
