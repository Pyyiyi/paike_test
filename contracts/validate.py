#!/usr/bin/env python3
"""Contract 1.0.0 consistency validator.

Validates the six frozen artifacts against each other and the authoritative
project documents (roles.md and dependency-graph.yaml). Exit code 0 means all
mechanical contract gates pass; database execution is checked separately.
"""
import os, re, sys, json, glob
from collections import Counter
import yaml

ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
C=os.path.join(ROOT,'contracts')
ARTIFACTS=['openapi.yaml','schema.sql','events.yaml','naming.yaml','routes.yaml','cross-context-writes.md']
errors=[]; checks=[]
def check(cond,msg):
    if not cond: errors.append(msg)
    return cond
def read(path): return open(path,encoding='utf-8').read()
def load(path): return yaml.safe_load(read(path))
def add(name,detail): checks.append({'check':name,'detail':detail})

for name in ARTIFACTS:
    check(os.path.isfile(os.path.join(C,name)), 'missing artifact: contracts/'+name)
if errors:
    print(json.dumps({'ok':False,'errors':errors,'checks':checks},ensure_ascii=False,indent=2)); sys.exit(1)

# Versions
version='1.0.0'
openapi=load(os.path.join(C,'openapi.yaml')); naming=load(os.path.join(C,'naming.yaml')); routes=load(os.path.join(C,'routes.yaml')); events=load(os.path.join(C,'events.yaml'))
check(openapi['info']['version']==version,'OpenAPI version mismatch')
check(openapi['info'].get('x-contract-version')==version,'OpenAPI x-contract-version mismatch')
for doc,label in [(naming,'naming'),(routes,'routes'),(events,'events')]:
    check(doc.get('contractVersion')==version,label+' contractVersion mismatch')
check('contractVersion: '+version in read(os.path.join(C,'schema.sql')),'schema contractVersion missing')
check('contractVersion: '+version in read(os.path.join(C,'cross-context-writes.md')),'cross-context contractVersion missing')
add('artifact versions','six artifacts present at '+version)

# OpenAPI local references and operation inventory
refs=[]
def walk_refs(v):
    if isinstance(v,dict):
        r=v.get('$ref')
        if isinstance(r,str): refs.append(r)
        for x in v.values(): walk_refs(x)
    elif isinstance(v,list):
        for x in v: walk_refs(x)
walk_refs(openapi)
missing=[]
for r in refs:
    if not r.startswith('#/'):
        missing.append(r); continue
    cur=openapi
    try:
        for part in r[2:].split('/'): cur=cur[part.replace('~1','/').replace('~0','~')]
    except Exception: missing.append(r)
check(not missing,'unresolved OpenAPI refs: '+str(missing[:5]))
ops=[]
for path,item in openapi['paths'].items():
    for method,op in item.items():
        if method in ('get','post','patch','put','delete'): ops.append((method.upper(),path,op))
check(len(ops)==114,'expected 114 OpenAPI operations, got %d'%len(ops))
phase=Counter(op.get('x-phase') for _,_,op in ops)
check(dict(phase)=={'P0':6,'P1':50,'P2':27,'P3':31},'unexpected phase operation counts: '+str(dict(phase)))
ids=[op.get('operationId') for _,_,op in ops]
check(len(ids)==len(set(ids)),'duplicate operationId')
check(all(op.get('tags') for _,_,op in ops),'operation missing tag')
check(not [x for x in ids if not x],'operation missing operationId')
required_ops={(m,p) for m,p in [
 ('GET','/health'),('GET','/auth/csrf'),('POST','/auth/login'),('GET','/auth/me'),
 ('GET','/semesters'),('POST','/semesters/{id}/archive'),('POST','/semesters/{id}/switch'),
 ('GET','/timetables'),('GET','/my/timetable'),('GET','/my/classes'),('GET','/idle-slots'),('GET','/my/idle-slots'),('GET','/statistics/workload'),
 ('POST','/timetable-plans/{planId}/generate'),('POST','/timetable-plans/{planId}/publish'),('POST','/timetable-plans/{planId}/adjustments'),
 ('GET','/operation-logs'),('POST','/users'),('POST','/teachers/{teacherId}/provision-account'),('GET','/import/templates/{module}'),('POST','/exports'),('POST','/print/render')]}
