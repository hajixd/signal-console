const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../../signal.js'),'utf8');
const context=vm.createContext({});
vm.runInContext(source.slice(0,source.indexOf('function timeAgo')),context);
function run(code){return vm.runInContext(code,context)}
const base={system:'futures',contractRoot:'MNQ',contract:'MNQZ26',futuresContracts:2,pointValue:2,marginPerContract:2500,direction:'long',entryPrice:20000,currentPrice:20025,status:'open',eventType:'entry',id:'test-entry',tradeId:'test-trade',timestamp:'2026-09-27T19:00:00Z'};
context.t=base;
assert.equal(run('tradePnl(t)'),100);
assert.equal(run('exposure(t)'),80000);
assert.equal(run('capitalUsed(t)'),5000);
assert.equal(run('tradePnl({...t,direction:"short"})'),-100);
assert.equal(run('tradePnl({...t,status:"closed",exitPrice:19950,direction:"short"})'),200);
for(const [root,mult] of Object.entries({NQ:20,MNQ:2,ES:50,MES:5,GC:100,MGC:10,CL:1000,MCL:100})){
 context.t={...base,contractRoot:root,contract:root+'Z26',pointValue:mult,currentPrice:20001};
 assert.equal(run('tradePnl(t)'),2*mult);
}
for(const patch of [{pointValue:20},{futuresContracts:0},{futuresContracts:1.5},{marginPerContract:null},{contract:'MNQ1!'},{direction:'unknown'},{contractRoot:'UNKNOWN'}]){
 context.t={...base,...patch}; assert.equal(run('buildTrades([normalizeEvent(t)]).length'),0);
}
context.t=base;
assert.equal(run('buildTrades([normalizeEvent(t),normalizeEvent({...t,eventType:"research",id:"research"})]).length'),1);
assert.equal(run('buildTrades([normalizeEvent({...t,eventType:"research"})]).length'),0);
assert.equal(run('tradePnl(buildTrades([normalizeEvent(t),normalizeEvent({...t,id:"exit",eventType:"exit",exitPrice:19990,timestamp:"2026-09-27T20:00:00Z"})])[0])'),-40);
assert.equal(run('tradePnl({system:"options",entryPrice:2,status:"closed",exitPrice:0,optionContracts:1})'),-200);
console.log('PASS: all 8 contract multipliers, long/short P&L, margin vs notional, invalid metadata, research exclusion, recorded exits and options regression');
