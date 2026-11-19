"use client";
import { useState, useTransition } from "react";
import { setResourceTag } from "../../app/actions/process";
import type { ProcessEntry } from "../../domain/process/settings";
export function ResourceTags({kind,target,entries,assigned,editable}:{kind:"projects"|"tickets"|"clients";target:string;entries:ProcessEntry[];assigned:string[];editable:boolean}) {
  const [pending,start]=useTransition();
  const [error,setError]=useState("");
  if(!entries.length) return null;
  return <fieldset disabled={pending || !editable}><legend>Tags</legend>
    {entries.filter(tag=>editable || assigned.includes(tag.key)).map(tag=><label key={tag.key} title={tag.description}>
      <input type="checkbox" checked={assigned.includes(tag.key)} onChange={event=>{
        const checked=event.target.checked;
        start(async()=>{try{await setResourceTag(kind,target,tag.key,checked);setError("");}catch{setError("Could not update tag.");}});
      }}/><span style={{borderInlineStart:"3px solid "+tag.color,paddingInline:4}}>{tag.name}</span>
    </label>)}{error && <p role="alert">{error}</p>}
  </fieldset>;
}