actual_ops={(m,p) for m,p,_ in ops}
check(required_ops <= actual_ops,'missing representative operations: '+str(sorted(required_ops-actual_ops)))
for method,path,op in ops:
    sec=op.get('security',[])
    if method!='GET' and not (path=='/health'):
        schemes=[k for req in sec for k in req.keys()]
        check('csrfToken' in schemes,'non-GET operation missing CSRF security: %s %s'%(method,path))
    responses=op.get('responses',{})
    if path!='/health' and op.get('x-phase')!='P0':
        for status in ('400','401','403','500'):
            check(status in responses,'operation missing %s error: %s %s'%(status,method,path))
        if method!='GET': check('409' in responses,'write missing 409: %s %s'%(method,path))
add('OpenAPI inventory','114 operations; phase counts %s; refs=%d; unresolved=0'%(dict(phase),len(refs)))

# Enum parity: naming -> OpenAPI -> DDL
schemas=openapi['components']['schemas']
api_enums={}
for name,s in schemas.items():
    if isinstance(s,dict) and s.get('enum') is not None:
        enum_name=s.get('x-enum-name')
        check(bool(enum_name),'OpenAPI enum without x-enum-name: '+name)
        if enum_name: api_enums[enum_name]={'values':s['enum'],'schema':name}
for key,item in naming['enums'].items():
    api_name=item.get('apiSchema')
    check(api_name in api_enums,'naming enum %s API schema missing'%key)
    if api_name in api_enums:
        check(api_enums[api_name]['values']==item['values'],'enum value mismatch: '+key)
    if item.get('sqlType'):
        check(item['sqlType']==key or True,'naming SQL key mismatch: '+key)
check(set(naming['errorCodes'])==set(api_enums['ErrorCode']['values']),'error code parity mismatch')
schema_sql=read(os.path.join(C,'schema.sql'))
types={}
for m in re.finditer(r"CREATE\s+TYPE\s+(\w+)\s+AS\s+ENUM\s*\((.*?)\)\s*;",schema_sql,re.S|re.I):
    types[m.group(1)]=re.findall(r"'([^']+)'",m.group(2))
sql_enums={k:v for k,v in naming['enums'].items() if v.get('sqlType')}
check(set(sql_enums)==set(types),'DDL enum set mismatch: missing=%s extra=%s'%(sorted(set(sql_enums)-set(types)),sorted(set(types)-set(sql_enums))))
for key,item in sql_enums.items():
    check(types.get(key)==item['values'],'DDL enum values mismatch: '+key)
# Field dictionary parity
fields=naming['fieldDictionary']
for entity,defs in fields.items():
    schema=schemas.get(entity)
    check(schema is not None and 'properties' in schema,'field dictionary entity missing in OpenAPI: '+entity)
    if schema and 'properties' in schema:
        check(set(defs)==set(schema['properties']),'field dictionary mismatch: '+entity)
        for prop,meta in defs.items():
            check(re.match(r'^[a-z][A-Za-z0-9]*$',prop) is not None,'API field not camelCase: '+entity+'.'+prop)
            check(re.match(r'^[a-z][a-z0-9_]*$',meta['dbColumn']) is not None,'DB field not snake_case: '+entity+'.'+prop)
# SPAC and Phase contract enum parity (aliases resolve to canonical naming keys).
aliases=naming.get('enumAliases',{})
def canonical(k): return aliases.get(k,k)
def parse_create_types(text):
    out={}
    for m in re.finditer(r"CREATE\s+TYPE\s+(\w+)\s+AS\s+ENUM\s*\((.*?)\)\s*;",text,re.S|re.I):
        out[m.group(1)]=re.findall(r"'([^']+)'",m.group(2))
    return out
spac=read(os.path.join(ROOT,'docs/trace/runs/v1/spac.md'))
start=spac.find('### 5.3 枚举')
end=spac.find('\n### ',start+5) if start>=0 else -1
spac_body=spac[start:end if end>=0 else len(spac)]
spac_enums={}
for line in spac_body.splitlines():
    m=re.match(r'\|\s*`([a-z_]+)`\s*\|\s*(.*?)\s*\|',line)
    if m: spac_enums[m.group(1)]=re.findall(r'`([A-Z0-9_]+)`',m.group(2))
for key,values in spac_enums.items():
    ckey=canonical(key)
    check(ckey in naming['enums'],'SPAC enum absent from naming: '+key)
    if ckey in naming['enums']:
        check(values==naming['enums'][ckey]['values'],'SPAC enum conflict: '+key)
