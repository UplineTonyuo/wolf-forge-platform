"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CalendarDays, Check, ImagePlus, LoaderCircle, Plus, Printer, Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { completeGoalMilestoneAction, listGoalsAction } from "../../app/actions/goals";
import { canManageGoals, canCompleteGoal, type Goal, type GoalList, type GoalMember } from "../../domain/goals/schema";
import { AccountAvatar } from "../ui/account-avatar";
import { GoalEditor, uploadGoalPhoto } from "./goal-editor";
import styles from "./goals.module.css";

const dateLabel=(date:string|null)=>date?new Intl.DateTimeFormat("en-US",{month:"short",day:"numeric",year:"numeric",timeZone:"UTC"}).format(new Date(date+"T12:00:00Z")):"No deadline";
function Cover({goal,large=false}:{goal:Goal;large?:boolean}) {
  return <div className={large?styles.coverLarge:styles.cover}>
    {goal.photo_path?
      // Private images require the viewer's cookies; Next's public image optimizer cannot forward them.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={"/api/team-goals/"+goal.id+"/photo?v="+encodeURIComponent(goal.photo_checksum??"")} alt="" loading={large?"eager":"lazy"}/>
      :<div className={styles.noPhoto}><span>No goal photo yet</span></div>}
  </div>;
}
function Progress({goal}:{goal:Goal}) {
  const percent=goal.milestone_count?Math.round(goal.completed_count/goal.milestone_count*100):0;
  return <div className={styles.progressBlock}><div className={styles.progressLabel}><span>{goal.completed_count} of {goal.milestone_count} milestones</span><strong>{percent}%</strong></div><div className={styles.track} role="progressbar" aria-label="Goal progress" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}><span style={{width:percent+"%"}}/></div></div>;
}
type UserProps={role:string;actorId:string;members:GoalMember[]};
type GoalView={source:GoalList;data:GoalList;pending:boolean;error:string};
export function GoalListView({initial,role,actorId,members}:{initial:GoalList}&UserProps) {
  const [loaded,setLoaded]=useState<GoalView|null>(null),[editing,setEditing]=useState(false);
  const request=useRef(0);
  const view:GoalView=loaded?.source===initial?loaded:{source:initial,data:initial,pending:false,error:""};
  const {data,pending,error}=view;
  const manage=canManageGoals(role);
  const visible=data.items;
  async function load(append=false){
    if(append&&(pending||!data.next_before))return;
    const token=++request.current;
    const retained=append?data:{items:[],next_before:null};
    setLoaded({source:initial,data:retained,pending:true,error:""});
    try{
      const result=await listGoalsAction(append?data.next_before:null,null);
      if(token!==request.current)return;
      if(!result.ok){setLoaded({source:initial,data:retained,pending:false,error:result.error});return;}
      setLoaded({source:initial,data:{items:append?[...data.items,...result.data.items.filter(item=>!data.items.some(old=>old.id===item.id))]:result.data.items,next_before:result.data.next_before},pending:false,error:""});
    }catch{if(token===request.current)setLoaded({source:initial,data:retained,pending:false,error:"Unable to load goals. Try again."});}
  }
  return <div className={styles.page}>
    <div className={styles.printHeading}>WOLF FORGE · TEAM GOALS</div>
    <header className={styles.header}><div><h1>Goals</h1><p className={styles.muted}>A clear direction. Progress everyone can follow.</p></div><div className={styles.actions}><button type="button" className="button-secondary" onClick={()=>window.print()}><Printer aria-hidden="true"/>Print shown goals</button>{manage?<button type="button" className="button-primary" onClick={()=>setEditing(true)}><Plus aria-hidden="true"/>New goal</button>:null}</div></header>
    {error?<div role="alert" className={styles.error}>{error}{!data.items.length?<button type="button" className="button-secondary" onClick={()=>load()}>Retry</button>:null}</div>:null}
    {pending&&!data.items.length?<div className={styles.loading} role="status"><LoaderCircle className={styles.spin} aria-hidden="true"/>Loading goals…</div>:visible.length?<ul className={styles.cards}>{visible.map(goal=><li key={goal.id}><Link className={styles.card} href={"/team/goals/"+goal.id}><Cover goal={goal}/><div className={styles.cardBody}><h2>{goal.title}</h2><div className={styles.meta}><span className={styles.person}><AccountAvatar avatarUrl={goal.owner_avatar_url} size={24}/>{goal.owner_name}</span><span><CalendarDays aria-hidden="true"/>{dateLabel(goal.due_date)}</span></div><Progress goal={goal}/></div></Link></li>)}</ul>:!error?<div className={styles.empty}><h2>No goals yet</h2><p>{manage?"Create a goal with a photo and a few clear milestones.":"Shared team goals will appear here."}</p></div>:null}
    {data.next_before?<div className={styles.loadMore}><button type="button" className="button-secondary" disabled={pending} onClick={()=>load(true)}>{pending?<LoaderCircle className={styles.spin} aria-hidden="true"/>:null}{pending?"Loading…":"Load more goals"}</button></div>:null}
    {editing?<GoalEditor members={members} actorId={actorId} onClose={()=>setEditing(false)}/>:null}
  </div>;
}
export function GoalDetailView({initial,role,actorId,members,photoRetry=false}:{initial:Goal;photoRetry?:boolean}&UserProps) {
  const [confirmed,setConfirmed]=useState<{source:Goal;goal:Goal}|null>(null),[editing,setEditing]=useState(false),[pending,setPending]=useState<string|null>(null);
  const goal=confirmed?.source===initial?confirmed.goal:initial;
  const [photoPending,setPhotoPending]=useState(false),[error,setError]=useState("");
  const displayedError=error||(photoRetry?"Goal saved. The photo could not be uploaded; choose it again below.":"");
  const [notice,setNotice]=useState(""), router=useRouter();
  const manage=canManageGoals(role),complete=canCompleteGoal(role,actorId,goal);
  async function toggle(id:string,value:boolean){if(pending)return;setPending(id);setError("");setNotice("Saving progress…");
    try{const result=await completeGoalMilestoneAction(goal.id,id,value);if(!result.ok){setError(result.error);setNotice("");return;}setConfirmed({source:initial,goal:result.goal});setNotice("Progress updated.");router.refresh();}
    catch{setError("Unable to update this milestone. Try again.");setNotice("");}finally{setPending(null);}}
  async function photo(file:File|null){if(!file||photoPending)return;setPhotoPending(true);setError("");setNotice("");
    try{await uploadGoalPhoto(goal.id,file);setNotice("Photo updated.");if(photoRetry)router.replace("/team/goals/"+goal.id);router.refresh();}
    catch(error){setError(error instanceof Error?error.message:"Photo upload failed. Try again.");}finally{setPhotoPending(false);}}
  return <div className={styles.page}>
    <div className={styles.printHeading}>WOLF FORGE · GOAL</div>
    <Link className={styles.back} href="/team/goals"><ArrowLeft aria-hidden="true"/>Back to goals</Link>
    <header className={styles.header}><div><h1>{goal.title}</h1>{goal.description?<p className={styles.description}>{goal.description}</p>:null}</div><div className={styles.actions}><button className="button-secondary" type="button" onClick={()=>window.print()}><Printer aria-hidden="true"/>Print goal</button>{manage?<button className="button-primary" type="button" onClick={()=>setEditing(true)}><Pencil aria-hidden="true"/>Edit goal</button>:null}</div></header>
    {displayedError?<p role="alert" className={styles.error}>{displayedError}</p>:null}
    <p role="status" className={styles.notice}>{notice}</p>
    <div className={styles.detailGrid}><div className={styles.detailMain}><Cover goal={goal} large/><section aria-labelledby="goal-milestones" aria-busy={Boolean(pending)}><div className={styles.sectionHead}><h2 id="goal-milestones">Milestones</h2><span>{goal.completed_count} of {goal.milestone_count} complete</span></div>{goal.milestones.length?<ul className={styles.milestones}>{goal.milestones.map(item=><li key={item.id}><label><input type="checkbox" checked={item.completed_at!==null} disabled={!complete||Boolean(pending)} onChange={event=>toggle(item.id,event.target.checked)}/><span className={item.completed_at?styles.completed:undefined}>{item.title}</span>{pending===item.id?<small className={styles.saving} aria-hidden="true"><LoaderCircle className={styles.spin}/>Saving…</small>:item.completed_at?<Check aria-hidden="true"/>:null}</label></li>)}</ul>:<p className={styles.muted}>{manage?"Add milestones using Edit goal to start tracking progress.":"No milestones have been added yet."}</p>}</section></div>
      <aside className={styles.overview} aria-label="Goal overview"><h2>Goal overview</h2><Progress goal={goal}/><dl><div><dt>Owner</dt><dd className={styles.person}><AccountAvatar avatarUrl={goal.owner_avatar_url} size={28}/>{goal.owner_name}</dd></div><div><dt>Due date</dt><dd>{dateLabel(goal.due_date)}</dd></div></dl>{manage?<label className={styles.upload}><ImagePlus aria-hidden="true"/><span>{photoPending?"Uploading…":goal.photo_path?"Replace photo":"Upload goal photo"}<small>1080 × 1080 px recommended · up to 2 MB</small></span><input type="file" accept="image/jpeg,image/png,image/webp" disabled={photoPending} onChange={event=>{void photo(event.target.files?.[0]??null);event.target.value="";}}/></label>:null}{!complete?<p className={styles.muted}>Milestones are updated by the goal owner or an administrator.</p>:null}</aside></div>
    {editing?<GoalEditor goal={goal} members={members} actorId={actorId} onClose={()=>setEditing(false)}/>:null}
  </div>;
}
