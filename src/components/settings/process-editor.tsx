"use client";
import { useState } from "react";
import { ArrowDown, ArrowUp, Plus } from "lucide-react";
import { saveProcess } from "../../app/actions/process";
import { type ProcessConfig, type ProcessEntry, type ProcessSection, sectionTitle } from "../../domain/process/settings";
import { AnimatedSelect } from "../ui/animated-select";
import styles from "./process.module.css";

const days = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
export function ProcessEditor({section, settings, version}:{section:ProcessSection;settings:ProcessConfig;version:number}) {
  const [draft,setDraft] = useState(settings);
  const [expectedVersion,setExpectedVersion]=useState(version);
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState("");
  const canAdd = ["orders","saved-replies","tags"].includes(section);
  const noun = section==="saved-replies"?"reply":section==="tags"?"tag":"stage";
  function update(patch:Partial<ProcessConfig>) { setDraft(current=>({...current,...patch})); setMessage(""); }
  function edit(key:string,patch:Partial<ProcessEntry>) {
    update({entries:draft.entries.map(entry=>entry.key===key?{...entry,...patch}:entry)});
  }
  function move(index:number,offset:number) {
    const entries=[...draft.entries];
    if (!entries[index] || !entries[index+offset]) return;
    [entries[index],entries[index+offset]]=[entries[index+offset]!,entries[index]!];
    update({entries});
  }
  function toggle(key:"lock"|"reopen"|"ratings"|"automatic"|"ownerOnly",label:string) {
    return <label className={styles.toggle}><input type="checkbox" checked={draft[key]??false} onChange={e=>update({[key]:e.target.checked})}/>{label}</label>;
  }
  const options=draft.entries.map(e=>({value:e.key,label:e.name}));
  return <form className={styles.editor} onSubmit={async event=>{
    event.preventDefault(); if(busy) return;
    setBusy(true);
    try {
      const error=await saveProcess(section,expectedVersion,draft);
      setMessage(error ?? "Changes saved.");
      if (!error) setExpectedVersion(expectedVersion+1);
    }
    catch { setMessage("Settings could not be saved. Check your access and try again."); }
    finally { setBusy(false); }
  }}>
    <h2>{sectionTitle[section]}</h2>
    <fieldset disabled={busy}>
      {section==="orders" && <div className={styles.preferences}>
        {toggle("lock","Lock conversations on completed orders")}
        {toggle("reopen","Allow clients to request revisions on completed orders")}
        <AnimatedSelect name="destination" label="Reopen revisions in" menuLabel="Revision destination"
          options={options.filter(o=>!["complete","canceled"].includes(o.value))} value={draft.destination??""} onChange={destination=>update({destination})}/>
        {toggle("ratings","Allow clients to rate completed orders")}
      </div>}
      {section==="tickets" && <div className={styles.preferences}>
        <AnimatedSelect name="reply" label="Status after a staff reply" menuLabel="Reply status" value={draft.reply??"unchanged"}
          options={[{value:"unchanged",label:"Keep current status"},...options.filter(o=>["waiting_on_team","waiting_on_client","in_progress"].includes(o.value))]} onChange={reply=>update({reply})}/>
        {toggle("ratings","Allow clients to rate resolved and closed tickets")}
      </div>}
      {section==="clients" && <div className={styles.preferences}>{toggle("ownerOnly","Require an owner to issue all signup invitations")}
        <p>Imported clients always need an owner-issued activation.</p></div>}
      {section==="messaging" && <div className={styles.preferences}>
        {toggle("automatic","Send an automatic reply outside business hours")}
        <label>Automatic reply<textarea maxLength={4000} required={draft.automatic} value={draft.body} onChange={e=>update({body:e.target.value})}/></label>
        <fieldset><legend>Business days</legend>{days.map((name,i)=><label key={name} className={styles.toggle}><input type="checkbox"
          checked={draft.days?.includes(i+1)??false} onChange={e=>update({days:e.target.checked?[...(draft.days??[]),i+1]:(draft.days??[]).filter(day=>day!==i+1)})}/>{name}</label>)}</fieldset>
        <label>Opening time<input type="time" required value={draft.start} onChange={e=>update({start:e.target.value})}/></label>
        <label>Closing time<input type="time" required value={draft.end} onChange={e=>update({end:e.target.value})}/></label>
        <label>Time zone<input required value={draft.zone} placeholder="Asia/Singapore" onChange={e=>update({zone:e.target.value})}/></label>
      </div>}
      {section!=="messaging" && <section><h3>{section==="orders"?"Order stages":section==="clients"?"Funnel statuses":section==="tickets"?"Ticket statuses":sectionTitle[section]}</h3>
        {draft.entries.map((entry,index)=><fieldset key={entry.key} className={styles.entry}>
          <legend>{entry.name||"New "+noun}{entry.key.length!==36?" · System":""}</legend>
          <div className={styles.fields}><label>Name<input required maxLength={80} value={entry.name} onChange={e=>edit(entry.key,{name:e.target.value})}/></label>
          {section!=="saved-replies" && <label>Color<input type="color" value={entry.color} onChange={e=>edit(entry.key,{color:e.target.value})}/></label>}</div>
          <label>{section==="saved-replies"?"Reply text":"Description"}<textarea required={section==="saved-replies"} maxLength={4000} value={entry.description} onChange={e=>edit(entry.key,{description:e.target.value})}/></label>
          <div className={styles.buttons}><button type="button" aria-label={"Move "+entry.name+" up"} disabled={!index} onClick={()=>move(index,-1)}><ArrowUp size={16}/></button>
          <button type="button" aria-label={"Move "+entry.name+" down"} disabled={index===draft.entries.length-1} onClick={()=>move(index,1)}><ArrowDown size={16}/></button>
          {section==="saved-replies" && <button type="button" onClick={()=>update({entries:draft.entries.filter(e=>e.key!==entry.key)})}>Remove reply</button>}</div>
        </fieldset>)}
        {canAdd && <button type="button" disabled={draft.entries.length>=150} onClick={()=>update({entries:[...draft.entries,{key:crypto.randomUUID(),name:"",description:"",color:"#435787"}]})}><Plus size={16}/> Add {noun}</button>}
      </section>}
      <div className={styles.buttons}><button className={styles.save} type="submit" disabled={busy}>{busy?"Saving…":"Save changes"}</button><span role="status">{message}</span></div>
    </fieldset>
  </form>;
}

