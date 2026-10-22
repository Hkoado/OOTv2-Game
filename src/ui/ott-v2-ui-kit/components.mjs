import {createAsset} from './assets.mjs';
export {createAsset} from './assets.mjs';
export const PIECE_LABELS = Object.freeze({rock:'Đấm',paper:'Giấy / Bao',scissors:'Kéo · Song kiếm'});
export const TERRAIN_LABELS = Object.freeze({fire:'Lửa',water:'Nước',bush:'Bụi cây',chasm:'Vực'});
const teams = new Set(['red','blue']);
const el = (tag, cls, text) => { const node=document.createElement(tag);node.className=cls;if(text!==undefined)node.textContent=String(text);return node; };
const own = (obj,key) => Object.prototype.hasOwnProperty.call(obj,key);
function requireTeam(team) {if(!teams.has(team))throw new TypeError(`Unknown team: ${team}`);}

export function createPiece({type,team='red',size,selected=false,label}={}) {
  if(!own(PIECE_LABELS,type))throw new TypeError(`Unknown piece: ${type}`);
  requireTeam(team);
  const node=el('span',`ott-piece ott-piece--${team}${selected?' is-selected':''}`);
  node.dataset.team=team;node.dataset.type=type;
  node.setAttribute('role','img');node.setAttribute('aria-label',label??`${PIECE_LABELS[type]}, Đội ${team==='red'?'Đỏ':'Xanh'}`);
  if(size!==undefined){if(!Number.isFinite(size)||size<=0)throw new TypeError('Piece size must be positive.');node.style.width=`${size}px`;node.style.height=`${size}px`;}
  node.append(createAsset(type));return node;
}
export function createTerrain(type,{size,label}={}) {
  if(!own(TERRAIN_LABELS,type))throw new TypeError(`Unknown terrain: ${type}`);
  const node=el('span',`ott-terrain ott-terrain--${type}`);
  node.setAttribute('role','img');node.setAttribute('aria-label',label??TERRAIN_LABELS[type]);
  if(size!==undefined){if(!Number.isFinite(size)||size<=0)throw new TypeError('Terrain size must be positive.');node.style.width=`${size}px`;node.style.height=`${size}px`;}
  node.append(createAsset(type));return node;
}
export function createSquare({coordinate='',zone='neutral',terrain,piece,base=false,selected=false,available=false,capture=false,lastMove=false,disabled=false,onClick}={}) {
  if(!['red','blue','neutral'].includes(zone))throw new TypeError('Square zone must be red, blue or neutral.');
  const node=el('button',`ott-square ott-square--${zone}`);node.type='button';node.dataset.square=coordinate;
  const words=[coordinate.toUpperCase()];
  if(base){const castle=createAsset('castle');castle.classList.add('ott-square__base');node.append(castle);words.push('Thành trì');}
  if(terrain){const art=createTerrain(terrain);art.setAttribute('aria-hidden','true');node.append(art);words.push(TERRAIN_LABELS[terrain]);}
  if(piece){const art=createPiece(piece);art.setAttribute('aria-hidden','true');node.append(art);words.push(PIECE_LABELS[piece.type],`Đội ${piece.team==='red'?'Đỏ':'Xanh'}`);}
  for(const [name,value] of Object.entries({selected,available,capture,'last-move':lastMove}))if(value)node.classList.add(`is-${name}`);
  if(selected)words.push('Đang chọn');if(available)words.push(capture?'Có thể ăn quân':'Có thể đi');
  if(piece)node.setAttribute('aria-pressed',String(selected));
  node.setAttribute('aria-label',words.filter(Boolean).join(', '));node.title=node.getAttribute('aria-label');node.disabled=disabled;
  if(onClick)node.addEventListener('click',()=>onClick(coordinate));
  return node;
}
export function createPlayerCard({name='Người chơi',team='red',count=9,total=9,active=false,status}={}) {
  requireTeam(team);const card=el('section',`ott-panel ott-player${active?' is-active':''}`);card.dataset.team=team;
  const top=el('div','ott-player__top');top.append(createAsset('castle',{size:44}));
  const info=el('div','ott-player__info');info.append(el('h3','ott-player__name',name),el('span','ott-caption',`ĐỘI ${team==='red'?'ĐỎ':'XANH'}`));top.append(info);
  const bottom=el('div','ott-player__bottom');bottom.append(el('span','ott-player__status',status??(active?'Đang đi':'Đang chờ')),el('span','ott-caption',`${count} / ${total} quân`));
  card.append(top,bottom);return card;
}
export function createUnitButton({type,team='red',count=3,selected=false,disabled=false,onClick}={}) {
  requireTeam(team);if(!own(PIECE_LABELS,type))throw new TypeError(`Unknown piece: ${type}`);
  const button=el('button',`ott-unit${selected?' is-selected':''}`);button.type='button';button.dataset.type=type;button.dataset.team=team;button.disabled=disabled;button.setAttribute('aria-pressed',String(selected));
  button.append(createAsset(type,{size:44}),el('span','ott-unit__label',PIECE_LABELS[type]),el('span','ott-unit__count',count));
  if(onClick)button.addEventListener('click',()=>onClick(type));return button;
}
export function createTerrainLegend({types=Object.keys(TERRAIN_LABELS),descriptions={}}={}) {
  const list=el('div','ott-terrain-list');
  for(const type of types){const row=el('div','ott-terrain-row');row.append(createTerrain(type,{size:46}));const text=el('div','ott-terrain-row__text');text.append(el('strong','ott-label',TERRAIN_LABELS[type]));if(descriptions[type])text.append(el('span','ott-caption',descriptions[type]));row.append(text);list.append(row);}
  return list;
}
export function createTurnBadge({team='red',number=1,label}={}) {
  requireTeam(team);const node=el('div','ott-turn');node.dataset.team=team;
  node.append(el('span','ott-turn__dot'),el('span','ott-label',label??`Lượt Đội ${team==='red'?'Đỏ':'Xanh'}`),el('span','ott-badge',`LƯỢT ${String(number).padStart(2,'0')}`));return node;
}
export function createActionBar({message='',onUndo,onReset,undoDisabled=false,resetDisabled=false}={}) {
  const root=el('div','ott-action-bar');const status=el('span','ott-action-bar__message',message);status.setAttribute('role','status');status.setAttribute('aria-live','polite');root.append(status);
  const actions=el('div','ott-action-bar__buttons');
  for(const [name,symbol,callback,disabled] of [['Hoàn tác','↶',onUndo,undoDisabled],['Chơi lại','↻',onReset,resetDisabled]]){
    if(!callback)continue;const button=el('button','ott-icon-button',symbol);button.type='button';button.title=name;button.setAttribute('aria-label',name);button.disabled=disabled;button.addEventListener('click',callback);actions.append(button);
  }
  root.append(actions);return root;
}
export function createMoveList({moves=[],emptyText='Chưa có nước đi.'}={}) {
  const root=el('ol','ott-history');root.setAttribute('aria-label','Nước đi');
  if(!moves.length)root.append(el('li','ott-empty',emptyText));
  for(const [index,move] of moves.entries()){
    requireTeam(move.team);const row=el('li','ott-history__row');row.append(el('span','ott-caption',String(index+1).padStart(2,'0')));
    const marker=el('span',`ott-team-marker ott-team-marker--${move.team}`);marker.setAttribute('aria-hidden','true');row.append(marker,el('span','ott-caption',move.team==='red'?'Đỏ':'Xanh'),el('span','ott-label',`${String(move.from).toUpperCase()} → ${String(move.to).toUpperCase()}`));
    if(move.label)row.append(el('span','ott-caption',move.label));root.append(row);
  }
  return root;
}
