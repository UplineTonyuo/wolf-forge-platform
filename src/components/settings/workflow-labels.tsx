"use client";
import { createContext, useContext } from "react";
import type { ProcessEntry } from "../../domain/process/settings";
type Labels = { tickets:ProcessEntry[]; clients:ProcessEntry[] };
const WorkflowLabels = createContext<Labels>({tickets:[],clients:[]});
export function WorkflowLabelProvider({value,children}:{value:Labels;children:React.ReactNode}) {
  return <WorkflowLabels.Provider value={value}>{children}</WorkflowLabels.Provider>;
}
export function useWorkflowLabels(section:keyof Labels) { return useContext(WorkflowLabels)[section]; }

