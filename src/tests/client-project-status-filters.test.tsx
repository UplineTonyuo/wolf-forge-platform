// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ClientProjectsList } from "../components/account/projects/client-projects-list";
import type { ClientProjectView } from "../domain/orders/client-projections";
import { orderStatuses } from "../domain/orders/schema";
const projects: ClientProjectView[] = orderStatuses.map((status,index) => ({ id:`project-${index}`, title:`Project ${status}`, status,statusLabel:status,reference:`WF-P${index}`,serviceName:"Synthetic service",createdLabel:"Oct 30, 2026",startedLabel:null,dueLabel:null,completedLabel:null,progress:{total:0,completed:0,percent:null} }));
afterEach(cleanup);
describe("compact client project browsing",()=>{
 it("shows six tabs and at most five projects per page",()=>{
  render(<ClientProjectsList projects={projects}/>);
  expect(within(screen.getByRole('group',{name:'Filter projects by status'})).getAllByRole('button')).toHaveLength(6);
  expect(screen.getAllByRole('link')).toHaveLength(5);
  fireEvent.click(screen.getByRole('button',{name:'Next'}));
  expect(screen.getAllByRole('link')).toHaveLength(2);
  const complete=screen.getByRole('region',{name:'Completed'}), canceled=screen.getByRole('region',{name:'Canceled'});
  expect(within(complete).getByRole('link').textContent).toContain('Project complete');
  expect(within(canceled).getByRole('link').textContent).toContain('Project canceled');
 });
 it("groups Pending, Getting started and Needs information without changing data",()=>{
  const before=structuredClone(projects);render(<ClientProjectsList projects={projects}/>);
  fireEvent.click(screen.getByRole('button',{name:'Pending, 3 projects'}));
  expect(screen.getAllByRole('link').map(link=>link.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('Project pending'),expect.stringContaining('Project submitted'),expect.stringContaining('Project pending_update')]));
  expect(screen.getAllByRole('link')).toHaveLength(3);expect(projects).toEqual(before);
 });
 it.each([['Working','working'],['Complete','complete'],['Canceled','canceled'],['Waiting reply','waiting_reply']])('filters %s and resets pagination',(label,status)=>{
  render(<ClientProjectsList projects={projects}/>);fireEvent.click(screen.getByRole('button',{name:'Next'}));
  fireEvent.click(screen.getByRole('button',{name:`${label}, 1 project`}));
  expect(screen.getAllByRole('link')).toHaveLength(1);expect(screen.getByRole('link').textContent).toContain(`Project ${status}`);
  fireEvent.click(screen.getByRole('button',{name:'All, 7 projects'}));expect(screen.getAllByRole('link')).toHaveLength(5);
 });
 it("links Pending directly to its required intake and keeps working project links intact",()=>{
  render(<ClientProjectsList projects={projects} intakeLinks={{'project-0':'/account/onboarding/assigned','project-2':'/account/onboarding/wrong'}}/>);
  expect(screen.getByRole('link',{name:/Complete intake form/}).getAttribute('href')).toBe('/account/onboarding/assigned');
  expect(screen.getByRole('link',{name:/Project working/}).getAttribute('href')).toBe('/account/projects/project-2');
 });
 it("clamps the page when refreshed data shrinks",()=>{
  const view=render(<ClientProjectsList projects={projects}/>);fireEvent.click(screen.getByRole('button',{name:'Next'}));
  view.rerender(<ClientProjectsList projects={[projects[0]!]}/>);expect(screen.getAllByRole('link')).toHaveLength(1);expect(screen.getByRole('status').textContent).toBe('1–1 of 1 projects');
 });
});
