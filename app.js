import { normalizeSchedule, getWeekDays, shiftDate, getTodayInJapan, layoutDayEvents, findConflicts, createCalendar } from './src/schedule.mjs';

const $ = (selector) => document.querySelector(selector);
const icons = {
  calendar:'<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18m-14 4h3m4 0h3"/>',
  upload:'<path d="M12 16V3m-4 4 4-4 4 4M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
  download:'<path d="M12 3v13m-4-4 4 4 4-4M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
  shield:'<path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Z"/><path d="m8.5 11.5 2.5 2.5 4.5-5"/>',
  help:'<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 .5c0 1.5-2.5 2-2.5 3.5m0 3h.01"/>',
  left:'<path d="m14 6-6 6 6 6"/>', right:'<path d="m10 6 6 6-6 6"/>',
  search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  bookmark:'<path d="M6 4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17l-6-4-6 4V4Z"/>',
  list:'<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  external:'<path d="M14 3h7v7m0-7L10 14M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/>',
  close:'<path d="m6 6 12 12M6 18 18 6"/>',
  file:'<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6Z"/><path d="M14 3v6h6M9 13H8v4h1m6-4h1v4h-1"/>',
  plus:'<path d="M12 5v14M5 12h14"/>', check:'<path d="m5 12 4 4L19 6"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  pin:'<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2.5"/>'
};
function icon(name) { const node=document.createElement('span'); node.setAttribute('aria-hidden','true'); node.dataset.icon=name; node.innerHTML=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">${icons[name]||icons.calendar}</svg>`; return node; }
document.querySelectorAll('[data-icon]').forEach(node=>node.replaceWith(icon(node.dataset.icon)));
function el(tag, className, text) { const node=document.createElement(tag); if(className) node.className=className; if(text!==undefined) node.textContent=text; return node; }
function button(text,className,handler,iconName) {const node=el('button',className);node.type='button';if(iconName)node.append(icon(iconName));if(text)node.append(document.createTextNode(text));node.addEventListener('click',handler);return node;}
const palette=[['#8c88d8','#f0effb','#6863a4'],['#66a69b','#edf6f2','#478479'],['#7395c5','#eef3fb','#587ba8'],['#c39a65','#faf3e9','#99764b'],['#be8bad','#f8eef4','#9a6d8d'],['#859e77','#f1f5ed','#68825a']];
const today=getTodayInJapan();
const MIN_DATE='1900-01-01', MAX_DATE='2100-12-31';
const clampDate=date=>date<MIN_DATE?MIN_DATE:date>MAX_DATE?MAX_DATE:date;
const state={data:null,sample:false,source:'',anchor:today,miniMonth:today.slice(0,7)+'-01',view:matchMedia('(max-width:760px)').matches?'list':'week',query:'',categories:new Set(),planned:new Set(),planOnly:false,storageKey:'',colors:new Map(),loadVersion:0};
const weekdays=['月','火','水','木','金','土','日'];
const dateObject=(date)=>new Date(date+'T12:00:00Z');
const dateText=(date)=>new Intl.DateTimeFormat('ja-JP',{timeZone:'UTC',month:'long',day:'numeric',weekday:'short'}).format(dateObject(date));
function eventTimeText(event) {
  return event.endUnknown ? `${event.start}〜 終了未定` : `${event.start} – ${event.end}`;
}
function setColor(node,category){const [color,bg,ink]=state.colors.get(category)||palette[0];node.style.setProperty('--cat-color',color);node.style.setProperty('--cat-bg',bg);node.style.setProperty('--cat-ink',ink);}
let toastTimer;
function toast(message){clearTimeout(toastTimer);$('#toast').textContent=message;$('#toast').hidden=false;toastTimer=setTimeout(()=>{$('#toast').hidden=true;},3600);}
function openDialog(dialog){if(!dialog.open)dialog.showModal();}
document.querySelectorAll('dialog').forEach(dialog=>{dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}});});
document.querySelectorAll('[data-close]').forEach(node=>node.addEventListener('click',()=>node.closest('dialog').close()));
document.querySelectorAll('[data-import]').forEach(node=>node.addEventListener('click',()=>openDialog($('#import-dialog'))));
$('#help-button').addEventListener('click',()=>openDialog($('#help-dialog')));
$('#data-manage').addEventListener('click',()=>openDialog($('#import-dialog')));
$('#choose-file').addEventListener('click',()=>$('#file-input').click());
const maxFileBytes=1024*1024;
function importError(error){$('#import-error').textContent=error.message||'ファイルを読み込めませんでした。JSONの形式をご確認ください。';$('#import-error').hidden=false;openDialog($('#import-dialog'));}
async function readFile(file){if(!file)return;const version=++state.loadVersion;$('#import-error').hidden=true;try{if(file.size>maxFileBytes)throw new Error('ファイルは1 MiB以下にしてください。');const text=await file.text();if(version!==state.loadVersion)return;let input;try{input=JSON.parse(text.replace(/^\uFEFF/,''));}catch{throw new Error('JSONの書式を読み取れませんでした。カンマや括弧などを確認してください。');}applyData(input,false,file.name);}catch(error){if(version===state.loadVersion)importError(error);}finally{$('#file-input').value='';}}
$('#file-input').addEventListener('change',event=>readFile(event.target.files[0]));
const dropZone=$('#drop-zone');
['dragenter','dragover'].forEach(name=>dropZone.addEventListener(name,event=>{event.preventDefault();dropZone.classList.add('dragging');}));
['dragleave','drop'].forEach(name=>dropZone.addEventListener(name,event=>{event.preventDefault();dropZone.classList.remove('dragging');}));
dropZone.addEventListener('drop',event=>{if(event.dataTransfer.files.length!==1){importError(new Error('JSONファイルを1つ選択してください。'));return;}readFile(event.dataTransfer.files[0]);});
async function loadSample(){const version=++state.loadVersion;$('#load-sample').disabled=true;$('#import-error').hidden=true;try{const response=await fetch('./examples/schedule.sample.json',{credentials:'omit'});if(!response.ok)throw new Error('サンプルを取得できませんでした。時間をおいてお試しください。');const input=await response.json();if(version===state.loadVersion)applyData(input,true,'サンプルデータ');}catch(error){if(version===state.loadVersion)importError(error);}finally{$('#load-sample').disabled=false;}}
$('#load-sample').addEventListener('click',loadSample);
function storageKey(data,sample){const text=JSON.stringify(data.events.map(({id,date,start,end})=>[id,date,start,end]).sort((a,b)=>a[0].localeCompare(b[0])));let hash=2166136261;for(let i=0;i<text.length;i++){hash^=text.charCodeAt(i);hash=Math.imul(hash,16777619);}return `labvisit.plan.v1.${sample?'sample':'file'}.${(hash>>>0).toString(16)}`;}
function applyData(input,sample,source){const data=normalizeSchedule(input);const key=storageKey(data,sample);let saved=[];try{const parsed=JSON.parse(localStorage.getItem(key)||'[]');if(Array.isArray(parsed))saved=parsed.filter(id=>typeof id==='string');}catch{/* Storage can be disabled by the visitor. */}const ids=new Set(data.events.map(e=>e.id));const dates=data.events.map(e=>e.date).sort();state.data=data;state.sample=sample;state.source=source;state.storageKey=key;state.planned=new Set(saved.filter(id=>ids.has(id)));state.query='';state.planOnly=false;state.categories=new Set(data.labs.map(l=>l.category));state.colors=new Map([...state.categories].map((c,i)=>[c,palette[i%palette.length]]));state.anchor=dates.find(d=>d>=today)||dates[0]||today;state.miniMonth=state.anchor.slice(0,7)+'-01';$('#search').value='';$('#import-error').hidden=true;$('#import-dialog').close();renderFilters();render();toast(`${data.labs.length}研究室・${data.events.length}件の予定を読み込みました`);}
function renderFilters(){const container=$('#category-filters');container.replaceChildren();if(!state.data){container.append(el('p','muted small','JSONを読み込むと表示されます'));return;}for(const category of state.colors.keys()){const label=el('label','category-label');setColor(label,category);const input=el('input');input.type='checkbox';input.checked=state.categories.has(category);input.addEventListener('change',()=>{input.checked?state.categories.add(category):state.categories.delete(category);render();});label.append(input,el('span','',category),el('span','category-count',String(state.data.labs.filter(l=>l.category===category).length)));container.append(label);}}
function filteredEvents(){if(!state.data)return[];const query=state.query.toLocaleLowerCase('ja-JP');return state.data.events.filter(e=>state.categories.has(e.category)&&(!state.planOnly||state.planned.has(e.id))&&(!query||[e.labName,e.category,e.location,e.note,e.description].some(v=>v.toLocaleLowerCase('ja-JP').includes(query))));}
function selectedEvents(){return state.data?state.data.events.filter(e=>state.planned.has(e.id)):[];}
function renderMini(){const first=state.miniMonth;const year=Number(first.slice(0,4)),month=Number(first.slice(5,7));$('#mini-month').textContent=`${year}年 ${month}月`;const grid=$('#mini-days');grid.replaceChildren();const start=getWeekDays(first)[0];const week=getWeekDays(state.anchor);const eventDates=new Set(state.data?.events.map(e=>e.date)||[]);for(let i=0;i<42;i++){const date=shiftDate(start,i);const day=button(String(Number(date.slice(8))),'',()=>{state.anchor=clampDate(date);if(date.slice(0,7)!==state.miniMonth.slice(0,7))state.miniMonth=date.slice(0,7)+'-01';render();});day.disabled=date<MIN_DATE||date>MAX_DATE;day.setAttribute('aria-label',new Intl.DateTimeFormat('ja-JP',{timeZone:'UTC',dateStyle:'full'}).format(dateObject(date)));day.setAttribute('aria-pressed',String(date===state.anchor));if(date===today){day.classList.add('is-today');day.setAttribute('aria-current','date');}if(date.slice(0,7)!==first.slice(0,7))day.classList.add('other-month');if(week.includes(date))day.classList.add('in-week');if(date===state.anchor)day.classList.add('is-selected');if(eventDates.has(date))day.classList.add('has-event');grid.append(day);}}
function render(){renderMini();const days=getWeekDays(state.anchor);const start=days[0],end=days[6];const [year,month]=start.split('-');const endMonth=Number(end.slice(5,7));$('#period-title').textContent=`${year}年 ${Number(month)}月${endMonth!==Number(month)?` – ${end.slice(0,4)!==year?end.slice(0,4)+'年 ':''}${endMonth}月`:''}`;$('#period-title').title=`${dateText(start)}〜${dateText(end)}`;$('#week-view').setAttribute('aria-pressed',String(state.view==='week'));$('#list-view').setAttribute('aria-pressed',String(state.view==='list'));$('#plan-filter').setAttribute('aria-pressed',String(state.planOnly));$('#plan-count').textContent=state.planned.size;$('#sample-badge').hidden=!state.sample;$('#export-button').disabled=state.planned.size===0;$('#data-label').textContent=state.data?(state.sample?'サンプルを表示中':'データ読み込み済み'):'データ未読み込み';$('#data-label').closest('.data-card').classList.toggle('is-loaded',!!state.data);$('#data-description').textContent=state.data?`${state.data.labs.length}研究室・${state.data.events.length}件の予定${state.data.updatedAt?' / 更新 '+state.data.updatedAt.slice(0,10):''}`:'配布されたJSONファイルを読み込んではじめましょう。';const filtered=filteredEvents();const events=filtered.filter(e=>days.includes(e.date));$('#visible-count').textContent=`${Number(start.slice(5,7))}/${Number(start.slice(8))} – ${Number(end.slice(5,7))}/${Number(end.slice(8))} · ${state.planOnly?'候補':'見学'} ${events.length}件`;const conflicts=findConflicts(selectedEvents());const banner=$('#conflict-banner');banner.hidden=conflicts.length===0;banner.textContent=`マイプランに時間が重なる予定が${conflicts.length}組あります。予定を開いて確認してください。`+(selectedEvents().some(e=>e.endUnknown)?' 終了未定の予定は1時間の仮枠で比較しています。':'');const content=$('#calendar-content');content.replaceChildren();if(!state.data){content.append(welcome());return;}if(!events.length){const empty=el('div','empty-filter');empty.append(icon(state.planOnly?'bookmark':'calendar'),el('h3','',state.planOnly?'今週の見学候補はまだありません':'この週に表示できる予定はありません'),el('p','',state.planOnly?'予定を開いて「見学候補に追加」してみましょう。':'別の週に移動するか、検索条件を変更してください。'));if(filtered.length){empty.append(button('予定のある週へ','button',()=>{state.anchor=(filtered.find(e=>e.date>=state.anchor)||filtered[0]).date;state.miniMonth=state.anchor.slice(0,7)+'-01';render();},'right'));}if(state.query||state.categories.size!==state.colors.size||state.planOnly)empty.append(button('絞り込みをリセット','text-button',resetFilters));content.append(empty);return;}content.append(state.view==='week'?weekCalendar(days,events,new Set(conflicts.flat())):agenda(events));}
function welcome(){const wrapper=el('div','welcome-state');const card=el('div','welcome-card');const illustration=el('div','welcome-illustration');illustration.append(icon('calendar'));const badge=el('span');badge.append(icon('plus'));illustration.append(badge);const title=el('h3');title.append(document.createTextNode('予定を読み込んで、'),el('br'),document.createTextNode('見学の計画をはじめよう。'));const actions=el('div','welcome-actions');actions.append(button('JSONを読み込む','button primary',()=>openDialog($('#import-dialog')),'upload'),button('サンプルで試す','button',loadSample));const tip=el('div','welcome-tip');tip.append(icon('shield'),document.createTextNode('ファイルは送信されず、このブラウザー内で表示されます'));card.append(illustration,el('p','eyebrow','YOUR NEXT CHAPTER STARTS HERE'),title,el('p','','配布された日程のJSONファイルを読み込むと、研究室の見学日程をまとめて確認できます。'),actions,tip);wrapper.append(card);return wrapper;}
function weekCalendar(days, events, conflicts) {
  const scroll = el('div', 'calendar-scroll');
  scroll.tabIndex = 0;
  scroll.setAttribute('role', 'region');
  scroll.setAttribute('aria-label', '週間カレンダー。狭い画面では横にスクロールできます');
  const table = el('div', 'week-table');
  const concurrent = Math.max(1, ...layoutDayEvents(events).map(e => e.columnCount));
  table.style.minWidth = String(Math.max(800, 52 + 7 * Math.min(1000, concurrent * 72))) + 'px';
  const header = el('div', 'week-header');
  header.append(el('div', 'timezone', 'JST'));
  days.forEach((date, index) => {
    const heading = el('div', 'day-heading' + (date === today ? ' today' : '') + (index > 4 ? ' weekend' : ''));
    heading.append(el('span', '', weekdays[index]), el('strong', '', String(Number(date.slice(8)))));
    header.append(heading);
  });
  const min = Math.min(9 * 60, Math.floor(Math.min(...events.map(e => e.startMinutes)) / 60) * 60);
  const max = Math.max(18 * 60, Math.ceil(Math.max(...events.map(e => e.endMinutes)) / 60) * 60);
  const grid = el('div', 'time-grid');
  grid.style.height = `${(max - min) / 60 * 84}px`;
  const axis = el('div', 'time-axis');
  for (let time = min; time < max; time += 60) {
    const label = el('span', 'time-label', `${time >= 1440 ? '翌' : ''}${String(Math.floor(time / 60) % 24).padStart(2, '0')}:00`);
    label.style.top = `${(time - min) / 60 * 84}px`;
    axis.append(label);
  }
  grid.append(axis);
  days.forEach((date, index) => {
    const column = el('div', 'day-column' + (index > 4 ? ' weekend' : ''));
    for (const event of layoutDayEvents(events.filter(e => e.date === date))) {
      const card = button('', 'calendar-event' + (event.endUnknown ? ' end-unknown' : ''), () => openEvent(event.id));
      setColor(card, event.category);
      card.style.top = `${(event.startMinutes - min) / 60 * 84 + 3}px`;
      card.style.height = `${Math.max(18, (event.endMinutes - event.startMinutes) / 60 * 84 - 5)}px`;
      card.style.left = `calc(${event.column / event.columnCount * 100}% + 4px)`;
      card.style.width = `calc(${100 / event.columnCount}% - 8px)`;
      card.setAttribute('aria-label', `${dateText(event.date)} ${eventTimeText(event)} ${event.labName} ${event.location}${state.planned.has(event.id) ? ' 見学候補' : ''}`);
      card.title = `${eventTimeText(event)} ${event.labName}\n${event.location}${event.endUnknown ? '\n1時間の仮枠で表示しています' : ''}`;
      if (state.planned.has(event.id)) card.classList.add('is-planned');
      if (conflicts.has(event.id)) card.classList.add('has-conflict');
      if (event.endMinutes - event.startMinutes < 45) card.classList.add('short');
      if (event.endMinutes - event.startMinutes < 20) card.classList.add('tiny');
      card.append(el('span', 'event-time', event.endUnknown ? `${event.start}〜` : eventTimeText(event)), el('span', 'event-name', event.labName));
      if (event.endUnknown) card.append(el('span', 'end-unknown-badge', '終了未定'));
      else card.append(el('span', 'event-location', event.location || '場所未定'));
      if (state.planned.has(event.id)) {
        const check = el('span', 'event-check');
        check.append(icon('check'));
        card.append(check);
      }
      column.append(card);
    }
    grid.append(column);
  });
  table.append(header, grid);
  scroll.append(table);
  return scroll;
}
function agenda(events) {
  const container = el('div', 'agenda');
  const groups = events.reduce((map, event) => {
    if (!map.has(event.date)) map.set(event.date, []);
    map.get(event.date).push(event);
    return map;
  }, new Map());
  for (const [date, items] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    const section = el('section', 'agenda-day');
    const heading = el('h3', 'agenda-date', dateText(date));
    heading.append(el('span', '', `${items.length}件`));
    section.append(heading);
    for (const event of [...items].sort((a, b) => a.startMinutes - b.startMinutes || a.endMinutes - b.endMinutes || a.id.localeCompare(b.id))) {
      const row = button('', 'agenda-item' + (event.endUnknown ? ' end-unknown' : ''), () => openEvent(event.id));
      setColor(row, event.category);
      if (state.planned.has(event.id)) row.classList.add('is-planned');
      const info = el('div');
      info.append(el('div', 'agenda-name', event.labName + (state.planned.has(event.id) ? ' ✓' : '')), el('p', 'agenda-meta', `${event.category} · ${event.location || '場所未定'}${event.reservationRequired ? ' · 要予約' : ''}`));
      const time = el('span', 'agenda-time', event.endUnknown ? `${event.start}〜` : eventTimeText(event));
      if (event.endUnknown) time.append(el('span', 'end-unknown-badge', '終了未定'));
      const arrow = el('span', 'agenda-arrow');
      arrow.append(icon('right'));
      row.append(time, info, arrow);
      section.append(row);
    }
    container.append(section);
  }
  return container;
}
function detailRow(iconName,main,sub){const row=el('div','event-detail-row');const text=el('div','',main);if(sub)text.append(el('small','',sub));row.append(icon(iconName),text);return row;}
function openEvent(id){const event=state.data?.events.find(e=>e.id===id);if(!event)return;const dialog=$('#event-dialog');dialog.replaceChildren();setColor(dialog,event.category);const top=el('div','modal-heading');top.append(icon('calendar'));const close=button('','icon-button',()=>dialog.close(),'close');close.setAttribute('aria-label','閉じる');top.append(close);const title=el('h2','',event.labName);title.id='event-title';const details=el('div','event-details');details.append(detailRow('calendar',dateText(event.date),`${event.date.slice(0,4)}年 · 日本標準時（JST）`),detailRow('clock',eventTimeText(event),event.endUnknown?'カレンダー上は1時間の仮枠で表示しています。':`${event.endMinutes-event.startMinutes}分間`),detailRow('pin',event.location||'場所未定',event.reservationRequired?'事前予約が必要です。研究室の案内をご確認ください。':'参加方法は研究室の案内をご確認ください。'));dialog.append(top,el('span','event-category',event.category),title);if(event.description)dialog.append(el('p','event-description',event.description));dialog.append(details);if(event.note)dialog.append(el('p','event-note',event.note));if(event.url){const link=el('a','event-link','研究室の案内を見る');link.href=event.url;link.target='_blank';link.rel='noopener noreferrer';link.append(icon('external'));dialog.append(link);}const other=state.data.events.filter(e=>state.planned.has(e.id)&&e.id!==event.id);const overlaps=findConflicts([...other,event]).filter(pair=>pair.includes(event.id));if(overlaps.length){const names=overlaps.map(pair=>state.data.events.find(e=>e.id===pair.find(id=>id!==event.id))?.labName).filter(Boolean);dialog.append(el('p','event-warning',`${names.join('、')} の見学候補と時間が重なっています。${event.endUnknown||other.some(e=>e.endUnknown&&overlaps.some(pair=>pair.includes(e.id)))?' 終了未定の予定は1時間の仮枠で比較しています。':''}`));}const planned=state.planned.has(id);const planButton=button(planned?'見学候補から外す':'見学候補に追加','button primary event-plan-button',()=>{togglePlan(id);openEvent(id);},planned?'check':'plus');planButton.setAttribute('aria-pressed',String(planned));dialog.append(planButton,el('p','modal-footnote','見学候補への追加は予約ではありません。候補のIDだけをこのブラウザーに保存します。'));openDialog(dialog);}
function togglePlan(id){state.planned.has(id)?state.planned.delete(id):state.planned.add(id);try{if(state.planned.size)localStorage.setItem(state.storageKey,JSON.stringify([...state.planned]));else localStorage.removeItem(state.storageKey);}catch{toast('候補はこの画面で保持します。ブラウザーの保存機能が使えません。');}render();}
function resetFilters(){state.query='';state.planOnly=false;state.categories=new Set(state.colors.keys());$('#search').value='';renderFilters();render();}
$('#reset-filters').addEventListener('click',resetFilters);
$('#search').addEventListener('input',event=>{state.query=event.target.value.trim();render();});
$('#plan-filter').addEventListener('click',()=>{state.planOnly=!state.planOnly;render();});
function moveWeek(amount){state.anchor=clampDate(shiftDate(state.anchor,amount*7));state.miniMonth=state.anchor.slice(0,7)+'-01';render();}
$('#prev-week').addEventListener('click',()=>moveWeek(-1));$('#next-week').addEventListener('click',()=>moveWeek(1));
function moveMonth(amount){const d=dateObject(state.miniMonth);d.setUTCMonth(d.getUTCMonth()+amount);state.miniMonth=clampDate(d.toISOString().slice(0,10)).slice(0,7)+'-01';renderMini();}
$('#mini-prev').addEventListener('click',()=>moveMonth(-1));$('#mini-next').addEventListener('click',()=>moveMonth(1));
$('#today-button').addEventListener('click',()=>{state.anchor=getTodayInJapan();state.miniMonth=state.anchor.slice(0,7)+'-01';render();});
$('#week-view').addEventListener('click',()=>{state.view='week';render();});$('#list-view').addEventListener('click',()=>{state.view='list';render();});
$('#export-button').addEventListener('click',()=>{const events=selectedEvents();if(!events.length)return;const blob=new Blob([createCalendar(events)],{type:'text/calendar;charset=utf-8'});const url=URL.createObjectURL(blob);const link=el('a');link.href=url;link.download='lab-visit-plan.ics';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);toast(`${events.length}件の見学候補を書き出しました`);});
render();
