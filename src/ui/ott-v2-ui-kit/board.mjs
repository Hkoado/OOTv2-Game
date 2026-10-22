import {createSquare,PIECE_LABELS,TERRAIN_LABELS} from './components.mjs';
const coordinatePattern=/^[a-i][1-9]$/;
const files=Array.from('abcdefghi');
export function normalizeBoard(input={}) {
  const options={pieces:[],terrains:{},zones:null,bases:{a1:'red',i9:'blue'},selectedSquare:null,validMoves:[],lastMove:null,orientation:'red',readOnly:false,title:'OTT-v2',onSquareClick:null,...input};
  if(!['red','blue'].includes(options.orientation))throw new TypeError('orientation must be red or blue.');
  if(!Array.isArray(options.pieces)||!Array.isArray(options.validMoves))throw new TypeError('pieces and validMoves must be arrays.');
  if(!options.terrains||typeof options.terrains!=='object'||Array.isArray(options.terrains))throw new TypeError('terrains must be a coordinate map.');
  if(options.onSquareClick!==null&&typeof options.onSquareClick!=='function')throw new TypeError('onSquareClick must be a function or null.');
  const occupied=new Set();
  for(const piece of options.pieces){
    if(piece.alive===false)continue;
    if(!coordinatePattern.test(piece.square)||!Object.hasOwn(PIECE_LABELS,piece.type)||!['red','blue'].includes(piece.player))throw new TypeError('Invalid piece in board snapshot.');
    if(occupied.has(piece.square))throw new TypeError(`Duplicate piece at ${piece.square}`);occupied.add(piece.square);
  }
  for(const [square,type] of Object.entries(options.terrains))if(!coordinatePattern.test(square)||!Object.hasOwn(TERRAIN_LABELS,type))throw new TypeError(`Invalid terrain at ${square}`);
  for(const [square,zone] of Object.entries(options.zones??{}))if(!coordinatePattern.test(square)||!['red','blue','neutral'].includes(zone))throw new TypeError(`Invalid zone at ${square}`);
  for(const [square,team] of Object.entries(options.bases))if(!coordinatePattern.test(square)||!['red','blue'].includes(team))throw new TypeError(`Invalid base at ${square}`);
  if(options.selectedSquare!==null&&!coordinatePattern.test(options.selectedSquare))throw new TypeError('Invalid selectedSquare.');
  for(const move of options.validMoves)if(!coordinatePattern.test(typeof move==='string'?move:move.square))throw new TypeError('Invalid move coordinate.');
  return options;
}
export function getVisualCoordinates(orientation='red') {
  const columns=[...files],rows=[9,8,7,6,5,4,3,2,1];
  if(orientation==='blue'){columns.reverse();rows.reverse();}
  return {columns,rows,squares:rows.flatMap(row=>columns.map(file=>`${file}${row}`))};
}
export function nextFocusIndex(index,key,ctrl=false) {
  const row=Math.floor(index/9),col=index%9;
  switch(key){
    case 'ArrowLeft':return row*9+Math.max(0,col-1);
    case 'ArrowRight':return row*9+Math.min(8,col+1);
    case 'ArrowUp':return Math.max(0,row-1)*9+col;
    case 'ArrowDown':return Math.min(8,row+1)*9+col;
    case 'Home':return ctrl?0:row*9;
    case 'End':return ctrl?80:row*9+8;
    default:return index;
  }
}
export function mountBoard(host,initial={}) {
  if(!(host instanceof HTMLElement))throw new TypeError('mountBoard requires an HTML element.');
  let options=normalizeBoard(initial),focusSquare=options.selectedSquare??'a1',buttons=[],destroyed=false;
  const root=document.createElement('section');root.className='ott-board-frame';
  const title=document.createElement('div');title.className='ott-board-frame__title';
  const wrap=document.createElement('div');wrap.className='ott-board-wrap';
  const board=document.createElement('div');board.className='ott-board';board.setAttribute('role','group');board.setAttribute('aria-label','Bàn cờ 9 nhân 9');
  const axes={};for(const side of ['top','left','right','bottom']){const axis=document.createElement('div');axis.className=`ott-axis ott-axis--${side}`;axis.setAttribute('aria-hidden','true');axes[side]=axis;wrap.append(axis);}
  wrap.append(board);root.append(title,wrap);host.replaceChildren(root);
  function draw(){
    const hadFocus=board.contains(document.activeElement);
    const {columns,rows,squares}=getVisualCoordinates(options.orientation);
    title.textContent=options.title;
    for(const side of ['top','bottom'])axes[side].replaceChildren(...columns.map(value=>{const n=document.createElement('span');n.textContent=value.toUpperCase();return n;}));
    for(const side of ['left','right'])axes[side].replaceChildren(...rows.map(value=>{const n=document.createElement('span');n.textContent=value;return n;}));
    const pieces=new Map(options.pieces.filter(p=>p.alive!==false).map(p=>[p.square,p]));
    const moves=new Map(options.validMoves.map(m=>typeof m==='string'?[m,'move']:[m.square,m.type??'move']));
    const last=typeof options.lastMove==='string'?options.lastMove:options.lastMove?.to;
    buttons=squares.map(square=>{
      const p=pieces.get(square),sum=square.charCodeAt(0)-96+Number(square[1]);
      // Default home tints reproduce the approved artwork; callers can supply all zones.
      const zone=options.zones?(options.zones[square]??'neutral'):(sum<=8?'red':sum>=12?'blue':'neutral');
      const button=createSquare({coordinate:square,zone,terrain:options.terrains[square],piece:p?{type:p.type,team:p.player}:undefined,base:Object.hasOwn(options.bases,square),selected:options.selectedSquare===square,available:moves.has(square),capture:moves.get(square)==='capture',lastMove:last===square});
      button.tabIndex=square===focusSquare?0:-1;
      if(options.readOnly)button.setAttribute('aria-disabled','true');
      return button;
    });
    board.replaceChildren(...buttons);root.classList.toggle('is-readonly',Boolean(options.readOnly));
    if(hadFocus)buttons.find(b=>b.dataset.square===focusSquare)?.focus({preventScroll:true});
  }
  function focus(button){focusSquare=button.dataset.square;for(const b of buttons)b.tabIndex=b===button?0:-1;}
  function onFocus(event){const button=event.target.closest('.ott-square');if(button)focus(button);}
  function onClick(event){const button=event.target.closest('.ott-square');if(button&&!options.readOnly)options.onSquareClick?.(button.dataset.square);}
  function onKey(event){
    const button=event.target.closest('.ott-square');if(!button)return;
    if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key))return;
    event.preventDefault();const index=nextFocusIndex(buttons.indexOf(button),event.key,event.ctrlKey||event.metaKey);focus(buttons[index]);buttons[index].focus({preventScroll:true});
  }
  board.addEventListener('focusin',onFocus);board.addEventListener('click',onClick);board.addEventListener('keydown',onKey);draw();
  return {element:root,update(next){if(destroyed)throw new Error('Board has been destroyed.');const merged=normalizeBoard({...options,...next});options=merged;draw();},focusSquare(square){if(!coordinatePattern.test(square))throw new TypeError('Invalid focus coordinate.');const button=buttons.find(b=>b.dataset.square===square);focus(button);button.focus({preventScroll:true});},destroy(){destroyed=true;board.removeEventListener('focusin',onFocus);board.removeEventListener('click',onClick);board.removeEventListener('keydown',onKey);root.remove();}};
}