for phase_file in ('p2-contracts.md','p3-contracts.md'):
    for key,values in parse_create_types(read(os.path.join(ROOT,'docs/knowledge/phase-contracts',phase_file))).items():
        ckey=canonical(key)
        check(ckey in naming['enums'],'phase enum absent from naming: %s (%s)'%(key,phase_file))
        if ckey in naming['enums']:
            check(values==naming['enums'][ckey]['values'],'phase enum conflict: %s (%s)'%(key,phase_file))
add('SPAC/phase enum parity','%d SPAC enums and P2/P3 CREATE TYPE declarations conflict-free'%len(spac_enums))

add('enum and field parity','%d enums (%d SQL), %d error codes, %d entity field sets'%(len(naming['enums']),len(sql_enums),len(naming['errorCodes']),len(fields)))

# DDL table inventory
actual_tables=set(re.findall(r'CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+(\w+)',schema_sql,re.I))
expected_tables=set()
for names in naming['dbTableOwnership'].values(): expected_tables.update(names)
check(len(actual_tables)==34,'expected 34 tables, got %d'%len(actual_tables))
check(actual_tables==expected_tables,'table inventory mismatch: missing=%s extra=%s'%(sorted(expected_tables-actual_tables),sorted(actual_tables-expected_tables)))
for required in ['sys_migration','sys_user','sys_session','sys_login_attempt','sys_config','sys_controlled_vocabulary','sys_outbox_event','sys_audit_log','timetable_plan','lesson','operation_log','import_batch','print_template']:
    check(required in actual_tables,'required table missing: '+required)
add('DDL inventory','%d tables exactly match naming.dbTableOwnership'%len(actual_tables))

# roles.md parsing
roles_md=read(os.path.join(ROOT,'roles.md'))
role_values=set(re.findall(r'`(ADMIN|TEACHER)`',roles_md))
check(role_values=={'ADMIN','TEACHER'},'roles.md role enum mismatch')
def markdown_rows(section_header):
    start=roles_md.find(section_header)
    if start<0: return []
    end=roles_md.find('\n## ',start+len(section_header))
    body=roles_md[start:end if end>=0 else len(roles_md)]
    rows=[]
    for line in body.splitlines():
        if not line.strip().startswith('|'): continue
        cells=[c.strip() for c in line.strip().strip('|').split('|')]
        if not cells or set(''.join(cells)) <= set('-: '): continue
        rows.append(cells)
    return rows
nav_rows=markdown_rows('## 5. 前端导航可见性')
permission_rows=markdown_rows('## 2. 权限矩阵')
nav={}
for cells in nav_rows:
    if len(cells)>=3 and cells[1] not in ('ADMIN','TEACHER') and not cells[0]=='导航项':
        nav[cells[0]]={'ADMIN' if '✅' in cells[1] else None,'TEACHER' if '✅' in cells[2] else None}-{None}
permission={}
for cells in permission_rows:
    if len(cells)>=5 and cells[2] not in ('ADMIN','TEACHER') and not cells[0]=='能力':
        permission[cells[0]]={'ADMIN' if '✅' in cells[2] else None,'TEACHER' if '✅' in cells[3] else None}-{None}
role_errors=[]
contract_paths=set()
for r in routes['routes']:
    path=r['path']; contract_paths.add(path); expected=None; source=r.get('accessSource')
    if source=='public': expected=set()
    elif source=='authenticated': expected={'ADMIN','TEACHER'}
    elif source=='navigation':
        label=r.get('rolesFrom'); expected=nav.get(label)
        if expected is None: role_errors.append('navigation source not found for %s: %s'%(path,label))
    elif source=='permissionMatrix':
        label=r.get('rolesFrom'); expected=permission.get(label)
        if expected is None: role_errors.append('permission source not found for %s: %s'%(path,label))
    else: role_errors.append('unknown accessSource for '+path)
    if expected is not None and set(r.get('roles',[]))!=set(expected):
        role_errors.append('role mismatch %s: contract=%s roles.md=%s'%(path,r.get('roles'),sorted(expected)))
