"""Execute the production atomic script with Lua 5.4 and an in-memory Redis command shim.
No providers, production state or Telegram calls. Redis supplies Lua 5.1/bit;
the tested production script uses only shared 5.1-compatible syntax.
"""
import ctypes
from pathlib import Path
lua = ctypes.CDLL('liblua5.4.so.0')
lua.luaL_newstate.restype = ctypes.c_void_p
lua.luaL_openlibs.argtypes = [ctypes.c_void_p]
lua.luaL_loadstring.argtypes = [ctypes.c_void_p, ctypes.c_char_p]
lua.lua_pcallk.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_ssize_t, ctypes.c_void_p]
lua.lua_tolstring.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_void_p]
lua.lua_tolstring.restype = ctypes.c_char_p
lua.lua_close.argtypes = [ctypes.c_void_p]
source = Path('src/services/deteriorationMonitor.ts').read_text().split('export const MONITOR_SCRIPT = `', 1)[1].split('`;', 1)[0]
setup = r'''
local function clone(v) if type(v)~='table' then return v end local n={} for k,x in pairs(v) do n[k]=clone(x) end return n end
local codec={}; local serial=0
cjson={encode=function(v) serial=serial+1; codec[tostring(serial)]=clone(v); return tostring(serial) end,
 decode=function(v) assert(codec[v], 'invalid encoded value'); return clone(codec[v]) end}
bit={band=function(a,b) return a & b end,bnot=function(a) return ~a end}
local hashes={}; local locks={}; local expiries={}; local time=0
redis={call=function(cmd,key,a,b,c,d)
 if cmd=='HGETALL' then local out={} for k,v in pairs(hashes[key] or {}) do table.insert(out,k); table.insert(out,v) end return out
 elseif cmd=='HSET' then hashes[key]=hashes[key] or {}; hashes[key][a]=b; return 1
 elseif cmd=='HDEL' then if hashes[key] then hashes[key][a]=nil end return 1
 elseif cmd=='PEXPIRE' then expiries[key]=time+a; return 1
 elseif cmd=='SET' then if locks[key] and locks[key].expiry>time then return nil end locks[key]={value=a,expiry=time+d}; return 'OK'
 elseif cmd=='GET' then if locks[key] and locks[key].expiry>time then return locks[key].value end return nil
 elseif cmd=='DEL' then locks[key]=nil; return 1 end error('unsupported '..cmd)
end}
local function run(action,at,token,user,data,baseline,checked)
 time=at; ARGV={action,tostring(at),token or '',user or '',data or '',tostring(baseline or ''),tostring(checked or '')}; KEYS={'test','test:lease'}
 local function execute()
'''
checks = r'''
 end
 return cjson.decode(execute())
end
local function fixture(token,at) return cjson.encode({token=token,pair='pool',symbol='TEST',price=1,liquidity=10000,at=at,expires=at+3600000,checked=0,users={},mask=0,notices=0}) end
local now=1000000000
for i=1,10 do assert(run('add',now,'t'..i,'u'..i,fixture('t'..i,now)).status=='ACTIVE') end
assert(run('add',now,'t11','u11',fixture('t11',now)).status=='CAPACITY', 'global capacity')
local first=run('next',now); assert(first.status=='CHECK')
assert(run('next',now+1).status=='IDLE','global in-flight lease')
local selected=first.row
assert(run('finish',now+2,selected.token,'','1',selected.at,selected.checked).status=='NOTIFY')
assert(run('finish',now+3,selected.token,'','1',selected.at,selected.checked).status=='SILENT','duplicate warning')
assert(run('finish',now+4,selected.token,'','5',selected.at,selected.checked).status=='NOTIFY','data gap transition')
assert(run('finish',now+5,selected.token,'','1',selected.at,selected.checked).status=='SILENT','data gap is not recovery')
assert(run('finish',now+6,selected.token,'','0',selected.at,selected.checked).status=='SILENT')
assert(run('finish',now+7,selected.token,'','1',selected.at,selected.checked).status=='NOTIFY','recovered re-crossing')
assert(run('finish',now+8,selected.token,'','2',selected.at,selected.checked).status=='SILENT','three-notice ceiling')
for i=1,4 do
 local next=run('next',now+i*1000); assert(next.status=='CHECK')
 run('finish',now+i*1000+1,next.row.token,'','0',next.row.at,next.row.checked)
end
assert(run('next',now+5000).status=='IDLE','five checks/minute ceiling')
local again=run('add',now+6000,'t1','u1',fixture('t1',now+6000))
assert(again.row.at==now and again.row.expires==now+3600000,'duplicate admission cannot extend lifetime or replace baseline')
assert(run('add',now+6000,'t2','u1',fixture('t2',now)).status=='ACTIVE')
assert(run('add',now+6000,'t3','u1',fixture('t3',now)).status=='CAPACITY','two tokens/user')
run('stop',now+7000,'t1','u1')
local own=run('list',now+7000,'','u1'); assert(#own.rows==1,'stop removes only this user')
assert(run('finish',now+3600001,selected.token,'','1',selected.at,selected.checked).status=='EXPIRED','expire before sending')
assert(run('add',now+3600001,'new','u1',fixture('new',now+3600001)).status=='ACTIVE','expired capacity reclaimed')
assert(expiries.test<=now+3600001+3660000,'bounded storage TTL')
'''
state = lua.luaL_newstate()
try:
    lua.luaL_openlibs(state)
    result = lua.luaL_loadstring(state, (setup + source + checks).encode())
    if result == 0:
        result = lua.lua_pcallk(state, 0, 0, 0, 0, None)
    if result:
        raise RuntimeError(lua.lua_tolstring(state, -1, None).decode())
    print('Atomic Lua validation passed: global/user caps, lease, budget, restart-state dedup, hysteresis, notice ceiling, expiry and stop')
finally:
    lua.lua_close(state)
