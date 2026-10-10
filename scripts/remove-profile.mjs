let YAML;
try { YAML=await import('yaml'); } catch(e) { if(e.code!=='ERR_MODULE_NOT_FOUND') throw e; YAML=await import('./vendor/yaml/dist/index.js'); }
const {parseDocument,isMap,isSeq,visit}=YAML;
const names=new Set(['local-web-search','local-web-fetch']);
const options={customTags:[{tag:'tag:yaml.org,2002:js',resolve:value=>value}]};
function document(text) { const d=parseDocument(text,options); if(d.errors.length) throw new Error('Invalid Harness YAML; no files were changed.'); return d; }
function signature(node) { const metadata=[];visit(node,(_key,n)=>{if(n)metadata.push([n.tag,n.anchor,n.commentBefore,n.comment]);});return JSON.stringify([node?.toJSON(),metadata]); }
const equal=(a,b)=>signature(a)===signature(b);
function matching(doc,row) { const rows=isSeq(doc?.contents) ? doc.contents.items.filter(r=>isMap(r)&&r.get('id')===row.get('id')&&(!r.has('name')||!row.has('name')||r.get('name')===row.get('name'))) : [];return rows.length===1 ? rows[0] : undefined; }
function native(row) { const nodes=[]; visit(row,(_key,node)=>{if(isMap(node)&&node.get('name')==='@deepseek-ai/dsh-tool-web') nodes.push(node);}); return nodes; }
function findNative(row,node) { const found=native(row).filter(n=>n.get('id')===node.get('id')); return found.length===1 ? found[0] : undefined; }
export function removeSourceFerryPatch(text, {beforePatch='[]\n',afterPatch=null,beforeEffective=null}={}) {
  const doc=document(text); if(!isSeq(doc.contents)) throw new Error('Harness patch is not an entry sequence; no files were changed.');
  const before=document(beforePatch), after=afterPatch ? document(afterPatch) : null, effective=beforeEffective ? document(beforeEffective) : before;
  let changed=false;
  const preserveComment=node=>{ if(node.commentBefore) doc.contents.commentBefore=[doc.contents.commentBefore,node.commentBefore].filter(Boolean).join('\n'); };
  // Delete only the two SourceFerry rows, including their profile-level overrides.
  visit(doc.contents,{Seq(_key,node) {
    const kept=node.items.filter(item=>{const keep=!isMap(item)||!names.has(item.get('name'))&&!(!item.has('name')&&names.has(item.get('id'))); if(!keep) preserveComment(item); return keep;});
    if(kept.length!==node.items.length) {node.items=kept;changed=true;}
  }});
  for(const row of [...doc.contents.items]) {
    if(!isMap(row)||!native(row).length) continue;
    const old=matching(before,row), installed=after&&matching(after,row);
    // An unchanged generated override can be removed without losing subsequent edits.
    if(installed&&equal(row,installed)) {
      const index=doc.contents.items.indexOf(row);
      if(old) {const replacement=old.clone();replacement.commentBefore=row.commentBefore??replacement.commentBefore;doc.contents.items[index]=replacement;} else {preserveComment(row);doc.contents.items.splice(index,1);}
      changed=true; continue;
    }
    const baseline=matching(effective,row);
    for(const node of native(row)) {
      const config=node.get('config'); if(!isMap(config)) continue;
      const original=findNative(baseline,node)?.get('config');
      const wrote=findNative(installed,node)?.get('config');
      for(const key of ['search','fetch']) {
        // Preserve user edits. Unknown legacy preferences are left untouched.
        if(config.get(key)!==false || (after&&!isMap(wrote)) || (isMap(wrote)&&wrote.get(key)!==false)) continue;
        if(isMap(original)&&original.has(key)&&original.get(key)!==false) {config.set(key,original.get(key,true).clone());changed=true;}
        else if(beforeEffective&&(!isMap(original)||!original.has(key))) {config.delete(key);changed=true;}
      }
    }
  }
  return changed ? String(doc) : text;
}
export function removeLockReferences(text, removedNames) {
  const doc=document(text); let changed=false;
  for(const importer of doc.get('importers',true)?.items??[]) {
    const value=importer.value; if(!isMap(value)) continue;
    // Only this profile's root importer is ours; workspace children remain untouched.
    if(importer.key?.value!=='.') continue;
    for(const group of ['dependencies','devDependencies','optionalDependencies']) {
      const map=value.get(group); if(isMap(map)) for(const name of removedNames) if(map.has(name)) {map.delete(name);changed=true;}
    }
  }
  return changed ? String(doc) : text;
}
