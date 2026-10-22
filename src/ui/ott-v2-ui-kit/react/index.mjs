import React,{useLayoutEffect,useRef} from 'react';
import {mountBoard,normalizeBoard} from '../board.mjs';
import {createPiece,createTerrain,createPlayerCard,createUnitButton,createTerrainLegend,createTurnBadge,createActionBar,createMoveList} from '../components.mjs';

export function OTTBoard({className,...options}) {
  const host=useRef(null),controller=useRef(null),latest=useRef(options);latest.current=options;
  useLayoutEffect(()=>{controller.current=mountBoard(host.current,latest.current);return()=>{controller.current.destroy();controller.current=null;};},[]);
  useLayoutEffect(()=>{controller.current?.update(normalizeBoard(options));});
  return React.createElement('div',{ref:host,className});
}
function wrap(builder,tag='div'){
  return function OTTComponent({className,...options}){
    const host=useRef(null);
    useLayoutEffect(()=>{const focused=host.current.contains(document.activeElement);const node=builder(options);host.current.replaceChildren(node);if(focused)(node.matches('button')?node:node.querySelector('button'))?.focus({preventScroll:true});});
    return React.createElement(tag,{ref:host,className:tag==='span'?`ott-inline${className?' '+className:''}`:className});
  };
}
export const OTTPiece=wrap(createPiece,'span');
export const OTTTerrain=wrap(({type,...options})=>createTerrain(type,options),'span');
export const OTTPlayerCard=wrap(createPlayerCard);
export const OTTUnitButton=wrap(createUnitButton);
export const OTTTerrainLegend=wrap(createTerrainLegend);
export const OTTTurnBadge=wrap(createTurnBadge);
export const OTTActionBar=wrap(createActionBar);
export const OTTMoveList=wrap(createMoveList);
