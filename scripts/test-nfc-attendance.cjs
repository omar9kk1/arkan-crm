const fs=require('fs');const ts=require('typescript');const vm=require('vm');const assert=require('node:assert/strict');
const cache={};function load(p){if(cache[p])return cache[p];const module={exports:{}};const code=ts.transpileModule(fs.readFileSync(p,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;vm.runInNewContext(code,{module,exports:module.exports,require:n=>n==='@arkan/shared'?{Role:{EMPLOYEE:'EMPLOYEE',MANAGER:'MANAGER'}}:load(require('path').resolve(require('path').dirname(p),n+'.ts')),URL,URLSearchParams,Date});return cache[p]=module.exports;}
const store=load(require('path').resolve('apps/frontend/features/employee-attendance/nfc-store.ts'));
const user={email:'employee@arkan.test',name:'أحمد محمد'};
const first=store.registerAttendance([],user,'EMP-EMPLOYEE-001',new Date(2026,8,22,9,0));assert.equal(first.action,'CHECK_IN');assert.equal(first.record.status,'PRESENT');
const second=store.registerAttendance(first.records,user,'EMP-EMPLOYEE-001',new Date(2026,8,22,17,0));assert.equal(second.action,'CHECK_OUT');assert.equal(second.records.length,1);
const third=store.registerAttendance(second.records,user,'EMP-EMPLOYEE-001',new Date(2026,8,22,18,0));assert.equal(third.action,'COMPLETED');assert.equal(third.records.length,1);
assert.throws(()=>store.registerAttendance([],user,''),/غير معروف/);assert.throws(()=>store.registerAttendance([],user,'EMP-SARA-001'),/غير مرتبط/);assert.throws(()=>store.registerAttendance([],{email:'other@arkan.test',name:'other'},'EMP-EMPLOYEE-001'),/غير مرتبط/);
const nextDay=store.registerAttendance(second.records,user,'EMP-EMPLOYEE-001',new Date(2026,8,23,10,0));assert.equal(nextDay.action,'CHECK_IN');assert.equal(nextDay.record.status,'LATE');assert.equal(nextDay.records.length,2);
const route=load(require('path').resolve('apps/frontend/features/employee-attendance/nfc-return.ts'));
assert.equal(route.nfcReturn('EMPLOYEE','?returnUrl=https://evil.test/employee/attendance/nfc'),null);assert.equal(route.nfcReturn('MANAGER','?returnUrl=/employee/attendance/nfc'),null);assert.equal(route.nfcReturn('EMPLOYEE','?returnUrl='+encodeURIComponent('/employee/attendance/nfc?tag=EMP-EMPLOYEE-001')),'/employee/attendance/nfc?tag=EMP-EMPLOYEE-001');
console.log('PASS: check-in/out, completed day, missing/foreign tags, next day, late status and safe return routing.');
