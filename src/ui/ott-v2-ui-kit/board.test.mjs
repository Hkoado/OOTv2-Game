import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeBoard,getVisualCoordinates,nextFocusIndex} from './board.mjs';
test('The two orientations contain the same 81 unique coordinates in reverse visual order',()=>{
  const red=getVisualCoordinates('red').squares,blue=getVisualCoordinates('blue').squares;
  assert.equal(new Set(red).size,81);assert.equal(red[0],'a9');assert.equal(red[80],'i1');assert.deepEqual(blue,[...red].reverse());
});
test('Keyboard navigation stops at row/column boundaries and supports Home/End',()=>{
  assert.equal(nextFocusIndex(9,'ArrowLeft'),9);assert.equal(nextFocusIndex(8,'ArrowRight'),8);assert.equal(nextFocusIndex(0,'ArrowUp'),0);assert.equal(nextFocusIndex(80,'ArrowDown'),80);
  assert.equal(nextFocusIndex(40,'ArrowUp'),31);assert.equal(nextFocusIndex(40,'Home'),36);assert.equal(nextFocusIndex(40,'End'),44);assert.equal(nextFocusIndex(40,'Home',true),0);assert.equal(nextFocusIndex(40,'End',true),80);
});
test('Reject overlapping pieces, unknown terrain and out-of-board data',()=>{
  const piece={id:'r1',type:'rock',player:'red',square:'b2'};
  assert.throws(()=>normalizeBoard({pieces:[piece,{...piece,id:'r2'}]}),/Duplicate/);
  assert.throws(()=>normalizeBoard({terrains:{c4:'lava'}}),/Invalid terrain/);
  assert.throws(()=>normalizeBoard({pieces:[{...piece,square:'j2'}]}),/Invalid piece/);
  assert.throws(()=>normalizeBoard({validMoves:['a10']}),/Invalid move/);
  assert.throws(()=>normalizeBoard({bases:{z9:'red'}}),/Invalid base/);
});
test('Presentation state passes through without applying capture or terrain rules',()=>{
  const options=normalizeBoard({readOnly:true,terrains:{c4:'water'},validMoves:[{square:'c4',type:'capture'}],pieces:[{type:'scissors',player:'red',square:'c3'}]});
  assert.equal(options.readOnly,true);assert.equal(options.validMoves[0].square,'c4');assert.equal(options.pieces[0].square,'c3');assert.equal(options.onSquareClick,null);
});
