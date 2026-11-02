// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ClientProjectsList } from "../components/account/projects/client-projects-list";
import type { ClientProjectView } from "../domain/orders/client-projections";
import { orderStatuses } from "../domain/orders/schema";
const projects: ClientProjectView[] = orderStatuses.map((status,index) => ({ id:`project-${index}`, title:`Project ${status}`, status,statusLabel:status,reference:`WF-P${index}`,serviceName:"Synthetic service",createdLabel:"Oct 30, 2026",startedLabel:null,dueLabel:null,completedLabel:null,progress:{total:0,completed:0,percent:null} }));
afterEach(cleanup);
describe("compact client project browsing",()=>{
 it("shows client Unanswered separately from order status and preserves pagination",()=>{
  const responseStates = [{order_id:'project-2',unanswered:true},{order_id:'project-0',unanswered:false},{order_id:'project-1',unanswered:null}];
  render(<ClientProjectsList projects={projects} responseStates={responseStates}/>);
  const waiting = screen.getByRole('link',{name:/Project working/});
  expect(within(waiting).getByText('Unanswered')).toBeTruthy();
  expect(within(waiting).getByText('working')).toBeTruthy();
  expect(screen.getAllByText('Unanswered')).toHaveLength(1);
  expect(screen.getAllByRole('link')).toHaveLength(5);
  fireEvent.click(screen.getByRole('button',{name:'Working, 1 order'}));
  expect(within(screen.getByRole('link')).getByText('Unanswered')).toBeTruthy();
 });
 it("clears the client badge only when refreshed authoritative metadata says answered",()=>{
  const view=render(<ClientProjectsList projects={projects} responseStates={[{order_id:'project-2',unanswered:true}]}/>);
  expect(screen.getByText('Unanswered')).toBeTruthy();
  view.rerender(<ClientProjectsList projects={projects} responseStates={[{order_id:'project-2',unanswered:false}]}/>);
  expect(screen.queryByText('Unanswered')).toBeNull();
 });
 it("keeps unknown reply metadata and intake actions visible without claiming answered",()=>{
  render(<ClientProjectsList projects={projects} responseStates={[]} replyError="Reply status could not be loaded." intakeLinks={{'project-0':'/account/onboarding/required'}}/>);
  expect(screen.getByRole('alert').textContent).toContain('Reply status could not be loaded');
  expect(screen.queryByText('Unanswered')).toBeNull();
  expect(screen.getByRole('link',{name:/Start order · Form required/})).toBeTruthy();
 });
 it("shows six tabs and at most five projects per page",()=>{
  render(<ClientProjectsList projects={projects}/>);
  expect(within(screen.getByRole('group',{name:'Filter orders by status'})).getAllByRole('button')).toHaveLength(6);
  expect(screen.getAllByRole('link')).toHaveLength(5);
  fireEvent.click(screen.getByRole('button',{name:'Next'}));
  expect(screen.getAllByRole('link')).toHaveLength(2);
  const complete=screen.getByRole('region',{name:'Completed'}), canceled=screen.getByRole('region',{name:'Canceled'});
  expect(within(complete).getByRole('link').textContent).toContain('Project complete');
  expect(within(canceled).getByRole('link').textContent).toContain('Project canceled');
 });
 it("groups Pending, Getting started and Needs information without changing data",()=>{
  const before=structuredClone(projects);render(<ClientProjectsList projects={projects}/>);
  fireEvent.click(screen.getByRole('button',{name:'Pending, 3 orders'}));
  expect(screen.getAllByRole('link').map(link=>link.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('Project pending'),expect.stringContaining('Project submitted'),expect.stringContaining('Project pending_update')]));
  expect(screen.getAllByRole('link')).toHaveLength(3);expect(projects).toEqual(before);
 });
 it.each([['Working','working'],['Complete','complete'],['Canceled','canceled'],['Waiting reply','waiting_reply']])('filters %s and resets pagination',(label,status)=>{
  render(<ClientProjectsList projects={projects}/>);fireEvent.click(screen.getByRole('button',{name:'Next'}));
  fireEvent.click(screen.getByRole('button',{name:`${label}, 1 order`}));
  expect(screen.getAllByRole('link')).toHaveLength(1);expect(screen.getByRole('link').textContent).toContain(`Project ${status}`);
  fireEvent.click(screen.getByRole('button',{name:'All, 7 orders'}));expect(screen.getAllByRole('link')).toHaveLength(5);
 });
 it("opens pending order start controls and keeps working order links intact",()=>{
  render(<ClientProjectsList projects={projects} intakeLinks={{'project-0':'/account/onboarding/assigned','project-2':'/account/onboarding/wrong'}}/>);
  expect(screen.getByRole('link',{name:/Start order · Form required/}).getAttribute('href')).toBe('/account/projects/project-0#start-order');
  expect(screen.getByRole('link',{name:/Project working/}).getAttribute('href')).toBe('/account/projects/project-2');
 });
 it("clamps the page when refreshed data shrinks",()=>{
  const view=render(<ClientProjectsList projects={projects}/>);fireEvent.click(screen.getByRole('button',{name:'Next'}));
  view.rerender(<ClientProjectsList projects={[projects[0]!]}/>);expect(screen.getAllByRole('link')).toHaveLength(1);expect(screen.getByRole('status').textContent).toBe('1–1 of 1 orders');
 });
});
