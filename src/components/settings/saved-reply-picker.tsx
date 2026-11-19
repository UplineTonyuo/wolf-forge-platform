"use client";
import { useState } from "react";
import { savedReplies } from "../../app/actions/process";
import { AnimatedSelect } from "../ui/animated-select";
export function SavedReplyPicker({insert,disabled}:{insert:(text:string)=>void;disabled:boolean}) {
  const [entries,setEntries]=useState<Awaited<ReturnType<typeof savedReplies>>|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  if(entries?.length) return <AnimatedSelect name="saved-reply" label="Saved replies" menuLabel="Insert a saved reply" disabled={disabled}
    value="" options={entries.map(e=>({value:e.key,label:e.name}))} onChange={key=>{const e=entries.find(item=>item.key===key);if(e)insert(e.description);}}/>;
  return <><button type="button" disabled={disabled||busy} onClick={async()=>{
    setBusy(true);try{setEntries(await savedReplies());setError("");}catch{setError("Saved replies unavailable.");}finally{setBusy(false);}
  }}>Saved replies</button>{entries?.length===0 && <span role="status">No saved replies yet.</span>}{error && <span role="alert">{error}</span>}</>;
}