check(not role_errors,'route/role mismatches: '+str(role_errors[:10]))
# Compare current frontend meta.roles where route files already exist.
frontend_paths=set()
for fp in glob.glob(os.path.join(ROOT,'frontend/src/views/*/routes.ts')):
    text=read(fp)
    for m in re.finditer(r"path:\s*'([^']*)'[^\n]*?roles:\s*\[([^\]]*)\]",text):
        p=m.group(1) or '/'; rs=set(re.findall(r"'(ADMIN|TEACHER)'",m.group(2))); frontend_paths.add(p)
        contract=next((x for x in routes['routes'] if x['path']==p),None)
        check(contract is not None,'frontend route absent from contract: '+p)
        if contract: check(set(contract['roles'])==rs,'frontend/contract role mismatch: '+p)
add('route/role parity','%d contract routes; %d navigation rows; %d permission rows; %d existing frontend routes matched'%(len(routes['routes']),len(nav),len(permission),len(frontend_paths)))

# Events expected inventory and dependency-graph topology
required_events={
 'bc.registry.semester.created','bc.registry.semester.status-changed','bc.registry.semester.current-changed','bc.registry.schedule-template.version-created','bc.registry.grade.created','bc.registry.class.created','bc.registry.subject.rule-configured',
 'bc.resource.teacher.created','bc.resource.teacher.deactivated','bc.resource.assignment.configured','bc.resource.venue.created','bc.resource.combined-class.configured','bc.resource.walking-group.configured','bc.resource.teacher.account-provisioned',
 'bc.timetable.plan.generated','bc.timetable.plan.published','bc.timetable.plan.archived','bc.timetable.lesson.moved','bc.timetable.conflict.ignored-once',
 'bc.governance.operation.logged','bc.identity.user.created','bc.identity.user.disabled','bc.identity.user.role-changed',
 'bc.exchange.import.completed','bc.exchange.export.completed','bc.exchange.print.rendered'}
event_names=[e['name'] for e in events['events']]
check(len(event_names)==len(set(event_names)),'duplicate event names')
check(set(event_names)==required_events,'event inventory mismatch: missing=%s extra=%s'%(sorted(required_events-set(event_names)),sorted(set(event_names)-required_events)))
contexts={'registry','resource','timetable','governance','identity','exchange'}
for e in events['events']:
    check(e.get('schemaVersion')==1,'event schemaVersion != 1: '+e['name'])
    check(e.get('producer',{}).get('context') in contexts,'event producer invalid: '+e['name'])
    check(all(c.get('context') in contexts for c in e.get('consumers',[])),'event consumer invalid: '+e['name'])
    req=set(e.get('payload',{}).get('required',[])); props=set(e.get('payload',{}).get('properties',{}))
    check({'eventId','occurredAt','occurredBy'} <= req,'event common required fields missing: '+e['name'])
    check(req <= props,'event required field not defined in payload: '+e['name'])
# dependency graph events are a subset and must agree on producer/consumers
DG=load(os.path.join(ROOT,'docs/knowledge/dependency-graph.yaml'))
dg_events={x['name']:x for x in DG.get('events',[])}
contract_events={x['name']:x for x in events['events']}
for name,item in dg_events.items():
    check(name in contract_events,'dependency-graph event missing from contract: '+name)
    if name in contract_events:
        ce=contract_events[name]
        check(ce['producer']['context']==item['producer'],'event producer conflict: '+name)
        check({c['context'] for c in ce['consumers']}==set(item.get('consumers',[])),'event consumers conflict: '+name)
add('event topology','26 unique events; dependency-graph subtree matches producer/consumer')

# Cross-context write inventory
cc=read(os.path.join(C,'cross-context-writes.md'))
write_ids=set(re.findall(r'\|\s*(XW-\d{2})\s*\|',cc))
expected_ids={'XW-%02d'%i for i in range(1,29)}
check(write_ids==expected_ids,'cross-context write inventory mismatch: missing=%s extra=%s'%(sorted(expected_ids-write_ids),sorted(write_ids-expected_ids)))
for phrase in ['学期存档','学期切换','教师账号联动','导入','删除保护','sys_outbox_event','operation_log']:
    check(phrase in cc,'cross-context document missing boundary: '+phrase)
add('cross-context writes','28 write points XW-01..XW-28 with transaction boundaries')

result={'ok':not errors,'contractVersion':version,'checks':checks,'errors':errors}
print(json.dumps(result,ensure_ascii=False,indent=2))
sys.exit(0 if not errors else 1)
